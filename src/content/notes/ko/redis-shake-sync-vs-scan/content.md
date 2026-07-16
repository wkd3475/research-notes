---
title: 'redis-shake sync_reader vs scan_reader'
---

## 레퍼런스

- [Migration Mode Selection (RedisShake)](https://tair-opensource.github.io/RedisShake/en/guide/mode.html)
- [Sync Reader](https://tair-opensource.github.io/RedisShake/en/reader/sync_reader.html)
- [Scan Reader](https://tair-opensource.github.io/RedisShake/en/reader/scan_reader.html)
- [RedisShake README — limitations](https://github.com/tair-opensource/RedisShake)
- [ElastiCache — supported and restricted commands](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html)
- [Redis keyspace notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/)
- [SCAN command — guarantees](https://redis.io/docs/latest/commands/scan/)
- 부모: [ElastiCache Global Datastore vs redis-shake](/research-notes/ko/notes/elasticache-global-datastore-vs-redis-shake/)

---

## 왜 이 글을 찾아봤나

[Global Datastore vs redis-shake](/research-notes/ko/notes/elasticache-global-datastore-vs-redis-shake/) 이어서: PSync가 안 되는 매니지드 Redis에서 **SCAN + KSN**이 **replica식 sync**와 어떻게 다른지.

---

## 읽으면서 느낀 점

그 차이만 보면 된다. 일관성·소스 부하가 어디서 깨지는지만 표로 잡아도 충분하다.

---

## 배운 것

*부모 노트에서 이미 말했다. PSync면 `sync_reader`, 없으면 `scan_reader`. 이 글은 **메커니즘** — RDB+AOF 복제 스트림 vs SCAN+DUMP/RESTORE+pubsub, 그리고 매니지드 Redis 탈출구(특히 ElastiCache `aws_psync`).*

---

### Act 1 — 모드 고르기 (운영 먼저)

:::chat student AI 학생
RedisShake 문서는 언제 어떤 reader를 고르라고 해?
:::

:::chat teacher 선생님
모드 세 개가 reader 세 개에 대응한다 (`mode` 가이드):

| 모드 | Reader | 이럴 때 |
|------|--------|---------|
| **PSync** | `sync_reader` | 소스가 PSync를 말하면 **마이그레이션 기본값** |
| **SCAN** | `scan_reader` | 클라우드·엔진이 **PSync를 막거나**, 약한 일관성·높은 소스 부하를 감수할 때 |
| **RDB** | `rdb_reader` | **백업 파일**에서 복원 (오프라인 경로) |

문서 경고도 있다. RedisShake는 **장기 sync 제품이 아니다**. 끊긴 뒤 PSync 재연결은 믿을 만하지 않고, 4.x는 **체크포인트가 없으며** 토폴로지가 바뀌면 panic한다. “영구 sync”에 `scan_reader`를 쓴다면, 쓰기량이 작고 대형 키가 드물 때만 가용성을 낮게 잡고 타협하는 수준이다.
:::

:::chat gon Gon
PSync가 안 되는 매니지드 Redis에서 SCAN+KSN이 replica식 sync랑 어떻게 달라?
:::

:::chat teacher 선생님
**진실이 흘러오는 통로**가 다르다.

| | **`sync_reader` (replica식)** | **`scan_reader` (SCAN + 선택적 KSN)** |
|---|--------------------------------|----------------------------------------|
| **붙는 방식** | PSync로 **Slave인 척** | 일반 클라이언트: 키 **SCAN** + **DUMP**/**RESTORE**; 키 이벤트는 선택적 **pubsub** |
| **풀 싱크** | Master가 **RDB** 스냅샷을 보냄 | 키스페이스를 커서로 돌며 DUMP → 타깃 RESTORE |
| **증분** | Master의 **AOF / 복제 스트림** (일어난 명령 그대로) | **KSN**: `psubscribe __keyevent@*__:*` → 이벤트면 그 키를 다시 DUMP → RESTORE |
| **일관성** | 문서상 최선 — 스트림이 master 복제 피드 | 약함 — SCAN 누락/과복사, KSN은 fire-and-forget Pub/Sub, FLUSH\* 안 보임 |
| **소스 부하** | 복제 경로 (엔진에 따라 fork·메모리 트레이드오프) | **DUMP가 CPU를 많이 먹음**; 문서 예: write QPS ~15만에서 CPU ~47% → Shake 켜면 ~91% |

SCAN+KSN은 “명령만 다른 PSync”가 아니다. master의 **순서 있는 쓰기 스트림**을 먹는 대신, 나중에 **값을 다시 읽어** 맞춘다.
:::

---

### Act 2 — sync_reader 자세히

:::chat student AI 학생
sync_reader 파이프라인 걸어줘.
:::

:::chat teacher 선생님
Sync Reader 페이지 기준:

1. Shake가 Master에 **복제 연결**(Slave 역할)을 연다.
2. **풀:** Master가 **RDB**를 보내고, Shake는 디스크에 받은 뒤 Redis 명령으로 파싱해 목적지에 쓴다.
3. **증분:** Master가 **AOF식 복제 스트림**을 이어 보내고, Shake가 그 명령을 넘긴다.

설정 손잡이:

```toml
[sync_reader]
cluster = false
address = "127.0.0.1:6379"
username = ""
password = ""
tls = false
sync_rdb = true   # false → 풀 싱크 건너뜀
sync_aof = true   # false → 풀 끝나면 종료 (증분 없음)
```

문서가 말하는 이점: SCAN/DUMP보다 **일관성 좋고**, **소스 영향이 작으며**, 컷오버가 매끄럽다(“seamless switching”).

**Cluster:** `cluster = true` — Shake가 `cluster nodes`로 샤드에 붙는다.  
**Sentinel:** Sentinel 설정으로 master를 찾을 수 있다. Sync를 Sentinel이 관리하는 **master**에 바로 붙이면 Sentinel이 Shake를 Slave로 볼 수 있어, 이런 경우 소스를 **replica**로 잡으라고 한다.
:::

:::chat student AI 학생
ElastiCache에서 sync_reader가 왜 특별해?
:::

:::chat teacher 선생님
ElastiCache는 매니지드 경험 때문에 `psync` / `sync` / `replicaof` 등을 **제한**한다 (restricted commands 목록). 그래서 sync_reader를 그냥 돌리면 unknown command로 죽는다.

RedisShake 클라우드 가이드의 **ElastiCache**:

1. 그래도 **`sync_reader`를 우선**한다.
2. **지원 티켓**으로 PSync 개통을 요청한다.
3. AWS가 **이름만 바뀐** PSync 명령을 준다 (문서 예: `xhma21yfkssync`, `nmfu2bl5osync`) — 의미는 같고 이름만 다르다.
4. advanced 설정의 `aws_psync`에 넣는다:
   - 단일: `ip:port@cmd`
   - 클러스터: 샤드 **전부** `ip:port@cmd`, 쉼표로 이음

티켓이 어렵거나 막히면 → **`scan_reader`**, 소스 부하를 감수한다.

**MemoryDB:** 문서상 **PSync 권한 없음** → `scan_reader` / `rdb_reader`만.

**왜 벤더가 PSync를 막나 (`mode` 가이드):** fork, 프록시 구조에서 복제 프로토콜 불가, 보안, 클라우드 이탈 마이그레이션을 어렵게 하려는 정책.
:::

---

### Act 3 — scan_reader: SCAN 단계 + KSN 단계

:::chat student AI 학생
scan_reader는 데이터를 어떻게 옮겨?
:::

:::chat teacher 선생님
단계 둘 (Scan Reader 문서). 맨 위 TIP: **성능·일관성 모두 sync_reader보다 못하니, 가능하면 sync를 써라.**

### SCAN 단계 (풀) — 기본 on (`scan = true`)

1. `SCAN`으로 키를 돈다 (커서 기반; 진행률 %는 **대략**, Redis가 아닌 엔진에선 더 이상할 수 있음).
2. 키마다 `DUMP` → 목적지에 `RESTORE`.

Redis **SCAN 보장** (공식 SCAN + Shake 메모):

- 이터레이션 **내내 있던** 키는 **최소 한 번** 나온다.
- 도중에 **생긴** 키는 **빠질 수 있다**.
- 도중에 **지운** 키도 이미 복사됐을 수 있다 (타깃에 오래된 값).

그래서 SCAN만으로 하는 풀 싱크는 깨끗한 스냅샷이 아니다.

### KSN 단계 (증분) — **기본 off** (`ksn = false`)

SCAN 중 놓치거나 바뀐 키를 잡으려면 켠다. 타이밍이 중요하다. KSN은 SCAN이 **끝난 뒤**가 아니라 **같이** 돌고, SCAN이 끝난 뒤에도 Shake가 종료될 때까지 이어진다.

메커니즘:

1. 소스에서 `notify-keyspace-events`에 **`AE`**가 들어가게 켠다 (Redis 기본값은 **꺼짐**).
2. Shake가 `__keyevent@*__:*`를 `psubscribe`한다.
3. 이벤트마다 소스에서 그 키 DUMP → 타깃 RESTORE.

| KSN 함정 | 왜 아픈가 |
|----------|-----------|
| Pub/Sub은 **fire-and-forget** | 끊기면 **이벤트 유실** (Redis keyspace 문서) |
| 소스가 subscriber를 끊으면 `client-output-buffer-limit pubsub`를 올려 보라 | 버퍼 오버플로로 연결이 죽는다 |
| **`FLUSHALL` / `FLUSHDB` 이벤트 없음** | 타깃에 찌꺼기가 남을 수 있음 — 마이그레이션 중 금지 |
| 클러스터: keyspace 이벤트는 **노드 로컬** | **각** 노드에 구독 필요 (Shake `cluster = true`) |
| 바뀔 때마다 DUMP | 쓰기 트래픽이 이어지면 소스 **CPU**도 이어짐 |

설정:

```toml
[scan_reader]
cluster = false
address = "127.0.0.1:6379"
dbs = []          # non-cluster: DB 필터 예 [1,5,7]
scan = true
ksn = false       # 증분이면 true
count = 1         # SCAN 한 번에 가져올 키 수; 1부터 올려라
```

`count`를 키우면 풀 싱크는 빨라지지만 소스 부하는 **커진다**. 문서는 **1**에서 시작하라고 한다.
:::

:::chat student AI 학생
CPU·운영 경고를 숫자로 줘.
:::

:::chat teacher 선생님
Scan Reader “Performance Impact”: 두 단계 모두 **DUMP**(CPU 집약). 문서 참고치 — 소스 write QPS ≈ **150,000**, Shake 없이 CPU ≈ **47%** → Shake 켜면 ≈ **91%**. KSN은 **스로틀 손잡이가 없다**. 쓰기량을 보고 켤지 정한다. SCAN은 그래도 `count`로 조절한다.
:::

---

### Act 4 — 나란히 놓고 고르기

:::chat student AI 학생
매니지드 Redis에서 고를 치트시트 줘.
:::

:::chat teacher 선생님
| 질문 | **`sync_reader`** 쪽 | **`scan_reader`** 쪽 |
|------|----------------------|----------------------|
| 진짜 PSync (또는 ElastiCache renamed + `aws_psync`)? | 예 | — |
| MemoryDB / 프록시 / 벤더가 복제 차단? | — | 예 |
| 컷오버에 일관성 최우선? | 예 | KSN 구멍 + FLUSH\* 리스크를 받아들일 때만 |
| 소스 CPU 여유 없고 write QPS 높음? | sync 우선 | 위험 — DUMP 세금 |
| ElastiCache PSync 티켓 가능? | 그걸 먼저 | 폴백 |
| 오프라인 RDB 파일만? | — | **`rdb_reader`**, scan 아님 |

부모 노트 모델을 조금 더 날카롭게 잡으면 이렇다.  
`sync_reader` ≈ **복제 버스**에 탭.  
`scan_reader` ≈ 키스페이스를 **폴링 + 알림 + 다시 DUMP** — 쓸 수 있는 탈출구이지, replica sync의 동급이 아니다.
:::

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** PSync가 있을 때 RedisShake 문서가 `sync_reader`를 미는 이유는?
---
가짜 Slave로 master의 **RDB + 복제(AOF) 스트림**을 먹는다. SCAN/DUMP보다 일관성이 좋고 소스 영향도 작다. `scan_reader`는 두 축 모두 못하고, PSync가 막혔을 때 폴백이다.
:::

:::quiz
**Q2.** SCAN+KSN이 replica식 증분 sync와 다른 점은?
---
replica식은 순서 있는 **쓰기 스트림**을 넘긴다. SCAN+KSN은 키를 **다시 읽는다**: 풀은 SCAN/DUMP/RESTORE, 증분은 keyspace 이벤트 뒤 다시 DUMP/RESTORE. Pub/Sub은 이벤트를 잃을 수 있고, SCAN은 새 키를 놓칠 수 있으며, FLUSHALL/FLUSHDB는 KSN 이벤트가 없다.
:::

:::quiz
**Q3.** `ksn = true` 전에 소스에 뭐가 있어야 하나?
---
`notify-keyspace-events`에 **`AE`**가 들어가야 한다 (기본 off). 그다음 Shake가 `__keyevent@*__:*`를 `psubscribe`한다. FLUSHALL/FLUSHDB는 피하고, subscriber가 끊기면 `client-output-buffer-limit pubsub`를 올려 보라.
:::

:::quiz
**Q4.** ElastiCache가 `psync`를 막을 때, scan으로 가기 전 선호 경로는?
---
지원 티켓으로 PSync를 열고, AWS가 준 **renamed** PSync를 `aws_psync`에 `ip:port@cmd`로 넣는다 (클러스터면 샤드 전부). 그게 안 되면 `scan_reader` — 소스에 DUMP CPU 부하를 각오한다.
:::

:::quiz
**Q5.** `ksn` 기본값이 **false**인 이유, SCAN 대비 언제 도나?
---
KSN은 계속 DUMP를 돌리고 Pub/Sub이 깨지기 쉬워 opt-in이다. 켜면 SCAN과 **동시에** 돌며 (스캔 중 변경을 잡고), SCAN이 끝난 뒤에도 Shake가 끝날 때까지 이어진다.
:::

---

## 메모

—
