---
title: 'Cassandra & Scylla — 2탄: 부팅 시 클러스터 조인'
---

## 레퍼런스

- [ScyllaDB Seed Nodes](https://docs.scylladb.com/manual/stable/kb/seed-nodes.html)
- [Adding a New Node Into an Existing ScyllaDB Cluster](https://docs.scylladb.com/manual/branch-2025.4/operating-scylla/procedures/cluster-management/add-node-to-cluster.html)
- [Configuration Parameters (ScyllaDB)](https://docs.scylladb.com/manual/stable/reference/configuration-parameters.html)
- [ScyllaDB Ring Architecture](https://docs.scylladb.com/manual/stable/architecture/ringarchitecture/index.html)
- [Token (ScyllaDB GitHub Wiki)](https://github.com/scylladb/scylladb/wiki/Token)
- [Internode communications (gossip)](https://docs.datastax.com/en/cassandra-oss/3.x/cassandra/architecture/archGossipAbout.html)
- [Adding nodes to an existing cluster (DataStax)](https://docs.datastax.com/en/cassandra-oss/3.x/cassandra/operations/opsAddNodeToCluster.html)
- [Adding, replacing, moving and removing nodes (Apache Cassandra 5.x)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)

---

## 왜 이 글을 찾아봤나

1탄 이어서다. 회사에서 Scylla를 올리는데, 노드를 띄울 때 클러스터 발견과 token 할당이 어떻게 되는지 알아야 한다.

---

## 읽으면서 느낀 점

역할 놀이 Q&A로 정리해 달라고 했다. 평문 요약보다 기억에 남을 것 같다.

---

## 배운 것

*배경: 시니어 엔지니어가 주니어에게 기존 Scylla/Cassandra 클러스터에 새 노드를 붙이는 과정을 설명한다.*

---

### 1막 — 새 노드가 깨어날 때

:::chat student 학생
`scylla.yaml` 맞춰 두고 `systemctl start scylla-server` 쳤어요. 맨 처음에 뭐부터 하나요?
:::

:::chat teacher 선생님
**seed 노드**부터 붙는다. `seeds`(Cassandra는 `seed_provider`)에 적어 둔 IP다. 리더도, 쓰기 조율자도, 데이터 담당 특별 노드도 아니다. **아직 링을 모를 때 gossip을 걸 첫 접점**일 뿐이다.
:::

:::chat student 학생
seed가 전부 죽으면 끝장인가요?
:::

:::chat teacher 선생님
**처음 조인하는 노드**는 맞다. gossip을 못 건다. **이미 클러스터에 있던 노드**는 다르다. 기본적으로 예전에 gossip한 peer를 기억해서 seed 없이도 다시 붙을 수 있다. seed는 **첫 기동**에서 특히 중요하다.
:::

:::chat student 학생
조인하는 노드를 seed에 넣으면?
:::

:::chat teacher 선생님
**안 된다.** 문서에도 나온다. **seed 노드는 bootstrap을 할 수 없다.** 살아 있는 기존 노드만 `seeds`에 넣고, 조인 중인 노드 자신은 넣지 않는다. 모든 노드를 seed로 만들지도 말자. gossip 부담만 늘고 이득은 없다. **DC당 seed 2~3개**, **모든 노드가 같은 목록**을 쓰는 게 원칙이다.
:::

:::chat student 학생
멀티 DC면요?
:::

:::chat teacher 선생님
**DC마다 seed를 최소 하나** 넣어라. replication group 단위다. 없으면 다른 DC에만 의존해서 토폴로지를 배워야 해서 느리고 불안하다.
:::

| seed 오해 | 실제 |
|-----------|------|
| "seed가 쓰기를 조율한다" | 아니다. peer는 동등하다 |
| "seed가 SPOF다" | 아니다. 부트스트랩 보조일 뿐 |
| "seed 많을수록 안전" | 아니다. DC별로 소수·안정 노드가 맞다 |

---

### 2막 — Gossip으로 링을 배울 때

:::chat student 학생
seed에 닿았어요. 그다음은?
:::

:::chat teacher 선생님
**Gossip**이 돈다. P2P 전염(에피데믹) 방식이다. 대략 1초마다 노드가 peer 몇 개(최대 ~3)와 상태를 바꾸고, 버전이 높은 정보가 이긴다. 조인 노드가 배우는 것:

- 클러스터에 누가 있는지(IP)
- 누가 up/down인지
- **각 노드의 token** (`application_state::TOKENS`)
:::

:::chat student 학생
discovery가 한 번이면 끝인가요?
:::

:::chat teacher 선생님
아니다. seed가 **첫 스냅샷**을 주고, 이후엔 다른 노드와 똑같이 gossip에 참여한다. 결국 모든 노드가 모든 노드를 안다.
:::

:::chat student 학생
seed 목록을 노드마다 다르게 쓰면?
:::

:::chat teacher 선생님
gossip이 갈라지거나 split-brain 위험이 생긴다. **첫 부팅**에서 특히 치명적이다. 이후엔 기억한 peer가 도와주지만, 운영에서는 여전히 **동일한 seed 목록**을 표준으로 맞춘다.

**포트:** internode gossip 기본 **TCP 7000**(SSL이면 7001). seed만이 아니라 **모든 노드끼리 양방향** 통신이 되어야 한다.
:::

---

### 3막 — Token 할당 (제일 궁금했던 부분)

:::chat student 학생
1탄에서 vnode면 `initial_token` 수동이 필요 없다고 했는데, 실제로 token은 어떻게 정해지나요?
:::

:::chat teacher 선생님
설정의 `num_tokens`를 읽는다(Scylla/Cassandra 기본 **256**). bootstrap 때 순서는 이렇다.

1. gossip으로 **기존 token**을 안다
2. Murmur3 링(`-2^63 … 2^63-1`)에서 `num_tokens`개 **무작위** 값을 고른다
3. 이미 쓰인 token은 **건너뛴다**

중앙 할당자는 없다. 노드가 각자 고르지만, 잘게 많이 자르면 구간 크기가 비슷해져서 부하가 고르게 간다.
:::

:::chat student 학생
더 센 머신에 데이터를 더 실으려면?
:::

:::chat teacher 선생님
token 수를 늘린다. 작은 노드 256, 큰 노드 512처럼. `num_tokens`가 하드웨어 비례 조절기다.
:::

:::chat student 학생
두 노드가 같은 token을 고르면?
:::

:::chat teacher 선생님
조인할 때 기존 token을 먼저 보고 중복은 스킵한다.
:::

:::chat student 학생
무작위 말고 더 똑똑한 방법은?
:::

:::chat teacher 선생님
Cassandra **3.0+**에서 JVM 옵션 `-Dcassandra.allocate_tokens_for_keyspace=<keyspace>` — 그 keyspace의 기존 vnode **부하**를 보고 token을 고른다. token 수를 줄여도 균형이 나을 수 있다. 기본은 여전히 무작위다.
:::

:::chat student 학생
`initial_token`은 언제 쓰나요?
:::

:::chat teacher 선생님
`cassandra.yaml`에 쉼표로 나열하면 자동 할당을 건너뛴다. 외부 도구로 token을 짜거나, **예전 token으로 노드를 복구**할 때다. Scylla는 실무에서 **vnode 전용**이고, 레거시 single-token에서만 `initial_token`이 `num_tokens`를 덮어쓴다.

**token 구간 (짧게):** token 값은 구간의 **끝**이다. 노드 X는 링에서 **(앞 노드 token, X의 token]**을 담당한다.
:::

---

### 4막 — Bootstrap streaming: 선반 채우기

:::chat student 학생
token 잡았으면 바로 트래픽 받나요?
:::

:::chat teacher 선생님
아직이다. **Bootstrap**은 사람들이 한 덩어리로 부르지만 두 단계다.

| 단계 | 내용 |
|------|------|
| **Ring join** | token 배정, 링 진입 |
| **Bootstrap streaming** | 맡은 구간 SSTable 복사 |

streaming이 끝나기 전까지 `nodetool status`는 **UJ (Up Joining)**이다.
:::

:::chat student 학생
데이터는 어디서 오나요?
:::

:::chat teacher 선생님
새 구간마다 **현재 replica**에서 stream한다. 기본은 구간별 **primary replica** — 클러스터 상태와 일관되게 맞추려는 선택이다. 필요한 replica가 down이면 bootstrap이 **실패**한다. `-Dcassandra.consistent.rangemovement=false`로 우회할 수 있지만 데이터가 빠질 수 있어서 위험하다.
:::

:::chat student 학생
진행은 어떻게 보나요?
:::

:::chat teacher 선생님

```bash
nodetool status    # UJ → UN
nodetool netstats  # Mode: JOINING, 소스별 %·용량
```

Scylla vnode 장점: stream을 **여러 노드에서 병렬**로 받을 수 있어(옛 one-token-per-node보다) rebuild/bootstrap이 빨라질 수 있다.
:::

:::chat student 학생
중간에 죽으면 처음부터?
:::

:::chat teacher 선생님
Cassandra **2.2+**는 `nodetool bootstrap resume`, 또는 **재시작**만으로 이어지는 경우가 많다. 완전 초기화는 `-Dcassandra.reset_bootstrap_progress=true`. 그보다 낮은 버전은 데이터를 지우고 다시 bootstrap한다.
:::

:::chat student 학생
streaming 자체를 건너뛸 수 있나요?
:::

:::chat teacher 선생님
`auto_bootstrap: false`면 데이터 복사 없이 링에만 들어간다. **백업 복구**, **새 DC**처럼 데이터를 다른 경로로 넣을 때다. 기본값은 `true`(yaml에 안 보여도 켜져 있음). 일반 scale-out에서 함부로 끄지 말 것.
:::

---

### 5막 — UN 됐다. 그런데 cleanup 함정

:::chat student 학생
`nodetool status`가 **UN**이면 끝인가요?
:::

:::chat teacher 선생님
거의 다 왔다. **기존 노드 전부에 `nodetool cleanup`**을 돌려라. 새 노드에는 하지 않는다. 구간이 옮겨가도 Cassandra/Scylla는 **더 이상 안 가진 데이터를 자동 삭제하지 않는다** — 안전장치다. cleanup 안 하면 디스크 부담에 남고, 나중에 꼬일 수 있다.
:::

:::chat student 학생
cleanup 부담이 큰데 미뤄도 되나요?
:::

:::chat teacher 선생님
**한가한 시간**으로 미룰 수는 있다. 다만 **decommission/removal 전에** 끝내야 한다. 안 그러면 **data resurrection** 위험이 있다. 노드를 여러 대 추가할 때 팁:

1. 전부 추가한 뒤, **마지막으로 추가한 노드 빼고** cleanup
2. cleanup은 **한 노드씩**
3. cleanup 성공 전에 decommission 금지
:::

:::chat student 학생
시작 전에 확인할 것은?
:::

:::chat teacher 선생님
Scylla add-node 절차 기준:

- **기존 노드 중 하나라도 down이면 추가 불가** — 먼저 복구
- **Scylla/Cassandra 버전 동일**(패치까지)
- 살아 있는 노드에서 복사: `cluster_name`, `seeds`, `endpoint_snitch`, `authenticator`
- `listen_address`, `rpc_address`, snitch/rack 맞추기
- 하드웨어 동일하면 `io.conf` / `io_properties.yaml` 복사. 클론이면 `scylla_io_setup` 생략 가능
- yaml 맞출 때까지 **기동하지 말 것**(Debian 자동 시작이면 끄기)
:::

---

### 6막 — 상태, 플래그, 발목 잡는 실수

**노드 상태 (`nodetool status`)**

| 상태 | 의미 |
|------|------|
| **UJ** | Up Joining — streaming 중 |
| **UN** | Up Normal — 서비스 중 |
| **DN** | Down |
| LEAVING / MOVING | decommission / token 이동 중 |

**흔한 실수**

| 실수 | 증상 |
|------|------|
| 신규 노드를 seed에 등록 | bootstrap 진행 안 됨 |
| `cluster_name` 불일치 | 링 조인 실패 |
| 여러 노드 동시 bootstrap | 부하 급증, 진행 불균형 |
| 같은 IP 교체 후 repair 없음 | 쓰기 누락 가능(다음 노트의 replace) |

**관련 JVM 플래그 (Cassandra)**

| 플래그 | 용도 |
|------|------|
| `-Dcassandra.allocate_tokens_for_keyspace=...` | 부하 기반 token 선택 |
| `-Dcassandra.consistent.rangemovement=false` | replica down인데도 bootstrap(위험) |
| `-Dcassandra.reset_bootstrap_progress=true` | bootstrap 체크포인트 초기화 |
| `-Dcassandra.replace_address_first_boot=<ip>` | **죽은 노드 교체** — 별도 경로(다음 노트) |

---

### 한눈에 보는 파이프라인

```
기동 → seeds 접속 → gossip(토폴로지 + token)
     → num_tokens개 무작위 token(사용 중인 값 스킵)
     → primary replica에서 SSTable stream
     → UN → 기존 노드 cleanup
```

### 신규 조인 노드 설정 요약

| 설정 | 규칙 |
|------|------|
| `cluster_name` | 클러스터와 동일 |
| `seeds` | 기존 노드만. DC당 2~3개 |
| `endpoint_snitch` | 동일 |
| `num_tokens` | 보통 256. 하드웨어에 맞게 |
| `auto_bootstrap` | 일반 scale-out은 true(기본) |
| `listen_address` / `broadcast_address` | 모든 peer가 도달 가능 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** seed 노드의 특별한 역할은 무엇이고, 무엇을 하지 않나?
---
**gossip 첫 접점**이다. 조인하거나 토폴로지를 다시 배울 때 쓴다. 리더·쓰기 조율·데이터 담당이 아니다. 조인 후에는 일반 노드와 같다.
:::

:::quiz
**Q2.** vnode 조인 노드는 `initial_token` 없이 token을 어떻게 받나?
---
`num_tokens`를 읽고, gossip으로 기존 token을 본 뒤, 그만큼 **무작위** 위치를 고르고 **이미 쓰인 값은 스킵**한다. token이 많을수록 부하 분배가 고르다. Cassandra는 `allocate_tokens_for_keyspace`로 부하 기반 선택도 가능하다.
:::

:::quiz
**Q3.** "ring join"과 "bootstrap streaming"의 차이는? 지금 어느 단계인지는 어떻게 아나?
---
ring join = token 배정·링 진입. bootstrap streaming = 담당 구간 SSTable 복사. **`nodetool status` UJ**, **`nodetool netstats` Mode: JOINING**이면 streaming 중. **UN**이면 완료.
:::

:::quiz
**Q4.** 새 노드가 UN 된 뒤 기존 노드에 `nodetool cleanup`을 돌리는 이유는?
---
구간이 옮겨가도 **이전 소유 데이터가 자동 삭제되지 않는다**. cleanup이 그 키를 지운다. decommission 전에 안 하면 **data resurrection** 위험이 있다.
:::

:::quiz
**Q5.** bootstrap이 막히는 설정 실수 두 가지는?
---
(1) **조인 노드를 `seeds`에 넣음** — seed는 bootstrap 불가. (2) **`cluster_name` 불일치**나 seed/listen 주소 unreachable로 gossip 실패.
:::

## 메모

Cassandra/Scylla 트랙 2탄. 노드 교체 runbook 보기 전에 부팅·조인 메커니즘 정리.
