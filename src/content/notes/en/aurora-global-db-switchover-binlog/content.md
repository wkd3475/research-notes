---
title: 'Aurora Global Database Switchover — What Happens to Binlog?'
---

## References

- [Setting up enhanced binlog for Aurora MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html)
- [Using switchover or failover in Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html)
- [Introducing enhanced binlog (AWS blog)](https://aws.amazon.com/blogs/database/introducing-amazon-aurora-mysql-enhanced-binary-log-binlog/)
- [Global Database writer endpoint deep dive (AWS blog)](https://aws.amazon.com/blogs/database/diving-deep-into-the-new-amazon-aurora-global-database-writer-endpoint/)
- [Aurora reader binlog — re:Post](https://repost.aws/questions/QUQuQ2eje6TnatP_lAtdydhg/can-we-configure-separate-binary-logging-binlog-on-aurora-mysql-s-read-replica-instance)

---

## Why I looked this up

I'm planning to move a database to another Region via Aurora Global Database switchover. Before doing that, I need to check what work the CDC connector will require — specifically how binlog behaves during switchover and what we need to reconfigure or recover afterward.

---

## What stood out

- The gap between "global writer endpoint handles app reconnects" and "CDC offset/binlog continuity" is the part I need to nail down before the Region move.
- `binlog_replication_globaldb=1` does **not** mean you can run a CDC connector on the secondary while it is still read-only — we tested this at work and it did not read binlog as expected. That matches Aurora's writer-only binlog model.

---

## What I learned

### Already read today

- [Aurora MySQL enhanced binlog (Korean blog)](https://hoing.io/archives/3086)
- [Introducing enhanced binlog (AWS blog)](https://aws.amazon.com/blogs/database/introducing-amazon-aurora-mysql-enhanced-binary-log-binlog/)
- [Global Database writer endpoint deep dive (AWS blog, Oct 2024)](https://aws.amazon.com/blogs/database/diving-deep-into-the-new-amazon-aurora-global-database-writer-endpoint/)

### Two different replication layers

Aurora Global Database cross-Region replication is **storage-level physical replication**, not binlog replication. Secondary clusters hold an identical dataset without replaying SQL from the binary log. Binlog is a separate layer for external consumers (CDC, cross-cluster replication) with its own Global Database behavior controlled by cluster parameters.

### Switchover mechanics (brief)

Switchover (formerly "managed planned failover") is for healthy, planned operations with **RPO = 0**:

1. Wait until the target secondary cluster is fully synchronized with the primary.
2. Demote the primary Region cluster to read-only.
3. Promote the chosen secondary cluster to primary (one of its reader nodes becomes the writer).
4. Replication topology stays the same — same Regions, same number of clusters.

Instances restart and are briefly unavailable. Binlog guidance in AWS docs is often written as "failover," but the promotion outcome is the same: a former secondary becomes the new primary writer.

### `binlog_replication_globaldb` — what it actually does

| Setting | Default | Effect |
|---------|---------|--------|
| `= 1` | Yes (community binlog) | Primary binlog data **is replicated** to secondary clusters in the Global Database |
| `= 0` | Required for enhanced binlog | Binlog data **is not replicated** to secondary Regions |

**Important:** this replicates binlog **files** to the secondary cluster for use **after** promotion — it is **not** a live CDC source on the secondary while it remains read-only.

Enhanced binlog (`aurora_enhanced_binlog = 1`) requires `binlog_replication_globaldb = 0` and `binlog_backup = 0`. All three are static parameters — reboot the writer after changing them.

### You cannot run CDC on a Global DB secondary (before switchover)

| Situation | CDC on secondary? | Why |
|-----------|-------------------|-----|
| Before switchover (secondary = read-only) | **No** | No writer on secondary; Aurora readers are not binlog sources (`SHOW MASTER STATUS` is empty on readers) |
| After switchover (secondary promoted to primary) | **Yes** | A writer exists; community binlog may retain replicated files for offset resume |

Aurora CDC (Debezium, DMS, etc.) must connect to the **writer** — use the **global writer endpoint** or primary cluster writer endpoint, not a secondary reader/cluster endpoint.

### Binlog after switchover — depends on binlog mode

#### Enhanced binlog ON

- Binlog files on the old primary are **not** copied to secondary Regions.
- After switchover, the new primary has **no historical binlog** from the old primary.
- If binlog stays enabled, a **fresh sequence** starts from `mysql-bin-changelog.000001`.
- Promoted cluster does **not** inherit the old primary's parameter group — configure enhanced binlog on the secondary beforehand if needed.

#### Community binlog ON (`binlog_replication_globaldb = 1`)

- Binlog data is replicated to secondaries while they are secondaries.
- After switchover, the promoted primary **may retain** replicated binlog files (files written after enhanced binlog was last turned off).
- AWS example: if enhanced binlog was disabled after `mysql-bin-changelog.000003`, files `000004`–`000006` remain on the promoted cluster.

### What Global DB switchover does *not* do for binlog

Unlike **blue/green** switchover, Global Database switchover does **not** emit binlog coordinate RDS events (`Binary log coordinates in green environment after switchover: file … position …`). Plan CDC recovery without counting on AWS-published coordinates.

### CDC connector checklist for a Region move

**Connector config (before switchover)**

| Item | Action |
|------|--------|
| Hostname | **Global Database writer endpoint** — not Region-specific cluster/reader endpoint |
| Network | Cross-Region VPC connectivity if connector and DB end up in different Regions |
| DNS TTL | Route 53–backed endpoint; plan for DNS cache delay; watch RDS events |
| Binlog mode | `SHOW STATUS LIKE 'aurora_enhanced_binlog';` + `binlog_replication_globaldb` on all clusters |
| Offset backup | Export last offset from `connect-offsets` (file+position or GTID) |
| Heartbeat | `heartbeat.interval.ms` (e.g. 10s) to flush offsets before downtime |
| Snapshot fallback | `snapshot.mode=when_needed` |

**During / after switchover**

1. Connection drops (writer restart).
2. Connector retries global writer endpoint.
3. Resumes from stored offset — **succeeds only if** that binlog file exists on the new primary.

| Binlog mode on new primary | Likely CDC outcome |
|----------------------------|-------------------|
| Enhanced binlog | Offset mismatch → `"binlog file … no longer available"` |
| Community binlog | May auto-resume if offset file was replicated — verify in non-prod |
| Any — file missing | Snapshot or manual offset repair |

**Recovery if CDC breaks:** `when_needed` snapshot · manual offset tombstone in `connect-offsets` · Debezium `set-binlog-position` signal · recreate connector.

### Comparison table

| Scenario | Historical binlog on new primary | New binlog writes |
|----------|----------------------------------|-------------------|
| Enhanced binlog ON | Not available; fresh `.000001` sequence | New primary writes new files |
| Community binlog ON | Replicated files may remain | May continue from replicated files |
| Binlog OFF | N/A | N/A |

### Open questions (for non-prod test)

- Does `SHOW BINARY LOGS` on the target secondary **before** switchover match the primary tail when community binlog is on?
- Exact recovery path when enhanced binlog is active in production.
- Behavior on switchback to the original primary Region.

---

## Memo

Next up: how switchover works **internally** (single Aurora cluster vs Global Database) and how **JDBC** detects the transition for minimal downtime.
