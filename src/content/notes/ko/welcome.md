---
title: '시작하기'
description: 'research-notes에 오신 것을 환영합니다.'
pubDate: 2026-07-04
tags: ['meta']
---

이 저장소는 공부한 내용을 기록하는 용도입니다.

## 노트 작성 방법

`src/content/notes/en/`과 `src/content/notes/ko/`에 마크다운 파일을 추가합니다.

```md
---
title: '노트 제목'
description: '한 줄 요약'
pubDate: 2026-07-04
tags: ['태그1']
exploreNext:
  - label: '다음 주제'
    reason: '왜 궁금한지'
---

내용을 작성합니다.
```

## Study Grass

노트의 `pubDate`가 홈페이지 잔디밭에 표시됩니다.

## 언어

모든 노트는 같은 파일명(translation ID)으로 영어(`en/`)와 한국어(`ko/`) 버전을 함께 관리합니다.
