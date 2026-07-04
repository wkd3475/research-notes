---
title: 'Getting Started'
---

This repository is for recording what I study.

## How to add notes

Each note lives in a folder under `src/content/notes/en/` and `src/content/notes/ko/`:

- `content.md` — title and body (Git tracks changes here)
- `meta.yaml` — description, pubDate, tags, exploreNext

```md
---
title: 'Note title'
---

Write content here.
```

```yaml
description: 'One-line summary'
pubDate: 2026-07-04
tags: ['tag1']
exploreNext:
  - label: 'Next topic'
    reason: 'Why it matters'
```

## Study Grass

Each note's `pubDate` in `meta.yaml` appears on the Study Grass calendar on the home page.

## Languages

Every note has an English (`en/`) and Korean (`ko/`) version with the same folder name (translation ID).
