---
title: 'OpenSearch 코어 기본 기능: 기능 서베이'
---

## 레퍼런스

- [Introduction to OpenSearch](https://docs.opensearch.org/latest/getting-started/intro/)
- [OpenSearch concepts](https://docs.opensearch.org/latest/getting-started/concepts/)
- [OpenSearch Core (platform overview)](https://opensearch.org/platform/opensearch-core/)
- [Creating a cluster / node types](https://docs.opensearch.org/latest/tuning-your-cluster/)
- [Query DSL](https://docs.opensearch.org/latest/query-dsl/)
- [Aggregations](https://docs.opensearch.org/latest/aggregations/)
- [Mappings](https://docs.opensearch.org/latest/mappings/)

---

## 왜 이 글을 찾아봤나

OpenSearch 기본 기능을 논문 형태로 자세히 소개해 달라고 요청했다.

---

## 읽으면서 느낀 점

—

---

## 배운 것

### Abstract

OpenSearch는 Apache Lucene 위에 올라간 분산 검색·분석 엔진이다. 겉으로는 “JSON을 넣고 순위가 매겨진 히트와 차트를 받는다”처럼 보이지만, 실무에서 쓸 만한 모델은 문서 → 인덱스 → 샤드 → 노드 → 클러스터 계층과, 어휘 검색용 역색인, durability·가시성을 가르는 translog / refresh / flush / merge 쓰기 경로, 조회·분석용 Query DSL + aggregations API다. 이 노트는 각 프리미티브가 무엇을 소유하는지, 요청이 어떻게 흐르는지, 설계 리뷰에서 어떤 기본값이 중요한지를 정리한다. CCR이나 Region 이전은 다른 노트에서 다룬다.

### 1. Introduction — “검색·분석 엔진”이 실제로 의미하는 것

OpenSearch는 웹사이트 검색창부터 보안 로그 분석·옵저버빌리티까지 넓은 워크로드를 겨냥한다. “분산”은 하나의 논리 인덱스가 여러 머신에 걸친다는 뜻이고 “검색·분석”은 같은 저장소가 관련도 순위 검색과 통계 요약(집계)을 — 종종 한 요청 안에서 — 둘 다 답한다는 뜻이다.

엔지니어에게 쓸모 있는 질문은 이런 쪽이다.

| 질문 | 왜 중요한가 |
|------|-------------|
| 저장·조회의 단위는? | 인덱스 안의 문서(JSON) |
| 한 디스크를 넘는 확장은? | 샤드가 문서를 노드에 나눠 둔다 |
| 조율과 저장은 누가? | cluster manager vs data vs coordinating/ingest 역할 |
| 쓰기는 언제 durable하고 언제 searchable한가? | translog ack vs refresh |
| 매칭과 요약은 어떻게 묻나? | Query DSL vs aggregations |
| 텍스트는 어떻게 검색어가 되나? | analyzer → 역색인, 순위는 BM25 |

OpenSearch Core 위에 플러그인과 Dashboards가 얹힌다. BM25 기반 어휘 검색, 벡터/k-NN·하이브리드 검색, 보안, 알림, ML은 모두 같은 문서·인덱스 기판을 확장한다.

### 2. 데이터 모델 — 문서, 인덱스, 매핑

**문서.** 정보의 원자 단위로 JSON으로 저장된다. RDB의 한 행, 또는 검색이 돌려주는 한 레코드로 생각하면 된다. ID는 클라이언트가 주거나 자동 할당되고, 필드는 하나 이상이다.

**인덱스.** 관련 문서의 이름 있는 집합이다. RDB의 “데이터베이스”보다 테이블에 가깝다. 검색은 하나 이상의 인덱스를 대상으로 한다. 인덱스에는 설정(샤드·레플리카 수, refresh 간격 등)과 매핑(스키마)이 붙는다.

**매핑.** 필드를 어떻게 저장·색인할지에 대한 스키마다. 타입을 동적으로 추론하기도 하지만, 운영에서는 보통 명시적으로 둔다. 전화번호가 `text`로 잡혀 산문처럼 토큰화·스코어링되는 일을 막으려는 것이다.

필드 타입 계열:

| 계열 | 전형적 용도 | 검색 동작 |
|------|-------------|-----------|
| `text` | 본문, 제목 | 분석 → 역색인 토큰, 관련도 스코어링 |
| `keyword` | ID, 태그, exact 필터, 집계 | exact 매칭, 분석 없음(또는 normalizer만) |
| 숫자 / `date` / `boolean` | 지표, 시각, 플래그 | range·정렬·집계(doc values) |
| object / nested | 구조화된 하위 문서 | nested는 객체 단위 쿼리를 보존 |
| geo / vector | 위치, 임베딩 | 전용 쿼리(geo, k-NN) |

같은 문자열을 “검색도 하고 패싯도 할” 때 쓰는 표준 패턴이 multi-field다. `product_name`을 `text`로 두고 `keyword` 서브필드(예: `product_name.raw`)를 붙이면 full-text와 집계가 서로 싸우지 않는다. 분석된 `text`에 `fielddata`를 켜고 직접 집계하는 길은 비싸고 비권장이다.

### 3. 클러스터 아키텍처 — 노드와 역할

OpenSearch 클러스터는 `cluster.name`을 공유하며 하나의 상태를 이루는 노드들의 집합이다. 노트북의 단일 노드 클러스터에서는 한 프로세스가 전부 한다. 운영에서는 역할을 나눠 클러스터 메타데이터 작업이 무거운 색인·검색과 자원을 다투지 않게 한다.

| 역할 | 소유 | 운영 메모 |
|------|------|-----------|
| **Cluster manager** | 클러스터 상태: 인덱스, 매핑, 샤드 할당, 멤버십 | 쿼럼을 위해 존을 나눈 **전용 3대**를 선호 |
| **Data** | 샤드 저장, 로컬 샤드에서 색인·검색·집계 | 디스크·RAM 중심, 존 균형 배수로 확장 |
| **Ingest** | 인덱스에 들어가기 전 ingest pipeline 실행 | 파이프라인이 CPU 무거우면 전용 |
| **Coordinating** | 클라이언트 요청 라우팅, 샤드 fan-out, 결과 reduce | 모든 노드가 가능, 검색이 무거우면 `node.roles: []` 전용 |
| **Search / ML 등** | 검색 레플리카, ML 작업 등 | 데이터 노드 용량을 뺏을 때 분리 |

기본값으로는 각 노드가 cluster-manager-eligible, data, ingest, coordinating을 겸한다. 전용 역할은 `opensearch.yml`의 `node.roles`로 지정한다. 클라이언트·Dashboards 트래픽은 ingest/coordinating/data로 보내고 cluster manager로는 직접 보내지 않는 편이 낫다.

요청 경로 스케치:

```
Client / Dashboards / Data Prepper
        │
        ▼
┌───────────────────┐
│ Coordinating node │  요청 파싱, 샤드 선택, 응답 reduce
└─────────┬─────────┘
          │ fan-out
          ▼
┌───────────────────┐
│ Data nodes        │  primary/replica 샤드에서 실행 (Lucene)
└───────────────────┘
```

인덱스를 만들거나 매핑을 바꾸고 샤드를 할당하는 cluster-manager 작업은 데이터 경로와 분리되어 있지만, 건강해야 한다. 쿼럼을 잃으면 이미 할당된 샤드 검색은 한동안 될 수 있어도 클러스터 상태 변경은 멈춘다.

### 4. 샤드와 레플리카 — 분산의 단위

OpenSearch는 인덱스를 샤드로 나눈다. 각 샤드는 문서 일부를 담은 완전한 Lucene 인덱스다. 큰 논리 인덱스를 여러 디스크·CPU에 펼치기 위한 장치다.

- **Primary shard** — 해당 문서 부분집합의 쓰기 권한을 가진 원본.
- **Replica shard** — primary 복사본. primary 노드 장애 시 대체하고, 검색 읽기 용량도 늘린다.

리뷰에서 기본값이 중요하다. 오픈소스 OpenSearch는 흔히 primary 1 + replica 1(샤드 복사본 2개)이 기본이고, 관리형(예: Amazon OpenSearch Service)은 과거 기본값이 다를 수 있다. primary 개수는 인덱스 생성 시점에 고정된다(reindex/split/shrink 같은 별도 절차가 없으면). replica 수는 살아 있는 동안 바꿀 수 있다.

문서에 나오는 경험 규칙:

- 샤드당 대략 10–50 GB — 너무 잘게 쪼개면 힙·파일 핸들을 낭비하고 너무 크면 병렬성과 복구 시간이 나빠진다.
- Replica는 primary와 다른 노드에 둔다.
- Replica를 늘리면 읽기 중심 부하와 가용성에 도움이 되지만, 디스크와 색인 시 write amplification 비용이 따른다.

```
Index "orders"
  ├── Primary P0 ──► Replica R0
  ├── Primary P1 ──► Replica R1
  └── Primary P2 ──► Replica R2
         │
         └── 데이터 노드에 분산
```

### 5. 역색인, 분석, 관련도

어휘 검색의 기반은 역색인이다. term에서 그 term을 품은 문서(와 위치)로 가는 맵이다. “Beauty is in the eye of the beholder”와 “Beauty and the beast”는 분석 후 소문자화된 `beauty` term을 공유한다.

텍스트 분석은 색인 시점(그리고 full-text 쿼리에서는 보통 질의 시점에도) 돈다.

1. **Character filter** — 원문 문자 정규화
2. **Tokenizer** — 토큰(대개 단어)과 위치 기록
3. **Token filter** — 소문자화, 불용어, 스테밍, 동의어 등

기본 standard analyzer는 소문자화와 토큰화를 하므로 `text` 필드는 대체로 대소문자 무시 검색이 된다. phrase 쿼리는 저장된 위치를 써서 단어가 서로 가까워야 한다고 요구한다.

**관련도.** 매칭된 문서는 점수를 받는다. OpenSearch는 Okapi BM25로 순위를 매긴다.

| 성분 | 직관 |
|------|------|
| Term frequency | 드문 편인 term이 문서에 더 자주 나오면 점수↑ |
| Inverse document frequency | 더 적은 문서에만 있는 term이 더 변별력 있음 |
| Length normalization | 짧은 문서의 매칭이, 긴 문서에 희석된 같은 매칭보다 유리 |

Query context는 “얼마나 잘 맞나?”(점수)를 묻고, filter context는 “맞나?”(예/아니오, 캐시 친화, 점수 없음)를 묻는다. 운영 쿼리는 테넌트 ID·상태·시간 범위를 filter에 두고, 점수는 관련도가 필요한 절에만 남긴다.

### 6. 쓰기 경로 — durability와 검색 가시성

색인은 “Lucene에 한 번 쓰고 끝”이 아니다. 공식 concepts 문서의 수명은 대략 이렇게다.

1. **Primary에서 수락** — 샤드 translog에 쓰고 fsync한 뒤 ack해 durable하게 만든다. Lucene writer의 메모리 버퍼에도 넘긴다. 설정에 따라 replica로 복제한다.
2. **Refresh** — 주기적으로 메모리 버퍼를 새 디스크 segment로 만들고 reader를 열어 문서를 검색 가능하게 한다. soft commit에 가깝다. 디스크에는 있지만 Lucene 파일 durability 경계는 아직 아니다.
3. **Flush** — Lucene segment를 fsync해 내구성 있게 남기고, 해당 translog 항목을 비울 수 있게 한다.
4. **Merge** — segment는 불변이다. 작은 segment가 큰 것으로 합쳐지며 삭제·갱신을 정리하고 검색 효율을 유지한다.

운영 함의:

| 관심사 | 메커니즘 |
|--------|----------|
| `201`인데 바로 검색하면 없음 | 아직 refresh 전 (`refresh_interval`, 또는 `?refresh=true` / `wait_for`) |
| ack 후 노드 크래시 | flush되지 않은 durable ops는 translog 재생으로 복구 |
| 쓰기 폭주 시 디스크·검색 지연 | merge 정책과 segment 수, tiny segment 과다 주의 |
| update / delete | 새 segment에 새 버전·툼스톤, 예전 데이터는 merge 때 정리 |

대량 적재의 기본 경로는 bulk indexing이다.

### 7. 검색 API — Query DSL

Query DSL은 매칭을 JSON으로 기술하는 언어다. 요청은 `_search`(선택적으로 인덱스 범위)로 간다. 쿼리는 대략 둘로 나뉜다.

| 부류 | 역할 | 예 |
|------|------|----|
| **Leaf** | 필드에서 값 매칭 | `match`, `term`, `range`, `geo_*`, `nested`, … |
| **Compound** | 다른 절을 묶거나 감쌈 | `bool`, `dis_max`, `constant_score`, `function_score`, `boosting` |

Full-text leaf(`match` 등)는 필드의 analyzer로 질의 문자열을 분석한다. Term-level(`term`, `terms` 등)은 exact 값을 기대한다 — `keyword`/숫자/날짜에 쓰고, 분석된 `text`에는 (특정 토큰을 의도한 경우가 아니면) 쓰지 않는다.

실무의 중심 compound는 `bool`이다. `must` / `should` / `must_not` / `filter`. 점수 없는 제약은 `filter`에 둔다.

일부 쿼리 타입은 비싸다(fuzzy, prefix, wildcard, 일부 `query_string`, text/keyword 위 range 등). `search.allow_expensive_queries`로 막고, shard slow log로 추적한다.

다른 표면용 언어도 있다. URL 친화적인 query string, Dashboards 필터용 DQL, 파이프형 옵저버빌리티 PPL. 애플리케이션 검색의 출발점은 대개 Query DSL이다.

### 8. Aggregations — 같은 저장소 위의 분석

집계는 매칭 문서(쿼리로 좁힌 집합일 수 있음)를 요약한다. `"size": 0`이면 집계 결과만 돌려준다. 세 계열:

| 유형 | 목적 | 예 |
|------|------|----|
| **Metric** | 숫자(및 관련) 필드 통계 | `avg`, `sum`, `min`/`max`, `cardinality`, `percentiles` |
| **Bucket** | 문서 그룹화 | `terms`, `date_histogram`, `histogram`, `range`, `filters` |
| **Pipeline** | 다른 agg 출력을 다시 집계 | `avg_bucket`, `cumulative_sum`, `bucket_sort` |

중첩 집계(버킷 아래 sub-agg)가 Dashboards 시각화의 뼈대다. 예: category `terms` → 가격 `avg`. 집계는 단순 검색보다 CPU·메모리를 더 쓰고, 정렬·집계에는 doc values(디스크 위 컬럼형 구조)에 기대는 경우가 많다.

규칙: 집계는 `keyword`(또는 숫자/날짜)에 하고, 분석된 `text`에는 하지 않는다.

### 9. 코어 프리미티브 너머의 기능 계열

같은 문서·인덱스·샤드 기판 위에 올라가는 것들:

| 능력 | 추가하는 것 |
|------|-------------|
| **Lexical search** | 키워드/전문 검색 + BM25 |
| **Vector / semantic search** | 임베딩 + k-NN, 의미 기반 검색 |
| **Hybrid search** | 어휘·시맨틱 순위 결합 |
| **Ingest pipeline / Data Prepper** | 색인 직전·가장자리에서 변환·보강 |
| **OpenSearch Dashboards** | 탐색, 시각화(agg 기반), Dev Tools |
| **Plugins** | 보안, 알림, ISM, 이상 탐지, CCR 등 |

이 서베이는 그 기능들이 공유하는 프리미티브에서 멈춘다. CCR과 multi-Region 이전 패턴은 별도 노트다.

### 10. 종합 다이어그램

```
Clients / Dashboards / Ingest tools
              │
              ▼
     Coordinating / Ingest nodes
              │
              ▼
┌─────────────────────────────────────┐
│ Cluster state (cluster manager)     │
│  indices · mappings · allocation    │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ Index = documents + mapping         │
│   └── Shards (primary + replicas)   │
│         └── Lucene segments         │
│               inverted index ·      │
│               doc values            │
└─────────────────────────────────────┘
              │
     search ←─┴─→ aggregations
     (Query DSL, BM25 / filters)   (metrics · buckets · pipelines)
```

**설계 테제.** 쿼리를 튜닝하기 전에 매핑 계약(`text` vs `keyword`, multi-field)과 샤드 크기를 먼저 고정한다. durability(translog)와 검색 가시성(refresh)을 분리해 생각한다. 필터는 filter context에 두고, 점수는 순위가 필요한 것에만 남긴다. 집계는 같은 샤드 위의 1급 분석 경로로 다루되, CPU·메모리 비용을 인정한다. 붙인 웨어하우스가 아니다.

### 11. Conclusion

OpenSearch 코어는 클러스터로 포장된 Lucene이다. 매핑된 인덱스의 JSON 문서가 primary/replica 샤드로 데이터 노드에 나뉘고, cluster manager가 발견·할당하며, coordinating 노드의 reduce 단계로 질의된다. 어휘 검색은 역색인 + 분석 + BM25이고, 쓰기는 translog·refresh·flush·merge의 명시적 경로를 따르며, 분석은 같은 엔진의 aggregations로 이어진다. 이 기본기를 잡는 일이 사이징·쿼리 설계와 이후 주제(ISM, CCR, 벡터 검색)의 전제다. 자연스러운 다음 단계는 매핑/분석기 심화, Query DSL 스코어링 조합, 쓰기 경로의 segment 수명이다.

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 샤드가 “OpenSearch 인덱스의 조각”이면서 동시에 “완전한 Lucene 인덱스”인 이유는?
---
OpenSearch는 논리 인덱스를 샤드로 나눠 분산하지만, 각 샤드는 자체 Lucene 인덱스(세그먼트, 역색인, doc values)로 구현된다. 그래서 샤드 개수는 디스크 크기뿐 아니라 CPU·힙·파일 핸들 비용도 좌우한다.
:::

:::quiz
**Q2.** 인덱싱 응답은 성공인데 바로 이어서 검색하면 문서가 안 보인다. 보통 무슨 일인가?
---
쓰기는 durable translog(와 replica) 처리 후 ack됐지만, 아직 refresh가 새 검색 가능 segment를 열지 않은 상태다. refresh를 강제하거나 기다리지 않으면 검색 가시성은 durability보다 늦다.
:::

:::quiz
**Q3.** 필드를 `keyword`로 둘 때와 `text`로 둘 때, multi-field는 왜 쓰나?
---
`keyword`는 exact 매칭·정렬·집계(ID, 상태, 태그)용, `text`는 분석된 full-text 검색용이다. multi-field는 한 문자열의 두 뷰를 같이 두어, 분석 쪽에서 검색하고 exact 쪽에서 집계/필터하며 `text`에 비싼 `fielddata`를 켜지 않게 한다.
:::

:::quiz
**Q4.** Query DSL에서 query context와 filter context의 차이는?
---
Query context는 “얼마나 잘 맞는지”를 점수 매긴다(BM25 등). Filter context는 “맞는지”만 보고 점수를 건너뛰며 캐시에 유리하다. 테넌트 ID·범위·플래그는 `filter` / filter context에 둔다.
:::

:::quiz
**Q5.** 집계 세 계열을 말하고, `text` 필드 집계의 운영상 함정을 하나만 들어라.
---
Metric(통계), bucket(그룹), pipeline(agg 위 agg). 분석된 `text` 집계는 비용이 크고 토큰 기준이다. `fielddata`보다 `keyword` multi-field(또는 숫자/날짜)를 쓰는 편이 낫다.
:::

---

## 메모

—
