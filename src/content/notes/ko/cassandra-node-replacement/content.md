---
title: 'Cassandra & Scylla — 3탄: 노드 교체 절차'
---

## 레퍼런스

- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)
- [Handling Node Failures (ScyllaDB)](https://docs.scylladb.com/manual/stable/troubleshooting/handling-node-failures.html)
- [Repair-Based Node Operations (RBNO)](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/repair-based-node-operation.html)
- [Adding, replacing, moving and removing nodes (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)
- [Hints (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html)
- [Repair (Apache Cassandra)](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html)
- [Remove a Node from a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/remove-node.html)
- [nodetool removenode (ScyllaDB)](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/removenode.html)
- [nodetool decommission (ScyllaDB)](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/decommission.html)
- [Bootstrapping Apache Cassandra Nodes (The Last Pickle)](http://thelastpickle.com/blog/2017/05/23/auto-bootstrapping-part1.html)
- [Replace a dead node (DataStax DSE)](https://docs.datastax.com/en/dse/6.9/managing/operations/replace-node.html)
- [Replace nodes (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)

---

## 왜 이 글을 찾아봤나

2탄 이어서다. 장애·폐기 노드를 바꿀 때 데이터 손실 없이 처리하는 실무 runbook이 필요하다.

---

## 읽으면서 느낀 점

2탄에서 `replace_address_first_boot`가 bootstrap과 별도 경로라고만 나와 있었는데, 이번에 replace runbook을 채웠다.

---

## 배운 것

*배경: 2탄과 같은 다정한 시니어 엔지니어 선생님이 주니어에게 죽은 Scylla/Cassandra 노드를 교체하는 절차를 설명한다.*

---

### 1막 — 어떤 operation인가

:::chat student AI 학생
`nodetool status`에 DN이 뜨면 무조건 replace인가요?
:::

:::chat teacher 선생님
좋은 출발이야. **왜** 죽었는지부터 보자.

| 상황 | Operation |
|------|-----------|
| 하드웨어 고장, 클러스터 규모 유지 | **replace** ← 이번 노트 |
| 노드가 UN인 채 계획적 폐기 | **decommission** (replace 아님) |
| 영구 다운, 클러스터 축소 | **removenode** (최후 수단) |
| 일시 장애(재부팅·네트워크) | **기다리기** — 살아날 수 있으면 replace 금지 |

**replace**는 죽은 노드의 **token 구간을 그대로 물려받는다**. 2탄 bootstrap처럼 무작위 새 token이 아니야. decommission + bootstrap(두 번의 range movement)보다 한 번에 끝난다.
:::

:::chat student AI 학생
2탄 add-node bootstrap이랑 뭐가 다른가요?
:::

:::chat teacher 선생님
2탄 = **scale-out**: gossip으로 기존 token 파악 → **새 무작위** token → stream → **기존 노드 cleanup**.

replace = **같은 자리**: 새 하드웨어가 **죽은 노드 token**을 이어받음 → stream/RBNO → **다른 노드 cleanup 없음**(소유권이 옮겨간 게 아니라 재할당).
:::

---

### 2막 — 사전 조건

:::chat student AI 학생
손대기 전에 뭘 확인하나요?
:::

:::chat teacher 선생님
replace 전 체크리스트야.

1. **Quorum** — 토폴로지 변경엔 살아 있는 노드 quorum 필요. 깨졌으면 먼저 복구 ([Handling Node Failures](https://docs.scylladb.com/manual/stable/troubleshooting/handling-node-failures.html)).
2. **상태** — 대상이 **DN**(Down Normal)이어야 함. UN 노드는 replace 대상이 아님.
3. **버전** — 새 노드가 클러스터와 **패치까지** 동일.
4. **설정** — UN 노드에서 복사: `cluster_name`, `seeds`, `endpoint_snitch`, `authenticator`; `listen_address`, `rpc_address`, rack/DC 맞추기.
5. **데이터 디렉터리** — 새 노드는 **비어 있어야** 함. 죽은 서버에 접근 가능하면 거기도 wipe.
6. **Host ID** — `nodetool status`에서 죽은 노드 Host ID 메모(Scylla replace에 씀).
:::

:::chat student AI 학생
죽은 노드가 여러 대면 한꺼번에 replace해도 되나요?
:::

:::chat teacher 선생님
돼. Scylla 문서상 **병렬 replace** 가능해. quorum만 유지되고 streaming/RBNO 부하를 감당할 수 있으면.
:::

---

### 3막 — 설정: Scylla vs Cassandra

:::chat student AI 학생
2탄에 `-Dcassandra.replace_address_first_boot` 나왔는데, Scylla에선 뭘 넣나요?
:::

:::chat teacher 선생님
Scylla(현행)는 **새 노드** `scylla.yaml`에:

```yaml
replace_node_first_boot: <죽은-노드-Host-ID>
```

- 값 = 죽은 노드 **Host ID**(`nodetool status`). 새 IP가 아님.
- `replace_address`, `replace_address_first_boot`는 Scylla에서 **미지원** — 쓰지 말 것.
- 성공 후 이 줄을 **지울 필요 없음**(Cassandra JVM 플래그와 다름).

Cassandra는 `jvm-server.options` / `cassandra-env.sh`에:

```
-Dcassandra.replace_address_first_boot=<죽은_노드_IP>
```

- 값 = **죽은 노드 IP**. 새 노드 IP와 달라도 이 값은 죽은 IP.
- 레거시 `replace_address`보다 `_first_boot` 권장 — 한 번만 적용, 안 지우면 재시작 시 깨짐 ([The Last Pickle](http://thelastpickle.com/blog/2017/05/23/auto-bootstrapping-part1.html)).
- 성공 후 JVM 플래그 **제거**(Cassandra).
:::

| | Scylla | Cassandra |
|---|--------|-----------|
| 식별자 | Host ID | 죽은 노드 IP |
| 설정 위치 | `scylla.yaml` | JVM options |
| 성공 후 | yaml에 둬도 됨 | JVM 플래그 제거 |
| 구식 | `replace_address*` 미지원 | `replace_address`는 재시작 위험 |

---

### 4막 — hibernate 상태와 모니터링

:::chat student AI 학생
새 노드를 기동했는데 `nodetool status`가 이상해요.
:::

:::chat teacher 선생님
replace 중엔 **hibernate** 상태야 ([Cassandra topo_changes](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html)).

| 관찰자 | 보이는 것 |
|--------|-----------|
| 다른 노드 | 교체 노드를 아직 **죽은 항목(DN)** 으로 봄 |
| 교체 노드 자신 | 자신을 **UN**으로 봄 |
| 정확한 진행 | `nodetool netstats` — REPLACE / streaming |

Scylla는 bootstrap 중 **새 IP가 status에 안 보일** 수 있어 — `nodetool gossipinfo`로 새 주소가 **NORMAL**인지 확인해.

```bash
nodetool status       # DN → 새 IP로 UN
nodetool netstats     # REPLACE 진행률, %·GB
nodetool gossipinfo   # status에 없어도 NORMAL 확인
nodetool tasks list   # RBNO 장기 작업(Scylla 5.4+)
```
:::

:::chat student AI 학생
같은 IP로 바꾸는 것과 다른 IP로 바꾸는 것 — 차이가 있나요?
:::

:::chat teacher 선생님
있어. **bootstrap 중 쓰기 수신** 여부가 달라.

| 시나리오 | token | Host ID | bootstrap 중 쓰기 |
|----------|-------|---------|-------------------|
| 같은 IP | 죽은 노드 것 상속 | 새로 발급 | **못 받을 수 있음**(CASSANDRA-8523) |
| 다른 IP | 상속 | 새로 발급 | **받을 수 있음** |

2탄 실수 표의 「같은 IP 교체 후 repair 없음 → 쓰기 누락」이 이 케이스야.
:::

---

### 5막 — 데이터 동기화: streaming vs RBNO

:::chat student AI 학생
데이터는 어디서 오나요?
:::

:::chat teacher 선생님
살아 있는 **replica**가 죽은 노드 token 구간을 교체 노드로 stream(또는 repair-sync)해. 2탄 bootstrap streaming과 전송 방식은 비슷한데, **새 무작위 구간**이 아니라 **물려받은 구간**이야.

**Scylla 5.4+ (RBNO 기본):** replace가 레거시 streaming만 쓰지 않고 **row-level repair**를 씀.

- 중단돼도 체크포인트부터 재개
- replica 전체를 읽어 일관성 맞춤
- replace용 RBNO가 켜져 있으면 **별도 repair 불필요**

클러스터의 `enable_repair_based_node_ops`, `allowed_repair_based_node_ops`를 확인해.
:::

---

### 6막 — repair를 돌려야 할 때

:::chat student AI 학생
replace 끝나고 UN 됐어요. 이제 끝인가요?
:::

:::chat teacher 선생님
거의 다 왔어. **교체 과정에서 쓰기를 놓쳤는지** 보면 돼.

**교체 노드에서 `nodetool repair` 필수**인 경우 ([Cassandra topo_changes](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/topo_changes.html), [Scylla replace 문서](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)):

1. replace 시작 전 죽은 기간이 **`max_hint_window`**(기본 **3시간**)보다 김.
2. **같은 IP** 교체인데 bootstrap이 **`max_hint_window`**보다 오래 걸림.

**Hinted handoff**([Hints 문서](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/hints.html))는 unavailable replica에 대한 쓰기를 그 window 안에서만 보관해. best-effort이고 repair 대체가 아니야.

**예외:** Scylla에서 **replace용 RBNO** 켜져 있으면 — 문서 기준 **별도 repair 불필요**.

repair가 필요하면 **교체된 노드**에서 실행(Scylla Manager로 스케줄 가능).
:::

| 요인 | replace 후 repair? |
|------|-------------------|
| 다운 < `max_hint_window`, 다른 IP, 빠른 bootstrap | 보통 불필요(레거시 streaming) |
| 다운 > `max_hint_window` | **필수** |
| 같은 IP, 느린 bootstrap > `max_hint_window` | **필수** |
| replace용 RBNO 켜짐(Scylla 5.4+) | **불필요**(문서 기준) |

---

### 7막 — replace vs removenode

:::chat student AI 학생
replace가 안 되거나 클러스터를 줄이고 싶으면요?
:::

:::chat teacher 선생님
**removenode**는 죽은 노드를 **제거**할 때의 fallback이야.

| | replace | removenode |
|---|---------|------------|
| 목적 | **같은 규모** 복구 | 클러스터 **축소** |
| token | 죽은 노드 것 **유지** | 생존 노드로 재분배 |
| 일관성 | streaming/RBNO로 채움 | removenode **전** 클러스터 repair 권장(RBNO 아니면) |
| 되돌리기 | — | 노드 **banned** — 실패해도 다시 못 들어옴 |

**살아 있고 reachable한** 노드에 `removenode` 쓰면 안 돼 — `decommission`이 정석 ([removenode 문서](https://docs.scylladb.com/manual/stable/operating-scylla/nodetool-commands/removenode.html)).
:::

---

### 8막 — 특수 케이스

**죽은 노드가 seed였을 때**

- **모든** 노드 `seeds`에서 죽은 IP 제거.
- 새 seed가 필요하면 교체 노드 IP를 전 노드 seed 목록에 추가 ([DSE replace-node](https://docs.datastax.com/en/dse/6.9/managing/operations/replace-node.html)).
- replace 완료 전까지 교체 노드를 `seeds`에 넣지 말 것(2탄과 동일).

**Ephemeral 스토리지(EC2 i3 등)**

- 인스턴스 stop → ephemeral 데이터 소실.
- RAID 재구성, yaml에 `replace_node_first_boot: <옛-Host-ID>` 추가 후 Scylla 기동 ([Scylla replace 문서](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)).
- 재시작 후 public/private IP가 바뀔 수 있음 — `listen_address` / `broadcast_address` 갱신.

**Kubernetes(Scylla Operator)**

- 실패한 member Service에 `scylla/replace=""` 라벨 → Operator가 `--replace-node-first-boot`로 새 pod 프로비저닝 ([Operator 문서](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)).

---

### Runbook 한눈에

```
사전: quorum OK, 대상 DN, 버전 일치, Host ID 확보, 새 data dir 비움
  → 설정: cluster_name, seeds, snitch, replace_node_first_boot(Scylla Host ID)
  → 새 노드 기동(seeds에 아직 넣지 말 것)
  → 모니터: netstats(REPLACE), gossipinfo(새 IP NORMAL)
  → nodetool status UN 대기
  → repair?(max_hint_window, 같은 IP 소요, RBNO off)
  → seed였으면 seed 목록 갱신
  → IP 바뀌었으면 앱 연결 문자열 갱신
```

### Operation 치트시트(2탄 + 3탄)

| Operation | 언제 | token | 사후 cleanup |
|-----------|------|-------|--------------|
| bootstrap (2탄) | scale-out | 새 무작위 | **기존 노드 cleanup** |
| **replace** (3탄) | 죽은 노드, 규모 유지 | 죽은 노드 것 상속 | peer cleanup 없음 |
| decommission | 계획 제거(UN) | 재분배 | 제거 노드 수동 wipe |
| removenode | 죽은 노드, 축소 | 재분배 | repair 선행; 노드 banned |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** replace를 써야 할 때와 bootstrap, decommission, removenode를 써야 할 때는?
---
**replace** — 노드가 **DN**이고 **같은 규모로 복구**할 때. 새 하드웨어가 죽은 노드 token 구간을 물려받음. **bootstrap**은 scale-out(새 token). **decommission**은 살아 있는 UN 노드 계획 제거. **removenode**는 replace가 목적이 아닐 때 클러스터 축소. **일시 장애**면 기다리기.
:::

:::quiz
**Q2.** Scylla와 Cassandra에서 replace 설정은 무엇이고, 어떤 식별자를 쓰나?
---
**Scylla:** `replace_node_first_boot: <죽은 Host ID>` in `scylla.yaml` — `replace_address*` 미지원. **Cassandra:** `-Dcassandra.replace_address_first_boot=<죽은 IP>` in JVM options — 성공 후 제거. Scylla는 **Host ID**, Cassandra는 **죽은 노드 IP**(새 IP와 무관).
:::

:::quiz
**Q3.** replace 중 `nodetool status`가 헷갈리는 이유와 진행 확인 방법은?
---
교체 노드가 **hibernate** 상태 — 다른 노드는 **죽은 항목(DN)** 으로 보고, 새 노드는 자신을 UN으로 봄. **`nodetool netstats`**로 REPLACE/streaming 진행률 확인. Scylla는 status에 새 IP가 없을 때 **`nodetool gossipinfo`**로 NORMAL 확인. **`nodetool tasks list`**로 RBNO 작업 추적.
:::

:::quiz
**Q4.** replace 후 repair가 필요한 조건과 생략 가능한 조건은?
---
**필수:** replace 전 다운이 **`max_hint_window`**(기본 3h) 초과, 또는 **같은 IP** 교체가 그 window보다 오래 걸림 — hint replay 안 됨. **생략:** Scylla **replace용 RBNO** 켜져 있으면(문서 기준). hinted handoff는 best-effort, repair 대체 아님.
:::

:::quiz
**Q5.** 2탄 bootstrap과 replace의 token·cleanup 차이는?
---
**bootstrap**은 **새 무작위** token 할당, UN 후 **기존 노드 `nodetool cleanup`**. **replace**는 죽은 노드 token **상속**, 무작위 할당 없음, **peer cleanup 없음** — 기존 구간 데이터를 새 하드웨어로 stream/RBNO.
:::

:::quiz
**Q6.** 같은 IP vs 다른 IP 교체 — 쓰기 전달 차이는?
---
**다른 IP** 교체는 bootstrap 중 **쓰기를 받을 수 있음**(CASSANDRA-8523). **같은 IP**는 bootstrap 중 **못 받을 수 있음** — outage나 bootstrap이 **`max_hint_window`** 넘으면 **repair 필수**.
:::

## 메모

Cassandra/Scylla 트랙 3탄. 2탄 부팅·조인 다음 노드 교체 runbook.
