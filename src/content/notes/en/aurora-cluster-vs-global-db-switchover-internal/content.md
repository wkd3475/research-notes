---
title: 'Aurora cluster vs Global DB switchover — internal steps'
---

## References

- [High availability for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)
- [Failing over an Aurora DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-failover.html)
- [Using Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)
- [Switchover or failover in Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html)
- [Introducing the Aurora Storage Engine (blog)](https://aws.amazon.com/blogs/database/introducing-the-aurora-storage-engine/)
- [Global Database deep dive DAT404 (re:Invent PDF)](https://d1.awsstatic.com/events/reinvent/2020/Deep_dive_on_Global_Database_for_Amazon_Aurora_DAT404.pdf)
- [Cross-Region DR PostgreSQL (blog)](https://aws.amazon.com/blogs/database/cross-region-disaster-recovery-using-amazon-aurora-global-database-for-amazon-aurora-postgresql/)
- [switchover-global-cluster CLI](https://docs.aws.amazon.com/cli/latest/reference/rds/switchover-global-cluster.html)
- [FailoverDBCluster API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_FailoverDBCluster.html)
- [FailoverGlobalCluster API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_FailoverGlobalCluster.html)
- [Enhanced binlog](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html)
- [Cross-Region Aurora MySQL replicas](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Replication.CrossRegion.html)
- [Managed planned failovers (blog)](https://aws.amazon.com/blogs/database/managed-planned-failovers-with-amazon-aurora-global-database/)
- [Improving business continuity (blog)](https://aws.amazon.com/blogs/database/improving-business-continuity-with-amazon-aurora-global-database/)
- [Introducing Global Database Failover (blog)](https://aws.amazon.com/blogs/database/introducing-aurora-global-database-failover/)

---

## Why I looked this up

In the earlier note [Aurora Global Database Switchover — What Happens to Binlog?](/research-notes/en/notes/aurora-global-db-switchover-binlog/) I covered binlog and CDC. This follow-up is about **what Aurora does under the hood** during promotion in a **single cluster** vs **cross-Region Global Database switchover/failover** — before planning a Region move.

---

## What stood out

Both paths look like “promote a reader to writer,” but a single-cluster failover only swaps **compute on the same storage volume**, while Global DB swaps **Regional roles on separate volumes** tied together by physical redo replication. That makes the binlog note’s point (storage replication ≠ binlog replication) click.

---

## What I learned

### Materials read today (5 stages)

| Stage | Topic | Key sources |
|-------|-------|-------------|
| 1 | HA, failover, Global DB overview | Aurora HA guide, `aurora-failover`, `aurora-global-database`, disaster-recovery guide |
| 2 | Storage layer & physical replication | Storage Engine blog, DAT404 PDF, Cross-Region DR PostgreSQL blog |
| 3 | API & state machine | `switchover-global-cluster`, `FailoverDBCluster`, `FailoverGlobalCluster` |
| 4 | Binlog & Global DB | Enhanced binlog docs, cross-Region read replica docs |
| 5 | Operations & depth | Managed planned failovers blog, business continuity blog, Global Database Failover blog |

### Core premise: compute / storage separation

```
[Writer/Reader instances]  ←→  redo log  ←→  [Distributed storage fleet]
                                              ↓
                                    Global DB: cross-Region redo replication
```

Aurora sends **redo logs**, not full data pages, to storage. Storage materializes pages in the background. This explains fast single-cluster failover and Global DB physical replication.

---

### Stage 1 — Single-cluster HA & failover

| Item | Detail |
|------|--------|
| Scope | Same Region, **same cluster volume** |
| Trigger | Writer failure (automatic) or `failover-db-cluster` (manual) |
| Internals | Promote an existing reader to writer (or create a new writer if no readers) |
| Storage | **Unchanged** — same volume, different compute role |
| RPO | Effectively 0 |
| RTO | Usually &lt;30s, up to ~60s |
| Promotion order | `PromotionTier` (0 = highest) → same tier → larger instance |

**API:** `FailoverDBCluster` — `DBClusterIdentifier` + optional `TargetDBInstanceIdentifier`

**Endpoint:** The cluster endpoint always points at the current writer; DNS updates after failover.

**Aurora MySQL tip:** Only the promoted reader and former writer restart; other readers can keep serving reads via the reader endpoint.

---

### Stage 2 — Storage layer & Global DB physical replication

#### Aurora storage layout

- **10 GB protection groups**, each replicated to **6 storage nodes**
- 6 nodes across **3 AZs × 2 nodes**
- Auto-scales with data (up to 64 TB)
- **Write success:** **4 of 6** ACKs (4/6 write quorum)
- **Reads:** 3/6 read quorum

#### Eight steps inside a storage node

```
① Incoming queue (memory, dedup)
② Persist to hot log → ACK  ← app-visible write latency
③ Organize logs, detect gaps
④ Gossip to fill missing LSNs
⑤ Coalesce → data pages
⑥ Stage to S3 (continuous backup)
⑦ Garbage collection
⑧ CRC scrub
```

Steps ③–⑧ are async.

#### Why decoupling matters for failover

- Readers hold no local copy of data → ready immediately
- Reader loss does not affect stored data
- Reader → writer promotion → **no data loss** (shared volume)

#### Global DB cross-Region replication (4 steps)

```
Primary Region                              Secondary Region
Writer ─┬→ Storage nodes
        ├→ Reader instances
        └→ Replication Server ──redo──→ Replication Agent
                                              ├→ Storage nodes
                                              └→ Reader instances
```

- **Not logical/binlog replication** — physical redo → **identical dataset**
- Dedicated replication fleet → minimal impact on primary writer
- Typical lag **&lt;1s**, upper bound ~5s
- Up to 16 readers per Region, 5 secondary Regions, 90 readers total

#### Logical vs physical cross-Region replication (DAT404)

| | MySQL binlog (logical) | Aurora Global DB (physical) |
|--|--------------------------|-------------------------------|
| Method | Replay SQL/row changes | Apply redo at storage |
| Lag vs QPS | Grows sharply | Stays ~1s |
| Dataset | Primary/replica can diverge | Identical |

#### Monitoring (PostgreSQL)

```sql
SELECT * FROM aurora_global_db_status();
SELECT * FROM aurora_global_db_instance_status();
```

CloudWatch: `AuroraGlobalDBReplicationLag`, `AuroraGlobalDBReplicatedWriteIO`, `AuroraGlobalDBDataTransferBytes`

---

### Stage 3 — API & state machine

#### Command / API map

| Scenario | CLI / API | Region |
|----------|-----------|--------|
| Single-cluster failover | `failover-db-cluster` / `FailoverDBCluster` | Cluster Region |
| Global DB switchover (planned) | `switchover-global-cluster` / `SwitchoverGlobalCluster` | **Current primary Region** |
| Global DB failover (unplanned) | `failover-global-cluster` / `FailoverGlobalCluster` | Primary Region |

**Switchover CLI example:**

```bash
aws rds --region <primary-region> \
  switchover-global-cluster \
  --global-cluster-identifier <global-db-id> \
  --target-db-cluster-identifier <secondary-cluster-arn>
```

**FailoverGlobalCluster parameters:**

| Parameter | Use |
|-----------|-----|
| `AllowDataLoss=true` | Unplanned failover |
| `Switchover=true` (or omit) | Planned switchover — prefer **`SwitchoverGlobalCluster`** |

#### Global cluster `FailoverState.Status`

| Status | Meaning |
|--------|---------|
| `pending` | Request received, pre-checks |
| `switching-over` | Demote primary, promote secondary, sync replicas |
| `failing-over` | Unplanned failover in progress |
| `cancelling` | Rolled back to previous roles |

`IsDataLossAllowed`: `true` = failover, `false` = switchover

---

### Stage 4 — Binlog & Global DB (links to prior note)

Global DB **inter-Region data replication** and **binlog** are separate layers.

| Replication | Layer | Required for Global DB? |
|-------------|-------|-------------------------|
| Physical storage | Replication server/agent | Yes (built-in) |
| Binlog logical | MySQL engine | No (CDC / external replicas only) |

**Cross-Region read replica (binlog)** vs **Global DB:**

| | Cross-Region read replica | Global DB |
|--|---------------------------|-----------|
| Replication | Binlog required | Storage layer |
| Secondary | Independent DB | Identical dataset |
| Lag | Higher over Regions | ~1s |
| Count | Up to 5 per source | Up to 5 Regions |

**Enhanced binlog + Global DB:**

- `binlog_replication_globaldb=0` (required for enhanced binlog)
- Primary binlog files **not replicated** to secondary Regions
- After switchover/failover: new sequence from `mysql-bin-changelog.000001`
- CDC offset continuity **not guaranteed by AWS**

See the [binlog note](/research-notes/en/notes/aurora-global-db-switchover-binlog/) for CDC checklists.

---

### Stage 5 — Operations blogs

#### Managed planned failover (switchover)

- Older workflows **broke topology** and required recreating secondaries
- Managed switchover keeps topology, RPO=0
- **All Regional instances restart** → brief unavailability
- Duration scales with replication lag
- Can **cancel** mid-operation

**Pre-flight checklist:**

- Match secondary instance size and reader count to primary
- Align parameter groups, monitoring, Secrets Manager
- Run during off-peak hours
- Prefer **Global writer endpoint** to minimize app changes

#### Managed failover (unplanned)

- **No sync wait** → RPO = lag at failure time
- **Write fencing** on old primary (best-effort)
- Old primary recovery → new volume + `rds:unplanned-global-failover-*` snapshot
- **Rebuild other secondaries** from new primary (minutes to hours)
- Split-brain risk → take apps offline, low DNS TTL, pick lowest-lag secondary

#### Managed RPO (`rds.global_db_rpo`, PostgreSQL)

- Pauses primary commits if all secondaries exceed RPO lag
- Minimum 20 seconds

---

### Three scenarios at a glance

| | Single-cluster failover | Global DB switchover | Global DB failover |
|--|-------------------------|----------------------|--------------------|
| API | `FailoverDBCluster` | `SwitchoverGlobalCluster` | `FailoverGlobalCluster` |
| Storage | Same volume | Per-Region volumes | Per-Region volumes |
| Sync wait | N/A | Required (RPO=0) | Skipped |
| RPO | 0 | 0 | &gt;0 (lag) |
| RTO | ~30–60s | Minutes (lag-dependent) | ~1 min + rebuild |
| Topology | Unchanged | Preserved | Preserved (managed) |
| Config inheritance | N/A | **Not automatic** | **Not automatic** |

---

### Timelines

#### Single-cluster failover

```
T0  Normal — shared storage volume
T1  Writer down — writes fail
T2  Promote reader (~10–30s) — storage unchanged
T3  Cluster endpoint DNS update
T4  Recovered — RTO ~30s
```

#### Global DB switchover

```
Phase 0  Normal
Phase 1  Wait for lag→0 (writes still OK)
Phase 2  Demote primary to read-only — writes stop
Phase 3  Promote secondary — brief outage, instance restarts
Phase 4  Role swap — Global writer endpoint moves
Phase 5  Recovered — RPO=0
```

#### Global DB failover

```
T0  Primary Region outage — replication stops
T1  Pick lowest-lag secondary, apps offline
T2  Promote without sync
T3  Write fencing (parallel)
T4  New primary accepts writes (~1 min)
T5  Rebuild other secondaries (background)
T6  Old primary → new volume on recovery
```

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What changes in the storage layer during single-cluster failover?
---
**Almost nothing.** Writer and readers share the same cluster volume. Failover is a **compute-layer** role change. Redo log flow continues to the same volume → RPO=0, short RTO.
:::

:::quiz
**Q2.** What does Global DB switchover wait for before proceeding?
---
Target secondary must be **fully synchronized** with primary. Watch `AuroraGlobalDBRPOLag` / `AuroraGlobalDBReplicationLag` and `aurora_global_db_status()`. Higher lag → longer switchover.
:::

:::quiz
**Q3.** How do demote/promote differ between switchover and failover?
---
**Switchover:** lag=0 → demote old primary to read-only secondary → promote target → RPO=0, no fencing.

**Failover:** no sync → promote at current lag → write fencing on old primary → rebuild secondaries → RPO = lag, split-brain risk.
:::

:::quiz
**Q4.** Why rebuild secondaries after failover?
---
Async replication means Regions can lag differently. After promotion, other secondaries must be rebuilt to the **same point in time** as the new primary. Takes **minutes to hours**.
:::

:::quiz
**Q5.** What happens to MySQL binlog during Global DB switchover/failover?
---
Storage replication does **not** carry binlog. Enhanced binlog → new sequence from `.000001`. Community binlog with `binlog_replication_globaldb=1` may retain some replicated files. CDC must reconnect to the writer; offset resume only if the file exists on the new primary.
:::

---

### Metrics checklist

| When | Metric | Bad sign |
|------|--------|----------|
| Before switchover | `AuroraGlobalDBRPOLag` | Seconds+ |
| During | `FailoverState.Status` | `cancelling` |
| After failover | RDS Events | Fencing timeout |
| After failover | Snapshots | `unplanned-global-failover-*` |

---

### Endpoints

| Endpoint | After switchover/failover |
|----------|---------------------------|
| Global writer endpoint | New primary Region |
| Cluster endpoint | Per-Region — manual change if using old primary URL |
| Reader endpoint | Readers in that Region |

---

### One-line learning path

```
Aurora storage/redo log
  → single-cluster failover (same volume)
    → Global DB physical replication
      → switchover (sync → demote → promote)
        → failover (no sync, fencing, rebuild)
          → binlog/CDC (separate layer)
```

---

## Memo

Next: **JDBC failover detection and minimal downtime** — how drivers notice endpoint/DNS changes after switchover and which settings reduce app downtime.
