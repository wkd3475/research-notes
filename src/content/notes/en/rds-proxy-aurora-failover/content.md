---
title: 'RDS Proxy and Aurora failover architecture'
---

## References

- [RDS Proxy concepts and terminology](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.howitworks.html)
- [Amazon RDS Proxy for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html)
- [Working with Amazon RDS Proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-endpoints.html)
- [Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-pinning.html)
- [Using RDS Proxy with Aurora global databases](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-gdb.html)
- [Improving application availability with Amazon RDS Proxy](https://aws.amazon.com/blogs/database/improving-application-availability-with-amazon-rds-proxy/)
- [Improve application availability on Amazon Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/)
- [Using the Failover Plugin (AWS Advanced JDBC Wrapper)](https://github.com/aws/aws-advanced-jdbc-wrapper/blob/main/docs/using-the-jdbc-driver/using-plugins/UsingTheFailoverPlugin.md)
- [Introducing the Advanced JDBC Wrapper Driver](https://aws.amazon.com/blogs/database/introducing-the-advanced-jdbc-wrapper-driver-for-amazon-aurora/)
- Prior note: [JDBC failover detection and minimal downtime](/research-notes/en/notes/jdbc-failover-minimal-downtime/)

---

## Why I looked this up

Follow-up from [JDBC failover detection and minimal downtime](/research-notes/en/notes/jdbc-failover-minimal-downtime/). Wanted to understand how **RDS Proxy bypasses DNS**, **preserves idle connections** during Aurora failover, and how that compares to the **AWS JDBC Wrapper**.

---

## What stood out

No extra impressions beyond that focus — dig into Proxy mechanics and the Proxy vs Wrapper trade-off.

---

## What I learned

*Background: continuing from the JDBC failover note — same teacher, now zooming into RDS Proxy.*

---

### Act 1 — Where Proxy sits

:::chat student AI Student
After the JDBC note, Proxy was just a one-line “DNS-static” option. What is it actually?
:::

:::chat teacher Teacher
RDS Proxy is a **managed, multi-AZ front door** between your app and one Aurora cluster. It speaks the DB protocol, maintains its own **connection pool** toward the DB, and exposes a **proxy endpoint** your clients connect to instead of the cluster writer DNS.

| Piece | Role |
|-------|------|
| Client → Proxy endpoint | App TCP/TLS sessions (often many) |
| Proxy → Aurora instances | Fewer pooled DB connections |
| Target group | The Aurora cluster; Proxy finds the current writer |

Infrastructure for the Proxy is **separate** from the DB (serverless compute that scales with load). One proxy ↔ one cluster; you can attach **multiple** proxies to the same cluster.
:::

:::chat student AI Student
Multiplexing vs pinning — I keep seeing both words.
:::

:::chat teacher Teacher
**Multiplexing** (default): after each **transaction** ends, Proxy may return the underlying DB connection to the pool and give the next transaction a different one (**borrowing**).

**Pinning**: Proxy decides it is **not safe** to reuse that DB connection for other sessions — so the client session stays glued to one DB connection until the client disconnects.

Failover friendliness and pooling efficiency both depend on **staying multiplexed** as much as possible.
:::

---

### Act 2 — Failover: what clients stop worrying about

:::chat student AI Student
How does Proxy change Aurora failover for the application?
:::

:::chat teacher Teacher
Without Proxy, the client must: detect a dead socket, wait for **cluster writer DNS** to point at the new primary, clear **OS/JVM DNS caches**, and reopen connections. Aurora itself can finish failover quickly; the blog series shows **DNS + client recovery** as the long tail.

With Proxy ([concepts — Failover](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.howitworks.html)):

- Proxy keeps accepting connections at the **same endpoint / IP**.
- It **tracks instance roles from cluster metadata** (not from client DNS).
- It routes new work to the **new writer** when ready.
- It **does not drop idle** application connections (no outstanding request).
- In-flight transactions/statements on the failed instance are **canceled** so the client can retry quickly instead of hanging on a dead socket.
- While the writer is gone, Proxy can **queue** incoming requests rather than bounce every reconnect storm at a recovering primary.
:::

:::chat student AI Student
So clients are insulated from which problems exactly?
:::

:::chat teacher Teacher
Official list — clients via Proxy are not exposed to:

1. DNS propagation delay on failover  
2. Local DNS caching  
3. Connection timeouts (chasing a dead / demoting writer)  
4. Uncertainty about who the current writer is  
5. Waiting forever on a query to a former writer that vanished without closing TCP  

That last point matches the Multi-AZ / hard-fence story in the availability blog: without Proxy, bad socket timeouts or hours-long OS keepalives can dominate outage time.
:::

---

### Act 3 — Idle preservation (precise meaning)

:::chat student AI Student
“Preserves idle connections” — does my Hikari pool keep working with zero reconnects?
:::

:::chat teacher Teacher
**Idle** here means: client connection has **no outstanding request** during the failover. Those app-side sockets toward the Proxy stay up. Pooled connections sitting unused often survive.

Still fail / need retry:

| Situation | Behavior |
|-----------|----------|
| Mid-transaction / mid-statement on the failed writer | Proxy **terminates** that client connection → app must retry |
| New borrow that needs the writer before promotion completes | Queued until writer is available (or fails per borrow timeout) |
| Aurora promotion itself | Writer-less window still exists underneath — Proxy can't invent a writer |

So: pool churn and TLS reconnect storms drop; **in-flight business transactions still fail** and must be idempotent/retried at the app layer.
:::

---

### Act 4 — Static endpoint vs cluster DNS (numbers)

:::chat student AI Student
How much faster is this in measured tests?
:::

:::chat teacher Teacher
From AWS blogs (MySQL test workloads — not a guarantee for every app):

| Source | Setup | Rough client outage |
|--------|--------|---------------------|
| [Improve availability on Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/) | Direct cluster writer DNS | ~10s downtime + errors; with sticky DNS, stuck on demoted **reader** |
| Same blog | Via RDS Proxy R/W endpoint | ~**2s**, no connectivity errors in the demo |
| [Improving availability with RDS Proxy](https://aws.amazon.com/blogs/database/improving-application-availability-with-amazon-rds-proxy/) | Direct MariaDB Aurora driver (tuned) | ~13.8s avg |
| Same blog | Via Proxy (vanilla MariaDB URL) | ~**2.9s** avg (~79% better in that test) |

Key qualitative result: Proxy's **hostname/IP does not change** on failover, so client DNS TTL/JVM cache **don't matter** for writer discovery. Cluster writer endpoint still has ~5s zone TTL **plus** whatever your resolvers/JVM cache.
:::

---

### Act 5 — Session pinning (failover's silent killer)

:::chat student AI Student
When does multiplexing break?
:::

:::chat teacher Teacher
Proxy pins when session state can't safely move across DB connections ([pinning guide](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-pinning.html)). Common **MySQL** triggers:

- `SET` of many user/system variables (some are tracked without pinning — `AUTOCOMMIT`, charset/`NAMES`, `SQL_MODE`, `TIME_ZONE`, transaction isolation at **session** scope, …)
- Temporary tables, `LOCK TABLES` / named locks (`GET_LOCK`)
- **Prepared statements** (text or binary protocol)
- SQL text **> 16 KB**
- Executable MySQL/MariaDB comments (`/*! … */`)

**PostgreSQL** is stricter: almost any `SET`, prepared-statement lifecycle, temp objects, cursors, advisory locks, `LISTEN`, etc. pin. Session pinning filters exist for MySQL `SET` exemptions — **not** for PostgreSQL.

Watcher metric: CloudWatch **`DatabaseConnectionsCurrentlySessionPinned`**.
:::

:::chat student AI Student
Why does pinning matter for failover and pooling?
:::

:::chat teacher Teacher
Pinned session = one client monopolizes one DB connection until disconnect → multiplexing and pool sharing evaporate.

On **reader endpoints**, multiplexed sessions can move to another reader without app action; **pinned** sessions error and must reconnect ([proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-endpoints.html)).

Mitigations: push common `SET`s into the proxy **initialization query**, keep session flags consistent across connections, avoid temp tables / prepared statements where possible, use pinning filters only when you understand the app.
:::

---

### Act 6 — Proxy endpoints (R/W vs read-only)

:::chat student AI Student
Default proxy endpoint = always the writer?
:::

:::chat teacher Teacher
Yes. Default endpoint is **read/write** → all traffic to the current **writer** (counts against writer `max_connections`).

For reads: create a **read-only proxy endpoint** (up to 20 additional endpoints per proxy). It fans out across Aurora readers; if a reader dies, Proxy prefers other available readers — again **without client DNS churn**. Multiplexed connections can shift readers; pinned ones need reconnect.

Cross-VPC: extra endpoint can live in another VPC (same Region) via PrivateLink.

Logs and CloudWatch metrics are **per endpoint** (default name = `default`).
:::

---

### Act 7 — Global DB: Proxy is not a global writer endpoint

:::chat student AI Student
Does Proxy replace the Aurora global writer endpoint across Regions?
:::

:::chat teacher Teacher
**No.** A proxy is bound to **one regional cluster**.

From [RDS Proxy + Global DB](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-gdb.html):

| Target cluster | R/W proxy endpoint | Read-only proxy endpoint |
|----------------|--------------------|---------------------------|
| Primary | Works → current writer | Readers in that Region |
| Secondary | Fails: *no read/write instances* | Readers OK |

On **Global switchover/failover**, write traffic must move to the **proxy associated with the new primary**. Old primary's proxy may still accept writes briefly, then fails once the cluster becomes secondary. Proxy queues writes toward the **new** primary once its writer is ready — but the **app must change which proxy hostname** it uses (unlike Aurora's single global writer DNS name).

Also: if write forwarding is enabled, lower Proxy `MaxConnectionsPercent` by the forwarding quota; `SESSION` for `aurora_replica_read_consistency` is unsupported with Proxy.
:::

---

### Act 8 — RDS Proxy vs AWS JDBC Wrapper

:::chat student AI Student
When do I pick Proxy, Wrapper, or both?
:::

:::chat teacher Teacher
Same root problem (writer discovery + stale sockets); different layer:

| | **RDS Proxy** | **AWS JDBC Wrapper** |
|--|---------------|----------------------|
| Where logic lives | Shared managed service | Inside each JVM client |
| DNS | Static proxy endpoint/IP | Client uses topology + **instance** endpoints |
| Idle across failover | Preserved at proxy | Driver reconnects sockets; pool still churns |
| Connection multiplexing | Yes (transaction-scoped) | No (app pool only) |
| Extra benefits | Connection storm control, Secrets/IAM front door, cross-VPC endpoints | Fast failover without extra infra; works where Proxy isn't allowed |
| Cost / ops | Proxy + PrivateLink endpoints | Driver config only |
| Client coverage | Any MySQL/PG protocol client | Java (Wrapper) only |
| Pinning / multiplexing pitfalls | Yes | N/A |
| Hikari detail | Usually vanilla URL to proxy | Need `HikariCPSQLException` override |

[Improve availability on Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/) frames Proxy as the broadest “abstraction,” Wrapper as the strong Java-only path. Stacking **both** is optional: Proxy already removes DNS for clients; Wrapper failover plugins add less once every connection already terminates at a role-aware proxy — often you'd use Wrapper **or** Proxy, not necessarily both, unless you want Wrapper features beyond failover (e.g. other plugins) in front of Proxy.
:::

---

### Cheat sheet

```
App pools ──► Proxy endpoint (static DNS/IP)
                 │  tracks writer via cluster metadata
                 │  keeps idle client sessions
                 │  cancels in-flight; queues until writer ready
                 ▼
            Aurora writer / readers
                 │
         Pinning ↓ kills reuse & smooth reader moves
                 │
   Global DB: switch app → new Region's Proxy R/W endpoint
```

| Goal | Prefer |
|------|--------|
| Many languages / Lambda / no driver control | **RDS Proxy** |
| Java-only, want topology failover in-process | **AWS JDBC Wrapper** |
| Connection storms + Secrets/IAM unify | **Proxy** |
| Avoid infra + pinning complexity | **Wrapper** (or tune DNS/timeouts — weaker) |
| Cross-Region Global DB writes | Global writer endpoint **and/or** switch Proxy hostname |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** During failover, Proxy “preserves idle connections.” What still fails and must be retried by the app?
---
Any connection **in the middle of a transaction or SQL statement** on the failed instance is canceled. Idle = no outstanding request. Aurora’s writer-less promotion window also remains; Proxy cannot serve writes with no writer.
:::

:::quiz
**Q2.** Why does a static Proxy endpoint beat cluster writer DNS for recovery time?
---
Cluster writer DNS changes on failover (~5s TTL) and then hits OS/JVM/resolver caches. Proxy keeps the same endpoint/IP and retargets using **cluster metadata**, so clients skip DNS propagation and “stuck on demoted reader” failure modes.
:::

:::quiz
**Q3.** Name two MySQL behaviors that pin a Proxy session — and one metric to watch.
---
Examples: prepared statements; temporary tables; many `SET`s; `LOCK TABLES` / `GET_LOCK`; SQL text > 16 KB. Watch CloudWatch **`DatabaseConnectionsCurrentlySessionPinned`**.
:::

:::quiz
**Q4.** After Global DB switchover, can the app keep the old Region’s Proxy read/write endpoint?
---
No. Each proxy targets one regional cluster. Writes must go to the **new primary’s** proxy R/W endpoint. The old primary’s R/W proxy eventually rejects writes once that cluster is secondary. Unlike Aurora global writer DNS, Proxy hostname is Region-bound.
:::

:::quiz
**Q5.** Proxy vs AWS JDBC Wrapper — pick one line that captures the split.
---
Proxy = managed, protocol-agnostic DNS/role shield + pooling (with pinning trade-offs). Wrapper = in-JVM topology cache and instance-endpoint failover for Java, without multiplexing or a static managed endpoint.
:::

---

## Memo

—
