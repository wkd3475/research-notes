---
title: 'Aurora Global Database Switchover — binlog는 어떻게 되나'
---

> 원문: [Setting up enhanced binlog for Aurora MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraMySQL.Enhanced.binlog.html), [Using switchover or failover in Amazon Aurora Global Database](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database-disaster-recovery.html), [Best practices for Aurora MySQL configuration](https://aws.amazon.com/blogs/database/best-practices-for-amazon-aurora-mysql-database-configuration/)

---

## 왜 이 글을 찾아봤나

오늘은 Aurora Global Database에서 switchover를 할 때 binlog가 어떻게 되는지 알아보려고 한다.

---

## 읽으면서 느낀 점

—

---

## 배운 것

### 복제는 두 겹이다

Aurora Global Database 리전 간 복제는 **스토리지 단 물리 복제**다. binlog 복제가 아니다. 세컨더리 클러스터는 SQL을 binlog로 다시 돌리지 않고, primary와 같은 데이터셋을 갖는다. binlog는 CDC 도구나 클러스터 간 복제 같은 **외부 소비자**용 레이어고, Global Database 안에서 어떻게 움직일지는 클러스터 파라미터로 따로 정한다.

### Switchover 흐름 (요약)

Switchover(예전 이름 managed planned failover)는 클러스터가 정상일 때 primary 리전을 바꿀 때 쓴다. **RPO = 0**이다.

1. 타깃 세컨더리가 primary와 완전히 맞을 때까지 기다린다
2. 기존 primary 리전 클러스터를 read-only로 내린다
3. 고른 세컨더리를 primary로 올린다(리더 중 하나가 writer가 됨)
4. 복제 토폴로지는 그대로다. 리전 수나 클러스터 수는 안 바뀐다

인스턴스가 재시작되면서 잠깐 unavailable 해진다. AWS 문서는 switchover와 failover를 승격 과정으로 묶어 설명하고, binlog 얘기는 대부분 "failover"라는 말로 적혀 있다. 결과만 보면 같다. 예전 세컨더리가 새 primary writer가 된다.

### 핵심 파라미터: `binlog_replication_globaldb`

| 설정 | 기본값 | 의미 |
|------|--------|------|
| `binlog_replication_globaldb = 1` | 예 (community binlog) | primary의 binlog 데이터가 Global Database **세컨더리 클러스터로 복제됨** |
| `binlog_replication_globaldb = 0` | enhanced binlog 사용 시 필수 | binlog 데이터가 **세컨더리 리전으로 복제되지 않음** |

enhanced binlog(`aurora_enhanced_binlog = 1`)를 쓰려면 `binlog_replication_globaldb = 0`, `binlog_backup = 0`이 함께 필요하다. 세 파라미터 모두 static이라 변경 후 writer 재부팅이 필요하다.

### Switchover 이후 binlog — 모드에 따라 갈린다

#### Enhanced binlog ON (`aurora_enhanced_binlog = 1`)

- 예전 primary의 binlog 파일은 세컨더리 리전에 **복제되지 않는다**.
- Switchover(또는 failover) 후 **새 primary에는 예전 primary의 과거 binlog가 없다**.
- binlog가 켜져 있으면 새 primary는 `mysql-bin-changelog.000001`부터 **새 파일 시퀀스**를 시작한다.
- enhanced binlog를 켜기 **전에** 쓰인 binlog 파일도 새 primary에서 보이지 않는다(시퀀스 단절 방지).
- 세컨더리 쪽에 enhanced binlog 파라미터가 안 잡혀 있었다면, 승격 후 그 클러스터에서 따로 설정해야 한다.

#### Community binlog ON (`aurora_enhanced_binlog = 0`, `binlog_replication_globaldb = 1`)

- 세컨더리일 때 binlog 데이터가 **세컨더리 클러스터로 복제된다**.
- Switchover 뒤 승격된 클러스터는 세컨더리일 때 받아 둔 파일 가운데, **enhanced binlog를 마지막으로 끈 다음에 쓰인 binlog**를 남길 수 있다.
- AWS 예시: enhanced binlog를 `mysql-bin-changelog.000003` 이후에 끄면, `000004`~`000006`은 승격된 클러스터에 남는다.

### Switchover가 binlog에 해주지 **않는** 것

Aurora **blue/green** switchover와 달리 Global Database switchover 문서에는 외부 replica용 **binlog 좌표 이벤트**가 없다. Blue/green은 `Binary log coordinates in green environment after switchover: file mysql-bin-changelog.000003 and position 40134574` 같은 메시지로 `CHANGE REPLICATION SOURCE TO ...` 재연결을 알려 준다. Global Database 문서는 아래에 더 무게를 둔다.

- **global writer endpoint** 사용(연결 문자열 유지)
- 승격될 클러스터의 파라미터 그룹·모니터링·알람 사전 정렬
- PostgreSQL: switchover 후 logical replication slot 관리

MySQL 외부 binlog 소비자라면 **끊김·재연결 계획**을 미리 잡아 둬야 한다. enhanced binlog면 더 그렇다.

### 비교표

| 상황 | Switchover 후 새 primary의 과거 binlog | 이후 binlog 기록 |
|------|----------------------------------------|------------------|
| Enhanced binlog ON | 없음; `.000001`부터 새 시퀀스 | 새 primary가 새 파일 기록 |
| Community binlog ON (기본 파라미터) | 복제된 파일 일부 유지(enhanced 끈 뒤 구간) | 복제된 파일에서 이어짐 |
| Binlog OFF | 해당 없음 | 해당 없음 |

### Switchover 전 체크리스트 (binlog 관점)

- [ ] binlog 모드 확인: `SHOW STATUS LIKE 'aurora_enhanced_binlog';`
- [ ] 글로벌 DB **모든** 클러스터의 `binlog_replication_globaldb`, `aurora_enhanced_binlog` 확인(승격 클러스터는 예전 primary 파라미터 그룹을 물려받지 않음)
- [ ] CDC·외부 replica가 primary endpoint binlog를 읽는다면, switchover 후 재연결 방법 설계 — 쓰기는 global writer endpoint로 맞출 수 있어도 enhanced binlog에서는 파일 연속성이 보장되지 않음
- [ ] binlog에 의존한다면 `binlog_format`이 `OFF`가 아닌지 확인

### 직접 검증해볼 질문

- Community binlog에서 switchover **직전** 세컨더리의 binlog 파일 목록이 예전 primary 꼬리와 항상 일치하는지
- Global Database switchover 시 MySQL용 binlog 좌표 RDS 이벤트가 있는지(blue/green에는 있으나 Global Database 문서는 언급 없음)
- 원래 primary 리전으로 다시 switchover할 때의 동작

---

## 메모

—
