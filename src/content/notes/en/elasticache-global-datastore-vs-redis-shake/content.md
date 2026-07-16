---
title: 'ElastiCache Global Datastore vs redis-shake'
---

## References

- [Replication across AWS Regions using global datastores](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Redis-Global-Datastore.html)
- [Global Datastore prerequisites and limitations](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Redis-Global-Datastores-Getting-Started.html)
- [Multi-Region session store with ElastiCache for Valkey Global Datastore (AWS Database Blog)](https://aws.amazon.com/blogs/database/build-a-multi-region-session-store-with-amazon-elasticache-for-valkey-global-datastore/)
- [RedisShake (GitHub, Tair open source)](https://github.com/tair-opensource/RedisShake)
- [RedisShake docs (English)](https://tair-opensource.github.io/RedisShake/en/)
- [RedisShake sync_reader](https://tair-opensource.github.io/RedisShake/en/reader/sync_reader.html)
- [RedisShake README_FOR_AGENTS](https://github.com/tair-opensource/RedisShake/blob/v4/README_FOR_AGENTS.md)

---

## Why I looked this up

Curious about the difference between **Global Datastore** and **redis-shake**.

---

## What stood out

Just wanted the comparison — no extra impressions yet.

---

## What I learned

*They solve different jobs. Global Datastore is a **managed, ongoing cross-Region replica topology** inside ElastiCache. redis-shake is an **open-source migration / data-processing tool** you run yourself between Redis-compatible endpoints.*

---

### Act 1 — One-line roles

:::chat gon Gon
What’s the difference between Global Datastore and redis-shake?
:::

:::chat teacher Teacher
Different layers of the stack:

| | **ElastiCache Global Datastore** | **redis-shake** |
|---|----------------------------------|-----------------|
| **What it is** | AWS **managed feature** on ElastiCache (Valkey / Redis OSS) | **Open-source binary** (Tair team) you deploy and operate |
| **Primary job** | Long-running **cross-Region async replication** + DR | **Move / transform data** between Redis-like sources and targets |
| **Who runs the pipe** | ElastiCache (fully managed) | You (process, host, config, restarts) |
| **Topology** | 1 primary Region (read/write) + up to **2** secondary Regions (read-only) | One **reader** → one **writer** pipeline (`shake.toml`) |
| **Steady-state use** | Yes — geo reads + Region DR | Best as **one-time / cutover** migration; not ideal as forever sync |

If you’re asking “keep ElastiCache warm in another Region forever,” that’s Global Datastore. If you’re asking “copy Redis A into Redis B (maybe filter keys, maybe change vendors),” that’s redis-shake.
:::

---

### Act 2 — Global Datastore (managed cross-Region)

:::chat student AI Student
How does Global Datastore actually work day to day?
:::

:::chat teacher Teacher
You wrap ElastiCache clusters into a **global datastore**:

- **Primary (active)** — accepts **writes** and reads; changes replicate out.
- **Secondary (passive)** — **read-only** in another AWS Region; gets async updates from primary.

ElastiCache sets up and manages that replication. Typical wins called out in AWS docs:

1. **Geolocal reads** — apps in the secondary Region read locally (lower latency).
2. **Disaster recovery** — if the primary Region degrades, you **manually promote** a secondary to become the new primary (no cross-Region autofailover).

Replication is **asynchronous**, so secondaries can lag a little under load or network stress.
:::

:::chat student AI Student
What are the hard limits I should memorize?
:::

:::chat teacher Teacher
From the official prerequisites / limitations page:

| Constraint | Detail |
|------------|--------|
| **Scope** | Node-based ElastiCache clusters in an **Amazon VPC** (not Local Zones) |
| **Regions** | Primary → secondary in up to **two** other Regions (China Beijing ↔ Ningxia special case) |
| **Shape match** | Same primary-node count, **node type**, **engine version**, and **shard count** (cluster mode); replica count per Region can differ |
| **Account** | **Same AWS account** only — no cross-account Global Datastore |
| **Secondary bootstrap** | You can use an **existing** cluster as **primary**; adding a secondary **creates a new** cluster (existing cluster as secondary is not supported — data would be wiped) |
| **Failover** | **Manual** promote secondary → primary; no automatic Region failover |
| **Other** | No IPv6; not with durability-enabled clusters; encryption at rest / in transit / AUTH supported |

Writes from a secondary Region’s app still go **cross-Region to the primary** (e.g. via peering / TGW) unless you’ve promoted.
:::

---

### Act 3 — redis-shake (DIY migration pipe)

:::chat student AI Student
Then what is redis-shake doing under the hood?
:::

:::chat teacher Teacher
redis-shake sits **between** two Redis-compatible endpoints. Config = one reader + one writer.

**Readers (how you pull source data):**

| Reader | Idea | When |
|--------|------|------|
| **`sync_reader`** | Pretends to be a **replica** via **PSync** — RDB full sync, then AOF incremental stream | Preferred when source speaks PSync (Redis / Valkey / Tair; ElastiCache needs `aws_psync` config) |
| **`scan_reader`** | `SCAN` + `DUMP`/`RESTORE` (incremental via keyspace notifications when used that way) | When PSync isn’t available |
| **`rdb_reader`** | Replay from an **RDB file** | Offline / file-based restore |

**Extras that Global Datastore doesn’t give you:** key **filters**, Lua **transform** functions, heterogeneous targets (self-hosted ↔ ElastiCache ↔ MemoryDB ↔ Tair, etc.).

You run `./redis-shake shake.toml` (or the Docker image) and own the lifecycle.
:::

:::chat student AI Student
Why do the maintainers say it’s for migration, not forever-sync?
:::

:::chat teacher Teacher
RedisShake **4.x** docs are blunt:

1. **No checkpoint / resume** — restart ⇒ **full resync** from scratch (unlike commercial DTS / Tair Global Active-Active).
2. **Static topology assumed** — source cluster scale-out, failover, or slot migration can **panic** the process.

So full + incremental sync during a **cutover window** is the sweet spot. Using it as a multi-year DR pipe means you own restarts, topology drift, and ops risk that Global Datastore abstracts away.
:::

---

### Act 4 — Side-by-side decision table

:::chat student AI Student
Give me a cheat sheet for picking one.
:::

:::chat teacher Teacher
| Question | Lean **Global Datastore** | Lean **redis-shake** |
|----------|---------------------------|----------------------|
| Same AWS account, ElastiCache ↔ ElastiCache, need **ongoing** multi-Region reads/DR? | Yes | Overkill / fragile as forever sync |
| Need **promote secondary** as a first-class AWS op? | Yes (manual) | You invent cutover yourself |
| Source/target on **different clouds**, **self-hosted**, or **cross-account**? | No (same account, ElastiCache only) | Yes |
| Need to **filter / rewrite** keys during copy? | No | Yes (`filter` / functions) |
| One-time **Region move** or engine upgrade with a cutover? | Possible but constrained (new secondary, shape match) | Common pattern |
| Want AWS to run replication for you? | Yes | No — you run the binary |

**Mental model:** Global Datastore ≈ “Aurora Global Database, but for ElastiCache Redis/Valkey (active-passive).” redis-shake ≈ “DMS/DTS-style **tool you operate**, specialized for Redis RESP data.”
:::

:::chat gon Gon
So they’re not really alternatives for the same job?
:::

:::chat teacher Teacher
They **overlap** only in “get Redis data from place A to place B.” Past that:

- **Always-on multi-Region ElastiCache** → Global Datastore.
- **Migration / reshape / escape hatch across products** → redis-shake (or a commercial migrator with checkpoints if you need resume).

Sometimes you use **both over a timeline**: migrate into ElastiCache with redis-shake, then turn on Global Datastore for steady-state DR — different phases, not pick-one forever.
:::

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Global Datastore vs redis-shake — who owns the replication process?
---
Global Datastore: **ElastiCache manages** async cross-Region replication. redis-shake: **you** run and operate the binary (config, host, restarts).
:::

:::quiz
**Q2.** Can a Global Datastore secondary accept writes?
---
**No** — secondary clusters are **read-only** until you **manually promote** one to primary. Apps in a secondary Region that need to write must send writes to the primary (or after promotion, to the new primary).
:::

:::quiz
**Q3.** Why is redis-shake 4.x a poor forever-DR pipe?
---
No **checkpoint/resume** (restart = full resync) and it assumes a **static** cluster topology (failover/scale/slot moves can panic). Designed for migration cutovers, not long-term continuous sync.
:::

:::quiz
**Q4.** Name two Global Datastore limits that push you toward redis-shake.
---
Examples: **same AWS account only**; ElastiCache↔ElastiCache node-based clusters with matching shape; max **two** secondary Regions; no cross-cloud. Cross-account, self-hosted, or filtered/transformed copies usually need redis-shake (or similar).
:::

---

## Memo

—
