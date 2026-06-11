# execution-set-up Domain Context

This repo is a **meta-project**: it ships a grill-driven generator for setting up autonomous, agent-driven work in a new project, and it develops that generator by using it (dogfooding). The generator is not a fixed skeleton you copy — it interviews the lead about a specific project and recreates a setup that conforms to a fixed set of Principles.

Format authority: `.claude/skills/execution-grill-with-docs/CONTEXT-FORMAT.md`.

## Glossary

### Template
The shippable patterns this repo produces, living under `src/` as the installable Setup Skill package. Customized into a new project to bootstrap autonomous agent-driven work. The Template is the product; everything at the repo root exists to develop it.
_Avoid_: "skeleton", "boilerplate" — the Template is interviewed-and-recreated per project, not copied.

### Setup Skill
The lightweight skill that is the framework's sole unit of distribution — you get the skill, and it bootstraps everything else. Invoked by the Team Lead in a new project ("use the execution-set-up repo"), it runs four phases: **Preflight** (hard gate: required global skills must exist or it refuses to proceed) → run the **Scaffolder** to stamp the invariant layout → **Grill** → the agent writes only the variant files into the stamped tree → **Handoff**. It reads lightly, like `grill-with-docs`: a thin orchestrator that defers to the agent's judgment rather than prescribing every step.
_Avoid_: "the Scaffolder" (the npm package the skill runs), "installer".

### Scaffolder
The npm package (`to-execution`, sourced from `src/`) the Setup Skill installs and runs (`npx to-execution init`) to deterministically stamp the **invariant layout** — the files that are identical across every project: the folder tree, JSON schemas, the universal agents (scribe, process-adherence, alignment), `PROCESS.md`, the `PHILOSOPHY`/`CONTEXT` seeds, and the `.gitignore` entry. Stamping these by package rather than by agent removes the read→write gap where an agent could drop a field or paraphrase a prompt. The agent writes only the **variant** files — the Grill's project-specific outputs.
_Avoid_: "Setup Skill" (the orchestrator that runs it), "generator".

### Dogfooding
The practice of the repo root running on the very patterns the Template ships — its own glossary, process, agent definitions, and work tracking. The root is the first consumer of the Template.

### Instance
A project produced by customizing the Template for a specific domain. The repo root is itself an Instance — generated once by running the Scaffolder against this repo, then maintained Src-First (variant files evolve at root; invariant files follow `src/`). `src/` is canonical and generic; an Instance is `src/` filled in for one project.
_Avoid_: "fork", "clone of the Template".

### Src-First
All framework changes land in `src/` first — never in the root Instance's copies. The root is updated to match afterward. Truth flows `src/` → Instance always: at creation and on every change.
_Avoid_: "root-first", "sync the Template back from root".

### Teammate
A persistent, named member of a project's agent team — continuity across the project, an owned domain, addressable by messaging (created via `make-teammate`). Teammates have membership. `scribe` is the one universal Teammate, present in every Instance. Per-project Teammates are authored during team setup and may only change through the Retro Loop.
_Avoid_: "subagent", "Invoked Agent" — those are transient, membership-less.

### Invoked Agent
A stateless agent definition the team spawns on demand as a tool — runs one task, returns a result, and is gone. No membership, no continuity (spawned via the Agent tool). Adversarial reviewers and alignment gates are the prototypical Invoked Agents. A Teammate and an Invoked Agent differ by lifecycle, not by importance: persistent member vs invoked-and-discarded tool. This distinction is explicit in every team.
_Avoid_: "Teammate", "subagent" when a persistent member is meant.

### Team Lead
The driving session: the human plus the primary Claude thread. Owns triage, arbitration, and final approval — including approving Teammate-definition changes. Also responsible for authoring one-off Adherence Agents that enforce project-specific rubrics (the Team Directive, code style, etc.) from the framework's shape-template. Not an agent definition and not a subagent; it is the main loop.
_Avoid_: "an agent", "a subagent" — it is the main loop, not a spawned one.

### Lifecycle
The fixed sequence work moves through in every Instance: **grill → PRD → issues → sprint → retro → edits of persistent docs and Teammate definitions**. New domains and major features enter at the grill; small fixes skip it. The retro is the close-out step and the only feed into persistent-doc / Teammate-def change (see Retro Loop). Hard-to-reverse design decisions are recorded as ADRs at grill time; the retro records sprint-time decisions.

### Retro Loop
The sole path by which persistent documents and Teammate definitions change. scribe collects retro observations during a sprint, proposes minimal edits at close, spawns the alignment agent (an Adherence Agent) to gate them against the Principles and project Philosophy, and presents PASS results to the Team Lead for approval. Never ad-hoc, never mid-sprint.

### ADR
A design-time decision record for a hard-to-reverse choice, written at grill time when all three offer criteria hold: hard to reverse, surprising without context, the result of a real trade-off. Committed markdown colocated with the methodology docs — an understanding document for humans, not an adherence artifact. The retro remains the sprint-time decision record; neither substitutes for the other.
_Avoid_: "the retro" (the sprint-time record), "spec".

### Principles
The universal, framework-level rules that hold in every Instance — stable, not re-litigated per project: Minimalism, Structured reference docs, JSON-for-progress (state in schema-validated JSON, never freeform Markdown), Persistent Teammates with consistent prompts, Adversarial and adherence Invoked Agents, Ownership-not-cognition agent definitions, Single responsibility, Non-prescriptive teardowns, Retro-loop-as-sole-change-path, Grill-first, and Two-decision-records (ADRs at grill time, the retro at sprint close). The Principles are the alignment agent's baked rubric.
_Avoid_: "Philosophy" — Philosophy is the project-specific layer, not these universal rules.

### Philosophy
The project-specific layer of working rules, held in a near-empty `PHILOSOPHY.md` that ships with each Instance and is filled during the setup grill (answering "what philosophies are particular to this codebase?"). Distinct from Principles, which are universal and baked into the framework. Philosophy grows only through the Retro Loop. The alignment agent checks proposed changes against both the baked Principles and the project Philosophy.
_Avoid_: "Principles" — Principles are universal and baked, not project-specific.

### Team Directive
The project-specific operational-rules document (`TEAM_DIRECTIVE.md`) that answers "how does the team interact" — the roster, each Teammate's ownership, routing and hand-offs, the mandatory QA gates, escalation, project mission, and explicit Don'ts. Agent definitions give *ownership*; the Team Directive gives *interaction*. Grilled per project; its structure is invariant. Because its content is project-specific, its enforcement is a one-off Adherence Agent the Team Lead authors — not a stamped universal agent. The Team Directive also lists which other one-off enforcers the project needs.

### Adherence Agent
The invariant shape of an Invoked Agent that gates work: it reads a rubric document, reviews one input (an artifact's content, a workflow transition, or a proposed change), returns `PASS/FAIL` with each violation cited by rule, appends the verdict to the progress JSON, and **never fixes the input or re-judges whether a rule should apply**. The *output* contract is invariant; the *input* contract is per-agent. Only two Adherence Agents are stamped universally, because only two rubrics are invariant: **process-adherence** (rubric = `PROCESS.md`; reviews a workflow transition) and **alignment** (rubric = Principles + Philosophy; reviews a proposed definition change — the Retro Loop gate). Every other adherence check — directive enforcement, code style, source fidelity — has a project-specific rubric and is authored as a one-off by the Team Lead from the framework's shipped shape-template. Rule of thumb: **invariant rubric → stamped agent; variant rubric → one-off agent.**
_Avoid_: "a reviewer that fixes" — an Adherence Agent never edits the input; it only cites and verdicts.

### Setup Grill / Work Grill
Two hard-separated grills. The **Setup Grill** is the one-time Setup Skill interview (context + philosophy + team) that ends at Handoff and does **not** plan work. The **Work Grill** is the recurring Lifecycle entry point (`grill → PRD → issues`) run in a *fresh session* after setup to start a sprint against the current goal. Separation keeps setup context out of work-planning context. The Work Grill's three steps are run by the Instance-stamped skills `execution-grill-with-docs`, `execution-to-prd`, and `execution-to-issues` — named distinctly from the global skills they fork because personal-level skills override project-level ones on a name collision.

### Progress Record
An agent- or gate-written `*_progress.json` under `.excn/progress/` — a unit-of-work tracker (`progress.schema.json`) or a Verdict Ledger. Gitignored, per-session churn (ADR-0005, ADR-0008).
_Avoid_: "progress update", "status file", "runtime record" — those are hook-written.

### Verdict Ledger
An append-only array of gate verdicts (`verdict-ledger.schema.json`): the session ledger (`session_progress.json`) and a sprint's `step_log` entries share this entry shape.
_Avoid_: "progress tracker" — a ledger has no `current_step`; it only accumulates verdicts.

### Runtime Record
A hook- or machine-written `*_progress.json` under `.excn/runtime/` — invocation heartbeats, the viewer-server pid record. State, not progress; no agent writes here.
_Avoid_: "progress record" — the writer, not the suffix, sets the class.

### Migrate
The Scaffolder command that relocates known Progress/Runtime Records into their homes on an already-stamped Instance — versioned, idempotent, location-only. The only sanctioned relocation path; `update` never touches work-tracking (ADR-0008).
_Avoid_: "update" — update refreshes invariant files; it never moves state.

## Relationships

- The **Template** lives in `src/`; the **Scaffolder** (`to-execution`) stamps its invariant layout and a **Grill** fills the variant files — together producing one **Instance**. One Template → many Instances.
- The **Setup Skill** orchestrates one Setup Grill per new project; the **Scaffolder** is the package it runs. Setup Skill = Preflight → Scaffolder → Grill → Handoff.
- Every **Instance** carries exactly one universal **Teammate** (`scribe`) plus per-project Teammates; **Invoked Agents** (process-adherence, alignment, and the Team Lead's one-off enforcers) are spawned per task, never members. Teammate = persistent member; Invoked Agent = transient tool.
- The **Team Lead** drives the **Lifecycle** (grill → PRD → issues → sprint → retro); the **Retro Loop** is the only edge from a sprint's retro back into **persistent docs / Teammate definitions**, gated by the **alignment** Adherence Agent and approved by the Team Lead.
- **Principles** (universal, baked into alignment) and **Philosophy** (project-specific, grows only through the Retro Loop) are the two rubrics **alignment** checks against. **ADRs** record grill-time hard-to-reverse decisions; the retro records sprint-time decisions — the Two-decision-records split.
- **Src-First** governs every change: it lands in `src/` first, then the root **Instance** mirrors.
- Writer determines home: agents and gates write **Progress Records** (`.excn/progress/`); hooks write **Runtime Records** (`.excn/runtime/`). **Migrate** relocates both on old Instances; a deny guard enforces the boundary on writes.

## Example dialogue

> **Dev:** I'll add the new field to `scribe` at the root and we're done.
> **Lead:** Two problems. `scribe` is a universal **Teammate**, so its definition changes in `src/` first and the root **Instance** mirrors — **Src-First**, never root-first. And a Teammate-definition edit travels the **Retro Loop**: you don't hand-edit it mid-sprint.
> **Dev:** Can the **alignment** agent just approve it now?
> **Lead:** alignment is an **Invoked Agent** — it gates a *proposed* change and returns PASS/FAIL; it doesn't originate or land one. scribe proposes at retro close, alignment gates, I approve. That's the path.

## Flagged ambiguities

- **"Agent"** — ambiguous between a persistent **Teammate** and a transient **Invoked Agent**. Resolution: never say "agent" unqualified in team docs; name the lifecycle. (`scribe` is a Teammate; `alignment` is an Invoked Agent.)
- **"Grill"** — ambiguous between the one-time **Setup Grill** and the recurring **Work Grill**. Resolution: always qualify; they run in separate sessions and the Setup Grill never plans work.
- **"the Template" vs "the Instance"** — the repo root is both the generator's `src/` *and* a dogfood **Instance**. Resolution: `src/` is the canonical Template; the root files outside `src/` are the Instance, maintained **Src-First**.
- **"decision record"** — ambiguous between an **ADR** (grill-time, hard-to-reverse) and the **retro** (sprint-time). Resolution: Two-decision-records — they don't substitute for each other.

## Team roster

| Teammate | Role | Owns |
|---|---|---|
| scribe | structured artifacts | sprint/issue JSON, CONTEXT.md term additions, the Retro Loop |
| builder | Scaffolder/CLI code | `src/bin` (`cli.js` + `pointer-block.js`), `scripts/preflight.js` |
| viewer | presentation | the status-page viewer and UI code over the `.excn` JSON |
| packager | npm release | `src/package.json`, versioning, tagging, publishing |
| architect | research + standards | durable research (`.excn/research/`), authoring the engineering standard (`CODE_STANDARDS.md`) from it |

Code from `builder` and `viewer` is gated by the one-off `code-standards` Adherence Agent against `.excn/CODE_STANDARDS.md` — an Invoked Agent, not a Teammate. `architect` authors that rubric; the Team Lead authors the gate.
