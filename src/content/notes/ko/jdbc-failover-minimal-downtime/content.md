---
title: 'JDBC failover 감지와 최소 다운타임'
---

## 레퍼런스

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

## 왜 이 글을 찾아봤나

[Aurora cluster vs Global DB switchover — 내부 단계](/research-notes/ko/notes/aurora-cluster-vs-global-db-switchover-internal/) 노트에서 Aurora 승격 내부 동작은 정리했고, 이번에는 **switchover 후 endpoint/DNS 변경을 JDBC 드라이버가 어떻게 인지하는지**, **어떤 연결 설정이 앱 다운타임을 줄이는지** 알아보고 싶었다.

---

## 읽으면서 느낀 점

Aurora failover는 30초 안쪽인데 앱은 더 오래 끊기는 경우가 많다. 스토리지 승격이 느려서라기보다 표준 JDBC가 DNS를 기다리고, 끊긴 줄 모르는 TCP 소켓을 그대로 쓰기 때문이다. AWS JDBC Wrapper는 클러스터 topology를 캐시해 instance endpoint로 바로 붙는다.

---

## 배운 것

### 오늘 읽은 자료 (5단계)

| 단계 | 주제 | 핵심 출처 |
|------|------|-----------|
| 1 | 운영 체크리스트 | re:Post failover 다운타임 글 |
| 2 | Endpoint·드라이버 비교 | Aurora Connecting, Global DB connecting |
| 3 | DNS 지연·RDS Proxy | Improve application availability 블로그 |
| 4 | AWS JDBC Wrapper failover | Introducing Wrapper 블로그, Failover Plugin 문서 |
| 5 | 풀·timeout·커뮤니티 드라이버 | PG Fast Failover, MySQL Connector/J, HikariCP, Stack Overflow |

### 세 레이어 — 이전 노트에 이어 붙이기

이전 노트는 Aurora 내부와 endpoint 표까지였다. 앱 다운타임에는 여기에 한 겹이 더 올라간다.

```
Aurora 역할 교체 + endpoint DNS 갱신   (Aurora RTO ~30s)
  → 클라이언트 DNS / JVM 캐시 / resolver TTL
    → JDBC 재연결 + 커넥션 풀 stale 소켓
      → 앱 재시도 / 트랜잭션 처리
```

가장 느린 레이어가 다운타임을 결정한다.

---

### Endpoint 선택 (첫 번째 설정)

| Endpoint | 단일 클러스터 failover 후 | Global DB switchover 후 | JDBC 리스크 |
|----------|--------------------------|-------------------------|-------------|
| **Cluster (writer) endpoint** | hostname 동일 → DNS로 새 primary IP | Region별 — 그 Region writer 가리킴 | DNS 전파·캐시 |
| **Instance endpoint** | 특정 인스턴스에 고정 | 동일 | demote된 read-only writer에 붙을 수 있음 |
| **Reader endpoint** | 읽기 전용 | 읽기 전용 | 쓰기 시 `--read-only` |
| **Global writer endpoint** | 해당 없음 | **hostname 동일** → 새 primary Region | DNS + **cross-Region VPC** 필요 |

**권장(re:Post·Connecting):** cluster/reader endpoint 사용, instance endpoint는 피한다. Global DB는 예전 primary의 regional cluster endpoint 대신 **global writer endpoint**를 쓰면 connection string을 바꿀 필요가 없다.

---

### 표준 JDBC가 failover를 "감지"하는 방식 (거의 안 함)

커뮤니티 드라이버(MySQL Connector/J, PostgreSQL JDBC)는 DNS나 Aurora topology를 감시하지 않는다.

1. **기존 TCP 연결**은 connect 시점 IP에 묶여 있다. 소켓 에러·timeout 전까지 유지된다.
2. **새 연결**만 DNS를 다시 조회한다. JVM `networkaddress.cache.ttl` 기본값은 ~30초(캐싱 resolver면 더 김).
3. Aurora Route 53 TTL은 **5초**지만 중간 DNS 캐시가 덮어쓸 수 있다(블로그 예: 로컬 120초 캐시 → 최대 2분 추가 다운타임).

**수동 failover 시 cluster endpoint ping 결과(블로그):**

```
~7초  ERROR 2003 연결 불가
~2초  reader에 연결 (stale DNS → demote된 구 primary)
~1초  writer에 연결 (DNS 따라잡음)
```

`/etc/hosts`로 구 IP를 고정하면 새 writer에 **영원히** 못 붙고 reader만 본다.

**DNS 지연 증상:**

| 증상 | 의미 |
|------|------|
| failover 후 `ERROR 1290 … --read-only` | demote된 primary에 쓰기 시도 |
| "Completed failover" 이벤트 후에도 `ERROR 2003` | stale DNS 또는 connect hang |
| failover 후 새 연결 hang | DNS 캐시 / `connectTimeout` 없음 |

---

### 커넥션 풀 함정

풀은 failover를 처리하지 않는다. 죽은 connection만 골라서 버린다.

| 함정 | 이유 |
|------|------|
| `SELECT 1` validation 통과 | read-only 인스턴스도 SELECT는 됨. UPDATE에서 실패 |
| `socketTimeout` 없음 | 죽은 소켓에서 스레드 block (HikariCP #514: Linux 기본값으로 ~15분) |
| `tcpKeepAlive` 없음 | half-open connection 방치 |
| `maxLifetime` 일괄 만료 | 풀 전체 갱신이 reader endpoint 로드밸런싱 왜곡 (HikariCP #1247) |

**re:Post DNS TTL:** 앱이 DNS를 캐시하면 TTL **30초 미만** 권장.

**JVM DNS(PG Fast Failover):**

```java
java.security.Security.setProperty("networkaddress.cache.ttl", "1");
java.security.Security.setProperty("networkaddress.cache.negative.ttl", "3");
```

---

### Timeout·keepalive 체크리스트

| 설정 | 레이어 | 역할 |
|------|--------|------|
| `connectTimeout` | JDBC | failover 중 새 소켓 대기 상한 |
| `socketTimeout` | JDBC | 죽은 connection에서 스레드 block 방지. 정상 최장 쿼리보다 길어야 함 |
| `tcpKeepAlive=true` | JDBC | TCP probe 활성화 |
| `tcp_keepalive_time/intvl/probes` | OS(Linux) | PG 문서 권장 1/1/5 → ~5초 장애 감지 |
| `loginTimeout` | JDBC(PG) | 로그인 시도 상한 |

PG Fast Failover 예시(multi-host + `targetServerType=primary`):

```
jdbc:postgresql://cluster-endpoint:5432,cluster-ro-endpoint:5432/postgres
  ?loginTimeout=2&connectTimeout=2&socketTimeout=60
  &tcpKeepAlive=true&targetServerType=primary
```

---

### AWS Advanced JDBC Wrapper — topology 기반 failover

**설치:** 커뮤니티 드라이버 classpath 유지, URL prefix만 변경.

| 엔진 | Prefix |
|------|--------|
| MySQL | `jdbc:aws-wrapper:mysql://` |
| PostgreSQL | `jdbc:aws-wrapper:postgresql://` |

**기본 플러그인:** `auroraConnectionTracker,failover,efm` (`wrapperPlugins` 미지정 시 failover v2 기본 — `failover`·`failover2`·`gdbFailover` 동시 사용 금지).

| Plugin | 역할 |
|--------|------|
| `auroraConnectionTracker` | 실패 노드로 열린 connection 일괄 종료 |
| `failover` / `failover2` | 장애 감지, replica 폴링, 새 writer 재연결 |
| `efm` | Enhanced Failure Monitoring — 사전 헬스 체크 |

**Failover 흐름(Wrapper 문서):**

1. cluster endpoint로 logical connection → 물리적으로 writer C에 연결.
2. writer 장애 → driver가 communication exception 가로챔.
3. **topology cache**로 active replica에 임시 연결.
4. topology 폴링으로 새 writer 식별 → **DNS 갱신 전에** instance에 직접 연결.
5. `FailoverSuccessSQLException`(SQLState **08S02**) throw — `Connection` 객체 **재사용 가능**, session state는 재설정 필요.

**재연결 시간:** driver가 장애를 감지한 뒤 ~6초(블로그). 표준 driver DNS 의존 시 ~30초.

**앱/풀에서 지켜야 할 것:** failover exception이 나와도 `Connection`을 버리지 말고 SQLState를 보고 재사용한다.

| SQLState | Exception | Connection 유효? | 앱 동작 |
|----------|-----------|------------------|---------|
| 08S02 | `FailoverSuccessSQLException` | Yes | session 재설정, 마지막 statement 재실행 |
| 08007 | `TransactionStateUnknownSQLException` | Yes | rollback 가정, 트랜잭션 재시작 |
| 08001 | `FailoverFailedSQLException` | No | 새 connection, retry loop |

**HikariCP:** `exceptionOverrideClassName=software.amazon.jdbc.util.HikariCPSQLException` — 없으면 08S02/08007에서 connection을 evict해 fast-failover 효과가 사라진다.

**주요 failover 파라미터:**

| Parameter | Default | 비고 |
|-----------|---------|------|
| `failoverTimeoutMs` | 300000 | 새 host 탐색 최대 시간 |
| `failoverWriterReconnectIntervalMs` | 2000 | writer 폴링 간격 |
| `failoverReaderConnectTimeoutMs` | 30000 | failover 중 reader connect 상한 |
| `failoverClusterTopologyRefreshRateMs` | 2000 | failover 중 topology 갱신 주기 |
| `failoverMode` | `strict-writer`(cluster EP) | reader EP는 `reader-or-writer` |
| `globalClusterInstanceHostPatterns` | — | **Global DB 필수** — Region별 host pattern |
| `clusterInstanceHostPattern` | auto | IP/custom domain URL일 때 필요 |

**Global DB JDBC:** Region별 pattern을 쉼표로 — 예: `?.XYZ1.us-east-2.rds.amazonaws.com,?.XYZ2.us-west-2.rds.amazonaws.com`.

**Writer cluster endpoint 주의(Failover Configuration Guide):** failover 후 cluster endpoint는 중간 resolver에서 stale DNS를 탈 수 있다(AWS DNS ~15–20초). Wrapper는 instance 직접 연결로 우회, 커뮤니티 driver는 불가.

---

### 커뮤니티 MySQL Connector/J failover (대조군)

`autoReconnect` / `autoReconnectForPools`는 끊김을 숨길 수 있지만:

- **read-only** secondary에 재연결해도 앱이 모를 수 있음.
- in-flight `ResultSet`은 정상처럼 보이는데 underlying connection은 이미 바뀐 상태.

Aurora 프로덕션 failover에는 비권장 — AWS 문서는 AWS JDBC Driver를 안내한다.

---

### Amazon RDS Proxy — DNS 우회

| | Cluster writer endpoint | RDS Proxy endpoint |
|--|------------------------|-------------------|
| failover 시 hostname | DNS 갱신(5초+캐시) | **고정** |
| 역할 추적 | 클라이언트 DNS | Proxy가 cluster metadata로 |
| idle connection | 끊기고 재연결 | 보존 가능 |
| 블로그 측정 다운타임 | ~10초(+에러) | ~2초, 에러 없음 |

Proxy는 DNS 없이 instance 역할을 추적한다. Wrapper를 모든 클라이언트에 넣기 어려울 때 대안.

**Global DB:** Proxy 지원(Global DB connecting 가이드).

---

### Global DB switchover — 앱 체크리스트

Global DB connecting + disaster-recovery + JDBC 레이어 합친 것:

1. **global writer endpoint** 사용(예전 primary regional cluster endpoint 말고).
2. 앱이 새 primary Region에 닿을 **VPC 연결** 확보.
3. switchover 후 DNS 전파 확인 + **write** 테스트 후 트래픽 복구.
4. global writer DNS 변경 시 RDS event 발생 — 캐시 무효화 전략에 활용.
5. AWS JDBC Wrapper: `globalClusterInstanceHostPatterns` 설정.
6. **진행 중 트랜잭션**은 driver와 무관하게 실패 — 앱 재시도 필수.

---

### 설정 우선순위 (치트시트)

```
1. 올바른 endpoint (cluster / global writer — instance 아님)
2. AWS JDBC Wrapper + HikariCP exception override
3. connectTimeout + socketTimeout + tcpKeepAlive
4. JVM DNS TTL < 30s (Wrapper/Proxy 미사용 시)
5. (선택) RDS Proxy로 DNS-static endpoint
6. 앱: 08S02 처리 / 멱등 재시도
```

---

### 한 줄 학습 경로 (이전 노트 연장)

```
… → binlog/CDC (별도 레이어)
  → endpoint 선택 (cluster / global writer)
    → DNS TTL + JVM 캐시
      → 표준 JDBC 한계
        → AWS JDBC Wrapper topology failover
          → 풀 timeout + HikariCP override
            → RDS Proxy / 앱 재시도
```

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** failover vs Global DB switchover 후 JDBC connection string을 바꿔야 하는 경우는?
---
**단일 클러스터 failover + cluster endpoint:** hostname 동일 — string 변경 없음. DNS가 새 writer를 가리킴.

**Global DB switchover + global writer endpoint:** 동일 — Region이 바뀌어도 hostname 유지.

**global writer endpoint 없이 Global DB:** **새 primary Region의 cluster endpoint**로 바꿔야 함(승격된 secondary endpoint에서 `-ro` 제거 등).

**instance endpoint:** 항상 위험 — 특정 인스턴스에 고정되어 있으면 변경이 필요할 수 있음.
:::

:::quiz
**Q2.** writer failover 후 `SELECT 1` validation은 통과하는데 `INSERT`가 실패하는 이유는?
---
풀은 쿼리 실행 여부만 본다. failover 직후 소켓이 **demote된 primary(read-only)** 에 남아 있으면 `SELECT 1`은 성공하고 쓰기는 `ERROR 1290 (--read-only)`로 실패한다. cluster/global writer endpoint + AWS JDBC Wrapper(topology 재연결)로 해결. validation query만으로는 부족.
:::

:::quiz
**Q3.** AWS JDBC Wrapper가 DNS 대기보다 빨리 재연결하는 원리는?
---
최초 연결 시 **클러스터 topology**(instance endpoint·역할)를 캐시한다. writer 장애 시 active replica에 붙고 topology를 폴링해 새 writer를 찾은 뒤 **instance에 직접** 연결한다 — cluster endpoint DNS 갱신보다 앞서는 경우가 많다. SQLState **08S02**로 알리며 같은 `Connection` 객체가 유효하다.
:::

:::quiz
**Q4.** Wrapper failover plugin과 HikariCP를 함께 쓸 때 필수 설정은?
---
`exceptionOverrideClassName=software.amazon.jdbc.util.HikariCPSQLException`. 없으면 HikariCP가 failover exception을 치명 오류로 보고 connection을 **evict**한다 — driver가 내부에서 복구한 소켓까지 버려져 fast-failover 효과가 없어진다.
:::

:::quiz
**Q5.** JDBC 설정이 완벽해도 다운타임 하한을 막는 요인은?
---
**Aurora 승격 시간**(~30초, writer 없는 구간); **진행 중 트랜잭션**(항상 실패·재시도 필요); **Global DB 네트워크**(새 primary Region VPC); **DNS**(Wrapper/Proxy 없이 커뮤니티 driver); **`socketTimeout`**이 정상 최장 쿼리보다 짧으면 오탐 timeout.
:::

---

## 메모

다음: **RDS Proxy** vs Wrapper 트레이드오프, **08S02·실패 트랜잭션** 앱 재시도·멱등성, 내부 단계·JDBC·네트워크를 묶은 **Global DB DR 런북**.
