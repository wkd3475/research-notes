---
title: 'Aurora Global Database Switchover — binlog는 어떻게 되나'
---

> 원문: [Setting up enhanced binlog for Aurora MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html), [Using switchover or failover in Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html), [Introducing enhanced binlog (AWS blog)](https://aws.amazon.com/blogs/database/introducing-amazon-aurora-mysql-enhanced-binary-log-binlog/), [Global Database writer endpoint 딥다이브 (AWS blog)](https://aws.amazon.com/blogs/database/diving-deep-into-the-new-amazon-aurora-global-database-writer-endpoint/), [Aurora reader binlog — re:Post](https://repost.aws/questions/QUQuQ2eje6TnatP_lAtdydhg/can-we-configure-separate-binary-logging-binlog-on-aurora-mysql-s-read-replica-instance)

---

## 왜 이 글을 찾아봤나

DB를 다른 리전으로 옮길 때 Aurora Global Database switchover를 쓸 예정이다. 그전에 CDC connector에서 switchover 전후로 어떤 작업이 필요한지, binlog가 어떻게 되는지부터 확인하려고 했다.

---

## 읽으면서 느낀 점

- global writer endpoint가 앱 재연결은 해결해 주지만, CDC offset·binlog 연속성은 별개 문제다. 리전 이동 전에 이 간극을 메워 둬야 한다.
- `binlog_replication_globaldb=1`이어도 세컨더리가 read-only인 동안 세컨더리에 CDC connector를 붙여 binlog를 읽을 수는 없다. 회사에서 테스트해 봤는데 안 읽혔고, Aurora가 writer에서만 binlog를 보내는 구조라면 그게 맞다.

---

## 배운 것

### 오늘 읽은 자료

- [Aurora MySQL enhanced binlog (한글 블로그)](https://hoing.io/archives/3086)
- [Introducing enhanced binlog (AWS 블로그)](https://aws.amazon.com/blogs/database/introducing-amazon-aurora-mysql-enhanced-binary-log-binlog/)
- [Global Database writer endpoint 딥다이브 (AWS 블로그, 2024.10)](https://aws.amazon.com/blogs/database/diving-deep-into-the-new-amazon-aurora-global-database-writer-endpoint/)

### 복제는 두 겹이다

Global Database 리전 간 복제는 **스토리지 단 물리 복제**다. binlog 복제가 아니다. 세컨더리는 SQL을 binlog로 다시 돌리지 않고 primary와 같은 데이터셋을 갖는다. binlog는 CDC·외부 복제용 레이어고, Global Database 안에서의 동작은 클러스터 파라미터로 따로 정한다.

### Switchover 흐름 (요약)

계획적 리전 전환, **RPO = 0**.

1. 타깃 세컨더리가 primary와 완전히 맞을 때까지 대기
2. 기존 primary를 read-only로 강등
3. 세컨더리를 primary로 승격(리더 중 하나가 writer)
4. 토폴로지는 그대로(리전 수·클러스터 수 동일)

인스턴스 재시작으로 잠깐 unavailable. 문서는 binlog를 종종 "failover" 맥락으로 쓰지만, 승격 결과는 같다.

### `binlog_replication_globaldb`가 하는 일

| 설정 | 기본값 | 효과 |
|------|--------|------|
| `= 1` | 예 (community binlog) | primary binlog 데이터가 Global Database **세컨더리 클러스터로 복제됨** |
| `= 0` | enhanced binlog 시 필수 | binlog가 **세컨더리 리전으로 복제되지 않음** |

핵심: binlog **파일**을 세컨더리에 복제해 두는 것이지, 세컨더리가 read-only인 동안 **실시간 CDC 소스**가 되는 게 아니다. 승격 **이후** 새 primary가 예전 offset으로 이어 읽을 수 있게 미리 파일을 넘겨 두는 용도에 가깝다.

enhanced binlog(`aurora_enhanced_binlog = 1`)는 `binlog_replication_globaldb = 0`, `binlog_backup = 0`과 함께 써야 하고, static 파라미터라 writer 재부팅이 필요하다.

### 세컨더리에 CDC connector — switchover 전에는 불가

| 상황 | 세컨더리 CDC? | 이유 |
|------|---------------|------|
| switchover 전 (read-only 세컨더리) | **불가** | writer 없음; reader는 binlog source가 아님 (`SHOW MASTER STATUS` 빈 결과) |
| switchover 후 (세컨더리가 primary) | **가능** | writer 생김; community binlog면 복제된 파일로 재개될 수도 있음 |

CDC(Debezium, DMS 등)는 **writer**에 붙인다. **global writer endpoint** 또는 primary cluster writer endpoint를 쓰고, 세컨더리 reader/cluster endpoint는 쓰지 않는다.

### Switchover 이후 binlog — 모드별

**Enhanced binlog ON**

- 예전 primary binlog는 세컨더리로 복제되지 않음
- 승격 후 과거 binlog 없음 → `mysql-bin-changelog.000001`부터 새 시퀀스
- 승격 클러스터는 예전 primary 파라미터 그룹을 물려받지 않음

**Community binlog ON (`binlog_replication_globaldb = 1`)**

- 세컨더리일 때 binlog가 복제됨
- 승격 후 복제된 파일 일부 유지 가능(enhanced를 마지막으로 끈 뒤 구간)
- AWS 예: enhanced를 `000003` 이후에 끄면 `000004`~`000006`이 승격 클러스터에 남음

### Global DB switchover가 binlog에 안 해주는 것

blue/green switchover처럼 binlog 좌표 RDS 이벤트(`Binary log coordinates in green environment after switchover: …`)는 **없다**. AWS가 file+position을 찍어 주는 걸 기대하면 안 된다.

### 리전 이동 시 CDC connector 체크리스트

**switchover 전 — connector**

| 항목 | 조치 |
|------|------|
| Hostname | **Global Database writer endpoint** (리전별 cluster/reader endpoint 아님) |
| 네트워크 | connector와 DB 리전이 다르면 크로스 리전 VPC 연결 |
| DNS TTL | Route 53 endpoint; 캐시 지연·RDS 이벤트 대비 |
| Binlog 모드 | `aurora_enhanced_binlog`, `binlog_replication_globaldb` 전 클러스터 확인 |
| Offset 백업 | `connect-offsets`에서 file+position 또는 GTID |
| Heartbeat | `heartbeat.interval.ms` (예: 10초) |
| Snapshot | `snapshot.mode=when_needed` |

**switchover 중·후**

1. writer 재시작 → 연결 끊김
2. global writer endpoint로 재시도
3. 저장된 offset으로 재개 — **새 primary에 해당 binlog 파일이 있을 때만** 성공

| 새 primary binlog 모드 | CDC 예상 |
|------------------------|----------|
| Enhanced binlog | offset 불일치 → `binlog file … no longer available` |
| Community binlog | offset 파일이 복제돼 있으면 자동 재개 **가능** — non-prod에서 확인 |
| 파일 없음 | snapshot 또는 offset 수동 복구 |

**복구:** `when_needed` snapshot · `connect-offsets` tombstone · Debezium `set-binlog-position` · connector 재생성

### 비교표

| 상황 | 승격 후 과거 binlog | 이후 기록 |
|------|---------------------|-----------|
| Enhanced binlog ON | 없음; `.000001`부터 | 새 파일 |
| Community binlog ON | 복제 파일 일부 유지 | 복제 파일에서 이어질 수 있음 |
| Binlog OFF | 해당 없음 | 해당 없음 |

### 아직 non-prod에서 확인할 것

- community binlog에서 switchover 직전 세컨더리 `SHOW BINARY LOGS`가 primary 꼬리와 맞는지
- enhanced binlog 프로덕션일 때 정확한 복구 경로
- 원래 primary 리전으로 switchback할 때 동작

---

## 메모

다음은 single Aurora cluster switchover와 Global DB switchover의 **내부 전환 단계**, 그리고 **JDBC**가 전환을 어떻게 감지해서 다운타임을 줄이는지 공부할 예정.
