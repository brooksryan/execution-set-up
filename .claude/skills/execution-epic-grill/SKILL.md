---
name: execution-epic-grill
description: Grill a body of work into requirements that feed the PRD, with an optional deep design pass. Use to start a grill on a new feature, epic, or major change before any PRD or code.
---

<what-to-do>

Interview the lead about what this body of work must satisfy. Walk each requirement branch, resolving dependencies one at a time. Ask one question at a time and wait for the answer before the next. For each question, give your recommended answer.

If a question can be answered by reading the codebase or the .excn docs, read instead of asking.

When the requirements pass is complete, ask the lead: **"Is this design-heavy enough for a type pass, or are we done?"** Default to done on no signal — small work should not be forced through heavyweight design.

</what-to-do>

<write-guardrail>

You may only write to:

- `.excn/adr/` — offer an ADR only when all three criteria hold: hard to reverse, surprising without context, the result of a real trade-off. Write ADRs in the format at [ADR-FORMAT.md](./ADR-FORMAT.md).
- `.excn/runtime/grill-decisions.log` — as each requirement or decision crystallises, append it as one JSON object per line (an append-only Runtime Record). This is the continuously-updated surface a speculative PRD draft reads while the grill is still running; a reader splits on newline and skips any line that fails to parse, so a torn final write is never an error. Append-only — never rewrite or truncate it.

Do not write to `.excn/CONTEXT.md` or `.excn/PHILOSOPHY.md` — terms and principles are owned by `execution-context-grill`. If you discover a term that needs sharpening, name it and tell the lead to run a context-grill session.

No other files. The output of this grill is the conversation itself — `execution-to-prd` synthesizes it into the PRD.

</write-guardrail>

<live-draft>

Keep a speculative PRD draft warm as the grill runs. `execution-to-prd` verifies and lands it — the draft is never authoritative.

- **Spawn at the first answer.** When the first question is answered, spawn a long-lived drafter with the Agent tool, passing a `name` so it runs as an addressable, continuable Teammate you can feed. Its task: read `.excn/runtime/grounding-pack.json` and `.excn/runtime/grill-decisions.log`, and write a PRD-shaped draft to `.excn/runtime/prd-draft.json` by writing a temp file and renaming it over the target. It writes ONLY under `.excn/runtime/` — never `.excn/prds/` or `.excn/adr/`.
- **Feed it each answer.** After every answer, append the decision to `grill-decisions.log` and message the drafter to redraft from the updated log.
- **Stable fields only.** The drafter fills the fields that settle early — problem, actors, user stories. It leaves the decision-bearing fields (`implementation_decisions`, `testing_decisions`) to `execution-to-prd`, which authors them live at hand-back.

</live-draft>

<supporting-info>

## Discovery — explicit paths only

The `.excn/` namespace is a dotfolder, invisible to default search. Never "look for documentation" — read these by path before the grill, and again when a branch touches their subject:

- `.excn/CONTEXT.md` — the single glossary and team roster for this Instance
- `.excn/PHILOSOPHY.md` — project working philosophies
- `.excn/PROCESS.md` — the Lifecycle this grill feeds (grill → PRD → issues)
- `.excn/adr/` — existing decision records

## Phase 1 — Requirements (always)

Fix what the body of work must satisfy. For each requirement branch:

- **Name the acceptance condition.** What observable outcome proves this branch is done?
- **Challenge against the glossary.** When a term conflicts with `.excn/CONTEXT.md`, call it out — but do not edit CONTEXT.md; name the conflict for the lead to resolve in a context-grill session.
- **Discuss concrete scenarios.** Stress-test requirements with specific edge cases that force precise boundaries.
- **Cross-reference with code.** When the lead states how something works, check the code agrees; surface contradictions.

Philosophy candidates surfaced mid-grill route to the PRD's `notes` field — never to PHILOSOPHY.md.

## Phase 2 — Design / work-in-types (optional)

Run this phase only when the lead says yes to the design-heavy question, or requests it explicitly. If they decline or give no signal, stop after Phase 1.

Treat the plan as a type signature and narrow it as you talk. Each branch of the design tree is a field, a union variant, or a function signature. Render resolved types inline as decisions crystallise, and into ADRs if they meet the offer criteria.

Four hole-finding moves, in order:

1. **Open each topic at its loosest signature** and make the lead fill it: "the contract is `(X) => Y` — enumerate X, enumerate Y."
2. **Name the seams before the bodies.** Nail the cross-unit interface first.
3. **Ask "is this function total?"** of each one. The accidentally-partial function — the missing escape hatch, the unhandled variant — is the usual bug.
4. **Push invariants from prose into structure** — prefer a shape that makes the illegal state unconstructible over a comment that forbids it.

**Termination condition.** The design pass is done when:

- every union variant is handled (exhaustive — name the odd one out explicitly),
- every optional field is justified (why is this absent-able?),
- nothing is left as `any`/unspecified,
- every seam — the interface between two units that can't directly call each other — is specified on both sides.

Then switch axes once. Types capture WHAT is well-formed, never WHETHER or WHEN something is invoked. Ask the two non-type questions explicitly: "what calls this, and when does that caller run?" Surface call-graph and liveness gaps the types cannot.

When both axes are closed, the design pass is done.

</supporting-info>
