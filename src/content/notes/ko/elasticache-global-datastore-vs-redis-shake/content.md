---
title: 'ElastiCache Global Datastore vs redis-shake'
---

## 레퍼런스

- [Replication across AWS Regions using global datastores](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Redis-Global-Datastore.html)
- [Global Datastore prerequisites and limitations](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/Redis-Global-Datastores-Getting-Started.html)
- [Multi-Region session store with ElastiCache for Valkey Global Datastore (AWS Database Blog)](https://aws.amazon.com/blogs/database/build-a-multi-region-session-store-with-amazon-elasticache-for-valkey-global-datastore/)
- [RedisShake (GitHub, Tair open source)](https://github.com/tair-opensource/RedisShake)
- [RedisShake docs (English)](https://tair-opensource.github.io/RedisShake/en/)
- [RedisShake sync_reader](https://tair-opensource.github.io/RedisShake/en/reader/sync_reader.html)
- [RedisShake README_FOR_AGENTS](https://github.com/tair-opensource/RedisShake/blob/v4/README_FOR_AGENTS.md)

---

## 왜 이 글을 찾아봤나

**Global Datastore**랑 **redis-shake** 차이가 궁금해서.

---

## 읽으면서 느낀 점

비교만 보고 싶었고, 아직 특별히 느낀 점은 없다.

---

## 배운 것

*하는 일이 다르다. Global Datastore는 ElastiCache 안의 **매니지드 교차 Region 복제 토폴로지**고, redis-shake는 Redis 호환 엔드포인트 사이에서 **직접 돌리는 오픈소스 마이그레이션·데이터 가공 도구**다.*

---

### Act 1 — 한 줄로 역할 정리

:::chat gon Gon
Global Datastore랑 redis-shake 차이가 뭐야?
:::

:::chat teacher 선생님
자리에 두면 이렇게 갈린다.

| | **ElastiCache Global Datastore** | **redis-shake** |
|---|----------------------------------|-----------------|
| **무엇인지** | ElastiCache(Valkey / Redis OSS)의 AWS **매니지드 기능** | 직접 배포·운영하는 **오픈소스 바이너리**(Tair 팀) |
| **주 목적** | 오래 돌리는 **교차 Region 비동기 복제** + DR | Redis-like 소스·타깃 사이 **데이터 이동 / 변환** |
| **파이프를 누가 돌리나** | ElastiCache (완전 관리) | 나 (프로세스, 호스트, 설정, 재시작) |
| **토폴로지** | primary Region 1개(읽기/쓰기) + secondary Region 최대 **2개**(읽기 전용) | reader 하나 → writer 하나 (`shake.toml`) |
| **상시 운영** | 가능 — 지역 읽기 + Region DR | **일회성 / 컷오버** 마이그레이션에 맞고, 영구 sync로는 약함 |

“ElastiCache를 다른 Region에 계속 복제해 두고 싶다”면 Global Datastore. “Redis A를 Redis B로 옮긴다(키 필터, 벤더 변경 포함)”면 redis-shake.
:::

---

### Act 2 — Global Datastore (매니지드 교차 Region)

:::chat student AI 학생
Global Datastore는 평소에 어떻게 동작해?
:::

:::chat teacher 선생님
ElastiCache 클러스터를 **global datastore**로 묶는다.

- **Primary (active)** — **쓰기**와 읽기를 받고, 변경분을 밖으로 복제한다.
- **Secondary (passive)** — 다른 AWS Region의 **읽기 전용**. primary에서 비동기로 업데이트를 받는다.

복제 설정·운영은 ElastiCache가 맡는다. AWS 문서가 꼽는 이득은 대략 둘이다.

1. **지역 읽기** — secondary Region 앱이 로컬에서 읽어 지연을 줄인다.
2. **재해 복구** — primary Region이 망가지면 secondary를 **수동으로 promote**해 새 primary로 만든다 (교차 Region autofailover는 없음).

복제는 **비동기**라서 부하·네트워크 상황에 따라 secondary가 조금 뒤처질 수 있다.
:::

:::chat student AI 학생
외워둘 하드 리밋이 뭐야?
:::

:::chat teacher 선생님
공식 prerequisites / limitations 기준:

| 제약 | 내용 |
|------|------|
| **범위** | Amazon **VPC** 안의 node-based ElastiCache (Local Zones 불가) |
| **Region** | primary → secondary는 최대 **두** 다른 Region (중국 Beijing ↔ Ningxia는 예외) |
| **형태 일치** | primary 노드 수, **노드 타입**, **엔진 버전**, **샤드 수**(cluster mode) 동일. Region별 replica 개수는 달라도 됨 |
| **계정** | **동일 AWS 계정**만 — 크로스 계정 Global Datastore 없음 |
| **secondary 부트스트랩** | **기존** 클러스터를 **primary**로 쓸 수는 있음. secondary는 **새로** 만들고, 기존 클러스터를 secondary로 붙이는 건 지원 안 함(데이터 와이프 위험) |
| **Failover** | secondary → primary **수동** promote. Region autofailover 없음 |
| **기타** | IPv6 미지원, durability-enabled 클러스터와 불가, 저장/전송 암호화·AUTH는 지원 |

secondary Region 앱이 쓰려면 (promote 전엔) **primary로 교차 Region 쓰기**를 보내야 한다 (피어링 / TGW 등).
:::

---

### Act 3 — redis-shake (직접 돌리는 마이그레이션 파이프)

:::chat student AI 학생
그럼 redis-shake는 안에서 뭐 해?
:::

:::chat teacher 선생님
Redis 호환 엔드포인트 **사이**에 앉는다. 설정은 reader 하나 + writer 하나.

**Reader (소스를 어떻게 가져오나):**

| Reader | 아이디어 | 언제 |
|--------|----------|------|
| **`sync_reader`** | **PSync**로 **레플리카인 척** — RDB 풀 싱크 후 AOF 증분 스트림 | 소스가 PSync를 말할 때 (Redis / Valkey / Tair; ElastiCache는 `aws_psync` 설정 필요) |
| **`scan_reader`** | `SCAN` + `DUMP`/`RESTORE` (증분은 keyspace notification 경로) | PSync가 안 될 때 |
| **`rdb_reader`** | **RDB 파일** 재생 | 오프라인 / 파일 기반 복원 |

Global Datastore가 안 주는 것: 키 **필터**, Lua **변환** 함수, 이기종 타깃(셀프호스팅 ↔ ElastiCache ↔ MemoryDB ↔ Tair 등).

`./redis-shake shake.toml`(또는 Docker 이미지)을 내가 돌리고, 수명도 내가 챙긴다.
:::

:::chat student AI 학생
왜 문서에서 마이그레이션용이라고 하고, 영구 sync용은 아니라고 해?
:::

:::chat teacher 선생님
RedisShake **4.x** 문서가 꽤 직설적이다.

1. **체크포인트 / resume 없음** — 재시작하면 **처음부터 full resync** (상용 DTS / Tair Global Active-Active와 다름).
2. **토폴로지 고정 가정** — 소스 스케일아웃, failover, 슬롯 마이그레이션이 나면 프로세스가 **panic**할 수 있다.

그래서 **컷오버 구간**의 full + incremental이 맞는 자리. 수년짜리 DR 파이프로 쓰면 재시작·토폴로지 드리프트·운영 리스크를 Global Datastore가 막아 주는 부분까지 내가 진다.
:::

---

### Act 4 — 나란히 놓고 고르기

:::chat student AI 학생
고를 때 치트시트 줘.
:::

:::chat teacher 선생님
| 질문 | **Global Datastore** 쪽 | **redis-shake** 쪽 |
|------|-------------------------|---------------------|
| 동일 AWS 계정, ElastiCache ↔ ElastiCache, **상시** 멀티 Region 읽기/DR? | 예 | 영구 sync로는 과하고 취약 |
| secondary **promote**를 AWS 1급 작업으로? | 예 (수동) | 컷오버를 내가 설계 |
| 소스/타깃이 **다른 클라우드**, **셀프호스팅**, **크로스 계정**? | 불가 (동일 계정 ElastiCache만) | 가능 |
| 복사 중 키 **필터 / 재작성**? | 불가 | 가능 (`filter` / function) |
| 일회 **Region 이전**이나 엔진 업그레이드 컷오버? | 가능하지만 제약 많음 (새 secondary, 형태 일치) | 흔한 패턴 |
| 복제를 AWS가 돌려 주길? | 예 | 아니요 — 바이너리를 내가 돌림 |

한 줄로 잡으면: Global Datastore ≈ “ElastiCache Redis/Valkey용 Aurora Global Database 느낌(active-passive).” redis-shake ≈ “Redis RESP 전용, **내가 운영하는** DMS/DTS급 도구.”
:::

:::chat gon Gon
그럼 같은 일의 대안은 아닌 거지?
:::

:::chat teacher 선생님
겹치는 건 “Redis 데이터를 A에서 B로 옮긴다”까지다. 그다음부터는 갈린다.

- **상시 멀티 Region ElastiCache** → Global Datastore.
- **마이그레이션 / 데이터 가공 / 제품 간 탈출구** → redis-shake (resume가 필요하면 체크포인트 있는 상용 마이그레이터).

타임라인에 **둘 다** 쓸 수도 있다. redis-shake로 ElastiCache에 옮긴 뒤, 상시 DR은 Global Datastore로 — 단계가 다르지, 평생 하나만 고르는 문제가 아니다.
:::

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** Global Datastore vs redis-shake — 복제 프로세스를 누가 소유하나?
---
Global Datastore: **ElastiCache가** 교차 Region 비동기 복제를 관리한다. redis-shake: **내가** 바이너리를 돌리고 운영한다 (설정, 호스트, 재시작).
:::

:::quiz
**Q2.** Global Datastore secondary는 쓰기를 받나?
---
**아니요** — secondary는 **읽기 전용**이다. **수동 promote**로 primary가 되기 전까지는 그렇다. secondary Region 앱이 쓰려면 primary로 쓰기를 보내거나, promote 뒤에는 새 primary로 보낸다.
:::

:::quiz
**Q3.** redis-shake 4.x가 영구 DR 파이프로 약한 이유는?
---
**체크포인트/resume가 없고**(재시작 = full resync), 클러스터 토폴로지를 **고정**으로 가정한다(failover/스케일/슬롯 이동 시 panic 가능). 마이그레이션 컷오버용이지 장기 continuous sync용이 아니다.
:::

:::quiz
**Q4.** Global Datastore 한계 중 redis-shake로 밀리는 것 두 가지?
---
예: **동일 AWS 계정만**; 형태가 맞는 ElastiCache↔ElastiCache node-based; secondary Region 최대 **둘**; 크로스 클라우드 불가. 크로스 계정, 셀프호스팅, 필터/변환 복사는 보통 redis-shake(또는 유사 도구) 쪽이다.
:::

---

## 메모

—
