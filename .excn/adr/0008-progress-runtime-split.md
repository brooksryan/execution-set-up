---
status: accepted
date: 2026-06-10
---
# 0008 — Progress files split into `.excn/progress/` and `.excn/runtime/`; relocation is `migrate`'s job, never `update`'s

`*_progress.json` files had piled up flat at the `.excn/` base — thirteen on the dogfood Instance — mixing two different artifact classes under one suffix. They now split by **writer**: agent- or gate-written records (step logs, verdict ledgers, unit-of-work trackers) live in `.excn/progress/`; hook- or machine-written state (invocation heartbeats, server pid records) lives in `.excn/runtime/`. The `_progress.json` suffix is kept so the stamped `.excn/.gitignore` pattern keeps matching unchanged at any depth. Gate-verdict ledgers get their own `verdict-ledger.schema.json`; `progress.schema.json` keeps the unit-of-work tracker shape. Existing Instances relocate via a new `to-execution migrate` command — versioned, idempotent, location-only — which `doctor` points to when it detects the legacy flat layout; `update`'s never-touch-work-tracking contract stays intact.

## Considered Options

- **One home with name patterns** — one directory, kinds distinguished by filename. Rejected: the guard hook and viewer would parse names to recover what a directory boundary states directly.
- **Drop the `_progress` suffix** (directory carries the class) — rejected for gitignore continuity: the existing `*_progress.json` pattern in every stamped Instance keeps working through the move without a gitignore migration.
- **Fold relocation into `update`** — one command for users, rejected because it carves an exception into update's core safety contract (work-tracking state is never touched), which is what makes `update` trustworthy to run blind.

## Consequences

- Writer determines home: a misfiled write is mechanically detectable, so a location-only deny guard (spawn-guard pattern: PreToolUse, fail-safe, toggleable, invocation-logged) can enforce it per ADR-0006's division — mechanical checks may deny; judgment stays with gates.
- The template ships the two directories; `stamp-policy.js` classifies them work-tracking; hook path constants (`hook-lib`, doctor heartbeats, viewer-server pid record) move to `.excn/runtime/`.
- The viewer reads hook health from `.excn/runtime/hook-invocations_progress.json`; sprint history stays where it was (committed `sprints/` + `issues/sprint-N/`, ADR-0005).
- Naming inside the homes: `<kind>-<id>_progress.json` for ledgers/trackers (`sprint-6_progress.json`, `prd-008_progress.json`, `session_progress.json`, `task-<kebab>_progress.json`); `<feature>_progress.json` for runtime state.
