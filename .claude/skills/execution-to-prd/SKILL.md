---
name: execution-to-prd
description: Synthesize the current Epic Grill conversation into a schema-valid JSON PRD at .excn/prds/. Use after an Epic Grill, when the user wants a PRD from the current context.
---

Synthesize the current Epic Grill conversation into a PRD. Do NOT interview — the grill already happened; use what the conversation already holds. If the context is thin (no grill in this session), say so and ask the user to run `execution-epic-grill` first.

## Read first (explicit paths — the `.excn` namespace is invisible to default search)
- `.excn/runtime/grounding-pack.json` — if present, the pre-resolved Grounding Pack (a Runtime Record): the prd schema digest (required fields and the per-schema `notes` type), the CONTEXT glossary terms, the ADR index, and a `uuid_pool`. Read it first as your starting point — it spares re-walking the tree. It is a pure accelerator: if it is absent, or stale (a schema, CONTEXT, or ADR source is newer than the pack), ignore it and read the paths below directly.
- `.excn/CONTEXT.md` — use this glossary's vocabulary throughout the PRD.
- `.excn/PHILOSOPHY.md` — the project's working rules.
- `.excn/adr/` — scan for decisions in the area you are touching; respect them.

Never "search the docs." Read these paths.

## Process
1. If `.excn/runtime/prd-draft.json` exists, parse it (a parse error means no usable draft) and discard it unless it is schema-valid, newer than `.excn/runtime/grill-decisions.log`, and from this session. From a sound draft, take the stable fields — problem, solution, user stories — as your starting point; otherwise reconstruct those from the grill conversation, in the glossary's vocabulary. Never carry the draft's `implementation_decisions` or `testing_decisions` — author those live in step 2.
2. Sketch the major modules to build or modify. Look for deep modules — much functionality behind a simple, testable interface that rarely changes. Check the sketch with the user. Ask which modules they want tests for. The sketch becomes `implementation_decisions`; the test answers become `testing_decisions`.
3. Write the PRD as schema-valid JSON to `.excn/prds/<uuid>-<slug>.json`:
   - **Format authority:** `.excn/schemas/prd.schema.json`. Conform to it exactly. There is no markdown template.
   - **id:** take a UUIDv7 from the Grounding Pack's `uuid_pool`, or mint one with `npx to-execution uuid` when the pack is absent or stale — use it as the `id` field and the `<uuid>` filename prefix. Never self-increment a sequential `PRD-NNN` (legacy ids are grandfathered; the schema accepts legacy or UUIDv7).
   - `status`: `"published"`. `created`: today's date.
   - `implementation_decisions`: name the artifacts and decisions, never file paths or code.
   - `issues`: leave empty — `execution-to-issues` populates it.
   - `notes`: optional — one line recording grill provenance, or any philosophy candidates surfaced mid-grill (these route to the next sprint's retro, never into PHILOSOPHY.md here).

Publishing is writing the file. No external tracker, no labels, no triage step.
