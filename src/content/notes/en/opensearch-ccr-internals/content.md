---
title: 'OpenSearch CCR internals — how the follower actually replicates'
---

## References

- [Cross-cluster replication RFC (opensearch-project/cross-cluster-replication)](https://github.com/opensearch-project/cross-cluster-replication/blob/main/docs/RFC.md)
- [Cross-cluster replication plugin — OpenSearch docs](https://docs.opensearch.org/latest/tuning-your-cluster/replication-plugin/index/)
- [Cross-cluster replication for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/replication.html)
- [RetentionLease (OpenSearch server API)](https://www.javadoc.io/static/org.opensearch/opensearch/1.3.9/org/opensearch/index/seqno/RetentionLease.html)
- [Translog pruning based on retention leases (OpenSearch #1100)](https://github.com/opensearch-project/OpenSearch/issues/1100)
- [CCR setup and bootstrap (index-state-management.org)](https://www.index-state-management.org/cross-cluster-replication-operations/ccr-setup-and-bootstrap/)

---

## Why I looked this up

Follow-up from the OpenSearch Region-migration note. That note treated CCR as a black box — "follower pulls the leader, `_stop` to promote." I wanted the mechanism underneath: what actually moves the bytes, how the follower tails the leader, and *why* the well-known limits (soft deletes required, 12-hour pause cap, no incremental reverse) fall out of the design rather than being arbitrary rules.

---

## What stood out

CCR is not a bespoke replication engine — it's a plugin that reuses three parts OpenSearch already had: **persistent tasks**, the **snapshot/restore** machinery, and **retention leases**. Almost every limit in the migration note is a direct consequence of one of those three.

---

## What I learned

*CCR = a follower-driven plugin that **bootstraps** a follower index by restoring the leader as a fake snapshot repository, then **tails** each leader shard with a long-poll reader/writer loop, using a **retention lease** on the leader to keep the history it hasn't consumed yet.*

---

### Act 1 — The shape of the thing

:::chat student AI Student
Before the details — what *kind* of system is CCR? Is it a separate service?
:::

:::chat teacher Teacher
No. It's an **OpenSearch plugin** on both clusters, and it deliberately reuses machinery that already existed:

- **Persistent tasks** — the same framework ISM and other background jobs use. State lives in **cluster state**, so tasks survive node restarts and resume from their last checkpoint.
- **Snapshot/restore** — reused for the one-time bootstrap copy.
- **Retention leases + soft deletes** — reused to keep operation history around so the follower can tail.

The model is **active-passive, pull-based**: the **follower** opens the connection to the **leader** and does all the work. The leader just serves reads of its own history. That single design choice — follower pulls — is why there's **no managed failover**: the leader has no idea it's a leader in any authoritative sense, so nothing on the leader side flips roles for you.
:::

:::chat student AI Student
Where does the connection actually run?
:::

:::chat teacher Teacher
Over the **transport layer (port 9300)**, not REST/9200. You register the leader on the follower as a remote cluster (`cluster.remote.<alias>.seeds`), and every node that runs a replication task or holds a follower shard must carry the **`remote_cluster_client`** role, or it can't open a transport channel to the leader. Node-to-node encryption must be **on for both clusters or off for both** — never mixed.
:::

---

### Act 2 — The task hierarchy

:::chat student AI Student
When I call `_start`, what gets created?
:::

:::chat teacher Teacher
A tree of persistent tasks, all running **on the follower**:

- **`IndexReplicationTask`** (one per follower index) — the coordinator. It does **not** move data. It can run on *any* node (even a cluster-manager node); the plugin picks the node with the fewest tasks. It runs the bootstrap, then spawns and supervises the shard tasks, and handles index-level failures.
- **`ShardReplicationTask`** (one per follower **primary** shard) — the workhorse. It's **co-located with the primary shard** it writes to, and it runs the reader/writer loop that replays changes.
- **`AutofollowReplicationTask`** (cluster-level, from `_autofollow`) — not tied to one index. It periodically polls the leader for indices matching a pattern and fires a `_start` for each new match.

Each step is **checkpointed in cluster state**, so if a node dies mid-flight, the task resumes from the last known step instead of restarting from scratch.
:::

:::chat student AI Student
So the coordinator and the shard workers are different tasks on possibly different nodes?
:::

:::chat teacher Teacher
Exactly. The `IndexReplicationTask` is a lightweight orchestrator that can sit anywhere; the `ShardReplicationTask`s sit **where the data is** so replay is a local write. All of them execute under the **security context of the user who called `_start`**, captured in cluster state — that's what `use_roles` (`leader_cluster_role` / `follower_cluster_role`) binds. Authorization is re-checked on **every transport request** at both ends, so revoking that role mid-replication makes subsequent fetches fail.
:::

---

### Act 3 — Retention leases: the thing that makes tailing possible

:::chat student AI Student
The migration note said the leader index needs `soft_deletes` enabled. Why does replication care about deletes?
:::

:::chat teacher Teacher
Because "tailing" means the follower asks the leader for **operations by sequence number** — "give me everything after seqNo N." For that to work, the leader must still *have* those operations. Normally Lucene **merges away** soft-deleted and superseded docs to reclaim space. A **retention lease** stops that.

A retention lease is a marker on a leader shard containing:

- a **retaining sequence number** — every op with seqNo ≥ this is kept through merges,
- a unique id, a timestamp, and a **source** (here, `"ccr"`).

When replication starts, the `IndexReplicationTask` acquires a lease on each leader shard. After the follower **durably applies** a batch, the shard task **renews** the lease forward. That renewal is the signal that lets the leader **safely truncate/merge** everything below the new retaining seqNo.
:::

:::chat student AI Student
And if the follower falls behind?
:::

:::chat teacher Teacher
That's the whole game. The lease has a **period** (`index.soft_deletes.retention_lease.period`, ~12h). If the follower lags longer than that, the lease **expires**, the leader **garbage-collects** the operations the follower still needed, and there's no way to resume incrementally — the seqNo the follower wants no longer exists. The only recovery is a **full re-bootstrap** (another remote restore of every shard).

This is the mechanistic reason behind two limits from the migration note:

- **"pause &gt; 12h ⇒ delete follower + restart from scratch"** — a paused follower stops renewing, the lease expires, history is gone.
- **"lag past retention ⇒ full remote resync"** — same expiry, different trigger.
:::

---

### Act 4 — Bootstrap (`BOOTSTRAPPING`): the leader as a fake snapshot repo

:::chat student AI Student
How does the follower get the *existing* data — everything indexed before replication started?
:::

:::chat teacher Teacher
This is the clever reuse. The plugin **exposes the leader cluster as an internal snapshot repository** to the follower. Requests to that "repository" are translated into requests to the leader. Then the follower runs the **normal snapshot-restore recovery** against it:

1. It restores each leader shard's Lucene segments to the follower → a **byte-consistent** copy of the leader at a commit point.
2. Because it's the standard restore path, the follower index is **created with the leader's settings and mappings** automatically — that's why the follower index must **not** pre-exist.
3. On the leader, a **Restore Leader Service** coordinates this: it pins the **commit point** the follower is restoring from, tracks the transfer, and cleans up when done.

If recovery fails, the `IndexReplicationTask` goes to **`FAILED`**. On a large index this phase is I/O- and network-heavy and can run for minutes; it's the expensive part.
:::

:::chat student AI Student
So bootstrap is basically snapshot/restore with the leader standing in for S3?
:::

:::chat teacher Teacher
Right — conceptually the same segment-file copy as a snapshot restore, but streamed directly from the leader instead of an object store. Once the restore commit lands, the index leaves `BOOTSTRAPPING` and enters `SYNCING`, where the *cheap* incremental tailing begins. And note the loop: if steady-state ever breaks past the retention lease, you're **thrown right back through this same bootstrap**.
:::

---

### Act 5 — Steady state (`SYNCING`/`SYNCED`): the reader/writer loop

:::chat student AI Student
Once bootstrapped, how does a single shard stay in sync?
:::

:::chat teacher Teacher
Each `ShardReplicationTask` runs one or more **reader** and **writer** threads:

- **Reader** — issues a **long-poll** to a leader shard copy: "give me a batch of operations after my checkpoint." If nothing is available, the request **parks up to ~5 minutes** before returning empty, then the follower re-issues it. Several long-polls can be **in flight concurrently** to match the leader's indexing throughput (`plugins.replication.follower.concurrent_readers_per_shard`, default 2). Fetched ops land on an **in-memory queue** on the node.
- **Writer** — drains the queue **in order** and replays each op on the follower primary shard. Applied ops then replicate to the follower's **own replica shards** exactly like a normal local write. If an op references a mapping the follower doesn't have yet, the writer **synchronously fetches the updated mapping from the leader** and applies it before continuing.
- After a batch is durably written, the writer **renews the retention lease** on the leader (Act 3).
:::

:::chat student AI Student
How do I read the lag?
:::

:::chat teacher Teacher
Via **checkpoints**. `_status` reports `leader_checkpoint` and `follower_checkpoint` — both sequence numbers. Their difference is your **live lag in operations**. Converging checkpoints = healthy; a gap trending up over several polls = the follower can't keep pace (peer bandwidth saturated, or the follower tier is under-provisioned). This is document-level (**logical**) replication — the follower replays operations, it doesn't rsync segments in steady state.

Metadata (mapping/settings) also syncs on a slower cadence, `plugins.replication.follower.metadata_sync_interval` (~60s), in addition to the synchronous mapping fetch the writer does on demand.
:::

---

### Act 6 — Where the leader reads those ops from (and the CPU cost)

:::chat student AI Student
When the reader asks for "ops after seqNo N," where does the leader get them?
:::

:::chat teacher Teacher
By default, from **Lucene** — the soft-deleted operations the retention lease is keeping alive. The catch, found during benchmarking: reconstructing ops from Lucene means **decompressing stored fields**, which cost roughly **8–10% CPU** on the leader under heavy indexing.

So there's an optimization: **translog pruning based on retention leases** (`plugins.replication.index.translog.retention_lease.pruning.enabled`). The translog stores operations **uncompressed**. With this on, the translog deletion policy also respects the retention lease, keeping older translog generations around so the fetch can serve **directly from the translog** and skip Lucene decompression. If the translog grows past its size limit, older generations are still pruned and the fetch **falls back to Lucene**. So it's a CPU-vs-disk trade, with Lucene as the safety net.
:::

---

### Act 7 — What CCR does *not* do, and the state machine

:::chat student AI Student
People assume CCR mirrors "the cluster." What's actually outside the boundary?
:::

:::chat teacher Teacher
CCR replicates **data-plane operations plus index mapping/settings** — nothing else. Everything below stays **per-cluster** and must be provisioned on the follower by your own automation:

- Templates, **ISM policies**, ingest pipelines, roles, `_cluster/settings`.
- **Lifecycle actions themselves**: a `rollover` on the leader creates a *new* backing index; the follower won't touch it unless an **auto-follow** rule matches. (This is why rolling indices need auto-follow, not per-index `_start`.)
- **Follower writes** — the follower index is **write-blocked by the plugin** (not a flippable setting). The only supported way to make it writable is to **promote** it via `_stop`, which detaches it from the leader and lifts the block.

So a CCR topology is really **two deployments**: data flows one way over the wire; the control plane is deployed to both sides by you. Editing a template on only one cluster is how followers silently diverge.
:::

:::chat student AI Student
And the lifecycle states I'll see in `_status`?
:::

:::chat teacher Teacher
`INIT → BOOTSTRAPPING → SYNCING ⇄ SYNCED`, with `FAILED` off to the side:

- **`INIT`** — transient; registering the leader shard set.
- **`BOOTSTRAPPING`** — the remote snapshot restore (Act 4).
- **`SYNCING`** — restore done, replaying to close the gap.
- **`SYNCED`** — caught up; loops back to `SYNCING` whenever new leader ops arrive.
- **`FAILED`** — terminal until you act. The plugin **does not auto-retry** role/block errors, because re-running a misconfigured `_start` just fails again. Fix the cause, re-issue `_start`, and it walks back through `BOOTSTRAPPING`.
:::

---

### Reference — internals at a glance

| Concern | Mechanism | Reused OpenSearch part |
|---------|-----------|------------------------|
| Orchestration | `IndexReplicationTask` (coordinator) + `ShardReplicationTask` (per primary) | Persistent tasks (state in cluster state) |
| Auto-follow | `AutofollowReplicationTask` polls leader for pattern matches | Persistent tasks |
| Initial copy | Leader exposed as internal snapshot repo → restore segments | Snapshot/restore recovery |
| Keeping history | Retention lease (retaining seqNo, source `ccr`) on leader shards | Soft deletes + retention leases |
| Tailing | Reader long-poll (batch after checkpoint) → queue → writer replay | seqNo / checkpoints |
| Lag metric | `leader_checkpoint − follower_checkpoint` | Sequence numbers |
| Fetch source | Lucene soft-deletes by default; optional translog pruning to avoid decompression | Translog deletion policy |
| Write safety | Plugin-enforced write block on follower | Index block |

### Reference — settings that shape behavior

| Setting | Where | Typical | What it controls |
|---------|-------|---------|------------------|
| `index.soft_deletes.enabled` | Leader index | `true` (required) | Whether history exists to tail at all |
| `index.soft_deletes.retention_lease.period` | Leader index | `12h` | How long a lagging follower can resume before full re-bootstrap |
| `plugins.replication.index.translog.retention_lease.pruning.enabled` | Leader index | off by default | Serve fetches from uncompressed translog vs Lucene |
| `plugins.replication.follower.concurrent_readers_per_shard` | Follower | `2` | Concurrent long-poll readers per shard |
| `plugins.replication.follower.metadata_sync_interval` | Follower | `60s` | Cadence for pulling mapping/settings |
| `plugins.replication.autofollow.fetch_poll_interval` | Follower | `30s` | How often auto-follow scans the leader |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** CCR reuses three pre-existing OpenSearch subsystems. Name them and what each does for replication.
---
**Persistent tasks** (orchestrate `IndexReplicationTask` / `ShardReplicationTask`, with state in cluster state so they survive restarts), **snapshot/restore** (the one-time bootstrap copy, with the leader exposed as an internal snapshot repository), and **retention leases + soft deletes** (keep the leader's operation history so the follower can tail by sequence number).
:::

:::quiz
**Q2.** Why does the leader index need `soft_deletes`, and what does the retention lease actually protect?
---
Tailing works by fetching operations by sequence number, so the leader must still hold that history. Lucene normally merges away soft-deleted/superseded docs. A retention lease pins a **retaining seqNo** — every op ≥ it survives merges. The follower renews the lease forward after durably applying a batch, which is what lets the leader safely truncate everything below it.
:::

:::quiz
**Q3.** Mechanistically, why does pausing replication for more than ~12 hours force a full re-bootstrap?
---
A paused follower stops renewing the retention lease. Once the lease **period** (`retention_lease.period`, ~12h) elapses, the lease expires and the leader garbage-collects the operations the follower still needed. The sequence number the follower wants no longer exists, so incremental resume is impossible — only a full remote snapshot restore of every shard can recover.
:::

:::quiz
**Q4.** What exactly happens during `BOOTSTRAPPING`, and why must the follower index not pre-exist?
---
The plugin exposes the leader as an internal snapshot repository and runs the normal restore recovery, streaming each leader shard's Lucene segments to the follower for a byte-consistent copy. Because it's the standard restore path, it **creates** the follower index with the leader's settings and mappings — so if an index with that name already exists, `_start` fails with `resource_already_exists`.
:::

:::quiz
**Q5.** In steady state, how does the reader/writer loop move data, and how do you read replication lag?
---
The reader issues concurrent **long-polls** to the leader shard ("ops after my checkpoint"), parking up to ~5 min when idle, and queues fetched ops. The writer drains the queue **in order**, replays on the follower primary (fetching leader mappings synchronously if needed), lets those writes flow to the follower's own replicas, then renews the retention lease. Lag = `leader_checkpoint − follower_checkpoint` from `_status`, i.e. the gap in sequence numbers.
:::

---

## Memo

(Research memo — the migration note's CCR limits aren't arbitrary: soft-deletes/retention-lease expiry explains the 12h cap and full-resync-on-lag; the snapshot-repo bootstrap explains "follower must not pre-exist"; the plugin write block explains why promotion needs `_stop`.)
