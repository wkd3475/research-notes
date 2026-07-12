---
title: 'Scylla — Shard-per-Core, 라우팅 & 노드 Ops'
---

## 레퍼런스

- [ScyllaDB Shard-per-Core Architecture (공식)](https://www.scylladb.com/product/technology/shard-per-core-architecture/)
- [Why ScyllaDB's Shard Per Core Architecture Matters (블로그)](https://www.scylladb.com/2024/10/21/why-scylladbs-shard-per-core-architecture-matters/)
- [ScyllaDB docs — tablets, repair, rebuild, RBNO](https://docs.scylladb.com/manual/stable/)

[Cassandra & Scylla 1탄 노트](/research-notes/ko/notes/cassandra-scylla-intro/)에서 이어짐. quokkalover 시리즈 3탄(Scylla가 빠른 이유)은 미작성이라 위 공식 글들로 대신 읽었다.

---

## 왜 이 글을 찾아봤나

- **맥락:** 회사 Scylla 구축 준비 중. 1탄은 Cassandra 기본만 다루고 내부 구조는 빠져 있었다.
- **읽은 것:** shard-per-core 공식 페이지 두 편.
- **공부하면서 생긴 질문:** shard 사이즈는 어떻게 정해지나? shard를 쪼개거나 합칠 수 있나? SSTable이 뭐지? resharding은 무슨 뜻? 요청은 어떤 코어로 가나? 노드가 늘면 repair와 rebuild는 뭐가 다르고, 또 어떤 operation을 알아둬야 하나?

---

## 읽으면서 느낀 점

한 편을 처음부터 끝까지 읽기보다, 질문마다 파고들었다. SSTable → compaction → resharding → 라우팅 → 노드 ops 순으로 깊어졌다.

---

## 배운 것

### Shard-per-core — 4줄 요약

1. Scylla는 **노드뿐 아니라 CPU 코어 하나당 shard**를 둔다. Cassandra는 보통 서버(노드) 단위에서 끝난다.
2. 각 shard는 CPU·메모리·네트워크·스토리지(캐시, memtable, SSTable)를 전담하는 shared-nothing 구조다.
3. **Seastar** 기반 — 코어당 스레드 1개, 락·thread pool 경합 대신 메시지 패싱.
4. 코어 수에 거의 선형으로 성능이 늘고, 같은 부하에 Cassandra보다 노드 수가 적게 드는 경우가 많다(Discord 등).

### "shard" 두 종류

| | **코어 shard** (실행 단위) | **tablet** (데이터 단위, 6.0+) |
|---|---|---|
| 무엇 | CPU 코어당 1개 | 테이블을 ~5GB 단위로 분할 |
| 개수 | `--smp` = 사용 코어 수 | 키스페이스/테이블 옵션 + 자동 조정 |
| 사이즈 | GB로 ops가 정하지 않음 | 목표 크기 기준, 자동 split/merge |
| 쪼개기/합치기 | 수동 불가 | 시스템이 자동 |

### 내가 궁금해했던 것 — shard 사이즈, split, merge

**「shard 사이즈는 어떻게 정해지나?」**  
코어 shard 용량을 GB로 박아 두는 구조가 아니다. partition key → Murmur3 해시 → **token** → ring을 노드·코어 수로 나누고, 각 shard token 구간에 데이터가 쌓인다.

**tablets**(최근 Scylla 기본): 테이블이 tablet(~5GB 목표)으로 쪼개지고, 로드밸런서가 노드·shard 사이로 옮긴다. tablet 수는 `expected_data_size_in_gb`, `min_per_shard_tablet_count` 같은 옵션과 실제 데이터량으로 정해진다.

**「shard를 쪼개거나 합치고 싶다면?」**  
- **코어 shard:** 수동 split/merge 없음. 코어 추가(`--smp`) → 재시작 시 **resharding**(무거움). tablets 사용 시 재시작 후 **shard 수 줄이기**는 지원 안 함.
- **tablet:** 크면 **split**, 작으면 **merge**. 용량 늘리기는 코어 추가(scale-up)보다 **노드 추가(scale-out)** 가 보통 낫다.

**핫 파티션:** 같은 partition key는 항상 **한 shard**로 간다. 코어를 늘려도 그 키는 한 코어에 몰린다 — **데이터 모델**(bucket, salt 등)로 풀어야 한다.

### SSTable, compaction, resharding

**SSTable**(Sorted Strings Table): 디스크에 쌓이는 **수정 불가** 데이터 파일.

```
쓰기 → commit log → memtable → SSTable (flush)
```

- UPDATE = 삭제 마커 + 새 쓰기(파일을 제자리에서 수정하지 않음).
- **Compaction:** **같은 shard 안** SSTable 여러 개를 합치고 tombstone 정리. 일상적인 백그라운드 작업.
- **Resharding:** **코어 수 변경** 시 SSTable을 새 shard 구간에 맞게 통째로 다시 읽고 씀. compaction과 비슷하지만 shard 경계가 바뀌는 특수 작업. 비용이 크니 `--smp`는 처음부터 맞추고, 가능하면 **scale-out**을 우선.

### 요청이 어느 코어로 가나

```
partition key → Murmur3 → token → 노드(ring) → 그 노드 안 shard
```

노드 안에서는 token 범위를 shard 수(S)로 다시 나눈다(블로그: 2^n 조각으로 자른 뒤 코어 수만큼 분할).

| 경로 | 동작 |
|------|------|
| **shard-aware 드라이버** | 클라이언트가 token 계산 → 맞는 노드·**shard 연결**로 직송. **prepared statement** 필요. |
| **비 shard-aware** | 아무 노드/coordinator → 네트워크·**노드 내부 cross-shard** 포워딩 가능. |

운영에서는 **TokenAwarePolicy** + Scylla shard-aware 드라이버 + prepared statement가 사실상 표준.

:::chat gon Gon
Scylla partition key 내부 기전이 궁금해요 — Murmur3, token ring, replica, shard 라우팅까지. 여기에 다 넣기보다 별도 노트에서 자세히 보고 싶어요.
:::

:::chat teacher 선생님
이 노트는 **노드 → shard**까지만 짧게 다뤘어요. **PK → Murmur3 → ring → replica set → shard** 전체는 [Partition Key 내부 기전](/research-notes/ko/notes/scylla-partition-key-internals/)에서 보면 됩니다.
:::

### 노드가 늘면 재분배

맞다. 노드 추가·제거 시 token 담당이 바뀌고, **bootstrap**, **decommission**, **replace** 등으로 데이터가 노드 간 이동한다.

Scylla 5.4+는 기본 **RBNO(Repair-Based Node Operations)**. 노드 작업도 row-level repair를 쓴다(예전처럼 streaming만 쓰지 않음). 중단해도 이어서 진행할 수 있고, replica 전체를 보고 맞춘다. RBNO가 켜져 있으면 replace/removenode 전후에 repair를 꼭 돌릴 필요는 없다.

### repair vs rebuild

| | **repair** | **rebuild** |
|---|-----------|-------------|
| **목적** | replica 간 불일치 동기화 | 빈 노드·**새 DC**에 데이터 채우기 |
| **시점** | 정기(예: 주 1회, `gc_grace_seconds` 이내) | DC 추가 후 `nodetool rebuild <source-dc>` |
| **비유** | 같은 교재 여러 벌 맞춰보기 | 새 학생에게 교재 통째로 복사 |

- **bootstrap:** 같은 DC에 새 노드 — 시작 시 담당 token 데이터를 받음(rebuild와 취지 유사).
- **rebuild:** vnode 키스페이스만. **tablet** 키스페이스는 `nodetool cluster repair` 사용.

### Anti-entropy 3겹

1. **Hinted handoff** — 짧은 다운타임. coordinator가 hint 저장 후 replay(기본 max window ~3시간). repair 대체 아님.
2. **Read repair** — 읽을 때 digest 불일치 → 백그라운드(때로는 foreground) 동기화.
3. **repair** — row별 checksum으로 replica 맞춤.

### 알아두면 좋은 operation

| Operation | 언제 |
|-----------|------|
| `bootstrap` | 새 노드 합류(scale-out) |
| `decommission` | 노드 정상 제거 |
| `removenode` | 노드 영구 다운(최후 수단) |
| `replace` | 죽은 하드웨어 교체, 같은 token 자리 |
| `rebuild` | 새 DC가 기존 DC에서 데이터 받을 때 |
| `cleanup` | scale-out **후** vnode에서만 — 더 이상 내 담당 아닌 복제본 삭제. **tablets면 불필요** |
| `drain` | 재시작/업그레이드 전 |
| `snapshot` | 백업 |
| `nodetool tasks list` | RBNO 등 장기 작업 추적 |

**치트시트:** scale-out → 노드 UN까지 대기 → (vnode) 기존 노드 cleanup. scale-down → `decommission`. 죽은 노드 → `replace` 또는 `removenode`.

---

## 메모

shard-per-core 읽기랑 SSTable·라우팅·ops 질문 정리를 여기 남겨 둠. 다음은 **Scylla가 적합한 경우**랑 **클라이언트 베스트 프랙티스**를 볼 예정.
