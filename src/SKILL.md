---
name: to-execution
description: Set up a project for autonomous, agent-driven work. Stamps the invariant execution layout, then grills the user to produce the project-specific context, philosophy, and team. Use when starting a new project with agents, or when the user says "use the execution-set-up repo" / "set up execution".
---

<what-to-do>

Set up this project for autonomous, agent-driven work. Run four phases in order. Stop at Handoff — do **not** start planning or building work.

## 1. Preflight (hard gate)

Confirm `npx` runs with Node 18+ (`node --version`). If not, **stop** and tell the user. No global skills are required — the Scaffolder stamps what setup uses and what the later grill family needs into the Instance in step 2: `make-teammate` (setup's team step; a personal copy, if installed, overrides the stamped one — same skill either way) and the grill family's Lifecycle skills (`execution-context-grill`, `execution-epic-grill`, `execution-to-prd`, `execution-to-issues`). This setup runs from this file alone — its interview is below, not a stamped skill.

## 2. Stamp the invariant layout

Run `npx to-execution init` in the project root. This deterministically writes everything identical across projects — the `.excn/` namespace (docs, seeds, `schemas/`, `adr/`, `research/`, and the flat work-tracking dirs) and the universal agents — and wires the host's instruction files (`CLAUDE.md`/`AGENTS.md`) with an append-only pointer block. Do not hand-write any of it — let the package stamp it.

## 3. Setup Grill

Now interview the user to produce this Instance's context, philosophy, and team. This is the Setup Grill — its own interview, run from this file; it is **not** the Context Grill or Epic Grill (the user runs those later, at Handoff). Ask one thing at a time, recommend an answer each time, read the codebase or the stamped `.excn/` docs instead of asking whenever you can, and write each output the moment it resolves — don't batch:

- **Context** — interview the user to build the domain glossary from scratch. Sharpen each fuzzy or overloaded word into one canonical term, stress-test boundaries with concrete scenarios, and cross-reference claims against the code — surface contradictions. Write each term into `.excn/CONTEXT.md` as it resolves, in the format stamped at `.claude/skills/execution-context-grill/CONTEXT-FORMAT.md`. `.excn/CONTEXT.md` is a glossary and roster only — no specs, no implementation detail. Offer an ADR (to `.excn/adr/`, in the format stamped at `.claude/skills/execution-epic-grill/ADR-FORMAT.md`) only for a decision that is hard to reverse, surprising without context, and the result of a real trade-off.
- **Philosophy** — first spawn a read-only subagent to sweep the codebase for existing philosophy signals (readmes, contributor docs, lint/CI configs, prior documentation) and return candidates. Present each candidate as a confirmable proposal, then ask: *what other working philosophies are particular to this codebase?* (the universal Principles are already baked into the framework — do not re-litigate them). Write only user-confirmed philosophies into `.excn/PHILOSOPHY.md` — the scan itself never writes.
- **Team** — ask what **persistent Teammates** this project needs and what each *owns*. For each, create it with `make-teammate` and add it to the roster in `.excn/CONTEXT.md`. Then fill `.excn/TEAM_DIRECTIVE.md`: roster, routing, QA gates, escalation, mission, Don'ts.
- **One-off adherence agents** — ask what standards need a guardian (code style, source fidelity, etc.). For each variant rubric, author a one-off Adherence Agent from `authoring-adherence-agents.md`. (`process-adherence` and `alignment` are already stamped — do not re-create them.)

## 4. Handoff (stop here)

Confirm the layout, then tell the user: **setup is done — exit, restart in a fresh session, and run the grill family** (`execution-context-grill` → `execution-epic-grill` → `execution-to-prd` → `execution-to-issues`) to start sprint 1 against the current goal. Do not plan or write sprint work in this session — keep setup context out of work context.

</what-to-do>

<supporting-info>

- The split: the **Scaffolder** (npm) stamps invariant files; the **agent** writes only variant (grilled) files. If you find yourself hand-copying a file that is identical across projects, it belongs in the package, not in your output.
- Read lightly. Defer to the bundled references (`principles.md`, `authoring-adherence-agents.md`, `PROCESS.md`) and to your judgment. Do not prescribe every step to the user.
- The two universal Adherence Agents enforce invariant rubrics: `process-adherence` (rubric `.excn/PROCESS.md`) and `alignment` (rubric Principles + `.excn/PHILOSOPHY.md`). Variant rubrics get one-off agents the Team Lead authors.
- Work-tracking lives in `.excn/` and is version-controlled — `sprints/`, `issues/`, `prds/`, `retros/`. Only `*_progress.json` is gitignored: agent- and gate-written Progress Records in `.excn/progress/`, hook-written Runtime Records in `.excn/runtime/`. Durable conclusions are promoted out into the committed `.excn/` docs via the Retro Loop.

</supporting-info>
