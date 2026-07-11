---
title: 'Cassandra & Scylla — Part 2: Cluster Join on Boot'
---

## References

- [ScyllaDB Seed Nodes](https://docs.scylladb.com/manual/stable/kb/seed-nodes.html)
- [Adding a New Node Into an Existing ScyllaDB Cluster](https://docs.scylladb.com/manual/branch-2025.4/operating-scylla/procedures/cluster-management/add-node-to-cluster.html)
- [Configuration Parameters (ScyllaDB)](https://docs.scylladb.com/manual/stable/reference/configuration-parameters.html)
- [ScyllaDB Ring Architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/index.html)
- [Token (ScyllaDB GitHub Wiki)](https://github.com/scylladb/scylladb/wiki/Token)
- [Internode communications (gossip)](https://docs.datastax.com/en/cassandra-oss/3.x/cassandra/architecture/archGossipAbout.html)
- [Adding nodes to an existing cluster (DataStax)](https://docs.datastax.com/en/cassandra-oss/3.x/cassandra/operations/opsAddNodeToCluster.html)
- [Adding, replacing, moving and removing nodes (Apache Cassandra 5.x)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)
- [Nodetool cleanup (ScyllaDB)](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/cleanup.html)
- [Data resurrection without cleanups (ScyllaDB Forum)](https://forum.scylladb.com/t/new-data-resurrection-without-cleanups/862)

---

## Why I looked this up

Follow-up from Part 1. We're standing up Scylla at work and I need to understand how a new node discovers the cluster and gets its tokens when we bring nodes up.

---

## What stood out

Asked for a role-play Q&A walkthrough so the mechanics stick better than a flat summary.

---

## What I learned

*Setting: a kind senior engineer walks a junior through bootstrapping a new node into an existing Scylla/Cassandra cluster.*

---

### Act 1 — The new node wakes up

:::chat student Student
A new machine just finished `scylla.yaml`. I hit `systemctl start scylla-server`. What's the *first* thing it tries to do?
:::

:::chat teacher Teacher
Good start! The very first step is reaching out to a **seed node**. Seeds are just IPs in `seeds` (Cassandra: `seed_provider`). They're **not** leaders, coordinators, or special data holders — only the **first gossip contact point** when a node doesn't yet know the ring.
:::

:::chat student Student
So if every seed is down, we're stuck?
:::

:::chat teacher Teacher
Great question — that's worth worrying about. For a **brand-new joiner**, yes, it may not bootstrap gossip. But for a node **already in the cluster**, it's less scary: by default it remembers peers from previous runs, so it can often rejoin without seeds. Seeds matter most on **first startup**.
:::

:::chat student Student
Can the joining node be its own seed?
:::

:::chat teacher Teacher
Ah, easy mistake — but **no**. The docs are clear: **seed nodes cannot bootstrap.** Put existing healthy nodes in `seeds`; never list the joining node there. And don't make *every* node a seed — that just adds gossip overhead. Rule of thumb: **~2–3 seeds per datacenter**, same list on **all** nodes.
:::

:::chat student Student
Multi-DC — anything special?
:::

:::chat teacher Teacher
For multi-DC, just one extra thing to remember: include **at least one seed per datacenter** (replication group). Otherwise a new node in DC-B might have to cross DC just to discover topology — slower and brittle.
:::

| Seed myth | Reality |
|-----------|---------|
| "Seeds coordinate writes" | No — peers are equal |
| "Seeds are a SPOF" | No — only bootstrap aid |
| "More seeds = safer" | No — small, stable list per DC |

---

### Act 2 — Gossip: learning who's on the ring

:::chat student Student
It reached a seed. Then what?
:::

:::chat teacher Teacher
Nice — it connected! Next up, **Gossip** kicks in. It's a P2P epidemic protocol: every ~1 second each node talks to up to ~3 peers, exchanging state with version numbers so newer info wins. The joiner learns:

- Which IPs are in the cluster
- Who is up/down
- **Every node's tokens** (via `application_state::TOKENS`)
:::

:::chat student Student
So discovery isn't a one-shot RPC — the joiner keeps gossiping?
:::

:::chat teacher Teacher
Exactly — it's not a one-shot thing. Seeds give the **initial** topology snapshot; then the joiner participates like everyone else. Eventually all nodes know all nodes.
:::

:::chat student Student
Why must every node share the **same** seed list?
:::

:::chat teacher Teacher
Important one. Inconsistent seed lists → gossip partitions / split-brain risk, especially on **first boot**. After that, remembered peers help, but ops still standardize one seed list per cluster — it's safer.

**Ports:** internode gossip defaults to **TCP 7000** (7001 with SSL). **Bidirectional** reachability between all nodes is required — not just to seeds.
:::

---

### Act 3 — Token assignment (the part I was worried about)

:::chat student Student
Part 1 said vnode means no manual `initial_token`. How does the joiner actually pick tokens?
:::

:::chat teacher Teacher
You remembered Part 1 well! Read `num_tokens` from config (Scylla/Cassandra default **256**). During bootstrap it:

1. Learns **existing tokens** from gossip
2. Generates `num_tokens` **random** values on the Murmur3 ring (`-2^63 … 2^63-1`)
3. **Skips** any token already owned

No central allocator — each node chooses independently, yet ranges tend to balance because many random cuts make slice sizes similar.
:::

:::chat student Student
What if I want a beefier machine to hold more data?
:::

:::chat teacher Teacher
Sure — give it more tokens. e.g. **512** vs 256 on smaller boxes. `num_tokens` is the knob for proportional ownership when hardware differs.
:::

:::chat student Student
Could two nodes collide on the same token?
:::

:::chat teacher Teacher
Don't worry — that's handled. The joiner checks existing tokens first and skips duplicates. Collisions are avoided at join time.
:::

:::chat student Student
Any smarter allocation than pure random?
:::

:::chat teacher Teacher
There is! Cassandra **3.0+** optional JVM flag: `-Dcassandra.allocate_tokens_for_keyspace=<keyspace>` — picks tokens using **load** of existing vnodes in that keyspace (better balance with fewer tokens). Default remains random.
:::

:::chat student Student
When would I still use `initial_token`?
:::

:::chat teacher Teacher
A manual comma-separated list in `cassandra.yaml` — skips auto allocation. Use cases: external token planner, **restoring a node with its old tokens**. Scylla is **vnode-only** in practice; `initial_token` overrides `num_tokens` only in legacy single-token mode.

**Token range math (quick):** each token is the **end** of a range. Node X owns **(predecessor's token, X's token]** on the ring.
:::

---

### Act 4 — Bootstrap streaming: filling the shelves

:::chat student Student
Tokens are chosen. Does the node serve traffic immediately?
:::

:::chat teacher Teacher
Not yet — this is where people often get confused. **Bootstrap** has two phases:

| Phase | What happens |
|-------|----------------|
| **Ring join** | Tokens assigned; node enters ring |
| **Bootstrap streaming** | Copies SSTables for ranges it now owns |

Until streaming finishes, the node is **UJ (Up Joining)** in `nodetool status`.
:::

:::chat student Student
Where does data come from?
:::

:::chat teacher Teacher
For each new range, the joiner streams from **current replicas**. Default: **primary replica** per range — guarantees consistency with cluster state. If a required replica is down, bootstrap **fails** unless you override with `-Dcassandra.consistent.rangemovement=false` (may miss data — be careful with that).
:::

:::chat student Student
How do I watch progress?
:::

:::chat teacher Teacher
Here's the easy way to watch it:

```bash
nodetool status    # UJ → UN
nodetool netstats  # Mode: JOINING, per-source % and bytes
```

Bonus: with vnodes, Scylla can stream from **many** nodes in parallel (not only immediate ring neighbors), so streaming-heavy work like bootstrap or rebuild can run faster than old one-token-per-node layouts.
:::

:::chat student Student
Bootstrap died halfway. Start over?
:::

:::chat teacher Teacher
You don't have to start from scratch. Cassandra **2.2+**: `nodetool bootstrap resume`, or often just **restart** the node. Fresh start: JVM flag `-Dcassandra.reset_bootstrap_progress=true`. Older versions: wipe data and re-bootstrap.
:::

:::chat student Student
Can I skip streaming?
:::

:::chat teacher Teacher
You can, but only in specific cases. `auto_bootstrap: false` joins the ring **without** copying data — for **backup restore** or **new datacenter** scenarios where you'll load data another way. Default is `true` (hidden in yaml but on by default). Don't flip this casually in production scale-out.
:::

:::chat student Student
Is streaming just in-memory? Do I need a separate rebuild to get data on disk?
:::

:::chat teacher Teacher
No — bootstrap streaming writes SSTables to **disk**, not RAM only. While the node is JOINING, peers send SSTables and the joiner writes them into its local data directories. The file counts and GB in `nodetool netstats` are disk progress, not a cache. When status flips **UN**, owned ranges are on disk and the node can serve reads and writes. With normal scale-out (`auto_bootstrap: true`), you do **not** need a separate `nodetool rebuild`.
:::

:::chat student Student
So is `nodetool rebuild` the same as bootstrap streaming?
:::

:::chat teacher Teacher
Same **transport** — both use SSTable streaming. Different **trigger** and **when you'd run it**:

| | Bootstrap streaming | `nodetool rebuild` |
| --- | --- | --- |
| Trigger | Automatic on join (`auto_bootstrap: true`) | Manual `nodetool rebuild` |
| When | **New** node entering the ring | **Already-UN** node — new DC, filling missed ranges |
| Normal scale-out | Default path | Special cases only |
| `auto_bootstrap: false` join | Skipped — data loaded another way | Often the follow-up step |

For "add one node to an existing DC," bootstrap streaming is enough. Rebuild is a **separate maintenance op** you run on a live node that still lacks ranges it never received.
:::

---

### Act 5 — UN at last, and the cleanup trap

:::chat student Student
`nodetool status` shows **UN**. We're done?
:::

:::chat teacher Teacher
Almost there! **Run `nodetool cleanup` on every old node** (not the new one). When ranges moved, Cassandra/Scylla **do not auto-delete** data the old node no longer owns — it's a safety measure. Without cleanup, stale data still counts toward disk load and can cause confusion later.
:::

:::chat student Student
Cleanup sounds expensive. Can I skip it?
:::

:::chat teacher Teacher
You can **postpone** to low-traffic hours — that's fine. But finish cleanup **before any decommission/removal**, or you risk **data resurrection**. A few tips when adding multiple nodes:

1. Add all nodes first; cleanup on all **except the last added**
2. Run cleanup **one node at a time**
3. Don't decommission until cleanup succeeded
:::

:::chat student Student
What exactly is data resurrection? Why can it happen if we skip cleanup?
:::

:::chat teacher Teacher
Good follow-up. **Data resurrection** means data that should have stayed deleted comes back. Preventing that is cleanup's **primary** job — freeing disk is secondary.

Walk through an example:

1. Write key `W1` — originally owned by node **N1**.
2. New node **Nx** bootstraps; `W1` **streams** to Nx. **Nx** is now the official owner, but **N1 still has `W1` on disk** (no auto-delete).
3. Later you **delete** `W1` — a **tombstone** lands on Nx.
4. After **gc_grace**, the tombstone is **GC'd** — the cluster treats `W1` as gone.
5. You **decommission/remove Nx** — ownership of `W1`'s range returns to **N1**.
6. **N1 still holds the old live `W1` value**; the tombstone is already gone.

On a read, N1's stale copy can win as the "latest" — deleted `W1` **resurrects**.

**Cleanup** after step 2 removes keys N1 no longer owns, blocking step 6. Order matters: **add node → cleanup completes → then decommission/removal**.

Note: Scylla ops discussions allow bootstrap + decommission of **old** nodes first, then cleanup later — but **never** decommission a **newly bootstrapped** node before cleanup, and don't delay cleanup indefinitely.
:::

:::chat student Student
Any prerequisites before I even start?
:::

:::chat teacher Teacher
Here's a checklist that'll save you headaches — from the Scylla add-node procedure:

- **No existing node may be down** — fix the cluster first
- **Same Scylla/Cassandra version** (patch level too)
- Copy from a live node: `cluster_name`, `seeds`, `endpoint_snitch`, `authenticator`
- Match `listen_address`, `rpc_address`, snitch/rack config
- Identical hardware → copy `io.conf` / `io_properties.yaml`; skip `scylla_io_setup` on clones
- Install but **don't start** until yaml is correct (disable auto-start on Debian if needed)
:::

---

### Act 6 — States, flags, and foot-guns

**Node states (`nodetool status`)**

| State | Meaning |
|-------|---------|
| **UJ** | Up Joining — streaming |
| **UN** | Up Normal — serving |
| **DN** | Down |
| LEAVING / MOVING | Decommission / token move in progress |

**Common mistakes**

| Mistake | Symptom |
|---------|---------|
| New node listed as seed | Bootstrap won't proceed |
| Wrong `cluster_name` | Won't join ring |
| Bootstrap several nodes at once | Load spike, uneven progress |
| Same IP replace without repair window | May miss writes (see replace flow in next note) |

**Related JVM flags (Cassandra)**

| Flag | Purpose |
|------|---------|
| `-Dcassandra.allocate_tokens_for_keyspace=...` | Load-aware token pick |
| `-Dcassandra.consistent.rangemovement=false` | Bootstrap despite down replica (risky) |
| `-Dcassandra.reset_bootstrap_progress=true` | Wipe bootstrap checkpoint |
| `-Dcassandra.replace_address_first_boot=<ip>` | **Replace dead node** — different path (next note) |

---

### Pipeline cheat sheet

```
Start → contact seeds → gossip (topology + tokens)
      → pick num_tokens random tokens (skip used)
      → stream SSTables from primary replicas
      → UN → cleanup on old nodes
```

### Config snapshot for a new joiner

| Setting | Rule |
|---------|------|
| `cluster_name` | Must match cluster |
| `seeds` | Existing nodes only; 2–3 per DC |
| `endpoint_snitch` | Must match |
| `num_tokens` | Usually 256; scale with hardware |
| `auto_bootstrap` | true (default) for normal scale-out |
| `listen_address` / `broadcast_address` | Reachable by all peers |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What is a seed node's only special role, and what is it *not* responsible for?
---
Seeds are **first gossip contact points** for nodes joining or re-learning topology. They are **not** leaders, write coordinators, or data authorities. After join, seeds behave like any other node.
:::

:::quiz
**Q2.** How does a joining vnode node get its tokens without manual `initial_token`?
---
It reads `num_tokens`, learns existing tokens via gossip, then picks that many **random** ring positions, **skipping** tokens already in use. More tokens → more even load split. Optional Cassandra flag `allocate_tokens_for_keyspace` can optimize by load.
:::

:::quiz
**Q3.** What is the difference between "ring join" and "bootstrap streaming," and how do you tell which phase you're in?
---
Ring join = token assignment and entering the ring. Bootstrap streaming = copying SSTables for owned ranges. **`nodetool status` UJ** and **`nodetool netstats` Mode: JOINING** mean streaming is in progress; **UN** means complete.
:::

:::quiz
**Q4.** Why run `nodetool cleanup` on old nodes after the new node reaches UN?
---
Range movement leaves **stale data** on nodes that lost ownership — the system **won't delete it automatically**. Cleanup removes those keys. Without it, old live values can linger; combined with later deletes, tombstone GC, and node removal, **data resurrection** (deleted rows reappearing) becomes possible. Finish cleanup before decommission.
:::

:::quiz
**Q5.** Name two configuration mistakes that prevent a new node from bootstrapping.
---
(1) Listing the **joining node itself** in `seeds` — seeds cannot bootstrap. (2) **`cluster_name` mismatch** or unreachable seed/listen addresses so gossip never starts.
:::

:::quiz
**Q6.** Does bootstrap streaming only fill memory? After UN, do you still need rebuild?
---
No. Bootstrap streaming writes SSTables to **disk**. **UN** means owned ranges are on disk and ready. Normal scale-out (`auto_bootstrap: true`) needs **no extra rebuild**. `nodetool rebuild` is a separate op for an already-UN node filling ranges it never got — same streaming transport, different trigger.
:::

## Memo

Part 2 of the Cassandra/Scylla track — boot join mechanics before node replacement runbooks.
