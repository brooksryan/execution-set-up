# Team Directive

How this team interacts. Enforced by the Team Lead; a directive one-off gets authored if the team grows.

## Mission

Ship and maintain the execution framework — the `to-execution` package and skill. Done = a lead runs the skill in a fresh repo and gets a working Instance without ever touching this repo.

## Roster

| Teammate | Role | Owns | Must not |
|---|---|---|---|
| Team Lead | main session | arbitration, `src/template` content, one-off authoring, final approval | — |
| scribe | structured artifacts | sprint/issue JSON, `CONTEXT.md` terms, the Retro Loop | code; next-steps language; def edits outside the Retro Loop |
| builder | Scaffolder/CLI code | `src/bin` (`cli.js`, `preflight.js`), framework scripts | `src/package.json`/publishing; `src/template` content; UI code; persistent docs |
| viewer | presentation | the status-page viewer and UI code over the `.excn` JSON | `src/bin`; mutating work-tracking (read-only); persistent docs |
| packager | npm release | `src/package.json`, versioning, tagging, publishing | `src/bin` implementation code (specs it to builder); `src/template` content; persistent docs |

## Routing

| Need | Route to |
|---|---|
| CLI / `src/bin` / script code | builder |
| status-page / UI code | viewer |
| version bump / npm publish | packager |
| sprint / issue / retro artifact | scribe |
| template content, design decision, arbitration | Team Lead |

## QA gates

| Work | Gates, in order | Mandatory |
|---|---|---|
| sprint close | process-adherence | yes |
| Teammate-def / persistent-doc change | alignment | yes — during setup too |
| `builder` / `viewer` code change | code-standards | yes |
| `src/bin` or `src/package.json` change | package-qa (with code-standards for `src/bin`) | yes |

One-off agents this project needs: `package-qa`, `code-standards` (rubric `.excn/CODE_STANDARDS.md`).

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
