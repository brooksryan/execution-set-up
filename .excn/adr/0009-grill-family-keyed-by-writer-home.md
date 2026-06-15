---
status: accepted
date: 2026-06-14
---
# 0009 — Grill family keyed by writer-home: each grill owns one artifact

The Work Grill collapsed three kinds of understanding into one skill (`execution-grill-with-docs`): sharpening shared vocabulary (writes CONTEXT.md), fixing what a body of work must satisfy (writes the PRD), and working out a design (writes ADRs). One skill owning all three violated Single-responsibility and gave the lead no way to run a light requirements pass without re-litigating glossary terms, nor to opt into deep design work only when warranted. We split into a **grill family keyed by what each grill writes** — mirroring ADR-0008's writer-determines-home rule applied to grills instead of progress files — so "which grill am I in?" is answered by "what am I allowed to write?"

Three grills, each owning one artifact:

- **setup-grill** (exists, the Setup Skill) — writes the scaffold + seeds. Runs once at install. Unchanged.
- **execution-context-grill** (new, fork of the standard domain grill) — writes CONTEXT.md (term-by-term inline, scribe stewardship preserved between grills) and may seed PHILOSOPHY.md under a separate ADR's conditions (ADR-0010). Offers ADRs under the standard three-part criteria. Recurring, invoked when the workspace's shared model shifts.
- **execution-epic-grill** (renamed from `execution-grill-with-docs`) — runs a required requirements pass feeding `execution-to-prd`, plus an optional work-in-types design pass the agent offers when the work is design-heavy or on user request (defaults to skip on no signal). The type pass terminates on a semantic condition (every variant handled, every optional field justified, nothing unspecified, every seam specified both sides, then a single axis-switch to call-graph/liveness), never a turn count. Resolved types render inline and into ADRs, never into CONTEXT.md.

The rename from `execution-grill-with-docs` to `execution-epic-grill` is a breaking consumer migration per ADR-0003 (names published in 0.3.0), accepted because adoption is effectively zero (EXEC-085 plugin-publish is still open and unactionable) and the cost only grows. EXEC-096 handles the upgrade/orphan path for existing Instances.

Format-doc homes follow the same writer-home logic: CONTEXT-FORMAT.md moves to `execution-context-grill` (which owns CONTEXT.md); ADR-FORMAT.md stays with `execution-epic-grill` (the primary ADR producer); `execution-context-grill` references ADR-FORMAT.md by path.

## Considered Options

- **One skill, two phases** — keep `execution-grill-with-docs` with an optional second phase. Couples two responsibilities (requirements and design) that have different invocation frequency and different write homes; "optional" becomes a branch inside a skill instead of a mechanically-real choice not to invoke.
- **Three grills, keyed by lifecycle phase** — separate by when (setup vs early-sprint vs mid-sprint) instead of by what each writes. An Anthropic research finding (arXiv 2505.06120, cited in prior-art digest) and the framework's own ADR-0008 both show that splitting by work-type rather than by artifact-ownership creates coordination overhead; writer-home is the correct split axis.

## Consequences

- The Lifecycle's grill node in PROCESS.md expands: context-grill (when the shared model shifts) → epic-grill (requirements + optional design) → PRD → issues.
- The disk-handoff seam is explicit: context-grill's CONTEXT.md writes must be committed before epic-grill reads them (fresh-session rule already in PROCESS.md).
- Each skill states its own write-guardrail ("you may only write X"), making mandate violations mechanically detectable — per the LLMREI finding (prior-art Gap 7) that agents write outside their mandate when not explicitly constrained.
- `update` never prunes template-dropped dirs, so the rename orphans the old skill on existing Instances; `migrate` gains a skill-retirement migration (EXEC-096).
