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
  meta.yaml    # description, pubDate, tags, exploreNext IDs, exploredFrom, draft
```

- Edit **content.md** when title or body changes (shows in revision history)
- Edit **meta.yaml** when tags, Next Research links, or pubDate change (no revision entry)

## Next Research registry

Next Research topics are normalized like a small DB:

| Layer | Path | Role |
|-------|------|------|
| **Registry** | `src/content/nextResearch/{id}.yaml` | Canonical label/reason (EN+KO) and optional `note:` slug when written |
| **Note link** | `meta.yaml` → `exploreNext: [id, …]` | Many-to-one references to registry IDs |

```yaml
# src/content/nextResearch/jdbc-failover-minimal-downtime.yaml
label:
  en: 'JDBC failover detection and minimal downtime'
  ko: 'JDBC failover 감지와 최소 다운타임'
reason:
  en: 'How the driver notices endpoint/DNS changes…'
  ko: 'switchover 후 endpoint/DNS 변경을…'
note: aurora-jdbc-failover   # optional — set when the follow-up note exists
```

```yaml
# meta.yaml — same ID list in both locales
exploreNext:
  - jdbc-failover-minimal-downtime
  - scylla-use-cases
```

- **Edit label/reason once** in the registry → updates every note card and the reading queue
- **IDs** = kebab-case; reuse the note slug when the topic becomes a note (`note:` field)
- Scaffold: `scripts/new-next-research.sh <id> --label-en "…" --label-ko "…" --reason-en "…" --reason-ko "…"`

## Quick routing

| Request | Action |
|---------|--------|
| New note / today's reading | [New note](#new-note) |
| Follow-up from `exploreNext` | [Linked note](#linked-note) |
| Note from reading queue | [From reading queue](#from-reading-queue) |
| Fill existing template | Edit `content.md` / `meta.yaml` as needed |
| Template only | See [templates.md](templates.md) |
| Study guide → full note | [Deep study note from guide](#deep-study-note-from-guide) |

## Deep study note from guide

When the user asks for a **study guide** first, then asks you to **read the materials and write the note** (or combines both in one request):

### Phase 1 — Guide (if not already given)

1. Read the **parent note** and any `exploreNext` / registry `reason` for context already covered.
2. Return a guide with: **reading order** (URLs), **core concepts**, **self-study questions (3–5)**, **follow-up topics**.
3. Order sources: **work-relevant ops docs first** (e.g. Scylla procedures), then **architecture/mechanism**, then **supplementary** articles.

### Phase 2 — Read everything before drafting

1. **Fetch and read every URL** listed in the guide (official docs, wiki, ops articles) — do not summarize from memory alone.
2. Cross-check against the parent note so you **extend** prior knowledge instead of repeating Part 1 basics.
3. Build a mental **coverage checklist** from the sources: discovery → gossip → token allocation → streaming → post-join cleanup → config pitfalls → resume/failure flags.

### Phase 3 — Write the note

1. Follow [New note](#new-note) or [Linked note](#linked-note) as usual.
2. Put **all guide URLs** in References / 레퍼런스 (one bullet per link).
3. **What I learned / 배운 것** must be **exhaustive** relative to the guide — if a doc mentions a flag, state, or ops step, it belongs in the note unless [Scope and splitting](#scope-and-splitting) says otherwise.
4. Turn guide **self-study questions** into [Review quiz](#review-quiz-format) cards (hidden answers).
5. **Optional format — role-play Q&A:** when the user asks for a teacher/student or dialogue style, use [chat bubble blocks](#role-play-chat-format) in "What I learned" — **teacher = left bubble**, **student / gon = right bubble** (chat-app layout). Use **`gon`** for questions the user asked live; use **`student`** (label AI 학생 / AI Student) for AI-generated study questions. Keep tables and cheat sheets outside chat blocks for scanability.
6. Subjective sections still follow [Author voice](#author-voice-subjective-sections) — do not invent feelings; role-play is only in the learning body.

### Phase 4 — Verify

Same as New note: humanize KO, `npm run build`, update registry `note:` if linked follow-up.


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
5. **Body sections** — EN: "Why I looked this up", "What stood out", "What I learned", "Review quiz", "Memo". KO: "왜 이 글을 찾아봤나", "읽으면서 느낀 점", "배운 것", "복습 퀴즈", "메모". Subjective sections: see [Author voice](#author-voice-subjective-sections).
6. **Review quiz** — after "What I learned" / "배운 것", add **3–5** recap questions from the study material. Answers must be hidden in clickable quiz cards — see [Review quiz format](#review-quiz-format). Do **not** put answers in plain visible headings.
7. **Korean humanize** — after the KO draft, follow [humanize-korean](../humanize-korean/SKILL.md): read `references/quick-rules.md`, apply fast-mode 윤문 to `ko/{slug}/content.md` (genre: 블로그). Meaning must stay identical; only style and rhythm change.
8. **pubDate** — `YYYY-MM-DD` in `meta.yaml` (study date; defaults to today KST)
9. **exploreNext** — 2–4 registry IDs in `meta.yaml` (create new topics in `src/content/nextResearch/` first). UI label is **Next Research**
10. **Verify** — `npm run build`
11. **Share URLs** — both locales:
   - `http://localhost:4321/research-notes/en/notes/{slug}/`
   - `http://localhost:4321/research-notes/ko/notes/{slug}/`

## Linked note

When writing a follow-up from a parent's **Next Research**:

1. Create `en/{slug}/` and `ko/{slug}/` (content.md + meta.yaml each)
2. Set `exploredFrom: {parent-slug}` in **both** `meta.yaml` files
3. Set `note: {new-slug}` on the matching registry file in `src/content/nextResearch/{id}.yaml`
4. Parent `meta.yaml` keeps the same registry ID — no per-locale label/reason edits needed
5. `exploredFrom` and registry `note:` use translation ID only (no `en/` prefix)

## From reading queue

When the note is written from a saved reading-queue item:

1. Create the note as usual (`en/{slug}/` + `ko/{slug}/`)
2. Set `readingQueueFrom: {queue-slug}` in **both** `meta.yaml` files
3. Delete both queue YAML files — see [reading-queue](../reading-queue/SKILL.md#complete-item-note-written)
4. Put source URLs in a **References** / **레퍼런스** bullet list at the top of `content.md` (see [References format](#references-format))

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
  - next-research-id   # registry ID — same list in en + ko meta.yaml
exploredFrom: slug   # optional — parent note
readingQueueFrom: slug   # optional — queue item this note replaced
```

Registry IDs are locale-neutral. Labels and reasons live in `src/content/nextResearch/{id}.yaml`.

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

**Allowed without user input:** `Review quiz` / `복습 퀴즈` — 3–5 questions with answers derived from the study session. Use the [quiz card format](#review-quiz-format); never show answers as plain visible text.

## Review quiz format

After the main learning section, add a recap quiz. The site renders `:::quiz` blocks as **click-to-reveal cards** (`<details>`); answers stay hidden until the reader opens a card.

**Section heading:** `## Review quiz` (EN) / `## 복습 퀴즈` (KO)

**Hint line** (localized, italic, directly under the heading):

- EN: `*Click a card to reveal the answer.*`
- KO: `*카드를 클릭하면 답이 열립니다.*`

**Per question** — fenced block with `---` separating question and answer:

````md
:::quiz
**Q1.** Short question tied to a key concept from this note?
---
Answer in 1–3 sentences. Markdown OK (lists, tables, `code`).
:::

:::quiz
**Q2.** ...
---
...
:::
````

**Rules:**

- **3–5 questions** per note (more only if the study session was unusually broad)
- Questions should test **understanding**, not trivia — compare concepts, explain *why*, spot differences (e.g. single-cluster failover vs Global DB switchover)
- Answers: concise but complete; reuse wording from "What I learned" / "배운 것"
- Same question count and order in EN and KO; translate labels (`Q1.` stays or use `Q1.` in both)
- Do **not** duplicate the quiz as a visible "Questions — answers" subsection elsewhere in the note

**When studying with the user before writing the note:** if you posed study questions during the session, turn those into quiz cards (with the answers you already discussed).

## Role-play chat format

For teacher/student dialogue, use fenced `:::chat` blocks — the site renders them as **left (teacher) / right (student or gon) chat bubbles**.

**Roles:** `teacher` (left) · `student` (right, **AI-generated** study questions) · `gon` (right, **author's live questions** during the session — label **Gon**, distinct bubble color).

Optional display label after the role (recommended for KO: `선생님` / `AI 학생` / `Gon`).

````md
:::chat student AI Student
What's the first thing a new node does on boot?
:::

:::chat teacher Teacher
Contact a **seed node** — the first gossip contact point.
:::

:::chat gon Gon
Is streaming just in-memory? Do I need rebuild for disk?
:::

:::chat teacher Teacher
No — bootstrap streaming writes SSTables to **disk**.
:::

| Reference table | stays outside chat blocks |
|---|---|
:::

:::chat student AI 학생
부팅하면 제일 먼저 뭐 하나요?
:::

:::chat teacher 선생님
**seed 노드**에 연락한다.
:::

:::chat gon Gon
신규 DC 추가할 때도 자동으로 streaming 되나요?
:::

:::chat teacher 선생님
아니 — 신규 DC는 `nodetool rebuild`로 **수동** 복제한다.
:::
````

**Gon vs AI student:** Mark questions the **user actually asked** during study as `:::chat gon Gon`. Questions invented for the role-play narrative stay `:::chat student AI 학생` (KO) / `:::chat student AI Student` (EN).

**Rules:**

- One message per block; markdown inside (lists, tables, code) is OK
- Do **not** use `**Student:**` / `**Teacher:**` bold prefixes — the label comes from the block header
- **Teacher tone:** when the user asks for a warm/kind teacher (다정한 선생님), open with brief encouragement ("좋은 질문이야", "잘 짚었어"), soften imperatives ("~해 줘" not "~해라"), and acknowledge confusion — technical content unchanged
- Tables, pipeline cheat sheets, and section headings stay **between** chat blocks, not inside dialogue
- Consecutive blocks in one act are wrapped in a `.chat-thread` container automatically

## References format

Place linked sources at the top of `content.md` as a bullet list — not a blockquote, not comma-separated inline links.

**English:**

```md
## References

- [Title](https://example.com)
- [Another doc](https://example.com/doc)

---
```

**Korean:**

```md
## 레퍼런스

- [제목](https://example.com)
- [다른 문서](https://example.com/doc)

---
```

- Use `## References` (EN) / `## 레퍼런스` (KO) — not `Source:` / `원문:` blockquotes
- One link per `-` line; non-URL items (e.g. study sessions) may be plain bullets
- Follow with `---` before the first body section

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
- [ ] Review quiz: 3–5 `:::quiz` cards with hidden answers (EN + KO)
- [ ] ko/{slug}/content.md humanized via humanize-korean (when body changed)
- [ ] exploredFrom / exploreNext links in meta.yaml (if applicable)
- [ ] Parent exploreNext.note updated in both parent meta.yaml files
- [ ] readingQueueFrom set + queue YAML removed (if from reading queue)
- [ ] npm run build passes
- [ ] Both locale URLs shared
- [ ] Deep-study path: all guide URLs fetched; guide quiz → `:::quiz` cards (if applicable)
```

## References

- Templates: [templates.md](templates.md)
- Scaffold: `scripts/new-note.sh {slug} "Title" --both`
- Remove note: [remove-research-note](../remove-research-note/SKILL.md)
- Reading queue: [reading-queue](../reading-queue/SKILL.md)
