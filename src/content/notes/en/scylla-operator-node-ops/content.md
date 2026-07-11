---
title: 'Cassandra & Scylla — Part 4: Scylla Operator Node Ops on K8s'
---

## References

- [Replace nodes (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)
- [Scale, add, remove racks (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/scale-add-remove-racks.html)
- [StatefulSets and racks (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html)
- [nodetool alternatives (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html)
- [Automatic data cleanup (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/management/data-cleanup.html)
- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)

---

## Why I looked this up

Follow-up from Part 3. We run Scylla on Kubernetes with the Operator — the control plane differs from the VM `scylla.yaml` + `systemctl` runbook even though the engine semantics are the same.

---

## What stood out

Part 3 is imperative (edit yaml, start service). Operator is declarative (label Service, patch `ScyllaCluster` spec) — and some nodetool commands become dangerous.

---

## What I learned

*Background: the senior engineer from Parts 2–3 now explains Scylla Operator as the Kubernetes control plane.*

---

### Act 1 — Same engine, different control plane

:::chat student AI Student
Part 3 taught replace with `replace_node_first_boot` in yaml. What changes on K8s?
:::

:::chat teacher Teacher
The **Scylla process** still does replace — inherit dead node's tokens, stream/RBNO from replicas (Part 3). What changes is **who triggers it**:

| Layer | VM / bare metal (Part 3) | Scylla Operator on K8s |
|-------|--------------------------|-------------------------|
| Trigger | Human edits `scylla.yaml`, starts service | Human labels **member Service** or patches **ScyllaCluster** spec |
| Storage | Empty data dir on new machine | Operator **deletes PVC**, StatefulSet creates fresh PVC |
| Replace flag | `replace_node_first_boot` in yaml | Operator injects `--replace-node-first-boot=<old Host ID>` |
| Cleanup | Manual `nodetool cleanup` (scale-out) | Operator spawns **cleanup Jobs** on ring change |
| Membership ops | `nodetool decommission` / `removenode` | **Forbidden** — desyncs Operator state |

Think: Part 3 = you drive. Part 4 = **Operator reconciles** desired state in Kubernetes.
:::

:::chat gon Gon
So the replace vs bootstrap vs decommission decision tree from Part 3 still applies?
:::

:::chat teacher Teacher
Yes for **when** — DN permanent failure → replace; planned shrink → decommission path; temporary down → wait. Only the **how** moves to Operator APIs.
:::

---

### Act 2 — Architecture: rack = StatefulSet

:::chat student AI Student
How does the Operator map Scylla topology to Kubernetes?
:::

:::chat teacher Teacher
Each **rack** = one **StatefulSet**. Pod ordinals are stable identity (`scylla-us-east-1a-0`, `-1`, `-2`). Each pod has a **member Service** (ClusterIP) the Operator tracks.

Implications ([StatefulSets and racks](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html)):

- **Scale up** — append pods at the **highest ordinal** (bootstrap, Part 2 semantics).
- **Scale down** — decommission **highest ordinal first**, one at a time.
- **Cannot remove ordinal 1** by changing `members` — StatefulSet only trims the tail. Mid-rack unhealthy node → **replace**, not scale-down.
:::

---

### Act 3 — Replace a dead node (Operator runbook)

:::chat student AI Student
Walk me through replace on a ScyllaCluster.
:::

:::chat teacher Teacher
From [Replace nodes](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html):

**1. Identify DN** — exec into a healthy pod:

```bash
kubectl -n scylla exec scylladb-us-east-1a-0 -c scylla -- nodetool status
```

**2. Map IP → member Service** — match DN node's IP to Service ClusterIP:

```bash
kubectl -n scylla get svc -l scylla/cluster=scylladb -o wide
```

**3. Drain K8s node** (if still present) — watch PDB (`ALLOWED DISRUPTIONS: 0` blocks drain). Skip if cloud instance already gone.

**4. Trigger replace** — one node at a time:

```bash
kubectl -n scylla label svc scylladb-us-east-1a-2 scylla/replace=""
```

Operator flow: record old **Host ID** → delete PVC + pod → StatefulSet recreates pod → Scylla starts with replace flag → streams from replicas → removes label when Ready.

**5. Wait** — pod Ready + cluster conditions:

```bash
kubectl -n scylla get pods -w
kubectl -n scylla wait --timeout=30m --for='condition=Progressing=False' scyllacluster/scylladb
kubectl -n scylla wait --timeout=30m --for='condition=Available=True' scyllacluster/scylladb
```

**6. Verify + repair** — all UN; Operator docs recommend `nodetool repair` (or Scylla Manager scheduled repair).
:::

:::chat student AI Student
Can the Operator replace without me labeling anything?
:::

:::chat teacher Teacher
Sometimes yes — **automatic orphaned node replacement**. If a K8s node is permanently removed (node pool scale-down, terminated instance), the PV orphans. The Operator's orphaned PV controller can auto-apply `scylla/replace=""` on the Service. Disable with `automaticOrphanedNodeCleanup: false` in `ScyllaCluster` spec.
:::

---

### Act 4 — Scale up / scale down (not replace)

:::chat student AI Student
I want to add capacity or remove the last node — not replace a dead one in the middle.
:::

:::chat teacher Teacher
Patch **`spec.datacenter.racks[].members`** ([Scale, add, remove racks](https://operator.docs.scylladb.com/stable/operate/scale-add-remove-racks.html)):

| Goal | Action |
|------|--------|
| Scale out | Increase `members` → new ordinal bootstraps (Part 2) |
| Scale in | Decrease `members` → Operator decommissions **highest ordinal** via sidecar |
| Remove entire rack | Set rack `members: 0`, wait, then delete rack from spec |

Scale-down sequence ([StatefulSets and racks](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html)):

1. Operator sets `scylla/decommissioned="false"` on member Service
2. Sidecar runs `nodetool decommission`
3. Sidecar sets `scylla/decommissioned="true"`
4. StatefulSet replicas -= 1, pod + PVC deleted

Wait for `ScyllaCluster` `Available=True` after patch. Do not scale below keyspace **RF**.
:::

:::chat student AI Student
Why can't I just run `nodetool decommission` myself?
:::

:::chat teacher Teacher
**High risk** — desyncs StatefulSet replica count and Operator labels ([nodetool alternatives](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html)). Operator won't know the node left; you get stuck rollouts or data loss. Same for **`removenode`** and **`move`** — use Operator scale-down or `scylla/replace` instead.
:::

---

### Act 5 — What nodetool is safe?

:::chat teacher Teacher
Rule of thumb from [nodetool alternatives](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html):

| Safe (read-only / low risk) | Use Operator instead (high risk) |
|-----------------------------|----------------------------------|
| `status`, `gossipinfo`, `netstats`, `ring`, `cfstats` | `decommission` → scale down `members` |
| `repair` (redundant if Manager configured) | `removenode` → `scylla/replace` label |
| `snapshot`, `compact`, `flush` | `disablegossip` / `disablebinary` → never |
| | `move` → not supported; use scaling |

**`cleanup`** — Operator runs it automatically via Jobs when token ring hash changes ([Automatic data cleanup](https://operator.docs.scylladb.com/stable/management/data-cleanup.html)). Manual cleanup only needed after **RF decrease** (Operator does not detect RF-only changes).

**`drain`** — automatic via pod `preStop` hook; don't invoke manually.
:::

---

### Act 6 — Automatic cleanup Jobs

:::chat student AI Student
Part 2 said run cleanup after scale-out. Does the Operator handle that?
:::

:::chat teacher Teacher
Yes. Operator tracks **token ring hash** per member Service. When ring changes (scale-out, scale-in, replace), it waits until cluster is stable (`Progressing=False`, `Available=True`, `Degraded=False`), then spawns one **cleanup Job** per affected node.

- Scale-out: cleanup on **existing** nodes (new node skips — hash initialized to match).
- Scale-in: cleanup on survivors (safe but extra I/O — they didn't lose tokens).
- Tablets keyspaces: server-side cleanup is no-op; Operator still triggers for vnode/system keyspaces.

Check progress: `JobControllerProgressing` condition on `ScyllaCluster`.
:::

---

### Act 7 — VM vs Operator cheat sheet

| Scenario | VM / bare metal (Part 3) | Scylla Operator (Part 4) |
|----------|--------------------------|---------------------------|
| Dead node, keep size | `replace_node_first_boot` + start | `kubectl label svc ... scylla/replace=""` |
| Scale out | add node procedure | `members++` in ScyllaCluster |
| Planned shrink | `nodetool decommission` | `members--` (tail ordinal) |
| Mid-rack pod unhealthy | replace (same) | `scylla/replace` label (not `members--`) |
| `nodetool removenode` | Last resort (Part 3) | **Do not use** |
| Post scale-out cleanup | manual `nodetool cleanup` | Operator cleanup Jobs |
| Monitor replace | `netstats`, `gossipinfo` | above + `kubectl get pods`, `ScyllaCluster` conditions |

### Operator replace pipeline

```
DN in nodetool status → map IP to member Service
  → (optional) kubectl drain K8s node — watch PDB
  → label svc scylla/replace=""
  → Operator: Host ID → delete PVC/pod → new pod + replace flag
  → stream/RBNO → pod Ready → label removed
  → nodetool status UN → repair (per Operator doc)
  → cleanup Jobs if ring hash changed
```

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What stays the same vs what changes between Part 3 VM replace and Operator replace?
---
**Same:** Scylla inherits dead node's tokens, streams/RBNO from replicas, DN-only trigger. **Different:** trigger is **`scylla/replace=""` on member Service** (not hand-edited yaml); Operator deletes PVC and recreates pod with `--replace-node-first-boot`; completion tracked via **pod Ready** and **ScyllaCluster conditions**.
:::

:::quiz
**Q2.** When do you use `scylla/replace` vs changing `members` in ScyllaCluster?
---
**Replace label** — a **specific unhealthy/dead** pod (any ordinal), keep cluster size. **`members` scale-down** — planned removal of the **highest ordinal** pod only; StatefulSet cannot drop a middle ordinal. Scale-up (`members++`) = bootstrap new tail pod.
:::

:::quiz
**Q3.** Why must you not run `nodetool decommission` or `removenode` directly under the Operator?
---
They change ring membership **without Operator knowledge**, desyncing StatefulSet replica count and tracking labels — leading to stuck rollouts, failed replacements, or data loss. Use **`members--`** for graceful shrink or **`scylla/replace`** for dead nodes instead.
:::

:::quiz
**Q4.** How does the Operator handle cleanup after scaling or replace?
---
It compares **token ring hash** to `last-cleaned-up-token-ring-hash` on each member Service. After the cluster is stable, it spawns **cleanup Jobs** per affected node. Manual cleanup is mainly needed after **RF decrease** (not auto-detected).
:::

:::quiz
**Q5.** What is automatic orphaned node replacement?
---
When a K8s node is permanently removed and the Scylla PV orphans, the Operator's controller can **auto-apply `scylla/replace=""`** on the member Service — no manual label. Controlled by `automaticOrphanedNodeCleanup` in `ScyllaCluster` spec.
:::

## Memo

Part 4 of the Cassandra/Scylla track — Operator control plane for replace, scale, and nodetool boundaries on Kubernetes.
