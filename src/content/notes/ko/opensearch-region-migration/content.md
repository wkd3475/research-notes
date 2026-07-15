---
title: 'Amazon OpenSearch Service — 리전 마이그레이션 옵션'
---

## 레퍼런스

- [Cross-cluster replication for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/replication.html)
- [Creating index snapshots in Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshots.html)
- [Registering a manual snapshot repository](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshot-registerdirectory.html)
- [Migrating indexes using remote reindex](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/remote-reindex.html)
- [Tutorial: Migrating to Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/migration.html)
- [Snapshot + restore DR (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/achieve-data-resilience-using-amazon-opensearch-service-disaster-recovery-with-snapshot-and-restore/)
- [Manual snapshots across Regions and accounts (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/take-manual-snapshots-and-restore-in-a-different-domain-spanning-across-various-regions-and-accounts-in-amazon-opensearch-service/)
- [CCR with OpenSearch Service (AWS Big Data Blog)](https://aws.amazon.com/blogs/big-data/ensure-availability-of-your-data-using-cross-cluster-replication-with-amazon-opensearch-service/)
- [AWS Prescriptive Guidance — OpenSearch migration cutover](https://docs.aws.amazon.com/prescriptive-guidance/latest/opensearch-service-migration/stage-5-cutover.html)
- [Making configuration changes (blue/green within a domain)](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-configuration-changes.html)

---

## 왜 이 글을 찾아봤나

Amazon OpenSearch Service 도메인을 **다른 AWS 리전으로 옮기는 방법**을 자세히 보고 싶었다. 옵션별 트레이드오프(RPO/RTO/비용)와 cutover까지 정리한 뒤 경로를 고르려고.

---

## 읽으면서 느낀 점

그 이상으로 따로 느낀 점은 없다. 리전 이동 패턴을 정리하고, 각각이 어디서 깨지는지만 보면 된다.

---

## 배운 것

*OpenSearch Service에는 Aurora Global Database 같은 “글로벌 writer switchover”가 없다. 리전 이동은 **대상 리전에 새 도메인**을 두고, 데이터 동기화 + 클라이언트 cutover를 직접 짜는 일이다.*

---

### Act 1 — 네 가지 패턴 (계획된 마이그레이션)

:::chat student AI 학생
리전 A에서 B로 OpenSearch 도메인을 옮길 때 선택지가 뭐예요?
:::

:::chat teacher 선생님
AWS 문서·마이그레이션 가이드에 자주 나오는 실무 패턴은 네 가지다. 도메인 **blue/green**은 **한 도메인 안 설정 변경**용이지, **크로스 리전 이동**이 아니다.

| 패턴 | 동기화 | 대략적인 RPO | 대략적인 RTO / 다운타임 | 비용 형태 |
|------|--------|--------------|-------------------------|-----------|
| **1. Snapshot → S3 → restore** | 시점 백업 | 스냅샷 간격(분~시간) | restore 시간(대형 클러스터면 종종 수 시간) + 도메인 생성 | 상시 대기 도메인 없이 가장 저렴 |
| **2. Cross-cluster replication (CCR)** | follower가 leader를 pull (거의 연속) | 보통 **1분 미만** lag | replication **`_stop`** 후 follower를 쓰기 가능하게 · cutover는 짧음 | **도메인 2개** + 크로스 리전 데이터 전송 |
| **3. Remote reindex** | 문서 HTTP 일회(또는 반복) 복사 | 마지막 reindex 종료 시점 | reindex 시간 + delta 따라잡기 | 복사 중 source·target 둘 다 켜 둠 · 네트워크 부하 |
| **4. Dual-ingest / 소스에서 재구축** | 파이프라인이 양쪽 기록(또는 CDC/로그로 재구축) | dual-write가 맞으면 거의 0 | 앱/파이프라인 flip | OpenSearch가 **파생 데이터**면 자주 가장 싸게 끝남 |

**도메인이 원본인지**, **다운타임·lag를 얼마나 허용하는지**로 고른다.
:::

:::chat student AI 학생
클러스터를 통째로 복사하는 것보다 dual-ingest가 나을 때는 언제예요?
:::

:::chat teacher 선생님
OpenSearch가 **다른 시스템의 투영**일 때다. 앱 로그, 큐 이벤트, DB에서 만든 검색 인덱스처럼 원본이 위에 있으면 말이다. 이런 워크로드에서 AWS cutover 가이드도 자주 이렇게 간다. target을 소스에서 다시 채우거나 dual-write로 맞춘 뒤 검증하고, **ingestion·클라이언트를 새 도메인으로 돌린다**. retention이 짧고 다시 만들 수 있다면 테라바이트급 로그 이력을 옮길 이유가 없다.
:::

---

### Act 2 — Snapshot / restore (싸고 느리다)

:::chat student AI 학생
스냅샷으로 리전 마이그레이션하는 흐름을 알려 주세요.
:::

:::chat teacher 선생님
큰 흐름은 DR·멀티 리전 스냅샷 블로그와 같다.

1. source 도메인에 **manual snapshot repository**를 만들고 → S3 버킷에 연결한다(보통 source와 **같은 리전**).
2. **manual snapshot**을 찍는다 (`PUT _snapshot/repo/name`). 자동 시간 단위 스냅샷은 있지만, **도메인 복구**용에 가깝고 마이그레이션처럼 마음껏 다루기는 어렵다.
3. 스냅샷 바이트를 **대상 리전**으로 가져온다.
   - **운영에서 많이 쓰는 방식:** S3 **Cross-Region Replication(CRR)**(또는 copy)로 대상 리전 버킷에 넣거나,
   - 대상 도메인에서 source 버킷을 등록할 때 `"endpoint": "s3.amazonaws.com"`을 쓴다(버킷이 다른 리전일 때 [register repository](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-snapshot-registerdirectory.html) 문서의 마이그레이션 안내).
4. 리전 B에 **새 도메인**을 만든다(IaC: FGAC, 암호화, 인스턴스 타입, 커스텀 패키지…).
5. target에 스냅샷 repo를 등록한다(source repo를 덮어쓰면 안 되면 `readonly: true`).
6. `POST _snapshot/repo/snap/_restore` — 보통 `-.kibana*`, `-.opendistro*`를 빼고 `include_global_state: false`.
7. `_cat/recovery`로 샤드 복구를 보고, 검색·쿼리 패리티를 확인한 뒤 **클라이언트를 cutover**(Route 53 / 설정 / 시크릿)하고 ingest도 돌린다.

| 함정 | 내용 |
|------|------|
| 스냅샷 ≠ 완벽한 순간 복사 | 스냅샷 찍는 동안 들어간 문서는 **대체로 빠진다** |
| 버전 호환 | 스냅샷은 **앞 버전으로만**, 대략 **메이저 하나**까지. 마이너도 따진다 |
| 보안 인덱스 | security / Dashboards 시스템 인덱스를 도메인 간에 무작정 restore하지 말 것 |
| 멀티 계정 | 스냅샷 IAM 롤, `manage_snapshots` 매핑, 대상 버킷 정책이 더 필요하다 |
| 커스텀 패키지 / 분석기 | restore **전에** target에 있어야 인덱스 설정이 실패하지 않는다 |

상시 DR 변형: Lambda/SM으로 secondary 리전 버킷에 manual 스냅샷을 주기적으로 쌓아 두고, 장애 때 **도메인 생성 + restore**. 이건 액티브-패시브 백업이지 라이브 동기화가 아니다.
:::

:::chat student AI 학생
다른 리전 S3에서 바로 restore해도 되나요?
:::

:::chat teacher 선생님
**설정만 맞으면 된다.** AWS 문서는 다른 리전 버킷이면 `"region"` 대신 `"endpoint": "s3.amazonaws.com"`을 쓰라고 한다. 그래도 runbook 상으로는 **S3 CRR로 같은 리전 버킷**을 두는 편이 IAM·지연·권한이 단순하다. “버킷은 도메인과 같은 리전”이라는 블로그 말은 주로 **스냅샷을 찍을 때** 로컬 버킷을 쓰라는 뜻이고, **restore 마이그레이션** 문서는 크로스 리전 등록 경로를 따로 적는다.
:::

---

### Act 3 — CCR (거의 실시간에 가까운 standby)

:::chat student AI 학생
계획된 리전 이동에 CCR은 어떻게 쓰나요?
:::

:::chat teacher 선생님
CCR은 **active-passive**다. **follower** 도메인이 **leader**의 사용자 인덱스·매핑·메타데이터를 pull한다. 연결은 **follower 쪽에서** 요청한다(pull 모델). **같은 리전·다른 리전**(원격 ARN으로 계정 넘기기도) 가능하다. 엔진: Elasticsearch **7.10+** 또는 OpenSearch **1.1+**. **FGAC**, **노드 간 암호화**, leader 인덱스의 `index.soft_deletes.enabled = true`가 필요하다.

**계획 마이그레이션** 순서:

1. 리전 B에 도메인을 만들고 **cross-cluster connection**(follower → leader)을 연다.
2. 인덱스별 replication을 시작하거나 **auto-follow**(`log-*` 등)를 건다.
3. `_status`가 **SYNCING**이고 leader/follower checkpoint가 맞춰질 때까지 기다린다.
4. 쓰기를 잠시 줄이거나(또는 잠깐 dual-write) lag를 확인한다.
5. follower에서 replication을 **`_stop`** → follower 인덱스가 일반 쓰기 가능 인덱스가 된다.
6. **쓰기·읽기**를 리전 B로 돌린다.
7. 괜찮으면 리전 A를 내린다.

건강한 상태에서 전달 lag는 보통 **1분 미만**. warmup 내내 **도메인 두 개** 비용과 **크로스 리전 전송**이 붙는다.
:::

:::chat student AI 학생
실무에서 CCR이 깨지는 지점은요?
:::

:::chat teacher 선생님
리전 이동할 때 특히 걸리는 공식·블로그 제한이다.

| 제한 | 마이그레이션에 왜 아픈지 |
|------|--------------------------|
| **자동 failover / 역할 교환 없음** | replication을 **`_stop`**하고 운영으로 승격해야 한다. AWS가 writer leadership을 바꿔 주지 않는다 |
| **pause &gt; 12시간** | stop → follower 인덱스 삭제 → replication을 **처음부터** 다시 |
| **stop은 일방통행** | `_stop` 뒤에 같은 follower 관계를 “재개”할 수 없다 |
| **같은 인덱스로 역방향 불가** | 리전을 되돌리려면 옛 인덱스를 **지우고** 반대 방향 CCR을 bootstrap — **전체 재동기화** |
| **UltraWarm / cold** | 복제 안 됨 — 양쪽 다 **hot**이어야 한다 |
| **M3 / T2 / T3** | 미지원 |
| **Self-managed ↔ Service** | 미지원 |
| **follower → 또 다른 follower** | 미지원 (한 leader에서만 뻗어 나감) |
| **SEARCH_ONLY 연결** | 예전 cross-cluster **search** 연결은 replication에 재사용 불가 — 지우고 다시 만든다 |
| **default ↔ opt-in 리전** | 이 조합 사이에는 CCR 불가 |

장애형 stop 뒤 옛 leader가 살아나도, 옛 인덱스로 “delta만 역동기화”는 안 된다. 삭제 + 역방향 CCR(또는 snapshot/restore)이다. 큰 인덱스면 비싸다.
:::

---

### Act 4 — Remote reindex

:::chat student AI 학생
remote reindex는 CCR·스냅샷이랑 어디가 다른가요?
:::

:::chat teacher 선생님
Remote reindex(`POST _reindex` + `source.remote`)는 원격 클러스터 **문서를 로컬(destination) 도메인으로 복사**한다. 일부 인덱스만 옮기거나, 지원 범위 안 버전 업그레이드, 스냅샷/S3를 피하고 싶을 때 맞다.

크로스 리전: `source.remote`에 `"region": "eu-west-1"` 같은 값을 넣는다. local은 OpenSearch **1.0+** 또는 Elasticsearch **6.7+**, remote 메이저는 local 이하여야 한다.

| 상황 | 가능 여부 |
|------|-----------|
| public 도메인, 다른 리전 | `region`으로 지원 |
| **같은 리전 VPC** 양쪽 | **VPC endpoint connection**(PrivateLink) 후 connection endpoint로 reindex |
| **크로스 리전 VPC → VPC** | 내장 VPC endpoint는 **같은 리전만**. 크로스 리전은 보통 **공인 CA 서명 프록시**(또는 snapshot/CCR으로 우회) |
| T2/T3 데이터 노드 | remote reindex **불가** |
| 아주 큰 데이터 | `scroll`, `socket_timeout`, batch `size` 튜닝 · dest에 `refresh_interval: -1`, `number_of_replicas: 0` 후 복구 — remote는 **slicing 없음** |

Remote reindex만으로는 **배치 복사**지 연속 복제가 아니다. 라이브 마이그레이션이면 **delta 계획**이 남는다. ingest freeze → 최종 reindex, backfill 중 dual-write, 시드 후 CCR 등.
:::

---

### Act 5 — *계획된* 리전 마이그레이션 고르기

:::chat student AI 학생
결정용 치트시트 주세요.
:::

:::chat teacher 선생님
| 상황 | 기울이는 쪽 |
|------|-------------|
| 수 시간 read-only/다운타임 감당 · 비용 최소 | **Snapshot → restore** |
| lag 거의 없이 짧은 cutover · 도메인 두 개 비용 OK | **CCR** → `_stop` + cutover |
| 인덱스 소수 · public endpoint OK | **Remote reindex** (+ delta 전략) |
| 로그/검색이 업스트림에서 재구축 가능 | **Dual-ingest 또는 rebuild** 후 flip |
| UltraWarm/cold 비중 큼 | Snapshot(또는 먼저 warm→hot). warm/cold에는 **CCR 불가** |
| VPC only, 크로스 리전 | **snapshot/S3** 또는 CCR. remote reindex는 네트워크 설계가 더 필요 |
| 멀티 계정 | 세 스토리지 경로 모두 IAM/버킷 정책 추가. CCR은 원격 ARN 지원 |

**계획 마이그레이션 체크리스트(공통):**

1. target 도메인 사이즈·설정 맞춤(플러그인, 커스텀 패키지, FGAC 롤, ISM 정책).
2. 앱/ingest가 리전 B로 가는 네트워크(VPC peering/TGW, PrivateLink, DNS).
3. 동기화 방식 + 리허설에서 잰 lag / restore 시간.
4. ingest 전환( pause, dual-write, CDC replay).
5. 클라이언트 endpoint 전환(Route 53 alias, config, 시크릿) — 클라이언트 **DNS TTL**도 여전히 중요하다.
6. 검증: doc count, `_cat/indices`, 샘플 쿼리, 알림, Dashboards.
7. 롤백: soak 끝날 때까지 source를 쓰기 가능 상태로 남긴다.
:::

:::chat student AI 학생
한 줄로 요약하면요?
:::

:::chat teacher 선생님
**OpenSearch 리전 마이그레이션 = 새 도메인 + (snapshot \| CCR \| reindex \| rebuild) + 클라이언트/ingest flip.** 같이 따라오는 managed global writer endpoint는 없다. self-managed 클러스터를 하나 더 두는 것과 비슷하게 cutover는 직접 소유한다.
:::

---

### 한눈에 비교

| | Snapshot/restore | CCR | Remote reindex | Dual-ingest / rebuild |
|--|------------------|-----|----------------|------------------------|
| 연속성 | 배치 | 연속 pull | 배치 | 파이프라인에서 연속 |
| 쓰기 승격 | 해당 없음(restore 전엔 빈 도메인) | 수동 `_stop` | 해당 없음 | 파이프라인이 이미 기록 중 |
| 잘 맞는 경우 | 비용 민감 DR / 찬 이동 | hot standby + 짧은 cutover | 선택적·버전 맞춘 복사 | 파생·휘발성 데이터 |
| 깨지기 쉬운 곳 | 초대형 클러스터의 긴 RTO | warm/cold, “자동 failover” 환상 | 크로스 리전 VPC PrivateLink 한도 | 원본이 업스트림일 때만 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** OpenSearch Service blue/green을 리전 마이그레이션 도구로 쓰면 안 되는 이유는?
---
OpenSearch Service blue/green은 **한 도메인 안에서** 설정·버전 변경을 적용하는 방식이다(임시 환경을 만들고 전환). 다른 AWS 리전으로 도메인을 만들거나 옮기지 않는다. 크로스 리전 이동에는 **별도 도메인**과 snapshot, CCR, reindex, rebuild 중 하나가 필요하다.
:::

:::quiz
**Q2.** CCR에서 follower가 쓰기를 받으려면 무엇을 해야 하고, pause만 12시간을 넘기면?
---
replication을 **`_stop`**해야 follower 인덱스가 leader를 unfollow하고 일반 인덱스가 된다(관리형 자동 승격 없음). **`_pause`만 12시간을 넘기면** 안전하게 resume할 수 없다. stop → follower 인덱스 삭제 → replication을 처음부터 다시 해야 한다.
:::

:::quiz
**Q3.** 리전을 넘긴 snapshot restore에서, target 도메인은 반드시 자기 리전 S3 버킷만 써야 하나?
---
**필수는 아니다.** AWS 문서는 다른 리전 버킷이면 `"endpoint": "s3.amazonaws.com"`으로 repo를 등록하라고 한다. 운영에서는 IAM·restore를 단순하게 하려고 **S3 CRR로 같은 리전 버킷**을 두는 경우가 많다. 스냅샷을 **찍을 때**는 보통 source 도메인과 **같은 리전** 버킷을 쓴다.
:::

:::quiz
**Q4.** 리전 이동에서 dual-ingest가 CCR·스냅샷보다 유리한 때는?
---
OpenSearch가 **파생 데이터**(로그, 이벤트, DB에서 만든 검색 문서)이고 **원본이 업스트림**일 때다. target을 dual-write하거나 재구축한 뒤 클라이언트/ingest만 돌리면, 특히 retention이 짧을 때 대용량 이력 이관보다 낫다.
:::

:::quiz
**Q5.** VPC-to-VPC 크로스 리전에서 remote reindex를 막는 네트워크 제약은?
---
remote reindex용 네이티브 **VPC endpoint(PrivateLink) connection**은 **양쪽 도메인이 같은 리전**이어야 한다. 크로스 리전 VPC-to-VPC는 보통 **공인 CA 서명 프록시**가 필요하거나, snapshot/CCR 같은 다른 방법을 고른다.
:::

---

## 메모

(조사 메모 — 워크로드 유형에 RPO/RTO/비용을 맞춰 경로를 고른다.)
