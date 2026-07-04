# Note templates

All notes exist as **pairs**: `en/{slug}/` + `ko/{slug}/` with the same slug. Each folder has `content.md` and `meta.yaml`.

## English note

`src/content/notes/en/{slug}/content.md`

```md
---
title: 'Note title'
---

> Source: [Title](https://example.com)

---

## Why I looked this up

- **Trigger:**
- **Context:**
- **Questions I had:**

---

## What stood out

- **Memorable parts:**
- **Parts I questioned:**
- **Connections to my experience:**

---

## What I learned

### Key takeaways

1.
2.
3.

### Notes

| Topic | My understanding |
|-------|------------------|
| | |

### Try next

- [ ]

---

## Memo

```

`src/content/notes/en/{slug}/meta.yaml`

```yaml
description: 'One-line summary'
pubDate: 2026-07-05
tags: ['tag1']
exploreNext:
  - label: 'Next topic'
    reason: 'Why it matters'
  - label: 'Linked follow-up'
    reason: 'Reason'
    note: existing-slug
```

## Korean note

`src/content/notes/ko/{slug}/content.md` — Korean prose, same section structure.

`src/content/notes/ko/{slug}/meta.yaml` — same keys, Korean labels in `exploreNext`, matching `pubDate` / slugs in `exploreNext.note` / `exploredFrom`.

```md
---
title: '노트 제목'
---

> 원문: [제목](https://example.com)

---

## 왜 이 글을 찾아봤나

---

## 읽으면서 느낀 점

---

## 배운 것

---

## 메모

```

```yaml
description: '한 줄 요약'
pubDate: 2026-07-05
tags: ['태그1']
exploreNext:
  - label: '다음 주제'
    reason: '이유'
```

## Linked note (both locales)

In child `meta.yaml`:

```yaml
exploredFrom: parent-slug
```

Update parent's `exploreNext` in **both** `en/` and `ko/` `meta.yaml`:

```yaml
- label: '...'
  note: child-slug
```

Removing a note? See [remove-research-note](../remove-research-note/SKILL.md).

## URLs

| | |
|-|-|
| EN | `/research-notes/en/notes/{slug}/` |
| KO | `/research-notes/ko/notes/{slug}/` |
| Month | `/research-notes/en/notes/2026-07/#2026-07-05` |

## Slug rules

- kebab-case English: `react-use-effect`, `skill-authoring`
- Folder name = translation ID = `exploreNext.note` = `exploredFrom`
- No date prefix in slug
