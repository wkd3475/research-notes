---
title: 'Scylla as a Feature Store — Fit, Pitfalls & Feature Store Basics'
---

## References

- [Real-Time ML with ScyllaDB as a Feature Store (blog)](https://www.scylladb.com/2025/07/15/real-time-feature-store/)
- [Why ScyllaDB as a feature store? (docs)](https://feature-store.scylladb.com/stable/about-feature-stores.html)
- [Feature Store solution page](https://www.scylladb.com/solution/feature-store/)
- [Integrate ScyllaDB and Feast](https://feature-store.scylladb.com/stable/feast-scylladb-online-store.html)
- [When ScyllaDB is Overkill vs. DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/)
- [When Scylla Is the Right Fit (prior note)](/research-notes/en/notes/scylla-use-cases/)
- [Scylla client best practices](/research-notes/en/notes/scylla-client-best-practices/)
- [Partition key internals](/research-notes/en/notes/scylla-partition-key-internals/)
- [What is a Feature Store? (Databricks)](https://www.databricks.com/blog/what-is-a-feature-store)
- [Feast documentation](https://docs.feast.dev/)

---

## Why I looked this up

- **Trigger:** Is **Scylla appropriate as a feature store**? I also want the **feature store concept** explained in the same place — not just a one-line “good fit” from the use-cases note.
- **Context:** [Use-cases note](/research-notes/en/notes/scylla-use-cases/) already lists “online feature stores” under good fits; this note is the **decision layer** for ML infra.
- **Scope:** Separate note — feature store basics first, then where Scylla fits (and where it does not).

---

## What stood out

Before judging Scylla, I needed to see that a “feature store” is usually **three pieces** (offline store + online store + registry), and Scylla only competes for **one** of them.

---

## What I learned

*Background: senior engineer explains feature stores, then whether Scylla fits the **online** tier — building on the use-cases note and client/PK notes.*

---

### Act 1 — What is a feature store?

:::chat gon Gon
Is Scylla appropriate for a feature store? I want the feature store concept explained too.
:::

:::chat teacher Teacher
A **feature** is a measurable input to an ML model — raw or engineered (e.g. “likes in last 10 minutes”, “user age”, “cart total”). A **feature vector** is the set of features for one prediction ([Scylla feature store blog](https://www.scylladb.com/2025/07/15/real-time-feature-store/)).

A **feature store** is a **central system** to create, store, discover, and **serve** features for both **training** and **inference** ([Databricks overview](https://www.databricks.com/blog/what-is-a-feature-store)):

| Problem it solves | How |
|-------------------|-----|
| **Training–serving skew** | Same feature definitions for offline training and online inference |
| **Duplication** | Teams reuse features instead of rebuilding pipelines |
| **Governance** | Metadata, lineage, versioning |
| **Serving abstraction** | One API for batch training sets and real-time lookup |

Important: “feature store” is **not** one database. Typical architecture = **registry** + **offline store** + **online store**.
:::

:::chat student AI Student
What's the difference between offline and online store?
:::

:::chat teacher Teacher
Two workloads, two storage profiles ([feature store blog](https://www.scylladb.com/2025/07/15/real-time-feature-store/)):

| | **Offline store** | **Online store** |
|---|-------------------|------------------|
| **Purpose** | Model **training**, backtests, batch scoring | **Real-time inference** at user request |
| **Data** | Months/years of history per entity | Usually **latest value per entity** only |
| **Latency** | Seconds–hours OK | **Milliseconds** — often p99 &lt;10–15 ms |
| **Volume per query** | Large scans, point-in-time joins | Small **point lookup** by `user_id` / `item_id` |
| **Typical backends** | S3/Parquet, BigQuery, Snowflake, Spark tables | Redis, DynamoDB, Cassandra/**ScyllaDB** |

**Materialization:** batch/stream pipelines compute features → write to **both** stores (or online refreshed from offline). Inference path: app → **online store** → model → prediction.

End-to-end latency budget includes feature fetch + model run — slow online store = lost conversions (checkout recommendations, fraud, ranking).
:::

---

### Act 2 — Frameworks: Feast, Tecton, bundled stores

:::chat student AI Student
Do I need Feast or Tecton — or just Scylla?
:::

:::chat teacher Teacher
**Scylla alone** = database. You still need **feature definitions**, materialization jobs, and serving APIs unless you build them yourself.

Common patterns:

| Option | What it provides | Online DB |
|--------|------------------|-----------|
| **Feast** (open source) | Registry, offline/online abstractions, serving API — **you bring DBs** | Pluggable: Redis, Postgres, Cassandra/**Scylla** ([Feast docs](https://docs.feast.dev/)) |
| **Tecton** (managed) | End-to-end pipelines + transformations + SLAs | Often DynamoDB/Redis (managed) |
| **SageMaker / Vertex / Hopsworks** | Bundled platform | **Locked-in** online store in many setups |

[Scylla blog](https://www.scylladb.com/2025/07/15/real-time-feature-store/) argues for **bring-your-own-database** frameworks (Feast, FeatureForm) so you can swap the online tier if latency or cost spikes — without replatforming the whole feature store.

**Feast + Scylla:** Cassandra-compatible connector (`pip install feast[cassandra]` or `feast[scylladb]`) — `feature_store.yaml` points `online_store` at Scylla nodes ([integration docs](https://feature-store.scylladb.com/stable/feast-scylladb-online-store.html)).
:::

---

### Act 3 — Where Scylla fits in the stack

:::chat student AI Student
So is Scylla a good feature store — yes or no?
:::

:::chat teacher Teacher
**Nuanced answer:**

| Layer | Scylla fit |
|-------|------------|
| **Whole “feature store” product** | **No** — Scylla is not Feast/Tecton; it's storage |
| **Online store (inference tier)** | **Often yes** — when requirements match Scylla's sweet spot |
| **Offline store (training history)** | **Usually no** — warehouses/lakes (Parquet, BigQuery) win on columnar scan & point-in-time joins at PB scale |
| **Bulk training reads from Scylla** | Possible for some pipelines ([Scylla docs — training data](https://feature-store.scylladb.com/stable/)) but not the default architecture |

Scylla's own positioning ([about feature stores](https://feature-store.scylladb.com/stable/about-feature-stores.html)): **low latency serving**, **high throughput**, **large scale**, **HA** — i.e. the **online** tier.

Aligns with [use-cases note](/research-notes/en/notes/scylla-use-cases/): point lookups by entity ID, user-triggered reads, **P99 latency is the product**.
:::

---

### Act 4 — When Scylla is a **good** online feature store

:::chat student AI Student
What signals say "use Scylla for online features"?
:::

:::chat teacher Teacher
**Strong fit** when all or most apply:

| Signal | Why Scylla |
|--------|------------|
| **Strict P99** (single-digit ms, &lt;5–10 ms) | Shard-per-core + SSD; vendor claims &lt;1 ms P99 possible ([Scylla docs](https://feature-store.scylladb.com/stable/about-feature-stores.html)) — validate on *your* schema |
| **High QPS** (100K–millions/sec aggregate) | Throughput-heavy OLTP is core sweet spot |
| **Large online working set** (TB+, not just RAM) | Disk-backed with cache vs pure Redis RAM ceiling |
| **Multi-DC / on-prem / avoid AWS lock-in** | vs DynamoDB-only SageMaker stack |
| **Migrating from Cassandra/DynamoDB** online store | Alternator / CQL compatibility |
| **Entity = partition key** access pattern | `SELECT features WHERE entity_id = ?` — one partition per lookup ([PK internals](/research-notes/en/notes/scylla-partition-key-internals/)) |
| **Feast (or similar) already chosen** | Documented Scylla online store path |

**Reference pattern:** Medium and others use Scylla behind list/feature serving ([Scylla solution page](https://www.scylladb.com/solution/feature-store/)).

**Modeling sketch:**

```sql
-- Feast often maps to entity-keyed wide rows
PRIMARY KEY (entity_id, feature_timestamp)  -- or (entity_id) for latest-only tables
```

Use **TTL** on stale features, **LOCAL_QUORUM**, shard-aware driver + prepared statements ([client note](/research-notes/en/notes/scylla-client-best-practices/)).
:::

---

### Act 5 — When Scylla is **not** appropriate (or overkill)

:::chat student AI Student
When should we *not* use Scylla for feature store?
:::

:::chat teacher Teacher
**Poor fit or overkill:**

| Situation | Better choice |
|-----------|---------------|
| **Only need online store &lt;10K OPS**, small RAM dataset | **Redis** — simpler, sub-ms, but RAM-bound ([Overkill vs DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/) — Scylla min viable cluster is 3 nodes) |
| **Happy with DynamoDB latency**, AWS-only, low growth | DynamoDB (+ optional DAX) — less ops than running Scylla |
| **Entire feature store on one DB** | Wrong tool — offline history belongs in lake/warehouse |
| **Ad-hoc analytics on features** | OLAP warehouse, not Scylla ([use-cases — OLTP vs OLAP](/research-notes/en/notes/scylla-use-cases/)) |
| **Multi-item ACID transactions across entities** | DynamoDB TransactWrite-style needs — Scylla gap ([use-cases](/research-notes/en/notes/scylla-use-cases/)) |
| **Tiny team, no DBA/K8s appetite** | Managed Redis/DynamoDB/Feast+RDS may be faster to ship |
| **Feature vectors need vector ANN at scale** | May need specialized vector index layer — check Scylla vector search scope separately |

**Redis → Scylla migration motive** (forum anecdote in Scylla materials): dataset outgrows RAM / AOF pain, need **disk-backed** low latency — that's the classic online-store upgrade path.

**Cost:** Scylla calculator hints **~10K OPS / 1TB** floor ([Overkill article](/research-notes/en/notes/scylla-use-cases/)) — feature lookup at low QPS may not justify 3-node cluster ops.
:::

---

### Act 6 — Modeling & ops checklist (online tier)

:::chat student AI Student
If we pick Scylla for online features, what do we design for?
:::

:::chat teacher Teacher
| Area | Rule |
|------|------|
| **Access pattern** | One **entity_id** (user_id, item_id) per inference request → **partition key** lookup |
| **Wide vs narrow** | Feature group per table or wide row — avoid giant partitions (unbounded feature history in one PK) |
| **Freshness** | Stream/batch materialization → **upsert** latest; **TTL** for expiry |
| **Hot keys** | Viral entity = hot partition — bucket entity or shard features ([PK supplement](/research-notes/en/notes/scylla-partition-key-internals/)) |
| **Client** | Feast materialization + inference services: prepared, token/shard-aware, LOCAL_QUORUM |
| **Monitoring** | Feature staleness, null rate, latency p99, CQL optimization panels |
| **Offline parity** | Same transformation code in Spark/Flink and materialization job — feature store registry enforces definitions |

**Anti-patterns:** storing full training history in online tables; `ALLOW FILTERING` feature search; cross-partition logged batches on write-heavy materialization.
:::

---

### Act 7 — Decision summary

| Question | Answer |
|----------|--------|
| Is Scylla a **feature store**? | No — it's an **online store backend** (plus possible bulk source for some training flows) |
| Is it **appropriate for feature store use**? | **Yes for online serving** when you need predictable low P99, high QPS, large working set, Feast/BYO-DB architecture |
| Is it **always** appropriate? | **No** — low QPS/small data → Redis/DynamoDB simpler; offline tier → warehouse; whole ML platform → Feast/Tecton + right DB per tier |

```
[Raw events] → [Feature pipelines] → Offline (lake/warehouse)  → training
                                   → Online (Scylla?)         → inference
            [Registry: Feast/Tecton — definitions & materialization]
```

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What three layers make up a typical feature store architecture?
---
**Registry** (definitions/metadata) + **offline store** (historical training data) + **online store** (low-latency latest features for inference). Scylla usually targets **online** only.
:::

:::quiz
**Q2.** Offline vs online store — latency and data shape?
---
**Offline:** large historical scans, latency seconds–hours, point-in-time training joins. **Online:** latest value per entity, **millisecond** lookups, high QPS point reads by entity ID.
:::

:::quiz
**Q3.** Why pair Feast with Scylla instead of using Scylla alone?
---
**Feast** provides feature registry, materialization orchestration, and serving API. **Scylla** is the **pluggable online database** — storage and low-latency retrieval, not feature definitions or skew control by itself.
:::

:::quiz
**Q4.** Two signals that Scylla is a strong online feature store fit?
---
Examples: **strict single-digit P99** at **high QPS**; **TB-scale** online working set needing disk + cache; **entity PK point lookups**; migrating from Cassandra/DynamoDB online tier; multi-DC/on-prem requirements.
:::

:::quiz
**Q5.** When is Scylla overkill for online features?
---
**Low OPS** (&lt;~10K), small dataset fits in **Redis** RAM, satisfied with **DynamoDB** latency on AWS, no need for 3-node cluster ops — per Scylla's own overkill framing ([use-cases note](/research-notes/en/notes/scylla-use-cases/)).
:::

:::quiz
**Q6.** One modeling rule for Scylla online feature tables?
---
**Partition key = entity_id** (or composite entity key); one lookup per inference request; avoid unbounded partition growth — use TTL, bucketing, or keep history in **offline** store only.
:::

## Memo

Feature store basics + Scylla fit for the **online** tier — split from use-cases one-liner. Next: client/PK modeling in prod if we adopt Feast+Scylla.
