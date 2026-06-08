---
status: accepted
date: 2026-06-07
---
# 0004 — Chartered definition changes land mid-sprint; the Retro Loop owns emergent ones

A definition change to a persistent doc or Teammate definition that is a **chartered deliverable** — traced to a PRD, broken into an issue, pulled into a sprint, alignment-gated, and Team-Lead-approved — lands mid-sprint as its slice. The **Retro Loop remains the sole path for retro-*emergent* changes**: definition edits that arise from observations during work and were never chartered. The Principle "the Retro Loop is the sole path to a definition change" governs the ad-hoc case; a chartered slice is the opposite of ad hoc.

This project's mission is editing its own framework docs, so those edits arrive as planned work (grill → PRD → issue → sprint), not as retro observations. The question was forced in sprint 2 when EXEC-010/025/031 — all chartered slices — landed in `PROCESS.md`, `principles.md`, `scribe.md`, and the CONTEXT seed, each Retro-Loop-guarded on a literal reading.

## Considered Options

- **All definition changes via the Retro Loop** (scribe's by-the-book path A) — rejected: it makes a chartered slice un-shippable in its own sprint, and it contradicts how sprint 1 actually operated. EXEC-003 ("Restore ADR policy across framework docs") edited `PROCESS.md`, `principles.md`, `CONTEXT.md`, and `TEAM_DIRECTIVE` mid-sprint via team-lead + alignment, and `process-adherence` passed the sprint-1 close.
- **No gate on chartered changes** — rejected: alignment must still gate every definition change. The carve-out narrows *which path*, not *whether a gate fires*.
- **The carve-out** (chosen) — distinguishes chartered (PRD→issue→sprint, alignment-gated) from emergent (retro observation). The alignment agent reached the same distinction independently when gating EXEC-010/025.

## Consequences

- The distinguishing test is provenance: a definition change traced through a PRD and pulled into the sprint is chartered; one proposed from a `retrospective_notes` observation at close is emergent. Chartered → lands as a slice; emergent → Retro Loop.
- Every chartered definition change is still alignment-gated and Team-Lead-approved before it lands — the gate is unchanged, only the trigger path differs.
- `process-adherence` treats an alignment-gated chartered change as conformant at sprint close; it does not flag it as a Retro-Loop bypass.
- The wording of the Principle and `PROCESS.md` §Retro Loop is refined to name the chartered-vs-emergent distinction explicitly. That refinement is itself the canonical retro-emergent change, so it rides the **sprint-2 Retro Loop** at close — the by-the-book path for editing the rule text, recorded as a `retrospective_notes` observation now.
