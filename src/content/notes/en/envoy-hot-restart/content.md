---
title: 'Envoy hot restart (lecture 2)'
---

## References

- [Envoy hot restart — Matt Klein](https://blog.envoyproxy.io/envoy-hot-restart-1d16b14555b5)
- [Hot restart — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart)
- Parent: [Envoy threading model (lecture 1)](/research-notes/en/notes/envoy-threading-model/)
- [How Envoy Proxy Works Internally — Let's Build](https://letsbuildsolutions.com/blog/system-design/how-envoy-proxy-works-internally-xds-configuration-connection-pooling-and-the-filter-chain-architecture-behind-modern-service-meshes/)

---

## Why I looked this up

Wanted detailed Envoy material across several series, then asked to structure the notes like a teacher lecturing. Second lecture after threading.

---

## What stood out

No separate impressions left — just asked for lecture-style notes.

---

## What I learned

*Lecture 2. Once you know workers pin connections, the next ops question is: how do you replace the Envoy binary without dropping listen traffic?*

---

### Act 1 — Two ways to deploy without drops

:::chat student AI Student
Matt Klein starts with deploy philosophy. Why?
:::

:::chat teacher Teacher
Two families of zero-drop deploys:

| Approach | Idea |
|----------|------|
| **(1) Immutable / rolling** | New nodes, shift traffic (canary, % roll, blue/green), tear down old. Best when you have the orchestration. |
| **(2) In-place hot restart** | Same node, reload process without dropping existing connections. Simpler ops investment. |

Envoy often *helps* (1) as the mesh data plane (Istio traffic shifting). But **Envoy itself** also needs upgrades — and many fleets still need (2). So hot restart is a first-class design goal: appear as **one logical process** to the rest of the infra.
:::

---

### Act 2 — Architecture: two processes, one listen face

:::chat student AI Student
Walk the hot restart sequence.
:::

:::chat teacher Teacher
Docs + Matt Klein + modern summaries agree on this shape:

1. New Envoy starts (new epoch), attaches to coordination channels
2. New process **fully initializes** — config load, initial discovery / health checks — **before** it takes listen sockets
3. New process obtains **listen socket FDs** from the old process (UDS RPC) and begins accepting
4. Old process **drains**: stop new accepts (or stop taking work), finish or close existing connections over `--drain-time-s`
5. After drain / `--parent-shutdown-time-s`, old process exits

Critical detail from the docs:

> Existing connections are **not** transferred to the new process. They must finish during drain or be terminated.

So “zero downtime” means **listen continuity + graceful drain**, not magical migration of in-flight TCP sessions onto the new binary.
:::

:::chat student AI Student
How do the two processes talk if they might be in different containers?
:::

:::chat teacher Teacher
Only via **Unix domain sockets** (RPC) and historically **shared memory** for some shared state (especially stats in the original design). No trampoline that “restarts workers inside the same process” — that wouldn't work for immutable containers where old and new are separate.

Lyft used a small **hot-restarter wrapper** (Python in the tree: `restarter/hot-restarter.py`) so process managers (runit, etc.) see one parent; the wrapper hides multi-process epochs.
:::

---

### Act 3 — Stats during overlap, sockets, pitfalls

:::chat student AI Student
What happens to metrics while both processes are alive?
:::

:::chat teacher Teacher
Design goal: operators should still see **one logical Envoy**.

- Docs today: counters (and most gauges) are shipped old → new over UDS; gauges marked `NeverImport` are skipped; after finish, imported gauges are cleaned up; `server.hot_restart_generation` is retained
- Matt Klein's original post: raw stat memory in shared memory so both epochs share counter/gauge values — **lecture 3** covers how that evolved (shared-memory stats were later removed)

Either way: avoid a stats “black hole” during the overlap window.
:::

:::chat student AI Student
What about reuse_port and concurrency changes?
:::

:::chat teacher Teacher
On Linux, default `reuse_port` works with hot restart because sockets are passed **per worker index** — accept queues shouldn't drop in the common case.

Docs **Attention**: if concurrency **decreases** across restart, some connections in old workers' accept queues may drop. Increasing concurrency is fine.

Also: updating a listener's `socket_options` across hot restart isn't supported — old options stick; use full restart or LDS listener update. Hot restart is **not** supported on Windows.

Common production footgun (from ops write-ups): `--drain-time-s` shorter than P99 of long gRPC streams → hard kills mid-stream.
:::

---

### Cheat sheet

| Knob / idea | Role |
|-------------|------|
| `--drain-time-s` | How long old process drains; becomes more aggressive over time |
| `--parent-shutdown-time-s` | When new tells old to die — set **larger** than drain |
| `--base-id` / `--use-dynamic-base-id` | Multiple independent Envoy pairs on one host |
| Listen FDs | Passed over UDS after new process is ready |
| In-flight conns | Stay on old process until drain ends |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Does hot restart move existing TCP connections onto the new Envoy process?
---
No. Listen sockets are handed over so *new* accepts go to the new process; existing connections must complete or be closed during drain on the old process.
:::

:::quiz
**Q2.** Why was “container-friendly” hot restart a design constraint?
---
Old and new may run in separate immutable containers, so they can only coordinate via UDS (and historically shared memory) — not an in-process trampoline that restarts workers inside one PID.
:::

:::quiz
**Q3.** How should `--parent-shutdown-time-s` relate to `--drain-time-s`?
---
Parent shutdown should be set larger than drain time so the old process has time to drain before it is forced to exit.
:::

:::quiz
**Q4.** What goes wrong if drain time is shorter than long-lived stream P99?
---
The old process becomes aggressive / shuts down while streams are still open, so clients see resets even though listen handover itself succeeded.
:::

---

## Memo

Lecture-style series request — no extra memo.
