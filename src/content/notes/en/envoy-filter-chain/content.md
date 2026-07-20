---
title: 'Envoy filter chain and network filters (lecture 4)'
---

## References

- [How to Write Envoy Filters Like a Ninja! — Part 1](https://blog.envoyproxy.io/how-to-write-envoy-filters-like-a-ninja-part-1-d166e5abec09)
- [Taming a Network Filter](https://blog.envoyproxy.io/taming-a-network-filter-44adcf91517)
- [Life of a request — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request)
- [HTTP connection management — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_connection_management)
- Series: [threading](/research-notes/en/notes/envoy-threading-model/) · [hot restart](/research-notes/en/notes/envoy-hot-restart/) · [stats](/research-notes/en/notes/envoy-stats/)

---

## Why I looked this up

Wanted detailed Envoy material across several series, then asked to structure the notes like a teacher lecturing. Filter series after the architecture lectures.

---

## What stood out

No separate impressions left — just asked for lecture-style notes.

---

## What I learned

*Lecture 4. Workers pin connections; filters are what actually run on those connections.*

---

### Act 1 — Three filter layers

:::chat student AI Student
What's the hierarchy?
:::

:::chat teacher Teacher
Part 1 of the Ninja series:

| Layer | When / what |
|-------|-------------|
| **Listener filters** | Early connection phase — raw bytes + metadata (e.g. TLS Inspector: is it TLS? parse SNI) |
| **Network filters** | L4 / TCP payload both directions (e.g. TCP Proxy, and **HTTP Connection Manager**) |
| **HTTP filters** | L7 — created by HCM; requests/responses (JWT, RBAC, router, transcoder, …) |

Pipeline sketch:

```
Downstream TCP
  → Listener (bind / accept)
    → Filter-chain match (SNI, ALPN, source IP, …)
      → Network filters
        → (optional) HCM → HTTP filters → Router
          → Cluster → LB → Connection pool → Upstream
```

HCM is “just” a network filter — that's why you must understand network filters before HTTP filters.
:::

---

### Act 2 — Stateful chain, read vs write

:::chat student AI Student
How is an Envoy filter different from a typical servlet Filter?
:::

:::chat teacher Teacher
**Stateful per connection.** A new network-filter instance is allocated for each connection — not a stateless singleton.

Directions:

- **Read path**: Downstream → Envoy → Upstream
- **Write path**: Upstream → Envoy → Downstream

Callbacks (network filter): `onNewConnection`, `onData`, `onWrite`, plus connection events. Returning **`StopIteration`** means: don't call *later* filters **in this iteration cycle** — not “freeze the connection forever.”

Next chunk of data starts a **new** iteration. If you're waiting on an external auth call, you must keep returning `StopIteration` from `onData`/`onWrite` until ready.
:::

:::chat student AI Student
What's the read-buffer gotcha?
:::

:::chat teacher Teacher
On the read path Envoy buffers. A filter may see the **same bytes again** in a later `onData` if earlier filters didn't drain. Default read buffer limit ~**1MiB** — beyond that Envoy stops reading the socket (backpressure).

Write path has no symmetric “write buffer that re-presents data to filters.” `StopIteration` on write **drops** that iteration's data from further filters' perspective — different semantics than read.
:::

---

### Act 3 — Flow control and practical patterns

:::chat student AI Student
What is flow control / backpressure here?
:::

:::chat teacher Teacher
If the downstream connection's write buffer is full, stop reading more from upstream (and symmetrically the other way). Terminal proxies (TCP Proxy / HCM) own much of this; custom filters that inject or hold data must respect the same idea or they become buffer bombs.
:::

:::chat student AI Student
Useful patterns from “Taming a Network Filter”?
:::

:::chat teacher Teacher
1. **Gatekeeping** (RBAC, ext_authz, rate limit): allow/deny without parsing app protocols. Careful with TLS — `onNewConnection` may run **before** handshake finishes; wait for `onEvent(Connected)` when you need peer cert / TLS metadata.

2. **Protocol stats / metadata** (Mongo, MySQL, Kafka, …): parse for metrics/metadata, leave routing to TCP Proxy. Assume `onData` chunks are new only if a later filter (usually TCP Proxy) **drains** the read buffer. Inserting a random filter between parser and TCP Proxy can break that assumption.

3. **Traffic reshaping** (fault injection / throttle): delay when the next chunk is forwarded — often timer + `injectReadDataToFilterChain` / continue APIs.

4. **Terminal proxy**: TCP Proxy / HCM last in chain — opens upstream and forwards. Gatekeepers that `StopIteration` on `onNewConnection` before TCP Proxy runs can stall reads; returning `Continue` too early can make TCP Proxy connect upstream before auth finishes. Classic sharp edge.
:::

---

### Cheat sheet

| Idea | Remember |
|------|----------|
| HCM | Network filter that owns HTTP filter chain |
| StopIteration | Per iteration, not permanent pause |
| Read buffer | May re-deliver; 1MiB stop-read |
| Connected event | After TLS handshake — for TLS-aware gatekeepers |
| Parser + TCP Proxy | Keep them adjacent if parser assumes drained buffer |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Why study network filters before HTTP filters?
---
HTTP support is implemented as the HTTP Connection Manager network filter. HTTP filters only exist inside HCM's sub-pipeline.
:::

:::quiz
**Q2.** Does `StopIteration` freeze the connection until the filter says continue?
---
No. It only skips later filters for the current iteration. The next I/O event starts a new iteration; waiting filters must keep stopping until their condition is met.
:::

:::quiz
**Q3.** Why might a TLS client-auth filter be wrong to call an external service from `onNewConnection`?
---
TLS handshake may not be finished yet. Wait for `onEvent(Connected)`, which fires after a successful handshake, before depending on TLS metadata.
:::

:::quiz
**Q4.** What goes wrong if you insert an arbitrary filter between a Mongo stats filter and TCP Proxy?
---
The stats filter may assume each `onData` is a fresh chunk after prior data was drained. A middle filter that doesn't drain can cause duplicate/partial views and broken parsing.
:::

---

## Memo

Lecture-style series request — no extra memo.
