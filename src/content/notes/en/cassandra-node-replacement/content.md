---
title: 'Cassandra & Scylla — Part 3: Node Replacement'
---

## References

- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)
- [Handling Node Failures (ScyllaDB)](https://docs.scylladb.com/manual/stable/troubleshooting/handling-node-failures.html)
- [Repair-Based Node Operations (RBNO)](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/repair-based-node-operation.html)
- [Adding, replacing, moving and removing nodes (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)
- [Hints (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html)
- [Repair (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html)
- [Remove a Node from a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/remove-node.html)
- [nodetool removenode (ScyllaDB)](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/removenode.html)
- [nodetool decommission (ScyllaDB)](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/decommission.html)
- [Bootstrapping Apache Cassandra Nodes (The Last Pickle)](http://thelastpickle.com/blog/2017/05/23/auto-bootstrapping-part1.html)
- [Replace a dead node (DataStax DSE)](https://docs.datastax.com/en/dse/6.9/managing/operations/replace-node.html)
- [Replace nodes (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)

---

## Why I looked this up

Follow-up from Part 2. I need a practical runbook for swapping failed or decommissioned nodes without data loss.

---

## What stood out

Part 2 teased `replace_address_first_boot` as a separate path from bootstrap — this note fills in that gap.

---

## What I learned

*Background: the same kind senior engineer from Part 2 walks a junior through replacing a dead Scylla/Cassandra node.*

---

### Act 1 — Which operation is this?

:::chat student AI Student
A node shows DN in `nodetool status`. Do I always run replace?
:::

:::chat teacher Teacher
Good first question — not always. Start with **why** the node is down.

| Situation | Operation |
|-----------|-----------|
| Hardware failed, keep cluster size | **replace** ← this note |
| Planned removal while node is UN | **decommission** (not replace) |
| Permanently dead, shrink the cluster | **removenode** (last resort) |
| Temporary outage (reboot, network blip) | **wait** — do not replace a node that might come back |

**Replace** inherits the dead node's **token ranges** — no random new tokens like Part 2 bootstrap. One streaming/RBNO phase instead of decommission + bootstrap (two range movements).
:::

:::chat student AI Student
How is replace different from Part 2 add-node bootstrap?
:::

:::chat teacher Teacher
Part 2 = **scale out**: gossip learns existing tokens → pick **new random** tokens → stream → **cleanup on old nodes**.

Replace = **same seat**: new hardware takes the **dead node's tokens** → stream/RBNO from surviving replicas → **no cleanup on other nodes** (ownership didn't move away, it was reassigned).
:::

---

### Act 2 — Preconditions

:::chat student AI Student
What do I check before touching anything?
:::

:::chat teacher Teacher
Checklist before replace:

1. **Quorum** — topology changes need a quorum of nodes up. If quorum is lost, restore it first ([Handling Node Failures](https://docs.scylladb.com/manual/stable/troubleshooting/handling-node-failures.html)).
2. **Status** — target must be **DN** (Down Normal). A live UN node must never be replaced.
3. **Version** — new node matches cluster version **including patch release**.
4. **Config** — copy from a live UN node: `cluster_name`, `seeds`, `endpoint_snitch`, `authenticator`; set `listen_address`, `rpc_address`, rack/DC correctly.
5. **Data directory** — on the new node, **empty** (`/var/lib/scylla/data` etc.). If you can reach the dead box, wipe its data too.
6. **Host ID** — note the dead node's Host ID from `nodetool status` (Scylla uses this for replace).
:::

:::chat student AI Student
Can I replace multiple dead nodes at once?
:::

:::chat teacher Teacher
Yes — Scylla docs allow **parallel replace** of multiple dead nodes, as long as quorum holds and you have capacity for the streaming/RBNO load.
:::

---

### Act 3 — Configuration: Scylla vs Cassandra

:::chat student AI Student
Part 2 mentioned `-Dcassandra.replace_address_first_boot`. What do I actually set on Scylla?
:::

:::chat teacher Teacher
Scylla (current): add to `scylla.yaml` on the **new** node:

```yaml
replace_node_first_boot: <host-id-of-dead-node>
```

- Value = **Host ID** of the dead node (from `nodetool status`), not the new node's IP.
- `replace_address` and `replace_address_first_boot` are **obsolete on Scylla** — do not use them.
- After successful replace, you **do not need to remove** this line (unlike Cassandra JVM flags).

Cassandra: add to `jvm-server.options` / `cassandra-env.sh`:

```
-Dcassandra.replace_address_first_boot=<dead_node_ip>
```

- Value = **IP of the dead node**, even if the new node gets a different IP.
- Prefer `_first_boot` over legacy `replace_address` — `_first_boot` applies once; forgetting to remove `replace_address` breaks restarts ([The Last Pickle](http://thelastpickle.com/blog/2017/05/23/auto-bootstrapping-part1.html)).
- **Remove** the JVM flag after successful replace (Cassandra).
:::

| | Scylla | Cassandra |
|---|--------|-----------|
| Identifier | Host ID | Dead node IP |
| Where | `scylla.yaml` | JVM options |
| After success | Can leave in yaml | Remove JVM flag |
| Legacy | `replace_address*` unsupported | `replace_address` dangerous on restart |

---

### Act 4 — Hibernate state and monitoring

:::chat student AI Student
I start the new node. Why does `nodetool status` look weird?
:::

:::chat teacher Teacher
During replace the node enters a **hibernate** state ([Cassandra topo_changes](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)):

| Observer | What they see |
|----------|---------------|
| Other nodes | Replacing node still looks like the **dead** entry (DN) |
| Replacing node itself | Sees itself as **UN** |
| Accurate progress | `nodetool netstats` — REPLACE / streaming mode |

On Scylla you may **not see the new IP** in `nodetool status` during bootstrap — use `nodetool gossipinfo` to confirm the new address is **NORMAL**.

```bash
nodetool status       # DN → eventually UN on new IP
nodetool netstats     # REPLACE progress, % and GB
nodetool gossipinfo   # new IP + STATUS:NORMAL while status lags
nodetool tasks list   # RBNO long-running tasks (Scylla 5.4+)
```
:::

:::chat student AI Student
Same IP vs different IP for the replacement — does it matter?
:::

:::chat teacher Teacher
Yes — it affects **writes during bootstrap**:

| Scenario | Tokens | Host ID | Writes during bootstrap |
|----------|--------|---------|-------------------------|
| Same IP | Inherited from dead node | New ID issued | May **not** receive writes (CASSANDRA-8523) |
| Different IP | Inherited | New ID issued | **Can** receive writes |

Part 2's pitfall row applies here: **same IP replace without repair** after a long outage can miss writes.
:::

---

### Act 5 — Data sync: streaming vs RBNO

:::chat student AI Student
Where does the data come from?
:::

:::chat teacher Teacher
Surviving **replicas** stream (or repair-sync) the dead node's token ranges to the replacement — same idea as bootstrap streaming in Part 2, but for **inherited** ranges, not new random ones.

**Scylla 5.4+ (RBNO default):** replace uses **row-level repair** instead of legacy streaming alone. Benefits:

- Resumable from checkpoint if interrupted
- Reads all replicas for consistency
- **No manual repair** needed after replace when RBNO for replace is enabled

Check `enable_repair_based_node_ops` and `allowed_repair_based_node_ops` on your cluster.
:::

---

### Act 6 — When must I run repair?

:::chat student AI Student
Replace finished — UN on the new node. Am I done?
:::

:::chat teacher Teacher
Almost. Ask: **did the replacement miss writes?**

**Must run `nodetool repair` on the replaced node** when ([Cassandra topo_changes](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html), [Scylla replace doc](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)):

1. Dead node was down **longer than `max_hint_window`** (default **3 hours**) before replace started.
2. **Same IP** replace and bootstrap took **longer than `max_hint_window`**.

**Hinted handoff** ([Hints doc](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html)) stores missed writes for unavailable replicas — but only within that window. It is **best-effort**, not a repair substitute.

**Exception:** Scylla with **RBNO for replace** enabled — docs say **no separate repair** needed.

If repair is required, run it on the **replaced node** (Scylla Manager can schedule it).
:::

| Factor | Repair after replace? |
|--------|----------------------|
| Downtime < `max_hint_window`, different IP, fast bootstrap | Usually no (legacy streaming) |
| Downtime > `max_hint_window` | **Yes** |
| Same IP, slow bootstrap > `max_hint_window` | **Yes** |
| RBNO for replace enabled (Scylla 5.4+) | **No** (per docs) |

---

### Act 7 — Replace vs removenode

:::chat student AI Student
Replace failed or I want to shrink the cluster. Now what?
:::

:::chat teacher Teacher
**removenode** is the fallback when you **remove** a dead node instead of replacing it:

| | replace | removenode |
|---|---------|------------|
| Goal | Restore **same capacity** | **Shrink** cluster |
| Tokens | Dead node's tokens **kept** | Redistributed to survivors |
| Consistency | Streaming/RBNO fills data | Run **cluster repair before** removenode (unless RBNO) |
| Reversibility | — | Node is **banned** — even if removenode fails, you cannot bring it back |

Never use `removenode` on a **live reachable** node — use `decommission` instead ([removenode doc](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/removenode.html)).
:::

---

### Act 8 — Special cases

**Dead seed node**

- Remove dead IP from `seeds` on **every** node before or as part of replace.
- If the cluster needs a new seed, add the replacement node's IP to all nodes' seed lists ([DSE replace-node](https://docs.datastax.com/en/dse/6.9/managing/operations/replace-node.html)).
- Do **not** put the joining/replacing node in `seeds` until replace completes (same rule as Part 2).

**Ephemeral storage (e.g. EC2 i3)**

- Stop instance → data on ephemeral volumes is gone.
- Re-run RAID setup, append `replace_node_first_boot: <old-host-id>` to yaml, start Scylla ([Scylla replace doc](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)).
- Public/private IP may change after restart — update `listen_address` / `broadcast_address` if needed.

**Kubernetes (Scylla Operator)**

- Label the failed member Service with `scylla/replace=""` — Operator provisions a fresh pod with `--replace-node-first-boot` ([Operator doc](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)).

---

### Runbook at a glance

```
Pre-check: quorum OK, target DN, version match, Host ID noted, new data dir empty
  → Configure: cluster_name, seeds, snitch, replace_node_first_boot (Scylla Host ID)
  → Start new node (do NOT add to seeds yet)
  → Monitor: netstats (REPLACE), gossipinfo (new IP NORMAL)
  → Wait for UN in nodetool status
  → Repair? (max_hint_window, same-IP duration, RBNO off)
  → Update seed lists if dead node was a seed
  → Update app connection strings if IP changed
```

### Operation cheat sheet (Parts 2 + 3)

| Operation | When | Tokens | Post-op cleanup |
|-----------|------|--------|-----------------|
| bootstrap (Part 2) | Scale out | New random | **cleanup on old nodes** |
| **replace** (Part 3) | Dead node, same size | Inherit dead | None on peers |
| decommission | Planned removal (UN) | Redistributed | Manual wipe on removed node |
| removenode | Dead, shrink cluster | Redistributed | Repair before; node banned |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** When should you use replace instead of bootstrap, decommission, or removenode?
---
**Replace** when a node is **DN** and you want to **restore the same cluster size** — new hardware inherits the dead node's token ranges. **Bootstrap** is scale-out (new tokens). **Decommission** is planned removal of a live UN node. **Removenode** shrinks the cluster when replace is not the goal. **Wait** if the outage might be temporary.
:::

:::quiz
**Q2.** What do you set on Scylla vs Cassandra for replace, and what identifier do you use?
---
**Scylla:** `replace_node_first_boot: <dead Host ID>` in `scylla.yaml` — obsolete `replace_address*` not supported. **Cassandra:** `-Dcassandra.replace_address_first_boot=<dead node IP>` in JVM options — remove after success. Scylla uses **Host ID**; Cassandra uses the **dead node's IP** regardless of the new node's IP.
:::

:::quiz
**Q3.** Why does `nodetool status` look confusing during replace, and how do you monitor progress?
---
The replacing node is in **hibernate**: other nodes still see the **dead** entry (DN), while the new node sees itself UN. Use **`nodetool netstats`** for REPLACE/streaming progress; on Scylla also **`nodetool gossipinfo`** when the new IP is not yet in status. **`nodetool tasks list`** tracks RBNO jobs.
:::

:::quiz
**Q4.** When must you run repair after replace, and when can you skip it?
---
**Must repair** if the dead node was down longer than **`max_hint_window`** (default 3h) before replace, or if **same-IP** replace took longer than that window — missed hints are not replayed. **Skip** when Scylla **RBNO for replace** is enabled (row-level repair during the operation). Hinted handoff is best-effort and does not replace repair.
:::

:::quiz
**Q5.** How does replace differ from Part 2 bootstrap regarding tokens and cleanup?
---
**Bootstrap** assigns **new random** tokens and requires **`nodetool cleanup` on existing nodes** after UN. **Replace** **inherits** the dead node's tokens — no random allocation, **no peer cleanup** — and streams/RBNO data for those existing ranges to the new hardware.
:::

:::quiz
**Q6.** Same IP vs different IP replacement — what is the write-delivery difference?
---
A **different IP** replacement can **receive writes during bootstrap** (CASSANDRA-8523). **Same IP** replacement may **not** receive writes during bootstrap; if the outage or bootstrap exceeds **`max_hint_window`**, you **must repair** to catch missed writes.
:::

## Memo

Part 3 of the Cassandra/Scylla track — node replacement runbook after Part 2 boot join mechanics.
