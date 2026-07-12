---
title: 'Scylla가 적합한 경우 (use case)'
---

## 레퍼런스

- [When ScyllaDB is Overkill vs. DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/)
- [ScyllaDB Architecture (공식)](https://www.scylladb.com/product/technology/)
- [How Discord Stores Trillions of Messages](https://discord.com/blog/how-discord-stores-trillions-of-messages)
- [Real-Time Write Heavy Database Workloads](https://www.scylladb.com/2025/02/04/real-time-write-heavy-workloads-considerations-tips/)
- [Real-Time ML with ScyllaDB as a Feature Store](https://www.scylladb.com/2025/07/15/real-time-feature-store/)
- [NoSQL Data Modeling Mistakes that Hurt Performance](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/)
- [You Got OLAP in My OLTP](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)
- [Best Practices for Scylla Applications](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)
- [Time-Based Anti-Patterns for Caching Time-Series Data](https://www.scylladb.com/2019/09/05/time-based-anti-patterns-for-caching-time-series-data/)
- [DynamoDB: When to Migrate](https://www.scylladb.com/2023/12/04/dynamodb-when-to-move-out/)
- [ScyllaDB Getting Started](https://docs.scylladb.com/manual/stable/getting-started/)

---

## 왜 이 글을 찾아봤나

- **계기:** [Discord Superdisk 노트](/research-notes/ko/notes/discord-superdisk/) 다음 단계다. 회사에서 Scylla 쓰기 전에 맞는 워크로드와 피해야 할 경우를 나누고 싶다.
- **맥락:** Cassandra/Scylla 트랙(내부 구조, Operator ops, 하이브리드 스토리지)은 쌓아 뒀고, 이번엔 *언제 Scylla가 값을 내는지* 보는 층이다.
- **질문:** 처리량·지연·모델링으로 yes/no는? 오버킬·잘못된 선택 신호는?

---

## 읽으면서 느낀 점

「Scylla가 빠른가」만이 아니다. 최소 클러스터 규모, 스토리지 전제, 접근 패턴이 OPS만큼 중요하다.

---

## 배운 것

*배경: Discord Superdisk·Scylla 내부/ops 노트를 바탕으로, 시니어 엔지니어 선생님이 Scylla fit/misfit을 설명한다.*

---

### 1막 — Scylla가 전제로 두는 것

:::chat student AI 학생
use case 목록 전에, Scylla가 **어떤 워크로드를 전제**로 하나요?
:::

:::chat teacher 선생님
[아키텍처 문서](https://www.scylladb.com/product/technology/)랑 [Overkill vs DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/)에 나온 전제 세 가지다.

| 전제 | 함의 |
|------|------|
| **로컬 SSD** | 동시성·읽기 지연 낮음 — 데이터 **대부분이 자주 조회**된다고 봄 |
| **최소 클러스터** | 트래픽이 적어도 **3노드 이상** (HA + 노드 하나 빠져도 quorum 읽기) |
| **wide-column, partition key** | **파티션 키**로 쿼리 좁힘; JOIN 없음; 스키마보다 쿼리 먼저 |

Scylla sweet spot은 **고처리량 + 예측 가능한 초저지연**이다. 아무 NoSQL이나 쓰라는 뜻은 아니다.
:::

:::chat gon Gon
대략 OPS 몇부터 안 하면 오버킬인가요?
:::

:::chat teacher 선생님
Scylla 비용 계산기 맥락의 경험칙이다. **~10K OPS 미만**이면 DynamoDB 지연이 괜찮고, 성장 기대가 없고, AWS에 머물 거면 Scylla는 **오버킬일 가능성이 크다**.

그 위는 read/write 비율이랑 **hot vs cold 데이터 비율**에 달린다. storage-bound(테라바이트는 많은데 OPS는 적음)면 기술적으로는 되도 DynamoDB보다 **비싸질** 수 있다.
:::

---

### 2막 — 잘 맞는 경우

:::chat student AI 학생
Scylla가 특히 빛나는 워크로드는?
:::

:::chat teacher 선생님
**1. partition key 기반 고처리량 OLTP**

- 메시징(Discord), 프로필, 세션, 장바구니, 실시간 입찰
- **50K+ OPS**, P99 single-digit ms, 쓰기 비중 큰 경우 많음 ([write-heavy 글](https://www.scylladb.com/2025/02/04/real-time-write-heavy-workloads-considerations-tips/))

**2. 시계열 / IoT append-only**

- 센서, 메트릭, 로그 — 작은 쓰기 반복, 시간 버킷 파티션
- TWCS; 캐시 효율은 **열린 시간 범위** 쿼리 ([시계열 anti-pattern](https://www.scylladb.com/2019/09/05/time-based-anti-patterns-for-caching-time-series-data/))

**3. online feature store (ML 추론)**

- 엔티티 ID point lookup, 사용자 액션마다 읽기, P99가 승부 ([feature store 글](https://www.scylladb.com/2025/07/15/real-time-feature-store/))
- offline 학습은 S3/웨어하우스 — Scylla는 **online** 쪽

**4. Cassandra / DynamoDB 탈출**

- Cassandra에서 CQL 호환 드롭인
- **Alternator**로 DynamoDB 형태 앱 — throttling, tail latency, 400KB item 한도, 멀티클라우드 lock-in이 아플 때 ([DynamoDB: When to Migrate](https://www.scylladb.com/2023/12/04/dynamodb-when-to-move-out/))
:::

:::chat student AI 학생
쓰기-heavy면 추가로 뭘 조심하나요?
:::

:::chat teacher 선생님
LSM(memtable → SSTable flush)은 append 쓰기에 맞다. 다만 아래는 지켜야 한다.

| 해야 할 것 | 하면 안 되는 것 |
|------------|-----------------|
| write-heavy엔 **STCS / TWCS / ICS** | **Leveled compaction** — write amplification **최대 40배** |
| **파티션 키** 단위 batch, 작은 **unlogged** batch | 큰 cross-partition logged batch |
| **쓰기 속도** 위주 압축(chunk 작을수록 쓰기 유리) | ingest 지속 시 디스크 증가 무시 |

사례: IoT(Tractian), 게임 스파이크, ad-tech, 주식 틱.
:::

---

### 3막 — 피하거나 다시 생각할 때

:::chat student AI 학생
Scylla가 *부적합*이거나 오버킬인 경우는?
:::

:::chat teacher 선생님
**비용 / 규모 미스매치**

- **10K OPS 미만**, 안정, DynamoDB SLA OK → 관리형 DynamoDB가 단순
- **Storage-bound**: TB 수백, 거의 안 읽음 → SSD 클러스터만 키우는 꼴
- 대안: hot만 Scylla, cold는 object store / 분석 DB

**모델 / 쿼리 미스매치**

- JOIN, ad-hoc 분석, full scan이 주 경로 → row-store나 columnar OLAP
- **같은 클러스터**에 OLAP+OLTP → 분석 시작하면 OLTP P99 무너짐 ([OLAP in OLTP](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)); DC/클러스터 분리, off-peak, **Workload Prioritization**

**데이터 모델 anti-pattern** ([modeling mistakes](https://www.scylladb.com/2023/09/11/nosql-data-modeling-mistakes-that-hurt-performance/))

| anti-pattern | 깨지는 이유 |
|--------------|-------------|
| hot / large partition | 채널 하나·키 하나에 무한 동시성, shard 과부하 |
| low-cardinality MV(boolean, country) | 2~195개 거대 파티션 |
| **collection**에 계속 append | 쓰기마다 O(n) merge |
| partition delete 없이 delete-heavy | tombstone run — 읽기가 수백만 마커 스캔 |
| **LatencyAware** LB | hotspot 진동 — **TokenAware** 써 ([best practices](https://resources.scylladb.com/scylladb-best-practices/best-practices-for-scylla-applications)) |

**반대 방향 lock-in**

- Lambda 수천 개 + DynamoDB + AWS 전용 기능(TransactWrite, 고객별 throughput 과금) → DB 절감보다 이전 비용이 클 수 있음
:::

:::chat gon Gon
우리 워크로드 OPS, read/write 비율, 총 데이터량 — 10K 넘나? storage-bound인가요?
:::

:::chat teacher 선생님
도입 전에 **우리 숫자**로 표를 채워 보면 된다.

| 질문 | fit 신호 | misfit 신호 |
|------|----------|-------------|
| 지속 OPS? | ≥10K (write-heavy면 50K+도) | 10K 미만 정체 |
| read:write? | 모델만 맞으면 둘 다 OK | write-heavy + LCS |
| hot 데이터 %? | 대부분 자주 조회 | SSD에 archive만 쌓임 |
| 쿼리 형태? | PK + clustering | scan, 집계, JOIN |
| 성장? | 처리량이 클러스터를 채움 | 데이터만 늘고 OPS는 안 늠 |

Scylla 계산기 힌트는 **최소 10K OPS / 1TB** — 그 아래면 DynamoDB나 더 작은 관리형부터 검토.
:::

---

### 4막 — Discord 참고 use case

:::chat student AI 학생
Discord가 "good fit"에 어떻게 대응하나요? Superdisk RAID는 빼고요.
:::

:::chat teacher 선생님
[Discord 마이그레이션 글](https://discord.com/blog/how-discord-stores-trillions-of-messages)이 **조 단위 메시징**의 표준 사례다. Superdisk는 [앞 노트](/research-notes/ko/notes/discord-superdisk/)에 두고, *fit*만 보면 이렇다.

**워크로드:** `(channel_id, time_bucket)` 파티션; 히스토리 읽기 비중; 메시지마다 쓰기; 인기 채널 = hot partition.

**Cassandra가 힘들었던 이유:** JVM GC, compaction 밀림, hot partition quorum이 클러스터 전체 지연으로 번짐.

**Scylla가 맞았던 이유:**

- C++ / GC 없음, shard-per-core 격리
- Cassandra 177노드 → **Scylla 72노드**, p99 read **40–125ms → 15ms**
- CQL 호환 — 앱/쿼리 모델 대부분 유지

**Scylla만으로 안 된 것:** hot partition은 그대로. **Rust data services** — request coalescing + 채널 기준 consistent-hash 라우팅 — 을 **가장 큰 클러스터 올리기 전에** 깔았어.

**우리 입장:** 초대형 scale의 partition-key OLTP에는 Scylla가 맞지만, 극단적 skew는 **앱 레이어 방패**와 읽기 지연용 스토리지 튜닝(Superdisk)이 같이 필요하다. DB 선택만으로 아키텍처가 끝나지는 않는다.
:::

:::chat gon Gon
쿼리가 전부 partition key로 좁혀지나요, JOIN·ad-hoc 분석이 필요한가요?
:::

:::chat teacher 선생님
JOIN이나 ad-hoc SQL이 핵심이면 Scylla를 primary로 쓰기 어렵다. 프로덕션 경로가 전부 `WHERE pk = ? [AND clustering range]`면 같은 계열이다. 그다음 **hot-key** 리스크를 검증하면 된다(Discord: @everyone 대량 알림).

부가 분석은 별도 파이프라인(Spark, 웨어하우스, 격리된 Scylla DC)으로 돌리고, serving 클러스터에서 full scan은 피한다.
:::

---

### 5막 — 의사결정 치트시트

| 축 | Scylla fit | 재검토 |
|----|------------|--------|
| 처리량 | 10K~수백만 OPS | 10K 미만, 정체 |
| 지연 SLA | P99 single-digit ms 필수 | DynamoDB + 가끔 스파이크 OK |
| 데이터 접근 | hot, PK lookup | cold archive, scan 위주 |
| 데이터 모델 | wide-column, 쿼리 주도 | 관계형, JOIN 중심 |
| 출발점 | Cassandra/DynamoDB 고통(GC, throttle, 비용) | 그린필드, 소규모 |
| 운영 | 3+ 노드·모델링 각오 | 테이블 단위 zero-ops 원함 |
| 멀티 워크로드 | OLTP만, 또는 격리/우선순위 | OLAP+OLTP 한 클러스터, 통제 없음 |

:::chat gon Gon
데이터 중 몇 %가 자주 읽히나요? cold tier를 Scylla 밖으로 뺄 수 있나요?
:::

:::chat teacher 선생님
Scylla는 **실제로 서빙하는 데이터**를 로컬 SSD에 둔다고 가정한다. Overkill 글 예시처럼 DynamoDB 250TB 전체를 올리면 Scylla 노드가 거대해진다. **hot 10%만** Scylla에 두고 나머지는 밖에 두면 비용 이야기가 달라진다.

TTL, 16MB 넘는 blob은 S3로 빼는지(DynamoDB 400KB 한도 대비), archive 읽기를 저렴한 store로 우회할지도 같이 보면 된다.
:::

:::chat gon Gon
Cassandra/DynamoDB에서 쓰는 기능 중 Scylla에 없는 게 있나요?
:::

:::chat teacher 선생님
Overkill + DynamoDB migration 문서 기준:

| 기능 | Scylla 공백 |
|------|-------------|
| DynamoDB **TransactWrite/Get** 다중 item | 1:1 아님 — 설계로 우회 |
| 고객별 **throughput 과금/캡** | 기본 내장 없음 |
| **AWS 전용** 깊은 결합(Lambda 수천) | 리팩터 비용 |
| DynamoDB on-demand **테이블별** 과금 | Scylla는 **클러스터** 프로비저닝 |

이게 핵심이 아니면 이전은 모델과 드라이버 위주다. Alternator면 endpoint 한 줄로 끝나는 경우도 많다.
:::

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** Scylla fit을 만드는 설계 전제 세 가지와, 깨질 때는?
---
**로컬 SSD**, **3노드 이상 오버헤드**, **partition key wide-column**. **cold/archive**, **~10K OPS 미만**, **JOIN·scan·같은 클러스터 OLAP**이면 깨짐.
:::

:::quiz
**Q2.** DynamoDB 대비 Scylla가 오버킬일 often 한 OPS 하한?
---
**~10K OPS 미만** + 성장 정체 + DynamoDB 지연 수용 + AWS 유지 — Scylla 비용 프레이밍의 힌트. 절대값은 아님.
:::

:::quiz
**Q3.** good fit 워크로드 두 가지와 write-heavy 함정 하나?
---
**메시징/유저 상태**, **online feature store**(PK lookup, 낮은 P99). 함정: write-heavy에 **leveled compaction**(write amp 최대 40배), **cross-partition batch**.
:::

:::quiz
**Q4.** Discord가 Scylla가 빨라졌는데도 data services를 만든 이유?
---
**Hot partition**은 남음. **Request coalescing** + **채널 라우팅**으로 DB 동시 hit 상한 — GC/compaction 고통은 Scylla가 줄였지만 skew는 앱이 막음.
:::

:::quiz
**Q5.** 한 Scylla 클러스터에 OLAP+OLTP — 무슨 일이 나고 대안은?
---
분석이 CPU/IO 먹고 **OLTP P99 급등**([Scylla 블로그 그래프](https://www.scylladb.com/2026/01/28/can-database-workloads-coexist/)). **클러스터/DC 분리**, **off-peak 분석**, **Workload Prioritization**(shares 있는 service level).
:::

## 메모

Cassandra/Scylla 트랙 — Superdisk 다음 결정 노트. 다음: 클라이언트 베스트 프랙티스(드라이버, TokenAware, CL).
