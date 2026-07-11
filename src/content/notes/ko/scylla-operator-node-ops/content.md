---
title: 'Cassandra & Scylla — 4탄: Scylla Operator K8s 노드 운영'
---

## 레퍼런스

- [Replace nodes (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html)
- [Scale, add, remove racks (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/operate/scale-add-remove-racks.html)
- [StatefulSets and racks (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html)
- [nodetool alternatives (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html)
- [Automatic data cleanup (ScyllaDB Operator)](https://operator.docs.scylladb.com/stable/management/data-cleanup.html)
- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)

---

## 왜 이 글을 찾아봤나

3탄 이어서다. 회사에서 Scylla Operator로 K8s 운영 중인데, 엔진은 같아도 control plane이 VM runbook과 다르다.

---

## 읽으면서 느낀 점

3탄은 yaml 편집 + `systemctl` 같은 imperative runbook이고, Operator는 Service 라벨·`ScyllaCluster` spec 같은 declarative 쪽이다. nodetool 중에 쓰면 안 되는 것도 따로 있다.

---

## 배운 것

*배경: 2~3탄과 같은 시니어 엔지니어 선생님이 Scylla Operator를 Kubernetes control plane으로 설명한다.*

---

### 1막 — 엔진은 같고 control plane만 다름

:::chat student AI 학생
3탄에서 yaml에 `replace_node_first_boot` 넣고 기동했는데, K8s에선 뭐가 달라요?
:::

:::chat teacher 선생님
**Scylla 프로세스**가 하는 replace는 같아 — 죽은 노드 token 상속, replica에서 stream/RBNO(3탄). 달라지는 건 **누가 트리거하느냐**야.

| 계층 | VM / bare metal (3탄) | Scylla Operator on K8s |
|------|----------------------|-------------------------|
| 트리거 | 사람이 `scylla.yaml` 수정 후 기동 | **member Service 라벨** 또는 **ScyllaCluster** spec 패치 |
| 스토리지 | 새 머신 data dir 비움 | Operator가 **PVC 삭제**, StatefulSet이 새 PVC 생성 |
| replace 플래그 | yaml `replace_node_first_boot` | Operator가 `--replace-node-first-boot=<옛 Host ID>` 주입 |
| cleanup | scale-out 후 `nodetool cleanup` 수동 | ring 변경 시 Operator가 **cleanup Job** 생성 |
| 멤버십 변경 | `nodetool decommission` / `removenode` | **금지** — Operator 상태와 desync |

3탄은 사람이 직접 돌리고, 4탄은 **Operator가 Kubernetes desired state를 reconcile**한다고 보면 돼.
:::

:::chat gon Gon
3탄의 replace vs bootstrap vs decommission 판단 기준은 그대로인가요?
:::

:::chat teacher 선생님
**언제** 쓸지는 같아 — DN 영구 장애면 replace, 계획 축소면 decommission 경로, 일시 다운이면 기다리기. **어떻게**만 Operator API로 옮기면 돼.
:::

---

### 2막 — 아키텍처: rack = StatefulSet

:::chat student AI 학생
Operator가 Scylla 토폴로지를 K8s에 어떻게 매핑하나요?
:::

:::chat teacher 선생님
**rack** 하나 = **StatefulSet** 하나. Pod ordinal이 정체성(`scylla-us-east-1a-0`, `-1`, `-2`). 각 pod에 Operator가 추적하는 **member Service**(ClusterIP)가 붙어.

([StatefulSets and racks](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html))에서 나오는 함의:

- **scale-up** — **가장 큰 ordinal** 뒤에 pod 추가(bootstrap, 2탄과 같음).
- **scale-down** — **가장 큰 ordinal**부터 decommission, 한 대씩.
- **ordinal 1만 고장** — `members` 줄여서는 안 됨(StatefulSet은 tail만 제거). **replace** 써야 함.
:::

---

### 3막 — 죽은 노드 replace (Operator runbook)

:::chat student AI 학생
ScyllaCluster에서 replace 절차를 순서대로 알려주세요.
:::

:::chat teacher 선생님
[Replace nodes](https://operator.docs.scylladb.com/stable/operate/replace-nodes.html) 기준이야.

**1. DN 확인** — healthy pod에서:

```bash
kubectl -n scylla exec scylladb-us-east-1a-0 -c scylla -- nodetool status
```

**2. IP → member Service** — DN IP와 Service ClusterIP 매칭:

```bash
kubectl -n scylla get svc -l scylla/cluster=scylladb -o wide
```

**3. K8s 노드 drain** (아직 있으면) — PDB `ALLOWED DISRUPTIONS: 0`이면 drain이 멈출 수 있음. 인스턴스가 이미 없으면 생략.

**4. replace 트리거** — **한 대씩**:

```bash
kubectl -n scylla label svc scylladb-us-east-1a-2 scylla/replace=""
```

Operator: 옛 **Host ID** 기록 → PVC·pod 삭제 → StatefulSet이 pod 재생성 → replace 플래그로 Scylla 기동 → replica에서 stream → Ready 되면 라벨 제거.

**5. 대기** — pod Ready + 클러스터 condition:

```bash
kubectl -n scylla get pods -w
kubectl -n scylla wait --timeout=30m --for='condition=Progressing=False' scyllacluster/scylladb
kubectl -n scylla wait --timeout=30m --for='condition=Available=True' scyllacluster/scylladb
```

**6. 검증 + repair** — 전원 UN; Operator 문서는 `nodetool repair`(또는 Scylla Manager 스케줄 repair) 권장.
:::

:::chat student AI 학생
라벨 안 붙여도 Operator가 알아서 replace하나요?
:::

:::chat teacher 선생님
경우에 따라 그래. **automatic orphaned node replacement** — K8s 노드가 영구 제거되면(노드 풀 축소, 인스턴스 종료) PV가 orphaned 될 때, Operator controller가 member Service에 **`scylla/replace=""`를 자동 적용**할 수 있어. `ScyllaCluster` spec의 `automaticOrphanedNodeCleanup: false`로 끌 수 있음.
:::

---

### 4막 — scale up / scale down (replace 아님)

:::chat student AI 학생
용량 늘리거나 맨 끝 노드만 빼고 싶어요. 중간 고장 replace가 아니에요.
:::

:::chat teacher 선생님
**`spec.datacenter.racks[].members`** 패치 ([Scale, add, remove racks](https://operator.docs.scylladb.com/stable/operate/scale-add-remove-racks.html)):

| 목적 | 동작 |
|------|------|
| scale-out | `members` 증가 → 새 ordinal bootstrap(2탄) |
| scale-in | `members` 감소 → Operator가 **가장 큰 ordinal** decommission(sidecar 경유) |
| rack 전체 제거 | rack `members: 0`, 대기 후 spec에서 rack 삭제 |

scale-down 순서 ([StatefulSets and racks](https://operator.docs.scylladb.com/stable/understand/statefulsets-and-racks.html)):

1. Operator가 member Service에 `scylla/decommissioned="false"` 설정
2. sidecar가 `nodetool decommission` 실행
3. sidecar가 `scylla/decommissioned="true"`로 갱신
4. StatefulSet replicas -= 1, pod + PVC 삭제

패치 후 `ScyllaCluster` `Available=True` 대기. keyspace **RF** 아래로 줄이지 말 것.
:::

:::chat student AI 학생
그냥 `nodetool decommission` 직접 돌리면 안 되나요?
:::

:::chat teacher 선생님
**위험** — StatefulSet replica 수·Operator 라벨과 desync ([nodetool alternatives](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html)). rollout 멈춤·데이터 손실로 이어질 수 있어. **`removenode`**, **`move`**도 마찬가지 — scale-down이나 `scylla/replace`로.
:::

---

### 5막 — nodetool 뭐가 안전한가

:::chat teacher 선생님
[nodetool alternatives](https://operator.docs.scylladb.com/stable/reference/nodetool-alternatives.html) 요약:

| 안전(읽기 전용·저위험) | Operator 대안(고위험) |
|------------------------|----------------------|
| `status`, `gossipinfo`, `netstats`, `ring`, `cfstats` | `decommission` → `members` 감소 |
| `repair`(Manager 있으면 중복) | `removenode` → `scylla/replace` 라벨 |
| `snapshot`, `compact`, `flush` | `disablegossip` / `disablebinary` → 절대 금지 |
| | `move` → 미지원; scaling 사용 |

**`cleanup`** — token ring hash 변경 시 Operator가 Job으로 자동 실행 ([Automatic data cleanup](https://operator.docs.scylladb.com/stable/management/data-cleanup.html)). **RF만 줄인 경우**는 Operator가 감지 못 해서 수동 cleanup 필요.

**`drain`** — pod `preStop` 훅으로 자동; 수동 호출 불필요.
:::

---

### 6막 — 자동 cleanup Job

:::chat student AI 학생
2탄에서 scale-out 후 cleanup 돌리라고 했는데, Operator가 해주나요?
:::

:::chat teacher 선생님
해. Operator가 member Service마다 **token ring hash**를 추적해. ring이 바뀌면(scale-out, scale-in, replace) 클러스터가 안정될 때까지(`Progressing=False`, `Available=True`, `Degraded=False`) 기다린 뒤 영향 받은 노드마다 **cleanup Job** 하나씩 띄워.

- scale-out: **기존** 노드 cleanup(신규 노드는 hash가 맞춰져 있어서 스킵).
- scale-in: 생존 노드 cleanup(토큰을 잃진 않았지만 ring 변경이라 I/O 스파이크 가능).
- tablet keyspace: 서버 cleanup은 no-op; vnode·system용으로 Operator가 트리거.

진행은 `ScyllaCluster`의 `JobControllerProgressing` condition으로 확인.
:::

---

### 7막 — VM vs Operator 치트시트

| 시나리오 | VM / bare metal (3탄) | Scylla Operator (4탄) |
|----------|-------------------------|-------------------------|
| 죽은 노드, 규모 유지 | `replace_node_first_boot` + 기동 | `kubectl label svc ... scylla/replace=""` |
| scale-out | add-node 절차 | `members++` |
| 계획 축소 | `nodetool decommission` | `members--`(tail ordinal) |
| rack 중간 pod 고장 | replace(동일) | `scylla/replace` 라벨(`members--` 아님) |
| `nodetool removenode` | 최후 수단(3탄) | **사용 금지** |
| scale-out 후 cleanup | 수동 `nodetool cleanup` | Operator cleanup Job |
| replace 모니터 | `netstats`, `gossipinfo` | 위 + `kubectl get pods`, `ScyllaCluster` condition |

### Operator replace 파이프라인

```
nodetool status DN → IP로 member Service 찾기
  → (선택) kubectl drain — PDB 확인
  → label svc scylla/replace=""
  → Operator: Host ID → PVC/pod 삭제 → replace 플래그로 새 pod
  → stream/RBNO → pod Ready → 라벨 제거
  → nodetool status UN → repair(Operator 문서)
  → ring hash 바뀌었으면 cleanup Job
```

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 3탄 VM replace와 Operator replace에서 같고 다른 점은?
---
**같음:** Scylla가 죽은 노드 token 상속, replica에서 stream/RBNO, DN일 때만. **다름:** 트리거가 **member Service `scylla/replace=""` 라벨**(yaml 수동 아님); Operator가 PVC 삭제 후 pod 재생성 + `--replace-node-first-boot`; 완료는 **pod Ready**·**ScyllaCluster condition**으로 확인.
:::

:::quiz
**Q2.** `scylla/replace` 라벨과 ScyllaCluster `members` 변경은 언제 쓰나?
---
**replace 라벨** — **특정 unhealthy/죽은** pod(ordinal 무관), 규모 유지. **`members` 감소** — **가장 큰 ordinal** 계획 제거만(StatefulSet은 중간 ordinal 제거 불가). **`members` 증가** = tail pod bootstrap.
:::

:::quiz
**Q3.** Operator 환경에서 `nodetool decommission`·`removenode`를 직접 쓰면 안 되는 이유는?
---
ring 멤버십을 **Operator 모르게** 바꿔 StatefulSet replica 수·추적 라벨과 desync → rollout 정지, replace 실패, 데이터 손실. 축소는 **`members--`**, 죽은 노드는 **`scylla/replace`**.
:::

:::quiz
**Q4.** Operator가 scale/replace 후 cleanup을 어떻게 처리하나?
---
member Service의 **token ring hash**와 `last-cleaned-up-token-ring-hash` 비교. 클러스터 안정 후 영향 노드마다 **cleanup Job** 생성. **RF만 감소**는 자동 감지 안 됨 → 수동 cleanup.
:::

:::quiz
**Q5.** automatic orphaned node replacement란?
---
K8s 노드 영구 제거로 Scylla PV가 orphaned 되면 Operator controller가 member Service에 **`scylla/replace=""` 자동 적용**. `ScyllaCluster`의 `automaticOrphanedNodeCleanup`으로 제어.
:::

## 메모

Cassandra/Scylla 트랙 4탄. K8s에서 Operator control plane — replace, scale, nodetool 경계.
