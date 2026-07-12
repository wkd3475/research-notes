---
title: 'Scylla Client Best Practices (Drivers, Data Model, CL)'
---

## References

- [ScyllaDB Drivers (official)](https://www.scylladb.com/product/scylla-drivers/)
- [Making a Shard-Aware Python Driver, Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)
- [Making a Shard-Aware Python Driver, Part 2](https://www.scylladb.com/2020/10/15/making-a-shard-aware-python-driver-for-scylla-part-2/)
- [Connect Faster with a Shard-Aware Port](https://www.scylladb.com/2021/04/27/connect-faster-to-scylla-with-a-shard-aware-port/)
- [Scylla Specific Features (C++ driver)](https://cpp-driver.docs.scylladb.com/master/topics/scylla_specific/)
- [Rust driver — Prepared statements](https://rust-driver.docs.scylladb.com/stable/statements/prepared.html)
- [Rust driver — Statements best practices](https://rust-driver.docs.scylladb.com/stable/statements/statements.html)
- [Production Readiness Guidelines](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/tips/production-readiness.html)
- [Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)
- [Best Practices for Benchmarking ScyllaDB](https://www.scylladb.com/2021/03/04/best-practices-for-benchmarking-scylla/)
- [Data Modeling (official)](https://docs.scylladb.com/stable/get-started/data-modeling/)
- [Schema — partition & clustering keys](https://docs.scylladb.com/stable/get-started/query-data/schema.html)
- [NoSQL Data Modeling Mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)
- [Consistency Levels (CQL)](https://docs.scylladb.com/manual/stable/cql/consistency.html)
- [CQL Optimization (Monitoring)](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)
- [Python driver — Getting Started](https://python-driver.docs.scylladb.com/3.21.0-scylla/getting_started.html)

---

## Why I looked this up

- **Trigger:** Follow-up from [When Scylla Is the Right Fit](/research-notes/en/notes/scylla-use-cases/) — server architecture alone isn't enough; shard-aware routing and modeling choices look equally important before we deploy at work.
- **Context:** Already covered shard-per-core ([prior note](/research-notes/en/notes/scylla-shard-per-core/)), use-case fit, and Operator ops. This note is the **app ↔ DB** layer.
- **Questions:** Which driver settings matter? How do prepared statements tie to shard routing? What CL and modeling rules are non-negotiable?

---

## What stood out

Scylla's server speed is wasted if the client sends queries to the wrong node, wrong shard, or without a partition key in the WHERE clause.

---

## What I learned

*Background: senior engineer explains client-side best practices, building on shard-per-core and use-case notes.*

---

### Act 1 — Why the client layer matters

:::chat student AI Student
We already learned shard-per-core on the server — what does the *client* add?
:::

:::chat teacher Teacher
The [shard-per-core note](/research-notes/en/notes/scylla-shard-per-core/) ended with: **TokenAwarePolicy + Scylla shard-aware driver + prepared statements**. This note is that checklist in full.

Server-side: partition key → Murmur3 token → node → **CPU shard**.

Client-side job: compute the same routing key and send the query **directly to the replica node and shard connection** — skip the extra coordinator hop and in-node cross-shard forwarding.

| Layer | If right | If wrong |
|-------|----------|----------|
| Token-aware | Hits a replica | Random node → internal forward |
| Shard-aware | Hits the **shard CPU** | Right node, wrong core |
| Prepared + PK bound | Driver knows routing key | PK hardcoded in SQL string → wrong route |

Without all three on hot paths, you pay latency and load even on a perfectly tuned cluster.
:::

:::chat gon Gon
I'm curious how Scylla partition keys actually work internally — Murmur3, token ring, replicas, shard routing. I'd rather read the full path in a separate note than squeeze it here.
:::

:::chat teacher Teacher
Good call — this note stays on **client config**. The full **PK → token → replica set → shard** pipeline is in [Partition Key Internals](/research-notes/en/notes/scylla-partition-key-internals/).
:::

---

### Act 2 — Shard-aware drivers & prepared statements

:::chat student AI Student
What's the difference between Scylla drivers and stock Cassandra drivers?
:::

:::chat teacher Teacher
[ScyllaDB Drivers](https://www.scylladb.com/product/scylla-drivers/) maintain **shard-aware** forks (Java, Go, Python, C++, Rust). They open a **connection pool per shard** on each node — `shard_id → connection` dict ([Part 2](https://www.scylladb.com/2020/10/15/making-a-shard-aware-python-driver-for-scylla-part-2/)).

Flow ([Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)):

1. `session.prepare("SELECT … WHERE pk = ?")`
2. Execute with bound PK → driver hashes → token → replica + **shard_id**
3. Query goes up the **direct shard connection**

**Prepared statements are mandatory** for production ([Rust driver](https://rust-driver.docs.scylladb.com/stable/statements/prepared.html)):

- Parse once on server (not every execute)
- Driver gets metadata for **token/shard-aware** load balancing
- Prepare **once**, store, reuse — re-`prepare()` per request wastes round trips

**Critical rule — PK must be bound:**

```sql
-- WRONG: PK in string → driver can't hash → wrong node/shard
INSERT INTO t (a, b) VALUES (12345, ?)

-- GOOD: all PK columns as ?
INSERT INTO t (a, b) VALUES (?, ?)
```

Non-PK columns can be literals; **partition key columns cannot**.
:::

:::chat student AI Student
Advanced vs basic shard-awareness — what's the shard-aware port?
:::

:::chat teacher Teacher
Two modes ([C++ driver Scylla features](https://cpp-driver.docs.scylladb.com/master/topics/scylla_specific/)):

| Mode | How | Trade-off |
|------|-----|-----------|
| **Basic** | Open connections until every shard is hit (node assigns least-busy shard) | May open **extra** connections then discard |
| **Advanced** | Port **19042** — local (source) port `% shard_count` picks target shard | Fewer connection attempts ([shard-aware port blog](https://www.scylladb.com/2021/04/27/connect-faster-to-scylla-with-a-shard-aware-port/)) |

[Benchmarking guide](https://www.scylladb.com/2021/03/04/best-practices-for-benchmarking-scylla/): Scylla drivers default to **~1 connection per shard per host** (14 shards → 14 conns). **Excess connections hurt p99** — scale throughput with **more client instances**, not huge pools per process.

Production Readiness also says >3 conn/shard *or* more clients for heavy load — tune with monitoring, don't blindly max out.
:::

---

### Act 3 — Load balancing policies

:::chat student AI Student
Which load balancing policy should we use — and avoid?
:::

:::chat teacher Teacher
Recommended stack ([Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)):

```
TokenAwarePolicy(DCAwareRoundRobinPolicy())
```

- **DCAware** — local DC replicas for `LOCAL_*` CL
- **TokenAware** — prefer replica that owns the token

**Do NOT use LatencyAware** — sends more traffic to currently-fast nodes → oscillating hotspots. The use-case note flagged this too.

**Driver docs caveat:** some generic driver pages still mention LatencyAware + TokenAware together — for Scylla, **trust the applications best-practices article** and skip LatencyAware.
:::

---

### Act 4 — Query-first data modeling

:::chat student AI Student
How do we model tables on the client side — what's query-first?
:::

:::chat teacher Teacher
[Official data modeling](https://docs.scylladb.com/stable/get-started/data-modeling/): **design around queries, not entities**.

Workflow:

1. List every production CQL your app will run
2. Each query must include **partition key** in WHERE (or you get cluster scans)
3. Denormalize so one query reads **one partition** ([schema guide](https://docs.scylladb.com/stable/get-started/query-data/schema.html))

| Key part | Role |
|----------|------|
| **Partition key** | Data distribution, hot-key risk |
| **Clustering key** | Row sort *within* partition |

Anti-patterns ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/), [use-case note](/research-notes/en/notes/scylla-use-cases/)):

- Hot / giant partitions — bucket or salt PK (Discord: `time_bucket`)
- `ALLOW FILTERING` / non-PK scans — dashboard tracks these
- Growing **collections** — use clustering rows instead (use-case supplement)
- **Logged cross-partition batches** on write-heavy paths

**Reads:** match `CLUSTERING ORDER BY` — reversed ORDER BY works but costs more ([CQL Optimization](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)).
:::

:::chat student AI Student
What about batches, paging, and timeouts?
:::

:::chat teacher Teacher
From [Rust statements best practices](https://rust-driver.docs.scylladb.com/stable/statements/statements.html):

| Pattern | Rule |
|---------|------|
| **SELECT** | Always **paged** — unpaged large reads overload cluster |
| **INSERT/UPDATE** | Unpaged API OK |
| **Batch** | Partition-key grouped, small, **unlogged** for write-heavy |
| **Batch anti-pattern** | Simple statements with values in batch → driver prepares **sequentially** each time |

**Retry / timeout:** client timeout **shorter than** server → retry storm → hot partition ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)). Set client timeouts **higher** than server-side limits.
:::

---

### Act 5 — Consistency levels (CL)

:::chat student AI Student
What CL should we default to in production?
:::

:::chat teacher Teacher
[Production Readiness](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/tips/production-readiness.html): **`LOCAL_QUORUM`** for reads and writes in production.

[CL reference](https://docs.scylladb.com/manual/stable/cql/consistency.html):

| CL | When |
|----|------|
| **LOCAL_QUORUM** | Default — majority of replicas **in coordinator's DC** |
| **LOCAL_ONE** | Lower read latency, accepts staleness |
| **QUORUM** (non-local) | Cross-DC quorum — **higher latency** ([monitoring warns](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)) |
| **ONE** | Fastest, weakest consistency |
| **ANY** | Write-only, hinted handoff — **persistency risk** |
| **ALL** | All replicas — **availability risk** if one node down |

With **RF=3** + **LOCAL_QUORUM**: one node down, reads/writes still succeed.

Set per query or via `ExecutionProfile` ([Python driver example](https://python-driver.docs.scylladb.com/3.21.0-scylla/getting_started.html)):

```python
ExecutionProfile(consistency_level=ConsistencyLevel.LOCAL_QUORUM)
```

**Retry policies** like `DowngradingConsistencyRetryPolicy` exist — use deliberately; don't silently weaken CL without understanding data loss windows.

**Multi-DC:** prefer `LOCAL_*` over `QUORUM`/`ONE` to avoid cross-DC traffic on every query.
:::

---

### Act 6 — CQL Optimization dashboard (verify in prod)

:::chat student AI Student
How do we know the client is configured correctly after deploy?
:::

:::chat teacher Teacher
[Scylla Monitoring — CQL Optimization](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html) — gauges should stay **near zero**:

| Panel | Bad signal |
|-------|------------|
| **Non-prepared queries** | Missing prepare on hot path |
| **Non-token-aware** | Wrong driver/LB or PK not bound |
| **Non-paged reads** | Full partition/scan in one reply |
| **Reversed CQL reads** | ORDER BY fights CLUSTERING ORDER BY |
| **ALLOW FILTERING** | Non-PK filter — read amplification |
| **CL = ANY / ALL** | Persistency or availability risk |
| **Cross-DC CL / reads** | Should use LOCAL_* in multi-DC |

Note: low-traffic tests also show driver-internal and system-table queries — judge under **real load**.

[Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications) ships a **CQL optimization dashboard** in newer monitoring stacks — same idea.
:::

---

### Act 7 — Production client checklist

| Check | Pass criteria |
|-------|---------------|
| Driver | Scylla **shard-aware** official driver, not vanilla Cassandra-only |
| Prepare | All hot-path queries prepared; prepare once, reuse |
| PK binding | Partition key columns always `?` bind — never literal in SQL |
| LB policy | `TokenAware(DCAware…)` — **no LatencyAware** |
| Connections | ~1 per shard default; scale via **more app instances** before huge pools |
| Port 19042 | Advanced shard-awareness enabled if driver supports it |
| CL | **LOCAL_QUORUM** default; LOCAL_ONE only where stale OK |
| Modeling | Query-first; PK in every prod query; no ALLOW FILTERING on hot path |
| Reads | Paged; clustering order matches schema |
| Timeouts | Client timeout > server; avoid retry storms |
| Monitor | CQL Optimization gauges low under load |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What three client habits unlock shard-aware routing?
---
**Scylla shard-aware driver** + **prepared statements** + **partition key values as bind parameters** (not literals in the query string).
:::

:::quiz
**Q2.** Why is LatencyAware load balancing discouraged for Scylla?
---
It routes more traffic to currently-low-latency nodes → those nodes slow down → traffic shifts again → **oscillating hotspots**. Use **TokenAware(DCAware…)** instead.
:::

:::quiz
**Q3.** Recommended production CL and why LOCAL_* over QUORUM in multi-DC?
---
**LOCAL_QUORUM** (Production Readiness). **LOCAL_*** confines quorum to the coordinator's DC — **QUORUM** can wait on cross-DC replicas and hurt latency/cost.
:::

:::quiz
**Q4.** Query-first modeling in one sentence — and one anti-pattern?
---
List app queries first, design tables so each query hits a **partition key**; denormalize into one partition per read. Anti-pattern: **ALLOW FILTERING** or queries without PK → cluster scan.
:::

:::quiz
**Q5.** Name two CQL Optimization dashboard panels that should stay near zero.
---
Examples: **non-prepared queries**, **non-token-aware queries**, **non-paged reads**, **ALLOW FILTERING**, **CL ANY/ALL**, **cross-DC reads**.
:::

:::quiz
**Q6.** Client timeout vs server timeout — what goes wrong if client is shorter?
---
Client times out and **retries** while server still processes the first attempt → **retry storm** → hot partition / shard overload.
:::

## Memo

Cassandra/Scylla track — client layer after use-case fit. Next: partition key internals (separate note), then repair ops.
