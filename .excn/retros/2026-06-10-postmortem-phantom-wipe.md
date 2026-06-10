# Post-mortem — the phantom work-tracking wipe (2026-06-10, sprint 4)

## What happened

Mid-sprint, the Team Lead concluded the entire `.excn` work-tracking set (`sprints/`, `issues/`, `prds/`, `retros/`) had been deleted by a runaway agent cleanup, stopped two running QA gates (one mid-verdict), launched a transcript-mining recovery agent, and began rebuilding files from conversation context. Nothing had been deleted. Every file was intact in the main tree the whole time.

## Root cause

A false reading, not a deletion. The Team Lead's shell had been left `cd`'d away from the repo root by an earlier forensic command, and subsequent **relative-path** checks (`ls .excn/...`, `git status`) resolved against builder-B's **git worktree** — a checkout that legitimately contains only committed files: no work-tracking JSON (gitignored until ADR-0005 lands), no uncommitted hook files, a stale 5-line `.gitignore`, and uniform fresh timestamps from worktree creation. That view pattern-matched "everything untracked was wiped" perfectly. The two signals that should have broken the illusion — ADRs 0005/0006 "surviving" (read via absolute paths, i.e. from the real repo) and a gate reporting the files as present — were explained away instead of investigated.

## Contributing factors

1. **Transient agents instead of persistent Teammates.** builder, the gates, and recovery were spawned as anonymous background Invoked Agents rather than the rostered persistent Teammates the framework defines. That cost us: no stable owner to ask "did you delete anything?", no continuity of working directory or context, parallel agents whose side effects (a worktree appearing under `.claude/`) the Team Lead didn't model, and a Team Lead doing builder/scribe work inline instead of routing it. The Lifecycle's roster exists precisely so actions are attributable and stateful.
2. **Relative paths in forensics.** Every check during the "incident" that used an absolute path returned the truth; every check that used a relative path returned the worktree. Mixed evidence was resolved toward the catastrophic reading.
3. **Acting before verifying the destructive premise.** Agents were killed and a recovery writer launched against live files based on the unverified premise. The recovery agent itself noticed "targets mostly exist with old mtimes" — the observation that should have preceded its launch.
4. **The tracker was still uncommitted.** ADR-0005 (track everything but `*_progress.json`) had been decided and implemented but not yet committed, so "unrecoverable loss" was even plausible. A committed tracker makes this entire failure class a `git status` check.

## What went right

- The killed gates and stopped recovery agent caused no damage; the recovery agent was instructed not to touch live sprint-4 files and was stopped before writing.
- All gate verdicts (4× PASS) had already landed in the sprint record's step log.
- The drift-anchor bug in EXEC-049, found by a gate's out-of-scope observation, was fixed and re-verified during the same window — the gate protocol worked.

## Actions

1. Spawn rostered Teammates (builder, viewer, scribe, packager, architect) as **persistent Teammates**, not background Invoked Agents, for sprint work. Invoked Agents remain correct for gates and one-shot checks. (Retro Loop candidate: make this explicit in TEAM_DIRECTIVE routing.)
2. Forensics and any destructive-premise verification use **absolute paths only**; before acting on "data is gone," confirm from a fresh shell at the repo root. (Retro Loop candidate for PROCESS "Trust the deployed state" section.)
3. Commit the work-tracking set immediately (ADR-0005 implementation is on this sprint's critical path — this incident is its strongest argument).
4. Worktree-isolated agents must be merged or cleaned promptly; a lingering worktree is an attractive wrong-cwd target.
