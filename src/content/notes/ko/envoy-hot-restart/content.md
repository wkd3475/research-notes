---
title: 'Envoy hot restart (2강)'
---

## 레퍼런스

- [Envoy hot restart — Matt Klein](https://blog.envoyproxy.io/envoy-hot-restart-1d16b14555b5)
- [Hot restart — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/operations/hot_restart)
- 부모: [Envoy threading model (1강)](/research-notes/ko/notes/envoy-threading-model/)
- [How Envoy Proxy Works Internally — Let's Build](https://letsbuildsolutions.com/blog/system-design/how-envoy-proxy-works-internally-xds-configuration-connection-pooling-and-the-filter-chain-architecture-behind-modern-service-meshes/)

---

## 왜 이 글을 찾아봤나

Envoy에 대해 여러 시리즈에 걸쳐 알면 좋은 디테일한 내용을 읽고, 선생님 강의처럼 노트로 정리해 달라고 했다. threading 다음 두 번째 강의.

---

## 읽으면서 느낀 점

별도로 남긴 감상은 없다. 강의 형식으로 정리해 달라는 요청만 있었다.

---

## 배운 것

*2강. worker가 연결을 고정한다는 걸 알았으니, 다음 ops 질문 — listen 트래픽을 안 놓치고 Envoy 바이너리를 어떻게 갈아끼우나?*

---

### Act 1 — 무중단 배포 두 갈래

:::chat student AI 학생
Matt Klein가 배포 이야기부터 꺼내는 이유는?
:::

:::chat teacher 선생님
트래픽을 안 떨어뜨리는 배포는 크게 둘이다.

| 방식 | 아이디어 |
|------|----------|
| **(1) immutable / rolling** | 새 노드에 올리고 트래픽을 옮긴 뒤(카나리, % 롤, 블루/그린) 옛 노드를 내린다. 오케스트레이션이 있을 때 최선. |
| **(2) in-place hot restart** | 같은 노드에서 프로세스만 다시 올려 기존 연결을 유지한다. 투자 비용이 작다. |

Envoy는 (1)을 돕는 쪽(메시 데이터 플레인, Istio 트래픽 시프트)이기도 하다. 그런데 **Envoy 자신**도 업그레이드해야 하고, 현장은 아직 (2)가 필요한 곳이 많다. 그래서 hot restart가 설계 목표다. 인프라 나머지엔 **논리적으로 프로세스 하나**처럼 보여야 한다.
:::

---

### Act 2 — 구조: 프로세스 둘, listen 얼굴은 하나

:::chat student AI 학생
hot restart 순서를 걸어 주세요.
:::

:::chat teacher 선생님
문서 + Matt Klein + 최근 정리를 합치면:

1. 새 Envoy가 뜬다(새 epoch), 조율 채널에 붙는다
2. 새 프로세스가 **완전히 초기화**한다 — 설정 로드, 초기 discovery/헬스체크 — **그다음** listen 소켓을 받는다
3. 옛 프로세스에서 **listen 소켓 FD**를 받아(UDS RPC) accept를 시작한다
4. 옛 프로세스는 **drain**: 새 수락을 줄이거나 멈추고, `--drain-time-s` 동안 기존 연결을 끝내거나 닫는다
5. drain / `--parent-shutdown-time-s` 뒤 옛 프로세스가 종료한다

문서의 핵심:

> 기존 연결은 새 프로세스로 **이전되지 않는다**. drain 동안 끝나거나 끊긴다.

“무중단”은 **listen 연속성 + graceful drain**이지, 진행 중 TCP 세션을 새 바이너리로 마법처럼 옮기는 게 아니다.
:::

:::chat student AI 학생
컨테이너가 다르면 두 프로세스는 어떻게 대화하나요?
:::

:::chat teacher 선생님
**Unix domain socket**(RPC)과, 초기 설계에서는 일부 공유 상태용 **shared memory**뿐이다. 같은 프로세스 안에서 worker만 재시작하는 trampoline은 immutable 컨테이너에 안 맞는다.

Lyft는 작은 **hot-restarter 래퍼**(트리의 `restarter/hot-restarter.py`)로 runit 같은 매니저에는 부모 하나만 보이게 했다.
:::

---

### Act 3 — 겹치는 동안의 stats, 소켓, 함정

:::chat student AI 학생
두 프로세스가 살아 있는 동안 메트릭은?
:::

:::chat teacher 선생님
목표: 운영 입장에선 여전히 **논리 Envoy 하나**.

- 지금 문서: counter(와 대부분 gauge)는 UDS로 old → new; `NeverImport` gauge는 제외; 끝나면 import한 gauge는 정리; `server.hot_restart_generation`은 유지
- Matt Klein 원글: counter/gauge 값을 shared memory에 둬 두 epoch가 공유 — **3강**에서 그 설계가 어떻게 바뀌었는지 다룬다

어느 쪽이든 겹치는 구간에 stats “블랙홀”을 피하려는 것이다.
:::

:::chat student AI 학생
reuse_port랑 concurrency 변경은?
:::

:::chat teacher 선생님
Linux 기본 `reuse_port`는 worker index별로 소켓을 넘겨 일반적인 경우 accept 큐 드롭을 피한다.

문서 **Attention**: restart 때 concurrency가 **줄어들면** 옛 worker accept 큐의 일부 연결이 떨어질 수 있다. 늘리는 쪽은 괜찮다.

listener `socket_options`를 hot restart로 바꾸는 건 미지원 — 옛 옵션이 남는다. 전체 재시작이나 LDS listener 업데이트를 쓴다. Windows는 hot restart 미지원.

운영에서 자주 나오는 실수: `--drain-time-s`가 긴 gRPC 스트림 P99보다 짧으면 스트림 중간에 끊긴다.
:::

---

### 요약표

| 손잡이 / 개념 | 역할 |
|---------------|------|
| `--drain-time-s` | 옛 프로세스 drain 시간. 갈수록 더 공격적으로 |
| `--parent-shutdown-time-s` | 새 프로세스가 옛것을 끄라고 하는 시점 — drain보다 **크게** |
| `--base-id` / `--use-dynamic-base-id` | 한 호스트에 독립 Envoy 쌍 여러 개 |
| Listen FD | 새 프로세스가 준비된 뒤 UDS로 전달 |
| 진행 중 연결 | drain 끝날 때까지 옛 프로세스에 남음 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** hot restart가 기존 TCP 연결을 새 Envoy로 옮기나?
---
아니다. listen 소켓을 넘겨 *새* accept만 새 프로세스로 가고, 기존 연결은 옛 프로세스 drain 동안 끝나거나 끊긴다.
:::

:::quiz
**Q2.** “컨테이너 친화” hot restart가 설계 제약인 이유는?
---
옛/새 프로세스가 서로 다른 immutable 컨테이너에 있을 수 있어 UDS(와 역사적으로 shared memory)로만 조율해야 한다. 한 PID 안 trampoline으로는 안 된다.
:::

:::quiz
**Q3.** `--parent-shutdown-time-s`와 `--drain-time-s` 관계는?
---
parent shutdown을 drain보다 크게 잡아, 강제 종료 전에 drain할 시간을 준다.
:::

:::quiz
**Q4.** drain이 긴 스트림 P99보다 짧으면?
---
listen 핸드오버는 됐어도 옛 프로세스가 스트림이 열린 채 공격적으로 종료되어 클라이언트가 reset을 본다.
:::

---

## 메모

강의 형식 시리즈 요청 — 추가 메모 없음.
