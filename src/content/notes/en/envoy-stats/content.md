---
title: 'Envoy stats subsystem (lecture 3)'
---

## References

- [Envoy stats — Matt Klein](https://blog.envoyproxy.io/envoy-stats-b65c7f363342)
- [Statistics — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/statistics)
- Parent: [Envoy hot restart (lecture 2)](/research-notes/en/notes/envoy-hot-restart/)
- Series start: [Envoy threading model (lecture 1)](/research-notes/en/notes/envoy-threading-model/)

---

## Why I looked this up

Wanted detailed Envoy material across several series, then asked to structure the notes like a teacher lecturing. Third Matt Klein architecture post.

---

## What stood out

No separate impressions left — just asked for lecture-style notes.

---

## What I learned

*Lecture 3. Threading + hot restart set up the hard part: emit tons of metrics without wrecking the data path, and keep numbers coherent while two processes overlap.*

---

### Act 1 — What Envoy emits

:::chat student AI Student
What kinds of stats exist?
:::

:::chat teacher Teacher
Three value types (docs):

| Type | Behavior | Example |
|------|----------|---------|
| **Counter** | Only increases | total requests |
| **Gauge** | Up and down | active requests |
| **Histogram** | Stream of samples → percentiles at the collector | upstream request time |

(Older “timers” became histograms — unit difference only.)

And three *categories* by where they come from:

| Category | About |
|----------|--------|
| **Downstream** | Incoming connections/requests (listeners, HCM, TCP proxy, …) |
| **Upstream** | Outgoing (pools, router, TCP proxy, …) |
| **Server** | The Envoy process itself (uptime, memory, …) |

One hop usually needs both downstream + upstream to understand that proxy. Mesh-wide, you stitch hops together.
:::

---

### Act 2 — Goals and architecture

:::chat student AI Student
What was Matt Klein optimizing for?
:::

:::chat teacher Teacher
The blog's goals (paraphrased): high cardinality / high volume, low overhead on the request path, usable admin dump, and — with hot restart — **consistent multi-process stats** so monitoring still sees one logical Envoy.

High-level pieces:

1. **Stat store** (singleton) — scopes, counters, gauges, histograms; scopes are refcounted; destroying a scope decrements contained stats
2. **Thread-local caching / atomics** — bump stats with atomics; avoid contended locks on every `inc()`
3. **Periodic flush** (main thread) — counters/gauges batched to sinks
4. **Stat sinks** — translate generic stats to backend wire formats (historically statsd; now pluggable, often with tags/dimensions)
5. **Admin `/stats`** — live dump of counters/gauges from the store (histogram visibility depends on era/implementation)

Histograms historically went **straight to sinks** (Lyft's statsd pipeline preferred that), so early admin dumps omitted them. Docs today still say counters/gauges are batched; histograms written as received.
:::

:::chat student AI Student
What's the big historical caveat on that Medium post?
:::

:::chat teacher Teacher
Edit at the top of the article: after [PR #5910](https://github.com/envoyproxy/envoy/pull/5910), **stats were removed from shared memory**. The shared-memory layout walkthrough is **historical context** for why hot restart and stats were co-designed — not a description of current storage.

Today's docs describe **UDS transport of counters/gauges** during hot restart instead. Read the post for the *problems they were solving*; verify current mechanics against docs + code.
:::

---

### Act 3 — Hot restart era design (why it mattered)

:::chat student AI Student
If shared memory stats are gone, why still study that design?
:::

:::chat teacher Teacher
Because the *requirements* remain:

- Workers must increment stats without serializing on one lock
- Main must flush sinks without stalling workers
- During epoch overlap, dashboards should not double-count or go blank
- Scopes come and go (listeners/clusters) → refcounting / lifecycle matters

Original design: fixed shared-memory slots for counter/gauge values, TLS caches in each process, dual refcounts (process-local + shared slot). Overflow → panic stat + overflow slot so the process degrades instead of dying.

Modern takeaway for operators: when you see weird gauge jumps across restart, check hot-restart import rules (`NeverImport`, `server.hot_restart_generation`) before blaming the app.
:::

:::chat student AI Student
Tags / dimensions?
:::

:::chat teacher Teacher
v2+ era: canonical stat names; dynamic segments can become **tags** via tag specifier config. Sinks may emit dimensional metrics. That's how you avoid exploding metric series names while still slicing by cluster, response code, etc.
:::

---

### Cheat sheet

| Topic | Takeaway |
|-------|----------|
| Types | counter / gauge / histogram |
| Path | atomic/TLS bump → flush → sink |
| Admin | `/stats` for live counters/gauges |
| Hot restart | coherent logical process; mechanism evolved (shm → UDS import) |
| Read the 2017 post | goals + pitfalls; check docs for current storage |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Counter vs gauge vs histogram — one line each?
---
Counter only increases; gauge moves up/down; histogram is a stream of samples aggregated into percentiles (e.g. latency).
:::

:::quiz
**Q2.** Why did early Envoy send histograms directly to sinks instead of keeping them in the store?
---
Development efficiency / Lyft's statsd pipeline preferred raw histogram samples there — so admin `/stats` historically lacked histogram data even though counters/gauges were in the store.
:::

:::quiz
**Q3.** Is Matt Klein's shared-memory stats layout still how Envoy works?
---
No. An edit on the post points to PR #5910 removing stats from shared memory. Treat that section as history; current hot restart moves counters/gauges over UDS per the docs.
:::

:::quiz
**Q4.** Downstream vs upstream stats — why both on one proxy hop?
---
Downstream describes what clients did to this Envoy; upstream describes what this Envoy did to backends. Together they explain that hop's health and where loss/latency entered.
:::

---

## Memo

Lecture-style series request — no extra memo.
