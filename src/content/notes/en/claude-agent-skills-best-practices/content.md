---
title: 'Claude Agent Skills — Best Practices'
---

> Source: [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

---

## Why I looked this up

- **Trigger:** A discussion came up on the team about how to build up Skills together at work.
- **Context:** Before that conversation, I wanted to read a well-polished guide on what makes a good Skill.
- **Questions I had:** What does “good” Skill authoring look like in practice—not just syntax, but design?

---

## What stood out

- **Memorable parts:** Making Skills well felt less like “writing prompts” and more like designing how work gets done. It also resembled abstraction in code—deciding which layer to expose and what to hide.
- **Parts I questioned:** The doc’s comparison to documentation felt like an overreach at first. Once structure and governance were tied in, the system-design angle made sense.
- **Connections to my experience:** The same instincts from code and docs—abstraction, progressive disclosure, a clear “when to use”—carry over to how our team might build shared Skills.

---

## What I learned

### Key takeaways

1. A Skill is a small **work-method design** artifact, not a fancy prompt.
2. **Abstraction and progressive disclosure** matter—the same instincts that help in code and docs apply here.
3. Durable Skills need **structure and governance** thinking, especially if a team will share them.

### Concepts to revisit

| Topic | My understanding |
|-------|------------------|
| Conciseness — context window is a public good | Every line competes for attention; trim ruthlessly. |
| Degrees of freedom (high / medium / low) | Match how tightly you specify steps to how fragile the task is. |
| Progressive disclosure | Reveal detail in layers—overview first, depth on demand. |
| SKILL.md structure | Frontmatter + “when to use” is part of the API contract. |
| Test and iterate | Treat Skills like code/docs: revise when real usage exposes gaps. |

### Try next

- [ ] Bring these framing points into the team discussion on shared Skills.
- [ ] Draft one team Skill with explicit “when to use” and a thin happy path.

---

## Memo

The doc was useful as a **design vocabulary** before talking about team-level Skill accumulation—not a checklist to copy, but a lens for how we want to work.
