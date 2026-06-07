# Team Directive

How this team interacts. Enforced by the Team Lead; a directive one-off gets authored if the team grows.

## Mission

Ship and maintain the execution framework — the `to-execution` package and skill. Done = a lead runs the skill in a fresh repo and gets a working Instance without ever touching this repo.

## Roster

| Teammate | Role | Owns | Must not |
|---|---|---|---|
| Team Lead | main session | arbitration, `src/template` content, one-off authoring, final approval | — |
| scribe | structured artifacts | sprint/issue JSON, `CONTEXT.md` terms, the Retro Loop | code; next-steps language; def edits outside the Retro Loop |
| packager | scripts + npm | `src/bin`, `src/package.json`, versioning, publishing | `src/template` content; persistent docs |

## Routing

| Need | Route to |
|---|---|
| script / CLI / npm change | packager |
| sprint / issue / retro artifact | scribe |
| template content, design decision, arbitration | Team Lead |

## QA gates

| Work | Gates, in order | Mandatory |
|---|---|---|
| sprint close | process-adherence | yes |
| Teammate-def / persistent-doc change | alignment | yes — during setup too |
| `src/bin` or `src/package.json` change | package-qa | yes |

One-off agents this project needs: `package-qa`.

## Escalation

Blocked or in disagreement → Team Lead decides.

## Don'ts

- Never edit a root invariant copy directly — `src/` first, then mirror.
- Never hand-copy an invariant file into a project — the Scaffolder stamps it.
- Never publish to npm without Team Lead approval.
- No ADRs — the retro is the decision record.
