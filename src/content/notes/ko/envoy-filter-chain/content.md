---
title: 'Envoy filter chain과 network filter (4강)'
---

## 레퍼런스

- [How to Write Envoy Filters Like a Ninja! — Part 1](https://blog.envoyproxy.io/how-to-write-envoy-filters-like-a-ninja-part-1-d166e5abec09)
- [Taming a Network Filter](https://blog.envoyproxy.io/taming-a-network-filter-44adcf91517)
- [Life of a request — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request)
- [HTTP connection management — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_connection_management)
- 시리즈: [threading](/research-notes/ko/notes/envoy-threading-model/) · [hot restart](/research-notes/ko/notes/envoy-hot-restart/) · [stats](/research-notes/ko/notes/envoy-stats/)

---

## 왜 이 글을 찾아봤나

Envoy에 대해 여러 시리즈에 걸쳐 알면 좋은 디테일한 내용을 읽고, 선생님 강의처럼 노트로 정리해 달라고 했다. 아키텍처 강의 다음 필터 시리즈.

---

## 읽으면서 느낀 점

별도로 남긴 감상은 없다. 강의 형식으로 정리해 달라는 요청만 있었다.

---

## 배운 것

*4강. worker가 연결을 고정해 두면, 그 위에서 실제로 도는 게 필터다.*

---

### Act 1 — 필터 계층 셋

:::chat student AI 학생
계층이 어떻게 되나요?
:::

:::chat teacher 선생님
Ninja 시리즈 Part 1 기준:

| 계층 | 언제 / 무엇 |
|------|-------------|
| **Listener filter** | 연결 초반 — raw 바이트 + 메타데이터 (예: TLS Inspector, SNI) |
| **Network filter** | L4 / TCP 양방향 (예: TCP Proxy, **HTTP Connection Manager**) |
| **HTTP filter** | L7 — HCM이 만듦. 요청/응답 (JWT, RBAC, router, transcoder …) |

파이프라인 스케치:

```
Downstream TCP
  → Listener (bind / accept)
    → Filter-chain match (SNI, ALPN, source IP …)
      → Network filters
        → (선택) HCM → HTTP filters → Router
          → Cluster → LB → Connection pool → Upstream
```

HCM도 network filter다. 그래서 HTTP filter 전에 network filter를 알아야 한다.
:::

---

### Act 2 — stateful 체인, read vs write

:::chat student AI 학생
서블릿 Filter랑 뭐가 다른가요?
:::

:::chat teacher 선생님
**연결마다 stateful.** network filter 인스턴스가 연결마다 새로 생긴다. 싱글톤이 아니다.

방향:

- **Read path**: Downstream → Envoy → Upstream
- **Write path**: Upstream → Envoy → Downstream

콜백: `onNewConnection`, `onData`, `onWrite`, 연결 이벤트. **`StopIteration`**은 *이번 iteration*에서 뒤 필터를 호출하지 말라는 뜻이지, 연결을 영원히 멈추라는 뜻이 아니다.

다음 데이터 청크가 오면 **새 iteration**이 시작된다. 외부 auth를 기다리면 준비가 될 때까지 `onData`/`onWrite`에서 계속 `StopIteration`을 돌려야 한다.
:::

:::chat student AI 학생
read buffer 함정은?
:::

:::chat teacher 선생님
read 경로는 버퍼가 있다. 앞 필터가 drain하지 않으면 같은 바이트를 다음 `onData`에서 **다시** 볼 수 있다. 기본 read 한도 약 **1MiB** — 넘으면 소켓 read를 멈춘다(backpressure).

write 경로에는 “필터에게 다시 보여주는 write buffer”가 대칭으로 없다. write에서 `StopIteration`은 그 iteration 데이터가 뒤 필터로 안 간다는 쪽에 가깝다 — read와 의미가 다르다.
:::

---

### Act 3 — flow control과 실전 패턴

:::chat student AI 학생
여기서 flow control / backpressure는?
:::

:::chat teacher 선생님
downstream 연결의 write buffer가 가득 차면 upstream에서 더 읽지 않는다(반대도). 종단 프록시(TCP Proxy / HCM)가 상당 부분을 맡는다. 데이터를 붙잡거나 inject하는 커스텀 필터도 같은 감각을 지켜야 버퍼 폭탄이 안 된다.
:::

:::chat student AI 학생
“Taming a Network Filter”의 쓸모 있는 패턴은?
:::

:::chat teacher 선생님
1. **Gatekeeping**(RBAC, ext_authz, rate limit): 앱 프로토콜을 안 파고 허용/거부. TLS면 `onNewConnection`이 핸드셰이크 **전**에 올 수 있다. peer cert가 필요하면 `onEvent(Connected)`까지 기다려라.

2. **프로토콜 stats/메타데이터**(Mongo, MySQL, Kafka …): 파싱해 메트릭만 내고 라우팅은 TCP Proxy에 맡긴다. 뒤 필터(보통 TCP Proxy)가 read buffer를 **drain**한다는 전제다. parser와 TCP Proxy 사이에 아무 필터나 끼우면 그 전제가 깨진다.

3. **트래픽 변형**(fault / throttle): 다음 청크를 넘기는 시점을 늦춘다 — 타이머 + `injectReadDataToFilterChain` 등.

4. **종단 프록시**: TCP Proxy / HCM이 체인 끝 — upstream을 열고 포워딩. gatekeeper가 TCP Proxy 전에 `onNewConnection`에서 `StopIteration`하면 read가 교착될 수 있고, 너무 일찍 `Continue`하면 auth 전에 TCP Proxy가 upstream에 붙는다. 날카로운 모서리다.
:::

---

### 요약표

| 개념 | 기억할 것 |
|------|-----------|
| HCM | HTTP 필터 체인을 소유한 network filter |
| StopIteration | iteration 단위. 영구 pause 아님 |
| Read buffer | 재전달 가능. 1MiB면 read 중지 |
| Connected | TLS 핸드셰이크 후 — TLS 인지 gatekeeper용 |
| Parser + TCP Proxy | drain 전제면 붙여 두기 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** HTTP filter 전에 network filter를 공부하는 이유는?
---
HTTP 지원이 HTTP Connection Manager라는 network filter로 구현돼 있다. HTTP filter는 HCM 서브파이프라인 안에만 있다.
:::

:::quiz
**Q2.** `StopIteration`이 연결을 continue할 때까지 멈추나?
---
아니다. 이번 iteration에서 뒤 필터만 건너뛴다. 다음 I/O가 오면 새 iteration이 시작되고, 기다리는 필터는 조건이 될 때까지 계속 stop해야 한다.
:::

:::quiz
**Q3.** TLS 클라이언트 인증 필터가 `onNewConnection`에서 외부 호출하면 왜 위험한가?
---
TLS 핸드셰이크가 아직 안 끝났을 수 있다. 핸드셰이크 성공 후 오는 `onEvent(Connected)`까지 기다려 TLS 메타데이터를 써라.
:::

:::quiz
**Q4.** Mongo stats 필터와 TCP Proxy 사이에 아무 필터나 넣으면?
---
stats 필터는 `onData`가 drain된 뒤의 새 청크라고 가정할 수 있다. 가운데 필터가 drain하지 않으면 파싱이 깨지거나 같은 데이터를 중복으로 본다.
:::

---

## 메모

강의 형식 시리즈 요청 — 추가 메모 없음.
