# Prior Art — PRD-009: Progress Record Homes, Migrate Path, Location Guard, Viewer History

Researched 2026-06-10. Three problem areas: (1) versioned/idempotent file-layout migration commands, (2) write-path guard hooks in agent harnesses, (3) lightweight static-JSON dashboard with history browsing.

---

## Existing Approaches

### Area 1: CLI Tools That Migrate User-State File Layouts Between Versions

**Omarchy (basecamp) — timestamp-keyed, filename-tracked migration scripts**
Omarchy's update system applies incremental configuration changes via executable shell scripts stored in a `migrations/` directory, named with Unix timestamps (e.g. `1772988614.sh`) to guarantee chronological order without a version-number convention. Idempotency is enforced by a state directory at `~/.local/state/omarchy/migrations`: once a script's filename appears there, it is never run again, regardless of whether it previously succeeded. On failure the harness prompts the user to skip or abort rather than silently poisoning state.
Source: https://deepwiki.com/basecamp/omarchy/10-configuration-management-and-migrations

**`conf` npm package — semver-keyed migration handlers in a user-config store**
The `conf` package (a standard Node.js user-config library) supports a `migrations` object whose keys are semver versions (or semver range strings) and values are handler functions. A `version` field is required when migrations are specified. The package tracks the last-applied version and runs only pending handlers on upgrade. Handlers receive the store so they can rewrite or relocate values. A failed handler does not mark that version applied, so it will retry on the next startup — this can loop if the handler is not idempotent.
Source: https://www.npmjs.com/package/conf (search result, direct fetch returned 403)

**Flyway / database migration tools — schema-history table as the applied-set ledger**
All major migration tools (Flyway, Liquibase, Atlas, SQLx) share the same structural pattern: a numbered set of migration scripts plus a persistent ledger (a DB table, but the concept transfers to a JSON file) that records which migrations have run. `flyway migrate` is idempotent — re-running is safe because it compares scripts on disk to the ledger and skips already-applied entries. Flyway halts if an applied script's checksum changes (corruption guard), which is the file-content analogue of PRD-009's "never rewrite content" constraint.
Source: https://www.red-gate.com/hub/product-learning/flyway/creating-idempotent-ddl-scripts-for-database-migrations/
Source: https://documentation.red-gate.com/fd/migrations-271585107.html

**chezmoi — `run_once_` / `run_onchange_` scripts tracked by SHA-256 hash**
Chezmoi tracks whether a `run_once_` script has run by storing a SHA-256 hash of its content in a local state bucket (`scriptState`). The script is skipped on re-runs as long as the hash matches. `run_onchange_` scripts re-run whenever content (post-template-evaluation) changes. Neither mechanism provides a built-in file-relocation command; migrations must be hand-written scripts. Resetting state (`chezmoi state delete-bucket --bucket=scriptState`) forces a re-run, which is the chezmoi equivalent of a "wipe the applied ledger" escape hatch.
Source: https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/

**ESLint `@eslint/migrate-config` — one-shot, destructive, CLI-invoked config migration**
ESLint ships a dedicated `npx @eslint/migrate-config` command to convert `.eslintrc.*` configs to the new flat-config format. It is a one-shot transform (not idempotent), does not maintain an applied-set ledger, and has known limitations with `.eslintrc.js` (logic inside the file is lost). This is the "fire and forget" end of the spectrum — useful as a comparison point because PRD-009 explicitly chooses the opposite (idempotent, re-runnable, content-preserving).
Source: https://www.npmjs.com/package/@eslint/migrate-config
Source: https://eslint.org/docs/latest/use/configure/migration-guide

---

### Area 2: Write-Path Guard Hooks / Filesystem-Location Linting in Agent Harnesses

**Claude Agent SDK — `PreToolUse` hook with `permissionDecision: "deny"` on `file_path` inspection**
The canonical pattern in the Claude Agent SDK: register a `PreToolUse` hook with a `"Write|Edit"` matcher; inside the callback inspect `tool_input.file_path`; return `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "<redirect>" } }` to block. Matchers filter only by tool name, not path — path filtering must happen inside the callback. When multiple hooks are registered, any single `deny` wins over all other decisions. The fail-safe is exit-0 with no output (the pattern already used by spawn-guard): a broken guard never blocks legitimate writes.
Source: https://code.claude.com/docs/en/agent-sdk/hooks

**OpenAI Codex — `PreToolUse` hook fires for `apply_patch`; coverage has known gaps**
Codex's hook system exposes the same `PreToolUse` + `permissionDecision: "deny"` pattern. A critical gotcha: before a 2025 PR fix (`#18391`), `apply_patch` edits did *not* emit `PreToolUse`/`PostToolUse` — hooks only fired for `Bash`. The fix landed in that PR but the docs carry an explicit warning that "this doesn't intercept all shell calls yet, only the simple ones" and that `PreToolUse` is "a guardrail rather than a complete enforcement boundary because Codex can often perform equivalent work through another supported tool path." PRD-009's guard is Claude Code shell-hook based (stdin-JSON, not SDK callback), so the Codex `apply_patch` gap does not apply directly, but the warning about tool-path substitution is structurally relevant.
Source: https://developers.openai.com/codex/hooks
Source: https://github.com/openai/codex/issues/16732
Source: https://agenticcontrolplane.com/blog/codex-cli-hooks-reference

**Agent Rules Builder guide — protecting files via PreToolUse path checks**
A practitioner guide enumerates the pattern: register with `"Write|Edit|Delete"` matcher, inspect `tool_input.file_path` inside the callback, deny with a redirect reason. Notes that the reason string is shown to the model as context so it can self-correct rather than retry blindly. This mirrors PRD-009's "redirect reason naming the right home."
Source: https://www.agentrulegen.com/guides/how-to-protect-files-from-ai-agents

---

### Area 3: Lightweight Static-JSON Dashboard with History Browsing / Switcher

**Vanilla JS SPA with History API — `pushState` / `popstate` for tab/switcher state**
The canonical no-framework pattern: on tab/switcher click, call `history.pushState({ sprintId }, "", `?sprint=${id}`)`, fetch the corresponding JSON, and re-render. On `popstate`, read `event.state` and re-render from it. MDN documents the full round-trip. The viewer already uses `DOMContentLoaded` + `fetch()` per-sprint; adding the History API wires browser back/forward to the sprint switcher with zero dependencies.
Source: https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API
Source: https://medium.com/@george.norberg/history-api-getting-started-36bfc82ddefc

**Static JSON dashboard pattern — fetch-on-load, DOM render, no backend**
Several practitioner write-ups confirm the viability of the approach PRD-009's viewer already uses: a single HTML/CSS/JS file fetches JSON on `DOMContentLoaded`, renders via DOM manipulation, handles 404s as "absent" vs other errors as "broken." The dashboard-js library and static-dashboard reference implementations follow exactly this shape but add charting; the viewer needs neither.
Source: https://medium.com/@michaelpreston515/how-i-built-a-real-time-dashboard-from-scratch-using-vanilla-javascript-no-frameworks-f93f3dce98a9
Source: https://github.com/ricardoalcocer/static-dashboard

**`flask_jsondash` / `dashboard-js` — JSON-config-driven dashboards**
Both projects drive full dashboards from a JSON config with no frontend code, but they add backend or library dependencies the viewer deliberately avoids. Useful as contrast: PRD-009's viewer stays below their complexity floor by keeping the data shape in existing sprint JSON and avoiding any charting library.
Source: https://github.com/christabor/flask_jsondash
Source: https://github.com/datopian/dashboard-js

---

## Gotchas

**Migration: run_once_ hash tracking silently re-runs if content changes**
chezmoi's `run_once_` is keyed on content hash, not filename. If a migration script is edited (even a comment change), the hash changes and the script re-runs. PRD-009's design avoids this by keying the applied-set on the migration's *identity* (a version tuple), not content — matching Omarchy's filename-key and Flyway's version-number approach.
Source: https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/

**Migration: no ledger means no idempotency without external state**
A one-shot migration command (ESLint's `@eslint/migrate-config`) has no ledger and is not idempotent — re-running it on an already-migrated layout corrupts or double-migrates. PRD-009 makes idempotency explicit ("re-run is a no-op") which requires the migrate command to check whether each target file already lives at its destination before moving it.
Source: https://eslint.org/docs/latest/use/configure/migration-guide

**Migration: version field is required when using `conf` migrations**
The `conf` package will throw if a `migrations` object is supplied without a `version` field. The analogous PRD-009 risk: if the version marker is absent the migrate command has no reference point. The PRD resolves this by having `doctor` detect the legacy flat layout and name the command — a detect-then-redirect pattern rather than an embedded version gate.
Source: https://www.npmjs.com/package/conf (search result)

**Guard: matchers filter by tool name only, not by path**
Both Claude SDK and Codex hooks share the same constraint: the matcher regex/pipe-list applies to the tool name, not to `file_path`. Path inspection must happen inside the callback body. A guard that relies only on the matcher and skips path inspection will fire for every Write/Edit, not just misfiled progress writes. PRD-009's guard is location-only, so it must read the path from `tool_input.file_path` (or the equivalent field for the Edit tool, which uses `file_path` as well).
Source: https://code.claude.com/docs/en/agent-sdk/hooks

**Guard: `apply_patch` / multi-tool coverage gaps in Codex (less relevant, but noted)**
Codex's hook system did not cover `apply_patch` until a 2025 fix, and the docs still warn that PreToolUse is a guardrail, not a complete enforcement boundary. Claude Code's shell-command hook fires from the harness before the tool runs, so coverage is at the harness layer rather than the SDK layer; this gap does not apply to PRD-009's implementation. Filed here because the pattern (a guard that looks complete but has a coverage hole via an alternate tool) is a real failure mode to test against.
Source: https://github.com/openai/codex/issues/16732

**Viewer: History API `popstate` does not fire on initial page load**
`popstate` only fires on back/forward navigation, not on the initial load. The sprint-switcher must therefore read the initial sprint ID from `location.search` (or a default) inside `DOMContentLoaded`, then attach `popstate` for back/forward. Omitting the initial-load read means the switcher works for navigation but not for direct URL access or refresh.
Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event

**Viewer: `cache: 'no-store'` is already used but must extend to all new fetches**
The existing viewer uses `{ cache: 'no-store' }` on every `fetch()` call to prevent stale JSON. Any new fetches for closed-sprint JSON, runtime records, or invocation logs must carry the same option; omitting it on even one call means a user sees a cached (stale) hook-health view after a hook fires.
Source: (code observation from `.excn/viewer/viewer.js` lines 86 and 112)

---

## Nothing Found

- No prior art found for a **location-only, content-preserving** file-relocation migration command as a standalone CLI feature (distinct from database schema migration tools). All file-layout migration prior art either operates on symlinks (stow), requires hand-written scripts with no framework support (chezmoi), or is one-shot and non-idempotent (ESLint migrate-config). The versioned-ledger + location-check-before-move pattern PRD-009 describes is an original composition of database migration idioms applied to a file-layout problem.
- No prior art found for a **hook-health panel** embedded in a static-JSON status viewer (as opposed to separate monitoring dashboards backed by a server). The doctor-parity card + invocation-log table combination appears to be novel in this context.
- No prior art found for the **two-home (progress/ vs runtime/) writer-class split** as a named architectural pattern. The closest analogue is the database migration tools' split between migration scripts (authored) and the schema history table (machine-written), but no prior art names this split by writer class for file-system records.
