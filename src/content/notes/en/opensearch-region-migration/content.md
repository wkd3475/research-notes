---
title: 'Amazon OpenSearch Service — Region migration options'
---

## References

- [Cross-cluster replication for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/replication.html)
- [Creating index snapshots in Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshots.html)
- [Registering a manual snapshot repository](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshot-registerdirectory.html)
- [Migrating indexes using remote reindex](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/remote-reindex.html)
- [Tutorial: Migrating to Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/migration.html)
- [Snapshot + restore DR (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/achieve-data-resilience-using-amazon-opensearch-service-disaster-recovery-with-snapshot-and-restore/)
- [Manual snapshots across Regions and accounts (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/take-manual-snapshots-and-restore-in-a-different-domain-spanning-across-various-regions-and-accounts-in-amazon-opensearch-service/)
- [CCR with OpenSearch Service (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/ensure-availability-of-your-data-using-cross-cluster-replication-with-amazon-opensearch-service/)
- [AWS Prescriptive Guidance — OpenSearch migration cutover](https://docs.aws.amazon.com/prescriptive-guidance/latest/opensearch-service-migration/stage-5-cutover.html)
- [Making configuration changes (blue/green within a domain)](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-configuration-changes.html)

---

## Why I looked this up

Wanted to dig into **how to move an Amazon OpenSearch Service domain to another AWS Region** — options, trade-offs (RPO/RTO/cost), and cutover details — before picking a migration path.

---

## What stood out

No extra impressions beyond that focus — map the main Region-move patterns and where each one breaks.

---

## What I learned

*There is no Aurora-style “Global Database switchover” for OpenSearch Service. A Region move means **a new domain in the target Region** plus a data-sync + client-cutover plan.*

---

### Act 1 — Four patterns (planned migration)

:::chat student AI Student
What’s on the table if I’m moving an OpenSearch domain from Region A to Region B?
:::

:::chat teacher Teacher
Four practical patterns show up in AWS docs and migration guides. Domain **blue/green** only applies to **config changes inside one domain** — it is **not** a cross-Region move.

| Pattern | Sync model | Typical RPO | Typical RTO / downtime | Cost shape |
|---------|------------|-------------|------------------------|------------|
| **1. Snapshot → S3 → restore** | Point-in-time backup | Snapshot interval (minutes–hours) | Restore time (often hours for large clusters) + domain provision | Lowest steady-state (no hot standby required) |
| **2. Cross-cluster replication (CCR)** | Near-continuous pull (follower polls leader) | Usually **&lt; 1 minute** lag | **Stop** replication → treat follower as writeable; short cutover | **Two domains** (leader + follower) + cross-Region data transfer |
| **3. Remote reindex** | One-shot (or repeated) HTTP copy of docs | At end of last reindex | Reindex duration + any delta catch-up | Source + target domains online during copy; network heavy |
| **4. Dual-ingest / rebuild from source** | Pipeline writes to both (or rebuild target from CDC/logs) | Near-zero if dual-write is correct | App/pipeline flip | Often cheapest **if** OpenSearch is derived data |

Pick by **whether the domain is source of truth** and by **how much downtime / lag you can accept**.
:::

:::chat student AI Student
When is dual-ingest actually better than copying the cluster?
:::

:::chat teacher Teacher
When OpenSearch is a **projection** of something else — application logs, queue events, or a search index built from a database — the source of truth is upstream. For those workloads, AWS’s cutover guidance often prefers: build the target from source (or dual-write), validate queries, then **point ingestion and clients** at the new domain. Copying terabytes of log history may be unnecessary if retention windows are short and rebuildable.
:::

---

### Act 2 — Snapshot / restore (cheapest, slowest)

:::chat student AI Student
Walk through snapshot-based Region migration.
:::

:::chat teacher Teacher
High-level flow (AWS DR + multi-Region snapshot blogs):

1. Create **manual snapshot repository** on the source domain → S3 bucket (normally **same Region** as the source domain).
2. Take a **manual snapshot** (`PUT _snapshot/repo/name`). Automated hourly snapshots exist, but they are for **domain recovery**, not a portable migration path you control the same way.
3. Get snapshot bytes into the **target Region**:
   - **Preferred ops pattern:** S3 **Cross-Region Replication (CRR)** (or copy) into a bucket in the target Region, **or**
   - Register the source bucket from the target domain using `"endpoint": "s3.amazonaws.com"` when the bucket is in another Region (migration note in the [register repository](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshot-registerdirectory.html) docs).
4. Provision the **new domain** in Region B (IaC: FGAC, encryption, instance types, custom packages…).
5. Register the snapshot repo on the target (`readonly: true` if you must not overwrite the source repo).
6. `POST _snapshot/repo/snap/_restore` — often with `indices` filters excluding `-.kibana*`, `-.opendistro*`, and `include_global_state: false`.
7. Validate shard recovery (`_cat/recovery`), search/query parity, then **cut over** clients (Route 53 / config / secrets) and retarget ingest.

| Gotcha | Detail |
|--------|--------|
| Snapshot ≠ instant PIT | Snapshots take time; docs indexed during the snapshot are **usually not** included |
| Version compatibility | Snapshots are **forward-compatible**, roughly **one major version**; minor versions also matter |
| Security indexes | Don’t blindly restore security / Dashboards system indexes across domains |
| Multi-account | Needs IAM snapshot roles, `manage_snapshots` mapping, and destination bucket policies |
| Custom packages / analyzers | Must exist on the target **before** restore or index settings may fail |

Steady-state DR variant: keep scheduled manual snapshots flowing via Lambda/SM into a secondary-Region bucket; on disaster, **create domain + restore**. That is active-passive backup — not live sync.
:::

:::chat student AI Student
Is “restore straight from the other Region’s S3” allowed?
:::

:::chat teacher Teacher
**Yes, with the right repository settings** — AWS docs say for a different-Region bucket, replace `"region"` with `"endpoint": "s3.amazonaws.com"`. Many runbooks still prefer **S3 CRR into a same-Region bucket** so the target domain’s snapshot role stays simple and latency/permissions are local. The blog pattern “bucket must be in the same Region as the domain” is about **taking** snapshots into a local bucket; **restore migration** documents the cross-Region registration path explicitly.
:::

---

### Act 3 — CCR (near-real-time standby)

:::chat student AI Student
How does CCR help a planned Region move?
:::

:::chat teacher Teacher
CCR is **active-passive**: a **follower** domain pulls user indexes, mappings, and metadata from a **leader**. Connection is requested from the **follower** (pull model). Supports **same or different Regions** (and accounts via remote ARN). Engine: Elasticsearch **7.10+** or OpenSearch **1.1+**. Needs **FGAC**, **node-to-node encryption**, and `index.soft_deletes.enabled = true` on leader indexes.

For a **planned migration**:

1. Create domain in Region B; open **cross-cluster connection** (follower → leader).
2. Start per-index replication or **auto-follow** (`log-*`, etc.).
3. Wait until `_status` shows **SYNCING** and leader/follower checkpoints align.
4. Quiet writes (or dual-write briefly), confirm lag.
5. **`_stop` replication** on the follower → follower index becomes a normal writable index.
6. Point **writes + reads** at Region B.
7. Decommission Region A when satisfied.

Typical delivery lag is **under a minute** when healthy. You pay **cross-Region data transfer** plus a second domain for the whole warm-up window.
:::

:::chat student AI Student
What breaks CCR in practice?
:::

:::chat teacher Teacher
Official and blog limitations that matter for Region moves:

| Limit | Why it hurts migration |
|-------|------------------------|
| **No automatic failover / role swap** | You must **stop** replication and promote operationally; AWS does not flip write leadership for you |
| **Pause &gt; 12 hours** | Must stop, delete follower index, **restart** replication from scratch |
| **Stop is one-way** | You cannot “restart” the same follower relationship after `_stop` |
| **Cannot reverse on the same index** | To reverse Region (new leader ← old leader), **delete** the old index and bootstrap CCR the other way — full re-sync |
| **UltraWarm / cold** | Not replicated — both sides must be **hot** |
| **M3 / T2 / T3** | Unsupported |
| **Self-managed ↔ Service** | Not supported |
| **Follower → another follower** | Not supported (fan-out only from one leader) |
| **SEARCH_ONLY connections** | Old cross-cluster **search** connection cannot be reused for replication — delete and recreate |
| **Default ↔ opt-in Regions** | CCR not supported across that mix |

After a disaster-style stop: if the old leader comes back, you **cannot** “delta-sync back” onto the old index. Delete + reverse CCR (or snapshot/restore) is the path — expensive for large indexes.
:::

---

### Act 4 — Remote reindex

:::chat student AI Student
Where does remote reindex fit vs CCR and snapshots?
:::

:::chat teacher Teacher
Remote reindex (`POST _reindex` with `source.remote`) **copies documents** from a remote cluster into the local (destination) domain. Good for **selective** indexes, version upgrades within supported ranges, or one-time moves when you don’t want snapshot/S3 plumbing.

Cross-Region: pass `"region": "eu-west-1"` (example) in `source.remote`. Local domain must be OpenSearch **1.0+** or Elasticsearch **6.7+**; remote major version ≤ local.

| Scenario | Feasibility |
|----------|-------------|
| Public domains, different Regions | Supported with `region` |
| Both domains in **same Region VPC** | Prefer **VPC endpoint connection** (PrivateLink), then reindex via connection endpoint |
| **Cross-Region VPC → VPC** | Built-in VPC endpoint connection is **same-Region only**. Cross-Region usually needs a **public CA-signed proxy** (or redesign to public/snapshot/CCR) |
| T2/T3 data nodes | Remote reindex **not** allowed |
| Very large corpora | Tune `scroll`, `socket_timeout`, batch `size`; set `refresh_interval: -1`, `number_of_replicas: 0` on dest, then restore settings — **no slicing** support for remote |

Remote reindex alone is a **batch copy**, not continuous replication. For a live migration you still need a **delta plan**: freeze ingest → final reindex, or dual-write during backfill, or CCR after an initial seed.
:::

---

### Act 5 — Choosing for a *planned* Region migration

:::chat student AI Student
Give me a decision cheat sheet.
:::

:::chat teacher Teacher
| Your situation | Lean toward |
|----------------|-------------|
| Can tolerate hours of read-only / downtime; want lowest cost | **Snapshot → restore** |
| Need near-zero lag and short cutover; OK paying for two domains | **CCR**, then `_stop` + cutover |
| Few indexes / selective docs; public endpoints OK | **Remote reindex** (+ delta strategy) |
| Logs / search built from upstream; retention rebuildable | **Dual-ingest or rebuild**, then flip |
| UltraWarm/cold heavy | Snapshot (or warm → hot first); **not CCR** on warm/cold |
| VPC-only, cross-Region | Prefer **snapshot/S3** or CCR; remote reindex needs extra network design |
| Multi-account | All three storage paths work with extra IAM/bucket policy; CCR supports remote ARN |

**Planned migration checklist (any path):**

1. Target domain sized and config-matched (plugins, custom packages, FGAC roles, ISM policies).
2. Network path for apps/ingest to Region B (VPC peering/TGW, PrivateLink, DNS).
3. Data sync method + measured lag / restore time in a rehearsal.
4. Ingest switch plan (pause, dual-write, or CDC replay).
5. Client endpoint switch (Route 53 alias, config service, secret rotation) — **DNS TTL** on clients still matters.
6. Validation: doc counts, `_cat/indices`, sample queries, alerting, Dashboards tenancy.
7. Rollback: keep source domain writable until soak period ends.
:::

:::chat student AI Student
One-line mental model?
:::

:::chat teacher Teacher
**OpenSearch Region migration = new domain + (snapshot \| CCR \| reindex \| rebuild) + client/ingest flip.** There is no managed global writer endpoint that moves with you — you own cutover the same way you would for a second self-managed cluster.
:::

---

### Comparison (at a glance)

| | Snapshot/restore | CCR | Remote reindex | Dual-ingest / rebuild |
|--|------------------|-----|----------------|------------------------|
| Continuity | Batch | Continuous pull | Batch | Continuous at pipeline |
| Write promotion | N/A (new domain empty until restore) | Manual `_stop` | N/A | Pipeline already writing |
| Best for | Cost-sensitive DR / cold move | Hot standby + short cutover | Selective / versioned copy | Derived / ephemeral data |
| Hard fail cases | Long RTO on huge clusters | Warm/cold, auto failover myth | Cross-Region VPC PrivateLink limit | Only if source of truth is upstream |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Why can’t you treat OpenSearch Service blue/green deployment as a Region migration tool?
---
Blue/green in OpenSearch Service is how **configuration/version changes** are applied **inside one domain** (temporary second environment, then switch). It does not create or move a domain to another AWS Region. Cross-Region moves need a **separate domain** plus snapshot, CCR, reindex, or rebuild.
:::

:::quiz
**Q2.** For CCR, what must you do before the follower can accept writes, and what happens if you only pause for more than 12 hours?
---
You must **`_stop` replication** so the follower index unfollows the leader and becomes a normal index (there is no managed auto-promotion). If you only **`_pause`** for **more than 12 hours**, you cannot safely resume — you must stop, delete the follower index, and restart replication from scratch.
:::

:::quiz
**Q3.** Snapshot restore across Regions: does the target domain have to use an S3 bucket in its own Region?
---
**Not strictly.** AWS docs allow registering a repository against a bucket in another Region using `"endpoint": "s3.amazonaws.com"`. Many operational designs still use **S3 CRR** into a **same-Region** bucket for simpler IAM and restore behavior. Taking snapshots usually targets a bucket in the **source** domain’s Region.
:::

:::quiz
**Q4.** When is dual-ingest preferential to CCR or snapshot for a Region move?
---
When OpenSearch holds **derived** data (logs, events, search docs built from a database) and the **source of truth is upstream**. Dual-writing or rebuilding the target, then flipping clients/ingest, often beats shipping large historical indexes — especially with short retention.
:::

:::quiz
**Q5.** Which remote-reindex networking constraint most often blocks a VPC-to-VPC cross-Region migration?
---
The native **VPC endpoint (PrivateLink) connection** used for remote reindex requires **both domains in the same Region**. Cross-Region VPC-to-VPC typically needs a **public CA-signed proxy** (or a different migration method such as snapshot/CCR).
:::

---

## Memo

(Investigation notes — pick a path after matching workload type to RPO/RTO/cost.)
