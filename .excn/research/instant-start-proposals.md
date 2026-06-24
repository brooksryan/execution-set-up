# Research — Instant-Start: making post-grill artifact authoring *feel like magic*

**Researched:** 2026-06-23
**Builds on:** `.excn/research/speculative-background-drafting.md` (the flow map, the channel-guard facts, the staging-area / checkpoint-respawn design). Read that first — this doc does not repeat it; it adds the prior-art digest and three concrete proposals.

## The problem, restated precisely

The bottleneck is **not** agent compute. Measured: the continuous-synthesis tail is ~6–9 min, and a real `to-issues` run was ~6.7 min end to end. The problem is the **felt wait** — Brooks sits watching the agent spin up before implementation begins.

Decomposing that real 6.7-min run:

- **~2.5 min (≈40%): GROUNDING.** Re-read the `.excn` tree, the JSON schemas (prd/issue/sprint), `ADR-FORMAT.md`, the `CONTEXT.md` glossary, an example ADR/PRD; mint UUIDs; confirm the CLI works. **Identical every run. Depends on none of the grill's decisions.**
- ~1 min: ADR + PRD written.
- ~0.5 min: a schema-validation fix-loop (`notes must be an array`).
- ~1.5 min: 4 issues created via CLI + forward-linked + validated.

Two costs are pure, decision-independent overhead and the magic-killers: the **grounding tax** and the **schema fix-loop**. Everything below targets those two.

---

## Part 1 — Prior art (nothing new under the sun)

Eight patterns from systems that make waits feel instant or eliminate them. Each: source (URL + one-line takeaway), then the mechanism, then which of *our* primitives realizes it.

### 1. LLM speculative decoding — draft model + parallel verify
A small fast "draft" model proposes tokens; the large model verifies them in one parallel pass and accepts the matching prefix. Output is provably identical to the target model alone; speedup scales with the acceptance rate α.
- Source: [NVIDIA — An Introduction to Speculative Decoding](https://developer.nvidia.com/blog/an-introduction-to-speculative-decoding-for-reducing-latency-in-ai-inference/) — draft-then-verify guarantees the target model's exact output while cutting forward passes.
- Source: [BentoML — Speculative decoding](https://bentoml.com/llm/inference-optimization/speculative-decoding) — acceptance rate α is the lever; high α means fewer expensive verify passes.
- **Maps to us:** a cheap background drafter writes a *draft* PRD/issue-slice list to scratch during the grill; the real `execution-to-prd` / `execution-to-issues` skill is the **verifier** — it accepts the matching prefix (stable fields) and regenerates only the divergent part (decision-bearing fields). The draft is never trusted; it is *verified* through the normal guarded path. Exactly the speculative-background-drafting design, now named correctly.

### 2. Speculative execution / branch prediction (the design metaphor)
The CPU predicts the branch and executes ahead; on mispredict it discards the speculative work. Agentic systems now do the same: generate a *predicted* tool output, compute the next step against it, and commit if the real output matches, discard if it diverges.
- Source: [Zylos Research — Speculative Execution and Parallel Tool Calling in AI Agents](https://zylos.ai/research/2026-04-08-speculative-execution-parallel-tool-calling-ai-agents/) — predict slow tool output, compute ahead, commit-or-discard; 2–5× latency cuts, tool execution is 35–61% of agent request time.
- **Maps to us:** the grounding read is our "slow tool." Precompute it speculatively the instant a grill starts (before we know the grill's decisions — grounding doesn't depend on them). On the rare mispredict (schemas changed mid-session) we just re-read. Discard cost is near zero.

### 3. Optimistic UI / optimistic concurrency control
Show the expected result immediately, do the real write in the background, roll back on conflict. The rollback stack is the heart of the pattern; the action must be reversible/non-critical.
- Source: [Wikipedia — Optimistic concurrency control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control) — assume success, validate at commit, roll back on conflict.
- Source: [OpenReplay — How Optimistic Updates Make Apps Feel Faster](https://blog.openreplay.com/optimistic-updates-make-apps-faster/) — capture a rollback snapshot, apply locally, reconcile or revert on server ack.
- **Maps to us:** the scratch staging file (`.excn/runtime/`) **is** the optimistic local state. It is unguarded and disposable — the perfect rollback-safe surface. Promotion through the CLI / the `execution-to-prd` write is the "server ack." A bad draft costs only a discarded scratch file; the guarded homes are never touched optimistically.

### 4. Prefetching & prerendering — Speculation Rules API
Tell the browser which navigations are likely; it fetches/renders them into an invisible tab so the next click is near-instant. Prerender does the full work ahead of time; activation just swaps the tab in.
- Source: [Chrome for Developers — Prerender pages for instant navigations](https://developer.chrome.com/docs/web-platform/prerender-pages) — render the likely-next page in a hidden tab; navigation becomes tab activation.
- Source: [MDN — Speculation Rules API](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API) — declarative rules for what to prefetch/prerender ahead of need.
- **Maps to us:** the "likely next navigation" after any grill is **always** `→ PRD → issues`. It is the most predictable navigation in the whole system — a 100%-confidence speculation rule. Prerender it: keep a warm PRD skeleton + grounding context staged in the invisible tab (`.excn/runtime/`), so the post-grill step is "activate the staged draft," not "author from zero."

### 5. Skeleton screens — perceived performance
A skeleton of the final layout makes a wait feel like a transition-in-progress, not dead time. Facebook measured ~300 ms *perceived* improvement vs a spinner with no change in actual load; bounce-rate drops of 9–20% reported.
- Source: [NN/g — Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/) — show the structure of incoming content to shorten *perceived* wait.
- Source: [The effect of skeleton screens (ECCE 2018)](https://dl.acm.org/doi/10.1145/3232078.3232086) — users perceive skeleton-screen loads as faster and easier to navigate.
- **Maps to us:** the **execution viewer** (localhost status page, already served by a SessionStart hook). Render the forming PRD/issues as a *skeleton* — titles and field labels filling in live — so Brooks watches structure appear instead of a spinning agent. This attacks the *felt* wait directly, even with compute unchanged.

### 6. The psychology of waiting — labor illusion, progress visibility
Visible feedback makes waits feel 11–15% faster (NN/g). Attention drifts after ~1 s of dead time. A bar that moves steadily feels faster and more trustworthy than one that stalls. The "labor illusion": showing the work being done raises perceived value and tolerance for the wait.
- Source: [NN/g response-times research, via design analyses](https://www.nngroup.com/articles/skeleton-screens/) — waits with feedback feel 11–15% faster; dead time loses attention after ~1 s.
- Source: [The Psychology of Waiting: A Guide to Loaders in UX](https://medium.com/design-bootcamp/the-psychology-of-waiting-in-ux-0f0b24cdeb8f) — acknowledged waits are forgiven; steady/accelerating progress feels faster; stalls feel slower.
- **Maps to us:** stream the drafter's progress to the viewer as a steadily-advancing checklist ("grounding ✓ · problem statement ✓ · 3 user stories drafted · sketching modules…"). Show the labor. The wait becomes watching the artifact *form*, not watching an agent *think*.

### 7. Warm pools / pre-warming — serverless cold-start mitigation
Keep pre-initialized execution environments ready so the expensive one-time init is already paid when a request lands. Provisioned concurrency (guaranteed-warm, you pay for idle) vs scheduled keep-alive pre-warming (cheap, best-effort). SnapStart: snapshot a fully-initialized environment, restore on demand.
- Source: [AWS — Understanding and Remediating Cold Starts (Lambda)](https://aws.amazon.com/blogs/compute/understanding-and-remediating-cold-starts-an-aws-lambda-perspective/) — keep environments initialized so init cost isn't on the request path.
- Source: [Mitigating Cold Starts: A Pool-Based Approach (arXiv:1903.12221)](https://arxiv.org/pdf/1903.12221) — a pool of pre-initialized instances removes init from the critical path.
- **Maps to us:** the grounding read **is our cold start** — heavy one-time init (schemas, glossary, ADR format, CLI check) that is identical every run. "SnapStart" it: snapshot the grounding into a compact, machine-read **grounding pack** in `.excn/runtime/`, refreshed only when its inputs change, so the synthesis skill restores it instead of re-reading the whole tree. This is the single highest-leverage move — it directly kills the 40% grounding tax.

### 8. Speculative query prediction — pre-generate the likely next answer
Predict the user's probable next question and pre-compute its answer; if the real question is close enough, serve the precomputed result instantly.
- Source: [Zylos Research (same as #2)](https://zylos.ai/research/2026-04-08-speculative-execution-parallel-tool-calling-ai-agents/) — speculate on follow-up queries and pre-generate answers for instant delivery.
- **Maps to us:** after the grill, the "next question" is always "what's the PRD?" then "what are the issues?". Pre-generate the PRD-skeleton answer during the grill (the speculative-drafting design), and pre-generate the issue-slice *suggestion list* once the PRD draft exists, so the HITL quiz starts pre-populated.

### Pattern → primitive summary

| Prior-art pattern | Our primitive that realizes it |
|---|---|
| Speculative decoding (draft+verify) | background `Agent` drafter → scratch; real skill verifies & promotes via CLI |
| Speculative execution / branch prediction | precompute grounding at grill-start; discard on rare mispredict |
| Optimistic UI / OCC | `.excn/runtime/` scratch = rollback-safe optimistic state; CLI = commit |
| Prerender / Speculation Rules | grill→PRD→issues is a 100%-confidence speculation; prerender to `.excn/runtime/` |
| Skeleton screens | execution viewer renders the forming artifact as a skeleton |
| Psychology of waiting / labor illusion | viewer streams steady progress; show the labor |
| Warm pools / SnapStart | **grounding pack** snapshot in `.excn/runtime/`, restored not re-read |
| Speculative query prediction | pre-generate PRD skeleton, then issue-slice suggestions |

---

## Part 2 — Three proposals

All three obey the same invariants, established in the prior research and re-confirmed here:
- The drafter writes **only** to `.excn/runtime/*` — unguarded (the channel guard fires solely on `.excn/issues/` and `.excn/sprints/`; `channel-guard-rules.cjs:12`). PRDs/ADRs are direct writes; issues go **only** through `to-execution issue create`.
- Scratch is disposable. A stale/invalid draft costs the speculation, never a landed artifact (re-validate at promotion with `to-execution validate`; on fail, author from scratch).
- `.excn/runtime/` is gitignored Runtime Records (ADR-0008) and is already **served by the viewer** (`viewer-server-rules.cjs` whitelists `.excn/runtime/*_progress.json`) — so a scratch file there is directly renderable on the status page with zero new plumbing.

---

### Proposal A — **Grounding Pack** (the warm pool; cheapest, highest-leverage)

**Targets:** the grounding tax (≈40%) and the schema fix-loop. Pure compute reduction; no perceived-performance trick needed because it removes the wait outright.

**Mechanism.** Treat grounding as a serverless cold start and SnapStart it. A small precompiled **grounding pack** at `.excn/runtime/grounding-pack.json` holds everything the synthesis skills re-derive every run:
- the **resolved schema digest** for prd/issue/sprint — every field, its type, `required`/optional, enum values, and the array-vs-string traps (e.g. `notes` is an array — the exact thing that caused the fix-loop), distilled from `.excn/schemas/*.json`;
- the **glossary vocabulary index** (terms from `CONTEXT.md`) and the **ADR decision index** (title + one-line holding per ADR), so the skill doesn't re-read every ADR body;
- a tiny **CLI capability stamp** (the `issue create` flag list + a fresh pre-minted UUIDv7 pool of, say, 8 ids) so the skill neither shells out to `--help` nor mints ids one-at-a-time on the critical path.

The pack is **continuously kept warm** by a `PostToolUse` hook (matcher `Write|Edit`) that, when any of its inputs change (`.excn/schemas/*`, `.excn/CONTEXT.md`, `.excn/adr/*`, `src/bin/cli.js`), marks the pack stale; a cheap regenerator (a `node` script, no LLM) rebuilds it. The pack is decision-independent, so it's valid across every grill — built once, reused forever, refreshed only on the rare input change. This is the "continuously modify the scratch surface" requirement satisfied by a *deterministic* updater rather than an LLM, which is correct here: grounding has no judgment in it.

**How promotion / the guard works.** The pack never becomes an artifact — it's read-only input. The synthesis skills (`execution-to-prd`, `execution-to-issues`) get one new line in their "Read first" block: *"If `.excn/runtime/grounding-pack.json` exists and is fresh, read it instead of re-reading the schemas, glossary, and ADR bodies; fall back to the full read if absent or stale."* All real writes still go their sanctioned path (PRD direct write, issues via CLI). The guard is never on the path.

**How it kills the two costs.**
- *Grounding tax:* the 2.5-min tree-walk collapses to one small JSON read. This is the direct hit.
- *Schema fix-loop:* the pack carries the exact field-type rules (`notes: array`, etc.) front-and-center, so the skill emits valid JSON the first time. The fix-loop was a grounding *miss*; the pack prevents the miss.

**Why it feels like magic.** Warm-pool principle: the expensive init is already paid when the request lands. The user's command lands on a pre-warmed environment, so "real work" starts in seconds. No illusion required — the wait is genuinely gone.

**Cost / risk / smallest first version.**
- Cost: one `node` regenerator script + one staleness hook + one "Read first" line in two skills. No LLM tokens, no concurrency.
- Risk: low. Stale pack → fall back to full read (the freshness check is mtime-of-inputs vs pack). A wrong pack can only make a run as slow as today, never wrong (schemas are still the authority; pack is a cache).
- Smallest v1: ship just the **schema digest** half of the pack (kills the fix-loop and the schema-read slice of grounding), regenerated by hand or by a `prepare` CLI verb. Defer the glossary/ADR index and UUID pool to v2. This is a strict improvement with essentially zero new failure modes — build it first.

---

### Proposal B — **Speculative Prerender** (the ambitious one: draft-and-verify the PRD live)

**Targets:** the grounding tax *and* the ADR→PRD authoring minute, by overlapping them with the grill itself (they finish before the grill ends). This is the speculative-decoding / prerender pattern, end to end. It **subsumes Proposal A** (the drafter consumes the grounding pack) — build A first, then B on top.

**Mechanism (the continuously-updated scratch surface).** Three pieces, all from the prior research's checkpoint-respawn design, now wired to the viewer:

1. **A grill-decisions log.** `execution-epic-grill` gets one new instruction: when a requirement branch resolves, append a one-line record to `.excn/runtime/grill-decisions.md` (`RESOLVED: <branch> → <decision>`). Tiny, append-only, the drafter's sole input — so the drafter never re-reads the transcript.

2. **A checkpoint-spawned background drafter.** At natural grill checkpoints (end of requirements; end of an optional type pass), the grill fires an `Agent` with `run_in_background: true`. Fixed tiny prompt: *"Read `.excn/runtime/grounding-pack.json` and `.excn/runtime/grill-decisions.md`. Write a schema-valid PRD to `.excn/runtime/prd-draft.json`: fill `problem_statement`, `solution`, `user_stories` from the decisions; leave `implementation_decisions` and `testing_decisions` as empty arrays (the human module-sketch step fills them); `status:"draft"`; `issues:[]`; take an `id` from the pack's UUID pool."* Each checkpoint **overwrites** the draft — last-write-wins, idempotent. This is how the scratch surface is *continuously modified as the grill unfolds*: re-spawn per checkpoint, each reading the latest decisions log. (Checkpoint re-spawn beats a standing teammate here — stateless, zero idle cost, and the input is tiny so each redraft is cheap. A persistent teammate via `SendMessage` is the alternative if we later want a single warm context, but it pays standing token cost for a single-lead grill.)

3. **Handback = verify.** When `execution-to-prd` runs, it checks `.excn/runtime/prd-draft.json`. Fresh + schema-valid → **load it as the starting point** (the speculative-decoding *accept*): stable fields pre-filled, lead does only the module-sketch confirm to fill the two decision fields, skill writes the final `.excn/prds/<uuid>-<slug>.json` the normal way. Absent/stale/invalid → author from scratch (the *reject/regenerate* path). The pre-warm is a pure accelerator, never a dependency.

**Scope discipline (carried from prior research):** PRD skeleton only. **No live issues drafting** — issue slices depend on the post-PRD module sketch, which doesn't exist until the grill ends; drafting them early is drafting against nothing. ADRs are already written inline by the grill, so there's nothing to overlap there. Optionally, *after* the PRD draft exists, pre-warm an issue-slice **suggestion list** to `.excn/runtime/issue-slices.md` as quiz fodder — but records still only ever land through `to-execution issue create`.

**How it kills the two costs.**
- *Grounding tax:* paid during the grill, off the critical path (and the drafter uses the pack, so it's cheap even in the background).
- *PRD authoring minute:* also paid during the grill. Post-grill, the PRD step is "confirm two fields," not "author from zero."
- *Schema fix-loop:* the draft is written against the pack's schema digest and re-validated at handback; an invalid draft is silently discarded, never landed.

**Why it feels like magic.** Prerender principle: the next navigation is rendered into an invisible tab before the click. The grill→PRD navigation becomes *tab activation*. Brooks finishes the grill and the PRD is already there, waiting to be confirmed — the dead wait is gone because the work happened *while he was still talking*.

**Cost / risk / smallest first version.**
- Cost: background-agent tokens per checkpoint (small — input is the decisions log + pack, not the transcript); two skill edits (grill append + PRD handback); depends on Proposal A.
- Risk (the real one): **anchoring** — a pre-filled PRD makes the lead edit-to-fit instead of think fresh. Mitigation, non-negotiable: pre-warm only the *early-settling, rarely-reversed* fields (problem, actors, user stories); leave every decision-bearing field an explicit hole. The draft is scaffolding, not a proposal.
- Smallest v1: **no background agent at all.** Just add the grill-decisions append and have `execution-to-prd` read that log as a structured starting point. Captures most of the value (PRD starts from a digest of settled decisions, not a re-derived transcript) with zero concurrency. The actual background overlap is v2, built only if the synthesis tail is still felt after A + this.

---

### Proposal C — **Live Skeleton in the Viewer** (perceived-performance; compute may be unchanged)

**Targets:** the *felt* wait specifically — Brooks watching the agent spin up. Even if compute were untouched, this changes the experience from "watching a spinner" to "watching the artifact form." Best paired with A or B (it renders *their* scratch surface), but it delivers standalone.

**Mechanism (the continuously-updated scratch surface, made visible).** The drafter (or even the live synthesis skill) writes its forming artifact to a viewer-renderable scratch file as a **skeleton record** — `.excn/runtime/draft-skeleton_progress.json` (the `_progress.json` suffix puts it in the viewer's existing whitelist, ADR-0008, so **no viewer-server change is needed to serve it**). The record is a flat checklist of the artifact's fields with per-field status: `pending` → `drafting` → `filled`. The drafter updates it continuously as each field resolves — *this is the continuous-modification mechanism, surfaced to the user.* The viewer (owned by the `viewer` teammate) gets a small panel that renders the skeleton: greyed field labels that fill in with content as status flips, plus a steadily-advancing top-line ("grounding ✓ · problem ✓ · 3/3 user stories · sketching modules…").

**How promotion / the guard works.** The skeleton is *display only* — it never becomes an artifact. Promotion is identical to Proposal A/B: the real PRD/issues land through their sanctioned write paths. The skeleton file is disposable scratch, cleared at session end. The guard is irrelevant (it's `.excn/runtime/`, unguarded, and never on the artifact path).

**How it kills the two costs.** It doesn't remove them — it *re-frames* them. Honest accounting: C alone leaves grounding and the fix-loop intact; it converts dead time into *acknowledged, visibly-progressing* time. That's why it should ride on A/B (which remove the compute) — together, the wait is both shorter *and* feels like a transition. C's unique contribution: even the residual ~1–2 min of genuine synthesis stops feeling like dead time.

**Why it feels like magic.** Skeleton-screen + labor-illusion principle, with hard numbers behind it: feedback makes waits feel 11–15% faster (NN/g); Facebook measured ~300 ms perceived improvement from a skeleton with no change in actual load; attention drifts after ~1 s of dead time. Showing the artifact's structure fill in live is the strongest known *perceived*-performance lever, and we already have the surface (the viewer) to show it on.

**Cost / risk / smallest first version.**
- Cost: one viewer-panel change (route to the `viewer` teammate) + the drafter/skill writing the skeleton record. No new server, no whitelist change.
- Risk: low. Worst case the panel shows a stale skeleton — cosmetic, never corrupts an artifact. One real risk: a skeleton that *stalls* feels slower than no skeleton (the stalled-progress-bar finding) — so the status must advance at field granularity, not one big jump.
- Smallest v1: render the skeleton from Proposal A/B's existing `prd-draft.json` (poll it, show which fields are non-empty). No new write surface at all — the viewer just reads the draft that already exists and renders its filled-vs-empty fields as a skeleton.

---

## Recommendation

**Build Proposal A (Grounding Pack) first.** It is the cheapest, has essentially no new failure modes, and attacks the largest single cost (the ≈40% grounding tax) *and* the schema fix-loop directly — the two pure-overhead magic-killers. It's also a prerequisite: Proposal B's drafter consumes the pack, and Proposal C can render the pack-accelerated draft. A is a strict, low-risk win that makes B and C cheaper and better. Sequence: **A → B (skeleton-first v1, background overlap only if still felt) → C as the visible layer over both.**

---

## Pointers (all absolute-from-repo-root)

- Prior design this builds on: `.excn/research/speculative-background-drafting.md`
- Schemas the drafts must satisfy: `.excn/schemas/prd.schema.json`, `.excn/schemas/issue-record.schema.json`
- Channel guard (fires only on `.excn/issues/`, `.excn/sprints/`): `src/template/.claude/hooks/channel-guard.cjs`, `…/channel-guard-rules.cjs` (line 12)
- CLI write path & verbs (`issue create`, `uuid`, `validate`): `src/bin/cli.js`
- Synthesis skills to edit (Src-First, then mirror to root): `src/template/.claude/skills/execution-to-prd/SKILL.md`, `…/execution-to-issues/SKILL.md`
- Grill skill to edit (decisions log): `src/template/.claude/skills/execution-epic-grill/SKILL.md`
- Viewer surface + serving whitelist (`.excn/runtime/*_progress.json` already served): `src/template/.claude/hooks/viewer-server-rules.cjs`, `…/viewer-server-daemon.cjs`
- Scratch home (unguarded, gitignored, viewer-served): `.excn/runtime/`
