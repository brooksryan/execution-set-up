---
name: execution-to-issues
description: Break a PRD (or a single fix) into schema-valid issues, each written as a per-file UUIDv7 record through the to-execution CLI, as tracer-bullet vertical slices. Use after a PRD, or standalone to file one bug fix, when the user wants work broken into issues.
---

Break a plan into independently-grabbable issues — tracer-bullet vertical slices. Work from a source PRD, or directly from conversation context when a fix skips the grill.

## Read first (explicit paths — the `.excn` namespace is invisible to default search)
- `.excn/CONTEXT.md` — use this glossary's vocabulary in every title and description.
- `.excn/PHILOSOPHY.md` — the project's working rules.
- `.excn/adr/` — scan for decisions in the area you are touching; respect them.
- `.excn/schemas/issue-record.schema.json` — the per-record format authority. There is no markdown body template. The CLI validates every record against this schema on write, so a malformed record never lands.
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

Iterate until the user approves. Create no records until the breakdown is approved.

### 3. Create each issue through the CLI
Write each approved slice as a per-file record with `to-execution issue create` (ADR-0011: the CLI is the sole write path; a raw Write/Edit under `.excn/issues/` is blocked by the channel guard). The CLI mints the record's id — a self-identifying, time-sortable **UUIDv7** — and prints it. You never assign or hand-pick an id, and there is no `<PREFIX>-NNN` to scan for.

Create slices in **dependency order** (blockers first). Each `create` prints its minted id; **capture it** and pass it to `--depends-on` on every dependent slice created afterward, so a blocker is referenced by its real id.

Run `to-execution issue create --help` for the full flag list. Map each slice to flags:
- `--title "..."` — required, in glossary vocabulary.
- `--description "..."` — the slice's end-to-end behavior (the "what to build"). Behavior, not layer-by-layer steps.
- `--severity P1|P2|P3` — `P1` blocking · `P2` significant · `P3` low.
- `--scope <area>` — the area(s) the work lives in. **Repeatable**, one area per occurrence (see the list-flag note below).
- `--classification macro|local` if clear, else omit (defaults to `null`).
- `--acceptance-criteria "..."` — the verifiable list; the issue closes only when all hold. **Repeatable**, one criterion per occurrence.
- `--slice-type HITL|AFK` — from step 2.
- `--depends-on <id>` — the minted id of a blocking slice. **Repeatable**, one id per occurrence.
- `--prd PRD-NNN` — the source PRD, or omit for a standalone fix.
- `--actionable-now` — a **presence flag**: pass it bare to mark the slice actionable (no value; `--actionable-now true` is rejected). Omit for tracking-only.
- `status` defaults to `open`; leave `root_cause`, `fix`, `assigned_sprint`, `closed_in_sprint`, `notes` unset unless context supplies them.

**List flags are repeatable — one verbatim item per occurrence, no splitting.** Repeat the flag for each item rather than passing a delimited string; commas inside a criterion are kept as written. For example:

```
to-execution issue create \
  --title "Validate ref deferral re-checks strict kinds" \
  --severity P2 --slice-type AFK --prd PRD-012 \
  --scope evo-server \
  --description "Apply a 20-model set in one shot; defer strict refs, then re-check them strictly after load." \
  --acceptance-criteria "The real 20-model set applies in one shot, with no order constraint between models" \
  --acceptance-criteria "validateMetaRefs re-checks every strict kind after the deferred load" \
  --depends-on 019ee185-cb0b-725d-a71f-a0dfce56ce49
```

### 4. Forward-link the PRD
Add the minted ids to the source PRD's `issues[]` array (`.excn/prds/` is not channel-guarded; edit it directly). Skip when there is no PRD.

Creating each record through the CLI is publishing. No external tracker, no labels, no triage step.
