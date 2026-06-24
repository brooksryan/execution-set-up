---
id: 019ef6f4-45f8-7d08-ba43-c194758d7dc2
status: accepted
date: 2026-06-23
---
# Speculative pre-warm artifacts are gitignored machine-written state in `.excn/runtime/`; synthesis verifies-and-lands them, never trusting decision-bearing fields

The grill → PRD → issues synthesis tail — measured at ~6–9 minutes of continuous agent work the lead sits and watches, ~40% of it decision-independent grounding (re-reading schemas, glossary, ADR index, minting UUIDs) — is overlappable. To pre-warm and shorten it, the framework gains a class of **speculative pre-warm artifacts** under `.excn/runtime/` (already the home for machine-written state, ADR-0008): a deterministically-regenerated `grounding-pack.json` (resolved schema digest, glossary, ADR index, CLI stamp, UUIDv7 pool), an append-only `grill-decisions.log`, and a speculative `prd-draft.json` a background drafter overwrites as the grill unfolds. They are **gitignored** and **never authoritative**: `execution-to-prd` reads them only as a starting point, regenerates every decision-bearing field, and lands the real artifact through the normal write path. The channel guard (ADR-0011) already ignores `.excn/runtime/`, so no guard change is needed.

## Considered Options

- **Reuse the `*_progress.json` suffix** for the pack/draft so they inherit the existing gitignore — rejected: they are not progress trackers; the viewer would try to render them and `validate`'s shape auto-detect would misfire on them.
- **Stage pre-warm artifacts outside `.excn/`** (OS temp) — rejected: the synthesis skills and the viewer need a stable, discoverable, per-Instance home; ADR-0008 already designates `.excn/runtime/` for machine-written state.
- **Trust the speculative draft wholesale at hand-back** — rejected: the draft is built against a moving target (the grill mid-flight), and the decision-bearing fields (`implementation_decisions`, `testing_decisions`) settle last; a trusted-but-wrong draft anchors the lead to a stale framing. The draft must be verified, not trusted.

## Consequences

- The stamped `.excn/.gitignore` gains pre-warm patterns (`grounding-pack.json`, `prd-draft.json`, `grill-decisions.log` under `runtime/`). This widens ADR-0005's gitignore contract — "only `*_progress.json` is gitignored" — to also exclude regenerable pre-warm cache; the version-controlled work-tracking set is unchanged. It ships as an invariant template edit, not a per-Instance one.
- Pre-warm is a pure accelerator: an absent, stale, or schema-invalid pack or draft falls back to from-scratch authoring, so no pipeline step ever depends on it.
- The regenerator runs behind a feature flag (default off), per ADR-0006 — hooks sense and remind, fail-safe, invocation-logged; they never become a hard dependency of the synthesis path.
- Issues are not pre-drafted: `execution-to-issues` reads settled PRD fields that do not exist until the PRD lands, so the drafter targets the PRD only.
