---
title: 'Aurora Global Database Switchover — What Happens to Binlog?'
---

> Source: [Setting up enhanced binlog for Aurora MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html), [Using switchover or failover in Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html), [Best practices for Aurora MySQL configuration](https://aws.amazon.com/blogs/database/best-practices-for-amazon-aurora-mysql-database-configuration/)

---

## Why I looked this up

Today I want to understand how binlog behaves when performing a switchover on an Aurora Global Database.

---

## What stood out

—

---

## What I learned

### Two different replication layers

Aurora Global Database cross-Region replication is **storage-level physical replication**, not binlog replication. Secondary clusters hold an identical dataset without replaying SQL from the binary log. Binlog is a separate concern: it exists for external consumers (CDC tools, cross-cluster replication, etc.) and has its own Global Database behavior controlled by cluster parameters.

### Switchover mechanics (brief)

Switchover (formerly "managed planned failover") is for healthy, planned operations with **RPO = 0**:

1. Wait until the target secondary cluster is fully synchronized with the primary.
2. Demote the primary Region cluster to read-only.
3. Promote the chosen secondary cluster to primary (one of its reader nodes becomes the writer).
4. Replication topology stays the same — same Regions, same number of clusters.

Database instances restart and are briefly unavailable. The AWS docs describe switchover and failover together for promotion mechanics; binlog-specific guidance is written mainly in terms of "failover," but the promotion outcome is the same: a former secondary becomes the new primary writer.

### The key parameter: `binlog_replication_globaldb`

| Setting | Default | Meaning |
|---------|---------|---------|
| `binlog_replication_globaldb = 1` | Yes (community binlog) | Binary log data **is replicated** from the primary cluster to secondary clusters in the Global Database |
| `binlog_replication_globaldb = 0` | Required for enhanced binlog | Binary log data **is not replicated** to secondary Regions |

Enhanced binlog (`aurora_enhanced_binlog = 1`) requires `binlog_replication_globaldb = 0` and `binlog_backup = 0`. All three are static parameters — reboot the writer after changing them.

### Binlog after switchover — depends on binlog mode

#### Enhanced binlog ON (`aurora_enhanced_binlog = 1`)

- Binlog files on the old primary are **not** copied to secondary Regions.
- After switchover (or failover), the **new primary has no historical binlog** from the old primary.
- If binlog remains enabled, the new primary starts a **fresh file sequence** from `mysql-bin-changelog.000001`.
- Binlog files written **before** enhanced binlog was turned on are also unavailable on the new primary (to avoid discontinuity in the sequence).
- You must configure enhanced binlog parameters on the secondary cluster itself if it was not already set up there.

#### Community binlog ON (`aurora_enhanced_binlog = 0`, `binlog_replication_globaldb = 1`)

- Binlog data **is replicated** to secondary clusters while they are secondaries.
- After switchover, the newly promoted primary **can retain binlog files** that were replicated while it was a secondary — specifically, files written after enhanced binlog was last turned off.
- AWS doc example: if enhanced binlog was disabled after `mysql-bin-changelog.000003`, files `000004`–`000006` remain available on the promoted cluster.

### What switchover does *not* do for binlog

Unlike Aurora **blue/green** switchover, Global Database switchover docs do **not** describe emitting binlog coordinate events for external replicas. Blue/green explicitly logs something like `Binary log coordinates in green environment after switchover: file mysql-bin-changelog.000003 and position 40134574` so consumers can `CHANGE REPLICATION SOURCE TO ...`. For Global Database switchover, the docs focus on:

- Using the **global writer endpoint** (connection string stays the same).
- Aligning parameter groups, monitoring, and alarms on the promoted cluster beforehand.
- For PostgreSQL: managing logical replication slots after switchover.

For MySQL external binlog consumers, plan for a **discontinuity or re-pointing** — especially with enhanced binlog.

### Comparison table

| Scenario | Historical binlog on new primary after switchover | New binlog writes |
|----------|---------------------------------------------------|-------------------|
| Enhanced binlog ON | Not available; fresh sequence from `.000001` | New primary writes its own files |
| Community binlog ON (default params) | Replicated files available (post–enhanced-binlog-off portion) | Continues from replicated files |
| Binlog disabled | N/A | N/A |

### Operational checklist before switchover (binlog-related)

- [ ] Know which binlog mode is active: `SHOW STATUS LIKE 'aurora_enhanced_binlog';`
- [ ] Check `binlog_replication_globaldb` and `aurora_enhanced_binlog` on **all** clusters in the global database (promoted cluster does not inherit parameter groups from the old primary).
- [ ] If external CDC/replicas read binlog from the primary endpoint, plan how they will reconnect after switchover — global writer endpoint for writes, but binlog file continuity is not guaranteed with enhanced binlog.
- [ ] Confirm `binlog_format` is not `OFF` if you rely on binlog at all.

### Open questions for hands-on verification

- Exact binlog file list on a secondary **immediately before** switchover when community binlog is on — does it always match the old primary's tail?
- Whether any RDS event is emitted with binlog coordinates on Global Database switchover (blue/green does; Global Database docs are silent for MySQL).
- Behavior when switching back (second switchover to restore original primary Region).

---

## Memo

—
