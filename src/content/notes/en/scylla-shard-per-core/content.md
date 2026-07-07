---
title: 'Scylla — Shard-per-Core, Routing & Node Ops'
---

> Sources:
> - [ScyllaDB Shard-per-Core Architecture (official)](https://www.scylladb.com/product/technology/shard-per-core-architecture/)
> - [Why ScyllaDB's Shard Per Core Architecture Matters (blog)](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)
> - [ScyllaDB docs — tablets, repair, rebuild, RBNO](https://docs.scylladb.com/manual/stable/)

Continued from the [Cassandra & Scylla intro note](/research-notes/en/notes/cassandra-scylla-intro/). The quokkalover series part 3 (“why Scylla is fast”) was never published; these official pages filled that gap.

---

## Why I looked this up

- **Context:** Standing up Scylla at work; the intro note covered Cassandra basics but not internals.
- **Read:** The two shard-per-core pages above.
- **Questions that came up while studying:** How is shard “size” decided? Can shards be split or merged? What is an SSTable? What does resharding mean? How does a request find the right core? When nodes are added, how do repair and rebuild differ, and what other ops matter?

---

## What stood out

Mostly a Q&A-style deep dive rather than a single linear article — each question opened another layer (SSTable → compaction → resharding → routing → node ops).

---

## What I learned

### Shard-per-core — four-line summary

1. Scylla shards at the **CPU core** level, not just the node — Cassandra typically stops at the server.
2. Each shard owns dedicated CPU, memory, network, and storage (cache, memtable, SSTables) in a shared-nothing layout.
3. Built on **Seastar** — one thread per core, message passing instead of locks and thread-pool contention.
4. Performance scales roughly linearly with core count; many workloads need fewer nodes than Cassandra (e.g. Discord).

### Two different “shards”

| | **Core shard** (execution) | **Tablet** (data unit, 6.0+) |
|---|---|---|
| What | One unit per CPU core | Table split into ~5 GB chunks |
| Count | `--smp` = cores used | Keyspace/table options + auto tuning |
| Size | Not set in GB by ops | Target size; auto split/merge |
| Split/merge | Not done manually | System does it |

### Questions I had — shard size, split, merge

**“How is shard size decided?”**  
Core shard capacity is **not** something you configure in GB. Partition key → Murmur3 hash → **token** → token ring is divided across nodes, then across cores. Data accumulates inside each shard’s token range.

With **tablets** (default in newer Scylla): tables are split into tablets (~5 GB target). A load balancer moves tablets across nodes and shards. Tablet count comes from options like `expected_data_size_in_gb`, `min_per_shard_tablet_count`, and actual data volume.

**“Can I split or merge shards?”**  
- **Core shards:** No manual split/merge. More cores (`--smp`) → **resharding** on restart (heavy). With tablets enabled, **reducing** shard count after restart is not supported.
- **Tablets:** Auto **split** when too large, **merge** when too small. Scale-out (add nodes) is usually safer than scale-up (add cores).

**Hot partition:** Routing always lands on **one** shard for a given partition key. Adding cores does not fix a hot key — fix the **data model** (buckets, salt, etc.).

### SSTable, compaction, resharding

**SSTable** (Sorted Strings Table): immutable on-disk data files.

```
write → commit log → memtable → SSTable (flush)
```

- UPDATE = delete marker + new write (files are not modified in place).
- **Compaction:** merge SSTables **within the same shard**; drop tombstones; routine background work.
- **Resharding:** when **core count changes**, all SSTables are read and rewritten into the new per-shard layout — like compaction but across shard boundaries. Expensive; plan `--smp` up front; prefer **scale-out** when possible.

### How requests find the right core

```
partition key → Murmur3 → token → node (ring) → shard on that node
```

On the node, the token range is subdivided among shards (Scylla blog: range cut into 2^n pieces, n default 12, then S pieces per shard count).

| Path | Behavior |
|------|----------|
| **Shard-aware driver** | Client computes token → sends to the right node **and** shard connection. **Prepared statements** required. |
| **Non-shard-aware** | Random/coordinator node → may forward across network and **cross-shard** inside the node. |

Use **TokenAwarePolicy** + Scylla shard-aware driver + prepared statements in production.

### Nodes added → redistribution

Yes: adding or removing nodes changes token ownership. Data moves between nodes via **bootstrap**, **decommission**, **replace**, etc.

Modern Scylla (5.4+) uses **RBNO (Repair-Based Node Operations)** by default — node ops use the same row-level repair mechanism as `nodetool repair`, not legacy streaming alone. Benefits: resumable, reads all replicas for consistency, less need for repair before/after replace/removenode.

### Repair vs rebuild

| | **repair** | **rebuild** |
|---|-----------|-------------|
| **Purpose** | Sync replicas that have drifted | Fill an empty node or **new datacenter** |
| **When** | Regular schedule (e.g. weekly, before `gc_grace_seconds`) | After adding a DC — `nodetool rebuild <source-dc>` |
| **Analogy** | Reconcile multiple copies of the same textbook | Copy the full textbook to a new student |

- **bootstrap:** new node in same DC — receives its token ranges on start (similar spirit to rebuild).
- **rebuild:** vnode keyspaces only; for **tablet** keyspaces use `nodetool cluster repair` instead.

### Anti-entropy (three layers)

1. **Hinted handoff** — short node outage; coordinator stores hints and replays (default max window ~3 h). Not a substitute for repair.
2. **Read repair** — on read, digest mismatch triggers background (sometimes foreground) sync.
3. **repair** — scheduled row-level checksum sync across replicas.

### Other ops worth knowing

| Operation | When |
|-----------|------|
| `bootstrap` | New node joins (scale-out) |
| `decommission` | Graceful node removal |
| `removenode` | Node permanently dead (last resort) |
| `replace` | Swap dead hardware, same token slot |
| `rebuild` | New DC needs data from existing DC |
| `cleanup` | After scale-out on **vnode** keyspaces — drop replicas no longer owned; **not needed with tablets** |
| `drain` | Before restart/upgrade |
| `snapshot` | Backup |
| `nodetool tasks list` | Track RBNO / long jobs |

**Scale-out cheat sheet:** add node → wait UN → (vnode) cleanup on old nodes. **Scale-down:** `decommission`. **Dead node:** `replace` or `removenode`.

---

## Memo

Captured the shard-per-core read plus follow-up questions on SSTable, routing, and ops. Next: **when Scylla fits** and **client best practices**.
