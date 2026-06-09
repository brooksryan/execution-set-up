# Code Standards

The rubric the `code-standards` Adherence Agent enforces on every `builder` and `viewer` code change. Project-specific; raised only through the Retro Loop. Each rule is a pass/fail check on the change under review.

## Structure

- **Single responsibility.** One job per function; if describing it needs an "and", split it.
- **Deep modules.** A simple, stable interface hides the complexity. A shallow pass-through wrapper that adds no encapsulation is a violation.
- **Named constants.** Every literal that carries meaning is a named constant; no magic numbers or strings in logic.
- **Fail-closed errors.** No silent catch, no swallowed error. An error names what failed and either aborts or surfaces it.
- **No dead code.** No commented-out code, no unreachable branches, no unused exports.
- **Deterministic layout.** Each file reads top-to-bottom: header → imports → constants → helpers → public surface.

## Commenting

- **File header.** Every file opens with a comment stating what it is, its contract, and any non-obvious constraint it operates under.
- **Exported-function docs.** Every exported function carries a doc comment: purpose, parameters, return, and failure modes.
- **Why, not what.** Every non-obvious decision carries a comment explaining intent and invariants — never a restatement of the code.
- **Truthful comments.** A comment that contradicts the code is a violation — fix the comment or the code.
- **Match the idiom.** Comment density and style match the surrounding file.
- **No TODO/FIXME** in shipped code — open an issue instead.

## Verdict

PASS only when every rule holds on the change under review. Any single violation is a FAIL — the author revises and resubmits; never forward past a FAIL.
