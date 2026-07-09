---
title: 'Mac mini GitHub Actions — Ephemeral VM CI'
---

## 왜 이 글을 찾아봤나

Mac mini로 self-hosted GitHub Actions를 돌릴 때 재현성이랑 확장성을 어떻게 가져갈지 고민했고, AI랑 대화하면서 설계를 정리했다.

---

## 읽으면서 느낀 점

아직 구현 전이라 구조만 먼저 잡아 둔 상태다.

---

## 배운 것

### 문제: 호스트에서 Runner를 직접 돌리면

호스트 macOS에 runner를 그대로 올리면 매번 같은 환경이라고 보장하기 어렵다. 시간이 지나면 이렇게 달라진다.

- Homebrew 업데이트
- Xcode 변경
- Simulator runtime 추가
- DerivedData 오염
- SwiftPM cache 변경
- Keychain 상태 변경

같은 커밋인데 머신마다 결과가 갈릴 수 있다. 이걸 configuration drift라고 한다.

### 해결: Ephemeral VM

빌드마다 VM을 새로 만든다.

```
Golden Image → VM 생성 → 빌드 → VM 삭제
```

매번 같은 초기 상태에서 시작하니 재현성이 올라간다.

CI에서 ephemeral이란 job 하나만 처리하고 사라지는 runner나 VM을 말한다. persistent runner와는 반대다.

### 한 VM에 Xcode 여러 개

한 VM에 Xcode를 여러 버전 깔아 둘 수 있다.

```
/Applications/Xcode_15.4.app
/Applications/Xcode_16.4.app
/Applications/Xcode_26_beta.app
```

빌드마다 toolchain만 고르면 된다.

```bash
DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer
```

VM 이미지는 그대로 두고 쓰는 Xcode만 바꾼다.

### Golden Image 설계 (4 layers)

| Layer | 내용 | 비고 |
|-------|------|------|
| **1. Golden image** | macOS, Xcode, Simulator runtime, Rosetta | 거의 안 바뀌는 것만 |
| **2. Bootstrap script** | `brew bundle`, `bundle install`, `defaults write`, keychain unlock | Git으로 관리 |
| **3. Secrets** | 서명 키, 토큰 | 빌드 시작 시 주입 — 이미지에 넣지 않음 |
| **4. Cache** | SwiftPM, DerivedData 등 | Host 또는 외부 저장소 — 이미지에 넣지 않음 |

### Ephemeral runner 흐름

`config.sh --ephemeral`로 등록한다.

```
Job 생성 → VM 생성 → Runner 등록 → Job 실행 → Runner 자동 제거 → VM 삭제
```

Runner는 job 하나만 처리하고 unregister된다.

### Orchestrator (Runner Manager)

GitHub가 VM 생성·삭제까지 해주지는 않는다. orchestrator가 그걸 맡는다.

```
Queue 확인 → VM 생성 → SSH 접속 → Runner 등록 → 빌드 → VM 삭제
```

핵심 기능은 여섯 가지다.

1. GitHub Actions queue 감시
2. Tart로 VM 생성
3. VM IP 확인
4. SSH로 bootstrap
5. Ephemeral runner 등록
6. 완료·실패 시 VM 정리

추천 디렉터리 구조:

```
runner-manager/
  github/
  tart/
  ssh/
  scheduler/
```

### 기존 솔루션

| 옵션 | 장점 | 단점 |
|------|------|------|
| **ARC** (Actions Runner Controller) | Kubernetes에서 표준 | macOS / Tart와는 안 맞음 |
| **Tart Examples** | 공식 예제 | 제품이라기보다 샘플 코드 |
| **자체 Runner Manager** | Mac mini fleet에 맞춤 | queue, slot, 장애 복구는 직접 구현 |

Mac mini 10~20대 규모면 Go나 Python으로 만든 작은 orchestrator가 가장 현실적이다.

### 추천 운영 구조

```
GitHub Actions
       │
       ▼
Runner Manager
       │
   ┌───┴───┐
   ▼       ▼
Mac #1   Mac #2
   │       │
 Tart    Tart
   │       │
Golden  Golden
   │       │
Clone   Clone → VM → bootstrap.sh → config.sh --ephemeral → Build → cleanup
```

### 운영 철학

1. Host는 최대한 단순하게 — Tart랑 최소한의 관리 도구만 둔다.
2. Golden image에는 OS와 Xcode만 — 자주 바뀌는 도구는 이미지에 넣지 않는다.
3. 환경은 bootstrap script로 코드화 — Brewfile, Gemfile, `bootstrap.sh`를 Git으로 관리한다.
4. 빌드는 항상 ephemeral VM에서 — job 하나 = VM 하나 = runner 하나.
5. Runner Manager가 VM lifecycle을 담당 — 생성, 등록, 삭제.

### Runner Manager 최소 기능

Mac mini fleet을 안정적으로 돌리려면 이 정도면 된다.

- GitHub Actions queue 감시
- Tart VM 생성·삭제
- SSH로 VM 초기화
- Ephemeral runner 자동 등록
- Host별 VM slot 관리
- 장애 시 VM 자동 정리 (stuck VM, 취소된 job)
