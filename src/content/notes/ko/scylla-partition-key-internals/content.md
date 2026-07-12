---
title: 'Scylla Partition Key 내부 기전 (Token Ring, Replication, Shard 라우팅)'
---

## 레퍼런스

- [Schema — partition & clustering keys](https://docs.scylladb.com/stable/get-started/query-data/schema.html)
- [Ring architecture / tokens](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)
- [Data distribution with tablets](https://docs.scylladb.com/manual/stable/architecture/tablets.html)
- [Making a Shard-Aware Python Driver, Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)
- [Why ScyllaDB's Shard Per Core Architecture Matters](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)
- [Consistency Levels (CQL)](https://docs.scylladb.com/manual/stable/cql/consistency.html)
- [SELECT — TOKEN() on partition key](https://docs.scylladb.com/manual/stable/cql/dml/select.html)
- [Cassandra & Scylla 1탄](/research-notes/ko/notes/cassandra-scylla-intro/) — consistent hashing 입문
- [Shard-per-core 노트](/research-notes/ko/notes/scylla-shard-per-core/) — 코어 shard vs tablet, hot partition
- [클라이언트 베스트 프랙티스](/research-notes/ko/notes/scylla-client-best-practices/) — PK bind가 필요한 이유

---

## 왜 이 글을 찾아봤나

- **계기:** [클라이언트 베스트 프랙티스](/research-notes/ko/notes/scylla-client-best-practices/)·[shard-per-core](/research-notes/ko/notes/scylla-shard-per-core/)를 읽다 보니 partition key 라우팅이 `PK → Murmur3 → token → 노드 → shard` 한 줄로만 나왔다. **해시·ring·replica·coordinator·노드 내 shard**까지 내부 경로를 통째로 알고 싶었다.
- **범위:** 클라이언트·shard-per-core 글에 억지로 넣기보다 **별도 노트**로 분리하기로 했다.

---

## 읽으면서 느낀 점

같은 partition key는 항상 같은 token·replica set·(노드 레이아웃이 같으면) 같은 CPU shard로 간다. hot key는 코어를 늘린다고 해결되는 게 아니라 **모델링** 문제다.

---

## 배운 것

*배경: intro·shard-per-core·클라이언트 노트를 바탕으로, partition key 라우팅 전 경로를 선생님이 설명한다.*

---

### 1막 — CQL에서 partition key (clustering key와 구분)

:::chat student AI 학생
스키마에서 partition key가 정확히 뭐고, clustering key랑 뭐가 달라요?
:::

:::chat teacher 선생님
[Schema 문서](https://docs.scylladb.com/stable/get-started/query-data/schema.html): **primary key**는 두 부분이다.

| 구분 | 역할 | 예 |
|------|------|-----|
| **Partition key** | **어느 노드(들)**에 row 묶음이 가는지 | `user_id` 단독, `(channel_id, bucket)` |
| **Clustering key** (선택) | **한 partition 안** row 정렬 | `message_id`, `created_at` |

```sql
-- 단순 PK
CREATE TABLE users (
  user_id uuid PRIMARY KEY,
  name text
);

-- 복합 PK: order_id = partition key, product_id = clustering
CREATE TABLE orders (
  order_id uuid,
  product_id uuid,
  qty int,
  PRIMARY KEY (order_id, product_id)
);
```

**Partition** = 같은 partition key를 가진 row 전체 — 분산 단위이자 보통 **한 쿼리** 단위(`WHERE`에 PK 컬럼 필요).

**Clustering key**는 **어느 노드**인지는 안 바꾼다. partition **안** 정렬만 한다.
:::

:::chat student AI 학생
partition key 없이 조회할 수 있나요?
:::

:::chat teacher 선생님
프로덕션 쿼리는 **partition key**(복합이면 PK 컬럼 전부)를 넣는 게 원칙이다. 없으면 partition scan — 여러 노드를 돈다.

PK 없이 non-PK 필터·`ALLOW FILTERING`은 anti-pattern([클라이언트 노트](/research-notes/ko/notes/scylla-client-best-practices/)). `TOKEN()` 범위 조회는 ops/디버그용([SELECT](https://docs.scylladb.com/manual/stable/cql/dml/select.html))이지 앱 hot path가 아니다.
:::

---

### 2막 — Murmur3: partition key → token

:::chat student AI 학생
partition key가 token으로 바뀌는 과정은요?
:::

:::chat teacher 선생님
ScyllaDB 기본 **Murmur3** partitioner([ring architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)):

1. **partition key 컬럼 값(들)**을 가져온다 — 복합 PK면 컴포넌트를 **합쳐서** 해시(Cassandra와 동일 규칙).
2. **MurmurHash3** → **64-bit signed integer token**(\(-2^{63}\) … \(2^{63}-1\) 근처; `nodetool ring`에 음수도 보임).
3. 이 token이 ring 위 partition 주소다.

```
PK 값  →  Murmur3Partitioner  →  token  →  ring 위치
```

**드라이버가 PK bind를 요구하는 이유:** 클라이언트가 서버와 **같은** 바이트로 hash해야 한다. PK를 SQL에 리터럴로 박으면 prepare 시점에 token/shard를 못 구한다([Part 1 드라이버 블로그](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/) — routing key = partition key).

**복합 예:** `PRIMARY KEY ((channel_id, time_bucket), message_id)` — token은 **`(channel_id, time_bucket)`만**으로 계산. `message_id`는 clustering이라 ring 배치에 안 쓰인다.
:::

---

### 3막 — Token ring & virtual node (vnode)

:::chat student AI 학생
token이 ring에 올라가면 노드는 어떻게 정해지나요?
:::

:::chat teacher 선생님
클러스터 = **token ring**; 노드마다 token **구간**을 가진다([ring architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/)):

| 개념 | 의미 |
|------|------|
| **Token** | ring 위 숫자 위치; partition 식별 |
| **Token range** | 한 owner가 담당하는 연속 구간 |
| **Vnode** | ring **한 조각**; 물리 노드에 여러 개 붙음 |

Scylla는 **vnode 전용**(`scylla.yaml` `num_tokens`, 기본 **256**/노드). 물리 노드 하나가 **여러 비연속** vnode → 노드 증감 시 예전 one-token-per-node보다 균형이 낫다.

```
        token ring (Murmur3 공간)
   ...───[A vnode]───[B vnode]───[C vnode]───...
              ↑
         PK token이 여기 → B가 그 구간 primary owner
```

**Ring walk:** token에 대해 end token ≥ 내 token인 **첫** vnode 구간(ring wrap 포함)을 찾는다. 그 vnode의 물리 노드가 partition **primary replica**.

**확인:** `nodetool ring`, `nodetool describering <keyspace>`, `nodetool describecluster`(`Murmur3Partitioner` 표시).
:::

---

### 4막 — Replication: RF와 replica set

:::chat student AI 학생
RF=3이면 복제본이 세 개인데, 노드는 어떻게 골라지나요?
:::

:::chat teacher 선생님
**Replication factor (RF)** = partition당 replica 수([1탄](/research-notes/ko/notes/cassandra-scylla-intro/), ring 문서).

**keyspace**에서 설정:

```sql
CREATE KEYSPACE my_ks
  WITH replication = {
    'class': 'NetworkTopologyStrategy',
    'datacenter1': 3
  };
```

| 요소 | 역할 |
|------|------|
| **Replication strategy** | `NetworkTopologyStrategy`(멀티 DC) / `SimpleStrategy`(단일 DC 실험) |
| **DC별 RF** | `datacenter1: 3` → 그 DC 안 replica 3개 |
| **Snitch** | 노드의 rack/DC 정보 → replica **배치** 규칙 |

partition token에 대해 strategy가 ring을 돌며 **RF개 서로 다른 노드**를 고른다(rack-aware 설정 시 rack 분산). 이게 **replica set**이다.

**RF=2**(ring 문서): 각 노드가 predecessor·successor 쪽 range를 하나씩 더 가진다 — 노드 하나 죽어도 다른 복제본 남음.

**멀티 DC:** DC마다 replica가 따로 잡힌다 — 프로덕션에서 매 쿼리 `QUORUM` 대신 **`LOCAL_*` CL** 쓰는 이유([클라이언트 노트](/research-notes/ko/notes/scylla-client-best-practices/)).
:::

---

### 5막 — Coordinator와 read/write 경로

:::chat student AI 학생
replica set을 알면 coordinator는 뭘 하나요?
:::

:::chat teacher 선생님
아무 노드나 coordinator가 될 수 있다([Part 1 블로그](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/)):

```
클라이언트
  → contact 노드 선택(또는 token-aware: replica 중 하나)
  → coordinator가 token/replica set 계산
  → CL에 맞게 replica에 read/write
  → 응답 합쳐서 클라이언트로
```

| 역할 | 동작 |
|------|------|
| **Coordinator** | 클라이언트 요청을 **처음** 받는 노드 |
| **Replica** | partition 데이터를 실제로 갖는 노드 |
| **Token-aware 드라이버** | **replica**를 coordinator로 → 내부 hop 1번 절약 |
| **비 token-aware** | 아무 노드가 받아 replica에 포워딩 |

**쓰기(단순화, LOCAL_QUORUM, RF=3):** coordinator가 로컬 DC replica에 쓰고 quorum ack.

**읽기(LOCAL_QUORUM):** 로컬 replica에서 quorum만큼 응답; digest 불일치 시 **read repair**([shard-per-core](/research-notes/ko/notes/scylla-shard-per-core/)).

**CL**은 **몇 개** replica가 응답할지 정한다 — **어느** token이 owner인지는 PK/hash가 정한다([CL](https://docs.scylladb.com/manual/stable/cql/consistency.html)).
:::

---

### 6막 — 노드 안: token → CPU shard

:::chat student AI 학생
맞는 노드까지 왔으면 CPU shard는 어떻게 정해지나요?
:::

:::chat teacher 선생님
Scylla는 Cassandra보다 **한 단계 더** 들어간다([Part 1](https://www.scylladb.com/2020/10/13/making-a-shard-aware-python-driver-for-scylla-part-1/), [shard-per-core 블로그](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)):

```
노드 위 token  →  노드 token 공간을 쪼갬  →  CPU shard 하나에 귀속
```

알고리즘(블로그):

1. 노드 전체 token range를 **2^n**등분(`n` 기본 **12**).
2. 각 조각을 **S**개로 다시 나눔(S = shard 수, `--smp`).
3. token이 속한 sub-piece의 **shard**(전용 코어 + memtable + SSTable)가 partition owner.

| 경로 | 결과 |
|------|------|
| **Shard-aware 드라이버** | PK hash → **노드 + shard_id** → shard connection 직송 |
| **Token-aware만** | 노드는 맞지만 노드 **안 cross-shard** 포워딩 가능 |
| **둘 다 아님** | 엉뚱한 노드 + cross-shard |

**Hot partition:** PK 하나 → token 하나 → replica 노드마다 **shard 하나**. 코어를 늘리면 **다른** 키 range는 재분배되지만 **그 hot PK는 한 코어에 고정**([shard-per-core](/research-notes/ko/notes/scylla-shard-per-core/) — `time_bucket`, salt 등으로 풀기).
:::

---

### 7막 — Tablets (6.0+): partition → tablet → replica

:::chat student AI 학생
tablet은 vnode 위에 또 얹는 건가요?
:::

:::chat teacher 선생님
**Tablet**은 Scylla의 새 데이터 분산 단위([tablets](https://docs.scylladb.com/manual/stable/architecture/tablets.html)) — 신규 keyspace 기본 on:

| | Legacy (vnode) | Tablets (6.0+) |
|---|----------------|----------------|
| 매핑 | Partition → token → vnode → 노드 | Partition → **tablet**(결정적) → 노드에 replica |
| split/merge | 노드 증감 시 vnode range 이동 | tablet **split/merge**(~5GB 목표); LB가 노드·**shard** 간 이동 |
| scale-out cleanup | vnode KS에서 `nodetool cleanup` | tablet 단위 자동; 가벼움 |

tablet 켜진 스택:

```
partition key  →  Murmur3 token  →  tablet ID  →  replica 노드들  →  각 노드의 shard
```

tablet은 **더 잘게·자동으로** rebalance하지만, **partition key → 어느 tablet**인지는 여전히 결정적이고 **hot PK는 tablet 하나**에 몰린다(그다음 replica마다 shard 하나). 모델링 규칙은 같다.

keyspace 모드는 `CREATE KEYSPACE` 때 `tablets = {'enabled': true|false}` — 나중에 `ALTER`로 바꿀 수 없다. `nodetool ring`은 vnode KS에 익숙하고, tablet KS는 백그라운드 migration이 돈다.
:::

---

### 7막 보충 — Hot partition & 거대 partition

:::chat gon Gon
hot partition이 뭐예요?
:::

:::chat teacher 선생님
**Hot partition**은 **partition key 하나**에 읽기/쓰기가 클러스터 나머지보다 훨씬 몰린 상태다.

라우팅은 고정이다:

```
같은 PK  →  같은 token  →  같은 replica set  →  replica마다 같은 CPU shard
```

| 증상 | 이유 |
|------|------|
| 노드·**코어 하나**만 바쁨 | 그 PK는 항상 **shard 하나**만 담당 |
| `--smp` 늘려도 안 풀림 | **다른** 키 range만 움직이고, 이 PK는 그대로 |
| p99 튐 | QPS가 코어 하나에 쌓임 |

**Hot ≠ 거대(giant):** hot은 **트래픽**(QPS) 편중, giant는 PK 하나에 **데이터 양**(GB·row 수)이 과한 것. 겹칠 수는 있어도 문제는 다르다.

**해결은 모델링**이다. 하드웨어가 아니다. PK에 `time_bucket` 넣기([use case](/research-notes/ko/notes/scylla-use-cases/) — Discord), salt, 접근 패턴을 나눠 **여러** partition·token으로 흩뿌리기.
:::

:::chat gon Gon
partition이 너무 커서 shard 크기를 넘으면 어떻게 되나요?
:::

:::chat teacher 선생님
먼저 이름 세 개를 구분하자([shard-per-core](/research-notes/ko/notes/scylla-shard-per-core/)):

| 용어 | 의미 |
|------|------|
| **CQL partition** | PK가 같은 row 묶음 — 스키마가 허용하면 **끝없이** 커질 수 있음 |
| **Core shard** | CPU 코어 하나의 token **구간** — ops가 GB로 정하는 단위가 아님 |
| **Tablet** (~5GB 목표) | 테이블 분산 단위 — PK → tablet 매핑은 여전히 **결정적·하나** |

**자동 spill은 없다.** PK 하나 → token 하나 → replica마다 **shard 하나**. partition이 커져도 shard 여러 개로 쪼개지지 않는다.

실제로 일어나는 일:

| 현상 | 설명 |
|------|------|
| **shard 병목** | 그 PK read/write가 코어 하나에만 몰림 |
| **무거운 읽기** | unpaged면 **partition 통째** 로드 — 메모리·네트워크 부담([클라이언트](/research-notes/ko/notes/scylla-client-best-practices/)) |
| **compaction·repair 비용** | 한 덩어리가 크면 그 shard 백그라운드 작업도 무거움 |
| **모니터링 경고** | `system.large_partitions`, `system.large_rows`; `nodetool tablestats` |

tablet **split/merge**는 tablet을 노드·shard 사이로 옮기는 것이지, **논리 PK 하나를 shard 여러 개로 쪼개지는 않는다.** 비대한 PK는 **tablet 하나** → **shard 하나**만 비대해진다.

**예방(hot key와 같음):**

- PK bucket: `(user_id, daily_bucket)`, `(channel_id, time_bucket)`
- **collection**에 무한 append 금지 — clustering row로([use case 보충](/research-notes/ko/notes/scylla-use-cases/))
- 대량 읽기는 **paging**
- 실부하 전에 large-partition 지표 확인
:::

---

### 전체 파이프라인 (치트시트)

```
CQL row
  PRIMARY KEY: (partition key cols) + optional clustering cols
       ↓
  Murmur3Partitioner(partition key values) → 64-bit token
       ↓
  Ring / tablet map → primary owner + replica set (RF, strategy, snitch)
       ↓
  Coordinator (가능하면 token-aware로 replica)
       ↓
  각 replica 노드: token → CPU shard (2^n × S 분할)
       ↓
  해당 shard의 memtable / SSTable
```

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** `PRIMARY KEY ((channel_id, time_bucket), message_id)`에서 Murmur3 token은 어떤 컬럼으로 계산되나?
---
**`(channel_id, time_bucket)`** partition key만. **`message_id`**는 clustering — partition 안 정렬만, ring 배치는 안 바꿈.
:::

:::quiz
**Q2.** NetworkTopologyStrategy `datacenter1: 3`, RF=3일 때 LOCAL_QUORUM 읽기는?
---
그 partition token에 **datacenter1 안 replica 3개**가 있다. **LOCAL_QUORUM**은 **그 로컬** replica 과반(3 중 2) — cross-DC 아님.
:::

:::quiz
**Q3.** 같은 partition key가 항상 같은 CPU shard로 가는 이유?
---
PK → Murmur3 token(결정적) → 노드 token 공간의 2^n×S 분할에서 **한** 구간 → **한** shard. topology/resharding 전까지 고정.
:::

:::quiz
**Q4.** vnode(`num_tokens` 기본 256)가 one-token-per-node와 다른 점?
---
물리 노드가 **여러 작은 비연속** ring 구간을 가짐 → 데이터·쿼리 분산이 고르고, 노드 증감 시 **rebalance가 빠름**.
:::

:::quiz
**Q5.** token-aware vs shard-aware — token-aware만 쓰면 남는 비용?
---
**Token-aware**는 **노드**(replica coordinator)까지 맞춤. **shard-aware** 없으면 노드 **안에서 shard 간** 포워딩. shard-aware는 **shard connection**으로 owning core에 직송.
:::

:::quiz
**Q6.** hot partition — `--smp` 코어만 2배로 늘리면 왜 PK 하나는 안 풀리나?
---
그 PK는 여전히 **token 하나** → **tablet/vnode 한 조각** → replica마다 **shard 하나**. 코어 추가는 **다른** partition을 재분배할 뿐, hot key는 **모델 변경**(bucket, salt) 전까지 한 코어에 남는다.
:::

## 메모

PK 라우팅 전 경로 — 클라이언트·shard-per-core 한 줄 설명에서 분리. 다음: **nodetool repair** 운영.
