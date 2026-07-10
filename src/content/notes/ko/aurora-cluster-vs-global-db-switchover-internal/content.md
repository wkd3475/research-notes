---
title: 'Aurora cluster vs Global DB switchover — 내부 단계'
---

## 레퍼런스

- [High availability for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)
- [Failing over an Aurora DB cluster](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-failover.html)
- [Using Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html)
- [Switchover or failover in Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html)
- [Introducing the Aurora Storage Engine (blog)](https://aws.amazon.com/blogs/database/introducing-the-aurora-storage-engine/)
- [Global Database deep dive DAT404 (re:Invent PDF)](https://d1.awsstatic.com/events/reinvent/2020/Deep_dive_on_Global_Database_for_Amazon_Aurora_DAT404.pdf)
- [Cross-Region DR PostgreSQL (blog)](https://aws.amazon.com/blogs/database/cross-region-disaster-recovery-using-amazon-aurora-global-database-for-amazon-aurora-postgresql/)
- [switchover-global-cluster CLI](https://docs.aws.amazon.com/cli/latest/reference/rds/switchover-global-cluster.html)
- [FailoverDBCluster API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_FailoverDBCluster.html)
- [FailoverGlobalCluster API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_FailoverGlobalCluster.html)
- [Enhanced binlog](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html)
- [Cross-Region Aurora MySQL replicas](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Replication.CrossRegion.html)
- [Managed planned failovers (blog)](https://aws.amazon.com/blogs/database/managed-planned-failovers-with-amazon-aurora-global-database/)
- [Improving business continuity (blog)](https://aws.amazon.com/blogs/database/improving-business-continuity-with-amazon-aurora-global-database/)
- [Introducing Global Database Failover (blog)](https://aws.amazon.com/blogs/database/introducing-aurora-global-database-failover/)

---

## 왜 이 글을 찾아봤나

이전 노트 [Aurora Global Database Switchover — binlog는 어떻게 되나](/research-notes/ko/notes/aurora-global-db-switchover-binlog/)에서 binlog·CDC 관점은 정리했고, 이번에는 **단일 Aurora 클러스터 failover**와 **Global Database switchover/failover**가 내부적으로 무엇이 다른지 알아보고 싶었다. 리전 이동 전에 Aurora가 스토리지·compute·역할 교체를 어떻게 처리하는지 이해하려는 목적이다.

---

## 읽으면서 느낀 점

겉으로는 둘 다 "reader를 writer로 승격"하지만, 단일 클러스터는 **같은 스토리지 볼륨** 안에서 인스턴스만 바뀌고 Global DB는 **리전별 독립 볼륨 + 물리 복제** 위에서 역할이 바뀐다. 이 차이를 알고 나니 binlog 노트의 내용(스토리지 복제 ≠ binlog 복제)도 더 자연스럽게 이어진다.

---

## 배운 것

### 오늘 읽은 자료 (5단계)

| 단계 | 주제 | 핵심 자료 |
|------|------|-----------|
| 1 | HA·failover·Global DB 개요 | Aurora HA 가이드, `aurora-failover`, `aurora-global-database`, `aurora-global-database-disaster-recovery` |
| 2 | 스토리지 레이어·물리 복제 | Storage Engine 블로그, DAT404 PDF, Cross-Region DR PostgreSQL 블로그 |
| 3 | API·상태 머신 | `switchover-global-cluster`, `FailoverDBCluster`, `FailoverGlobalCluster` |
| 4 | Binlog와 Global DB | Enhanced binlog 문서, Cross-Region read replica 문서 |
| 5 | 실무·심화 | Managed planned failovers 블로그, Business continuity 블로그, Global Database Failover 블로그 |

### 핵심 전제: compute와 storage 분리

```
[Writer/Reader 인스턴스]  ←→  redo log  ←→  [분산 Storage fleet]
                                              ↓
                                    Global DB: cross-Region redo 복제
```

Aurora는 데이터 페이지 전체가 아니라 **redo log**만 스토리지로 보낸다. 스토리지가 백그라운드에서 페이지를 만든다. 이 구조가 단일 failover의 속도와 Global DB 물리 복제의 근거다.

---

### 1단계 — 단일 클러스터 HA & failover

| 항목 | 내용 |
|------|------|
| 범위 | 같은 Region, **같은 cluster volume** |
| 트리거 | writer 장애(자동) 또는 `failover-db-cluster`(수동) |
| 내부 동작 | 기존 reader 중 하나를 writer로 **promote** (reader 없으면 새 writer 생성) |
| 스토리지 | **변경 없음** — 같은 volume, 다른 compute가 writer |
| RPO | 사실상 0 |
| RTO | 보통 30초 이내, 최대 ~60초 |
| 승격 순서 | `PromotionTier` (0=최우선) → 동일 tier면 더 큰 인스턴스 |

**API:** `FailoverDBCluster` — `DBClusterIdentifier` + 선택적 `TargetDBInstanceIdentifier`

**Endpoint:** `cluster` endpoint는 항상 현재 writer를 가리킨다. failover 후 DNS 갱신되므로 cluster endpoint를 쓰면 앱 변경을 줄일 수 있다.

**Aurora MySQL 팁:** failover 시 **승격 대상 reader와 writer만** 재시작한다. 다른 reader는 reader endpoint로 계속 읽기 가능.

---

### 2단계 — 스토리지 레이어 & Global DB 물리 복제

#### Aurora 스토리지 구조

- **10GB protection group** 단위, 각 group을 **6 storage node**에 복제
- 6 node는 **3 AZ × 2 node**
- 용량은 데이터 증가에 맞춰 자동 확장 (최대 64TB)
- **쓰기 성공:** 6개 중 **4개 ACK** (4/6 write quorum)
- **읽기:** 3/6 read quorum

#### Storage node 내부 8단계

```
① Incoming Queue (메모리, 중복 log 제거)
② Hot Log 디스크 영속화 → ACK  ← 앱이 체감하는 쓰기 지연
③ log 정리, gap 탐지
④ Gossip으로 빠진 LSN 보충
⑤ Coalesce → 데이터 페이지 생성
⑥ S3 stage (연속 백업)
⑦ Garbage collection
⑧ CRC 검증
```

③~⑧은 전부 비동기.

#### compute/storage 분리가 failover에 주는 의미

- Reader는 데이터를 자체 보관하지 않음 → 기동 즉시 읽기
- Reader 장애 → 스토리지 데이터 무관
- Reader → Writer 승격 → **데이터 손실 없음** (같은 volume)

#### Global DB cross-Region 복제 4단계

```
Primary Region                              Secondary Region
Writer ─┬→ Storage nodes (6)
        ├→ Reader instances
        └→ Replication Server ──redo──→ Replication Agent
                                              ├→ Storage nodes
                                              └→ Reader instances
```

- **논리 복제(binlog)가 아님** — redo log 물리 복제로 **동일 데이터셋** 유지
- 전용 replication fleet이 처리 → primary writer 성능 영향 최소
- typical lag **1초 미만**, 최대 ~5초
- Region당 reader 최대 16개, secondary Region 최대 5개, 전체 reader 최대 90개

#### 논리 vs 물리 cross-Region 복제 (DAT404)

| | MySQL binlog (논리) | Aurora Global DB (물리) |
|--|---------------------|-------------------------|
| 방식 | SQL/row change 재실행 | redo log를 스토리지에 직접 적용 |
| QPS 증가 시 lag | 급격히 증가 | 거의 일정 (~1초) |
| 데이터 일치 | primary/replica 달라질 수 있음 | 동일 데이터셋 |

#### 모니터링 (PostgreSQL)

```sql
SELECT * FROM aurora_global_db_status();
-- durability_lag_in_msec, rpo_lag_in_msec

SELECT * FROM aurora_global_db_instance_status();
-- visibility_lag_in_msec
```

CloudWatch: `AuroraGlobalDBReplicationLag`, `AuroraGlobalDBReplicatedWriteIO`, `AuroraGlobalDBDataTransferBytes`

---

### 3단계 — API·상태 머신

#### 명령/API 매핑

| 시나리오 | CLI / API | Region 지정 |
|----------|-----------|-------------|
| 단일 클러스터 failover | `failover-db-cluster` / `FailoverDBCluster` | 클러스터 Region |
| Global DB switchover (planned) | `switchover-global-cluster` / `SwitchoverGlobalCluster` | **현재 primary Region** |
| Global DB failover (unplanned) | `failover-global-cluster` / `FailoverGlobalCluster` | primary Region (또는 콘솔) |

**Switchover CLI 예:**

```bash
aws rds --region <primary-region> \
  switchover-global-cluster \
  --global-cluster-identifier <global-db-id> \
  --target-db-cluster-identifier <secondary-cluster-arn>
```

**FailoverGlobalCluster 파라미터 구분:**

| 파라미터 | 용도 |
|----------|------|
| `AllowDataLoss=true` | unplanned failover (데이터 손실 허용) |
| `Switchover=true` (또는 생략) | planned switchover — **`SwitchoverGlobalCluster` 권장** |

#### Global cluster `FailoverState.Status`

| 상태 | 의미 |
|------|------|
| `pending` | switchover/failover 요청 수신, 사전 검증 중 |
| `switching-over` | primary demote, secondary promote, replica 동기화 등 **내부 작업 구간** |
| `failing-over` | unplanned failover 진행 중 |
| `cancelling` | 취소, 이전 상태로 복귀 |

`IsDataLossAllowed`: `true` = failover, `false` = switchover

#### Member 수준 필드

- `IsWriter` — 현재 writer 클러스터 여부
- `SynchronizationStatus` — `connected` / `pending-resync`
- `GlobalWriteForwardingStatus` — write forwarding 상태

---

### 4단계 — Binlog와 Global DB (이전 노트와 연결)

Global DB **리전 간 데이터 복제**와 **binlog**는 별개 레이다.

| 복제 종류 | 주체 | Global DB에 필요? |
|-----------|------|-------------------|
| 스토리지 물리 복제 | replication server/agent | ✅ (기본) |
| binlog 논리 복제 | MySQL 엔진 | ❌ (CDC·외부 replica용) |

**Cross-Region read replica (binlog 기반)** vs **Global DB:**

| | Cross-Region read replica | Global DB |
|--|---------------------------|-----------|
| 복제 | binlog 필수 (`binlog_format` 설정) | 스토리지 레이어, binlog 불필요 |
| secondary | 독립 DB, 데이터 달라질 수 있음 | 동일 데이터셋 |
| lag | Region 간 네트워크로 더 큼 | ~1초 |
| secondary 수 | source당 최대 5개 | 최대 5 Region |

**Enhanced binlog + Global DB:**

- `binlog_replication_globaldb=0` (enhanced binlog 필수)
- primary binlog 파일은 **secondary Region으로 복제 안 됨**
- switchover/failover 후 새 primary: `mysql-bin-changelog.000001`부터 새 시퀀스
- 과거 binlog·offset 연속성은 **AWS가 보장하지 않음** — CDC는 별도 설계

자세한 CDC 체크리스트는 [binlog 노트](/research-notes/ko/notes/aurora-global-db-switchover-binlog/) 참고.

---

### 5단계 — 실무 블로그 정리

#### Managed planned failover (switchover) 블로그

- 예전에는 Region failover 시 **토폴로지가 끊겨** secondary를 다시 만들어야 했음
- managed planned failover(switchover)는 **토폴로지 유지**, RPO=0
- **모든 Region 인스턴스 재시작** → unavailable 구간 있음
- 소요 시간은 **replication lag에 비례**
- switchover **취소 가능** (콘솔 Cancel failover)

**사전 체크리스트 (블로그 + 공식 문서):**

- secondary 인스턴스 크기·reader 수가 primary와 맞는지
- cluster/instance **parameter group** 동일하게
- CloudWatch alarm·이벤트·대시보드 (lag 메트릭은 secondary에서만 보임 → switchover 후 Region 바뀜)
- Secrets Manager cross-Region 복제
- **비피크 시간**에 실행
- Global writer endpoint 사용 시 앱 endpoint 변경 최소화

#### Business continuity 블로그

- RPO < 5초, RTO < 1분 (일반적 목표)
- 물리 복제로 엔진 부하 최소 → primary 성능 영향 거의 없음
- secondary detach 후 독립 클러스터로 운영 가능 (마이그레이션용)

#### Managed failover (unplanned) — 공식 문서 + Failover 블로그

- 동기화 **대기 안 함** → RPO = 장애 시점 lag
- **write fencing:** old primary 스토리지에 쓰기 차단 시도 (best-effort)
- old primary 복구 시 **새 storage volume** 생성, 스냅샷 `rds:unplanned-global-failover-*`
- 승격 후 **나머지 secondary Region rebuild** (수 분~수 시간)
- split-brain 위험 → 앱 오프라인, DNS TTL 5초, lag 가장 낮은 secondary 선택

#### Managed RPO (`rds.global_db_rpo`, PostgreSQL)

- secondary lag이 설정값 초과 시 **primary 쓰기 일시 중단**
- 최소 20초
- switchover(RPO=0)와 별개 — 평상시 lag 상한 제어

#### PostgreSQL logical replication slot

- switchover/failover 후 slot은 **자동 이전 안 됨** (버전·설정에 따라 다름)
- PG 17+ `sync_replication_slots` 등 failover slot 기능 검토
- DMS·Debezium 등 downstream은 switchover vs failover 대응이 다름

---

### 세 시나리오 한눈에

| | 단일 클러스터 failover | Global DB switchover | Global DB failover |
|--|------------------------|--------------------|--------------------|
| API | `FailoverDBCluster` | `SwitchoverGlobalCluster` | `FailoverGlobalCluster` |
| 스코프 | Instance (reader→writer) | Cluster (Region 역할 교체) | Cluster (Region 역할 교체) |
| 스토리지 | 동일 volume | Region별 독립 volume | Region별 독립 volume |
| 동기화 대기 | N/A | ✅ 필수 (RPO=0) | ❌ |
| RPO | 0 | 0 | >0 (lag) |
| RTO | ~30–60초 | 수 분 (lag 비례) | ~1분 + rebuild |
| topology | 동일 | 유지 | 유지 (managed) |
| old primary | reader로 복귀 가능 | read-only secondary | write fencing, 새 volume |
| 설정 상속 | N/A | parameter/monitoring **자동 상속 안 됨** | 동일 |
| Binlog (MySQL) | 연속 | Region별 독립; enhanced면 새 시퀀스 | 새 시퀀스 가능 |

---

### 타임라인

#### 단일 클러스터 failover

```
T0  정상 — App→Writer, Reader들은 같은 Storage Volume 공유
T1  Writer 장애 — write 🔴, reader endpoint 읽기는 가능할 수 있음
T2  승격 (~10–30s) — Reader→Writer, Storage 변화 없음
T3  Cluster endpoint DNS 갱신
T4  복구 🟢 — RTO ~30s
```

#### Global DB switchover (planned)

```
Phase 0  정상 — primary write, secondary read, lag ~1s
Phase 1  동기화 대기 🟡 — lag→0, write 아직 가능
Phase 2  Primary demote — read-only, write 🔴
Phase 3  Secondary promote 🔴 — 짧은 다운타임, 인스턴스 재시작
Phase 4  역할 교체 — topology 유지, Global writer endpoint→새 Region
Phase 5  복구 🟢 — RPO=0
```

**앱 연결 끊김 구간:** Phase 2 demote ~ Phase 5 reconnect 사이. Global writer endpoint면 Phase 5에서 자동 전환.

#### Global DB failover (unplanned)

```
T0  Primary Region 장애 💥 — replication 중단, RPO=마지막 lag
T1  앱 오프라인 권장, lag 최소 secondary 선택
T2  즉시 promote (동기화 skip) 🔴
T3  Write fencing (병렬, best-effort)
T4  새 primary write 가능 🟢 (~1분)
T5  나머지 secondary rebuild 🟡 (백그라운드, 수 분~수 시간)
T6  old primary 복구 시 새 volume + 스냅샷
```

#### 앱 관점 RTO 비교

```
단일 failover:     🟢~~~30s~~~🔴짧음~~~🟢
Global switchover: 🟢~~~lag대기~~~🔴짧음~~~🟢  (전체 수 분)
Global failover:   🟢~💥~🔴~1m~🟢~~~rebuild~~~
```

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 단일 클러스터 failover에서 스토리지 레이어는 무엇이 바뀌나?
---
**거의 아무것도 안 바뀐다.** 같은 cluster volume을 writer와 reader가 공유한다. failover는 **compute 계층**에서 reader 인스턴스가 writer 역할을 맡는 것이다. redo log 흐름도 동일 volume으로 계속 간다. 그래서 RPO=0이고 RTO가 짧다.
:::

:::quiz
**Q2.** Global DB switchover의 "동기화 대기"는 무엇을 기준으로 완료로 보나?
---
타깃 secondary가 primary와 **완전히 일치**할 때까지 기다린다. 관측 지표:

- CloudWatch `AuroraGlobalDBRPOLag` (PG, MySQL 3.04+/2.12+) 또는 `AuroraGlobalDBReplicationLag`
- SQL `aurora_global_db_status()`의 `rpo_lag_in_msec`, `durability_lag_in_msec`

lag가 0(또는 허용 범위)에 도달해야 Phase 2(demote)로 넘어간다. **lag가 클수록 switchover 전체 시간이 길어진다.**
:::

:::quiz
**Q3.** switchover와 failover에서 demote/promote 차이는?
---
**공통:** secondary reader 하나가 writer로 promote.

**Switchover:** lag=0 확인 → old primary read-only demote → write fencing 불필요 → RPO=0

**Failover:** 동기화 안 함 → old primary 죽음/unreachable → write fencing 시도 → RPO=장애 시점 lag → 나머지 secondary rebuild
:::

:::quiz
**Q4.** failover 후 secondary Region rebuild는 왜 필요하고 얼마나 걸리나?
---
Global DB는 **비동기** 복제라 Region마다 lag이 다를 수 있다. 새 primary 기준으로 나머지 secondary를 **동일 시점 데이터**로 맞춰야 한다. rebuild 완료 전 해당 Region은 read 불가 또는 stale. 소요: **수 분~수 시간** (볼륨 크기·Region 거리).
:::

:::quiz
**Q5.** Global DB switchover/failover 시 MySQL binlog는?
---
**스토리지 물리 복제와 binlog는 무관.** Global DB 데이터 동기화에 binlog가 필요 없다.

| 모드 | switchover/failover 후 |
|------|------------------------|
| Enhanced binlog ON | 과거 binlog 없음, `000001`부터 새 시퀀스 |
| Community binlog, `binlog_replication_globaldb=1` | 세컨더리에 복제된 파일 일부 유지 가능 |
| Binlog OFF | 해당 없음 |

CDC는 writer에만 붙고, offset 재개는 **새 primary에 해당 binlog 파일이 있을 때만** 성공.
:::

---

### 메트릭·이벤트 체크리스트

| 시점 | 확인 항목 | 위험 신호 |
|------|-----------|-----------|
| switchover 전 | `AuroraGlobalDBRPOLag` / `ReplicationLag` | 수 초 이상 |
| 진행 중 | Global cluster `FailoverState.Status` | `cancelling` |
| 진행 중 | `DatabaseConnections` (writer) | 복구 안 됨 |
| failover 후 | RDS Events | write fencing timeout |
| failover 후 | 스냅샷 | `unplanned-global-failover-*` |
| rebuild 중 | secondary lag | 높은 상태 지속 |

---

### Endpoint 정리

| Endpoint | failover/switchover 후 |
|----------|------------------------|
| **Global writer endpoint** | 새 primary Region (앱 변경 최소) |
| **Cluster endpoint** | Region별 — old primary endpoint 쓰면 **수동 변경** |
| **Reader endpoint** | 해당 Region reader |

예: `my-global.cluster-ro-xxx.us-west-1...` → promote 후 `my-global.cluster-xxx.us-west-1...` (`-ro` 제거)

---

### 한 줄 요약 (학습 경로)

```
Aurora storage/redo log
  → 단일 failover (같은 volume, reader promote)
    → Global DB 물리 복제
      → switchover (sync → demote → promote)
        → failover (no sync, fencing, rebuild)
          → Binlog/CDC 영향 (별도 레이어)
```

---

## 메모

다음 주제: **JDBC failover 감지와 최소 다운타임** — switchover 후 endpoint/DNS 변경을 드라이버가 어떻게 인지하는지, 어떤 연결 설정이 앱 다운타임을 줄이는지.
