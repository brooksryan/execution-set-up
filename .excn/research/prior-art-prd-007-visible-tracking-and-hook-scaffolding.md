# Prior art for PRD-007 — nothing-new-under-the-sun digest

**Run date:** 2026-06-10. First acceptance run of the nothing-new-under-the-sun Invoked Agent (EXEC-051), executed against PRD-007 with code pointers src/bin/cli.js, src/template/.claude/hooks/, src/template/.excn/hooks.config.json. Definition executed verbatim by a stand-in (type registers at next session start).

---

# nothing-new-under-the-sun — digest for PRD-007

PRD read; code skimmed (`src/bin/cli.js` stamp/update with sha256 drift marker; `src/template/.claude/hooks/` gate-watch post-tool/stop modes with `stop_hook_active` guard and fail-safe exit 0; `hooks.config.json` per-feature toggles). All three implementation paths have substantial prior art.

## Existing approaches

**Hook-based agent steering (gate-watch, message-nudge)**
- Official hooks docs confirm exactly our pattern: PostToolUse `hookSpecificOutput.additionalContext` is wrapped in a system reminder and inserted "next to the tool result"; Stop hooks use top-level `decision: "block"` + `reason`, and Stop/SubagentStop uniquely also accept `additionalContext` for non-error feedback before stopping — [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
- "Inject context that helps the agent self-correct" (linter output fed back via additionalContext) is the documented community-standard steering pattern, framed as more powerful than allow/deny — [Dotzlaw, Claude Code Hooks: deterministic control layer](https://www.dotzlaw.com/insights/claude-hooks/), [claudefa.st hooks guide](https://claudefa.st/blog/tools/hooks/hooks-guide)
- Stop-hook "refuse to let the agent stop until condition met" is a written-up pattern with the same loop guard we use: check `stop_hook_active`, allow stop on second firing — [amitkoth.com/claude-code-stop-hooks](https://amitkoth.com/claude-code-stop-hooks/), [claudefa.st stop-hook task enforcement](https://claudefa.st/blog/tools/hooks/stop-hook-task-enforcement), [dev.to async multi-agent via Stop hook](https://dev.to/agent-room/how-a-claude-code-stop-hook-unlocks-async-multi-agent-collaboration-no-polling-required-2e0e)

**Template update + drift detection (Scaffolder `update`)**
- **cruft** is the closest reference implementation: writes `.cruft.json` (template ref, git commit hash, parameters) at create time; `cruft check` for CI drift detection, `cruft diff` to see local-vs-template divergence, `cruft update` with interactive review before applying — [github.com/cruft/cruft](https://github.com/cruft/cruft), [cruft.github.io](https://cruft.github.io/cruft/)
- **copier** does versioned template updates natively (tracks template version in an answers file, replays/merges on update); comparison of the two and using `cruft check`-style gates in CI at scale — [copier comparisons](https://copier.readthedocs.io/en/stable/comparisons/), [Blenddata: cruft vs copier](https://www.blenddata.nl/en/blogs/cruft-vs-copier-automating-template-updates-at-scale)
- **create-react-app** is the anti-pattern reference: no re-stamp; updates ride the `react-scripts` package version bump plus manual changelog migration, and ejected (drifted) projects must revert the eject to upgrade — [CRA: updating to new releases](https://create-react-app.dev/docs/updating-to-new-releases/), [facebook/create-react-app#119](https://github.com/facebook/create-react-app/issues/119). Our hash-marker + report-don't-overwrite design matches cruft, not CRA.

**Config-toggled hook script packs**
- **lefthook** is the strongest analogue for per-feature toggles: one YAML config, per-hook `skip: true`, env kill-switches (`LEFTHOOK=0` global, `SKIP=eslint` per-feature), and a gitignored `lefthook-local.yml` merged over team config for local overrides — [dev.to lefthook benefits vs husky](https://dev.to/quave/lefthook-benefits-vs-husky-and-how-to-use-30je), [recca0120 lefthook guide](https://recca0120.github.io/en/2026/03/08/lefthook-git-hooks/)
- **husky** is the minimal end: shell scripts in `.husky/`, bypass only via `git commit --no-verify` / `HUSKY=0`, no per-feature granularity — [typicode.github.io/husky](https://typicode.github.io/husky/), [github.com/typicode/husky](https://github.com/typicode/husky)

## Gotchas

- **PostToolUse additionalContext was broken/ignored in some Claude Code versions.** [anthropics/claude-code#18427](https://github.com/anthropics/claude-code/issues/18427) reports every injection form (additionalContext, hookSpecificOutput, systemMessage, stdout system-reminder) invisible to the model on PostToolUse; closed as not planned. Current official docs say it works. Implication: gate-reminder behavior is version-sensitive — the PRD's heartbeat health check ("enabled hooks have fired recently") is precisely the right mitigation, and per-feature firing evidence should distinguish "hook ran" from "model saw it" where possible.
- **Stop-hook blocking can loop infinitely and burn the whole session.** [anthropics/claude-code#55754](https://github.com/anthropics/claude-code/issues/55754) documents a Stop hook consuming ~50 min until session limit; every guide says check `stop_hook_active` and allow the second stop ([amitkoth](https://amitkoth.com/claude-code-stop-hooks/), [claudefa.st](https://claudefa.st/blog/tools/hooks/stop-hook-task-enforcement)). gate-watch.js already blocks once with this guard — keep that invariant under the package-qa gate.
- **PreToolUse additionalContext doesn't exist** ([anthropics/claude-code#15345](https://github.com/anthropics/claude-code/issues/15345), open feature request) — any future "warn before the edit" variant has no injection channel; PostToolUse is the only viable hook point for reminders, as designed.
- **Re-stamp tools converge on report-and-review, never silent overwrite of drift.** cruft makes update interactive and ships `diff` because blind re-application clobbers local intent ([cruft docs](https://cruft.github.io/cruft/)); CRA's history shows pure package-version updates strand drifted projects ([CRA#119](https://github.com/facebook/create-react-app/issues/119)). Our "report drifted invariants, don't overwrite" matches the field consensus; consider a cruft-`diff`-style "show me the divergence" affordance later.
- **Hook packs need an explicit escape hatch and it gets abused.** Husky guides all note `--no-verify` bypass culture ([husky docs](https://typicode.github.io/husky/)); lefthook answers with granular per-feature skips plus a local-override file so people disable one check instead of the whole pack ([dev.to](https://dev.to/quave/lefthook-benefits-vs-husky-and-how-to-use-30je)). Our per-feature toggle config matches; the health check's "disabled unexpectedly" status is the analogue of catching blanket bypass.

## Nothing found

- No prior art on **hook-appended per-agent load telemetry** (per-Teammate load records from Claude Code tool events rendered in a dashboard) — searches on hooks/steering and the hooks guides surfaced logging/observability mentions but no reference implementation of agent-load accounting.
- No prior art on a **small-model "clerk" agent for mechanical JSON record moves** — nothing matching delegation of secretary work to a cheaper pinned model in the hook/agent ecosystem searches.
- No published treatment of the PRD's **injection-trust caveat** (model judging hook-injected guidance as legitimate ops instruction vs. prompt injection) specific to additionalContext; the gap stands as an open question rather than a sourced gotcha.
- No re-stamping prior art in the **Claude Code scaffold space itself** — template-update patterns all come from the Python (cruft/copier/cookiecutter) and JS (CRA) generator worlds; nothing found for `.claude/` layout updaters specifically.

No files were edited. No verdicts — this informs scoping; the Team Lead decides.
