# Code Standards

The rubric the `code-standards` Adherence Agent enforces on every `builder` and `viewer` code change. Project-specific; raised either as a chartered slice (PRD → issue → sprint, ADR-0004) or through the Retro Loop for an emergent change — always alignment-gated and Team-Lead-approved before it lands. Each rule is a pass/fail check on the change under review.

## Structure

- **Single responsibility.** One job per function; if describing it needs an "and", split it.
- **Deep modules.** A simple, stable interface hides the complexity. A shallow pass-through wrapper that adds no encapsulation is a violation.
- **Named constants.** Every literal that carries meaning is a named constant; no magic numbers or strings in logic.
- **Fail-closed errors.** No silent catch, no swallowed error. An error names what failed and either aborts or surfaces it.
- **No dead code.** No commented-out code, no unreachable branches, no unused exports.
- **Deterministic layout.** Each file reads top-to-bottom: header → imports → constants → helpers → public surface.

## CLI

- **Data out of logic.** A literal data block — a multi-line or multi-entry constant the file does not compute (config, fixed content, lookup tables) — lives in a data/config module, not interleaved with the logic that consumes it.
- **No new runtime dependency.** A change adds no non-builtin `require`/`import` and no `package.json` `dependencies` entry unless the change body justifies it; Node builtins are the default.
- **Exit codes.** Every failure path exits non-zero; success exits zero.
- **Stream discipline.** Diagnostics and errors write to stderr; normal program output writes to stdout.
- **Actionable failures.** A failure message names what was expected or what fixes it — never a bare "error". An unrecognized command or missing required argument fails non-zero with such a message, never a silent no-op.

## Commenting

- **File header.** Every file opens with a comment stating what it is, its contract, and any non-obvious constraint it operates under.
- **Exported-function docs.** Every exported function carries a doc comment: purpose, parameters, return, and failure modes.
- **Why, not what.** Every non-obvious decision carries a comment explaining intent and invariants — never a restatement of the code.
- **Truthful comments.** A comment that contradicts the code is a violation — fix the comment or the code.
- **Match the idiom.** Comment density and style match the surrounding file.
- **No TODO/FIXME** in shipped code — open an issue instead.

## Hooks

- **Invocation logging.** Every script wired under `hooks` in `.claude/settings.json` appends exactly one invocation record to `.excn/runtime/hook-invocations_progress.json` before it exits, on every code path — normal, disabled, no-op, and error alike. The record has exactly the fields `ts` (ISO-8601 string), `script` (file basename), `event` (the hook event name), and `outcome` (one of `ok`, `disabled`, `noop`, `error`).
- **Log via the shared helper.** The append goes through the single logging helper exported by `hook-lib.js` — no hook writes the log file directly.
- **Logging never breaks fail-safe.** The helper catches its own failures internally; no error from the append may propagate past the hook's fail-safe guard (ADR-0006: hooks exit 0 silent on failure).

## Verdict

PASS only when every rule holds on the change under review. Any single violation is a FAIL — the author revises and resubmits; never forward past a FAIL.
