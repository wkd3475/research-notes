---
title: 'Scylla Partition Key Internals (Token Ring, Replication, Shard Routing)'
---

## References

- [Schema — partition & clustering keys](https://docs.scylladb.com/stable/get-started/query-data/schema.html)
- [Ring architecture / tokens](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)
- [Data distribution with tablets](https://docs.scylladb.com/manual/stable/architecture/tablets.html)
- [Making a Shard-Aware Python Driver, Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)
- [Why ScyllaDB's Shard Per Core Architecture Matters](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)
- [Consistency Levels (CQL)](https://docs.scylladb.com/manual/stable/cql/consistency.html)
- [SELECT — TOKEN() on partition key](https://docs.scylladb.com/manual/stable/cql/dml/select.html)
- [Cassandra & Scylla intro note](/research-notes/en/notes/cassandra-scylla-intro/) — consistent hashing primer
- [Shard-per-core note](/research-notes/en/notes/scylla-shard-per-core/) — core shard vs tablet, hot partition
- [Client best practices note](/research-notes/en/notes/scylla-client-best-practices/) — why PK must be bound for drivers

---

## Why I looked this up

- **Trigger:** While reading [client best practices](/research-notes/en/notes/scylla-client-best-practices/) and [shard-per-core](/research-notes/en/notes/scylla-shard-per-core/), partition key routing only appeared as a one-line pipeline (`PK → Murmur3 → token → node → shard`). I wanted the **full internal path** — hashing, ring placement, replicas, coordinator, and per-node shard assignment.
- **Scope:** Split into this dedicated note rather than padding the client or shard-per-core articles.

---

## What stood out

The same partition key always lands on the same token, replica set, and (on a given node layout) the same CPU shard — which is why hot keys are a **modeling** problem, not something you fix by adding cores alone.

---

## What I learned

*Background: senior engineer walks through the full partition-key routing pipeline, building on intro, shard-per-core, and client notes.*

---

### Act 1 — Partition key in CQL (vs clustering key)

:::chat student AI Student
What exactly is a partition key in the schema — and how is it different from a clustering key?
:::

:::chat teacher Teacher
[Schema docs](https://docs.scylladb.com/stable/get-started/query-data/schema.html): the **primary key** has two parts:

| Part | Role | Example |
|------|------|---------|
| **Partition key** | Decides **which node(s)** hold the row group | `user_id` alone, or `(channel_id, bucket)` |
| **Clustering key** (optional) | Sorts **rows inside** one partition | `message_id`, `created_at` |

```sql
-- Simple PK: user_id is the whole partition key
CREATE TABLE users (
  user_id uuid PRIMARY KEY,
  name text
);

-- Composite PK: order_id = partition key, product_id = clustering key
CREATE TABLE orders (
  order_id uuid,
  product_id uuid,
  qty int,
  PRIMARY KEY (order_id, product_id)
);
```

**Partition** = all rows sharing the same partition key — the unit of distribution **and** the usual unit of a single query (`WHERE` must narrow to partition key columns).

**Clustering key** does **not** change which node owns the data; it only orders rows within that partition.
:::

:::chat student AI Student
Can I query without the full partition key?
:::

:::chat teacher Teacher
Production queries should include the **partition key** (all PK columns for composite keys). Without it you get partition scans — the cluster walks many nodes.

`ALLOW FILTERING` or filtering on non-PK columns without a PK predicate is an anti-pattern ([client note](/research-notes/en/notes/scylla-client-best-practices/)). `TOKEN()` queries exist for token-range scans but are ops/debug tools, not app hot paths ([SELECT docs](https://docs.scylladb.com/manual/stable/cql/dml/select.html)).
:::

---

### Act 2 — Murmur3: partition key → token

:::chat student AI Student
How does the partition key become a token?
:::

:::chat teacher Teacher
ScyllaDB defaults to the **Murmur3** partitioner ([ring architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)):

1. Take **partition key column value(s)** — for composite keys, the partitioner hashes the **combined** PK components (same rule Cassandra uses).
2. Run **MurmurHash3** → a **64-bit signed integer token** (range roughly \(-2^{63}\) … \(2^{63}-1\); `nodetool ring` shows negative tokens).
3. That token is the partition's address on the ring.

```
PK value(s)  →  Murmur3Partitioner  →  token  →  ring position
```

**Why drivers require PK bind:** the client must hash the **same** bytes the server would. If the PK is a literal baked into the SQL string, the driver cannot compute token/shard at prepare time ([Part 1 driver blog](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/) — "routing key = partition key").

**Composite example:** `PRIMARY KEY ((channel_id, time_bucket), message_id)` — token comes from **`(channel_id, time_bucket)` only**; `message_id` is clustering and does not affect ring placement.
:::

---

### Act 3 — Token ring & virtual nodes (vnodes)

:::chat student AI Student
The token lands on a ring — how does that pick a node?
:::

:::chat teacher Teacher
Cluster = **token ring**; each node owns **ranges** of tokens ([ring architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)):

| Concept | Meaning |
|---------|---------|
| **Token** | Numeric position on the ring; identifies a partition |
| **Token range** | Contiguous arc of the ring one owner serves |
| **Vnode** | A **slice** of the ring assigned to one physical node |

Scylla uses **vnodes only** (`num_tokens` in `scylla.yaml`, default **256** per node). One physical node holds **many non-contiguous** vnode ranges → better balance when nodes join/leave than old one-token-per-node.

```
        token ring (Murmur3 space)
   ...───[node A vnode]───[node B vnode]───[node C vnode]───...
              ↑
         your PK's token falls here → node B is primary owner for that range
```

**Walk the ring:** for a token, find the **first** vnode range whose end token is ≥ your token (wrapping around the ring). That vnode's physical node is the **primary replica** for the partition.

**Inspect:** `nodetool ring`, `nodetool describering <keyspace>`, `nodetool describecluster` (shows `Murmur3Partitioner`).
:::

---

### Act 4 — Replication: RF and replica set

:::chat student AI Student
RF=3 means three copies — which three nodes?
:::

:::chat teacher Teacher
**Replication factor (RF)** = how many replicas store each partition ([intro note](/research-notes/en/notes/cassandra-scylla-intro/), ring docs).

Set at **keyspace** creation:

```sql
CREATE KEYSPACE my_ks
  WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 3
  };
```

| Piece | Role |
|-------|------|
| **Replication strategy** | `NetworkTopologyStrategy` (multi-DC) or `SimpleStrategy` (single DC lab) |
| **RF per DC** | e.g. `datacenter1: 3` → three replicas **in that DC** |
| **Snitch** | Tells the strategy **which racks/DCs** nodes live in — drives replica **placement** |

For a partition token, the strategy walks the ring and picks **RF distinct nodes** (rack-aware when configured). That set is the **replica set** for the partition.

**RF=2 example** (from ring docs): each node holds one range from its predecessor **and** one from its successor on the ring — so losing one node still leaves another copy.

**Multi-DC:** replicas are chosen **per DC** per strategy settings — why production uses **`LOCAL_*`** CL ([client note](/research-notes/en/notes/scylla-client-best-practices/)) instead of cross-DC `QUORUM` on every query.
:::

---

### Act 5 — Coordinator & read/write path

:::chat student AI Student
Once we know the replica set, what does the coordinator do?
:::

:::chat teacher Teacher
Any cluster node **can** coordinate. Path ([Part 1 driver blog](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)):

```
Client
  → picks contact node (or token-aware: a replica)
  → coordinator computes token / looks up replica set
  → sends mutations or reads to replicas per CL
  → aggregates response → client
```

| Role | Behavior |
|------|----------|
| **Coordinator** | Node that receives the client request first |
| **Replica** | Node that actually holds the partition data |
| **Token-aware driver** | Picks a **replica** as coordinator → saves one internal hop |
| **Non-token-aware** | Random node coordinates → forwards to replicas (extra latency) |

**Write (simplified, LOCAL_QUORUM, RF=3):** coordinator sends write to **local DC replicas** until quorum acks.

**Read (LOCAL_QUORUM):** coordinator queries enough local replicas for quorum consistency; may trigger **read repair** on digest mismatch ([shard-per-core note](/research-notes/en/notes/scylla-shard-per-core/) — anti-entropy).

**CL** decides **how many** replicas must respond — not **which** token owns the row ([CL reference](https://docs.scylladb.com/manual/stable/cql/consistency.html)).
:::

---

### Act 6 — Inside the node: token → CPU shard

:::chat student AI Student
After the token reaches the right node, how does Scylla pick the CPU shard?
:::

:::chat teacher Teacher
Scylla goes **one level deeper** than Cassandra ([Part 1 blog](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/), [shard-per-core blog](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)):

```
token on node  →  subdivide node's token space  →  exactly one CPU shard
```

Algorithm (blog):

1. Cut the node's full token range into **2^n** equal pieces (`n` default **12**).
2. Subdivide each piece into **S** sub-pieces where **S = shard count** (`--smp`).
3. Token falls in one sub-piece → that **shard** (dedicated core + memtable + SSTables) owns the partition.

| Path | What happens |
|------|----------------|
| **Shard-aware driver** | Client hashes PK → knows **node + shard_id** → sends on direct shard connection |
| **Token-aware only** | Right node, but coordinator/driver may **cross-shard forward** inside the node |
| **Neither** | Wrong node + cross-shard — worst case |

**Hot partition consequence:** one PK → one token → **one shard on each replica node**. Adding cores redistributes **other** keys' ranges (resharding/tablet moves) but **does not split** an existing hot PK ([shard-per-core note](/research-notes/en/notes/scylla-shard-per-core/) — fix with `time_bucket`, salt, etc.).
:::

---

### Act 7 — Tablets (6.0+): partition → tablet → replicas

:::chat student AI Student
Where do tablets fit — is it another layer on top of vnodes?
:::

:::chat teacher Teacher
**Tablets** are Scylla's newer data-distribution unit ([tablets docs](https://docs.scylladb.com/manual/stable/architecture/tablets.html)) — enabled by default on new keyspaces:

| Layer | Legacy (vnodes) | Tablets (6.0+) |
|-------|-----------------|----------------|
| Mapping | Partition → token → vnode → node | Partition → **tablet** (deterministic) → replicas on nodes |
| Split/merge | Node add/remove moves vnode ranges | Tablet **split/merge** (~5 GB target); load balancer migrates tablets across nodes **and shards** |
| Scale-out cleanup | Manual `nodetool cleanup` on vnode KS | Automatic per-tablet; lighter |

Conceptual stack with tablets:

```
partition key  →  Murmur3 token  →  tablet ID  →  replica nodes  →  shard on each node
```

Tablets add **finer, autonomous rebalancing** — but the **partition key still determines which tablet** holds the row, and **one hot PK still maps to one tablet** (then one shard per replica). Modeling rules unchanged.

**Ops commands** still speak in tokens (`nodetool ring`) for vnode keyspaces; tablet keyspaces use tablet migration under the hood. Know which mode your keyspace uses: `tablets = {'enabled': true|false}` at `CREATE KEYSPACE` (cannot `ALTER` later).
:::

---

### Act 7 supplement — Hot partition & giant partition

:::chat gon Gon
What's a hot partition?
:::

:::chat teacher Teacher
A **hot partition** is when reads/writes for **one partition key** spike far above the rest of the cluster.

Because routing is fixed:

```
same PK  →  same token  →  same replica set  →  same CPU shard on each replica
```

| Symptom | Why |
|---------|-----|
| One node / **one core** pegged | That PK always lands on **one shard** |
| Adding `--smp` cores doesn't help | Only **other** keys' ranges move — not this PK |
| p99 latency spikes | QPS piles onto a single core |

**Hot ≠ giant:** hot = **traffic** skew (QPS). Giant = **data volume** (GB / row count) on one PK. They can overlap but are different problems.

**Fix = modeling**, not hardware: `time_bucket` in the PK ([use-case note](/research-notes/en/notes/scylla-use-cases/) — Discord), salt keys, split access patterns so load spreads across **many** partitions/tokens.
:::

:::chat gon Gon
What if a partition grows so large it exceeds one shard's size?
:::

:::chat teacher Teacher
First, separate three names ([shard-per-core note](/research-notes/en/notes/scylla-shard-per-core/)):

| Term | What it is |
|------|------------|
| **CQL partition** | All rows sharing one PK — can grow **unbounded** if the schema allows it |
| **Core shard** | Token **range** on one CPU core — ops don't size it in GB |
| **Tablet** (~5 GB target) | Table split unit for rebalance — each PK still maps to **one** tablet deterministically |

**There is no spillover:** one PK → one token → **one shard per replica**. Data does **not** auto-split across shards when the partition gets huge.

What actually happens:

| Effect | Detail |
|--------|--------|
| **Single-shard bottleneck** | All reads/writes for that PK stay on one core |
| **Heavy reads** | Unpaged reads load the **whole partition** — memory & network pain ([client note](/research-notes/en/notes/scylla-client-best-practices/)) |
| **Compaction / repair cost** | One giant blob slows background work on that shard |
| **Monitoring alerts** | `system.large_partitions`, `system.large_rows`; `nodetool tablestats` |

Tablet **split/merge** rebalances **tablets** across nodes/shards — it does **not** break one logical PK across multiple shards. A fat PK still fattens **one** tablet → **one** shard.

**Prevention (same as hot keys):**

- Bucket the PK: `(user_id, daily_bucket)`, `(channel_id, time_bucket)`
- Don't append forever into **collections** — use clustering rows ([use-case supplement](/research-notes/en/notes/scylla-use-cases/))
- Always **page** large reads
- Watch large-partition metrics before prod traffic hits
:::

---

### End-to-end pipeline (cheat sheet)

```
CQL row
  PRIMARY KEY: (partition key cols) + optional clustering cols
       ↓
  Murmur3Partitioner(partition key values) → 64-bit token
       ↓
  Ring / tablet map → primary owner + replica set (RF, strategy, snitch)
       ↓
  Coordinator (ideally a replica via token-aware driver)
       ↓
  On each replica node: token → CPU shard (2^n × S subdivision)
       ↓
  memtable / SSTable on that shard
```

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** For `PRIMARY KEY ((channel_id, time_bucket), message_id)`, which columns determine the Murmur3 token?
---
Only **`(channel_id, time_bucket)`** — the partition key. **`message_id`** is clustering; it sorts rows inside the partition but does not change ring placement.
:::

:::quiz
**Q2.** RF=3 with NetworkTopologyStrategy `datacenter1: 3` — what does the replica set mean for a read with LOCAL_QUORUM?
---
Three replicas exist **in datacenter1** for that partition's token. **LOCAL_QUORUM** requires a majority of **those local** replicas (2 of 3) — not cross-DC nodes.
:::

:::quiz
**Q3.** Why does the same partition key always hit the same CPU shard?
---
PK → deterministic Murmur3 token → deterministic position in the node's subdivided token space (2^n pieces × S shards) → **one** shard owns that token range. The mapping is stable until topology/resharding changes.
:::

:::quiz
**Q4.** What do vnodes (`num_tokens` default 256) change compared to one token per physical node?
---
Each physical node owns **many smaller non-contiguous** ring ranges → more even data/query spread and **faster rebalance** when nodes join or leave (streaming/repair from more sources).
:::

:::quiz
**Q5.** Token-aware vs shard-aware driver — what extra hop does token-aware-only still pay?
---
**Token-aware** reaches the correct **node** (replica as coordinator). Without **shard-aware**, the request may still **forward across CPU shards** inside the node. Shard-aware opens a **per-shard connection** and sends directly to the owning core.
:::

:::quiz
**Q6.** Hot partition: why doesn't doubling `--smp` cores fix a single hot PK?
---
That PK still hashes to **one token** → **one tablet/vnode slice** → **one shard per replica**. More cores redistribute **other** partitions; the hot key stays on one core until you **change the model** (bucket, salt, split access patterns).
:::

## Memo

Full PK routing pipeline — split from client and shard-per-core one-liners. Next: **nodetool repair** ops.
