# execution-set-up

A framework for setting up autonomous, agent-driven work in a project. You get one lightweight skill; it bootstraps the rest.

## What it ships

- **`to-execution`, the skill** (`src/SKILL.md`). The Team Lead invokes it in a new project. It runs Preflight → stamps the layout → grills the user → hands off.
- **`to-execution`, the npm package** (`src/`). The skill runs `npx to-execution init` to deterministically stamp the *invariant* layout. The agent writes only the *variant* (grilled) files.

The split is the point: identical-across-projects files are stamped by the package (no read→write drift); project-specific files are written by the agent during the grill.

## What a set-up project gets

```
CONTEXT.md         glossary + team roster        (grilled)
PHILOSOPHY.md      project working philosophies   (grilled; Principles are baked into the framework)
PROCESS.md         the Lifecycle + Retro Loop     (invariant)
TEAM_DIRECTIVE.md  roster, routing, QA gates      (grilled)
.claude/agents/    scribe + process-adherence + alignment (stamped) + project Teammates/agents (grilled)
schemas/           sprint / issue / progress JSON schemas (invariant)
tmp/exec/          sprint / issue / prd / retro work-tracking (ephemeral, gitignored)
```

## How work runs once set up

`grill → PRD → issues → sprint → retro → edits of persistent docs & Teammate definitions`

Setup and work are separate sessions: the Setup Grill stops at handoff; the Work Grill (`grill-with-docs` → `to-prd` → `to-issues`) starts sprint 1 in a fresh session.

## This repo is its own first customer

`src/` is the product. The repo **root** is a dogfood Instance — stamped once from `src/template/` and maintained **Src-First**: framework changes land in `src/`, then the root is updated to match. See `CONTEXT.md` for the full glossary of terms (Template, Instance, Src-First, Teammate, Invoked Agent, Adherence Agent, Lifecycle, Retro Loop, Principles, Philosophy).

## Develop

```
node src/bin/cli.js --help              # CLI surface
node src/bin/cli.js init <target>       # stamp the invariant layout into a project
```
