# Team Directive

How this team interacts. Enforced by the Team Lead; a directive one-off gets authored if the team grows.

## Mission

Ship and maintain the execution framework — the `to-execution` package and skill. Done = a lead runs the skill in a fresh repo and gets a working Instance without ever touching this repo.

## Roster

| Teammate | Role | Owns | Must not |
|---|---|---|---|
| Team Lead | main session | arbitration, `src/template` content, one-off authoring (Adherence Agents, ADRs, release docs), final approval | — |
| scribe | structured artifacts | sprint/issue JSON, `CONTEXT.md` terms, the Retro Loop | code; next-steps language; def edits outside the Retro Loop |
| builder | Scaffolder/CLI code | `src/bin` (`cli.js` + `pointer-block.js`), `scripts/preflight.js` | `src/package.json`/publishing; `src/template` content; UI code; persistent docs |
| viewer | presentation | the status-page viewer and UI code over the `.excn` JSON | `src/bin`; mutating work-tracking (read-only); persistent docs |
| packager | npm release | `src/package.json`, versioning, tagging, publishing | `src/bin` implementation code (specs it to builder); `src/template` content; persistent docs |
| architect | research + standards | durable research (`.excn/research/`); authoring `CODE_STANDARDS.md` from it | product/impl code; ratifying its own standards; the `code-standards` gate agent (Team Lead's); the Retro Loop + work-tracking (scribe's) |

## Routing

| Need | Route to |
|---|---|
| CLI / `src/bin` / script code | builder |
| status-page / UI code | viewer |
| version bump / npm publish | packager |
| sprint / issue / retro artifact | scribe |
| template content, design decision, arbitration | Team Lead |
| best-practices research / engineering-standard change | architect |

Sprint slices route to the rostered persistent Teammates; Invoked Agents are for gates and one-shot checks only.

## QA gates

| Work | Gates, in order | Mandatory |
|---|---|---|
| sprint close | process-adherence | yes |
| Teammate-def / persistent-doc change | alignment | yes — during setup too |
| `builder` / `viewer` code change | code-standards | yes |
| `src/bin` or `src/package.json` change | package-qa (with code-standards for `src/bin`) | yes |
| `src/bin` / framework-JS change | cli-code-quality-reviewer (adversarial; logs its verdict to the work's step_log) | recommended |

One-off agents this project needs: `package-qa`, `code-standards` (rubric `.excn/CODE_STANDARDS.md`), `cli-code-quality-reviewer` (adversarial code-quality review of this repo's Node CLI / framework JS — project-scoped, **not** shipped in `src/template`; appends its PASS/FAIL verdict to the active progress record's `step_log`).

Gate agents and `clerk` validate work-tracking JSON with `npx to-execution validate <file>` (it auto-detects the schema, or takes `--schema <path>`) — never an ad-hoc `npm install ajv`, which the next install prunes.

## Escalation

Blocked or in disagreement → Team Lead decides.

Cosmetic ratifications with a sane default (naming, visibility) default-and-flag — they never hold executed work.

## Messaging

- A dispatch that changes a Teammate's obligations completes only when the obligation is visible on disk — send-success is not delivery.
- Long-lived work queues live in spawn prompts or on-disk artifacts, never only in message history.

## Don'ts

- Never edit a root invariant copy directly — `src/` first, then mirror.
- Never hand-copy an invariant file into a project — the Scaffolder stamps it.
- Never publish to npm without Team Lead approval.
- Never bend a guard to fit a procedure — change the procedure.
- Never close a path-changing sweep without checking the live Instance's entry points (root CLAUDE.md, AGENTS.md).
- Never sweep another owner's files — hand the owner the hit list.

- Never hand-write or hand-edit an issue or sprint file — use the `to-execution` CLI (ADR-0011).
