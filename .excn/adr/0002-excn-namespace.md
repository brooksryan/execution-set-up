---
status: accepted
date: 2026-06-07
---
# 0002 — All framework artifacts live in `.excn/` at the Instance root

A scaffolded Instance previously spread framework docs across the host repo's root (CONTEXT.md, PHILOSOPHY.md, PROCESS.md, TEAM_DIRECTIVE.md, schemas/, tmp/exec/). We move everything the framework owns into one root dotfolder — `.excn/` — leaving the host root with exactly one touch: a small pointer block in its existing agent-instruction file. Research (`.excn/research/agent-context-loading.md`) showed no tool ingests arbitrary folders (filenames trigger ingestion, not folders), dotfolders are invisible to default search, and lazy loading works in every harness via explicit-path plain-text pointers — so a dotfolder namespace costs nothing and guarantees agents load framework docs only when they need them.

## Considered Options

- `.exec` — unclaimed, but reads as Unix exec / an executables directory; `.excn` is unique, colliding with nothing by construction.
- `.docs` — unclaimed but a semantic twin of the `docs/` convention; says "documentation" about files that are an operating contract, and invites human misfiling.
- Visible `exec/` or status-quo root spread — root clutter, real collision risk, and content swept into default search and editor indexes.

## Consequences

- Contents: `.excn/{CONTEXT,PHILOSOPHY,PROCESS,TEAM_DIRECTIVE}.md`, `adr/`, `schemas/`, `research/` (durable research docs, committed), `tmp/` (work-tracking, gitignored — replaces `tmp/exec/`).
- Pointer blocks must carry full explicit paths — dotfolder content never surfaces in default search.
- No file inside `.excn/` may be named `CLAUDE.md` or `AGENTS.md`; those filenames auto-ingest per-directory in Claude Code, Copilot, and Cursor regardless of folder.
- Claude `@import` is banned for wiring — it inlines at launch. Plain-text pointers only, sized for Codex's hard 32 KiB instruction-chain cap.
- v0.1.0 stamped the old layout; this restructure lands as 0.2.0. The root Instance migrates by hand.

## Amendment — 2026-06-07 (EXEC-023)

The inner `tmp/` level is removed: work-tracking lives flat in `.excn/` — `sprints/`, `issues/`, `prds/`, `retros/`, `*_progress.json` — ignored explicitly by the stamped `.excn/.gitignore`. The ephemeral/committed split survives unchanged. Lands as 0.2.2.
