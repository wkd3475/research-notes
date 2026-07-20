---
title: 'Envoy xDS와 universal data plane API (5강)'
---

## 레퍼런스

- [The universal data plane API — Matt Klein](https://blog.envoyproxy.io/the-universal-data-plane-api-d15cec7a)
- [xDS protocol — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol)
- [How Envoy Proxy Works Internally — Let's Build](https://letsbuildsolutions.com/blog/system-design/how-envoy-proxy-works-internally-xds-configuration-connection-pooling-and-the-filter-chain-architecture-behind-modern-service-meshes/)
- 부모: [Envoy filter chain (4강)](/research-notes/ko/notes/envoy-filter-chain/)
- 시리즈: [threading](/research-notes/ko/notes/envoy-threading-model/) · [hot restart](/research-notes/ko/notes/envoy-hot-restart/) · [stats](/research-notes/ko/notes/envoy-stats/)

---

## 왜 이 글을 찾아봤나

Envoy에 대해 여러 시리즈에 걸쳐 알면 좋은 디테일한 내용을 읽고, 선생님 강의처럼 노트로 정리해 달라고 했다. 설정이 데이터 플레인에 닿는 길을 닫는 강의.

---

## 읽으면서 느낀 점

별도로 남긴 감상은 없다. 강의 형식으로 정리해 달라는 요청만 있었다.

---

## 배운 것

*5강. 필터와 worker가 엔진이면, xDS는 바이너리를 다시 안 짜고 지도만 바꾸는 방법이다.*

---

### Act 1 — “universal data plane API”가 나온 이유

:::chat student AI 학생
Matt Klein가 풀려던 문제는?
:::

:::chat teacher 선생님
Envoy의 매력은 **성능 + 확장성 + 동적 설정**의 합이다. 초기에 클러스터 멤버십용 단순 **SDS** REST API를 만들어 DNS 한도·메타데이터 한계를 넘었다.

오픈소스 직후 Consul/K8s/Marathon 어댑터 요청이 많았다. 인트리 어댑터는 거의 안 들어왔고, 대신 각자 컨트롤 플레인에서 **SDS API**를 구현했다. 데이터 플레인에서 멀수록 의견이 세지니, **얇은 공통 API**가 사이트 워크플로를 살린다는 교훈이다.

그게 v1 관리 API **SDS / CDS / RDS / LDS**로 자랐고, Istio·Nelson 같은 컨트롤 플레인이 REST/JSON 폴링으로 런타임 설정을 거의 다 밀어 넣었다.
:::

:::chat student AI 학생
왜 v2 / proto3 / gRPC로 가나?
:::

:::chat teacher 선생님
v1 고통: JSON/REST + 폴링 — 타입 약함, 채터, 다국어 stub 어려움, 자원 타입별 독립 폴링의 순서 위험.

v2(구글과): **proto3**, gRPC 스트림(+ REST/JSON 변형), 전용 data-plane API 저장소, 강한 타입, 확장용 opaque 메타데이터. 가족 이름: **xDS**.
:::

---

### Act 2 — 자원 타입

:::chat student AI 학생
알파벳 치트시트요.
:::

:::chat teacher 선생님
| API | 자원 | 다루는 것 |
|-----|------|-----------|
| **LDS** | Listener | bind, filter chain |
| **RDS** | Route | virtual host / 라우트 테이블 (종종 HCM이 참조) |
| **CDS** | Cluster | upstream 정의, CB 임계값, 프로토콜 옵션 |
| **EDS** | Endpoint | 클러스터 안 호스트 + weight |
| **SDS** | Secret | 인증서, 키, SPIFFE SVID |

학습용 정적 YAML은 괜찮다. 운영은 거의 xDS로 밀어 **프로세스 안 내리고** 설정을 바꾼다(바이너리 hot restart와는 별개).
:::

---

### Act 3 — ADS, delta xDS, ACK/NACK

:::chat student AI 학생
ADS가 뭐고 순서가 왜 중요해요?
:::

:::chat teacher 선생님
초기는 자원 타입마다 **gRPC 스트림 하나**. 버전이 따로 놀면: CDS가 클러스터를 말하기 전에 EDS가 비어 있으면 잠깐 블랙홀.

**ADS(Aggregated Discovery Service)**는 타입을 **하나의 순서 있는 스트림**에 모아 컨트롤 플레인이 순서를 정하게 한다.
:::

:::chat student AI 학생
SotW vs incremental / delta xDS?
:::

:::chat teacher 선생님
| 모드 | 동작 |
|------|------|
| **State-of-the-world (classic)** | 그 타입의 전체 집합을 매번 보냄 |
| **Incremental / delta xDS** | diff: 추가/갱신 / `removedResources` |

EDS 카디널리티가 크면 SotW 비용이 크다. 엔드포인트 하나 바뀌어도 전체를 다시 보낼 수 있다. Delta는 패치만.

흐름 제어: 응답에 **nonce**; Envoy가 그 nonce로 **ACK**, 적용 실패면 `errorDetail`로 **NACK**. fire-and-forget이 아니라 정확성 프로토콜에 가깝다.
:::

:::chat student AI 학생
1강 스레딩이랑 어떻게 맞물려요?
:::

:::chat teacher 선생님
xDS 클라이언트 일은 **main** 스레드. 적용된 설정은 worker **TLS** 슬롯으로 발행(1강). LDS의 listener/filter chain이 4강에서 실행된다. hot restart(2강)는 *바이너리*를 갈아끼우고, xDS는 프로세스가 살아있는 동안 *지도*를 갈아끼운다.
:::

---

### 에세이의 산업 각도

:::chat teacher 선생님
Matt Klein의 내기: 데이터 플레인은 상품화되고, **컨트롤 플레인**이 차별화한다(글로벌 LB, subsetting, progressive delivery). 공통 xDS류 API면 컨트롤이 여러 데이터 플레인을, 데이터 플레인이 여러 컨트롤을 상대할 수 있다.

벤더가 다 모일지는 역사 진행 중. Envoy 사용자에게 실무 포인트는 YAML 조각만이 아니라 **xDS 자원 그래프**를 익히는 것이다.
:::

---

### 요약표

| 개념 | 한 줄 |
|------|-------|
| Universal data plane API | 의견 센 컨트롤과 빠른 데이터 플레인 사이 얇은 계약 |
| xDS 알파벳 | LDS / RDS / CDS / EDS / SDS |
| ADS | 순서 있는 한 스트림 |
| Delta | 전체 세계가 아니라 diff |
| ACK/NACK | nonce로 적용 성공/실패를 명시 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 사이트들이 Envoy에 Consul/K8s 어댑터를 넣지 않고 SDS를 구현한 이유는?
---
컨트롤 플레인 관심사는 사이트마다 의견이 세다. 작은 discovery API를 로컬에서 구현하는 편이 레지스트리마다 데이터 플레인에 넣는 것보다 쉬웠다.
:::

:::quiz
**Q2.** ADS가 타입별 독립 스트림 대비 줄이는 실패 모드는?
---
순서 레이스 — 예: EDS가 채우기 전에 CDS가 클러스터를 참조 — 를 한 시퀀스 스트림에 타입을 모아 줄인다.
:::

:::quiz
**Q3.** SotW 대신 delta xDS가 값진 때는?
---
자원 집합이 클 때(특히 EDS). SotW는 변경마다 전체를 다시 보내고, delta는 추가/갱신/삭제만 보낸다.
:::

:::quiz
**Q4.** xDS 업데이트가 요청 경로 lock 없이 worker에 닿는 방법은?
---
main이 xDS 클라이언트를 돌리고 설정을 적용한 뒤, worker별 TLS 슬롯으로 발행한다(1강 클러스터 업데이트와 같은 패턴).
:::

---

## 메모

강의 형식 시리즈 요청 — 추가 메모 없음.
