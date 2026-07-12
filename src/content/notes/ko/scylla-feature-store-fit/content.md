---
title: 'Scylla를 Feature Store로 — 적합성, 함정 & Feature Store 기초'
---

## 레퍼런스

- [Real-Time ML with ScyllaDB as a Feature Store (블로그)](https://www.scylladb.com/2025/07/15/real-time-feature-store/)
- [Why ScyllaDB as a feature store? (문서)](https://feature-store.scylladb.com/stable/about-feature-stores.html)
- [Feature Store 솔루션 페이지](https://www.scylladb.com/solution/feature-store/)
- [Integrate ScyllaDB and Feast](https://feature-store.scylladb.com/stable/feast-scylladb-online-store.html)
- [When ScyllaDB is Overkill vs. DynamoDB](https://www.scylladb.com/2024/11/19/scylladb-overkill-vs-dynamodb/)
- [Scylla가 적합한 경우 (앞 노트)](/research-notes/ko/notes/scylla-use-cases/)
- [Scylla 클라이언트 베스트 프랙티스](/research-notes/ko/notes/scylla-client-best-practices/)
- [Partition key 내부 기전](/research-notes/ko/notes/scylla-partition-key-internals/)
- [What is a Feature Store? (Databricks)](https://www.databricks.com/blog/what-is-a-feature-store)
- [Feast documentation](https://docs.feast.dev/)

---

## 왜 이 글을 찾아봤나

- **계기:** **Scylla를 feature store 목적으로 쓰는 게 적절한지** 보고 싶다. **feature store 개념**도 같이 정리해 달라.
- **맥락:** [use case 노트](/research-notes/ko/notes/scylla-use-cases/)에 online feature store가 good fit으로 한 줄만 나온다. ML 인프라 판단용 **별도 노트**.
- **범위:** feature store 기초 → Scylla가 맞는 층(online) / 안 맞는 층.

---

## 읽으면서 느낀 점

Scylla 적합성을 보려면 feature store 전체가 아니라 **offline / online / registry** 중 **online 한 층**만 먼저 가려야 했다.

---

## 배운 것

*배경: use case·클라이언트·PK 노트를 바탕으로 feature store를 설명하고, Scylla가 **online tier**에 맞는지 본다.*

---

### 1막 — Feature store가 뭐야?

:::chat gon Gon
Scylla를 feature store로 쓰는 게 적절할까요? feature store 개념도 같이 알고 싶어요.
:::

:::chat teacher 선생님
**Feature**는 ML 모델 입력 — 원시값이든 가공값이든(예: “최근 10분 좋아요 수”, “나이”, “장바구니 합”). **Feature vector**는 한 번의 예측에 쓰는 feature 묶음([Scylla feature store 블로그](https://www.scylladb.com/2025/07/15/real-time-feature-store/)).

**Feature store**는 feature를 만들고, 저장하고, 찾고, **학습·추론에 공급**하는 중앙 시스템([Databricks](https://www.databricks.com/blog/what-is-a-feature-store)):

| 풀려는 문제 | 방법 |
|-------------|------|
| **Training–serving skew** | 오프라인 학습·온라인 추론에 **같은 feature 정의** |
| **중복 파이프라인** | 팀이 feature 재사용 |
| **거버넌스** | 메타데이터, lineage, 버전 |
| **서빙 추상화** | 배치 학습 세트·실시간 lookup **한 API** |

“Feature store” = DB 하나가 **아니다**. 보통 **registry + offline store + online store**.
:::

:::chat student AI 학생
offline store랑 online store 차이는요?
:::

:::chat teacher 선생님
워크로드가 달라서 저장소도 갈린다([블로그](https://www.scylladb.com/2025/07/15/real-time-feature-store/)):

| | **Offline store** | **Online store** |
|---|-------------------|------------------|
| **목적** | **학습**, 백테스트, 배치 스코어링 | 사용자 요청 **실시간 추론** |
| **데이터** | entity별 **장기 이력** | 보통 entity당 **최신값만** |
| **지연** | 초~시간 OK | **밀리초** — p99 &lt;10~15ms 흔함 |
| **쿼리 크기** | 대량 스캔, point-in-time join | `user_id`/`item_id` **point lookup** |
| **백엔드** | S3/Parquet, BigQuery, Snowflake | Redis, DynamoDB, Cassandra/**ScyllaDB** |

**Materialization:** 배치/스트림이 feature 계산 → **둘 다**에 쓰기(또는 offline→online 갱신). 추론: 앱 → **online store** → 모델 → 예측.

feature fetch + 모델이 end-to-end 예산 — online이 느리면 전환·추천 타이밍을 놓친다.
:::

---

### 2막 — Feast, Tecton, 번들 스토어

:::chat student AI 학생
Feast/Tecton이 꼭 필요해요? Scylla만으로는 안 되나요?
:::

:::chat teacher 선생님
**Scylla만** = DB. feature 정의·materialization·서빙 API는 직접 짜거나 프레임워크가 필요하다.

| 선택 | 역할 | Online DB |
|------|------|-----------|
| **Feast** (오픈소스) | Registry, offline/online 추상화, serving API — **DB는 가져옴** | Redis, Postgres, Cassandra/**Scylla** ([Feast](https://docs.feast.dev/)) |
| **Tecton** (관리형) | 파이프라인·변환·SLA 포함 | 보통 DynamoDB/Redis |
| **SageMaker / Vertex / Hopsworks** | 플랫폼 번들 | online store **락인**인 경우 많음 |

[Scylla 블로그](https://www.scylladb.com/2025/07/15/real-time-feature-store/): **BYO-DB**(Feast 등)면 online tier만 갈아끼우기 쉽다 — latency·비용 튀어도 플랫폼 전체 이전은 덜 아프다.

**Feast + Scylla:** Cassandra 호환 커넥터(`pip install feast[cassandra]` 또는 `feast[scylladb]`), `feature_store.yaml`에 Scylla 노드([연동 문서](https://feature-store.scylladb.com/stable/feast-scylladb-online-store.html)).
:::

---

### 3막 — Scylla가 스택 어디에 있나

:::chat student AI 학생
그럼 Scylla feature store로 괜찮다 — 예/아니오?
:::

:::chat teacher 선생님
**조건부 yes:**

| 층 | Scylla |
|----|--------|
| **feature store 제품 전체** | **아니오** — Feast/Tecton이 아니라 **스토리지** |
| **Online store (추론)** | **종종 예** — 요구사항이 Scylla sweet spot이면 |
| **Offline store (학습 이력)** | **보통 아니오** — lake/warehouse(Parquet, BigQuery)가 scan·point-in-time에 유리 |
| **Scylla에서 bulk 학습 읽기** | 일부 파이프라인은 가능([training data 문서](https://feature-store.scylladb.com/stable/))하지만 **기본 아키텍처는 아님** |

Scylla 포지션([about feature stores](https://feature-store.scylladb.com/stable/about-feature-stores.html)): **저지연 서빙**, **고처리량**, **대규모**, **HA** = **online tier**.

[use case](/research-notes/ko/notes/scylla-use-cases/)와 맞음: entity ID point lookup, 사용자 액션마다 읽기, **P99가 제품**.
:::

---

### 4막 — Scylla가 **잘 맞는** online feature store

:::chat student AI 학생
online feature에 Scylla 쓰라는 신호는 뭐예요?
:::

:::chat teacher 선생님
아래가 **대부분** 맞을 때 강한 fit:

| 신호 | Scylla 이유 |
|------|-------------|
| **P99 엄격**(한 자릿수 ms, &lt;5~10ms) | shard-per-core + SSD; 문서상 &lt;1ms P99 가능 주장 — **우리 스키마로 검증** 필수 |
| **높은 QPS**(10만~수백만/sec) | throughput OLTP sweet spot |
| **online working set 큼**(TB+, RAM만으로 안 됨) | 캐시+디스크 vs Redis RAM 한계 |
| **멀티 DC / on-prem / AWS 락인 회피** | SageMaker+DynamoDB만 쓰는 스택 대안 |
| **Cassandra/DynamoDB online store 이전** | Alternator / CQL 호환 |
| **entity = partition key** | `WHERE entity_id = ?` 한 partition lookup([PK internals](/research-notes/ko/notes/scylla-partition-key-internals/)) |
| **Feast 등 이미 선택** | Scylla online store 문서화됨 |

Medium 등 **리스트·feature 서빙** 사례([솔루션 페이지](https://www.scylladb.com/solution/feature-store/)).

**모델링 스케치:**

```sql
PRIMARY KEY (entity_id, feature_timestamp)  -- 또는 최신만 (entity_id)
```

stale feature는 **TTL**, **LOCAL_QUORUM**, shard-aware + prepared([클라이언트](/research-notes/ko/notes/scylla-client-best-practices/)).
:::

---

### 5막 — **안 맞거나** 오버킬일 때

:::chat student AI 학생
feature store에 Scylla 쓰면 안 되는 경우는요?
:::

:::chat teacher 선생님
**약한 fit / 오버킬:**

| 상황 | 대안 |
|------|------|
| online만 필요, **&lt;10K OPS**, 작은 RAM 데이터 | **Redis** — 단순, sub-ms, RAM 한계([Overkill](/research-notes/ko/notes/scylla-use-cases/)) |
| **DynamoDB latency OK**, AWS만, 성장 적음 | DynamoDB(+DAX) — Scylla 3노드 운영보다 가벼움 |
| **feature store 전체를 DB 하나에** | offline 이력은 lake/warehouse |
| feature **ad-hoc 분석** | OLAP warehouse([use case OLTP vs OLAP](/research-notes/ko/notes/scylla-use-cases/)) |
| entity 간 **ACID 트랜잭션** | DynamoDB TransactWrite류 — Scylla 갭 |
| **작은 팀**, DBA/K8s 부담 싫음 | 관리형 Redis/DynamoDB/Feast+RDS가 빠를 수 있음 |
| **벡터 ANN** 대규모 | 별도 벡터 인덱스 층 검토 |

**Redis → Scylla** 동기: RAM·AOF 한계, **디스크 백** 저지연이 필요할 때.

**비용:** calculator 힌트 **~10K OPS / 1TB**([Overkill](/research-notes/ko/notes/scylla-use-cases/)) — lookup QPS 낮으면 3노드 클러스터 부담이 클 수 있음.
:::

---

### 6막 — 모델링·운영 체크리스트 (online)

:::chat student AI 학생
online에 Scylla 쓰면 설계에서 뭘 챙기나요?
:::

:::chat teacher 선생님
| 영역 | 규칙 |
|------|------|
| **접근 패턴** | 추론 1회 = **entity_id** 하나 → **partition key** lookup |
| **wide vs narrow** | feature group별 테이블 — PK 하나에 이력 무한 append 금지 |
| **신선도** | materialization **upsert** 최신값; **TTL** 만료 |
| **hot key** | 바이럴 entity — bucket·feature 분리([PK 보충](/research-notes/ko/notes/scylla-partition-key-internals/)) |
| **클라이언트** | Feast + 추론 서비스: prepared, token/shard-aware, LOCAL_QUORUM |
| **모니터링** | staleness, null 비율, p99, CQL optimization |
| **offline parity** | Spark/Flink 변환 코드 = materialization — registry가 정의 고정 |

**Anti-pattern:** 학습 이력 전부 online 테이블; `ALLOW FILTERING` feature 검색; write-heavy **cross-partition logged batch**.
:::

---

### 7막 — 판단 요약

| 질문 | 답 |
|------|-----|
| Scylla = feature store? | **아니오** — **online store 백엔드**(일부 bulk 학습 소스 가능) |
| feature store 용도로 적절? | **online serving**에 **예** — P99·QPS·working set·Feast/BYO-DB 맞을 때 |
| 항상 적절? | **아니오** — 저QPS/소데이터→Redis·DynamoDB; offline→warehouse; 플랫폼→Feast/Tecton+층별 DB |

```
[Raw events] → [Feature pipelines] → Offline (lake/warehouse)  → 학습
                                   → Online (Scylla?)         → 추론
            [Registry: Feast/Tecton — 정의 & materialization]
```

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 전형적인 feature store 아키텍처 세 층?
---
**Registry**(정의/메타) + **offline store**(학습용 이력) + **online store**(추론용 최신 feature). Scylla는 보통 **online**만.
:::

:::quiz
**Q2.** offline vs online — 지연·데이터 형태?
---
**Offline:** 대량 이력 스캔, 초~시간, point-in-time 학습 join. **Online:** entity당 최신값, **ms** lookup, entity ID point read 고QPS.
:::

:::quiz
**Q3.** Feast + Scylla를 같이 쓰는 이유?
---
**Feast** = registry·materialization·serving API. **Scylla** = **끼워 넣는 online DB** — 정의·skew 제어는 Feast, 저장·저지연 조회는 Scylla.
:::

:::quiz
**Q4.** Scylla online feature store 강한 fit 신호 두 가지?
---
예: **한 자릿수 P99** + **고QPS**; **TB급** online working set; **entity PK point lookup**; Cassandra/DynamoDB online 이전; 멀티 DC/on-prem.
:::

:::quiz
**Q5.** online feature에 Scylla 오버킬인 때?
---
**저 OPS**(&lt;~10K), **Redis** RAM에 들어가는 소데이터, AWS **DynamoDB** latency 만족, 3노드 클러스터 운영 부담 — Scylla overkill 프레이밍([use case](/research-notes/ko/notes/scylla-use-cases/)).
:::

:::quiz
**Q6.** Scylla online feature 테이블 모델링 규칙 하나?
---
**partition key = entity_id**(또는 복합 entity key); 추론 1회 1 lookup; partition 무한 성장 막기 — TTL·bucket, 이력은 **offline**만.
:::

## 메모

Feature store 기초 + Scylla **online tier** 적합성 — use case 한 줄에서 분리. Feast+Scylla 채택 시 클라이언트·PK 노트 이어서 보면 됨.
