---
name: remove-research-note
description: >-
  Removes study notes from the research-notes blog with full dependency cleanup.
  Deletes en/ko note folders (content.md + meta.yaml), clears exploreNext.note
  and exploredFrom references in other notes, and verifies with npm run build.
  Use when the user asks to delete a note, remove a post, or clean up test content.
---

# Research Notes — Remove a note

Never delete note folders alone. Always trace and update dependencies first.

## Quick steps

1. **Find dependencies** — run dependency check (below)
2. **Update referrers** — parents' `exploreNext.note`, children's `exploredFrom`, other notes linking this slug (all in `meta.yaml`)
3. **Delete pair** — `src/content/notes/en/{slug}/` + `src/content/notes/ko/{slug}/` (entire folders)
4. **Verify** — `npm run build`
5. **Confirm** — report what was removed and what was updated

## Dependency check

Search the slug across the repo before deleting:

```bash
SLUG=skill-overview
rg "$SLUG" src/content/notes/ .cursor/skills/ scripts/
```

### What to update

| Reference | Location | Action |
|-----------|----------|--------|
| `exploreNext[].note: {slug}` | Parent note(s) en + ko `meta.yaml` | Remove `note:` line → item becomes pending Next Research |
| `exploredFrom: {slug}` | Child note(s) en + ko `meta.yaml` | Remove field, or delete child too if orphaned test content |
| `{slug}` in examples | skills, templates, README | Update examples only if they reference the deleted note |

### Dependency directions

```
Parent note                    Child note (being deleted)
meta.yaml exploreNext:         meta.yaml exploredFrom:
  - note: child-slug  ───────►   parent-slug
```

When removing **child**: clear `note:` on parent (both locales).

When removing **parent**: find children with `exploredFrom: parent-slug` — remove field or delete children.

When removing **standalone** note: only check if others link to it via `exploreNext.note`.

## Delete checklist

```
- [ ] rg {slug} — all references listed
- [ ] Parent exploreNext.note cleared (en + ko meta.yaml) if applicable
- [ ] Child exploredFrom cleared or child deleted (en + ko) if applicable
- [ ] en/{slug}/ folder deleted
- [ ] ko/{slug}/ folder deleted
- [ ] npm run build passes
```

## Rules

- Always remove **both** `en/` and `ko/` folders
- Never leave dangling `note:` or `exploredFrom:` pointing to deleted slug
- **Commit/push only when asked**
- After removal, Next Research buttons for that item show as pending (no link)

## Example: remove test follow-up

Removing `skill-overview` linked from `claude-agent-skills-best-practices`:

1. `rg skill-overview src/content/notes/`
2. In `en/claude-agent-skills-best-practices/meta.yaml` and `ko/.../meta.yaml` — remove `note: skill-overview` from matching `exploreNext` item
3. Delete `en/skill-overview/` and `ko/skill-overview/` folders
4. `npm run build`
