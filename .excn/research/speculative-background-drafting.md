# Research — Speculative Background Drafting (grill → ADR/PRD/issues, overlapped)

**Researched:** 2026-06-23
**Problem:** The path from "we agreed how this works" to "an agent is doing the work" is `grill → ADR → PRD → issues`, run **serially**. The lead sits through a long grill, then waits *again* while the PRD and issues get authored from scratch. The idea: spawn a background drafter at the **start** of the grill that speculatively drafts the downstream artifacts *as the conversation unfolds*, so the moment the grill ends there is a draft to **modify** rather than author from zero.

---

## Verdict

**Partial — build a narrow version, and only for the PRD step.**

The reasoning chain:

1. **The downstream authoring is not the bottleneck the idea assumes.** I read the three downstream skills. `execution-to-prd` and `execution-to-issues` are explicitly **non-interview** synthesizers — "Do NOT interview — the grill already happened; use what the conversation already holds." Their wall-clock cost is one synthesis pass plus a quiz. The grill itself (one question at a time, wait for answer, walk every branch — `execution-epic-grill` SKILL.md lines 6–14) is where the lead's *minutes* go. Speculative drafting cannot shorten the grill; it can only shorten the synthesis tail.

2. **The synthesis tail has a hard input dependency on grill convergence.** A PRD's `implementation_decisions` and `testing_decisions` come from a module sketch the lead approves *after* requirements are fixed (`execution-to-prd` step 2). Issues are tracer-bullet slices the lead approves in a quiz (`execution-to-issues` step 2, "the HITL heart of this skill"). Both gates are HITL and both consume *settled* decisions. Drafting against a moving grill produces a draft anchored to a framing the grill may have already abandoned by the time it converges.

3. **But a warm draft of the stable parts is real, recoverable value.** Problem statement, actors, user stories, and the glossary-vocabulary framing settle *early* in a grill and rarely reverse. A drafter that produces a schema-valid PRD skeleton with those fields filled — and leaves the decision-bearing fields as marked holes — turns the post-grill PRD step from "author from zero" into "fill the two holes and confirm." That is the genuine, bounded win.

4. **The mechanism is cheap and guard-safe** (see Design). The drafter writes only to a scratch staging area, never to a guarded home; promotion runs through the existing `to-execution` CLI under the lead's eye. No new write path, no guard change, no schema risk.

So: **yes** to a PRD-skeleton drafter that warms the stable fields; **no** to a live issues drafter (the slices depend wholly on the approved module sketch, which doesn't exist until the grill ends — drafting them early is drafting against nothing); **defer** ADRs (they're already written *inline during the grill* by the grill skill itself — see Current Flow — so there is nothing to overlap).

---

## Current flow map — where the latency actually is

The Lifecycle (`.excn/PROCESS.md` lines 5–19): `grill → PRD → issues → sprint → retro`. The grill node expands (`PROCESS.md` lines 22–29): `context-grill (if shared model shifted) → epic-grill → PRD → issues`, each in a **fresh session**.

| Step | Skill (canonical: `src/template/.claude/skills/…`) | Interactive? | Writes to | Latency source |
|---|---|---|---|---|
| Context grill | `execution-context-grill/SKILL.md` | yes, one-Q-at-a-time | `.excn/CONTEXT.md` (term-by-term), `PHILOSOPHY.md` (seed-once), `.excn/adr/` | **lead minutes** |
| Epic grill | `execution-epic-grill/SKILL.md` | yes, one-Q-at-a-time, optional Phase-2 type pass | **`.excn/adr/` only** (lines 16–26) | **lead minutes** |
| PRD | `execution-to-prd/SKILL.md` | **no interview**; one synthesis + a module-sketch confirm | `.excn/prds/<uuid>-<slug>.json` | synthesis pass + 1 confirm |
| Issues | `execution-to-issues/SKILL.md` | quiz to approve slices (HITL) | `.excn/issues/<uuid>-<slug>.json` via CLI | synthesis + quiz |

Key findings about *where the time is*:

- **ADRs are already overlapped.** Both grill skills write ADRs **inline, mid-grill, as decisions crystallise** (`execution-epic-grill` write-guardrail, lines 16–26; `execution-context-grill` lines 14–24). There is no serial "ADR authoring step" after the grill to speculatively pre-empt. The premise's `grill → ADR → PRD → issues` overstates ADRs as a separate downstream stage; they're a grill-time side effect. **Drop ADRs from scope.**
- **The PRD step is a pure synthesis of what the conversation already holds** — exactly the thing a background reader of the same conversation could pre-compute. This is the one true overlap opportunity.
- **The issues step depends on an artifact that does not exist until the PRD step runs** (it reads `user_stories` and `implementation_decisions` from the PRD — `execution-to-issues` line 13). Overlapping it with the grill means drafting against inputs that aren't produced yet. **Drop issues from the live-overlap scope**; the most you can do is pre-warm them *after* the PRD draft exists, which is a smaller, separate win.

So the real, narrow target is: **overlap the PRD synthesis with the epic-grill, on the early-settling fields only.**

---

## The constraint that decides the mechanism

From the Claude Code capability check (verified against current docs):

- A **one-shot background agent** (`Agent` tool, `run_in_background: true`) is **fire-and-forget**: it takes one prompt and cannot be fed new context mid-run. It can't track an evolving grill.
- A **persistent teammate** (agent-team mechanism, the same primitive `make-teammate` uses) **stays alive and receives messages over its lifetime** via SendMessage. This is the only primitive that can be "updated as the grill unfolds."
- **There is no file-watch primitive.** A poller must run its own Bash `until`-loop. Each teammate message re-enters the teammate's full context (token cost scales with messages; mid-session prompt caching is likely but undocumented).

This rules out the naive "one long background agent watching a file." Two viable shapes remain: **(A) checkpoint re-spawn** — a fresh one-shot drafter at grill checkpoints, each reading the same scratch file; **(B) one persistent drafter teammate** messaged at checkpoints. (A) is stateless and cheap per run but redrafts from scratch each time; (B) is warm but pays standing context cost and adds a teammate to manage. For a single-lead grill, **(A) checkpoint re-spawn is the right default** — it sidesteps teammate lifecycle entirely and the redraft cost is small because the input (a decisions scratch file) is small.

---

## Recommended design

**Name:** *PRD pre-warm* — a checkpoint-spawned drafter that keeps a schema-valid PRD skeleton warm in a scratch staging file during the epic-grill, promoted through the normal `execution-to-prd` path at grill end.

### Pieces

1. **A grill-decisions scratch file.** The epic-grill appends a one-line decision record to a scratch file each time a requirement branch resolves — e.g. `.excn/runtime/grill-decisions.md` (`.excn/runtime/` is hook/runtime-owned and **not** channel-guarded; confirmed: the guard fires only on `.excn/issues/` and `.excn/sprints/` — `channel-guard-rules.cjs` line 12). This is a tiny, append-only log: "RESOLVED: <branch> → <decision>". It costs the grill almost nothing and is the drafter's sole input, so the drafter never re-reads the whole transcript.

   *This is the one change to an existing skill:* add an append line to `execution-epic-grill` ("when a requirement branch resolves, append it to the decisions scratch"). Keep it a single sentence — Precise Minimalism (`PHILOSOPHY.md`).

2. **A checkpoint trigger.** At natural grill checkpoints (end of Phase 1 requirements; end of an optional Phase 2 type pass), the grill spawns a one-shot drafter with `run_in_background: true`. The spawn prompt is fixed and tiny: "Read `.excn/runtime/grill-decisions.md` and `.excn/CONTEXT.md`. Draft a schema-valid PRD per `.excn/schemas/prd.schema.json` into `.excn/runtime/prd-draft.json`. Fill `problem_statement`, `solution`, `user_stories` from the decisions. Leave `implementation_decisions` and `testing_decisions` as empty arrays — those are set by the human module-sketch step. Set `status:"draft"`, `issues:[]`, mint `id` with `npx to-execution uuid`." The drafter overwrites the staging file each checkpoint (idempotent; latest wins).

3. **Staging area, never the guarded home.** The drafter writes `.excn/runtime/prd-draft.json` — a *raw* file in an unguarded directory. It is **not** a real PRD yet. The channel guard is irrelevant here (PRDs aren't guarded at all — only issues/sprints are), but staging in `.excn/runtime/` keeps the draft out of `.excn/prds/` so a half-baked skeleton never masquerades as a published PRD.

4. **Handback at grill end.** When `execution-to-prd` runs, it checks for `.excn/runtime/prd-draft.json`. If present and schema-valid, it **loads it as the starting point** instead of authoring from zero: the stable fields are pre-filled, the lead does the module-sketch confirm (step 2) to fill `implementation_decisions`/`testing_decisions`, and the skill writes the final `.excn/prds/<uuid>-<slug>.json` the normal way. If absent or stale (decisions file newer than draft), it falls back to authoring from scratch — the pre-warm is a pure accelerator, never a dependency.

5. **Issues stay fully post-PRD.** No live overlap. Optionally, once the PRD draft exists, the same checkpoint mechanism could pre-warm an issue-slice *list* (titles + HITL/AFK guesses) into `.excn/runtime/issue-slices.md` as quiz fodder — but the records themselves are **only ever created through `to-execution issue create`** (the CLI is the sole write path; a raw write under `.excn/issues/` is denied — `execution-to-issues` line 40, ADR-0011). The drafter never touches `.excn/issues/`; it produces a *suggestion list* the human quiz consumes, and the approved slices go through the CLI exactly as today.

### How it respects the guard and schemas

- **Guard:** the drafter writes only `.excn/runtime/*` (unguarded). Every real artifact still lands the normal way — PRDs as a raw Write by `execution-to-prd` (PRDs were never guarded), issues through `to-execution issue create` (the only path the guard permits). No guard is bent — Don'ts ("Never bend a guard to fit a procedure").
- **Schemas:** the staging draft is written against `prd.schema.json` and re-validated at handback (`npx to-execution validate` auto-detects PRD shape). A schema-invalid draft is discarded and the skill authors from scratch — drift can only cost the pre-warm, never corrupt an artifact.
- **IDs:** the staging draft mints a UUIDv7 via `npx to-execution uuid` (confirmed working), so the handback id is real and unique; if the draft is discarded the id is simply unused (ids are cheap, never reused).

---

## Phasing

**Phase 1 — smallest valuable (build this first).**
No background agent at all. Add the decisions-scratch append to `execution-epic-grill`, and have `execution-to-prd` read that scratch file as a structured starting point. This captures most of the value (the PRD step starts from a structured digest of settled decisions instead of re-derived-from-transcript) with **zero concurrency, zero new failure modes, one skill edit on each side**. It is a strict improvement and a prerequisite for Phase 2 anyway (the drafter needs the scratch file to exist).

**Phase 2 — the actual overlap.**
Add the checkpoint-spawned background drafter that keeps `.excn/runtime/prd-draft.json` warm during the grill, and the handback load in `execution-to-prd`. This is the speculative-overlap version. Build it only if Phase 1 shows the synthesis tail is still a felt wait.

**Phase 3 (optional) — issue-slice pre-warm.**
After the PRD draft exists, pre-warm a slice *suggestion list* for the issues quiz. Lowest value (the issues quiz is already fast and the slices need the approved module sketch), highest framing-anchor risk. Do last or not at all.

Each phase is a chartered `grill → PRD → issues` body of work in this repo, routed to `scribe` (skill content) — the skills are `src/template` content, so **Src-First**: edit `src/template/.claude/skills/…` then mirror to root.

---

## Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Draft anchors the lead to a wrong/abandoned framing.** A pre-filled PRD makes the lead edit-to-fit instead of think fresh. | high — this is the real danger | Pre-warm only the *early-settling, rarely-reversed* fields (problem, actors, user stories). Leave every decision-bearing field (`implementation_decisions`, `testing_decisions`) as an explicit hole the lead fills live. The draft is scaffolding, not a proposal. |
| **Wasted tokens on drafts thrown away.** Each checkpoint redrafts. | low | Input is a tiny decisions scratch file, not the transcript, so each redraft is cheap. Checkpoint-spawn (not a standing teammate) means zero idle cost between checkpoints. |
| **Schema drift** — drafter emits an invalid PRD. | low | Re-validate at handback with `to-execution validate`; on fail, discard and author from scratch. The pre-warm can never produce a *landed* invalid artifact. |
| **Guard rejects promotion.** | none for PRD (unguarded); none for issues (drafter never writes `.excn/issues/` — only the CLI does). | Design routes every real write through its sanctioned path. The guard is never on the critical path. |
| **Race on the staging file** — drafter writing `prd-draft.json` while `execution-to-prd` reads it. | low | Single staging file, last-write-wins, overwritten atomically; the grill and the PRD step are sequential (PRD runs *after* grill end), so the final checkpoint draft is settled before handback reads it. Use a freshness check (decisions-file mtime vs draft mtime) to detect a checkpoint still in flight and fall back to scratch authoring. |
| **Stale draft from an earlier grill** in `.excn/runtime/`. | low | `execution-to-prd` clears/ignores any `prd-draft.json` whose backing decisions file predates the current session, and `.excn/runtime/` is gitignored runtime scratch, not committed state. |
| **Premise creep** — someone tries to also overlap ADRs or live-overlap issues. | medium | ADRs are already written inline by the grill (no overlap to gain); issues depend on the post-grill PRD (nothing to draft against early). Scope is PRD-skeleton only — documented above. |

---

## Pointers

- Lifecycle & gates: `.excn/PROCESS.md` (lines 5–61)
- Grill skills (canonical): `src/template/.claude/skills/execution-epic-grill/SKILL.md`, `…/execution-context-grill/SKILL.md`
- Synthesis skills: `src/template/.claude/skills/execution-to-prd/SKILL.md`, `…/execution-to-issues/SKILL.md`
- Schemas the drafts must satisfy: `.excn/schemas/prd.schema.json`, `.excn/schemas/issue-record.schema.json`
- CLI write path & verbs: `src/bin/cli.js` (`issue create`, `uuid`, `validate`), `src/bin/write-policy.js`, `src/bin/write-record.js`
- Channel guard (fires only on `.excn/issues/`, `.excn/sprints/`): `src/template/.claude/hooks/channel-guard.cjs`, `…/channel-guard-rules.cjs`
- Background-agent mechanics: a persistent teammate can be messaged over its lifetime; a one-shot `run_in_background` agent cannot — no file-watch primitive exists (verified against current Claude Code docs)
