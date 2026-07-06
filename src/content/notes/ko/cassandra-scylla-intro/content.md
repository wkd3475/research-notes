---
title: 'Cassandra & Scylla — 1탄: Cassandra 기본'
---

> 원문: [Cassandra & Scylla DB 시리즈 1탄 (quokkalover)](https://etloveguitar.tistory.com/m/161)

---

## 왜 이 글을 찾아봤나

회사에서 Scylla를 새로 올리고 작업을 해야 해서, 손대기 전에 배경부터 정리하려고 가볍게 읽었다.

---

## 읽으면서 느낀 점

백그라운드 정리용으로 가볍게 읽었다.

---

## 배운 것

### 핵심 정리

1. **ScyllaDB는 Cassandra를 C++로 다시 만든 DB** — CQL 호환, 명령·API도 같다. 홍보 기준으로는 Cassandra보다 약 5배 빠르고, 같은 처리량이면 클러스터는 대략 1/10 규모면 된다고 한다. JVM GC stop-the-world도 없다.
2. **Cassandra는 masterless** — 노드가 동등하고, gossip으로 클러스터 상태·장애 감지·리밸런싱을 맡는다. 단일 장애점이 없고 확장은 선형에 가깝다.
3. **데이터는 consistent hashing으로 노드에 올라간다** — partition key 해시 → token → ring 위치. virtual node(`num_tokens`)가 구간을 고르게 나눠 주고, 노드 추가·제거가 예전 `initial_token` 수동 설정보다 훨씬 수월하다.

### Scylla 한눈에

| 항목 | 내용 |
|------|------|
| 호환성 | Cassandra 대체품, CQL·도구 그대로 |
| 성능 | JVM Cassandra보다 지연이 낮고 처리량이 높다 |
| 규모 | 같은 부하에 더 작은 클러스터 |
| 런타임 | C++ — GC pause 없음 |

글쓴이 시리즈 계획: (1) Cassandra 기본 ← 이번 글, (2) Discord의 Cassandra → Scylla 마이그레이션, (3) Scylla가 빠른 이유, (4) 선택 심화(consistent hashing 등).

### Cassandra 아키텍처

| 주제 | 정리 |
|------|------|
| 토폴로지 | masterless ring, 모든 노드가 읽기·쓰기 |
| 조율 | gossip(P2P), master–slave 구조 아님 |
| 확장 | 노드를 넣으면 바로 참여하고, 성능도 대체로 선형으로 늘어난다 |
| 장애 처리 | gossip이 끊기면 down 처리, replica와 hinted handoff로 메운다 |
| 쓰기 경로 | commit log → memtable → SSTable(디스크, immutable) |

### 데이터 모델

- 계층: **Keyspace → Table → Row → Column** (RDBMS DB/Table/Row/Column과 비슷하다).
- **Wide-column store** — 같은 테이블이라도 row마다 column 구성이 달라질 수 있다. 분석용 columnar store와는 다르다.
- **Partition key**가 어느 노드에 둘지 정한다. `(channel_id, bucket)`처럼 복합 키로 관련 row를 묶는 패턴도 있다(글의 Discord 메시지 예시).

### 분산과 virtual node

1. partition key를 해시해 ring 위 token을 구한다.
2. 물리 노드는 **virtual node**(`cassandra.yaml`의 `num_tokens`)로 token 구간을 여러 개 가진다.
3. **Replication factor**만큼 다른 노드에도 복제본을 둔다(RF=3이면 세 노드).
4. vnode가 부하를 고르게 퍼뜨리고, 노드가 늘거나 줄 때 리밸런스도 빨라진다. 예전 `initial_token` 수동 작업을 대체한다.

### 읽기·쓰기 특이점

- **DELETE**는 tombstone을 남긴다. compaction이나 GC 때 비로소 지워지므로, 바로 사라지지는 않는다.
- **UPDATE**는 delete + insert로 구현된다(SSTable이 immutable). Elasticsearch랑 비슷한 쪽이다.

### 글에서 언급한 use case

| 패턴 | Cassandra가 맞는 이유 |
|------|----------------------|
| 시계열 / 메시징 | 엔티티 ID + time bucket으로 partition, clustering key로 정렬 |
| 이커머스 카탈로그·추천 | 쓰기 중심, 엔티티 단위, 멀티 리전 복제 — **결제 같은 ACID 트랜잭션에는 맞지 않다** |

### 예시 스키마(원문)

```sql
CREATE TABLE messages (
   channel_id bigint,
   bucket int,
   message_id bigint,
   author_id bigint,
   content text,
   PRIMARY KEY ((channel_id, bucket), message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);
```

`(channel_id, bucket)`이 partition key, `message_id`가 파티션 안 정렬 키다.

---

## 메모

회사 Scylla 작업 전에 읽어 둔 배경 정리. 후속 주제는 Next Research에 적어 두었다.
