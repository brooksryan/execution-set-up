---
status: accepted
date: 2026-06-10
---
# 0007 — One global viewer server with a repo registry; writes go through it

The status-page viewer track lands in three steps (EXEC-054/055/056). Step 1 validates a per-repo auto-run server on the dogfood Instance: SessionStart hook (a `viewer_server` toggle on the ADR-0006 plumbing, off in the template, on here), idle self-exit instead of any shutdown hook (crash-proof orphan prevention), hash-derived port per repo in a quiet range with a `*_progress.json` discovery record. Step 2 replaces per-repo servers with **one globally-installed server** on a well-known port: each repo's hook registers its path, the server serves any registered repo (`/repo/<hash>/`), giving one process, one bookmark, and a cross-Instance dashboard. Viewer assets are served from each repo, not the package, so server-vs-Instance version skew stays shallow. Step 3 makes the viewer read-write for issues: the server validates against `issue.schema.json`, assigns ids as the mechanical arm of the scribe-assigns-ids rule, and writes atomically — scribe stays the process owner; the server is its instrument, like clerk.

## Considered Options

- **Per-repo servers from a global binary** — less template drift but still N processes, N ports, no cross-repo view; mostly a packaging change.
- **SessionEnd-hook shutdown** — leaks the server on crashed/killed sessions; rejected for idle self-exit.
- **Write-queue for scribe / browser-only drafts** — pure ownership but edits don't appear until an agent runs; the page feels broken.

## Consequences

- Serving is localhost-only, GET-only until step 3, path-whitelisted to viewer assets + `.excn/*.json` — repos can hold credentials; no general file serving.
- The discovery record (port/pid/repo) is the contract steps 2–3 build on; it lives in the gitignored `*_progress.json` class.
- Step 2 introduces the framework's second distributed package; version-skew management between it and stamped Instances becomes a standing concern.
