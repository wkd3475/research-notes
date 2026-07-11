---
title: 'Discord Superdisk — Hybrid Storage for Scylla on GCP'
---

## References

- [How Discord Supercharges Network Disks for Extreme Low Latency](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)
- [How Discord Migrated Trillions of Messages to ScyllaDB (The New Stack)](https://thenewstack.io/how-discord-migrated-trillions-of-messages-to-scylladb/)
- [Persistent Disk (Google Cloud)](https://cloud.google.com/compute/docs/disks/persistent-disks)
- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)
- [Rebuild a Node After Losing the Data Volume](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/rebuild-node.html)

---

## Why I looked this up

While studying node replacement and whether failed-node EBS can be reused, I came across **Superdisk** — not a GCP or Scylla product, but Discord's custom RAID stack for their Scylla message clusters.

---

## What stood out

It answers a different question than replace-runbook EBS reuse: not "skip streaming on replace," but "get NVMe read latency while keeping network persistent disk durability."

---

## What I learned

*Background: senior engineer explains Discord's Superdisk after the Part 3 EBS / replace discussion.*

---

### Act 1 — What is Superdisk?

:::chat student AI Student
Is Superdisk a Scylla feature or a GCP disk type?
:::

:::chat teacher Teacher
Neither. **Superdisk** (super-disk) is a name Discord gave their **in-house hybrid volume** on Google Cloud ([Discord blog](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)). Their ScyllaDB clusters sit on top of it.

Goal: combine

| Disk | GCP | Strength | Weakness |
|------|-----|----------|----------|
| Fast leg | **Local SSD** (NVMe instance store) | Sub-ms reads | No snapshots; host failure can wipe local data; reliability concerns alone |
| Durable leg | **Persistent Disk** (network block storage) | Snapshots, detach/attach, replicated | ~1–2 ms per op — queues at high QPS |

Discord's read-heavy chat workload hit **disk op queues** on Persistent Disk only — not because Scylla was slow, but because reads waited on slow I/O.
:::

:::chat gon Gon
On AWS that's like pairing instance-store NVMe with EBS?
:::

:::chat teacher Teacher
Conceptually yes:

| GCP (Discord) | AWS analogue |
|---------------|--------------|
| Persistent Disk | **EBS** |
| Local SSD | **Instance store NVMe** (e.g. i3) |
| Superdisk | **Custom Linux RAID** merging both — not a managed AWS/GCP SKU |

This is **not** the same as "reattach old EBS on replace" from Part 3 — it's a **day-to-day I/O architecture**, not a node-replacement shortcut.
:::

---

### Act 2 — How the RAID stack is built

:::chat student AI Student
How do they actually wire the disks together?
:::

:::chat teacher Teacher
Linux kernel **`md`** software RAID ([Discord blog](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)):

```
[Local SSD 375GB] ─┐
[Local SSD 375GB] ─┼─ RAID0  →  fast virtual volume (~TB scale)
[Local SSD 375GB] ─┘
                          │
                    RAID1 mirror
                          │
                 [Persistent Disk]
                    (write-mostly)
```

**Step 1 — RAID0 on Local SSDs:** GCP Local SSDs are fixed 375 GB; Discord needed 1 TB+. RAID0 stripes capacity and read parallelism. They accept RAID0 risk on the **fast leg only** — GCP may migrate the whole VM if any Local SSD fails, wiping all local SSDs anyway.

**Step 2 — RAID1 with Persistent Disk:** Mirror the RAID0 array to a Persistent Disk. Mark PD as **`write-mostly`** — kernel **reads from Local SSD** by default; PD is read only when the fast leg has no data. Writes go to **both** legs (write-through mirror).

They tried **dm-cache / bcache** first but bad sectors on Local SSD could fail the whole read and trigger Scylla shutdown (`Disk error … No data available`). RAID1 + write-mostly survives bad sectors by falling back to PD.
:::

---

### Act 3 — What problem it solves vs what it does not

:::chat student AI Student
Does Superdisk mean we can reuse disks on node replace?
:::

:::chat teacher Teacher
**No** — different layer.

| Question | Superdisk answer | Part 3 replace answer |
|----------|------------------|----------------------|
| How to get fast reads + durable writes daily? | RAID0 Local SSD + RAID1 PD | N/A |
| Failed node — reuse old disk to skip streaming? | **Still no** for replace | Empty data dir + `replace_node_first_boot` |
| Host dies, local SSD gone? | **PD leg still has data**; RAID can resync fast leg after recovery | Scylla **cluster** still has RF replicas; node may still need replace/rebuild |
| i3 stop = ephemeral wipe? | Superdisk is a **GCP PD + Local SSD** pattern; AWS i3 stop still wipes instance store — PD/EBS leg matters | Same replace/rebuild docs apply |

After Superdisk rollout, Discord saw **no growing disk read queue** at peak — same servers handled more QPS. The New Stack reports message read p99 improvements as part of the broader Cassandra → Scylla migration ([article](https://thenewstack.io/how-discord-migrated-trillions-of-messages-to-scylladb/)).

**Duplex I/O:** Discord also worked with Scylla on I/O path tweaks for this stack (split read/write channels) — implementation detail beyond the RAID layout.
:::

---

### Act 4 — Operations implications

:::chat student AI Student
If I run something Superdisk-like, what should I watch in ops?
:::

:::chat teacher Teacher
**1. RAID resync load** — After Local SSD leg loss, rebuilding from PD is heavy I/O; plan maintenance windows and monitor `md` sync progress.

**2. Replace runbook unchanged** — New instance + empty Scylla data dir + replace/bootstrap still applies when the **node** is DN and identity changes. Superdisk does not make "mount old PD with data" a supported replace path.

**3. Recovery vs replace** — If only the **fast leg** died but host + PD + same identity recoverable → RAID recovery + Scylla restart may suffice. If **host/identity** is gone and cluster marks DN → replace.

**4. Not for Scylla Operator default** — Operator assumes PVC volumes; Superdisk is bare-metal/VM **host-level** storage engineering.

**5. Discord part two** — Original blog promises a follow-up on cloud edge cases; the core RAID recipe is in the 2022 post.
:::

### Architecture at a glance

| Layer | Component |
|-------|-----------|
| Application | Discord chat services |
| Database | ScyllaDB (messages cluster) |
| Superdisk | md: RAID0 (Local SSDs) + RAID1 (PD, write-mostly) |
| Cloud | GCP Compute + Persistent Disk + Local SSD |

### Superdisk vs EBS reuse (cheat sheet)

| | Superdisk | EBS reattach on replace |
|--|-----------|-------------------------|
| Purpose | Performance + durability in steady state | Save streaming time on node swap |
| Official Scylla path? | Custom infra (not in docs) | **Not supported** on replace |
| Durability | PD/EBS leg of mirror | Single volume lifecycle |
| When disk survives host death | Resync fast leg from PD | Manual recovery **may** work; replace if DN |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** What is Superdisk?
---
Discord's **custom hybrid volume** on GCP: Linux `md` RAID combining **Local SSD (NVMe)** for fast reads and **Persistent Disk** for durability/snapshots. **Not** a Scylla feature or official GCP disk type.
:::

:::quiz
**Q2.** Describe the RAID layout and the role of `write-mostly`.
---
**RAID0** across multiple Local SSDs for capacity and parallel reads. **RAID1** mirrors that array to a **Persistent Disk** marked **write-mostly** — normal reads hit the fast leg; writes go to both; PD is read on fallback or resync.
:::

:::quiz
**Q3.** Why did Discord reject Persistent Disk-only and Local SSD-only?
---
**PD-only:** ~1–2 ms op latency → disk queues at millions of RPS. **Local SSD-only:** reliability concerns, no point-in-time disk snapshots, data gone on host migration. Superdisk takes PD durability with Local SSD read latency.
:::

:::quiz
**Q4.** Does Superdisk let you reuse a failed node's disk during Scylla replace?
---
**No.** Superdisk solves **steady-state I/O** (fast reads + durable writes). **Replace** still expects an **empty** data directory and streams/RBNO from replicas. PD/EBS survival helps **RAID recovery**, not skipping the replace protocol.
:::

:::quiz
**Q5.** What is the AWS analogue of Superdisk's two legs?
---
**Persistent Disk ≈ EBS** (network durable block storage). **Local SSD ≈ instance store NVMe** (e.g. i3). Superdisk ≈ **host-level RAID** merging both — custom ops, not a cloud SKU.
:::

## Memo

Storage-side note for the Cassandra/Scylla track — bridges Part 1 Discord context, Part 3 replace/EBS questions, and real-world Scylla tuning.
