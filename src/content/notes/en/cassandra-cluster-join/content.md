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

---

## Why I looked this up

Follow-up from Part 1. We're standing up Scylla at work and I need to understand how a new node discovers the cluster and gets its tokens when we bring nodes up.

---

## What stood out

Asked for a role-play Q&A walkthrough so the mechanics stick better than a flat summary.

---

## What I learned

*Setting: a senior engineer walks a junior through bootstrapping a new node into an existing Scylla/Cassandra cluster.*

---

### Act 1 — The new node wakes up

**Student:** A new machine just finished `scylla.yaml`. I hit `systemctl start scylla-server`. What's the *first* thing it tries to do?

**Teacher:** Contact a **seed node**. Seeds are just IPs in `seeds` (Cassandra: `seed_provider`). They are **not** leaders, coordinators, or special data holders — only the **first gossip contact point** when a node doesn't yet know the ring.

**Student:** So if every seed is down, we're stuck?

**Teacher:** For a **brand-new joiner**, yes — it can't bootstrap gossip. For a node **already in the cluster**, it's less scary: by default it remembers peers from previous runs, so it may rejoin without seeds. Seeds matter most on **first startup**.

**Student:** Can the joining node be its own seed?

**Teacher:** **No.** Official docs are explicit: **seed nodes cannot bootstrap.** Put existing healthy nodes in `seeds`; never list the joining node there. Also don't make *every* node a seed — that adds gossip overhead without real benefit. Rule of thumb: **~2–3 seeds per datacenter**, same list on **all** nodes.

**Student:** Multi-DC — anything special?

**Teacher:** Include **at least one seed per datacenter** (replication group). Otherwise a new node in DC-B might have to cross DC just to discover topology — slower and brittle.

| Seed myth | Reality |
|-----------|---------|
| "Seeds coordinate writes" | No — peers are equal |
| "Seeds are a SPOF" | No — only bootstrap aid |
| "More seeds = safer" | No — small, stable list per DC |

---

### Act 2 — Gossip: learning who's on the ring

**Student:** It reached a seed. Then what?

**Teacher:** **Gossip** kicks in — P2P epidemic protocol. Every ~1 second each node talks to up to ~3 peers, exchanging state with version numbers so newer info wins. The joiner learns:

- Which IPs are in the cluster
- Who is up/down
- **Every node's tokens** (via `application_state::TOKENS`)

**Student:** So discovery isn't a one-shot RPC — the joiner keeps gossiping?

**Teacher:** Right. Seeds give the **initial** topology snapshot; then the joiner participates like everyone else. All nodes eventually know all nodes.

**Student:** Why must every node share the **same** seed list?

**Teacher:** Inconsistent lists → gossip partitions / split-brain risk, especially on **first boot**. After that, remembered peers help, but ops still standardize one seed list per cluster.

**Ports:** internode gossip defaults to **TCP 7000** (7001 with SSL). **Bidirectional** reachability between all nodes is required — not just to seeds.

---

### Act 3 — Token assignment (the part I was worried about)

**Student:** Part 1 said vnode means no manual `initial_token`. How does the joiner actually pick tokens?

**Teacher:** Read `num_tokens` from config (Scylla/Cassandra default **256**). During bootstrap it:

1. Learns **existing tokens** from gossip
2. Generates `num_tokens` **random** values on the Murmur3 ring (`-2^63 … 2^63-1`)
3. **Skips** any token already owned

No central allocator — each node chooses independently, yet ranges tend to balance because many random cuts make slice sizes similar.

**Student:** What if I want a beefier machine to hold more data?

**Teacher:** Give it more tokens — e.g. **512** vs 256 on smaller boxes. `num_tokens` is the knob for proportional ownership when hardware differs.

**Student:** Could two nodes collide on the same token?

**Teacher:** The joiner checks existing tokens first and skips duplicates. Collisions are avoided at join time.

**Student:** Any smarter allocation than pure random?

**Teacher:** Cassandra **3.0+** optional JVM flag: `-Dcassandra.allocate_tokens_for_keyspace=<keyspace>` — picks tokens using **load** of existing vnodes in that keyspace (better balance with fewer tokens). Default remains random.

**Student:** When would I still use `initial_token`?

**Teacher:** Manual comma-separated list in `cassandra.yaml` — skips auto allocation. Use cases: external token planner, **restoring a node with its old tokens**. Scylla is **vnode-only** in practice; `initial_token` overrides `num_tokens` only in legacy single-token mode.

**Token range math (quick):** each token is the **end** of a range. Node X owns **(predecessor's token, X's token]** on the ring.

---

### Act 4 — Bootstrap streaming: filling the shelves

**Student:** Tokens are chosen. Does the node serve traffic immediately?

**Teacher:** Not yet. **Bootstrap** has two phases people conflate:

| Phase | What happens |
|-------|----------------|
| **Ring join** | Tokens assigned; node enters ring |
| **Bootstrap streaming** | Copies SSTables for ranges it now owns |

Until streaming finishes, the node is **UJ (Up Joining)** in `nodetool status`.

**Student:** Where does data come from?

**Teacher:** For each new range, the joiner streams from **current replicas**. Default: **primary replica** per range — guarantees consistency with cluster state. If a required replica is down, bootstrap **fails** unless you override with `-Dcassandra.consistent.rangemovement=false` (may miss data — dangerous).

**Student:** How do I watch progress?

**Teacher:**

```bash
nodetool status    # UJ → UN
nodetool netstats  # Mode: JOINING, per-source % and bytes
```

Scylla rebuild advantage: with vnodes, streaming can pull from **many** nodes in parallel (not only immediate ring neighbors), so rebuild/bootstrap can be faster than old one-token-per-node layouts.

**Student:** Bootstrap died halfway. Start over?

**Teacher:** Cassandra **2.2+**: `nodetool bootstrap resume`, or often just **restart** the node. Fresh start: JVM flag `-Dcassandra.reset_bootstrap_progress=true`. Older versions: wipe data and re-bootstrap.

**Student:** Can I skip streaming?

**Teacher:** `auto_bootstrap: false` joins the ring **without** copying data — for **backup restore** or **new datacenter** scenarios where you'll load data another way. Default is `true` (hidden in yaml but on by default). Don't flip this casually in production scale-out.

---

### Act 5 — UN at last, and the cleanup trap

**Student:** `nodetool status` shows **UN**. We're done?

**Teacher:** Almost. **Run `nodetool cleanup` on every old node** (not the new one). When ranges moved, Cassandra/Scylla **do not auto-delete** data the old node no longer owns — safety measure. Without cleanup, stale data still counts toward disk load and can cause confusion.

**Student:** Cleanup sounds expensive. Can I skip it?

**Teacher:** You can **postpone** to low-traffic hours, but docs warn: finish cleanup **before any decommission/removal**, or you risk **data resurrection**. Tips when adding multiple nodes:

1. Add all nodes first; cleanup on all **except the last added**
2. Run cleanup **one node at a time**
3. Don't decommission until cleanup succeeded

**Student:** Any prerequisites before I even start?

**Teacher:** Checklist from Scylla add-node procedure:

- **No existing node may be down** — fix the cluster first
- **Same Scylla/Cassandra version** (patch level too)
- Copy from a live node: `cluster_name`, `seeds`, `endpoint_snitch`, `authenticator`
- Match `listen_address`, `rpc_address`, snitch/rack config
- Identical hardware → copy `io.conf` / `io_properties.yaml`; skip `scylla_io_setup` on clones
- Install but **don't start** until yaml is correct (disable auto-start on Debian if needed)

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
Range movement leaves **stale data** on nodes that lost ownership. The system **won't delete it automatically**. Cleanup removes those keys. Skipping cleanup before decommission can cause **data resurrection**.
:::

:::quiz
**Q5.** Name two configuration mistakes that prevent a new node from bootstrapping.
---
(1) Listing the **joining node itself** in `seeds` — seeds cannot bootstrap. (2) **`cluster_name` mismatch** or unreachable seed/listen addresses so gossip never starts.
:::

## Memo

Part 2 of the Cassandra/Scylla track — boot join mechanics before node replacement runbooks.
