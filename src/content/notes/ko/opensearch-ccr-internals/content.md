---
title: 'OpenSearch CCR 내부 동작 — follower는 실제로 어떻게 복제하나'
---

## 레퍼런스

- [Cross-cluster replication RFC (opensearch-project/cross-cluster-replication)](https://github.com/opensearch-project/cross-cluster-replication/blob/main/docs/RFC.md)
- [Cross-cluster replication plugin — OpenSearch 문서](https://docs.opensearch.org/latest/tuning-your-cluster/replication-plugin/index/)
- [Cross-cluster replication for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/replication.html)
- [RetentionLease (OpenSearch server API)](https://www.javadoc.io/static/org.opensearch/opensearch/1.3.9/org/opensearch/index/seqno/RetentionLease.html)
- [Translog pruning based on retention leases (OpenSearch #1100)](https://github.com/opensearch-project/OpenSearch/issues/1100)
- [CCR setup and bootstrap (index-state-management.org)](https://www.index-state-management.org/cross-cluster-replication-operations/ccr-setup-and-bootstrap/)

---

## 왜 이 글을 찾아봤나

OpenSearch 리전 마이그레이션 노트의 후속이다. 그 노트는 CCR을 블랙박스로만 봤다. "follower가 leader를 pull하고, 승격은 `_stop`" 정도로. 이번엔 그 밑을 보고 싶었다. 실제로 바이트를 옮기는 게 뭔지, follower가 leader를 어떻게 따라 붙는지, 그리고 그 유명한 제한들(soft delete 필수, 12시간 pause 한도, 역방향 증분 불가)이 왜 임의 규칙이 아니라 설계에서 그냥 따라 나오는 건지.

---

## 읽으면서 느낀 점

CCR은 새로 만든 복제 엔진이 아니다. OpenSearch에 이미 있던 세 부품을 재활용한 플러그인이다. **persistent task**, **snapshot/restore** 기계, **retention lease**. 마이그레이션 노트에 나온 제한 대부분이 이 셋 중 하나에서 곧장 떨어진다.

---

## 배운 것

*CCR = follower가 주도하는 플러그인. leader를 가짜 snapshot repository로 삼아 follower 인덱스를 **bootstrap**한 뒤, leader 샤드마다 long-poll reader/writer 루프로 **tail**한다. 이때 아직 못 읽은 이력을 leader가 지우지 않도록 **retention lease**를 건다.*

---

### Act 1 — 이게 대체 무슨 물건인가

:::chat student AI 학생
디테일 전에요. CCR은 *어떤 종류*의 시스템이에요? 별도 서비스인가요?
:::

:::chat teacher 선생님
아니다. 양쪽 클러스터에 올라가는 **OpenSearch 플러그인**이고, 이미 있던 기계를 일부러 재활용한다.

- **Persistent task** — ISM 같은 백그라운드 작업이 쓰던 그 프레임워크다. 상태를 **cluster state**에 두니까 노드가 재시작해도 마지막 체크포인트에서 이어 간다.
- **Snapshot/restore** — 일회성 bootstrap 복사에 그대로 갖다 쓴다.
- **Retention lease + soft delete** — 연산 이력을 남겨 둬서 follower가 tail할 수 있게 한다.

모델은 **active-passive, pull 방식**이다. **follower**가 **leader**로 연결을 열고 일을 다 한다. leader는 자기 이력을 읽어 주기만 한다. 이 한 가지 선택—follower가 pull한다—이 곧 **관리형 failover가 없는** 이유다. leader는 자기가 무슨 권위 있는 leader라는 자각이 없어서, 역할을 대신 뒤집어 주는 게 leader 쪽엔 없다.
:::

:::chat student AI 학생
연결은 실제로 어디로 도나요?
:::

:::chat teacher 선생님
**transport 계층(9300 포트)**이다. REST/9200이 아니라. follower에 leader를 remote cluster로 등록하고(`cluster.remote.<alias>.seeds`), 복제 task를 돌리거나 follower 샤드를 얹는 노드는 전부 **`remote_cluster_client`** 역할을 달고 있어야 한다. 없으면 leader로 transport 채널을 못 연다. 노드 간 암호화는 **양쪽 다 켜거나 다 끄거나** 둘 중 하나다. 섞으면 안 된다.
:::

---

### Act 2 — task 계층

:::chat student AI 학생
`_start`를 부르면 뭐가 생기나요?
:::

:::chat teacher 선생님
persistent task 트리가 생긴다. 전부 **follower에서** 돈다.

- **`IndexReplicationTask`** (follower 인덱스당 하나) — 코디네이터다. 데이터는 **안** 옮긴다. *아무* 노드에서나 돌 수 있고(cluster-manager 노드도 가능), 플러그인이 task가 가장 적은 노드를 고른다. bootstrap을 돌린 뒤 샤드 task들을 띄워 감독하고 인덱스 레벨 실패까지 처리한다.
- **`ShardReplicationTask`** (follower **primary** 샤드당 하나) — 실무자다. 자기가 쓸 **primary 샤드와 같은 노드에** 붙어 있고, 변경을 재생하는 reader/writer 루프를 돌린다.
- **`AutofollowReplicationTask`** (`_autofollow`가 만드는 클러스터 레벨) — 특정 인덱스에 매이지 않는다. 패턴에 맞는 leader 인덱스를 주기적으로 훑고, 새로 걸리는 것마다 `_start`를 쏜다.

각 단계는 **cluster state에 체크포인트**로 남는다. 그래서 도중에 노드가 죽어도 처음부터가 아니라 마지막 단계에서 이어 간다.
:::

:::chat student AI 학생
그럼 코디네이터랑 샤드 워커가 서로 다른 노드에 있을 수도 있는 거네요?
:::

:::chat teacher 선생님
그렇다. `IndexReplicationTask`는 어디 있어도 되는 가벼운 오케스트레이터고, `ShardReplicationTask`는 **데이터가 있는 곳에** 붙어서 재생을 로컬 쓰기로 만든다. 셋 다 **`_start`를 부른 사용자의 보안 컨텍스트**로 실행되고, 이건 cluster state에 담긴다. `use_roles`(`leader_cluster_role` / `follower_cluster_role`)가 바로 이걸 묶는다. 인가는 양쪽 끝에서 **transport 요청마다** 다시 확인하니까, 복제 도중에 그 역할을 회수하면 뒤이은 fetch가 실패한다.
:::

---

### Act 3 — retention lease: tail을 가능하게 하는 장치

:::chat student AI 학생
마이그레이션 노트에서 leader 인덱스에 `soft_deletes`가 켜져 있어야 한다던데, 복제가 삭제랑 무슨 상관이에요?
:::

:::chat teacher 선생님
"tail"이란 follower가 leader에게 **연산을 sequence number로** 달라는 것이기 때문이다. "seqNo N 이후 전부 줘." 그러려면 leader가 그 연산들을 *아직 갖고* 있어야 한다. 평소 Lucene은 공간을 되찾으려고 soft-delete되거나 덮어써진 문서를 **merge로 지운다**. **retention lease**가 그걸 막는다.

retention lease는 leader 샤드에 걸리는 마커고, 안에 이게 들어 있다.

- **retaining sequence number** — seqNo가 이 값 이상인 연산은 merge를 거쳐도 남는다,
- 고유 id, 타임스탬프, 그리고 **source**(여기선 `"ccr"`).

복제가 시작되면 `IndexReplicationTask`가 leader 샤드마다 lease를 잡는다. follower가 한 배치를 **내구성 있게 적용**하고 나면, 샤드 task가 lease를 앞으로 **갱신**한다. 이 갱신이 곧 leader에게 새 retaining seqNo 밑은 **잘라내거나 merge해도 된다**는 신호다.
:::

:::chat student AI 학생
follower가 뒤처지면요?
:::

:::chat teacher 선생님
그게 핵심이다. lease엔 **기간**(`index.soft_deletes.retention_lease.period`, 약 12h)이 있다. follower가 그보다 오래 밀리면 lease가 **만료**되고, leader는 follower가 아직 필요로 하던 연산을 **garbage-collect**해 버린다. 증분으로 이어 붙일 길이 없다. follower가 원하는 seqNo가 이제 존재하지 않으니까. 복구는 **전체 re-bootstrap**(모든 샤드를 remote restore 다시) 하나뿐이다.

마이그레이션 노트의 제한 두 개가 여기서 기계적으로 나온다.

- **"pause &gt; 12h ⇒ follower 삭제 + 처음부터"** — pause된 follower는 갱신을 멈춘다. lease가 만료되면 이력이 날아간다.
- **"retention 넘게 밀리면 ⇒ 전체 재동기화"** — 같은 만료, 방아쇠만 다르다.
:::

---

### Act 4 — bootstrap(`BOOTSTRAPPING`): leader를 가짜 snapshot repo로

:::chat student AI 학생
follower는 *기존* 데이터—복제 시작 전에 이미 색인된 전부—를 어떻게 받나요?
:::

:::chat teacher 선생님
여기가 재활용의 묘미다. 플러그인이 **leader 클러스터를 follower에게 내부 snapshot repository로 노출**한다. 그 "repository"로 가는 요청은 leader로 가는 요청으로 번역된다. 그러고 나서 follower는 그 위에 **평범한 snapshot-restore recovery**를 돌린다.

1. leader 각 샤드의 Lucene segment를 follower로 restore한다 → 어떤 commit point 기준으로 leader와 **바이트가 일치하는** 복사본.
2. 표준 restore 경로라서, follower 인덱스가 **leader의 설정·매핑 그대로** 자동 생성된다. 그래서 follower 인덱스가 **미리 있으면 안 된다**.
3. leader 쪽에선 **Restore Leader Service**가 이걸 조율한다. follower가 restore 중인 **commit point**를 붙잡아 두고 전송을 추적하다가, 끝나면 자원을 정리한다.

recovery가 실패하면 `IndexReplicationTask`는 **`FAILED`**로 간다. 큰 인덱스면 이 단계가 I/O·네트워크를 많이 먹고 몇 분씩 간다. 비싼 대목이다.
:::

:::chat student AI 학생
그럼 bootstrap은 결국 leader가 S3 자리를 대신하는 snapshot/restore인 거죠?
:::

:::chat teacher 선생님
맞다. 개념상 snapshot restore랑 똑같은 segment 파일 복사인데, 오브젝트 스토리지 대신 leader에서 바로 스트리밍한다. restore commit이 떨어지면 인덱스는 `BOOTSTRAPPING`을 벗어나 `SYNCING`으로 들어가고, 거기서 *싼* 증분 tail이 시작된다. 그리고 이 루프를 기억해라. 정상 상태가 retention lease를 넘어 한 번 깨지면, **바로 이 bootstrap으로 도로 던져진다**.
:::

---

### Act 5 — 정상 상태(`SYNCING`/`SYNCED`): reader/writer 루프

:::chat student AI 학생
bootstrap 끝나면 샤드 하나는 어떻게 계속 동기 상태를 유지하나요?
:::

:::chat teacher 선생님
`ShardReplicationTask`마다 **reader**와 **writer** 스레드를 하나 이상 돌린다.

- **Reader** — leader 샤드 복제본에 **long-poll**을 건다. "내 체크포인트 이후 연산 배치를 줘." 줄 게 없으면 요청이 **최대 5분쯤 대기**하다가 빈손으로 돌아오고, follower가 다시 건다. leader 색인 처리량에 맞추려고 long-poll이 **동시에 여러 개** 떠 있을 수 있다(`plugins.replication.follower.concurrent_readers_per_shard`, 기본 2). 받아 온 연산은 노드의 **메모리 큐**에 쌓인다.
- **Writer** — 큐를 **순서대로** 비우며 각 연산을 follower primary 샤드에 재생한다. 적용된 연산은 다시 follower의 **자기 replica 샤드로** 평범한 로컬 쓰기처럼 전파된다. 어떤 연산이 follower엔 아직 없는 매핑을 참조하면, writer가 **leader에서 갱신된 매핑을 동기로 가져와** 먼저 적용하고 이어 간다.
- 배치가 내구성 있게 쓰이면 writer가 leader의 **retention lease를 갱신**한다(Act 3).
:::

:::chat student AI 학생
lag는 어떻게 읽나요?
:::

:::chat teacher 선생님
**체크포인트**로 본다. `_status`가 `leader_checkpoint`와 `follower_checkpoint`를 준다. 둘 다 sequence number다. 그 차이가 **연산 단위의 실시간 lag**다. 체크포인트가 붙으면 건강한 거고, 여러 폴링에 걸쳐 격차가 벌어지면 follower가 못 따라가는 거다(peer 대역폭 포화거나 follower 티어가 저사양이거나). 이건 문서 레벨(**logical**) 복제다. 정상 상태에서 follower는 연산을 재생하지, segment를 rsync하지 않는다.

메타데이터(매핑/설정)도 더 느린 주기로 동기화된다. `plugins.replication.follower.metadata_sync_interval`(약 60s). 여기에 더해 writer가 필요할 때 동기로 당겨 오는 매핑 fetch가 따로 있다.
:::

---

### Act 6 — leader는 그 연산을 어디서 읽나 (그리고 CPU 값)

:::chat student AI 학생
reader가 "seqNo N 이후 연산"을 달라고 하면, leader는 그걸 어디서 꺼내요?
:::

:::chat teacher 선생님
기본은 **Lucene**이다. retention lease가 살려 둔 soft-delete된 연산들 말이다. 벤치마크에서 걸린 함정이 여기다. Lucene에서 연산을 복원하려면 **stored field를 압축 해제**해야 하는데, 무거운 색인 부하 아래서 leader CPU를 대략 **8~10%** 먹었다.

그래서 최적화가 있다. **retention lease 기반 translog pruning**(`plugins.replication.index.translog.retention_lease.pruning.enabled`). translog는 연산을 **압축 없이** 담는다. 이걸 켜면 translog 삭제 정책도 retention lease를 존중해서 오래된 translog 세대를 남겨 두고, fetch가 **translog에서 바로** 서빙해 Lucene 압축 해제를 건너뛴다. translog가 크기 한도를 넘으면 오래된 세대는 그래도 잘리고, fetch는 **Lucene으로 폴백**한다. 결국 CPU vs 디스크 트레이드고, Lucene이 안전망이다.
:::

---

### Act 7 — CCR이 *안* 하는 것, 그리고 상태 기계

:::chat student AI 학생
다들 CCR이 "클러스터"를 미러링한다고 생각하잖아요. 실제로 경계 밖에 있는 건 뭐예요?
:::

:::chat teacher 선생님
CCR은 **데이터 플레인 연산 + 인덱스 매핑/설정**만 복제한다. 나머진 없다. 아래는 전부 **클러스터별**로 남고, follower엔 네가 만든 자동화로 직접 심어야 한다.

- 템플릿, **ISM 정책**, ingest 파이프라인, 역할, `_cluster/settings`.
- **lifecycle 액션 자체**: leader의 `rollover`는 *새* backing 인덱스를 만든다. **auto-follow** 규칙이 걸리지 않는 한 follower는 손도 안 댄다. (rolling 인덱스에 per-index `_start`가 아니라 auto-follow가 필요한 이유가 이거다.)
- **follower 쓰기** — follower 인덱스는 **플러그인이 write-block**한다(껐다 켰다 하는 설정이 아니다). 쓰기 가능하게 만드는 유일한 방법은 `_stop`으로 **승격**하는 것뿐이고, 그러면 leader에서 떼어 내고 block이 풀린다.

그래서 CCR 토폴로지는 사실 **배포 두 벌**이다. 데이터는 한 방향으로 흐르고, 컨트롤 플레인은 네가 양쪽에 배포한다. 템플릿을 한쪽 클러스터에서만 고치는 게 follower가 슬그머니 어긋나는 경로다.
:::

:::chat student AI 학생
그리고 `_status`에서 보게 될 lifecycle 상태는요?
:::

:::chat teacher 선생님
`INIT → BOOTSTRAPPING → SYNCING ⇄ SYNCED`, 옆에 `FAILED`가 하나.

- **`INIT`** — 잠깐이다. leader 샤드 세트를 등록하는 중.
- **`BOOTSTRAPPING`** — remote snapshot restore(Act 4).
- **`SYNCING`** — restore 끝, 격차를 좁히며 재생 중.
- **`SYNCED`** — 따라잡음. 새 leader 연산이 오면 다시 `SYNCING`으로.
- **`FAILED`** — 손대기 전까진 종착이다. 플러그인은 role/block 에러를 **자동 재시도하지 않는다**. 잘못 설정된 `_start`를 다시 돌려 봐야 또 실패하니까. 원인을 고치고 `_start`를 다시 쏘면 `BOOTSTRAPPING`부터 다시 걷는다.
:::

---

### 한눈에 보는 내부 구조

| 관심사 | 메커니즘 | 재활용한 OpenSearch 부품 |
|--------|----------|--------------------------|
| 오케스트레이션 | `IndexReplicationTask`(코디네이터) + `ShardReplicationTask`(primary당) | persistent task (상태는 cluster state) |
| auto-follow | `AutofollowReplicationTask`가 패턴 매칭을 leader에서 폴링 | persistent task |
| 초기 복사 | leader를 내부 snapshot repo로 노출 → segment restore | snapshot/restore recovery |
| 이력 보존 | leader 샤드에 retention lease(retaining seqNo, source `ccr`) | soft delete + retention lease |
| tail | reader long-poll(체크포인트 이후 배치) → 큐 → writer 재생 | seqNo / 체크포인트 |
| lag 지표 | `leader_checkpoint − follower_checkpoint` | sequence number |
| fetch 소스 | 기본은 Lucene soft-delete, 옵션으로 translog pruning해 압축 해제 회피 | translog 삭제 정책 |
| 쓰기 안전 | follower에 플러그인이 건 write block | index block |

### 동작을 좌우하는 설정

| 설정 | 위치 | 대략값 | 무엇을 정하나 |
|------|------|--------|----------------|
| `index.soft_deletes.enabled` | leader 인덱스 | `true` (필수) | 애초에 tail할 이력이 존재하는지 |
| `index.soft_deletes.retention_lease.period` | leader 인덱스 | `12h` | 밀린 follower가 전체 re-bootstrap 전에 얼마나 이어 붙일 수 있나 |
| `plugins.replication.index.translog.retention_lease.pruning.enabled` | leader 인덱스 | 기본 꺼짐 | fetch를 압축 없는 translog에서 서빙할지 Lucene에서 할지 |
| `plugins.replication.follower.concurrent_readers_per_shard` | follower | `2` | 샤드당 동시 long-poll reader 수 |
| `plugins.replication.follower.metadata_sync_interval` | follower | `60s` | 매핑/설정 당겨 오는 주기 |
| `plugins.replication.autofollow.fetch_poll_interval` | follower | `30s` | auto-follow가 leader를 훑는 간격 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** CCR은 이미 있던 OpenSearch 서브시스템 셋을 재활용한다. 각각 무엇이고 복제에서 무슨 일을 하나?
---
**persistent task**(`IndexReplicationTask` / `ShardReplicationTask`를 오케스트레이션, 상태를 cluster state에 둬서 재시작을 견딤), **snapshot/restore**(leader를 내부 snapshot repository로 노출해 일회성 bootstrap 복사), **retention lease + soft delete**(leader의 연산 이력을 남겨 follower가 sequence number로 tail하게 함).
:::

:::quiz
**Q2.** leader 인덱스에 `soft_deletes`가 왜 필요하고, retention lease는 실제로 뭘 지키나?
---
tail은 연산을 sequence number로 가져오는 것이라, leader가 그 이력을 계속 갖고 있어야 한다. Lucene은 평소 soft-delete되거나 덮어써진 문서를 merge로 지운다. retention lease는 **retaining seqNo**를 박아, 그 값 이상인 연산이 merge를 거쳐도 살게 한다. follower가 배치를 내구성 있게 적용한 뒤 lease를 앞으로 갱신하고, 그게 leader가 그 밑을 안전하게 잘라내도 된다는 신호다.
:::

:::quiz
**Q3.** 기계적으로, 복제를 12시간 넘게 pause하면 왜 전체 re-bootstrap이 강제되나?
---
pause된 follower는 retention lease 갱신을 멈춘다. lease **기간**(`retention_lease.period`, 약 12h)이 지나면 lease가 만료되고, leader는 follower가 아직 필요로 하던 연산을 garbage-collect한다. follower가 원하는 sequence number가 사라져 증분 재개가 불가능하다. 모든 샤드를 remote snapshot restore하는 전체 복구만 남는다.
:::

:::quiz
**Q4.** `BOOTSTRAPPING` 동안 정확히 무슨 일이 벌어지고, follower 인덱스는 왜 미리 있으면 안 되나?
---
플러그인이 leader를 내부 snapshot repository로 노출하고 평범한 restore recovery를 돌려, leader 각 샤드의 Lucene segment를 follower로 스트리밍해 바이트 일치 복사본을 만든다. 표준 restore 경로라 leader의 설정·매핑으로 follower 인덱스를 **생성**한다. 그래서 같은 이름 인덱스가 이미 있으면 `_start`가 `resource_already_exists`로 실패한다.
:::

:::quiz
**Q5.** 정상 상태에서 reader/writer 루프는 데이터를 어떻게 옮기고, 복제 lag은 어떻게 읽나?
---
reader가 leader 샤드에 **long-poll**을 동시에 건다("내 체크포인트 이후 연산"). 놀 땐 최대 5분쯤 대기하다 받은 연산을 큐에 쌓는다. writer는 큐를 **순서대로** 비워 follower primary에 재생하고(필요하면 leader 매핑을 동기로 fetch), 그 쓰기가 follower 자기 replica로 흐르게 둔 뒤 retention lease를 갱신한다. lag는 `_status`의 `leader_checkpoint − follower_checkpoint`, 즉 sequence number 격차다.
:::

---

## 메모

(조사 메모 — 마이그레이션 노트의 CCR 제한들은 임의가 아니다. soft-delete/retention-lease 만료가 12h 한도와 lag 시 전체 재동기화를 설명하고, snapshot-repo bootstrap이 "follower가 미리 있으면 안 됨"을, 플러그인 write block이 승격에 `_stop`이 필요한 이유를 설명한다.)
