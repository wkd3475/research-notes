---
title: 'When Scylla Is the Right Fit (Use Cases)'
---

## References

- [When ScyllaDB is Overkill vs. DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/)
- [ScyllaDB Architecture (official)](https://www.scylladb.com/product/technology/)
- [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Real-Time Write Heavy Database Workloads](https://www.scylladb.com/2025/02/04/real-time-write-heavy-workloads-considerations-tips/)
- [Real-Time ML with ScyllaDB as a Feature Store](https://www.scylladb.com/2025/07/15/real-time-feature-store/)
- [NoSQL Data Modeling Mistakes that Hurt Performance](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)
- [You Got OLAP in My OLTP](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)
- [Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)
- [Time-Based Anti-Patterns for Caching Time-Series Data](https://www.scylladb.com/2019/09/05/time-based-anti-patterns-for-caching-time-series-data/)
- [DynamoDB: When to Migrate](https://www.scylladb.com/2023/12/04/dynamodb-when-to-move-out/)
- [ScyllaDB Getting Started](https://docs.scylladb.com/manual/stable/getting-started/)

---

## Why I looked this up

- **Trigger:** Follow-up from the [Discord Superdisk note](/research-notes/en/notes/discord-superdisk/) — before adopting Scylla at work, I want to separate workloads that fit from those to avoid.
- **Context:** We've been building out the Cassandra/Scylla track (internals, Operator ops, hybrid storage). This note is the decision layer: *when is Scylla worth it?*
- **Questions:** What throughput/latency/modeling signals say "yes"? What says "overkill" or "wrong tool"?

---

## What stood out

The fit question isn't just "is Scylla fast?" — minimum cluster size, storage assumptions, and access patterns matter as much as raw OPS.

---

## What I learned

*Background: a senior engineer explains when Scylla fits, building on the Discord Superdisk note and prior Scylla internals/ops notes.*

---

### Act 1 — What Scylla assumes

:::chat student AI Student
Before listing use cases — what workload does Scylla *assume* by design?
:::

:::chat teacher Teacher
Three baked-in assumptions from [architecture docs](https://www.scylladb.com/product/technology/) and the [Overkill vs DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/) article:

| Assumption | Implication |
|------------|-------------|
| **Local SSD storage** | High concurrency, low read latency — most data should be **frequently queried** |
| **Minimum viable cluster** | Even low traffic needs **≥3 nodes** (HA + quorum reads if one node is down) |
| **Wide-column, partition-key model** | Queries narrow by **partition key**; no JOINs; design queries first, schema second |

Scylla's sweet spot is **throughput-heavy + predictable ultra-low latency**. Not "any NoSQL at any scale."
:::

:::chat student AI Student
Is there a rough OPS floor before Scylla is overkill?
:::

:::chat teacher Teacher
Rule of thumb from Scylla's cost calculator framing: **under ~10K OPS**, if you're fine with DynamoDB latency, don't expect much growth, and you're staying on AWS — Scylla is **probably overkill**.

Above that, it depends on read/write ratio and **how much data is hot vs cold**. Storage-bound workloads (huge TB, few OPS) can make Scylla **more expensive** than DynamoDB even when it technically works.
:::

---

### Act 2 — Good fits

:::chat student AI Student
What workloads does Scylla explicitly shine in?
:::

:::chat teacher Teacher
**1. High-throughput OLTP on partition keys**

- Messaging (Discord), user profiles, session state, carts, real-time bidding
- Needs: **50K+ OPS**, single-digit ms P99, more writes than reads in many cases ([write-heavy article](https://www.scylladb.com/2025/02/04/real-time-write-heavy-workloads-considerations-tips/))

**2. Time-series / IoT append-only writes**

- Sensors, metrics, logs — small frequent writes, time-bucketed partitions
- TWCS compaction; query with **open time ranges** for cache efficiency ([time-series anti-pattern](https://www.scylladb.com/2019/09/05/time-based-anti-patterns-for-caching-time-series-data/))

**3. Online feature stores (ML inference)**

- Point lookups by entity ID, constant user-triggered reads, P99 latency critical ([feature store article](https://www.scylladb.com/2025/07/15/real-time-feature-store/))
- Offline training store can be S3/warehouse — Scylla fits the **online** side

**4. Cassandra / DynamoDB escape hatches**

- CQL-compatible drop-in from Cassandra
- **Alternator** API for DynamoDB-shaped apps — especially when throttling, tail latency, 400KB item limit, or multi-cloud lock-in hurt ([DynamoDB: When to Migrate](https://www.scylladb.com/2023/12/04/dynamodb-when-to-move-out/))
:::

:::chat student AI Student
Write-heavy specifically — any extra caveats?
:::

:::chat teacher Teacher
LSM (memtable → SSTable flush) suits append-heavy writes. But:

| Do | Don't |
|----|-------|
| **STCS / TWCS / ICS** compaction for write-heavy | **Leveled compaction** — up to **40× write amplification** |
| Batch **by partition key**, small **unlogged** batches | Large cross-partition logged batches |
| Tune compression for **write speed** (chunk size: smaller = better writes) | Ignore disk growth under sustained ingest |

Examples in the wild: IoT (Tractian), gaming spikes, ad-tech bidding, stock tick feeds.
:::

---

### Act 3 — When to avoid or rethink

:::chat student AI Student
When is Scylla the *wrong* choice or overkill?
:::

:::chat teacher Teacher
**Cost / scale mismatch**

- **&lt;10K OPS**, stable, DynamoDB SLA OK → managed DynamoDB is simpler
- **Storage-bound**: 100s of TB, rarely read → paying for SSD clusters you don't exercise
- Fix: tier hot data on Scylla, cold on object store / analytics DB

**Model / query mismatch**

- JOINs, ad-hoc analytics, full-table scans as primary path → row-store or columnar OLAP
- OLAP on the **same** cluster as OLTP → P99 latency collapses when analytics starts ([OLAP in OLTP](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)); isolate (separate DC/cluster), off-peak windows, or **Workload Prioritization**

**Data modeling anti-patterns** ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/))

| Anti-pattern | Why it breaks |
|--------------|---------------|
| Hot / large partitions | One channel, one key — unbounded concurrency, shard overload |
| Low-cardinality MVs (boolean, country) | 2–195 giant partitions |
| Growing **collections** (append to maps/lists) | O(n) merge per write |
| Delete-heavy without partition deletes | Tombstone runs — reads scan millions of markers |
| **LatencyAware** LB policy | Oscillating hotspots — use **TokenAware** instead ([best practices](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)) |

**Ecosystem lock-in the other way**

- Thousands of Lambdas + DynamoDB + AWS-only features (TransactWrite, throughput billing to customers) → migration cost can exceed DB savings
:::

:::chat student AI Student
Our workload: what's OPS, read/write ratio, total data — does it clear the 10K bar? Is it storage-bound?
:::

:::chat teacher Teacher
Fill this in with **your** numbers before committing:

| Question | Fit signal | Misfit signal |
|----------|------------|---------------|
| Sustained OPS? | ≥10K (often 50K+ for write-heavy) | &lt;10K flat |
| Read:write? | Either works if modeled right | Write-heavy + LCS compaction |
| Hot data %? | Most rows queried regularly | Archive-heavy on SSD tier |
| Query shape? | PK + clustering key | Scans, aggregations, JOINs |
| Growth? | Throughput will grow into cluster | Data grows, OPS doesn't |

Scylla's calculator uses **min 10K OPS / 1TB** as a hint — below that, explore DynamoDB or smaller managed options first.
:::

---

### Act 4 — Discord as a reference use case

:::chat student AI Student
How does Discord map to "good fit" — without re-explaining Superdisk RAID?
:::

:::chat teacher Teacher
[Discord's migration post](https://discord.com/blog/how-discord-stores-trillions-of-messages) is the canonical **messaging at trillion-row scale** case. Superdisk details are in the [prior note](/research-notes/en/notes/discord-superdisk/) — here, the *fit* lessons:

**Workload:** messages partitioned by `(channel_id, time_bucket)`; read-heavy history fetches; write on every message; hot channels = hot partitions.

**Why Cassandra struggled:** JVM GC pauses, compaction backlog, hot-partition quorum latency spread cluster-wide.

**Why Scylla fit:**

- C++ / no GC, shard-per-core isolation
- 177 Cassandra nodes → **72 ScyllaDB nodes**, p99 reads **40–125ms → 15ms**
- CQL-compatible — app/query model largely unchanged

**What Scylla alone didn't fix:** hot partitions still exist. Discord added **Rust data services** — request coalescing + consistent-hash routing by channel — *before* betting the biggest cluster on Scylla.

**Takeaway for us:** Scylla fits **partition-key OLTP at huge scale**, but extreme skew needs an **app-layer shield** and storage tuned for read latency (Superdisk). Database choice ≠ full architecture.
:::

:::chat student AI Student
Do all queries narrow by partition key, or do we need JOINs and ad-hoc analytics?
:::

:::chat teacher Teacher
If JOINs / ad-hoc SQL are core, Scylla is the wrong primary store. If every production path is `WHERE pk = ? [AND clustering range]`, you're in the right family — then validate **hot-key** risk (Discord: one @everyone announcement).

Secondary analytics: separate pipeline (Spark, warehouse, or isolated Scylla DC), not full-table scans on the serving cluster.
:::

---

### Act 5 — Decision cheat sheet

| Dimension | Scylla fit | Reconsider |
|-----------|------------|------------|
| Throughput | 10K–millions OPS | &lt;10K, flat |
| Latency SLA | Single-digit ms P99 required | "Good enough" DynamoDB + occasional spikes OK |
| Data access | Hot, PK lookups | Cold archive, scan-heavy |
| Data model | Wide-column, query-driven | Relational, JOIN-centric |
| Origin | Cassandra/DynamoDB pain (GC, throttle, cost) | Greenfield, low scale |
| Ops appetite | Run 3+ node clusters, model carefully | Want zero-ops table provisioning |
| Multi-workload | OLTP only, or isolated / prioritized | OLAP + OLTP same cluster, uncontrolled |

:::chat student AI Student
What % of data is read often? Can cold tier live outside Scylla?
:::

:::chat teacher Teacher
Scylla assumes **local SSD for data you actually serve**. Overkill article example: 250TB DynamoDB → huge Scylla nodes; if only **10% is hot**, putting that 10% on Scylla and cold tier elsewhere can flip the cost story.

Audit: retention TTL, S3 offload for blobs &gt;16MB (vs DynamoDB 400KB cap), and whether "archive reads" can hit a cheaper store.
:::

:::chat student AI Student
Any Cassandra/DynamoDB features we rely on that Scylla lacks?
:::

:::chat teacher Teacher
From Overkill + DynamoDB migration docs:

| Feature | Scylla gap |
|---------|------------|
| DynamoDB **TransactWrite/Get** multi-item | Not 1:1 — design around it |
| **Throughput accounting/capping** per customer | No built-in throttle billing |
| Deep **AWS-only** integration (1000s of Lambdas) | Refactor cost |
| DynamoDB on-demand **per-table** billing | Scylla = **cluster** provisioning |

If none of these are load-bearing, migration is mostly data model + driver — often one-line endpoint change with Alternator.
:::

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What three design assumptions make Scylla a strong fit — and when do they hurt?
---
**Local SSD**, **≥3-node cluster overhead**, **partition-key wide-column model**. They hurt when data is **cold/archive-heavy**, OPS stay **under ~10K**, or queries need **JOINs/scans/OLAP** on the same cluster.
:::

:::quiz
**Q2.** Rough OPS floor where Scylla is often overkill vs DynamoDB?
---
**Under ~10K OPS** with flat growth, acceptable DynamoDB latency, and no need to leave AWS — per Scylla's own cost framing. Not a hard limit, but a planning hint.
:::

:::quiz
**Q3.** Name two "good fit" workload families and one write-heavy pitfall.
---
**Messaging/user state** and **online feature stores** (PK lookups, low P99). Pitfall: **leveled compaction** on write-heavy workloads (up to 40× write amplification) and **cross-partition batches**.
:::

:::quiz
**Q4.** Why did Discord still build data services if Scylla is faster?
---
**Hot partitions** remain possible. Data services add **request coalescing** and **channel-consistent routing** to cap concurrent DB hits — Scylla removed GC/compaction pain but didn't erase skew.
:::

:::quiz
**Q5.** OLAP and OLTP on one Scylla cluster — what happens and what are the options?
---
Analytics consumes CPU/IO; **OLTP P99 spikes** while the job runs ([monitoring graphs in Scylla blog](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)). Options: **separate cluster/DC**, **off-peak analytics**, or **Workload Prioritization** (service levels with shares).
:::

## Memo

Cassandra/Scylla track — decision note after Superdisk. Next: client best practices (drivers, TokenAware, CL).
