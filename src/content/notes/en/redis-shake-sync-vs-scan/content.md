---
title: 'redis-shake sync_reader vs scan_reader'
---

## References

- [Migration Mode Selection (RedisShake)](https://tair-opensource.github.io/RedisShake/en/guide/mode.html)
- [Sync Reader](https://tair-opensource.github.io/RedisShake/en/reader/sync_reader.html)
- [Scan Reader](https://tair-opensource.github.io/RedisShake/en/reader/scan_reader.html)
- [RedisShake README — limitations](https://github.com/tair-opensource/RedisShake)
- [ElastiCache — supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html)
- [Redis keyspace notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/)
- [SCAN command — guarantees](https://redis.io/docs/latest/commands/scan/)
- Parent: [ElastiCache Global Datastore vs redis-shake](/research-notes/en/notes/elasticache-global-datastore-vs-redis-shake/)

---

## Why I looked this up

Follow-up from [Global Datastore vs redis-shake](/research-notes/en/notes/elasticache-global-datastore-vs-redis-shake/): when PSync is unavailable on managed Redis, how **SCAN + KSN** differs from **replica-style sync**.

---

## What stood out

No extra impressions beyond that focus — map the two readers and where consistency / source load break.

---

## What I learned

*Parent note already said: prefer `sync_reader` (PSync), fall back to `scan_reader` when PSync is missing. This note is the **mechanism** — RDB+AOF replica stream vs SCAN+DUMP/RESTORE+pubsub, and the managed-Redis escape hatches (especially ElastiCache `aws_psync`).*

---

### Act 1 — Mode choice (ops first)

:::chat student AI Student
When do the RedisShake docs say to pick which reader?
:::

:::chat teacher Teacher
Three modes map to three readers (`mode` guide):

| Mode | Reader | Prefer when |
|------|--------|-------------|
| **PSync** | `sync_reader` | Default for **migration** if the source speaks PSync |
| **SCAN** | `scan_reader` | Cloud / engine **blocks PSync**, or you accept weaker consistency + higher source load |
| **RDB** | `rdb_reader` | Restore from a **backup file** (offline path) |

Docs also warn: RedisShake is **not** a long-term sync product. PSync reconnect after disconnect is unreliable; 4.x has **no checkpoint** and panics on topology change. For “forever sync,” even `scan_reader` is only a low-availability compromise when write volume is modest and large keys are rare.
:::

:::chat gon Gon
On managed Redis where PSync isn’t available — how is SCAN+KSN different from replica-style sync?
:::

:::chat teacher Teacher
Different **transport of truth**:

| | **`sync_reader` (replica-style)** | **`scan_reader` (SCAN + optional KSN)** |
|---|-----------------------------------|----------------------------------------|
| **How Shake attaches** | Pretends to be a **Slave** via PSync | Ordinary client: **SCAN** keys + **DUMP**/**RESTORE**; optional **pubsub** on key events |
| **Full sync** | Master sends **RDB** snapshot | Cursor walk of keyspace → DUMP each key → RESTORE on target |
| **Incremental** | Master’s **AOF / replication stream** (commands as they happen) | **KSN**: `psubscribe __keyevent@*__:*` → on event, DUMP that key again → RESTORE |
| **Consistency story** | Best in docs — stream is the master’s replication feed | Weaker — SCAN can miss/over-copy; KSN is fire-and-forget Pub/Sub; FLUSH\* invisible |
| **Source impact** | Replication path (fork/memory tradeoffs on some engines) | **DUMP is CPU-heavy**; docs show ~47% → ~91% CPU at ~150k write QPS with Shake on |

So SCAN+KSN is not “PSync with different commands.” It **re-reads values** after the fact instead of consuming the master’s ordered write stream.
:::

---

### Act 2 — sync_reader deep dive

:::chat student AI Student
Walk the sync_reader pipeline.
:::

:::chat teacher Teacher
From the Sync Reader page:

1. Shake opens a **replication connection** (Slave role) to the Master.
2. **Full:** Master ships an **RDB**; Shake stores it on disk, parses into Redis commands, writes them to the destination.
3. **Incremental:** Master continues with an **AOF-style replication stream**; Shake forwards those commands.

Config knobs:

```toml
[sync_reader]
cluster = false
address = "127.0.0.1:6379"
username = ""
password = ""
tls = false
sync_rdb = true   # false → skip full sync
sync_aof = true   # false → exit after full sync (no incremental)
```

Claimed advantages: **best consistency**, **minimal source impact** relative to SCAN/DUMP, and smoother cutover (“seamless switching”).

**Cluster:** set `cluster = true` — Shake runs `cluster nodes` and connects to shards.  
**Sentinel:** can resolve master from Sentinel config; if you point Sync at a Sentinel-managed **master**, Sentinel may treat Shake as a Slave — docs recommend sourcing from a **replica** in that setup.
:::

:::chat student AI Student
Why does ElastiCache need a special dance for sync_reader?
:::

:::chat teacher Teacher
ElastiCache **restricts** `psync` / `sync` / `replicaof` (and related) for the managed experience — see the restricted-commands list. So “just run sync_reader” fails with unknown command.

Official RedisShake cloud guide for **ElastiCache**:

1. Prefer still **`sync_reader`**.
2. Open a **support ticket** to enable PSync.
3. AWS returns **renamed** PSync commands (examples in docs: `xhma21yfkssync`, `nmfu2bl5osync`) — same semantics, different names.
4. Put them in advanced config as `aws_psync`:
   - Single node: `ip:port@cmd`
   - Cluster: **all** `ip:port@cmd` pairs, comma-separated

If the ticket is painful or blocked → **`scan_reader`**, accepting high source pressure.

**MemoryDB:** docs say **no PSync permission** → use `scan_reader` / `rdb_reader` only.

**Why vendors block PSync (mode guide):** engine forks, proxy architectures that can’t speak replication, security, and business incentives against easy off-cloud migration.
:::

---

### Act 3 — scan_reader: SCAN stage + KSN stage

:::chat student AI Student
How does scan_reader actually move data?
:::

:::chat teacher Teacher
Two stages (Scan Reader docs). Tip at the top: **performance and consistency are worse than sync_reader — prefer sync whenever possible.**

### SCAN stage (full) — on by default (`scan = true`)

1. `SCAN` walks keys (cursor-based; progress % is **approximate**, especially on non-Redis engines).
2. Per key: `DUMP` value → `RESTORE` on destination.

Redis **SCAN guarantees** (official SCAN page + Shake notes):

- Keys that **exist for the whole iteration** are returned **at least once**.
- Keys **created during** the iteration **may be missed**.
- Keys **deleted during** the iteration may still have been copied (stale on target).

That’s why SCAN-alone full sync is not a clean snapshot.

### KSN stage (incremental) — **off by default** (`ksn = false`)

Enable to cover keys missed/changed during SCAN. Important timing: KSN runs **in parallel with SCAN**, then keeps going until Shake exits — not “start after SCAN finishes.”

Mechanism:

1. Source must enable `notify-keyspace-events` containing **`AE`** (Keyevent + the `A` event class alias — docs: Redis defaults this **off**).
2. Shake `psubscribe`s `__keyevent@*__:*`.
3. On each event → DUMP that key from source → RESTORE to target.

| KSN gotcha | Why it hurts |
|------------|--------------|
| Pub/Sub is **fire-and-forget** | Disconnect ⇒ **lost events** (Redis keyspace docs) |
| Raise `client-output-buffer-limit pubsub` if source drops the subscriber | Buffer overflow kills the connection |
| **No events for `FLUSHALL` / `FLUSHDB`** | Target can keep stale data; ban those commands during migration |
| Cluster: keyspace events are **node-local** | Must subscribe on **each** node (Shake’s `cluster = true` path) |
| DUMP on every change | Sustained write traffic = sustained **CPU** on source |

Config:

```toml
[scan_reader]
cluster = false
address = "127.0.0.1:6379"
dbs = []          # non-cluster: optional DB filter e.g. [1,5,7]
scan = true
ksn = false       # set true for incremental
count = 1         # keys per SCAN iteration; start at 1, raise carefully
```

`count`: higher = faster full sync, **more** source pressure. Docs recommend start at **1** and ramp.
:::

:::chat student AI Student
Give the CPU / ops warning in numbers.
:::

:::chat teacher Teacher
Scan Reader “Performance Impact”: both stages use **DUMP** (CPU-intensive). Reference from the docs — source write QPS ≈ **150,000**, CPU ≈ **47%** without Shake → ≈ **91%** with Shake. KSN has **no throttle knob**; decide based on write volume. SCAN can at least tune `count`.
:::

---

### Act 4 — Side-by-side + pick sheet

:::chat student AI Student
Cheat sheet for choosing under managed Redis.
:::

:::chat teacher Teacher
| Question | Lean **`sync_reader`** | Lean **`scan_reader`** |
|----------|------------------------|------------------------|
| Source exposes real PSync (or ElastiCache renamed + `aws_psync`)? | Yes | — |
| MemoryDB / proxy mode / vendor blocks replication? | — | Yes |
| Need best consistency for cutover? | Yes | Only if you accept KSN gaps + FLUSH\* risk |
| Source CPU headroom tight / high write QPS? | Prefer sync | Dangerous — DUMP tax |
| Ticket for ElastiCache PSync feasible? | Do that first | Fallback |
| Offline RDB file only? | — | Use **`rdb_reader`**, not scan |

**Mental model from parent note, sharpened:**  
`sync_reader` ≈ tap the **replication bus**.  
`scan_reader` ≈ **poll + notify + re-DUMP** the keyspace — workable escape hatch, not a peer of replica sync.
:::

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Why do RedisShake docs prefer `sync_reader` whenever PSync exists?
---
It consumes the master’s **RDB + replication (AOF) stream** as a fake Slave — best consistency and lower source impact than SCAN/DUMP. `scan_reader` is explicitly worse on both axes and is the fallback when PSync is blocked.
:::

:::quiz
**Q2.** How does SCAN+KSN differ from replica-style incremental sync?
---
Replica-style forwards the ordered **write stream**. SCAN+KSN **re-reads keys**: SCAN/DUMP/RESTORE for full, and on keyspace events DUMP/RESTORE again. Pub/Sub can drop events; SCAN can miss new keys; FLUSHALL/FLUSHDB emit no KSN events.
:::

:::quiz
**Q3.** What must be true on the source before `ksn = true` works?
---
`notify-keyspace-events` must include **`AE`** (disabled by default). Shake then `psubscribe`s `__keyevent@*__:*`. Also avoid FLUSHALL/FLUSHDB; consider raising `client-output-buffer-limit pubsub` if the subscriber is disconnected.
:::

:::quiz
**Q4.** ElastiCache blocks `psync` — what’s the preferred RedisShake path before falling back to scan?
---
Open a support ticket for PSync; AWS returns **renamed** PSync commands; configure `aws_psync` as `ip:port@cmd` (all shard pairs for cluster). Use `scan_reader` only if that path is unavailable — and expect heavy DUMP CPU on the source.
:::

:::quiz
**Q5.** Why is `ksn` default **false**, and when does KSN run relative to SCAN?
---
KSN adds continuous DUMP load and Pub/Sub fragility, so it’s opt-in. When enabled, it runs **concurrently with SCAN** (catching mid-scan changes), then continues until Shake exits — not only after SCAN completes.
:::

---

## Memo

—
