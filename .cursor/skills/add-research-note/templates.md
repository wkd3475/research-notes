# Note templates

All notes exist as **pairs**: `en/{slug}.md` + `ko/{slug}.md` with the same slug.

## English note

`src/content/notes/en/{slug}.md`

```md
---
title: 'Note title'
description: 'One-line summary'
pubDate: 2026-07-05
tags: ['tag1']
exploreNext:
  - label: 'Next topic'
    reason: 'Why it matters'
  - label: 'Linked follow-up'
    reason: 'Reason'
    note: existing-slug
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

## Korean note

`src/content/notes/ko/{slug}.md` — same frontmatter keys, Korean prose, matching `pubDate` / slugs in `exploreNext.note` / `exploredFrom`.

```md
---
title: '노트 제목'
description: '한 줄 요약'
pubDate: 2026-07-05
tags: ['태그1']
exploreNext:
  - label: '다음 주제'
    reason: '이유'
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

## Linked note (both locales)

```yaml
exploredFrom: parent-slug
```

Update parent's `exploreNext` in **both** `en/` and `ko/`:

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
- Filename = translation ID = `exploreNext.note` = `exploredFrom`
- No date prefix in slug
