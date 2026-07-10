---
title: '시작하기'
---

이 저장소는 공부한 내용을 기록하는 용도입니다.

## 노트 작성 방법

`src/content/notes/en/`과 `src/content/notes/ko/` 아래에 폴더를 만듭니다.

- `content.md` — 제목과 본문 (Git 이력은 이 파일만 추적)
- `meta.yaml` — description, pubDate, tags, exploreNext (registry ID 목록)

```md
---
title: '노트 제목'
---

내용을 작성합니다.
```

```yaml
description: '한 줄 요약'
pubDate: 2026-07-04
tags: ['태그1']
exploreNext:
  - next-research-id
```

Next Research 라벨·이유는 `src/content/nextResearch/{id}.yaml`에서 한 번만 관리합니다.

## Study Grass

`meta.yaml`의 `pubDate`가 홈페이지 잔디밭에 표시됩니다.

## 언어

모든 노트는 같은 폴더명(translation ID)으로 영어(`en/`)와 한국어(`ko/`) 버전을 함께 관리합니다.
