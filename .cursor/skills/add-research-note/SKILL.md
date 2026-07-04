---
name: add-research-note
description: >-
  Adds or updates bilingual study notes (en + ko) in the research-notes Astro
  blog. Creates markdown in src/content/notes/{en,ko}/, sets frontmatter
  (pubDate, tags, exploreNext, exploredFrom), links Next Research follow-ups,
  and verifies with npm run build. Use when the user asks to write a note, add a
  post, record what they studied, create a follow-up article, or fill in a
  template. For deletion, use remove-research-note skill.
---

# Research Notes — Add a note

Follow this skill when adding or editing study notes in this repo.

## Quick routing

| Request | Action |
|---------|--------|
| New note / today's reading | [New note](#new-note) |
| Follow-up from `exploreNext` | [Linked note](#linked-note) |
| Fill existing template | Edit `.md` only, keep frontmatter |
| Template only | See [templates.md](templates.md) |

## New note

1. **Translation ID (slug)** — same filename in both locales: `src/content/notes/en/{slug}.md` + `src/content/notes/ko/{slug}.md`
2. **Primary language** — write **English first**, then Korean translation (same structure, same `pubDate`, same `exploreNext` / `exploredFrom`)
3. **Check duplicates** — slug must not already exist in `en/` or `ko/`
4. **Body sections** — EN: "Why I looked this up", "What stood out", "What I learned", "Memo". KO: "왜 이 글을 찾아봤나", "읽으면서 느낀 점", "배운 것", "메모"
5. **pubDate** — `YYYY-MM-DD` (study date; defaults to today KST)
6. **exploreNext** — 2–4 items. UI label is **Next Research**. Omit `note` until follow-up exists
7. **Verify** — `npm run build`
8. **Share URLs** — both locales:
   - `http://localhost:4321/research-notes/en/notes/{slug}/`
   - `http://localhost:4321/research-notes/ko/notes/{slug}/`

## Linked note

When writing a follow-up from a parent's **Next Research**:

1. Create `en/{slug}.md` and `ko/{slug}.md`
2. Set `exploredFrom: {parent-slug}` in **both** files
3. Update **both** parent files — add `note: {new-slug}` on the matching `exploreNext` item
4. `exploreNext.note` and `exploredFrom` use translation ID only (no `en/` prefix)

## Frontmatter

```yaml
title: string
description: string
pubDate: YYYY-MM-DD
tags: []
draft: false
exploreNext:
  - label: string
    reason: string   # optional
    note: slug       # optional — linked follow-up
exploredFrom: slug   # optional — parent note
```

Keep `exploreNext` labels/reasons localized per file (EN file → English labels, KO file → Korean labels). Slugs stay identical across locales.

## UI naming

- **Next Research** — replaces "다음으로 찾아볼 것" (same label in both locales)
- Language switcher in header toggles `en` ↔ `ko` for the same note

## User collaboration

- "Template only" → placeholders, both locales
- User provides content → fill both EN and KO
- **Commit/push only when asked**

## Checklist

```
- [ ] en/{slug}.md and ko/{slug}.md created or updated
- [ ] exploredFrom / exploreNext links (if applicable)
- [ ] Parent exploreNext.note updated in both parent locales
- [ ] npm run build passes
- [ ] Both locale URLs shared
```

## References

- Templates: [templates.md](templates.md)
- Scaffold: `scripts/new-note.sh {slug} "Title" --both`
- Remove note: [remove-research-note](../remove-research-note/SKILL.md)
