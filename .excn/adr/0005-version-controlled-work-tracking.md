---
status: accepted
date: 2026-06-10
---
# 0005 — The work-tracking set is version-controlled; only `*_progress.json` is gitignored

The stamped `.excn/.gitignore` previously ignored the whole work-tracking set (`sprints/`, `issues/`, `prds/`, `retros/`, `*_progress.json`). That made the backlog and sprint history invisible in-repo — un-reviewable in PRs, un-shareable, and impossible to read "where the work is heading" from the repo itself (EXEC-042). We now track everything except `*_progress.json`: closed sprint JSONs, the backlog, PRDs, and retros are records, and the JSON-for-progress Principle requires schema-validated JSON, not git invisibility. Only per-session progress state (gate verdicts, step logs) is churny enough to stay out of git.

## Considered Options

- **Status quo (all ignored)** — keeps churn out of git but the backlog stops being the record: anything that must be seen or reviewed needs a second home outside the framework's tracker.
- **Track `issues/` only** — fixes the visibility symptom but leaves sprint records and PRDs invisible, so "where the work is heading" still can't be read from the repo.
- **Track everything including `*_progress.json`** — per-session churn lands in every commit and pollutes diffs for no record value.

## Consequences

- `src/template/.excn/gitignore` shrinks to `*_progress.json`; the root Instance mirrors it exactly (Src-First). The root-local `drafts/` line is dropped — `drafts/` was never a framework concept; its one stale file is deleted.
- `backlog.json` is the single issue tracker for an Instance.
- Downstream Instances stamped after this change get a visible work-tracking history by default.
- This amends ADR-0002's "work-tracking, gitignored" consequence; the ephemeral/committed split now cuts at `*_progress.json`, not at the folder set.
