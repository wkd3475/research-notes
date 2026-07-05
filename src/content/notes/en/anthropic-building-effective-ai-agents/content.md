---
title: 'Building Effective AI Agents — Architecture Patterns'
---

> Source: [Building Effective AI Agents (PDF)](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf)

---

## Why I looked this up

- **Trigger:** Anthropic's enterprise guide on AI agent architecture patterns.
- **Context:** A refresher on how to think about agent design — single vs multi-agent, workflows, and when to add complexity.
- **Questions I had:** What's the current Anthropic-recommended framing for production agents, and does it match what I've been assuming?

---

## What stood out

Not much, honestly — mostly a mindset refresh.

---

## What I learned

### Key takeaways

1. **Generative AI answers questions; agents solve problems.** Agents assess tasks, pick tools, iterate, and recover from errors — unlike rigid scripted automation.
2. **Start with a single agent.** Cheaper, easier to debug, clearer metrics. Multi-agent uses ~10–15× more tokens; only worth it when business value justifies the cost.
3. **Match architecture to constraints** — control level, problem complexity, budget, domain depth — not to technical sophistication.

### Summary (from the guide)

| Area | Main points |
|------|-------------|
| Design principles | Right model for the job; modular design (prompts, tools, agents); Agent Skills for domain expertise; observability from day one |
| Single agent | Perceive → plan → act → observe loop. Best for open-ended problems where the path isn't predetermined |
| Multi-agent | Hierarchical (supervisor delegates) or collaborative (peer-to-peer). ~90% gain on complex parallel tasks per Anthropic research, but high token cost |
| Workflows | Sequential (audit-friendly), parallel (independent analyses), evaluator-optimizer (generate → critique → refine) |
| Decision framework | High control → single/sequential; moderate → hierarchical; low → collaborative. Single domain → one agent + Skills; multi-domain coordination → multi-agent |
| Evolution path | Prove ROI with one agent → routing → specialists → coordination → quality evaluators. Add complexity only when data shows value |

### Production examples (selected)

- Coinbase: Claude support agents, thousands of messages/hour, 99.99% availability
- Intercom Fin: up to 86% resolution rate
- Bank credit risk memos: 20–60% productivity gain, 30% faster turnaround
- Inscribe (fraud): review time 30 min → 90 sec

### Try next

- Nothing planned — this was a mindset refresh, not a rabbit hole.

---

## Memo

Summary from the guide. No follow-up topics planned.
