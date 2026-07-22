---
title: 'Databricks 주요 서비스: 플랫폼 서베이'
---

## 레퍼런스

- [What is Databricks?](https://docs.databricks.com/aws/en/introduction/)
- [The scope of the Databricks platform](https://docs.databricks.com/aws/en/lakehouse-architecture/scope)
- [What is a data lakehouse?](https://docs.databricks.com/aws/en/lakehouse/)
- [What is Unity Catalog?](https://docs.databricks.com/aws/en/data-governance/unity-catalog/)
- [Databricks reference architectures](https://docs.databricks.com/aws/en/lakehouse-architecture/reference)
- [Lakeflow: A new era of agentic data engineering](https://www.databricks.com/blog/lakeflow-new-era-agentic-data-engineering)

---

## 왜 이 글을 찾아봤나

Databricks의 주요 서비스를 논문 형태로 정리해 달라고 요청했다.

---

## 읽으면서 느낀 점

—

---

## 배운 것

### Abstract

Databricks는 스스로를 **Data Intelligence Platform**이라 부른다. 레이크하우스 기반의 열린 스택에서 ETL, 분석/BI, ML/AI를 돌리고, 플랫폼 메타데이터 위에 생성형 AI를 얹는 그림이다. 이 노트는 공식 플랫폼 스코프 문서를 기준으로 주요 서비스를 정리한다 — 스토리지(클라우드 오브젝트 스토리지 위의 Delta Lake), 거버넌스(Unity Catalog), 수집·변환·오케스트레이션(Lakeflow, Auto Loader, Structured Streaming), 웨어하우징(Databricks SQL), ML/AI(MLflow, Model Serving, AI functions), 운영 OLTP(Lakebase), 앱, 조직 간 공유(OpenSharing / Marketplace / Clean Rooms). 요지는 단순하다. 열린 데이터 기반과 단일 거버넌스 평면 위에, 워크로드별 컴퓨트·도구가 올라간다.

### 1. Introduction

엔터프라이즈 데이터 스택은 오래 **데이터 레이크**(저렴하고 유연한 오브젝트 스토리지, 트랜잭션·거버넌스는 약함)와 **데이터 웨어하우스**(SQL/BI는 강하지만 비용·ML·비정형 데이터에는 덜 친화적)로 갈라져 있었다. 파이프라인·카탈로그·접근 정책이 시스템마다 복제되기 쉬운 구조였다.

Databricks의 답은 **레이크하우스**다. 레이크 비용의 스토리지에 웨어하우스급 신뢰성과 거버넌스를 얹고, 엔지니어·분석가·ML 실무자가 같은 단일 소스를 쓰게 한다. 지금 제품 프레이밍은 여기에 **data intelligence engine**을 더한다. 스키마·리니지·비즈니스 시맨틱 같은 레이크하우스 메타데이터를 쓰는 GenAI로, 검색·코딩 보조·자연어 분석이 같은 거버넌스 데이터 위에 앉는다.

이 서베이는 그 프레이밍을 구체 서비스에 대응시킨다. 개별 제품 하우투가 아니라 구조 개요다.

### 2. 플랫폼 프레임: 도메인과 페르소나

공식 문서는 현대 데이터/AI 플랫폼을 여러 **도메인**으로 쌓아 설명한다. 스토리지, 거버넌스, AI 엔진, ingest/transform, 고급 분석·ML·AI, 데이터 웨어하우스, 운영 DB, 자동화, ETL/DS 도구, BI 도구, 데이터/AI 앱, 협업·공유.

**페르소나**는 도메인을 가로지른다. 데이터 엔지니어(신뢰할 수 있는 ETL), 데이터 사이언티스트(모델과 인사이트), ML 엔지니어(프로덕션 서빙), 비즈니스 분석가·사용자(대시보드와 질문), 앱 개발자(보안 데이터 앱), 외부 파트너(공유 데이터 제품).

Databricks는 이 도메인을 한 기반에서 다 커버한다고 본다. 주 컴퓨트는 **Apache Spark / Photon**, 데이터·AI 거버넌스의 중심은 **Unity Catalog**다.

### 3. 스토리지 기반: 클라우드 오브젝트 스토리지와 Delta Lake

레이크하우스 데이터는 고객 클라우드의 오브젝트 스토리지(AWS, Azure, GCP)에 둔다. 레이크하우스 코어용으로 독자적인 온디스크 포맷을 새로 만들지 않는다. 권장 테이블 포맷은 **Delta Lake**(ACID 파일 트랜잭션, 스키마 강제, 업데이트, 트랜잭션 로그 기반 time travel). **Apache Iceberg** 클라이언트와도 맞출 수 있고, 지원 범위 안에서는 Unity Catalog managed 테이블이 Delta·Iceberg 모두에 권장된다.

| 속성 | 레이크하우스에서의 역할 |
|------|-------------------------|
| 클라우드 오브젝트 스토리지 | 확장·내구성 있는 물리 저장소 |
| Delta Lake | 신뢰성 계층: 트랜잭션, 일관성, 스키마, 버전 |
| 열린 포맷 | 벤더 락인 완화. 외부 엔진이 open API / credential vending으로 읽기 가능 |

구조화·반구조화·비구조화 파일이 먼저 도착하고, Delta(또는 Iceberg) 테이블로 바꿀 때 스키마 검사와 거버넌스 등록이 본격적으로 시작되는 경우가 많다.

### 4. 거버넌스: Unity Catalog

**Unity Catalog**는 데이터와 AI를 한데 묶는 통합 거버넌스 계층이다. 워크스페이스에 켜지면 쿼리와 모델 호출 아래에 붙는다 — 접근 제어, 리니지, 디스커버리, 감사 로그. 2023-11-08 이후 생성된 워크스페이스는 기본으로 켜지고, 이전 워크스페이스는 업그레이드할 수 있다. 오픈소스 Unity Catalog 구현도 있다.

**객체 모델.** 거버넌스 대상은 securable object다. 테이블·뷰·볼륨·함수·모델·모델/MCP 서비스 같은 데이터·AI 자산은 3단 네임스페이스 `catalog.schema.object`를 쓴다. 테이블·볼륨은 **managed**(스토리지 생명주기까지 UC가 관리)이거나 **external**(거버넌스만)일 수 있다. 자격 증명, external location, connection, share는 metastore 아래에 둔다.

**역량 요약.**

| 역량 | 제공 내용 |
|------|-----------|
| 접근 제어 | 권한, ABAC, row/column 필터, workspace binding |
| 디스커버리 | Catalog Explorer 및 관련 UI/API |
| 리니지 | 소스부터 모델·서비스·대시보드까지 자동 추적 |
| 감사 | 데이터 접근·활동의 시스템 테이블 감사 로그 |
| 분류·품질 | 태깅/분류, 프로파일링·품질 모니터링 |
| Federation | Lakehouse Federation으로 외부 SQL 소스를 UC 거버넌스 아래로 |
| 공유·AI 거버넌스 | OpenSharing, 생성형 모델 트래픽용 AI Gateway |

Unity Catalog는 ETL·SQL·ML이 카탈로그를 따로 두지 않고 한 정책·메타데이터 평면을 쓰게 하는 척추다.

### 5. 수집·변환·오케스트레이션: Lakeflow와 스트리밍

**Lakeflow**는 데이터 엔지니어링 통합 표면이다. Connect(수집), pipelines(선언형 변환), Jobs(오케스트레이션).

- **Lakeflow Connect** — 엔터프라이즈 앱·DB에서 Unity Catalog가 거버넌스하는 Delta 테이블로 수집. 보통 serverless 컴퓨트와 Lakeflow pipelines를 탄다.
- **Auto Loader** — 클라우드 스토리지에 떨어지는 파일을, 상태를 직접 관리하지 않고 증분·멱등 적재.
- **Lakeflow pipelines** — 데이터셋 의존성·스케일링·데이터 품질 **expectations**를 갖춘 선언형 ETL.
- **Lakeflow Jobs** — 노트북, SQL, Spark, dbt, ML, 파이프라인을 클라우드 전반에서 스케줄·오케스트레이션.
- **Structured Streaming** — Delta와 밀착된 Spark 스트리밍. 증분 파이프라인과 Auto Loader 패턴의 기반.

배치와 스트리밍이 같은 거버넌스 테이블로 들어가고, BI와 ML이 그걸 소비한다.

### 6. 데이터 웨어하우스와 BI: Databricks SQL

**Databricks SQL**은 레이크하우스 위의 웨어하우스/BI 제품이다. SQL warehouse(서버리스 포함), SQL 에디터, 외부 BI 도구 연동. 세분 접근 제어는 Unity Catalog가 맡는다.

SQL 위에는 다음이 얹힌다.

- **Unity Catalog semantics / metric views** — KPI를 한 번 정의하고 차원 전반에서 조회. 사람과 AI 도구가 공유하는 시맨틱 레이어.
- **AI/BI Dashboards** — AI 보조 대시보드 작성과 시각화.
- **Genie Agents** — 데이터셋·샘플 쿼리·도메인 언어로 설정한 자연어 탐색.
- **AI Functions** — SQL 안에서 LLM·AI로 데이터를 보강.

여기 웨어하우징은 별도 독자 스토리지 사일로가 아니다. 같은 Delta/UC 테이블 위의 SQL 컴퓨트와 UX다.

### 7. ML, AI, Mosaic AI 표면

Databricks ML은 Spark 런타임, **MLflow**(실험 추적·모델 라이프사이클), Feature Store·Model Registry(Unity Catalog 통합), AutoML, LLM 커스터마이징용 Hugging Face Transformers 같은 라이브러리 위에 쌓인다.

서빙·생성형 AI 제품 표면은 흔히 **Mosaic AI**로 묶인다.

- **Model Serving** — Databricks 컨트롤 플레인의 확장 가능한 실시간 엔드포인트(호스팅 모델용 Foundation Model APIs 포함).
- **AI Gateway** — 생성형 모델과 서빙 엔드포인트 접근을 거버넌스·모니터링.
- 거버넌스된 데이터 위 프로덕션 AI 앱용 에이전트/프레임워크 도구.

SQL과 같은 논리다. 모델과 피처는 Unity Catalog의 일급 자산이지, 평행한 그림자 레지스트리가 아니다.

### 8. 운영 데이터베이스: Lakebase

**Lakebase**는 Data Intelligence Platform에 통합된 관리형 **Postgres** OLTP다. 분석용 레이크하우스 옆에 트랜잭션 워크로드를 두고, OLTP↔OLAP 동기화와 Feature management·SQL warehouse·Databricks Apps 연동을 제공한다. “온라인” 서빙 스토어가 레이크하우스 거버넌스 이야기 밖에 남아 있던 빈틈을 메운다.

### 9. 앱, 협업, 공유

| 서비스 | 역할 |
|--------|------|
| **Databricks Apps** | UC 아래 플랫폼 데이터로 보안 데이터/AI 앱을 만들고 호스팅 |
| **OpenSharing** | 조직·컴퓨트 플랫폼을 가로지르는 안전한 라이브 공유용 오픈 프로토콜(UC로 관리) |
| **Databricks Marketplace** | OpenSharing 기반 데이터 제품 탐색·교환 포럼 |
| **Clean Rooms** | OpenSharing + serverless로, 상대 데이터에 직접 접근하지 않고 민감 데이터를 다자 분석 |

내부 공유는 테이블·뷰 권한 부여만으로도 되고, 외부 공유는 파일 떨구기 대신 오픈 공유 스택을 쓴다.

### 10. 컨트롤 플레인 vs 데이터 플레인 (짧게)

Databricks는 **컨트롤 플레인**(워크스페이스 UI, Job 스케줄링, Model Serving 제어, 거버넌스 서비스)을 관리하고, **데이터**는 보통 고객 클라우드 계정의 스토리지와 고객 스코프 컴퓨트에 남긴다. 보안 리뷰에서 중요한 구분이다. 정책·메타데이터는 중앙화되고, 바이트는 이미 신뢰하는 클라우드에 남는다.

### 11. 종합: 주요 서비스가 맞물리는 방식

```
Collaboration / Apps     Apps · OpenSharing · Marketplace · Clean Rooms
BI / SQL                 Databricks SQL · Dashboards · Genie · AI Functions
ML / AI                  MLflow · Model Serving · AI Gateway · Feature/Model in UC
Orchestration            Lakeflow Jobs · CI/CD · Git folders
Ingest / Transform       Connect · Auto Loader · Pipelines · Structured Streaming
Governance               Unity Catalog (+ Federation, quality, lineage)
Storage                  Delta Lake / Iceberg on cloud object storage
OLTP (adjacent)          Lakebase (Postgres)
```

**논지 재진술.** Delta Lake는 레이크를 신뢰 가능하게 만들고, Unity Catalog는 데이터와 AI를 거버넌스 가능하게 만들며, Lakeflow는 데이터를 넣고 흘려보내고, Databricks SQL과 Mosaic AI가 소비한다. Lakebase와 Apps는 OLTP·제품 표면으로 확장하고, OpenSharing은 조직 경계를 넘긴다. 페르소나마다 데이터셋을 다시 복사할 필요는 없다.

### 12. Conclusion

Databricks를 “Spark 노트북 플랫폼”으로만 보면 제품이 과소평가된다. 주요 서비스는 계층형 플랫폼이다 — 열린 스토리지 포맷, 통합 거버넌스, 선언형·스트리밍 데이터 엔지니어링, SQL 웨어하우징, ML/AI 라이프사이클과 서빙, OLTP 인접, 조직 간 협업. 더 깊게 들어가려면 Unity Catalog 권한 모델, Lakeflow 파이프라인 동작, Databricks SQL/Photon, Mosaic AI 서빙·게이트웨이가 자연스러운 다음 절단선이다.

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 레이크하우스 패턴이 레이크와 웨어하우스를 따로 둘 때 생기는 문제에 대해 무엇을 해결한다고 주장하는가?
---
레이크 비용의 열린 오브젝트 스토리지에 웨어하우스급 신뢰성(트랜잭션, 스키마, 성능)과 단일 거버넌스 소스를 결합해, ETL·BI·ML이 각각 복사본과 카탈로그를 두지 않게 하려는 것이다.
:::

:::quiz
**Q2.** Unity Catalog의 3단 네임스페이스는 managed 테이블과 external 테이블과 어떻게 연결되는가?
---
데이터/AI 자산은 `catalog.schema.object` 아래에 있다. **Managed** 테이블/볼륨은 접근과 스토리지 생명주기까지 UC가 관리한다. **External**은 접근 거버넌스만 하고, 스토리지는 지정한 위치에 남는다.
:::

:::quiz
**Q3.** Lakeflow의 세 기둥과, 클라우드 파일과 자주 쓰는 인접 수집 도구 하나를 말하라.
---
**Connect**(엔터프라이즈 커넥터), **pipelines**(선언형 ETL), **Jobs**(오케스트레이션). **Auto Loader**는 클라우드 스토리지 파일을 레이크하우스로 증분 적재한다.
:::

:::quiz
**Q4.** Databricks SQL과 Mosaic AI Model Serving이 Unity Catalog에 공통으로 의존하는 방식은?
---
SQL warehouse는 UC가 거버넌스하는 테이블을 세분 ACL로 조회하고, 모델·피처·엔드포인트도 UC 자산이다. AI Gateway는 생성형 모델 트래픽까지 정책을 확장한다. 분석과 AI가 한 거버넌스 평면을 쓴다.
:::

:::quiz
**Q5.** Lakebase는 무엇이고, 플랫폼에 OLTP 제품이 있는 이유는?
---
Lakebase는 Databricks의 관리형 Postgres OLTP다. 트랜잭션 앱을 분석용 레이크하우스 옆에 두고 Feature·SQL·Apps와 연동·동기화해, 온라인 스토어를 플랫폼 밖에만 두지 않기 위함이다.
:::

---

## 메모

—
