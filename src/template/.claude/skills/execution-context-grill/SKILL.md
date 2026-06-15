---
name: execution-context-grill
description: Establish or extend the workspace's shared model — terms into CONTEXT.md, principles into PHILOSOPHY.md (seed-once). Use when the shared language needs sharpening, a new subdomain enters, or the glossary has drifted from the code.
---

<what-to-do>

Interview the lead about the workspace's shared model until every term is precise and every ambiguity is resolved. Ask one question at a time and wait for the answer before the next. For each question, give your recommended answer.

If a question can be answered by reading the codebase or the .excn docs, read instead of asking.

</what-to-do>

<write-guardrail>

You may only write to:

- `.excn/CONTEXT.md` — terms, relationships, example dialogue, flagged ambiguities, roster updates. Write each term inline as it resolves (term-by-term, never a full-file regenerate). scribe stewards CONTEXT.md between grills and ratifies grill-time additions at sprint open.
- `.excn/PHILOSOPHY.md` — **seed-once only.** You may append project philosophies only while the sentinel `<!-- principles: unestablished -->` is present in the file. If the sentinel is absent or ambiguous, refuse the write and route the philosophy candidate to the Retro Loop (record it in your output for the PRD step's `notes`). Never overwrite existing body content. See ADR-0010.
- `.excn/adr/` — offer an ADR only when all three criteria hold: hard to reverse, surprising without context, the result of a real trade-off. Write ADRs in the format at [ADR-FORMAT.md](../execution-epic-grill/ADR-FORMAT.md).

No other files. If you discover something that belongs elsewhere (a code change, a PROCESS edit, a Teammate definition change), name it and stop — it routes through the Lifecycle or the Retro Loop, not this grill.

</write-guardrail>

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

## CONTEXT.md format

Write terms in the format at [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

## PHILOSOPHY.md seed-once

When a working philosophy surfaces mid-grill:

1. Check `.excn/PHILOSOPHY.md` for the sentinel `<!-- principles: unestablished -->`.
2. **Sentinel present:** append the philosophy under `## Project philosophies`. When the last seed-batch philosophy is written, remove the sentinel line — the file is now established, and all future edits route through the Retro Loop.
3. **Sentinel absent:** do **not** edit PHILOSOPHY.md. Record the candidate as a note for the PRD step (`execution-to-prd` carries it in the PRD's `notes`); scribe seeds it into the new sprint's `retrospective_notes` at open, and the Retro Loop proposes the edit at close.

</supporting-info>
