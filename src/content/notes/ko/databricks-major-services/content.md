---
title: 'Databricks 주요 서비스: 플랫폼 서베이'
---

## 레퍼런스

- [What is Databricks?](https://docs.databricks.com/aws/en/introduction/)
- [The scope of the Databricks platform](https://docs.databricks.com/aws/en/lakehouse-architecture/scope)
- [Databricks reference architectures](https://docs.databricks.com/aws/en/lakehouse-architecture/reference)
- [What is a data lakehouse?](https://docs.databricks.com/aws/en/lakehouse/)
- [What is Delta Lake in Databricks?](https://docs.databricks.com/aws/en/delta/)
- [What is Unity Catalog?](https://docs.databricks.com/aws/en/data-governance/unity-catalog/)
- [Connect to serverless compute](https://docs.databricks.com/aws/en/compute/serverless/)
- [Compute selection recommendations](https://docs.databricks.com/aws/en/compute/choose-compute)
- [SQL warehouse types](https://docs.databricks.com/aws/en/compute/sql-warehouse/warehouse-types)
- [Migrate from classic compute to serverless](https://docs.databricks.com/aws/en/compute/serverless/migration)
- [Lakeflow: A new era of agentic data engineering](https://www.databricks.com/blog/lakeflow-new-era-agentic-data-engineering)

---

## 왜 이 글을 찾아봤나

Databricks 주요 서비스를 논문 형태로 정리해 달라고 했고, 이후 시니어 엔지니어 깊이와 배포까지 요청했다.

---

## 읽으면서 느낀 점

—

---

## 배운 것

### Abstract

Databricks는 “관리형 Spark”가 아니라 **계층형 컨트롤/데이터 시스템**으로 보는 편이 맞다. Data Intelligence Platform은 (1) 고객 오브젝트 스토리지 위의 열린 테이블 포맷, (2) 워크스페이스를 가로지르는 데이터·AI 컨트롤 플레인으로서 Unity Catalog, (3) 여러 컴퓨트 플레인(고객 VPC의 classic 클러스터, Databricks 관리 serverless, SQL warehouse, Model Serving), (4) 페르소나별 제품(Lakeflow, Databricks SQL, Mosaic AI, Lakebase, Apps, OpenSharing)을 쌓는다. 이 노트는 시니어 관점의 지도다. 각 서비스가 무엇을 소유하는지, 바이트와 IAM이 어디에 있는지, 설계 리뷰에서 어떤 트레이드오프가 나오는지.

### 1. Introduction — “통합 플랫폼”이 실제로 의미하는 것

레이크하우스 피치는 익숙하다. **오브젝트 스토리지 경제성**을 유지하면서 웨어하우스 속성(ACID, 스키마, 빠른 SQL)을 되찾고, 같은 테이블에서 ML도 서빙한다. Databricks의 더 센 주장은 **데이터와 AI 자산(테이블, 볼륨, 피처, 모델, 서빙 엔드포인트)을 한 거버넌스 평면**에 두고, 그 메타데이터를 읽는 GenAI(Genie, 코딩 보조, 시맨틱/메트릭 레이어)를 얹는다는 점이다.

시니어에게 쓸모 있는 질문은 운영형이다.

| 질문 | 왜 중요한가 |
|------|-------------|
| 컴퓨트는 어디서 도나? | Classic = 고객 클라우드 계정. serverless SQL/노트북/잡 = Databricks 관리 플레인. Model Serving 컨트롤은 Databricks 호스팅 |
| 권한의 SSOT는? | Unity Catalog metastore vs 레거시 Hive metastore / IAM instance profile |
| 테이블 계약은? | Delta(기본) vs Iceberg. managed vs external. UniForm / open API로 외부 엔진 |
| 데이터는 어떻게 움직이나? | Connect / Auto Loader / Structured Streaming / Federation(푸시다운, 복사 없음) |
| 비용·접근은 어떻게 보나? | `system.*` 테이블(과금, 감사) vs 클러스터 메트릭만 |

### 2. 컨트롤 플레인, classic 데이터 플레인, serverless 플레인

Databricks를 세 플레인이 맞물린 시스템으로 본다.

```
┌─────────────────────────────────────────────────────────┐
│ Control plane (Databricks account / region)             │
│  Workspace UI, Jobs API, UC metastore services,         │
│  Model Serving control, Notebooks metadata, …           │
└───────────────────────────┬─────────────────────────────┘
                            │ schedules / auth / policies
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌──────────────────────┐              ┌──────────────────────┐
│ Classic data plane   │              │ Serverless plane     │
│ (customer cloud acct)│              │ (Databricks-managed) │
│ Clusters, classic    │              │ Serverless notebooks │
│ SQL warehouse VMs,   │              │ / jobs / pipelines,  │
│ customer VPC/peering │              │ serverless SQL WH,   │
│ IAM roles / profiles │              │ NCC / Private Link   │
└──────────┬───────────┘              └──────────┬───────────┘
           │                                     │
           └──────────────┬──────────────────────┘
                          ▼
              Customer object storage (S3/ADLS/GCS)
              Delta / Iceberg tables + UC volumes
```

**리뷰에서 나오는 함의**

- **데이터 레지던시 / 블라스트 라디우스:** 테이블 바이트는 고객 버킷에 남고, metastore·서빙 컨트롤은 Databricks 쪽이다. 감사 로그와 system 테이블이 어디에 있고 누가 조회하는지 물어야 한다.
- **네트워킹 마이그레이션:** classic 패턴(VPC peering, instance profile, `dbfs:/`)은 serverless로 그대로 안 넘어간다. 공식 경로는 Unity Catalog + external location, NCC / Private Link, DBFS 대신 volumes, 커스텀 JDBC JAR 대신 Lakehouse Federation.
- **Serverless는 versionless:** 런타임이 자동으로 굴러간다. 패치 속도엔 이득이고, DBR 고정·커스텀 라이브러리·RDD·R이 필요하면 제약이다.

### 3. 스토리지 계약 — Delta Lake (그리고 Iceberg)

**Delta Lake**는 Parquet + **파일 기반 트랜잭션 로그**(오픈 프로토콜)다. Databricks에서 기본 테이블 포맷이다. 시니어가 실제로 쓰는 보장:

| 메커니즘 | 엔지니어링 용도 |
|----------|-----------------|
| 트랜잭션 로그 ACID | 동시 writer/reader가 디렉터리를 깨지 않음. `_delta_log`를 손으로 건드리지 말 것 |
| write 시 스키마 강제 | 나쁜 배치를 ingest에서 거절. Lakeflow expectations와 짝 |
| schema evolution / column mapping | 전체 rewrite 없이 진화. rename/drop도 파일 rewrite 없이 |
| time travel / `DESCRIBE HISTORY` | 장애 롤백, 누가 어떤 버전을 썼는지 |
| Change Data Feed (CDF) | 전체 테이블 재스캔 없이 다운스트림 증분 |
| liquid clustering / data skipping / OPTIMIZE | 변하는 쿼리 패턴엔 brittle partition보다 liquid clustering. small file compact. VACUUM으로 보관·비용 |
| MERGE / selective overwrite | CDC upsert, 파티션 범위 rewrite |

**Medallion**은 여전히 기본 정제 패턴이다(bronze → silver → gold를 연속 Delta 테이블로). Lakeflow pipelines가 의존성을 잡아 두면, gold가 낡은 silver 위에서 조용히 도는 일을 줄인다.

**Iceberg / 개방성.** Managed 테이블은 Delta 또는 Iceberg를 목표로 할 수 있다. UniForm / open API / credential vending으로 외부 엔진(Spark, Trino, DuckDB, Iceberg REST)이 UC 정책 아래에서 읽는다. 설계 리뷰에서는 “open”이 *포맷*만인지 *멀티 엔진 write 경로*인지 분명히 해야 한다. SLA가 다르다.

**Managed vs external (결정 표)**

| | Managed | External |
|--|---------|----------|
| 스토리지 생명주기 | UC가 위치·정리 소유 | 경로는 당신 소유. UC는 거버넌스만 |
| 기본 권장 | 새 레이크 | 레거시 레이크, 공유 버킷, 파트너 소유 경로 |
| 실패 모드 | 실수 `DROP`이 UC 관리 데이터를 지울 수 있음 | UC 메타만 지우고 오브젝트가 남는 orphan |

### 4. Unity Catalog — 실제 플랫폼 척추

UC는 “예쁜 Hive metastore”가 아니다. serverless와 최신 제품이 전제로 삼는 **인가·디스커버리·리니지·AI 자산 레지스트리**다.

**객체 모델.** 테이블·뷰·볼륨·함수·모델·모델/MCP 서비스는 `catalog.schema.object` 3단 네임스페이스. metastore급 객체는 storage credential, external location, connection, share. **2023-11-08** 이후 워크스페이스는 UC가 기본이다.

**프로덕션 설계에 바로 걸리는 역량**

- 권한 + ABAC, row/column 필터, **workspace binding**(어느 워크스페이스가 어느 카탈로그를 보는지 격리)
- 모델·대시보드·서비스까지 runtime lineage
- 감사 + 품질 모니터링(이상·프로파일)
- **Lakehouse Federation:** 외부 SQL 엔진(Postgres, MySQL, Redshift 등)을 UC에 매핑. 쿼리 푸시다운 — 강제 ETL 복사 없음
- **Catalog Federation:** Hive Metastore / Glue 카탈로그를 물리 이관 전에 UC 정책 아래로
- OpenSharing + AI Gateway(아웃바운드 데이터·생성형 트래픽)

**시니어 경험 법칙:** 설계가 아직 Hive metastore 테이블, instance profile 경로, 내구성 있는 `dbfs:/`에 기대면 **classic** 경로다. serverless·predictive optimization·일부 AI 기능이 막히거나 꼬인다. Federation은 다리이지, hot path의 소유권 모델을 영원히 대신하진 않는다.

### 5. 컴퓨트 선택 — 일이 실제로 도는 곳

Photon은 SQL warehouse(와 많은 DataFrame/SQL 경로) 아래의 **벡터화** 엔진이다. 운영에서는 “Photon 있나”보다 warehouse 타입이 더 중요하다.

| 컴퓨트 | 실행 위치 | 쓸 때 | 피할 때 |
|--------|-----------|-------|---------|
| **Serverless compute** (노트북/잡/Lakeflow) | Databricks serverless 플레인 | 자동 ETL 기본. 빠른 기동. UC 거버넌스 | RDD/R, 이국적 라이브러리, DBR 고정, 미지원 소스 |
| **Classic jobs / all-purpose** | 고객 계정 | 커스텀 Spark conf, GPU, 레거시 HMS, 라이브러리 통제 | 스케줄 잡에 idle all-purpose 비용 |
| **Serverless SQL warehouse** | Databricks | BI/인터랙티브 SQL. 수 초 기동. IWM / Predictive IO | 레거시 외부 HMS. 일부 커스텀 네트워킹 |
| **Pro SQL warehouse** | 보통 고객 계정 | serverless 불가. federation/하이브리드 네트워킹 | 클러스터 운영을 없애고 싶을 때 |
| **Classic SQL warehouse** | 고객 계정 | 레거시/엔트리급만 | 새 BI — serverless/pro 권장 |
| **Model Serving** | Databricks 컨트롤 플레인 엔드포인트 | 저지연 추론, Foundation Model APIs | 학습 클러스터처럼 쓸 때 |

Serverless 노트북/잡/파이프라인은 **UC 활성** 워크스페이스가 필요하다. Predictive optimization과 data quality monitoring도 손으로 serverless job을 안 띄워도 serverless 인프라로 과금된다. `system.billing.usage`로 보고, 최대 ~24시간 지연을 감수한다.

### 6. 수집·변환·오케스트레이션 — Lakeflow와 스트리밍

**Lakeflow**는 예전에 Auto Loader + DLT + Jobs로 짜 맞추던 세 면을 묶는다.

1. **Connect** — SaaS/DB → UC Delta(serverless + pipelines). 증분 read/write 지향.
2. **Pipelines** (선언형) — 데이터셋 그래프, expectations(품질 게이트), streaming table / materialized view, 인프라 스케일.
3. **Jobs** — 노트북·SQL·Spark·dbt·ML·파이프라인 멀티태스크. Declarative Automation Bundles / Git folders로 CI/CD.

**CDC / 파일 경로 선택**

| 패턴 | 전형 경로 |
|------|-----------|
| 클라우드 스토리지에 파일 착륙 | Auto Loader → bronze Delta (`COPY INTO`는 단순 SQL 증분) |
| SaaS / DB 커넥터 | Lakeflow Connect |
| 이벤트 버스(Kafka/Kinesis) | Structured Streaming → Delta → medallion |
| CDC → 큐 → 스트림 | 큐 → Structured Streaming |
| CDC를 파일로 dump | Auto Loader(배치형 CDC) |
| 복사 없이 조회 | Lakehouse Federation(소스 부하·푸시다운 한계 감수) |

멱등·exactly-once *의미론*은 여전히 Delta 커밋 + 잘 짠 MERGE/CDF에 달려 있다. 플랫폼이 없애는 건 배관이지 데이터 계약 설계가 아니다.

### 7. Databricks SQL, 시맨틱, BI

Databricks SQL은 독자 웨어하우스 스토어가 아니라 **같은 UC 테이블 위의 SQL 컴퓨트 + UX**다. 분석가는 serverless/pro warehouse를 치고, 외부 BI(Tableau, QuickSight 등)도 같은 엔진에 붙는다.

위층 제품:

- **Metric views / UC semantics** — KPI를 한 번 정의. 대시보드마다 다른 SQL 방언을 줄임
- **AI/BI Dashboards** — 거버넌스된 메트릭 위 AI 보조 작성
- **Genie** — 큐레이션된 데이터셋·샘플·용어집 위 NL→SQL. 품질은 에이전트 코퍼스를 얼마나 좁혔는지에 비례
- **AI Functions** — SQL 파이프라인 안 LLM 호출(비용·지연·PII 리뷰 필수)

Credential passthrough가 warehouse 이야기가 아니다. UC다.

### 8. Mosaic AI / ML 라이프사이클

전통 ML: ML 런타임, AutoML, **MLflow**, Feature Store + Model Registry(**UC 안**), 학습 오케스트레이션용 Jobs, 온라인 추론용 Model Serving.

GenAI 추가: 서빙의 Foundation Model APIs, UC 데이터 위 RAG/에이전트 앱, 생성형 엔드포인트 정책·모니터링용 **AI Gateway**. OpenAI·LangGraph·Hugging Face 같은 외부 프레임워크도 플랫폼에서 호출할 수 있다. 거버넌스는 노트북에 개인 키를 풀어 두는 대신 UC + Gateway를 원한다.

**리뷰 체크:** 피처 테이블과 모델 버전은 UC securable이다. 서빙 엔드포인트는 레이크하우스 권한 모델 “밖”이 아니다. 온라인 피처 경로(Lakebase / feature serving)는 배치 학습 읽기와 따로 평가한다.

### 9. Lakebase, Apps, 공유

| 서비스 | 시니어 한 줄 |
|--------|--------------|
| **Lakebase** (관리형 Postgres OLTP) | 트랜잭션 상태를 레이크하우스 옆에 두고 Feature/SQL/Apps와 동기화. “거버넌스 밖 Redis/RDS” 기본값을 줄이지만, OLTP write와 레이크 freshness 일관성은 여전히 설계 대상 |
| **Databricks Apps** | 플랫폼 신원·데이터 위 serverless 호스팅 앱. 진짜 OLTP가 필요하면 Lakebase |
| **OpenSharing** | 오브젝트 스토어 데이터의 라이브·거버넌스 공유. Marketplace·Clean Rooms의 기반 |
| **Clean Rooms** | 서로 raw에 직접 접근하지 않는 다자 컴퓨트 |

내부 공유 = GRANT. 외부 공유 = OpenSharing 계약(수신자, 회전, 회수). S3 pre-signed URL 민속이 아니다.

### 10. 관측성과 FinOps 훅

- **System tables** — 감사·과금·리니지용 계정 운영 스토어
- **Data quality monitoring** — 프로파일/이상(serverless 기반)
- **Billable usage** — job/warehouse에 DBU 귀속. 차지백은 UI만 믿지 말 것

### 11. 종합 다이어그램

```
Sharing / Apps     OpenSharing · Marketplace · Clean Rooms · Apps
Serve              SQL WH · Model Serving · Lakebase · AI Gateway
Query / Process    Spark · Photon · ML runtimes · MLflow
Transform          Lakeflow pipelines · Structured Streaming
Ingest             Connect · Auto Loader · partner/batch · CDC streams
Govern             Unity Catalog (+ Federation, quality, lineage, audit)
Store              Delta / Iceberg on customer object storage
Planes             Control · Classic data · Serverless
```

**설계 논지.** 먼저 **스토리지 계약**(managed Delta + medallion)과 **거버넌스 계약**(UC metastore, external location, 내구성 DBFS 금지)을 고른다. 그다음 워크로드 클래스별로 **컴퓨트 플레인**을 고른다. SQL·Mosaic·Lakebase·Apps는 그 계약의 소비자이지, 평행 플랫폼이 아니다.

### 12. Conclusion

시니어가 읽는 Databricks는 이렇다. 고객 스토리지 위 열린 테이블, 데이터와 AI를 가로지르는 UC 컨트롤 플레인, 네트워킹·IAM 가정이 다른 여러 컴퓨트 플레인, 그 위 Lakeflow/SQL/Mosaic/Lakebase라는 워크로드 UI. 실패 모드는 노트북 + classic 클러스터 + Hive metastore를 “Databricks”로 붙잡고, 플랫폼 나머지는 이미 UC + serverless로 옮겨 간 상태다. 다음 절단선은 UC 권한·격리 모델, Lakeflow 파이프라인 실행 의미론, Photon/SQL warehouse 사이징, Model Serving + AI Gateway.

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** “serverless vs classic”이 비용 슬라이더가 아니라 네트워킹/IAM 결정인 이유는?
---
Classic은 고객 클라우드 계정(VPC, instance profile, peering)에서 돈다. Serverless는 Databricks 관리 플레인이고 UC external location, NCC/Private Link, volumes를 기대한다. 레거시 `dbfs:/`, HMS, instance profile 경로는 깨지거나 미지원인 경우가 많다.
:::

:::quiz
**Q2.** 프로덕션에서 Delta 트랜잭션 로그가 “S3의 Parquet”만으로는 못 주는 것은?
---
ACID 커밋, 디렉터리 오염 없는 동시 read/write, write 시 스키마 강제, time travel/history, CDF 기반 증분 다운스트림. 오브젝트 리스팅이 우연히 맞길 바라지 않고 오픈 로그 프로토콜로 한다.
:::

:::quiz
**Q3.** Lakeflow Connect / Auto Loader 대신 Lakehouse Federation을 고르는 때는?
---
외부 SQL 시스템을 **복사 없이** 거버넌스된 조회(푸시다운)로 붙일 때. 레이크에 medallion 테이블이 필요하고, 소스와 SLA를 끊거나 Delta 위 변환·히스토리가 크면 Connect/Auto Loader다.
:::

:::quiz
**Q4.** 멀티 워크스페이스 엔터프라이즈에서 특히 중요한 Unity Catalog 기능 둘은?
---
워크스페이스를 가로지르는 계정 스코프 정책, 카탈로그 가시성을 격리하는 **workspace binding**, 공유 lineage/audit. (metastore급 credential/location/share도.)
:::

:::quiz
**Q5.** 아무도 “serverless job”을 안 눌렀는데 과금에 serverless job SKU가 보일 수 있는 이유는?
---
Data quality monitoring·predictive optimization 같은 기능이 serverless 인프라에서 돌고 serverless job 사용량으로 청구된다. 손으로 띄운 잡만 보지 말고 `system.billing.usage`를 본다.
:::

---

## 메모

—
