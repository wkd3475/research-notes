---
title: 'RDS Proxy와 Aurora failover 아키텍처'
---

## 레퍼런스

- [RDS Proxy concepts and terminology](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.howitworks.html)
- [Amazon RDS Proxy for Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.html)
- [Working with Amazon RDS Proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-endpoints.html)
- [Avoiding pinning an RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-pinning.html)
- [Using RDS Proxy with Aurora global databases](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-gdb.html)
- [Improving application availability with Amazon RDS Proxy](https://aws.amazon.com/blogs/database/improving-application-availability-with-amazon-rds-proxy/)
- [Improve application availability on Amazon Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/)
- [Using the Failover Plugin (AWS Advanced JDBC Wrapper)](https://github.com/aws/aws-advanced-jdbc-wrapper/blob/main/docs/using-the-jdbc-driver/using-plugins/UsingTheFailoverPlugin.md)
- [Introducing the Advanced JDBC Wrapper Driver](https://aws.amazon.com/blogs/database/introducing-the-advanced-jdbc-wrapper-driver-for-amazon-aurora/)
- 이전 노트: [JDBC failover 감지와 최소 다운타임](/research-notes/ko/notes/jdbc-failover-minimal-downtime/)

---

## 왜 이 글을 찾아봤나

[JDBC failover 감지와 최소 다운타임](/research-notes/ko/notes/jdbc-failover-minimal-downtime/) 후속. **Proxy가 DNS를 우회하고 idle connection을 보존하는 방식**, 그리고 **AWS JDBC Wrapper와 비교**를 보고 싶었다.

---

## 읽으면서 느낀 점

따로 남긴 소감은 없다. Proxy 쪽 동작이랑 Wrapper랑 비교하는 게 목적이었다.

---

## 배운 것

*배경: JDBC failover 노트에 이어, 같은 선생님이 RDS Proxy를 자세히 푼다.*

---

### Act 1 — Proxy가 서는 위치

:::chat student AI 학생
JDBC 노트에서는 Proxy가 “DNS 고정” 한 줄이었어요. 정체가 뭔가요?
:::

:::chat teacher 선생님
RDS Proxy는 앱과 Aurora 클러스터 **하나** 사이에 두는 **관리형 multi-AZ 프런트도어**야. DB 프로토콜을 읽어서, DB 쪽엔 **커넥션 풀**을 모아 두고, 클라이언트엔 cluster writer DNS 대신 **proxy endpoint**를 열어 줘.

| 구간 | 역할 |
|------|------|
| Client → Proxy endpoint | 앱 TCP/TLS 세션 (보통 많음) |
| Proxy → Aurora 인스턴스 | 더 적은 수의 풀링된 DB 연결 |
| Target group | Aurora 클러스터; Proxy가 현재 writer를 찾음 |

Proxy 인프라는 DB와 **따로** 있고(부하에 따라 스케일하는 serverless), proxy 하나 ↔ 클러스터 하나. 같은 클러스터에 proxy를 **여러 개** 붙일 수는 있어.
:::

:::chat student AI 학생
multiplexing이랑 pinning이 계속 나오는데 차이가 뭐예요?
:::

:::chat teacher 선생님
**Multiplexing**(기본): **트랜잭션이 끝날 때마다** 그 아래 DB 연결을 풀에 반환하고, 다음 트랜잭션엔 다른 연결을 줄 수 있어(**borrowing**).

**Pinning**: 그 DB 연결을 다른 세션에 빌려주기 **위험하다**고 보면, 클라이언트가 끊을 때까지 한 DB 연결에 세션을 붙잡아 둬.

failover가 매끄럽고 풀이 잘 돌아가려면 **가능하면 multiplexed**로 두는 게 핵심이야.
:::

---

### Act 2 — Failover: 클라이언트가 덜 걱정해도 되는 것

:::chat student AI 학생
Aurora failover에서 Proxy가 앱에 바꾸는 건 뭐예요?
:::

:::chat teacher 선생님
Proxy가 없으면 클라이언트는 죽은 소켓을 잡고, **cluster writer DNS**가 새 primary를 가리킬 때까지 기다린 다음, **OS/JVM DNS 캐시**를 비우고 다시 붙여야 해. Aurora 쪽 failover는 빠른데, 블로그들이 말하듯 긴 꼬리는 **DNS + 클라이언트 복구**야.

Proxy를 쓰면([concepts — Failover](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy.howitworks.html)):

- **같은 endpoint / IP**로 계속 연결을 받음
- 인스턴스 역할은 **클러스터 메타데이터**로 추적(클라이언트 DNS가 아님)
- 준비되면 **새 writer**로 라우팅
- outstanding request가 없는 **idle** 앱 연결은 **유지**
- 실패한 인스턴스 위 **진행 중 트랜잭션/문장**은 **취소** → 앱이 죽은 소켓에서 안 기다리고 바로 재시도
- writer가 없으면 복구 중인 primary에 reconnect 폭풍을 쏘기보다 **요청을 큐**에 쌓을 수 있음
:::

:::chat student AI 학생
그럼 어떤 문제에서 벗어나나요?
:::

:::chat teacher 선생님
문서에 적힌 목록이야. Proxy를 타면 클라이언트가 이런 데 덜 묶여:

1. failover 시 DNS 전파 지연  
2. 로컬 DNS 캐시  
3. (죽은/강등된 writer를 쫓는) connection timeout  
4. 현재 writer가 누군지 모름  
5. 연결을 안 끊고 사라진 옛 writer에 쿼리 응답을 하염없이 기다림  

마지막은 availability 블로그의 Multi-AZ·하드펜스 이야기랑도 맞아. Proxy 없이 소켓 timeout이 느슨하거나 OS keepalive가 수 시간이면, 그 시간이 그대로 장애 시간이 돼.
:::

---

### Act 3 — Idle 보존의 정확한 의미

:::chat student AI 학생
“idle connection 보존”이면 Hikari 풀이 재연결 없이 그대로인가요?
:::

:::chat teacher 선생님
여기서 **idle**은 failover 동안 클라이언트 연결에 **outstanding request가 없다**는 뜻이야. Proxy를 향한 앱 소켓은 그대로 두고, 풀에서 놀고 있던 연결도 대개 살아남아.

그래도 실패하거나 다시 쳐야 하는 경우가 있어:

| 상황 | 동작 |
|------|------|
| 실패한 writer 위에서 트랜잭션/문장 진행 중 | Proxy가 그 **클라이언트 연결을 끊음** → 앱 재시도 |
| writer 승격 전에 write가 필요한 새 borrow | writer가 생길 때까지 큐잉(또는 borrow timeout으로 실패) |
| Aurora 승격 자체 | 그 아래 **writer 없는 구간**은 그대로 — Proxy가 writer를 만들어 내진 못함 |

풀 재생성·TLS reconnect 폭풍은 줄지만, **진행 중 비즈 트랜잭션은 그대로 실패**해. 앱에서 멱등 재시도가 필요해.
:::

---

### Act 4 — 고정 endpoint vs cluster DNS (숫자)

:::chat student AI 학생
실측으로는 얼마나 빨라요?
:::

:::chat teacher 선생님
AWS 블로그 MySQL 테스트 워크로드 기준(앱마다 보장 아님):

| 출처 | 구성 | 대략적인 클라이언트 중단 |
|------|------|-------------------------|
| [Improve availability on Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/) | cluster writer DNS 직결 | ~10초 다운타임+에러; DNS 고정 시 **reader**에 고착 |
| 같은 글 | RDS Proxy R/W endpoint | ~**2초**, 데모에선 연결 에러 없음 |
| [Improving availability with RDS Proxy](https://aws.amazon.com/blogs/database/improving-application-availability-with-amazon-rds-proxy/) | MariaDB Aurora 드라이버(튜닝) 직결 | 평균 ~13.8초 |
| 같은 글 | Proxy 경유(바닐라 MariaDB URL) | 평균 ~**2.9초**(해당 테스트에서 ~79% 개선) |

요지는, Proxy의 **호스트/IP는 failover에 안 바뀌니** 클라이언트 DNS TTL·JVM 캐시가 writer 찾기에 **끼어들지 않는다**는 거야. cluster writer endpoint는 존 TTL ~5초에 리졸버/JVM 캐시가 **더해져**.
:::

---

### Act 5 — Session pinning (조용한 킬러)

:::chat student AI 학생
multiplexing은 언제 깨져요?
:::

:::chat teacher 선생님
세션 상태를 DB 연결끼리 옮기기 위험할 때 Proxy가 pin해([pinning 가이드](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-pinning.html)). **MySQL**에서 자주 걸리는 것:

- 많은 user/system 변수 `SET`(일부는 pin 없이 추적 — `AUTOCOMMIT`, charset/`NAMES`, `SQL_MODE`, `TIME_ZONE`, **세션** scope 트랜잭션 isolation 등)
- 임시 테이블, `LOCK TABLES` / named lock(`GET_LOCK`)
- **Prepared statement**(텍스트·바이너리 프로토콜)
- SQL 텍스트 **16 KB 초과**
- 실행 가능 주석(`/*! … */`)

**PostgreSQL**은 더 빡세. 거의 모든 `SET`, prepared 수명주기, temp, 커서, advisory lock, `LISTEN` 등이 pin. MySQL용 session pinning filter는 있어도 **PostgreSQL에는 없어**.

볼 메트릭은 CloudWatch **`DatabaseConnectionsCurrentlySessionPinned`**.
:::

:::chat student AI 학생
pinning이 failover랑 풀에 왜 중요한가요?
:::

:::chat teacher 선생님
Pinned 세션이면 끊기 전까지 클라이언트가 DB 연결 하나를 독차지해. multiplexing·풀 공유가 바로 무너져.

**reader endpoint**에서도 multiplexed면 앱이 손대지 않아도 다른 reader로 넘어가고, **pinned**면 에러 난 뒤 다시 붙여야 해([proxy endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-endpoints.html)).

흔한 `SET`은 proxy **initialization query**로 빼고, 연결마다 세션 플래그를 맞추고, temp/prepared는 줄여. pinning filter는 앱을 알고 나서만.
:::

---

### Act 6 — Proxy endpoint (R/W vs read-only)

:::chat student AI 학생
기본 proxy endpoint는 항상 writer인가요?
:::

:::chat teacher 선생님
맞아. 기본 endpoint는 **read/write**라서 현재 **writer**로만 가(writer `max_connections`에 가산).

읽기용으로는 **read-only proxy endpoint**를 따로 만들어(proxy당 추가 endpoint 최대 20). Aurora reader에 흘리고, reader가 죽어도 **클라이언트 DNS 없이** 다른 available reader로 넘긴다. Multiplexed면 reader 이동이 부드럽고, pinned면 다시 붙여야 해.

Cross-VPC면 같은 Region의 다른 VPC에 endpoint를 둘 수 있어(PrivateLink).

로그랑 CloudWatch 메트릭은 **endpoint별**(기본 이름 `default`).
:::

---

### Act 7 — Global DB: Proxy ≠ global writer endpoint

:::chat student AI 학생
Proxy가 Region을 넘는 Aurora global writer endpoint 자리를 대신하나요?
:::

:::chat teacher 선생님
**아니.** Proxy는 **지역 클러스터 하나**에 묶여 있어.

[RDS Proxy + Global DB](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/rds-proxy-gdb.html) 기준:

| 대상 클러스터 | R/W proxy endpoint | Read-only proxy endpoint |
|---------------|--------------------|---------------------------|
| Primary | 동작 → 현재 writer | 그 Region reader |
| Secondary | 실패: *no read/write instances* | Reader OK |

**Global switchover/failover** 뒤에는 write를 **새 primary에 걸린 proxy**로 옮겨야 해. 옛 primary의 proxy는 잠깐 write를 받다가 secondary가 되면 깨져. 새 primary writer가 준비되면 그 proxy는 write를 큐에 쌓지만, **앱이 치는 proxy 호스트네임**은 바꿔야 해. Aurora global writer DNS처럼 이름이 하나로 유지되지 않아.

write forwarding을 쓰면 Proxy `MaxConnectionsPercent`를 forwarding 할당만큼 낮추고, Proxy랑 같이 쓸 때 `aurora_replica_read_consistency`의 `SESSION`은 미지원이야.
:::

---

### Act 8 — RDS Proxy vs AWS JDBC Wrapper

:::chat student AI 학생
Proxy, Wrapper, 둘 다 — 언제 고르나요?
:::

:::chat teacher 선생님
문제는 같고(writer 찾기 + stale 소켓), 잡는 층만 달라.

| | **RDS Proxy** | **AWS JDBC Wrapper** |
|--|---------------|----------------------|
| 로직 위치 | 공유 관리형 서비스 | 각 JVM 클라이언트 안 |
| DNS | 고정 proxy endpoint/IP | topology + **instance** endpoint |
| failover 중 idle | Proxy가 보존 | 드라이버가 소켓 재연결; 풀 churn은 남음 |
| Connection multiplexing | 있음(트랜잭션 단위) | 없음(앱 풀만) |
| 부가 이득 | connection storm 제어, Secrets/IAM 프런트, cross-VPC endpoint | 인프라 없이 fast failover; Proxy 불가 구간 |
| 비용·운영 | Proxy + PrivateLink endpoint | 드라이버 설정만 |
| 클라이언트 범위 | MySQL/PG 프로토콜이면 가능 | Java(Wrapper)만 |
| Pinning·multiplexing 함정 | 있음 | 해당 없음 |
| Hikari | 대개 proxy로 바닐라 URL | `HikariCPSQLException` override 필요 |

[Improve availability on Aurora](https://aws.amazon.com/blogs/database/improve-application-availability-on-amazon-aurora/)도 Proxy를 가장 넓은 추상화, Wrapper를 Java 쪽 강점으로 본다. **둘 다** 올리는 건 선택이고, 이미 Proxy가 역할을 알면 Wrapper failover 플러그인 이득은 작아져. 보통은 Wrapper **아니면** Proxy이고, Proxy 앞에서도 Wrapper의 다른 플러그인이 필요할 때만 겹쳐.
:::

---

### 치트시트

```
앱 풀 ──► Proxy endpoint (고정 DNS/IP)
              │  cluster metadata로 writer 추적
              │  idle 클라이언트 세션 유지
              │  in-flight 취소; writer 준비까지 큐
              ▼
         Aurora writer / readers
              │
      Pinning ↓ 재사용·reader 이동을 해침
              │
Global DB: 앱 → 새 Region Proxy R/W endpoint로 전환
```

| 목표 | 선호 |
|------|------|
| 다언어 / Lambda / 드라이버 통제 불가 | **RDS Proxy** |
| Java만, 프로세스 안 topology failover | **AWS JDBC Wrapper** |
| Connection storm + Secrets/IAM 통일 | **Proxy** |
| 인프라·pinning 복잡도 회피 | **Wrapper**(또는 DNS/timeout만 — 약함) |
| Cross-Region Global DB write | global writer endpoint **및/또는** Proxy 호스트 전환 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** Failover 중 Proxy가 “idle connection을 보존”한다. 앱이 그래도 재시도해야 하는 건?
---
실패한 인스턴스에서 **트랜잭션·SQL 문장이 진행 중**이던 연결은 끊긴다. Idle = outstanding request 없음. Aurora의 writer 없는 승격 구간도 남는다. Proxy가 writer를 대신 만들어 주진 않는다.
:::

:::quiz
**Q2.** 고정 Proxy endpoint가 cluster writer DNS보다 복구에 유리한 이유는?
---
Cluster writer DNS는 failover 때 바뀌고(~5초 TTL) OS/JVM/리졸버 캐시까지 탄다. Proxy는 같은 endpoint/IP를 두고 **클러스터 메타데이터**로 타깃만 바꾸니, DNS 전파와 “강등된 reader에 고착”을 건너뛴다.
:::

:::quiz
**Q3.** Proxy 세션을 pin하는 MySQL 동작 두 가지와, 볼 메트릭 하나는?
---
예: prepared statement, 임시 테이블, 많은 `SET`, `LOCK TABLES`/`GET_LOCK`, SQL 텍스트 16 KB 초과. CloudWatch **`DatabaseConnectionsCurrentlySessionPinned`**.
:::

:::quiz
**Q4.** Global DB switchover 뒤 옛 Region Proxy의 R/W endpoint를 그대로 써도 되나?
---
안 된다. Proxy는 지역 클러스터 하나다. Write는 **새 primary의** proxy R/W endpoint로 간다. 옛 primary가 secondary가 되면 그 R/W proxy는 write를 거절한다. Aurora global writer DNS와 달리 Proxy 호스트네임은 Region에 묶인다.
:::

:::quiz
**Q5.** Proxy vs AWS JDBC Wrapper — 한 줄로 구분하면?
---
Proxy는 관리형·프로토콜 공통 DNS/역할 방패 + 풀링(pinning 트레이드오프). Wrapper는 JVM 안 topology 캐시·instance endpoint failover(Java). multiplexing이나 고정 관리형 endpoint는 없다.
:::

---

## 메모

—
