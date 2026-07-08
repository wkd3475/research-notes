---
name: add-research-note
description: >-
  Adds or updates bilingual study notes (en + ko) in the research-notes Astro
  blog. Creates content.md + meta.yaml in src/content/notes/{en,ko}/{slug}/,
  sets meta (pubDate, tags, exploreNext, exploredFrom), links Next Research
  follow-ups, and verifies with npm run build. Subjective sections (feelings,
  memo, why I looked it up) must use the author's words only — never invent
  impressions. When content diverges from the note title, consider splitting
  into separate focused notes (see Scope and splitting). When a note comes from
  the reading queue, set readingQueueFrom and remove the queue item per
  reading-queue skill. Use when the user asks to write a note, add a post, record what
  they studied, create a follow-up article, or fill in a template. For deletion,
  use remove-research-note skill.
---

# Research Notes — Add a note

Follow this skill when adding or editing study notes in this repo.

## File layout

Each note is a **folder** per locale:

```
src/content/notes/{en,ko}/{slug}/
  content.md   # title + body — Git history tracks this file only
  meta.yaml    # description, pubDate, tags, exploreNext, exploredFrom, draft
```

- Edit **content.md** when title or body changes (shows in revision history)
- Edit **meta.yaml** when tags, Next Research links, or pubDate change (no revision entry)

## Quick routing

| Request | Action |
|---------|--------|
| New note / today's reading | [New note](#new-note) |
| Follow-up from `exploreNext` | [Linked note](#linked-note) |
| Note from reading queue | [From reading queue](#from-reading-queue) |
| Fill existing template | Edit `content.md` / `meta.yaml` as needed |
| Template only | See [templates.md](templates.md) |

## Scope and splitting

**One note = one coherent topic.** The title should match what the body actually covers.

While planning or drafting, compare the proposed **title** to the **body**:

- If a section, tangent, or takeaway would make a reader think "this belongs in a different article", **split it into its own note** instead of padding the current one.
- Give each split note its own focused title and slug; keep only material that fits the title in each note.
- Link split notes with `exploreNext` / `exploredFrom` (see [Linked note](#linked-note)). Mention the sibling in **Next Research** when it is a natural follow-up.
- When unsure, prefer **two focused notes** over one long note whose title only covers part of the content.

**Example:** A note titled "Rust ownership basics" that grows into a long section on async runtimes → keep ownership in the original note; create a separate note (e.g. `rust-async-runtimes`) for the runtime material and link them.

## New note

1. **Translation ID (slug)** — same folder name in both locales: `en/{slug}/` + `ko/{slug}/`
2. **Primary language** — write **English first**, then Korean translation (same structure, same `pubDate`, same `exploreNext` / `exploredFrom`)
3. **Check duplicates** — slug folder must not already exist in `en/` or `ko/`
4. **Title–content fit** — before and while writing, apply [Scope and splitting](#scope-and-splitting). Trim or move material that does not belong under this title.
5. **Body sections** — EN: "Why I looked this up", "What stood out", "What I learned", "Memo". KO: "왜 이 글을 찾아봤나", "읽으면서 느낀 점", "배운 것", "메모". Subjective sections: see [Author voice](#author-voice-subjective-sections).
6. **Korean humanize** — after the KO draft, follow [humanize-korean](../humanize-korean/SKILL.md): read `references/quick-rules.md`, apply fast-mode 윤문 to `ko/{slug}/content.md` (genre: 블로그). Meaning must stay identical; only style and rhythm change.
7. **pubDate** — `YYYY-MM-DD` in `meta.yaml` (study date; defaults to today KST)
8. **exploreNext** — 2–4 items in `meta.yaml`. UI label is **Next Research**. Omit `note` until follow-up exists
9. **Verify** — `npm run build`
10. **Share URLs** — both locales:
   - `http://localhost:4321/research-notes/en/notes/{slug}/`
   - `http://localhost:4321/research-notes/ko/notes/{slug}/`

## Linked note

When writing a follow-up from a parent's **Next Research**:

1. Create `en/{slug}/` and `ko/{slug}/` (content.md + meta.yaml each)
2. Set `exploredFrom: {parent-slug}` in **both** `meta.yaml` files
3. Update **both** parent `meta.yaml` files — add `note: {new-slug}` on the matching `exploreNext` item
4. `exploreNext.note` and `exploredFrom` use translation ID only (no `en/` prefix)

## From reading queue

When the note is written from a saved reading-queue item:

1. Create the note as usual (`en/{slug}/` + `ko/{slug}/`)
2. Set `readingQueueFrom: {queue-slug}` in **both** `meta.yaml` files
3. Delete both queue YAML files — see [reading-queue](../reading-queue/SKILL.md#complete-item-note-written)
4. Put the article URL in the `> Source:` / `> 원문:` blockquote

## content.md

```md
---
title: 'Note title'
---

Body markdown here.
```

## meta.yaml

```yaml
description: string
pubDate: YYYY-MM-DD
tags: []
draft: false
exploreNext:
  - label: string
    reason: string   # optional
    note: slug       # optional — linked follow-up
exploredFrom: slug   # optional — parent note
readingQueueFrom: slug   # optional — queue item this note replaced
```

Keep `exploreNext` labels/reasons localized per locale (EN → English labels, KO → Korean labels). Slugs stay identical across locales.

## UI naming

- **Next Research** — replaces "다음으로 찾아볼 것" (same label in both locales)
- Language switcher in header toggles `en` ↔ `ko` for the same note

## Author voice (subjective sections)

These sections record **the author's experience**, not the agent's inference. Do **not** invent or embellish.

| Section (EN) | Section (KO) | Rule |
|--------------|--------------|------|
| Why I looked this up | 왜 이 글을 찾아봤나 | Only facts the user stated (link, trigger, context, questions). No guessed motivation. |
| What stood out | 읽으면서 느낀 점 | **User's words only.** Light copy-edit / EN↔KO translation OK; do not add bullet scaffolding or new impressions. |
| Memo | 메모 | User's closing note only. No agent takeaways or "lines to remember" unless the user wrote them. |

**Allowed without user input:** `What I learned` / `배운 것` — summaries, tables, and takeaways from the source material the user asked you to read.

**When the user gives little or nothing for a subjective section:**

- Keep it short — one sentence or a brief paragraph in their voice.
- Do not fill template bullets (`Memorable parts`, `Parts I questioned`, etc.) with fabricated content.
- If they said "no follow-up" / "next research 없음", omit `exploreNext` in `meta.yaml` — do not invent topics.

**Example (feelings only):**

```md
## 읽으면서 느낀 점

느낀 점은 크게 없고, 적당히 마인드셋 리프레시 정도만 된 것 같다.
```

## User collaboration

- "Template only" → placeholders, both locales
- User provides content → fill both EN and KO; subjective sections stay faithful to what they wrote
- Content wider than the title → suggest or apply [Scope and splitting](#scope-and-splitting); create sibling notes and link them unless the user wants a single combined note
- **Commit/push only when asked**

## Checklist

```
- [ ] en/{slug}/ and ko/{slug}/ created or updated (content.md + meta.yaml)
- [ ] Title matches body scope; off-topic material split into separate linked notes (if any)
- [ ] Subjective sections use only the author's words (no invented impressions)
- [ ] ko/{slug}/content.md humanized via humanize-korean (when body changed)
- [ ] exploredFrom / exploreNext links in meta.yaml (if applicable)
- [ ] Parent exploreNext.note updated in both parent meta.yaml files
- [ ] readingQueueFrom set + queue YAML removed (if from reading queue)
- [ ] npm run build passes
- [ ] Both locale URLs shared
```

## References

- Templates: [templates.md](templates.md)
- Scaffold: `scripts/new-note.sh {slug} "Title" --both`
- Remove note: [remove-research-note](../remove-research-note/SKILL.md)
- Reading queue: [reading-queue](../reading-queue/SKILL.md)
