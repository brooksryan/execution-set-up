---
status: accepted
date: 2026-06-10
---
# 0006 — Stamped hooks sense and remind; they never spawn gates

The Template gains hook wiring (grounded in `.excn/research/teammate-hook-triggers.md`): one script per feature, each wired in the stamped `.claude/settings.json` and toggled by a schema-validated config in `.excn/`. Hooks are **remind-only** — `PostToolUse` on gate-relevant paths injects a "gate due" reminder via `additionalContext`, and `Stop` blocks an agent idling with gated edits but no gate verdict; the Team Lead or Teammate still spawns the gate. We rejected hooks that auto-spawn gate agents: a full agent run inside a hook is slow, burns tokens on every edit burst, can wedge a session, and the judgment-timed gates (process-adherence, alignment) have no mechanically detectable firing moment — heuristics would over-fire.

## Consequences

- Per-feature scripts, shared identity convention (payload `agent_type`/`agent_id`); features added by adding a script + config entry, not rewiring.
- Defaults at stamp: gate reminders **on**; message follow-through nudge and load reporting ship present but **off** until proven on the dogfood Instance.
- The follow-through nudge triggers on **sent** messages (sender-session `PostToolUse` → `additionalContext`); the load record is hook-appended `.excn/load_progress.json` (matches the `*_progress.json` ignore class of ADR-0005; viewer-fetchable; schema in `.excn/schemas/`).
- Injected reminders must read as legitimate ops instruction — `additionalContext` is model-judged, not a trusted channel (research §3.1).
- Mechanical secretary work (partition moves, status flips, verdict appends) routes to a small-model **clerk** Invoked Agent; scribe keeps judgment work (Retro Loop drafts, glossary stewardship) and remains the owner.
