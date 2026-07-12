---
title: 'Scylla 클라이언트 베스트 프랙티스 (드라이버, 데이터 모델, CL)'
---

## 레퍼런스

- [ScyllaDB Drivers (공식)](https://www.scylladb.com/product/scylla-drivers/)
- [Making a Shard-Aware Python Driver, Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)
- [Making a Shard-Aware Python Driver, Part 2](https://www.scylladb.com/2020/10/15/making-a-shard-aware-python-driver-for-scylla-part-2/)
- [Connect Faster with a Shard-Aware Port](https://www.scylladb.com/2021/04/27/connect-faster-to-scylla-with-a-shard-aware-port/)
- [Scylla Specific Features (C++ driver)](https://cpp-driver.docs.scylladb.com/master/topics/scylla_specific/)
- [Rust driver — Prepared statements](https://rust-driver.docs.scylladb.com/stable/statements/prepared.html)
- [Rust driver — Statements best practices](https://rust-driver.docs.scylladb.com/stable/statements/statements.html)
- [Production Readiness Guidelines](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/tips/production-readiness.html)
- [Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)
- [Best Practices for Benchmarking ScyllaDB](https://www.scylladb.com/2021/03/04/best-practices-for-benchmarking-scylla/)
- [Data Modeling (공식)](https://docs.scylladb.com/stable/get-started/data-modeling/)
- [Schema — partition & clustering keys](https://docs.scylladb.com/stable/get-started/query-data/schema.html)
- [NoSQL Data Modeling Mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)
- [Consistency Levels (CQL)](https://docs.scylladb.com/manual/stable/cql/consistency.html)
- [CQL Optimization (Monitoring)](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)
- [Python driver — Getting Started](https://python-driver.docs.scylladb.com/3.21.0-scylla/getting_started.html)

---

## 왜 이 글을 찾아봤나

- **계기:** [Scylla가 적합한 경우](/research-notes/ko/notes/scylla-use-cases/) 다음 단계 — 서버 튜닝만으로는 부족해 보였고, shard-aware 라우팅·모델링도 같이 봐야 할 것 같았다.
- **맥락:** shard-per-core([앞 노트](/research-notes/ko/notes/scylla-shard-per-core/)), use case fit, Operator ops는 봤고, 이번엔 **앱 ↔ DB** 층이다.
- **질문:** 드라이버에서 뭘 맞춰야 하나? prepared가 shard 라우팅이랑 어떻게 엮이나? CL·모델링에서 절대 타협 없는 건?

---

## 읽으면서 느낀 점

서버가 아무리 빨라도, 클라이언트가 엉뚱한 노드·shard로 보내거나 partition key 없이 쿼리하면 체감 이득이 거의 없다.

---

## 배운 것

*배경: shard-per-core·use case 노트를 바탕으로, 시니어 엔지니어 선생님이 클라이언트 베스트 프랙티스를 설명한다.*

---

### 1막 — 클라이언트 층이 왜 중요한가

:::chat student AI 학생
서버 shard-per-core는 봤는데, *클라이언트*가 뭘 더하나요?
:::

:::chat teacher 선생님
[shard-per-core 노트](/research-notes/ko/notes/scylla-shard-per-core/) 마지막이 **TokenAwarePolicy + Scylla shard-aware 드라이버 + prepared statement**였다. 이번 글이 그 체크리스트 전부다.

서버: partition key → Murmur3 token → 노드 → **CPU shard**.

클라이언트는 같은 routing key를 계산해 **replica 노드 + shard connection**으로 바로 보낸다 — coordinator hop이나 노드 안 cross-shard 포워딩을 줄이는 쪽이다.

| 층 | 맞으면 | 틀리면 |
|----|--------|--------|
| Token-aware | replica에 도달 | 아무 노드 → 내부 포워딩 |
| Shard-aware | **shard CPU**에 도달 | 노드는 맞는데 코어가 틀림 |
| Prepared + PK bind | 드라이버가 routing key 앎 | PK를 SQL에 박으면 라우팅 실패 |

hot path에서 셋 다 안 맞으면 클러스터를 잘 깔아도 지연·부하가 그대로 남는다.
:::

:::chat gon Gon
Scylla partition key 내부 기전이 궁금해요 — Murmur3, token ring, replica, shard 라우팅까지. 여기에 다 넣기보다 별도 노트에서 자세히 보고 싶어요.
:::

:::chat teacher 선생님
맞아요 — 이 글은 **클라이언트 설정**에 집중하고, **PK → token → replica set → shard** 전 경로는 [Partition Key 내부 기전](/research-notes/ko/notes/scylla-partition-key-internals/) 노트에서 봐요.
:::

---

### 2막 — Shard-aware 드라이버 & prepared statement

:::chat student AI 학생
Scylla 드라이버랑 일반 Cassandra 드라이버 차이는요?
:::

:::chat teacher 선생님
[ScyllaDB Drivers](https://www.scylladb.com/product/scylla-drivers/)가 **shard-aware** 포크를 유지한다(Java, Go, Python, C++, Rust). 노드마다 **shard당 connection pool** — `shard_id → connection` dict ([Part 2](https://www.scylladb.com/2020/10/15/making-a-shard-aware-python-driver-for-scylla-part-2/)).

흐름 ([Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)):

1. `session.prepare("SELECT … WHERE pk = ?")`
2. PK bind 실행 → 드라이버 hash → token → replica + **shard_id**
3. **해당 shard connection**으로 직송

**Prepared는 프로덕션 필수** ([Rust driver](https://rust-driver.docs.scylladb.com/stable/statements/prepared.html)):

- 서버에서 parse 한 번
- 드라이버가 **token/shard-aware** LB 메타데이터 확보
- prepare **한 번** 저장 후 재사용 — 요청마다 re-prepare는 왕복 낭비

**핵심 — PK는 반드시 bind:**

```sql
-- WRONG: PK가 문자열에 있으면 hash 불가 → 엉뚱한 노드/shard
INSERT INTO t (a, b) VALUES (12345, ?)

-- GOOD: PK 컬럼 전부 ?
INSERT INTO t (a, b) VALUES (?, ?)
```

non-PK는 리터럴 가능. **partition key 컬럼은 안 된다.**
:::

:::chat student AI 학생
basic vs advanced shard-awareness, shard-aware 포트는 뭐예요?
:::

:::chat teacher 선생님
두 모드 ([C++ Scylla features](https://cpp-driver.docs.scylladb.com/master/topics/scylla_specific/)):

| 모드 | 방식 | 트레이드오프 |
|------|------|--------------|
| **Basic** | connection을 열어 모든 shard가 잡힐 때까지 (노드가 least-busy shard에 배정) | **여분** connection 생겼다 버려질 수 있음 |
| **Advanced** | 포트 **19042** — local port `% shard_count`로 shard 지정 | 연결 시도 수 감소 ([shard-aware port](https://www.scylladb.com/2021/04/27/connect-faster-to-scylla-with-a-shard-aware-port/)) |

[벤치 가이드](https://www.scylladb.com/2021/03/04/best-practices-for-benchmarking-scylla/): Scylla 드라이버 기본은 **shard당 ~1 connection**(14 shard → 14 conn). **과다 connection은 p99 악화** — throughput은 **클라이언트 인스턴스**를 늘리고, 프로세스당 pool만 키우지 말 것.

Production Readiness는 부하 크면 shard당 >3 conn **또는** 클라이언트 수 증가 — 모니터 보며 튜닝.
:::

---

### 3막 — Load balancing 정책

:::chat student AI 학생
어떤 LB 정책을 쓰고, 뭘 피하나요?
:::

:::chat teacher 선생님
권장 ([Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)):

```
TokenAwarePolicy(DCAwareRoundRobinPolicy())
```

- **DCAware** — `LOCAL_*` CL에 로컬 DC replica
- **TokenAware** — token 소유 replica 우선

**LatencyAware는 쓰지 말 것** — 당장 빠른 노드로 몰렸다가 느려지고, 다시 몰리는 식으로 hotspot이 진동한다. use case 노트에서도 같은 이야기다.

일부 generic 드라이버 문서는 LatencyAware+TokenAware를 같이 언급하지만, Scylla는 **applications best-practices**를 기준으로 LatencyAware는 빼는 편이 낫다.
:::

---

### 4막 — Query-first 데이터 모델링

:::chat student AI 학생
클라이언트 관점에서 테이블은 어떻게 짜나요? query-first가 뭐예요?
:::

:::chat teacher 선생님
[공식 data modeling](https://docs.scylladb.com/stable/get-started/data-modeling/): **엔티티가 아니라 쿼리**를 먼저.

순서:

1. 프로덕션에서 돌릴 CQL 전부 적기
2. 각 쿼리 WHERE에 **partition key** 있는지 (없으면 클러스터 스캔)
3. 한 쿼리가 **한 partition**에서 끝나게 비정규화 ([schema](https://docs.scylladb.com/stable/get-started/query-data/schema.html))

| 구성 | 역할 |
|------|------|
| **Partition key** | 분산·hot-key |
| **Clustering key** | partition **안** 정렬 |

anti-pattern ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/), [use case](/research-notes/ko/notes/scylla-use-cases/)):

- hot / 거대 partition — bucket·salt (Discord: `time_bucket`)
- `ALLOW FILTERING` / non-PK 스캔 — 대시보드가 잡음
- **collection** 무한 append — clustering row로 ([use case 보충](/research-notes/ko/notes/scylla-use-cases/))
- write-heavy **cross-partition logged batch**

**읽기:** `CLUSTERING ORDER BY`와 맞추기 — 반대 ORDER BY는 동작하지만 비용 큼 ([CQL Optimization](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)).
:::

:::chat student AI 학생
batch, paging, timeout은요?
:::

:::chat teacher 선생님
[Rust statements best practices](https://rust-driver.docs.scylladb.com/stable/statements/statements.html) 기준:

| 패턴 | 규칙 |
|------|------|
| **SELECT** | 항상 **paging** — unpaged 대량 읽기는 클러스터 과부하 |
| **INSERT/UPDATE** | unpaged API OK |
| **Batch** | partition key 단위, 작게, write-heavy면 **unlogged** |
| **Batch 함정** | batch 안 simple statement+values → 매번 **순차 prepare** |

**Retry/timeout:** 클라이언트 timeout < 서버 → **retry storm** → hot partition ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)). 클라이언트 timeout은 **서버보다 길게**.
:::

---

### 5막 — Consistency Level (CL)

:::chat student AI 학생
프로덕션 기본 CL은 뭔가요?
:::

:::chat teacher 선생님
[Production Readiness](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/tips/production-readiness.html): 읽기·쓰기 **`LOCAL_QUORUM`**.

[CL 표](https://docs.scylladb.com/manual/stable/cql/consistency.html):

| CL | 용도 |
|----|------|
| **LOCAL_QUORUM** | 기본 — coordinator DC replica 과반 |
| **LOCAL_ONE** | 읽기 지연↓, staleness 허용 |
| **QUORUM** | DC 넘는 quorum — **지연↑** ([monitoring 경고](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html)) |
| **ONE** | 가장 빠름, 정합성 약함 |
| **ANY** | 쓰기 전용, hint — **persistency 위험** |
| **ALL** | 전 replica — 노드 하나만 죽어도 **실패** |

**RF=3 + LOCAL_QUORUM**이면 노드 1대 down에도 read/write 가능.

쿼리마다 또는 `ExecutionProfile`로 ([Python driver](https://python-driver.docs.scylladb.com/3.21.0-scylla/getting_started.html)):

```python
ExecutionProfile(consistency_level=ConsistencyLevel.LOCAL_QUORUM)
```

`DowngradingConsistencyRetryPolicy` 같은 건 **의도적으로**만 쓴다 — CL을 모르고 낮추면 정합성에 구멍이 난다.

**멀티 DC:** 매 쿼리마다 `QUORUM`/`ONE`보다 **`LOCAL_*`**.
:::

---

### 6막 — CQL Optimization 대시보드 (배포 후 검증)

:::chat student AI 학생
배포 뒤 클라이언트 설정이 맞는지 어떻게 확인하나요?
:::

:::chat teacher 선생님
[Scylla Monitoring — CQL Optimization](https://monitoring.docs.scylladb.com/stable/use-monitoring/cql-optimization.html) — gauge는 **0에 가깝게**:

| 패널 | 나쁜 신호 |
|------|-----------|
| **Non-prepared** | hot path에 prepare 없음 |
| **Non-token-aware** | 드라이버/LB 문제 또는 PK 미-bind |
| **Non-paged reads** | 한 번에 통째 읽기 |
| **Reversed reads** | ORDER BY가 CLUSTERING ORDER BY와 반대 |
| **ALLOW FILTERING** | non-PK 필터 |
| **CL ANY/ALL** | persistency·availability 리스크 |
| **Cross-DC** | 멀티 DC에서 LOCAL_* 안 씀 |

트래픽이 적을 때는 드라이버 내부·system table 쿼리도 섞여 보인다. **실부하** 기준으로 판단하는 게 맞다.

[Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)에도 CQL optimization 대시보드가 있다.
:::

---

### 7막 — 프로덕션 클라이언트 체크리스트

| 점검 | 통과 기준 |
|------|-----------|
| 드라이버 | Scylla **shard-aware** 공식 드라이버 |
| Prepare | hot path 전부 prepared; 한 번 prepare 후 재사용 |
| PK bind | partition key는 항상 `?` — SQL 리터럴 금지 |
| LB | `TokenAware(DCAware…)` — **LatencyAware 금지** |
| Connection | 기본 shard당 ~1; pool 키우기 전 **앱 인스턴스** 증가 |
| 19042 | advanced shard-awareness (드라이버 지원 시) |
| CL | **LOCAL_QUORUM** 기본; LOCAL_ONE은 stale OK할 때만 |
| 모델링 | query-first; prod 쿼리마다 PK; hot path ALLOW FILTERING 없음 |
| 읽기 | paging; clustering order 일치 |
| Timeout | 클라이언트 > 서버; retry storm 방지 |
| 모니터 | 부하 시 CQL Optimization gauge 낮음 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** shard-aware 라우팅에 필요한 클라이언트 습관 세 가지?
---
**Scylla shard-aware 드라이버** + **prepared statement** + **partition key를 bind parameter로**(SQL 문자열 리터럴 아님).
:::

:::quiz
**Q2.** Scylla에서 LatencyAware LB를 피하는 이유?
---
당장 빠른 노드로 트래픽이 몰림 → 느려짐 → 다시 이동 → **hotspot 진동**. **TokenAware(DCAware…)** 사용.
:::

:::quiz
**Q3.** 권장 프로덕션 CL과 멀티 DC에서 LOCAL_*를 쓰는 이유?
---
**LOCAL_QUORUM**(Production Readiness). **LOCAL_***는 coordinator DC 안에서 quorum — **QUORUM**은 cross-DC replica 대기로 지연·비용 증가.
:::

:::quiz
**Q4.** query-first 한 줄 + anti-pattern 하나?
---
앱 쿼리 먼저 → 각 쿼리가 **partition key**로 좁혀지게 테이블 설계·비정규화. anti-pattern: **ALLOW FILTERING** 또는 PK 없는 쿼리 → 클러스터 스캔.
:::

:::quiz
**Q5.** CQL Optimization에서 0에 가깝게 둘 패널 두 개?
---
예: **non-prepared**, **non-token-aware**, **non-paged reads**, **ALLOW FILTERING**, **CL ANY/ALL**, **cross-DC reads**.
:::

:::quiz
**Q6.** 클라이언트 timeout이 서버보다 짧으면?
---
클라이언트가 먼저 timeout 후 **retry** → 서버는 첫 요청 처리 중 → **retry storm** → hot partition·shard 과부하.
:::

## 메모

Cassandra/Scylla 트랙 — use case 다음 클라이언트 층. 다음: partition key 내부 기전(별도 노트), repair 운영.
