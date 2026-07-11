---
title: 'Discord Superdisk — Scylla GCP 하이브리드 스토리지'
---

## 레퍼런스

- [How Discord Supercharges Network Disks for Extreme Low Latency](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)
- [How Discord Migrated Trillions of Messages to ScyllaDB (The New Stack)](https://thenewstack.io/how-discord-migrated-trillions-of-messages-to-scylladb/)
- [Persistent Disk (Google Cloud)](https://cloud.google.com/compute/docs/disks/persistent-disks)
- [Replace a Dead Node in a ScyllaDB Cluster](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/replace-dead-node.html)
- [Rebuild a Node After Losing the Data Volume](https://docs.scylladb.com/manual/stable/operating-scylla/procedures/cluster-management/rebuild-node.html)

---

## 왜 이 글을 찾아봤나

노드 replace와 장애 노드 EBS 재활용을 공부하다 **Superdisk**가 나왔다. GCP나 Scylla 제품이 아니라 Discord가 Scylla 메시지 클러스터에 쓴 커스텀 RAID 스택이다.

---

## 읽으면서 느낀 점

replace runbook에서 말한 EBS 재활용과는 다른 층위다. streaming을 건너뛰는 게 아니라, NVMe급 읽기와 네트워크 영속 디스크 durability를 동시에 노리는 설계다.

---

## 배운 것

*배경: 3탄 EBS/replace 논의 뒤, 시니어 엔지니어 선생님이 Discord Superdisk를 설명한다.*

---

### 1막 — Superdisk가 뭐야?

:::chat student AI 학생
Superdisk는 Scylla 기능인가요, GCP 디스크 타입인가요?
:::

:::chat teacher 선생님
둘 다 아니야. **Superdisk**(super-disk)는 Discord가 GCP에서 만든 **하이브리드 볼륨** 이름이야 ([Discord 블로그](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)). ScyllaDB 클러스터가 그 위에 올라가.

목표는 두 디스크를 합치는 거야.

| 디스크 | GCP | 강점 | 약점 |
|--------|-----|------|------|
| 빠른 다리 | **Local SSD**(NVMe 인스턴스 스토어) | 읽기 지연 sub-ms | 스냅샷 없음, 호스트 장애 시 로컬 데이터 소실, 단독 사용 시 신뢰성 우려 |
| durable 다리 | **Persistent Disk**(네트워크 블록) | 스냅샷, detach/attach, 복제 | op당 ~1–2ms — 고 QPS에서 큐 적체 |

Discord 채팅은 읽기 비중이 커서, PD만 쓰면 Scylla가 느린 게 아니라 **디스크 읽기 대기**로 op 큐가 쌓였어.
:::

:::chat gon Gon
AWS로 치면 instance-store NVMe랑 EBS를 묶은 건가요?
:::

:::chat teacher 선생님
개념적으로 맞아.

| GCP (Discord) | AWS 대응 |
|---------------|----------|
| Persistent Disk | **EBS** |
| Local SSD | **인스턴스 스토어 NVMe**(i3 등) |
| Superdisk | **Linux RAID로 합친 커스텀 스택** — 관리형 SKU 아님 |

3탄의 「replace 때 옛 EBS 붙이기」랑은 다른 얘기야. **상시 I/O 아키텍처**지, 노드 교체 지름길이 아니야.
:::

---

### 2막 — RAID는 어떻게 짜나

:::chat student AI 학생
디스크를 실제로 어떻게 연결하나요?
:::

:::chat teacher 선생님
Linux 커널 **`md`** 소프트웨어 RAID야 ([Discord 블로그](https://discord.com/blog/how-discord-supercharges-network-disks-for-extreme-low-latency)).

```
[Local SSD 375GB] ─┐
[Local SSD 375GB] ─┼─ RAID0  →  빠른 가상 볼륨(~TB)
[Local SSD 375GB] ─┘
                          │
                    RAID1 미러
                          │
                 [Persistent Disk]
                    (write-mostly)
```

**1단계 — Local SSD RAID0:** GCP Local SSD는 375GB 고정. Discord는 노드당 1TB+ 필요해서 RAID0로 용량·읽기 병렬을 확보. fast leg만 RAID0 리스크 감수 — GCP는 Local SSD 하나만 깨져도 VM 전체를 다른 하드웨어로 옮기며 로컬 SSD 데이터를 날릴 수 있어.

**2단계 — Persistent Disk와 RAID1:** RAID0 배열을 PD에 미러. PD에 **`write-mostly`** — 평소 **읽기는 Local SSD**, fast leg에 없을 때만 PD. **쓰기는 양쪽**에 반영(write-through).

처음엔 **dm-cache / bcache**를 봤는데, Local SSD bad sector가 나면 읽기 전체가 실패하고 Scylla가 `Disk error … No data available`로 종료될 수 있어. RAID1 + write-mostly는 PD fallback으로 버틴다.
:::

---

### 3막 — 풀어 주는 문제 vs 안 풀어 주는 문제

:::chat student AI 학생
Superdisk면 노드 replace 때 디스크 재활용할 수 있나요?
:::

:::chat teacher 선생님
**아니** — 레이어가 달라.

| 질문 | Superdisk | 3탄 replace |
|------|-----------|-------------|
| 평소 빠른 읽기 + durable 쓰기? | Local SSD RAID0 + PD RAID1 | 해당 없음 |
| 고장 노드 디스크로 streaming 생략? | **여전히 안 됨** | 빈 data dir + `replace_node_first_boot` |
| 호스트 죽고 local SSD만 소실? | **PD 다리에 데이터** — 복구 후 fast leg resync | 클러스터 **RF replica**는 남음 — 노드는 replace/rebuild 필요할 수 있음 |
| i3 stop = ephemeral wipe? | Superdisk는 **GCP PD+Local SSD** 패턴; AWS i3 stop은 인스턴스 스토어 wipe — PD/EBS 다리가 중요 | replace/rebuild 문서 그대로 |

Superdisk 도입 후 Discord는 피크에서 **디스크 읽기 큐 증가가 사라졌**고, 같은 서버에 더 많은 QPS를 태웠어. The New Stack은 Cassandra→Scylla 마이그레이션 맥락에서 메시지 읽기 p99 개선도 언급해 ([기사](https://thenewstack.io/how-discord-migrated-trillions-of-messages-to-scylladb/)).

**Duplex I/O:** Discord는 Scylla와 읽기/쓰기 채널 분리 같은 I/O 튜닝도 함께 했어 — RAID 레이아웃 밖 구현 디테일.
:::

---

### 4막 — 운영에서 챙길 것

:::chat student AI 학생
Superdisk 비슷하게 쓰면 운영에서 뭘 봐야 하나요?
:::

:::chat teacher 선생님
**1. RAID resync 부하** — fast leg 손실 후 PD에서 재동기화할 때 I/O가 크다. `md` sync 진행률 모니터링.

**2. replace runbook은 그대로** — DN이고 노드 정체성이 바뀌면 새 인스턴스 + **빈** Scylla data dir + replace/bootstrap. Superdisk가 「데이터 있는 PD 마운트」를 공식 replace 경로로 만들지 않는다.

**3. 복구 vs replace** — **fast leg만** 죽고 호스트·PD·동일 정체성 복구 가능 → RAID recovery + Scylla 재기동. **호스트/정체성**이 없고 클러스터가 DN → replace.

**4. Scylla Operator 기본과는 별개** — Operator는 PVC 전제; Superdisk는 bare metal/VM **호스트 스토리지** 엔지니어링.

**5. Discord part two** — 원문 블로그에 클라우드 엣지 케이스 후속 예고; 핵심 RAID 레시피는 2022 글에 있음.
:::

### 아키텍처 한눈에

| 계층 | 구성 |
|------|------|
| 애플리케이션 | Discord 채팅 서비스 |
| DB | ScyllaDB (메시지 클러스터) |
| Superdisk | md: RAID0(Local SSD) + RAID1(PD, write-mostly) |
| 클라우드 | GCP Compute + Persistent Disk + Local SSD |

### Superdisk vs EBS 재활용 치트시트

| | Superdisk | replace 시 EBS reattach |
|--|-----------|-------------------------|
| 목적 | 상시 성능 + durability | 노드 교체 시 streaming 시간 절약 |
| Scylla 공식 경로? | 커스텀 인프라(문서 없음) | replace에서 **미지원** |
| durability | PD/EBS 미러 다리 | 단일 볼륨 수명주기 |
| 호스트 죽은 뒤 디스크만 살아남음 | PD에서 fast leg resync | 수동 **복구**는 가능할 수 있음; DN이면 replace |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** Superdisk란?
---
Discord **GCP 커스텀 하이브리드 볼륨**: Linux `md` RAID로 **Local SSD(NVMe)** 빠른 읽기 + **Persistent Disk** durability/스냅샷. Scylla 기능·GCP 공식 디스크 타입 **아님**.
:::

:::quiz
**Q2.** RAID 구성과 `write-mostly` 역할은?
---
여러 Local SSD **RAID0**(용량·병렬 읽기) → **RAID1**로 **Persistent Disk** 미러, PD는 **write-mostly** — 평소 읽기는 fast leg, 쓰기는 양쪽, fallback/resync에 PD 사용.
:::

:::quiz
**Q3.** Discord가 PD만, Local SSD만 쓰지 않은 이유는?
---
**PD만:** op 지연 ~1–2ms → 초당 수백만 RPS에서 디스크 큐. **Local SSD만:** 신뢰성·스냅샷·호스트 이전 시 데이터 소실. Superdisk는 PD durability + Local SSD 읽기 지연을 동시에 노림.
:::

:::quiz
**Q4.** Superdisk가 Scylla replace 때 실패 노드 디스크 재활용을 가능하게 하나?
---
**아니.** Superdisk는 **상시 I/O**(빠른 읽기 + durable 쓰기)용. **replace**는 여전히 **빈** data dir + replica stream/RBNO. PD/EBS 생존은 **RAID 복구**에 도움될 뿐, replace 프로토콜 생략이 아님.
:::

:::quiz
**Q5.** Superdisk 두 다리의 AWS 대응은?
---
**Persistent Disk ≈ EBS**. **Local SSD ≈ 인스턴스 스토어 NVMe**(i3 등). Superdisk ≈ **호스트 RAID로 둘을 합친 것** — 클라우드 SKU가 아닌 커스텀 운영.
:::

## 메모

Cassandra/Scylla 트랙 스토리지 노트 — 1탄 Discord 맥락, 3탄 replace/EBS 질문, Scylla 실전 튜닝을 잇는다.
