---
title: 'Cassandra & Scylla — Part 1: Cassandra Basics'
---

## References

- [Cassandra & Scylla DB series — Part 1 (quokkalover)](https://etloveguitar.tistory.com/m/161)

---

## Why I looked this up

We're standing up Scylla at work and I need to get oriented. I read this post lightly to refresh the background before diving into hands-on work.

---

## What stood out

A light read — mostly background organization before the real work starts.

---

## What I learned

### Key takeaways

1. **ScyllaDB is a C++ rewrite of Cassandra** — CQL-compatible, same commands and APIs, marketed as ~5× faster with ~1/10 the cluster size for equivalent throughput, and no JVM GC stop-the-world pauses.
2. **Cassandra is masterless** — nodes are peers; gossip handles cluster state, failure detection, and rebalancing. No single point of failure; scale-out is linear.
3. **Data lands on nodes via consistent hashing** — partition key hash → token → ring position. Virtual nodes (`num_tokens`) spread ownership evenly and make add/remove cheaper than manual `initial_token` assignment.

### Scylla in one glance

| Claim | Detail |
|-------|--------|
| Compatibility | Drop-in Cassandra replacement; same CQL and tooling |
| Performance | Lower latency, higher throughput vs JVM Cassandra |
| Footprint | Smaller cluster for the same load |
| Runtime | C++ — no GC pauses |

The author's series plan: (1) Cassandra basics ← this post, (2) Discord's Cassandra → Scylla migration, (3) why Scylla is fast, (4) optional deep dives (consistent hashing, etc.).

### Cassandra architecture

| Topic | My understanding |
|-------|------------------|
| Topology | Masterless ring; all nodes read/write |
| Coordination | Gossip protocol (P2P), not master–slave |
| Scaling | Add a node → it participates immediately; performance scales roughly linearly |
| Failure handling | Missed gossip → node marked down; replicas + hinted handoff cover gaps |
| Write path | Commit log → memtable → SSTable (on-disk, immutable) |

### Data model

- Hierarchy: **Keyspace → Table → Row → Column** (similar to RDBMS DB/Table/Row/Column).
- **Wide-column store** — rows in the same table can have different columns; not the same as columnar analytics stores.
- **Partition key** decides which node holds the row; composite keys like `(channel_id, bucket)` group related rows (Discord message pattern in the post).

### Distribution & virtual nodes

1. Hash the partition key → token on the ring.
2. Each physical node owns one or more **token ranges** via **virtual nodes** (`num_tokens` in `cassandra.yaml`).
3. **Replication factor** copies each range to additional nodes (e.g. RF=3 → three nodes hold replicas).
4. Vnodes spread load evenly and speed up rebalance when nodes join or leave — replaces the old manual `initial_token` workflow.

### Read / write quirks

- **DELETE** writes a tombstone; compaction/GC removes data later — not immediate.
- **UPDATE** is implemented as delete + insert (SSTables are immutable), similar in spirit to Elasticsearch.

### Use cases called out

| Pattern | Why Cassandra fits |
|---------|-------------------|
| Time series / messaging | Partition by entity ID + time bucket; clustering key for sort order |
| E-commerce catalogs, recommendations | Write-heavy, entity-centric, multi-region replication — **not** for ACID transactions like payments |

### Example schema (from the post)

```sql
CREATE TABLE messages (
   channel_id bigint,
   bucket int,
   message_id bigint,
   author_id bigint,
   content text,
   PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

`(channel_id, bucket)` is the partition key; `message_id` orders rows within the partition.

---

## Memo

Background read ahead of Scylla work at the office. Follow-ups are in Next Research.
