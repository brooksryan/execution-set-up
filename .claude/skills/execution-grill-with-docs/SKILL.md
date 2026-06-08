---
name: execution-grill-with-docs
description: The Work Grill's first step — interview the lead against this Instance's .excn documentation, sharpen terminology, and record decisions inline. Use to start a grill on a new domain or major feature before any PRD or code.
---

<what-to-do>

Interview the lead relentlessly about every branch of the plan until you reach shared understanding. Walk each branch of the design tree, resolving dependencies one at a time. Ask one question at a time and wait for the answer before the next. For each question, give your recommended answer.

If a question can be answered by reading the codebase or the .excn docs, read instead of asking.

</what-to-do>

<supporting-info>

## Discovery — explicit paths only

The `.excn/` namespace is a dotfolder, invisible to default search. Never "look for documentation" — read these by path before the grill, and again when a branch touches their subject:

- `.excn/CONTEXT.md` — the single glossary and team roster for this Instance
- `.excn/PHILOSOPHY.md` — project working philosophies
- `.excn/PROCESS.md` — the Lifecycle this grill feeds (grill → PRD → issues)
- `.excn/adr/` — existing decision records

This Instance has exactly one context: one `.excn/CONTEXT.md`. There is no root `CONTEXT.md`, no `CONTEXT-MAP.md`, and no per-directory glossary — never create them.

## During the session

- **Challenge against the glossary.** When a term conflicts with `.excn/CONTEXT.md`, call it out: "Your glossary defines X as A, but you mean B — which is it?"
- **Sharpen fuzzy language.** Propose a precise canonical term for vague or overloaded words.
- **Discuss concrete scenarios.** Stress-test domain relationships with specific edge cases that force precise boundaries.
- **Cross-reference with code.** When the lead states how something works, check the code agrees; surface contradictions.

## Update CONTEXT.md inline

When a term resolves, write it into `.excn/CONTEXT.md` right then — don't batch. Use [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md). The grilling session holds the pen during a grill; scribe stewards the file between grills and ratifies grill-time additions at sprint open. `.excn/CONTEXT.md` is a glossary and roster — no specs, no scratch, no implementation decisions.

## Philosophy candidates have a route, not a write

If a working philosophy surfaces mid-grill, do **not** edit `.excn/PHILOSOPHY.md` — that file changes only through the Retro Loop. Record the candidate as a note for the PRD step (`execution-to-prd` carries it in the PRD's `notes`); scribe seeds it into the new sprint's `retrospective_notes` at open, and the Retro Loop proposes the edit at close.

## Offer ADRs sparingly

Offer an ADR only when all three hold:

1. **Hard to reverse** — changing your mind later costs meaningfully.
2. **Surprising without context** — a future reader will wonder "why this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for reasons.

If any is missing, skip it. Write ADRs to `.excn/adr/` using [ADR-FORMAT.md](./ADR-FORMAT.md).

</supporting-info>
