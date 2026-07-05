---
name: reading-queue
description: >-
  Manages the bilingual reading queue (saved articles to read later) in the
  research-notes blog. Add items with title, URL, and reason; recommend from
  queue when the user asks what to read; remove items when a note is written
  from that source. Files live in src/content/reading-queue/{en,ko}/{slug}.yaml.
  Use when the user wants to save, list, recommend, or clear reading material.
---

# Reading Queue — Save & recommend articles

A separate space from study **notes** for articles you plan to read later. Each item stores **why** you saved it so agents (and future you) can recommend with context.

## File layout

```
src/content/reading-queue/{en,ko}/{slug}.yaml
```

Same **slug** in both locales. Fields:

```yaml
title: 'Article title'
url: https://example.com/article
reason: >-
  Why you saved this — shown on the queue page and used for recommendations.
savedAt: YYYY-MM-DD
tags:
  - topic
source: Publisher   # optional, e.g. LangChain
```

- **No body markdown** — queue items are metadata only
- **reason** is localized (EN file → English, KO file → Korean)
- **slug** = kebab-case, no date prefix

## UI

| Locale | URL |
|--------|-----|
| EN | `/research-notes/en/reading-queue/` |
| KO | `/research-notes/ko/reading-queue/` |

Header nav: **Reading Queue** / **읽을 글**

## Quick routing

| Request | Action |
|---------|--------|
| Save / keep an article | [Add item](#add-item) |
| "What should I read?" / "뭐 읽지?" | [Recommend](#recommend-from-queue) |
| User read it & wrote a note | [Complete item](#complete-item-note-written) |
| Remove without writing a note | [Remove item](#remove-item) |

## Add item

1. Pick **slug** — check it does not exist in `en/` or `ko/`
2. Create **both** YAML files with same slug
3. Set `savedAt` to today (KST) unless user specifies otherwise
4. **reason** must reflect what the user said — do not invent motivation
5. Run `npm run build`
6. Share queue URLs

**Scaffold:**

```bash
scripts/add-to-queue.sh <slug> \
  --title "..." \
  --url "https://..." \
  --reason "..." \
  --reason-ko "..." \
  --source "..." \
  --tags "tag1,tag2"
```

## Recommend from queue

When the user asks what to read, what's in their queue, or similar:

1. Read all `src/content/reading-queue/en/*.yaml` (or `ko/` if user writes in Korean)
2. List each item with **title**, **url**, and **reason** (why it was saved)
3. Optionally sort by `savedAt` (newest or oldest) or mention tags
4. Do not recommend articles that are not in the queue unless the user asks for new suggestions

**Example response shape:**

> 읽을 글 큐에 1건 있습니다.
>
> **The best AI agent frameworks in 2026** (LangChain)  
> https://www.langchain.com/resources/ai-agent-frameworks  
> 저장 이유: 비교적 최근 작성된 해당 분야 선두주자들 중 하나인 LangChain 글이라 정독해보고자 함.

## Complete item (note written)

When the user reads a queued article and you create a study note:

1. Follow [add-research-note](../add-research-note/SKILL.md) for the note
2. Set `readingQueueFrom: {queue-slug}` in **both** note `meta.yaml` files
3. **Delete** both queue files:
   - `src/content/reading-queue/en/{queue-slug}.yaml`
   - `src/content/reading-queue/ko/{queue-slug}.yaml`
4. In note `content.md`, link the source URL in the blockquote (`> Source:` / `> 원문:`)
5. `npm run build` — queue page should no longer list the item

`readingQueueFrom` records provenance in git history even after queue files are removed.

## Remove item

If the user drops an article without writing a note:

1. Delete `en/{slug}.yaml` and `ko/{slug}.yaml`
2. `npm run build`

## Checklist

```
- [ ] en/{slug}.yaml and ko/{slug}.yaml created or removed together
- [ ] reason uses author's words, not invented context
- [ ] readingQueueFrom set on note meta when completing from queue
- [ ] Queue files deleted after note is written
- [ ] npm run build passes
```

## References

- Add note (with queue completion): [add-research-note](../add-research-note/SKILL.md)
- Scaffold: `scripts/add-to-queue.sh`
