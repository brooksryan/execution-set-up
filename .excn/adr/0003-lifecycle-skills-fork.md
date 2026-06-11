---
status: accepted
date: 2026-06-07
---
# 0003 — Lifecycle skills fork as Instance-stamped skills under distinct `execution-*` names

The Work Grill's three steps depended on globally-installed skills (`grill-with-docs`, `to-prd`, `to-issues`) whose conventions deviate from the framework in six cataloged ways (EXEC-024…029: root-CONTEXT split-brain, glossary format, `docs/adr` hardcode, CONTEXT-MAP, no philosophy route, pointer-blind discovery). We fork all three into Instance-stamped skills — `execution-grill-with-docs`, `execution-to-prd`, `execution-to-issues` — shipped in the template under `.claude/skills/` and stamped by the Scaffolder, because the mission requires a working Instance without touching anything outside it, and adapting global files we don't distribute can't deliver that.

## Considered Options

- **Adapt the global skills** — means editing files outside the framework's distribution or keeping per-Instance translation glue; both fail the zero-glue acceptance (EXEC-011).
- **Fork under the same names** (stamped `to-prd` shadows global `to-prd`) — killed by fact, not taste: Claude Code resolves name collisions personal-over-project, so the stamped fork would be silently ignored on any machine with the globals installed — including this repo's own dogfood root.
- **One combined skill for grill→PRD→issues** — loses the standalone issue path that grill-skipping bug fixes use, and one skill would own three responsibilities.

## Consequences

- Three skills, three names, stamped per-Instance; names publish in 0.3.0 and rename-after is a breaking consumer migration.
- The forks are `.excn`-native by construction: glossary at `.excn/CONTEXT.md` (single context, no CONTEXT-MAP), ADRs at `.excn/adr/`, publish targets the stamped work-tracking files — discovery is explicit paths, never search.
- `execution-to-prd` / `execution-to-issues` carry no markdown format templates; the stamped JSON schemas are their output contracts.
- Philosophy candidates surfaced mid-grill route through the PRD's `notes` into the next sprint's `retrospective_notes` — the Retro Loop stays the sole path into PHILOSOPHY.md.
- Preflight's required-global-skills gate shrinks accordingly (EXEC-010).

## Amendment — 2026-06-10

`make-teammate` joins the stamped skill set (EXEC-074), under its own name rather than an `execution-*` fork: it is generic with no framework-deviating conventions to fix, so the personal-over-project collision is benign — a personal copy is the same skill. With it stamped (and the never-invoked `async-questions` gate removed, EXEC-073), Preflight requires no global skills at all; its one remaining check is a working Node 18+ `npx`. This closes the external-dependency gap that blocked distributing the Setup Skill as a public plugin.
