---
title: 'Envoy threading model (1강)'
---

## 레퍼런스

- [Envoy threading model — Matt Klein](https://blog.envoyproxy.io/envoy-threading-model-a8d44b922310)
- [Threading model — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/intro/threading_model)
- [How Envoy Proxy Works Internally — Let's Build](https://letsbuildsolutions.com/blog/system-design/how-envoy-proxy-works-internally-xds-configuration-connection-pooling-and-the-filter-chain-architecture-behind-modern-service-meshes/)

---

## 왜 이 글을 찾아봤나

Envoy에 대해 여러 시리즈에 걸쳐 알면 좋은 디테일한 내용을 읽고, 선생님 강의처럼 노트로 정리해 달라고 했다.

---

## 읽으면서 느낀 점

별도로 남긴 감상은 없다. 강의 형식으로 정리해 달라는 요청만 있었다.

---

## 배운 것

*Envoy 시리즈 첫 강의. 데이터 경로가 거의 lock-free인 이유와, 그 대가가 뭔지부터.*

---

### Act 1 — 스레드 세 종류

:::chat student AI 학생
Envoy 스레딩 모델을 한 문장으로요.
:::

:::chat teacher 선생님
**프로세스 하나, 스레드 여러 개**, 대부분 non-blocking. 연결마다 프로세스를 안 띄우고, 한 프로세스 안에 이벤트 루프를 여러 개 둬서 대량 연결을 처리한다.
:::

:::chat student AI 학생
스레드 종류는요?
:::

:::chat teacher 선생님
공식 문서랑 Matt Klein 글을 맞춰 보면:

| 스레드 | 하는 일 |
|--------|---------|
| **Main** | 조율: xDS/설정, 클러스터 멤버십, stats flush, admin API. 대용량 데이터 경로는 안 맡는다. |
| **Worker** (`--concurrency`) | listen, accept, 필터 체인, 포워딩. 팁: 하드웨어 스레드 수만큼. |
| **File flusher** | access log를 디스크로 밀어 worker가 디스크 I/O에 안 막히게. |

main·worker는 각각 `Event::Dispatcher`(libevent 래퍼)를 돌린다. FD, 타이머, (main이면) 시그널. 핫 패스는 콜백으로 짜고, 막히지 않는다고 가정한다.
:::

---

### Act 2 — 커넥션 고정

:::chat student AI 학생
누가 accept하고, 나중에 스레드를 바꾸나요?
:::

:::chat teacher 선생님
기본값은 **모든 worker가 모든 listener를 listen**한다. accept 분산은 **커널**이 한다.

한 worker가 accept한 연결은 **평생 그 worker에 고정**된다.

- 이후 I/O·포워딩도 그 worker
- 한가한 worker로 중간에 넘기지 않음

그래서:

1. 핫 패스가 병렬이고 대체로 lock-free
2. 캐시 지역성이 좋다
3. 느린 worker는 이미 붙인 연결을 떠넘길 수 없다
4. HTTP/2·gRPC처럼 오래 사는 멀티플렉스 연결은 worker 부하가 한쪽으로 쏠릴 수 있다

문서 팁: 긴 연결이 소수일 때는 **listener connection balancing**으로 accept를 강제로 나눈다. Windows는 커널 밸런싱이 잘 안 맞아 Envoy가 balancing을 강제한다.
:::

:::chat student AI 학생
worker끼리 upstream 연결을 공유하나요?
:::

:::chat teacher 선생님
안 한다. worker마다 **자기 pool**이 있다. worker 3이 `payments`로 가면 worker 3 pool만 쓴다. 대략 **N workers × pool size**만큼 같은 upstream 호스트로 소켓이 열릴 수 있다. Matt Klein 설계는 코드를 단순하고 병렬로 짜려고 메모리·FD를 좀 더 쓸 수 있다고 본 셈이다.
:::

---

### Act 3 — TLS 슬롯과 RCU 스타일 갱신

:::chat student AI 학생
main이 xDS로 클러스터를 바꾸면, worker는 요청마다 lock 없이 어떻게 보나요?
:::

:::chat teacher 선생님
여기 TLS는 암호 TLS가 아니라 **Thread Local Storage**.

1. main이 **slot**(스레드별 벡터 인덱스)을 잡는다
2. main이 무거운 일(CDS/EDS, DNS, 헬스체크 결과)을 한다
3. 각 worker dispatcher에 **post**로 클로저를 보낸다
4. 이벤트 사이 quiescent 구간에 worker가 thread-local 뷰를 갈아끼운다
5. 요청 처리 중에는 슬롯이 밑에서 바뀌지 않는다 — RCU와 비슷

그래서 worker는 요청마다 lock 없이 클러스터/엔드포인트를 읽는다. 필터 코드 대부분은 단일 스레드처럼 짜면 된다.
:::

:::chat student AI 학생
그럼 완전 lock-free인가요?
:::

:::chat teacher 선생님
아니다. Matt Klein도 말한다. non-blocking을 가정하지만 **프로세스 전역 lock**이 조금 있다. 요지는 요청 경로에 경쟁하는 lock을 두지 말고, 조율은 main + TLS publish로 밀라는 것.
:::

---

### 요약표

| 개념 | 기억할 것 |
|------|-----------|
| 프로세스 모델 | 프로세스 1 + worker N + main (+ log flusher) |
| accept | 커널이 나누고, 연결은 worker에 고정 |
| 설정 경로 | main → post → worker TLS slot |
| 대가 | concurrency 높으면 upstream 소켓·메모리 증가 |
| 손잡이 | `--concurrency`, listener connection balancing |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** worker W가 downstream TCP를 accept한 뒤, 다른 worker가 그 연결의 이후 요청을 처리할 수 있나?
---
없다. 연결은 W에 평생 고정된다. 그래서 HTTP/2·gRPC “뚱뚱한” 연결이 worker 부하를 한쪽으로 쏠리게 만들 수 있다.
:::

:::quiz
**Q2.** main이 클러스터 멤버십 변경을 worker에 어떻게 알려서 요청마다 lock을 안 타게 하나?
---
TLS 슬롯: main이 각 worker dispatcher에 업데이트를 post하고, worker는 이벤트 사이에 새 뷰를 설치한다(RCU 유사). 요청 경로는 thread-local 스냅샷만 읽는다.
:::

:::quiz
**Q3.** 커널이 이미 accept를 나누는데도 listener connection balancing을 켜는 이유는?
---
오래 사는 멀티플렉스 연결이 소수면 커널 밸런싱만으로 한 worker가 과부하될 수 있다. balancing으로 accept를 강제로 나눈다(비용 있음. Windows는 강제).
:::

:::quiz
**Q4.** 이 스레딩 모델의 메모리/연결 트레이드오프는?
---
worker가 upstream pool을 공유하지 않아 N workers가 같은 upstream에 ~N × pool_size 연결을 열 수 있다. lock-free 데이터 경로와 높은 병렬성을 위해 소켓·메모리를 더 쓸 수 있다.
:::

---

## 메모

강의 형식 시리즈 요청 — 추가 메모 없음.
