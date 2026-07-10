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

<!-- Author voice only — facts the user stated. Do not guess trigger/context/questions. -->

---

## What stood out

<!-- Author voice only — user's words; no invented bullets or impressions. -->

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

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** One key question from this study session?
---
Short answer (1–3 sentences). Markdown OK.
:::

:::quiz
**Q2.** Another concept to compare or explain?
---
Answer here.
:::

---

## Memo

<!-- Author voice only — user's closing note, not agent takeaways. -->

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

<!-- 작성자가 말한 사실만. 계기·맥락·질문을 추측하지 않는다. -->

---

## 읽으면서 느낀 점

<!-- 작성자 표현만. 임의로 불릿·인상·의문을 추가하지 않는다. -->

---

## 배운 것

<!-- 원문 요약·정리는 에이전트가 작성 가능 -->

---

## 복습 퀴즈

*카드를 클릭하면 답이 열립니다.*

:::quiz
**Q1.** 이번 공부에서 핵심이 되는 질문?
---
짧은 답 (1–3문장). 마크다운 사용 가능.
:::

:::quiz
**Q2.** 비교하거나 이유를 설명해야 하는 개념?
---
답변.
:::

---

## 메모

<!-- 작성자 마무리 메모만. 에이전트 소감·인용구를 넣지 않는다. -->

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
