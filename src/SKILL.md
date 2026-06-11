---
name: to-execution
description: Set up a project for autonomous, agent-driven work. Stamps the invariant execution layout, then grills the user to produce the project-specific context, philosophy, and team. Use when starting a new project with agents, or when the user says "use the execution-set-up repo" / "set up execution".
---

<what-to-do>

Set up this project for autonomous, agent-driven work. Run four phases in order. Stop at Handoff — do **not** start planning or building work.

## 1. Preflight (hard gate)

Confirm this global skill is installed (look in `~/.claude/skills/`): `make-teammate`. If it is missing, **stop** and tell the user to install it. Do not proceed. The Lifecycle skills (`execution-grill-with-docs`, `execution-to-prd`, `execution-to-issues`) are not global — the Scaffolder stamps them into the Instance in step 2.

## 2. Stamp the invariant layout

Run `npx to-execution init` in the project root. This deterministically writes everything identical across projects — the `.excn/` namespace (docs, seeds, `schemas/`, `adr/`, `research/`, and the flat work-tracking dirs) and the universal agents — and wires the host's instruction files (`CLAUDE.md`/`AGENTS.md`) with an append-only pointer block. Do not hand-write any of it — let the package stamp it.

## 3. Setup Grill

Now interview the user. This is `execution-grill-with-docs` (stamped in step 2) plus a philosophy and team layer. Ask one thing at a time, recommend an answer each time, and write the output as each piece resolves:

- **Context** — run `execution-grill-with-docs` to resolve the domain. It writes resolved terms into `.excn/CONTEXT.md` directly (pure glossary; no implementation detail).
- **Philosophy** — first spawn a read-only subagent to sweep the codebase for existing philosophy signals (readmes, contributor docs, lint/CI configs, prior documentation) and return candidates. Present each candidate as a confirmable proposal, then ask: *what other working philosophies are particular to this codebase?* (the universal Principles are already baked into the framework — do not re-litigate them). Write only user-confirmed philosophies into `.excn/PHILOSOPHY.md` — the scan itself never writes.
- **Team** — ask what **persistent Teammates** this project needs and what each *owns*. For each, create it with `make-teammate` and add it to the roster in `.excn/CONTEXT.md`. Then fill `.excn/TEAM_DIRECTIVE.md`: roster, routing, QA gates, escalation, mission, Don'ts.
- **One-off adherence agents** — ask what standards need a guardian (code style, source fidelity, etc.). For each variant rubric, author a one-off Adherence Agent from `authoring-adherence-agents.md`. (`process-adherence` and `alignment` are already stamped — do not re-create them.)

## 4. Handoff (stop here)

Confirm the layout, then tell the user: **setup is done — exit, restart in a fresh session, and run the Work Grill** (`execution-grill-with-docs` → `execution-to-prd` → `execution-to-issues`) to start sprint 1 against the current goal. Do not plan or write sprint work in this session — keep setup context out of work context.

</what-to-do>

<supporting-info>

- The split: the **Scaffolder** (npm) stamps invariant files; the **agent** writes only variant (grilled) files. If you find yourself hand-copying a file that is identical across projects, it belongs in the package, not in your output.
- Read lightly. Defer to the bundled references (`principles.md`, `authoring-adherence-agents.md`, `PROCESS.md`) and to your judgment. Do not prescribe every step to the user.
- The two universal Adherence Agents enforce invariant rubrics: `process-adherence` (rubric `.excn/PROCESS.md`) and `alignment` (rubric Principles + `.excn/PHILOSOPHY.md`). Variant rubrics get one-off agents the Team Lead authors.
- Work-tracking lives in `.excn/` and is version-controlled — `sprints/`, `issues/`, `prds/`, `retros/`. Only `*_progress.json` is gitignored: agent- and gate-written Progress Records in `.excn/progress/`, hook-written Runtime Records in `.excn/runtime/`. Durable conclusions are promoted out into the committed `.excn/` docs via the Retro Loop.

</supporting-info>
