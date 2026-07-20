---
title: 'Envoy stats subsystem (3강)'
---

## 레퍼런스

- [Envoy stats — Matt Klein](https://blog.envoyproxy.io/envoy-stats-b65c7f363342)
- [Statistics — Envoy docs](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/observability/statistics)
- 부모: [Envoy hot restart (2강)](/research-notes/ko/notes/envoy-hot-restart/)
- 시리즈 시작: [Envoy threading model (1강)](/research-notes/ko/notes/envoy-threading-model/)

---

## 왜 이 글을 찾아봤나

Envoy에 대해 여러 시리즈에 걸쳐 알면 좋은 디테일한 내용을 읽고, 선생님 강의처럼 노트로 정리해 달라고 했다. Matt Klein 아키텍처 시리즈 세 번째.

---

## 읽으면서 느낀 점

별도로 남긴 감상은 없다. 강의 형식으로 정리해 달라는 요청만 있었다.

---

## 배운 것

*3강. threading과 hot restart 다음 난제 — 데이터 경로를 안 망가뜨리고 메트릭을 쏟아내되, 프로세스 둘이 겹칠 때도 숫자가 말이 되어야 한다.*

---

### Act 1 — Envoy가 내는 것

:::chat student AI 학생
stats 종류는?
:::

:::chat teacher 선생님
값 타입 세 가지(문서):

| 타입 | 동작 | 예 |
|------|------|----|
| **Counter** | 증가만 | total requests |
| **Gauge** | 오르내림 | active requests |
| **Histogram** | 샘플 스트림 → 수집기에서 percentile | upstream request time |

(옛 “timer”는 histogram이 됐다. 단위 차이뿐.)

어디서 나왔냐로 나누면:

| 카테고리 | 내용 |
|----------|------|
| **Downstream** | 들어오는 연결/요청 (listener, HCM, TCP proxy …) |
| **Upstream** | 나가는 쪽 (pool, router, TCP proxy …) |
| **Server** | Envoy 프로세스 자체 (uptime, memory …) |

한 hop을 이해하려면 보통 downstream + upstream이 둘 다 필요하다.
:::

---

### Act 2 — 목표와 구조

:::chat student AI 학생
Matt Klein가 맞춘 목표는?
:::

:::chat teacher 선생님
블로그 목표를 풀어 쓰면 이렇다. 카디널리티·볼륨은 높게, 요청 경로 오버헤드는 낮게, admin dump는 되고, hot restart 때 **멀티 프로세스 stats가 한 논리 Envoy처럼** 보여야 한다.

큰 조각:

1. **Stat store**(싱글톤) — scope, counter, gauge, histogram. scope는 refcount. scope 파괴 시 안의 stats ref 감소
2. **Thread-local / atomic** — `inc()`마다 경쟁 lock을 피하려고 atomic으로 쌓음
3. **주기적 flush**(main) — counter/gauge를 sink로 배치
4. **Stat sink** — 백엔드 와이어 포맷으로 변환(초기는 statsd, 지금은 플러그형, 태그/차원 지원)
5. **Admin `/stats`** — store에서 counter/gauge 실시간 dump (histogram 가시성은 시대/구현에 따라 다름)

초기에는 histogram이 **sink로 바로** 가서 admin에 안 보이기도 했다. 지금 문서도 counter/gauge는 배치, histogram은 수신 시 기록이라고 한다.
:::

:::chat student AI 학생
그 Medium 글의 큰 주의사항은?
:::

:::chat teacher 선생님
글 맨 위 편집: [PR #5910](https://github.com/envoyproxy/envoy/pull/5910) 이후 **stats가 shared memory에서 빠졌다**. shared memory 레이아웃 설명은 hot restart와 stats가 같이 설계된 **역사적 맥락**이지, 지금 저장 방식이 아니다.

지금 문서는 hot restart 때 counter/gauge를 **UDS로 넘긴다**고 한다. 글은 *풀려던 문제*를 읽고, 현재 동작은 문서·코드로 확인하라.
:::

---

### Act 3 — hot restart 시대 설계가 남긴 것

:::chat student AI 학생
shared memory stats가 없어졌는데 그 설계를 왜 읽나요?
:::

:::chat teacher 선생님
*요구사항*은 그대로다.

- worker는 lock 하나에 직렬화되지 않고 stats를 올려야 한다
- main은 worker를 안 막고 sink를 flush해야 한다
- epoch가 겹칠 때 대시보드가 이중 집계되거나 텅 비면 안 된다
- listener/cluster scope가 생겼다 사라지므로 lifecycle·refcount가 중요하다

원설계: counter/gauge용 고정 shared memory 슬롯, 프로세스별 TLS 캐시, 이중 refcount. 공간 부족 시 panic stat + overflow 슬롯으로 죽지 않고 저하.

지금 운영 팁: restart 전후 gauge가 이상하면 앱 탓하기 전에 hot-restart import 규칙(`NeverImport`, `server.hot_restart_generation`)을 보라.
:::

:::chat student AI 학생
태그 / 차원은?
:::

:::chat teacher 선생님
v2 이후: canonical 이름에서 동적 구간을 **tag**로 뺄 수 있다(tag specifier). sink가 dimensional metric을 내보낸다. 시리즈 이름 폭발을 막으면서 cluster·응답코드로 잘라 보는 길이다.
:::

---

### 요약표

| 주제 | 한 줄 |
|------|-------|
| 타입 | counter / gauge / histogram |
| 경로 | atomic/TLS 적재 → flush → sink |
| Admin | `/stats`로 counter/gauge |
| Hot restart | 논리 프로세스 하나; 메커니즘은 shm → UDS로 진화 |
| 2017 글 | 목표·함정은 유효; 저장소는 문서로 확인 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** counter vs gauge vs histogram을 한 줄씩?
---
counter는 증가만, gauge는 오르내림, histogram은 샘플 스트림을 percentile로 모은다(예: latency).
:::

:::quiz
**Q2.** 초기에 histogram을 store가 아니라 sink로 바로 보낸 이유는?
---
개발 효율 / Lyft statsd 파이프라인이 샘플을 그쪽에서 받길 원해서. 그래서 admin `/stats`에 histogram이 없던 시절이 있었다.
:::

:::quiz
**Q3.** Matt Klein 글의 shared memory stats 레이아웃이 지금도 맞나?
---
아니다. PR #5910으로 shared memory에서 stats가 빠졌다. 역사로 읽고, 현재는 문서의 UDS import를 보라.
:::

:::quiz
**Q4.** 한 proxy hop에서 downstream·upstream stats를 둘 다 보는 이유?
---
downstream은 클라이언트가 이 Envoy에 한 일, upstream은 이 Envoy가 백엔드에 한 일. 합쳐야 그 hop에서 손실·지연이 어디서 생겼는지 보인다.
:::

---

## 메모

강의 형식 시리즈 요청 — 추가 메모 없음.
