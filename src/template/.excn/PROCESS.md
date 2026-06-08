# Process

How work moves in this project. This document is invariant — the same in every project set up with this framework. It is the rubric the `process-adherence` Adherence Agent enforces. Project-specific rules live in `.excn/TEAM_DIRECTIVE.md`; the domain glossary lives in `.excn/CONTEXT.md`; the universal Principles are baked into the framework.

## The Lifecycle

Work moves through a fixed sequence:

```
grill → PRD → issues → sprint → retro → edits of persistent docs & Teammate definitions
```

- **Grill-first.** A new domain or major feature starts with `execution-grill-with-docs` before any code or content. Bug fixes and small additions skip the grill — file the issue and assign it.
- **PRD.** After a grill, run `execution-to-prd`. A PRD answers: what problem, who benefits, the user stories, the implementation decisions. It does **not** name files or show code.
- **Issues.** Run `execution-to-issues` to break the PRD into independently-grabbable vertical slices.
- **Sprint.** Selected issues go into a sprint. The sprint JSON is the source of truth.
- **Retro.** At sprint close, the retro records what is and feeds the only path to a definition change (below).

Hard-to-reverse decisions surfaced at grill time are recorded as **ADRs** — committed markdown, one decision per numbered file, in `.excn/adr/`. Offer criteria: hard to reverse, surprising without context, the result of a real trade-off. The retro records sprint-time decisions.

## Two grills, kept separate

- The **Setup Grill** (one-time, the `to-execution` skill) produces context, philosophy, and team. It stops at handoff and does not plan work.
- The **Work Grill** (recurring) is the Lifecycle's `grill → PRD → issues`, run in a *fresh session* against the current goal. Setup context never bleeds into work context.

## Sprint tracking

Each sprint is one JSON file at `.excn/sprints/sprint_<N>.json`, conforming to `.excn/schemas/sprint.schema.json`. scribe owns it. The JSON is the source of truth.

Issues are partitioned by lifecycle location: open, unpulled issues live in `.excn/issues/backlog.json`; a sprint's pulled issues live in its companion `.excn/issues/sprint-<N>/sprint-<N>-issues.json`, which becomes that sprint's archive once it closes. An issue's file IS its state; ids stay globally unique across all partitions. scribe moves issues at sprint boundaries.

- **Open:** scribe creates the JSON with `status: "active"`, a one-sentence goal, the team, and items in `not_shipped`, and moves the pulled issues from `backlog.json` into the sprint's companion partition.
- **In flight:** Teammates work items. When one ships, they message scribe with what shipped; scribe moves it to `shipped`.
- **Closed:** scribe sets `status: "closed"`, adds decisions and retrospective notes, returns any unresolved issues to `backlog.json` (closed issues stay in the companion file as the archive), then runs the Retro Loop.

A sprint is **complete** when every item is in `shipped` or `not_shipped` (none `in_progress`), decisions and retrospective notes are recorded, and any mandatory QA gates passed. `process-adherence` reads the sprint record plus its companion issues file and checks this before a sprint may close.

## The Retro Loop — the path for emergent definition changes

Teammate definitions and persistent docs are never edited ad hoc mid-sprint. An _emergent_ change — one surfaced by a retro observation rather than chartered as work — takes this path, and only this path:

1. During the sprint, observations accumulate in the sprint JSON's `retrospective_notes`.
2. At close, scribe reads the retro and drafts the minimal edits — one sentence per change, each tied to a specific observation.
3. scribe spawns the `alignment` agent with the proposed change + Principles + `.excn/PHILOSOPHY.md`.
4. On `PASS`, scribe presents the edits to the Team Lead for approval. On `FAIL`, scribe revises against the cited violations and re-submits (max 2 cycles, then surface BLOCKED).
5. The Team Lead approves; only then does the definition change land.

A **chartered** change is the exception: when a definition or persistent-doc edit is itself a planned PRD→issue→sprint slice, it lands mid-sprint as that slice — alignment-gated and Team-Lead-approved — and does not wait for the retro (ADR-0004).

## QA gates

Adherence Agents gate work. Two are universal: `process-adherence` (this document) and `alignment` (Principles + Philosophy). The Team Lead authors one-off agents for project-specific rubrics (see `.excn/TEAM_DIRECTIVE.md` for which, and the framework's `authoring-adherence-agents.md` for how).

Gates are **mandatory for sprint-significant artifacts** and recommended below that. A `FAIL` sends the author back to revise, then back through the gates — never forward. `.excn/TEAM_DIRECTIVE.md` declares exactly which work triggers which gate.

## Teardowns describe what is

Session and sprint close artifacts describe what is, not what comes next. No "next steps", "plan to", "consider", "should".

## Trust the deployed state over message order

If your inbox says one thing and the files on disk say another, the files are right. Messages can cross. When in doubt, read the file before acting on a message. An approved breakdown or ruling is written to its work artifact before any work executes against it.
