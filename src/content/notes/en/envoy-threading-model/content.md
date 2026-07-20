---
title: 'Envoy threading model (lecture 1)'
---

## References

- [Envoy threading model — Matt Klein](https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310)
- [Threading model — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/intro/threading_model)
- [How Envoy Proxy Works Internally — Let's Build](https://letsbuildsolutions.com/blog/system-design/how-envoy-proxy-works-internally-xds-configuration-connection-pooling-and-the-filter-chain-architecture-behind-modern-service-meshes/)

---

## Why I looked this up

Wanted detailed Envoy material across several series, then asked to structure the notes like a teacher lecturing.

---

## What stood out

No separate impressions left — just asked for lecture-style notes.

---

## What I learned

*Opening lecture for the Envoy series. Goal: understand why the data path can stay nearly lock-free, and what that costs.*

---

### Act 1 — Three kinds of threads

:::chat student AI Student
What's Envoy's threading model in one sentence?
:::

:::chat teacher Teacher
**Single process, multiple threads**, mostly non-blocking. One process owns many event loops so it can handle huge connection counts without forking a process per connection.
:::

:::chat student AI Student
What are the thread types?
:::

:::chat teacher Teacher
Official docs + Matt Klein's post line up like this:

| Thread | Job |
|--------|-----|
| **Main** | Coordination: xDS / config, cluster membership, stats flush, admin API. Not the high-volume data path. |
| **Workers** (`--concurrency`) | Listen, accept, run filter chains, forward. Default tip: one worker per hardware thread. |
| **File flusher** | Access-log flush to disk so workers don't block on disk I/O. |

Each main and worker thread runs an `Event::Dispatcher` (libevent wrapper): FDs, timers, (on main) signals. Code is written as single-threaded callbacks — no blocking waits on the hot path.
:::

---

### Act 2 — Connection pinning

:::chat student AI Student
Who accepts the connection, and does it move threads later?
:::

:::chat teacher Teacher
By default **every worker listens on every listener**. The **kernel** balances accepts across workers (no Envoy-side shard of listen sockets in the classic model).

Once a worker accepts a connection, that connection is **pinned** for life:

- All further I/O and forwarding stay on that worker
- No handoff to a “freer” worker mid-connection

Implications:

1. Hot path stays parallel and mostly lock-free
2. Cache locality is good
3. A slow worker **cannot** shed an already-pinned connection
4. Long-lived multiplexed links (HTTP/2 / gRPC) can imbalance workers — one fat connection hammers one worker

Docs note: for workloads with few very long-lived connections, configure **listener connection balancing** so Envoy forcibly spreads accepts. On Windows, Envoy enforces balancing because the kernel model doesn't balance well with Envoy's async I/O.
:::

:::chat student AI Student
Do workers share upstream connections?
:::

:::chat teacher Teacher
No. Each worker keeps **its own** upstream pools per cluster. Worker 3 talking to `payments` uses worker 3's pool only. Up to roughly **N workers × pool size** sockets toward the same upstream host — tune or you waste FDs and memory. Matt Klein's design explicitly trades some waste for programming simplicity and parallelism.
:::

---

### Act 3 — TLS slots and RCU-style updates

:::chat student AI Student
Main thread updates clusters via xDS. How do workers see that without locking every request?
:::

:::chat teacher Teacher
**Thread Local Storage (TLS)** — not the TLS crypto kind.

1. Main allocates a **slot** (index into a per-thread vector)
2. Main does heavy work (CDS/EDS, DNS, health check results)
3. Main **posts** a closure to every worker's dispatcher
4. Between work events (quiescent period), each worker installs the new thread-local view
5. While a worker is mid-request, it never sees the slot mutate underfoot — RCU-like

So workers read cluster/endpoint state **without taking a lock per request**. Most filter code can pretend it's single-threaded.
:::

:::chat student AI Student
Is Envoy truly lock-free everywhere?
:::

:::chat teacher Teacher
No. Matt Klein is explicit: code *assumes* non-blocking, but there are a few **process-wide locks** (e.g. central stat store access in older designs). The rule of thumb: never put a contended lock on the per-request path; push coordination to main + TLS publish.
:::

---

### Cheat sheet

| Idea | Remember |
|------|----------|
| Process model | One process, N workers + main (+ log flusher) |
| Accept | Kernel balances; connection stays on one worker |
| Config path | Main → post → worker TLS slot |
| Cost | Extra upstream sockets / memory if concurrency is high |
| Tuning knob | `--concurrency`, listener connection balancing |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** After worker W accepts a downstream TCP connection, can another worker process later requests on that same connection?
---
No. The connection is pinned to W for its lifetime — all I/O and forwarding stay there. That is why HTTP/2/gRPC “fat” connections can skew load across workers.
:::

:::quiz
**Q2.** How does the main thread publish a cluster membership change so workers don't lock on every request?
---
Via Thread Local Storage slots: main posts an update to each worker's dispatcher; workers install the new view between events (RCU-like). Request path reads the thread-local snapshot without a per-request lock.
:::

:::quiz
**Q3.** Why might you enable listener connection balancing even though the kernel already spreads accepts?
---
With few long-lived multiplexed connections, kernel balancing can leave one worker overloaded. Explicit listener connection balancing forcibly spreads accepts across workers (with some cost; Windows enforces it).
:::

:::quiz
**Q4.** What is the memory/connection tradeoff of Envoy's threading model?
---
Workers do not share upstream pools, so N workers can open up to ~N × pool_size connections to the same upstream. The design favors simple lock-free data-path code and high parallelism over minimal socket/memory use.
:::

---

## Memo

Lecture-style series request — no extra memo.
