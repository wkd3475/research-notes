---
title: 'JDBC failover detection and minimal downtime'
---

## References

- [Resolve Aurora failover downtime and connection errors (re:Post)](https://repost.aws/knowledge-center/failovers-aurora-mysql)
- [Connecting to an Amazon Aurora DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Connecting.html)
- [Connecting to Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-connecting.html)
- [Switchover or failover in Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html)
- [AWS Advanced JDBC Wrapper — Failover Configuration Guide](https://github.com/aws/aws-advanced-jdbc-wrapper/blob/main/docs/using-the-jdbc-driver/FailoverConfigurationGuide.md)
- [Using the Failover Plugin](https://github.com/aws/aws-advanced-jdbc-wrapper/blob/main/docs/using-the-jdbc-driver/using-plugins/UsingTheFailoverPlugin.md)
- [Introducing the Advanced JDBC Wrapper Driver (blog)](https://aws.amazon.com/blogs/database/introducing-the-advanced-jdbc-wrapper-driver-for-amazon-aurora/)
- [Improve application availability on Amazon Aurora (blog)](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/)
- [Fast failover with Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.BestPractices.FastFailover.html)
- [MySQL Connector/J — Server Failover](https://dev.mysql.com/doc/connector-j/en/connector-j-config-failover.html)
- [HikariCP Wiki — TCP Keepalive](https://github.com/brettwooldridge/HikariCP/wiki/Setting-Driver-or-OS-TCP-Keepalive)
- [Stack Overflow: SELECT 1 does not catch Aurora failover](https://stackoverflow.com/questions/52629074/jdbc-connection-pool-test-query-select-1-does-not-catch-aws-rds-writer-reader)

---

## Why I looked this up

Follow-up to [Aurora cluster vs Global DB switchover — internal steps](/research-notes/en/notes/aurora-cluster-vs-global-db-switchover-internal/). That note covered what Aurora does during promotion; this one covers **how JDBC drivers and connection settings detect endpoint/DNS changes after switchover** and **what reduces application downtime**.

---

## What stood out

Aurora can finish failover in ~30 seconds, but apps often see longer outages — not because storage promotion is slow, but because **standard JDBC waits on DNS and keeps stale TCP sockets**. The AWS JDBC Wrapper sidesteps DNS by caching cluster topology and polling instance endpoints directly.

---

## What I learned

### Materials read today

| Stage | Topic | Key sources |
|-------|-------|-------------|
| 1 | Ops checklist | re:Post failover downtime article |
| 2 | Endpoints & driver comparison | Aurora Connecting guide, Global DB connecting guide |
| 3 | DNS delay symptoms & RDS Proxy | Improve application availability blog |
| 4 | AWS JDBC Wrapper failover | Introducing Wrapper blog, Failover Plugin docs |
| 5 | Pool/timeouts/community driver | PG Fast Failover guide, MySQL Connector/J failover, HikariCP keepalive, Stack Overflow |

### Three layers — extending the parent note

The parent note ended at Aurora internals and endpoint tables. Application downtime adds a third layer:

```
Aurora role swap + endpoint DNS update   (~30s Aurora RTO)
  → Client DNS / JVM cache / resolver TTL
    → JDBC reconnect + connection pool stale sockets
      → App retry / transaction handling
```

The slowest layer wins.

---

### Endpoint choice (first configuration decision)

| Endpoint | After single-cluster failover | After Global DB switchover | JDBC risk |
|----------|------------------------------|----------------------------|-----------|
| **Cluster (writer) endpoint** | Same hostname → new primary IP via DNS | Per-Region — still points at that Region's writer | DNS propagation + cache |
| **Instance endpoint** | Hostname fixed to one instance | Same | May land on demoted read-only writer |
| **Reader endpoint** | Read-only | Read-only | Writes fail with `--read-only` |
| **Global writer endpoint** | N/A (single Region) | **Same hostname** → new primary Region | DNS still applies; plus **cross-Region VPC** required |

**Best practice (re:Post + Connecting guide):** use cluster/reader endpoints — not instance endpoints. For Global DB, prefer **global writer endpoint** over the old primary's regional cluster endpoint so connection strings survive cross-Region switchover.

---

### How standard JDBC "notices" failover (it mostly doesn't)

Standard community drivers (MySQL Connector/J, PostgreSQL JDBC) do **not** watch DNS or Aurora topology.

1. **Existing TCP connections** stay bound to the IP resolved at connect time until the socket errors or times out.
2. **New connections** re-resolve DNS — but JVM `networkaddress.cache.ttl` defaults to ~30s (or longer with a caching resolver).
3. Aurora Route 53 zones use **TTL = 5 seconds**, but intermediate DNS caches can override (blog example: 120s local cache → up to 2 extra minutes of downtime).

**Observed cluster-endpoint behavior during manual failover (blog ping test):**

```
~7s  ERROR 2003 Can't connect
~2s  connected to reader (stale DNS → old primary, now read-only)
~1s  connected to writer (DNS caught up)
```

With `/etc/hosts` pinning the old IP, the client **never** reached the new writer — only `reader` indefinitely.

**Symptoms of DNS delay:**

| Symptom | Meaning |
|---------|---------|
| `ERROR 1290 … --read-only` after failover | App writing to demoted primary |
| `ERROR 2003` long after "Completed failover" RDS event | Stale DNS or hung connect |
| Hang on new connection after failover | DNS cache / missing `connectTimeout` |

---

### Connection pool pitfalls

Pools **do not failover** — they validate or evict dead connections.

| Pitfall | Why |
|---------|-----|
| `SELECT 1` validation passes | Read-only instance answers SELECT; UPDATE fails later |
| No `socketTimeout` | Threads block on dead sockets (HikariCP #514: up to ~15 min on Linux defaults) |
| No `tcpKeepAlive` | Half-open connections linger |
| Uniform `maxLifetime` | Mass pool refresh skews reader-endpoint load (HikariCP #1247) |

**re:Post DNS TTL:** if the app caches DNS, keep TTL **&lt; 30 seconds**.

**JVM DNS (PG Fast Failover doc):**

```java
java.security.Security.setProperty("networkaddress.cache.ttl", "1");
java.security.Security.setProperty("networkaddress.cache.negative.ttl", "3");
```

---

### Timeout & keepalive checklist

| Setting | Layer | Role |
|---------|-------|------|
| `connectTimeout` | JDBC driver | Cap wait for new socket during failover |
| `socketTimeout` | JDBC driver | Unblock threads on dead connections; must exceed longest normal query |
| `tcpKeepAlive=true` | JDBC driver | Enable TCP-level probe |
| `tcp_keepalive_time/intvl/probes` | OS (Linux) | PG doc recommends 1/1/5 → ~5s failure detection |
| `loginTimeout` | JDBC (PG) | Login attempt cap |

PG Fast Failover example connection string (multi-host + `targetServerType=primary`):

```
jdbc:postgresql://cluster-endpoint:5432,cluster-ro-endpoint:5432/postgres
  ?loginTimeout=2&connectTimeout=2&socketTimeout=60
  &tcpKeepAlive=true&targetServerType=primary
```

---

### AWS Advanced JDBC Wrapper — topology-aware failover

**Install pattern:** keep community driver on classpath; change URL prefix:

| Engine | Prefix |
|--------|--------|
| MySQL | `jdbc:aws-wrapper:mysql://` |
| PostgreSQL | `jdbc:aws-wrapper:postgresql://` |

**Default plugins:** `auroraConnectionTracker,failover,efm` (v2 failover plugin enabled by default when `wrapperPlugins` unset — do not mix `failover`, `failover2`, `gdbFailover` on one connection).

| Plugin | Role |
|--------|------|
| `auroraConnectionTracker` | Close all connections to failed node |
| `failover` / `failover2` | Detect failure, poll replicas, reconnect to new writer |
| `efm` | Enhanced Failure Monitoring — proactive host health checks |

**Failover flow (Wrapper docs):**

1. App holds logical connection to cluster endpoint → physically on writer C.
2. Writer fails → driver intercepts communication exception.
3. Driver uses **topology cache** → temporarily connects to an active replica.
4. Polls topology until new writer identified → connects directly (often **before DNS updates**).
5. Raises `FailoverSuccessSQLException` (SQLState **08S02**) — connection object is **reusable**; session state must be reconfigured.

**Typical reconnect time:** ~6s after driver detects failure (blog), vs ~30s DNS-dependent for standard drivers.

**Critical app/pool rule:** do **not** discard the `Connection` on failover exceptions. Check SQLState and reuse:

| SQLState | Exception | Connection valid? | App action |
|----------|-----------|-------------------|------------|
| 08S02 | `FailoverSuccessSQLException` | Yes | Reconfigure session; re-run last statement |
| 08007 | `TransactionStateUnknownSQLException` | Yes | Rollback assumed; restart transaction |
| 08001 | `FailoverFailedSQLException` | No | Get new connection; retry loop |

**HikariCP integration:** set `exceptionOverrideClassName` to `software.amazon.jdbc.util.HikariCPSQLException` so pool does not evict connections on 08S02/08007.

**Key failover parameters:**

| Parameter | Default | Notes |
|-----------|---------|-------|
| `failoverTimeoutMs` | 300000 | Max time to find new host |
| `failoverWriterReconnectIntervalMs` | 2000 | Poll interval for writer |
| `failoverReaderConnectTimeoutMs` | 30000 | Reader connect cap during failover |
| `failoverClusterTopologyRefreshRateMs` | 2000 | Fast topology refresh during failover |
| `failoverMode` | `strict-writer` (cluster EP) | `reader-or-writer` for reader endpoint |
| `globalClusterInstanceHostPatterns` | — | **Required for Global DB** — per-Region host patterns |
| `clusterInstanceHostPattern` | auto | Required for IP/custom domain URLs |

**Global DB JDBC:** set `globalClusterInstanceHostPatterns` with comma-separated patterns per Region, e.g. `?.XYZ1.us-east-2.rds.amazonaws.com,?.XYZ2.us-west-2.rds.amazonaws.com`.

**Writer cluster endpoint caveat (Failover Configuration Guide):** after failover, connecting via cluster endpoint can still hit stale DNS on intermediate resolvers (AWS DNS ~15–20s). Wrapper avoids this by direct instance connect; community drivers cannot.

---

### Community MySQL Connector/J failover (baseline)

`autoReconnect` / `autoReconnectForPools` can mask connection drops but:

- May reconnect to a **read-only** secondary without the app knowing.
- In-flight `ResultSet` may look fine while underlying connection already switched.

Not recommended for Aurora production failover — AWS docs steer to AWS JDBC Driver.

---

### Amazon RDS Proxy — DNS bypass

| | Cluster writer endpoint | RDS Proxy endpoint |
|--|------------------------|-------------------|
| Hostname on failover | DNS updates (5s + cache) | **Static** |
| Role tracking | Client via DNS | Proxy via cluster metadata |
| Idle connections | Dropped/re-established | Can preserve |
| Blog measured downtime | ~10s (+ errors) | ~2s, no errors |

Proxy tracks instance roles without DNS. Useful when you cannot adopt AWS JDBC Wrapper across all clients.

**Global DB:** Proxy supports global databases (see Global DB connecting guide).

---

### Global DB switchover — app checklist

From Global DB connecting + disaster-recovery docs, combined with JDBC layer:

1. Use **global writer endpoint** (not old primary's regional cluster endpoint).
2. Ensure **VPC connectivity** to all Regions where app may need to reach the new primary.
3. After switchover: verify DNS propagated + test **writes** before full traffic.
4. Aurora emits RDS event when global writer DNS changes — use for cache invalidation strategies.
5. With AWS JDBC Wrapper: configure `globalClusterInstanceHostPatterns`.
6. **In-flight transactions** still fail — app retry required regardless of driver.

---

### Configuration priority (cheat sheet)

```
1. Correct endpoint (cluster / global writer — not instance)
2. AWS JDBC Wrapper + HikariCP exception override
3. connectTimeout + socketTimeout + tcpKeepAlive
4. JVM DNS TTL < 30s (if not using Wrapper/Proxy)
5. (Optional) RDS Proxy for DNS-static endpoint
6. App: handle 08S02 / retry idempotent ops
```

---

### One-line learning path (continued from parent note)

```
… → binlog/CDC (separate layer)
  → endpoint choice (cluster / global writer)
    → DNS TTL + JVM cache
      → standard JDBC limits
        → AWS JDBC Wrapper topology failover
          → pool timeouts + HikariCP override
            → RDS Proxy / app retry
```

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** When must you change the JDBC connection string after failover vs Global DB switchover?
---
**Single-cluster failover with cluster endpoint:** hostname unchanged — no string change; DNS points to new writer.

**Global DB switchover with global writer endpoint:** same — hostname unchanged across Regions.

**Global DB without global writer endpoint:** must switch to the **new primary Region's cluster endpoint** (e.g. remove `-ro` from promoted secondary's endpoint).

**Instance endpoint:** always risky — may need change if you pinned a specific instance.
:::

:::quiz
**Q2.** Why does `SELECT 1` pool validation pass after a writer failover, but `INSERT` fails?
---
The pool only checks that a query executes. After failover the socket may still reach the **demoted primary**, now **read-only**. `SELECT 1` succeeds; writes get `ERROR 1290 (--read-only)`. Fix: use cluster/global writer endpoint + AWS JDBC Wrapper (topology-aware reconnect), not validation queries alone.
:::

:::quiz
**Q3.** How does the AWS JDBC Wrapper reconnect faster than waiting for DNS?
---
On first connect it caches **cluster topology** (instance endpoints + roles). On writer failure it connects to an active replica, polls topology until the new writer appears, then connects **directly to the instance** — often before cluster-endpoint DNS updates. It signals success via SQLState **08S02**; the same `Connection` object stays valid.
:::

:::quiz
**Q4.** What must HikariCP configure when using the Wrapper failover plugin?
---
`exceptionOverrideClassName=software.amazon.jdbc.util.HikariCPSQLException`. Without it, HikariCP treats failover exceptions as fatal and **evicts** the connection — discarding the driver's internally restored socket and losing fast-failover benefit.
:::

:::quiz
**Q5.** What limits minimum downtime even with perfect JDBC settings?
---
**Aurora promotion time** (~30s) during which no writer accepts connections; **in-flight transactions** (always fail — must retry); **Global DB networking** (VPC to new primary Region); **DNS** if using community drivers without Wrapper/Proxy; **`socketTimeout`** must be longer than longest legitimate query or you get false timeouts.
:::

---

## Memo

Next: **RDS Proxy architecture** vs Wrapper trade-offs, **app retry/idempotency** for 08S02 and failed transactions, and an **end-to-end Global DB DR runbook** tying internal steps + JDBC + networking together.
