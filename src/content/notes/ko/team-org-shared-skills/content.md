---
title: '팀·조직 단위 공용 Skill 축적 Best Practice'
---

## 레퍼런스

- [Claude Agent Skills — Skill 작성 모범 사례](https://platform.claude.com/docs/ko/agents-and-tools/agent-skills/best-practices) (선행 노트: `claude-agent-skills-best-practices`)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Using Agent Skills with the Claude API](https://platform.claude.com/docs/en/build-with-claude/skills-guide)
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Introducing Agent Skills](https://www.anthropic.com/news/skills) (2025-12 조직 단위 관리 업데이트)
- [The Complete Guide to Building Skills for Claude (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- [anthropics/skills](https://github.com/anthropics/skills)
- [agentskills.io](https://agentskills.io)
- [Cursor — Agent Skills](https://cursor.com/docs/context/skills)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Set up Claude Code for your organization](https://code.claude.com/docs/en/admin-setup)
- [Configure server-managed settings](https://code.claude.com/docs/en/server-managed-settings)

---

## 왜 이 글을 찾아봤나

- **계기:** 회사 팀에서 Skill을 어떻게 함께 쌓을지 논의가 나왔다.
- **선행 학습:** 개별 Skill 작성 가이드는 이미 읽었고 [Claude Agent Skills — Skill 작성 모범 사례](claude-agent-skills-best-practices) 노트로 정리해 두었다.
- **이번 세션:** "좋은 Skill 한 개 쓰기"에서 한 단계 올라가, **팀·회사가 공용 Skill 라이브러리를 쌓고 배포·운영하는 방법**을 정리하고 싶었다.
- **형식:** 대화형 정리보다 일반 논문·기술 글 형태가 적절하다고 판단했다.

---

## 읽으면서 느낀 점

개별 작성 가이드가 준 설계 어휘(추상화, 점진적 공개, when to use)는 그대로 통한다. 팀 규모로 가면 SKILL.md 문법보다 **Skill을 어디에 두고, 개발자마다 어떻게 전달하고, 개인·프로젝트·조직 레이어가 충돌하면 어떻게 되는지**가 더 어렵다.

---

## 배운 것

### 1. 개별 Skill 설계에서 조직 맥락으로

팀 규모의 Skill도 여전히 작은 **업무 방식 설계** 산출물이다(선행 노트 참고). 달라지는 것은 그 주변 전부다.

| 개인에 초점 | 팀·조직에 초점 |
|-------------|----------------|
| 간결한 SKILL.md, 좋은 `description` | 위와 동일 + Skill이 수십 개일 때 **발견성** |
| 한 Skill 안의 점진적 공개 | **라이브러리 구조** — 카테고리, 이름, 소유자 |
| 사용 후 테스트·반복 | 코드처럼 **PR 리뷰, 버전, 폐기** |
| 개인 생산성 | **정책** — 누가 추가할 수 있는지, `scripts/` 감사, 신뢰 출처만 허용 |

팀이 각자 조금씩 다른 ZIP을 올리면 축적은 실패한다. Git(또는 동급 아티팩트 저장소)이 **단일 소스**이고, 각 클라이언트 표면은 **배포 대상**일 때 잘 굴러간다.

### 2. 컨텍스트 3층 — Rules, Skills, MCP

팀 Skill을 추가하기 전에 각 층에 무엇을 둘지 정한다.

```
┌─────────────────────────────────────────────────────────┐
│  Rules / AGENTS.md     항상 켜지는 정책·스타일          │
├─────────────────────────────────────────────────────────┤
│  Skills                필요할 때만 로드되는 절차·플레이북 │
├─────────────────────────────────────────────────────────┤
│  MCP                   실시간 도구·데이터 접근          │
└─────────────────────────────────────────────────────────┘
```

| 층 | 팀이 두는 것 | 예 |
|----|-------------|-----|
| **Rules / AGENTS.md** | 짧고 비협상적인 제약 | TypeScript strict, 커밋 메시지 형식, 시크릿 로깅 금지 |
| **Skills** | 반복 가능한 다단계 워크플로 | 배포 체크리스트, 연구 노트 스캐폴드, 보안 리뷰 런북 |
| **MCP** | 외부 시스템 | Jira, 사내 API, DB |

**기준:** 항상 켜 둘 한 줄이면 Rule. 단계·분기·스크립트·참고 파일이 필요하면 Skill. 실시간 외부 데이터·동작이 필요하면 MCP — 필요하면 그 **절차**를 Skill로 감싼다.

층이 서로 맞지 않으면 설정 버그다. 모델에게 맡기지 말고 중복을 걷어내고, 특수 케이스는 **가장 좁은 스코프**(glob Rule, `paths` Skill, monorepo 중첩 Skill 디렉터리)에 둔다.

### 3. 배포 표면과 공유 범위

커스텀 Skill은 **표면 간 동기화되지 않는다**. 팀이 실제로 쓰는 표면마다 배포 경로를 따로 설계한다.

| 표면 | 위치·메커니즘 | 공유 범위 |
|------|--------------|-----------|
| **Cursor** | repo의 `.cursor/skills/` 또는 `.agents/skills/`; 개인은 `~/.cursor/skills/` | **프로젝트:** Git 협업자. **전역:** 한 머신. 중첩 디렉터리(`apps/web/.cursor/skills/`)는 해당 서브트리에 자동 스코핑. |
| **Claude Code** | repo `.claude/skills/`; 개인 `~/.claude/skills/`; **plugin** marketplace | **프로젝트:** Git + `.claude/settings.json`의 `enabledPlugins`. **조직:** managed settings, 내부 marketplace, `strictPluginOnlyCustomization`. |
| **Claude API** | `/v1/skills` 업로드 | **워크스페이스 전체** |
| **claude.ai** | Settings ZIP 업로드 | 원래 사용자별; **Team/Enterprise**는 관리자 조직 배포(2025-12). API·Claude Code 파일시스템 Skill과는 별개. |

**정리:** Skill **소스**는 버전 관리에 둔다. Cursor는 커밋, Claude Code는 repo+plugin, API는 업로드 파이프라인, claude.ai는 관리자 ZIP — 표면마다 필요한 만큼 배포하고, 각 Skill이 어느 표면용인지 문서화한다.

#### Cursor 팀 패턴

- `.cursor/skills/{skill-name}/SKILL.md`(+ `scripts/`, `references/`, `assets/`)를 커밋.
- **카테고리 하위 폴더**로 정리; Skill 식별자는 `SKILL.md`를 직접 담은 폴더 이름.
- `paths` frontmatter(또는 중첩 프로젝트 디렉터리)로 파일별 Skill이 무관한 세션을 오염시키지 않게 한다.
- `/migrate-to-skills`로 dynamic rule·슬래시 커맨드를 Skill로 통합할 때 쓴다.
- repo 간 공유는 Customize → Rules → Remote Rule(GitHub)로 원격 Skill 설치.

#### Claude Code 팀 패턴

설정 우선순위(정책은 높은 쪽이 이김): **Managed** → **Local** → **Project** → **User**.

| 스코프 | 경로 | 팀 공유? |
|--------|------|----------|
| Managed | server-managed, plist/registry, `/etc/claude-code/managed-settings.json` | 예(IT/관리자) |
| Project | repo의 `.claude/` | 예(Git) |
| User | `~/.claude/` | 아니오 |
| Local | `.claude/settings.local.json` | 아니오(gitignore) |

**Plugin**은 Skill(및 agent, hook, MCP)을 묶는다. 프로젝트 `.claude/settings.json`에 `extraKnownMarketplaces`·`enabledPlugins`를 두면 팀원이 같은 plugin 출처를 쓰게 할 수 있다. v2.1.195+부터는 각 사용자가 최초에 install·trust한다.

**조직 잠금 옵션**(managed settings):

- `strictPluginOnlyCustomization` — 사용자·프로젝트 Skill 차단; plugin·managed만 허용.
- `strictKnownMarketplaces` / `blockedMarketplaces` — marketplace 추가·사용 제한.
- `skillOverrides` — SKILL.md 수정 없이 Skill 숨김·축소(`on`, `name-only`, `user-invocable-only`, `off`).
- `skillListingBudgetFraction` / `skillListingMaxDescChars` — 라이브러리가 커질 때 턴마다 메타데이터 비용 관리.

### 4. Git을 단일 소스로

권장 축적 워크플로:

```
브랜치에서 Skill 초안
    → PR 리뷰(내용 + scripts 감사)
    → main 머지
    → 표면별 배포(커밋 / plugin 릴리스 / API 업로드 / 관리자 ZIP)
    → 사용 모니터링·반복
```

이점:

- **리뷰 게이트** — 코드와 동일; 위험한 `scripts/`, 모호한 `description`, Rule 중복을 잡는다.
- **이력** — 어떤 워크플로를 누가 언제 바꿨는지 남는다.
- **온보딩** — repo clone만으로 Cursor/Claude Code 프로젝트 스코프 Skill이 따라온다.

[anthropics/skills](https://github.com/anthropics/skills)가 참고 레이아웃이다: `SKILL.md` frontmatter, 선택적 `scripts/`·`references/`, skill 폴더 안에는 README 없음(사람용 설치 문서는 repo 루트).

### 5. 거버넌스

#### 소유권·라이프사이클

| 단계 | 팀 결정 |
|------|---------|
| **인입** | 공용 Skill vs 개인 실험 기준 |
| **소유** | Skill·도메인 폴더별 maintainer |
| **리뷰** | shell/코드를 실행하는 `scripts/` 필수 리뷰어 |
| **폐기** | 파일 삭제 전 `skillOverrides: off` 또는 `enabledPlugins`에서 제거 |
| **버전** | API Skill은 명시 버전; 파일시스템 Skill은 Git tag 또는 `references/` changelog |

#### 보안

공식 가이드: **신뢰할 수 있는 출처**의 Skill만 사용. 악성 Skill은 표면상 목적과 다른 도구 호출을 유도할 수 있다.

팀 체크리스트:

- PR에서 `SKILL.md`, 모든 `scripts/`, 번들 자산 감사.
- 예기치 않은 네트워크 호출·자격 증명 접근·외부 URL fetch 주의.
- 조직 배포 Skill은 **소프트웨어 설치**와 동일하게 취급 — 프로덕션·민감 데이터 전에 특히.
- `strictPluginOnlyCustomization`과 **내부 marketplace**를 짝지어 "검증된 plugin만"을 강제한다.

#### 규모가 커질 때 발견성

Level 1 메타데이터(`name`, `description`)는 에이전트가 아는 모든 Skill에 대해 로드된다. 라이브러리가 커지면:

- `description`을 **구체적으로** — 라우팅 API다.
- 트리거가 겹치는 Skill을 중복 만들지 않는다.
- 거대한 SKILL.md 하나보다 Skill을 쪼갠다(점진적 공개).
- Claude Code에서는 description이 잘리면 listing budget 설정을 점검한다.

### 6. 운영 루프 — 작게 시작

1. 팀이 이미 수동으로 하는 **고빈도 워크플로** 하나를 고른다.
2. 얇은 Skill 초안: 명확한 `description`, SKILL.md에 해피 패스, 깊이는 `references/`.
3. 조직 전체 배포 전 **프로젝트 스코프**(`.cursor/skills/` 또는 `.claude/skills/`)에서 파일럿.
4. 관찰: `/skill-name` 없이도 호출되는가? 아니면 `description`을 조인다.
5. 일반화: plugin 패키징, managed 배포, API 업로드 — 파일럿 검증 후.

다섯 개도 안 쓰는데 Skill 50개 라이브러리부터 만들지 않는다.

### 7. 오픈 스탠다드와 멀티 도구 팀

[agentskills.io](https://agentskills.io)는 Cursor, Claude Code, GitHub Copilot, VS Code 등이 지원하는 **오픈 스탠다드**를 정리한다. 여러 에이전트를 쓰는 팀은:

- Git에 **이식 가능한 Skill 폴더**(동일 `SKILL.md` 형태)를 둔다.
- 도구를 바꿔도 남을 **AGENTS.md**에 프로젝트 맥락을 둔다.
- AGENTS.md로 표현 못 할 **Cursor 전용** glob rule만 `.cursor/rules/`에 둔다.

Skills는 **호출 가능한 절차**, AGENTS.md/Rules는 **상시 정책**, MCP는 **실시간 능력**. 셋이 공존할 수 있고, 팀 문서에 어느 층이 어떤 규칙을 소유하는지 적어 둔다.

### 8. 표면 간 제약 — 미리 계획할 것

공식 문서 기준:

- **런타임 차이** — API Skill은 샌드박스 코드 실행(임의 네트워크 없음); Claude Code Skill은 사용자 머신과 동일한 네트워크. 스크립트가 어디서나 동작한다고 가정하면 안 된다.
- **claude.ai vs API vs Claude Code** — 업로드 경로 분리, 자동 동기화 없음.
- **코드 실행 전제** — claude.ai 조직 Skill은 조직 전체 코드 실행 활성화 필요.
- **ZDR** — Agent Skills는 Zero Data Retention 대상 아님; 컴플라이언스 논의에 반영.

### 요약 — 팀 환경별 첫 수

| 팀이 주로 쓰는 것 | 첫 축적 동작 |
|------------------|-------------|
| Cursor + Git | repo `.cursor/skills/`, AGENTS.md에 Rules vs Skills 분리 문서화 |
| Claude Code + Git | `.claude/skills/` + 공용 번들용 `enabledPlugins` |
| 규제·엔터프라이즈 | managed settings + 내부 plugin marketplace + `strictPluginOnlyCustomization` |
| API·자동화 에이전트 | `/v1/skills` 워크스페이스 업로드 + 동일 Git 소스 CI |
| claude.ai Team/Enterprise | Git 리뷰 후 관리자 Capabilities 업로드; Code/API와의 갭 문서화 |

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 팀이 Skill을 ZIP 메일로 돌리지 말고 Git을 단일 소스로 삼아야 하는 이유는?
---
PR 리뷰, 버전 이력, 권위 있는 한 벌의 소스를 Cursor repo 경로·Claude Code 프로젝트·API 업로드·관리자 ZIP 등 각 표면이 배포할 수 있기 때문이다. 없으면 개인마다 drift와 감사 안 된 `scripts/`가 퍼진다.
:::

:::quiz
**Q2.** 팀 규모에서 Rule과 Skill에는 각각 무엇을 두나?
---
Rule은 짧고 항상 켜지는 정책·스타일. Skill은 스크립트·참고 파일을 포함할 수 있는 다단계·온디맨드 절차. 한 줄 always-on이면 Rule, 플레이북이면 Skill.
:::

:::quiz
**Q3.** Claude API에 올린 Skill이 Claude Code나 claude.ai에 자동으로 나타나나?
---
아니다. 커스텀 Skill은 표면 간 동기화되지 않는다. 같은 소스 파일에서 표면마다 배포 경로가 필요하다.
:::

:::quiz
**Q4.** Claude Code managed settings의 `strictPluginOnlyCustomization`은 무엇을 하나?
---
사용자·프로젝트 출처 Skill(및 선택적으로 agent, hook, MCP)을 막고, 승인된 plugin·managed settings에서만 커스터마이징되게 한다 — 검증된 Skill 배포용 조직 잠금.
:::

:::quiz
**Q5.** 큰 공용 Skill 라이브러리를 만들기 전 권장 첫 단계는?
---
프로젝트 스코프에서 고빈도 워크플로 하나를 얇은 SKILL.md와 명확한 `description`으로 파일럿하고, 자동 호출·스크립트 안전을 확인한 뒤 plugin·조직 배포로 확장한다.
:::

---

## 메모

개별 Skill 작성 가이드는 선행으로 충분했다. 팀 규모는 대부분 **배치·배포·거버넌스** 문제이고, 설계 감각(추상화, 점진적 공개, 명확한 when to use)은 Git 기반·다중 표면 운영 모델 안에서 그대로 통한다.
