---
title: 'Team & Org Shared Skills — Accumulation and Governance'
---

## References

- [Claude Agent Skills — Best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) (prerequisite note: `claude-agent-skills-best-practices`)
- [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Using Agent Skills with the Claude API](https://platform.claude.com/docs/en/build-with-claude/skills-guide)
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Introducing Agent Skills](https://www.anthropic.com/news/skills) (Dec 2025 org-wide management update)
- [The Complete Guide to Building Skills for Claude (PDF)](https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf)
- [anthropics/skills](https://github.com/anthropics/skills)
- [agentskills.io](https://agentskills.io)
- [Cursor — Agent Skills](https://cursor.com/docs/context/skills)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Set up Claude Code for your organization](https://code.claude.com/docs/en/admin-setup)
- [Configure server-managed settings](https://code.claude.com/docs/en/server-managed-settings)

---

## Why I looked this up

- **Trigger:** A team discussion came up about how to build up Skills together at work.
- **Prior reading:** I had already read the individual Skill authoring guide and captured it in [Claude Agent Skills — Best Practices](claude-agent-skills-best-practices).
- **This session:** I wanted to move from *how to write one good Skill* to *how a team or company accumulates, distributes, and governs a shared Skill library*.
- **Output preference:** A prose-style synthesis rather than a conversational study format.

---

## What stood out

The individual authoring guide gave design vocabulary (abstraction, progressive disclosure, `when to use`). At team scale, the harder problems are **where Skills live**, **how they reach each developer**, and **what happens when personal, project, and org layers disagree** — not SKILL.md syntax.

---

## What I learned

### 1. From single Skill design to organizational context

A Skill at team scale is still a small **work-method design** artifact (see the prerequisite note). What changes is everything around it:

| Individual focus | Team/org focus |
|------------------|----------------|
| Concise SKILL.md, good `description` | Same, plus **discovery** when dozens of Skills exist |
| Progressive disclosure inside one Skill | **Library structure** — categories, naming, ownership |
| Test and iterate after use | **PR review, versioning, deprecation** as code |
| Personal productivity | **Policy** — who may add Skills, audit `scripts/`, block untrusted sources |

Team accumulation fails when everyone uploads slightly different ZIPs. It works when Git (or an equivalent artifact store) is the **single source of truth** and each client surface is a **deployment target**, not the authority.

### 2. Three context layers — Rules, Skills, MCP

Before adding team Skills, decide what belongs in each layer:

```
┌─────────────────────────────────────────────────────────┐
│  Rules / AGENTS.md     Always-on policy & style         │
├─────────────────────────────────────────────────────────┤
│  Skills                On-demand procedures & playbooks │
├─────────────────────────────────────────────────────────┤
│  MCP                   Live tool & data access          │
└─────────────────────────────────────────────────────────┘
```

| Layer | Team stores | Examples |
|-------|-------------|----------|
| **Rules / AGENTS.md** | Short, non-negotiable constraints | TypeScript strict mode, commit message format, “never log secrets” |
| **Skills** | Multi-step, repeatable workflows | Deploy checklist, research-note scaffold, security review runbook |
| **MCP** | External systems | Jira, internal APIs, databases |

**Rule of thumb:** If a short always-on line is enough, use a Rule. If the agent needs steps, branching, scripts, or reference files loaded on demand, use a Skill. If the task needs live external data or actions, add MCP — and optionally wrap the *procedure* in a Skill that tells the agent when and how to call those tools.

Contradictions between layers are a configuration bug, not something to leave for the model to arbitrate. Remove duplicate guidance; put special cases in the **smallest scope** that fits (glob-scoped Rule, `paths`-scoped Skill, or monorepo-nested Skill directory).

### 3. Deployment surfaces and sharing scope

Custom Skills **do not sync across surfaces**. A Skill uploaded in one product is not automatically available in another. Plan separate deployment paths per surface the team actually uses.

| Surface | Typical location / mechanism | Sharing scope |
|---------|------------------------------|---------------|
| **Cursor** | `.cursor/skills/` or `.agents/skills/` in repo; `~/.cursor/skills/` personal | **Project:** Git collaborators. **Global:** one machine. Nested dirs (e.g. `apps/web/.cursor/skills/`) auto-scope to that subtree. |
| **Claude Code** | `.claude/skills/` in repo; `~/.claude/skills/` personal; **plugins** via marketplace | **Project:** Git + `.claude/settings.json` `enabledPlugins`. **Org:** managed settings, internal marketplace, `strictPluginOnlyCustomization`. |
| **Claude API** | `/v1/skills` upload | **Workspace-wide** — all workspace members |
| **claude.ai** | Settings upload (ZIP) | Historically per-user; **Team/Enterprise** admins can provision org-wide Skills (Dec 2025). Still separate from API and Claude Code filesystem Skills. |

**Implication:** Maintain Skill **source** in version control. Deploy to Cursor via commit, to Claude Code via repo + plugins, to API via upload pipeline, to claude.ai via admin ZIP — as needed. Document which surface each Skill targets.

#### Cursor-specific team patterns

- Commit `.cursor/skills/{skill-name}/SKILL.md` (+ optional `scripts/`, `references/`, `assets/`).
- Use **category subfolders** for organization; the skill identity is the folder that directly contains `SKILL.md`.
- Use `paths` frontmatter (or nested project directories) so file-specific Skills do not pollute unrelated sessions.
- Use `/migrate-to-skills` to convert eligible dynamic rules and slash commands into Skills during consolidation.
- Install remote Skills from GitHub via Customize → Rules → Remote Rule (GitHub) when sharing across repos.

#### Claude Code-specific team patterns

Settings precedence (highest wins for policy): **Managed** → **Local** → **Project** → **User**.

| Scope | Path | Shared with team? |
|-------|------|-------------------|
| Managed | Server-managed, plist/registry, `/etc/claude-code/managed-settings.json` | Yes (IT/admin) |
| Project | `.claude/` in repository | Yes (Git) |
| User | `~/.claude/` | No |
| Local | `.claude/settings.local.json` | No (gitignored) |

**Plugins** bundle Skills (and agents, hooks, MCP). Project `.claude/settings.json` can list `extraKnownMarketplaces` and `enabledPlugins` so teammates get the same plugin sources — each user still installs/trusts plugins on first use (v2.1.195+).

**Org lockdown knobs** (managed settings):

- `strictPluginOnlyCustomization` — block user/project Skills; allow only plugin or managed Skills.
- `strictKnownMarketplaces` / `blockedMarketplaces` — control which marketplaces can be added or used.
- `skillOverrides` — hide or collapse Skills (`on`, `name-only`, `user-invocable-only`, `off`) without editing SKILL.md.
- `skillListingBudgetFraction` / `skillListingMaxDescChars` — when the library grows, manage how much metadata each turn consumes.

### 4. Git as single source of truth

Recommended accumulation workflow:

```
Author drafts Skill in branch
    → PR review (content + scripts audit)
    → Merge to main
    → Deploy per surface (commit / plugin release / API upload / admin ZIP)
    → Monitor usage & iterate
```

Benefits:

- **Review gate** — same as code; catch unsafe `scripts/`, vague `description`, or overlap with Rules.
- **History** — who changed which workflow and when.
- **Onboarding** — clone repo, Skills appear for Cursor/Claude Code project scopes automatically.

The [anthropics/skills](https://github.com/anthropics/skills) repository is the reference layout: `SKILL.md` frontmatter, optional `scripts/` and `references/`, no README inside the skill folder itself (human-facing install docs live at repo root).

### 5. Governance

#### Ownership and lifecycle

| Stage | Team decision |
|-------|---------------|
| **Intake** | What qualifies as a shared Skill vs. personal experiment? |
| **Ownership** | Named maintainer per Skill or domain folder |
| **Review** | Required reviewers for `scripts/` that execute shell/code |
| **Deprecation** | `skillOverrides: off` or remove from `enabledPlugins` before deleting files |
| **Versioning** | API Skills support explicit versions; filesystem Skills use Git tags or changelog in `references/` |

#### Security

Official guidance: use Skills only from **trusted sources**. A malicious Skill can direct tool use beyond its stated purpose.

Team checklist:

- Audit `SKILL.md`, all `scripts/`, and bundled assets in PR.
- Watch for unexpected network calls, credential access, or external URL fetches.
- Treat org-provisioned Skills like **installing software** — especially before production or sensitive data access.
- Pair `strictPluginOnlyCustomization` with an **internal marketplace** so “only vetted plugins” is enforceable.

#### Discoverability at scale

Level 1 metadata (`name`, `description`) loads for every Skill the agent knows about. As the library grows:

- Keep descriptions **specific** — they are the routing API.
- Avoid duplicating Skills with overlapping triggers.
- Split large Skills rather than one giant SKILL.md (progressive disclosure).
- For Claude Code, monitor listing budget settings if descriptions get truncated.

### 6. Operational loop — start small

1. Pick **one high-frequency workflow** the team already does manually.
2. Draft a thin Skill: clear `description`, happy path in SKILL.md, depth in `references/`.
3. Pilot in **project scope** (`.cursor/skills/` or `.claude/skills/`) before org-wide mandate.
4. Observe: Does the agent invoke it without `/skill-name`? If not, tighten `description`.
5. Generalize: plugin packaging, managed rollout, API upload — only after pilot proof.

Avoid building a 50-Skill library before anyone uses five.

### 7. Open standard and multi-tool teams

[agentskills.io](https://agentskills.io) documents Agent Skills as an **open standard** supported by Cursor, Claude Code, GitHub Copilot, VS Code, and others. For teams using multiple agents:

- Prefer **portable Skill folders** (same `SKILL.md` shape) in Git.
- Use **AGENTS.md** for ambient project context that should survive tool switches.
- Keep **Cursor-specific** glob rules in `.cursor/rules/` only when AGENTS.md cannot express them.

Skills are **invokable procedures**; AGENTS.md/Rules are **ambient policy**. MCP is **live capability**. All three can coexist; team docs should state which layer owns which convention.

### 8. Cross-surface limitations to plan for

From official docs:

- **Runtime differs** — API Skills run in sandboxed code execution (no arbitrary network); Claude Code Skills have full user-machine network access. Do not assume one Skill’s scripts work everywhere without adaptation.
- **claude.ai vs API vs Claude Code** — separate upload paths; no automatic sync.
- **Code execution prerequisite** — org-provisioned Skills on claude.ai require org-wide code execution enabled.
- **ZDR** — Agent Skills are not Zero Data Retention eligible; factor into compliance discussions.

### Summary table — where to start by team setup

| Team primarily uses | First accumulation move |
|---------------------|-------------------------|
| Cursor + Git | `.cursor/skills/` in repo, Rules vs Skills split documented in AGENTS.md |
| Claude Code + Git | `.claude/skills/` + `enabledPlugins` for shared bundles |
| Regulated enterprise | Managed settings + internal plugin marketplace + `strictPluginOnlyCustomization` |
| API / automated agents | `/v1/skills` workspace upload + CI pipeline from same Git source |
| claude.ai Team/Enterprise | Admin Capabilities upload after Git review; document gap vs Code/API |

---

## Review quiz

*Click a card to reveal the answer.*

:::quiz
**Q1.** Why should a team treat Git as the single source of truth for Skills instead of emailing ZIP files?
---
Git gives PR review, version history, and one authoritative copy that each client surface (Cursor repo path, Claude Code project dir, API upload, admin ZIP) deploys from. Without it, drift and unaudited `scripts/` spread across individuals.
:::

:::quiz
**Q2.** What belongs in a Rule versus a Skill at team scale?
---
Rules hold short, always-on policy and style constraints. Skills hold multi-step, on-demand procedures with optional scripts and reference files. If one always-on sentence is enough, use a Rule; if the agent needs a playbook, use a Skill.
:::

:::quiz
**Q3.** Do Skills uploaded to the Claude API automatically appear in Claude Code or claude.ai?
---
No. Custom Skills do not sync across surfaces. Each product needs its own deployment path from the same source files.
:::

:::quiz
**Q4.** What does `strictPluginOnlyCustomization` do in Claude Code managed settings?
---
It blocks Skills (and optionally agents, hooks, MCP) from user and project sources so customization can only come from approved plugins or managed settings — an org lockdown for vetted Skill distribution.
:::

:::quiz
**Q5.** What is the recommended first step before building a large shared Skill library?
---
Pilot one high-frequency workflow in project scope with a thin SKILL.md and explicit `description`, verify automatic invocation and safety of scripts, then expand to plugins or org-wide provisioning.
:::

---

## Memo

Individual Skill authoring was the right prerequisite. Team scale is mostly **placement, distribution, and governance** — the same design instincts (abstraction, progressive disclosure, clear “when to use”) still apply, but they live inside a Git-backed, multi-surface operations model.
