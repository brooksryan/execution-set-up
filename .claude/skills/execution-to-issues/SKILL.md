---
name: execution-to-issues
description: Break a PRD (or a single fix) into schema-valid issues appended to .excn/issues/backlog.json as tracer-bullet vertical slices. Use after a PRD, or standalone to file one bug fix, when the user wants work broken into issues.
---

Break a plan into independently-grabbable issues — tracer-bullet vertical slices. Work from a source PRD, or directly from conversation context when a fix skips the grill.

## Read first (explicit paths — the `.excn` namespace is invisible to default search)
- `.excn/CONTEXT.md` — use this glossary's vocabulary in every title and description.
- `.excn/PHILOSOPHY.md` — the project's working rules.
- `.excn/adr/` — scan for decisions in the area you are touching; respect them.
- `.excn/schemas/issue.schema.json` — the sole output-format authority. There is no markdown body template.
- The source PRD: scan `.excn/prds/` for the one named in context (`PRD-NNN`). Read its `user_stories` and `implementation_decisions` — the slices cover them. A standalone fix has no PRD; its `prd` field is `null`.

Never "search the tracker" or "search the docs." Read these paths.

## Process

### 1. Draft vertical slices
Break the source into **tracer bullets** — thin vertical slices that each cut through ALL layers end-to-end, demoable or verifiable on its own. Never a horizontal slice of one layer. Prefer many thin slices over few thick ones.

Each slice is **HITL** (needs human interaction — an architectural decision, a design review, a publish gate) or **AFK** (implementable and mergeable without it). Prefer AFK.

### 2. Quiz the user (the HITL heart of this skill)
Present the breakdown as a numbered list. Per slice show:
- **Title** — short, in glossary vocabulary.
- **Type** — HITL / AFK.
- **Depends on** — which other slices must close first.
- **Covers** — the user stories it addresses (if the PRD has them).

Ask:
- Granularity right? (too coarse / too fine)
- Dependencies correct?
- Any slices to merge or split?
- HITL/AFK marked correctly?

Iterate until the user approves. The approved breakdown is written to its file before any work executes against it.

### 3. Append the issues to the backlog
Append each approved slice to `.excn/issues/backlog.json` — the partition of open, unpulled issues. Append in **dependency order** (blockers first) so a blocker has a real id before a dependent references it in `depends_on`.

**Assign ids — scan every partition file, ids are globally unique:** the highest `<PREFIX>-NNN` may live in `backlog.json` OR any `.excn/issues/sprint-*/sprint-*-issues.json`. Scan all of them, take the max, increment, zero-pad to 3 digits. Reuse the prefix already in use (e.g. `EXEC`).

**Map each slice to schema fields** (conform to `issue.schema.json` exactly):
- `id`, `title` — assigned above, in glossary vocabulary.
- `status`: `"open"`. `actionable_now`: `true` unless tracking-only.
- `severity`: `P1` blocking · `P2` significant · `P3` low.
- `scope`: the area(s) the work lives in. `classification`: `macro` / `local` if clear, else `null`.
- `description` ← the slice's end-to-end behavior (the "what to build"). Behavior, not layer-by-layer steps.
- `acceptance_criteria[]` ← the verifiable list; the issue closes only when all hold.
- `slice_type` ← `HITL` / `AFK` from step 2.
- `depends_on[]` ← the real ids of blocking slices (the "blocked by").
- `prd` ← the source `PRD-NNN`, or `null` for a standalone fix.
- Leave `root_cause`, `fix`, `assigned_sprint`, `closed_in_sprint`, `notes` `null` unless context supplies them.

Validate every appended object against the schema before writing.

### 4. Forward-link the PRD
Add the new ids to the source PRD's `issues[]` array. Skip when there is no PRD.

Appending the objects is publishing. No external tracker, no labels, no triage step.
