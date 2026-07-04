# Research Notes

공부한 내용을 기록하고, GitHub Pages로 블로그처럼 정리해서 볼 수 있는 저장소입니다.

## 사이트

배포 후 주소: **https://wkd3475.github.io/research-notes/**

홈페이지에서 GitHub 잔디(contribution graph)를 확인할 수 있습니다. 이 저장소에 커밋할 때마다 잔디가 자라서, 공부 루틴을 시각적으로 추적할 수 있어요.

## 로컬에서 실행

```bash
nvm use          # Node.js 22 필요
npm install
npm run dev      # http://localhost:4321/research-notes/
```

## 노트 작성

`src/content/notes/` 폴더에 마크다운 파일을 추가합니다.

```md
---
title: '노트 제목'
description: '한 줄 요약 (선택)'
pubDate: 2026-07-04
tags: ['태그1', '태그2']
draft: false
---

내용을 여기에 작성합니다.
```

## GitHub Pages 배포

1. 이 저장소를 GitHub에 push
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 **GitHub Actions**로 설정
3. `main` 브랜치에 push하면 자동 배포

## 잔디밭 꾸미기 팁

- 공부 노트를 작성하고 커밋할 때마다 잔디가 쌓입니다
- 작은 단위로 자주 커밋하면 contribution graph가 더 풍성해집니다
- `src/config.ts`에서 GitHub 사용자명을 변경할 수 있습니다

## 기술 스택

- [Astro](https://astro.build/) — 정적 사이트 생성
- Markdown — 노트 작성
- GitHub Actions — 자동 배포
