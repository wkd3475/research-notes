# Cursor usage (this repo)

In Cursor Cloud Agent, subagents (`humanize-monolith`, etc.) are not available. Apply **fast mode** directly:

1. Read `references/quick-rules.md`
2. Humanize the target Korean markdown (default genre: **블로그**)
3. Preserve meaning, names, numbers, quotes, and `SKILL.md` / API / MCP terms
4. Remove AI tells: translation-ese, bold spam, meta pivots, nominalized endings

Trigger: any edit to `src/content/notes/ko/**/content.md`, or when `add-research-note` step 5 runs.
