# Node CLI Best Practices for a Small, Zero-Dependency, npx-Distributed CLI

**Research date:** 2026-06-09. Sources fetched live on this date. Each recommendation states its basis. Items marked **[official]** cite Node.js docs; **[canonical-list]** cite the `lirantal/nodejs-cli-apps-best-practices` reference; **[grounded]** cite the actual shape of `src/bin/cli.js` / `src/bin/preflight.js` as read on this date.

**Question:** what does "clean" mean for the Scaffolder CLI (`to-execution`) — a small, zero-runtime-dependency, no-build Node CLI distributed via `npx` — beyond the gaps the current `CODE_STANDARDS.md` already covers, and which of those are mechanically checkable on a change so they can ride the `code-standards` gate?

**Scope boundary:** this CLI is short-lived (stamp-and-exit), runs once per invocation, ingests no network input, and ships its own template as package data. Recommendations aimed at long-running daemons (SIGTERM draining, graceful shutdown, connection pools) are out of scope and deliberately omitted.

## What the code already does well (the reference shape)

`preflight.js` is the clean exemplar; the new rules below codify its discipline so `cli.js` (and EXEC-040's refactor) match it.

- **Stream discipline** — errors to `process.stderr`, results to `process.stdout`, every time (`preflight.js` lines 84/88/91; `cli.js` 104/153 stderr, 72/129 stdout). **[grounded]**
- **Fail-closed exit** — a failure writes to stderr and exits non-zero (`cli.js` 104-105, 153-155; `preflight.js` 87-90). **[grounded]**
- **Zero runtime dependencies** — both files import only Node builtins (`fs`, `path`, `child_process`); the header comment asserts "Node builtins only." **[grounded]**
- **`'use strict'`** at the top of every executable file. **[grounded]**

## The gaps (each maps to a proposed rule)

### 1. Data/config inlined in the logic file
`cli.js` 18-35 declares `POINTER_FILES`, `POINTER_SENTINEL`, `CODEX_CHAIN_CAP`, and the multi-line `POINTER_BLOCK` literal — the framework's pointer-wiring *data*, governed by ADR-0002 — as top-of-module constants interleaved with the `wirePointers` logic that consumes them. The literal block is 14 lines of content masquerading as code.

- **Basis [canonical-list]:** §3.4 "Configuration" and the broad SRP guidance both push static configuration out of the code path that acts on it. The canonical list and the LogRocket/Scout architecture guides converge on a dedicated config/data location so logic files read as logic.
- **Basis [grounded]:** the current standard's **Single responsibility** and **Deterministic layout** rules already imply this but don't name it; a logic file carrying its own 14-line data literal passes both rules as written while still mixing concerns. This is the gap.
- **Checkable on a change?** Yes — "a literal data block (a multi-line/multi-entry constant the file does not compute) lives in a data/config module, not interleaved with the logic that consumes it" is a pass/fail read of the diff. → **STANDARD.**

### 2. No-new-runtime-dependency default is asserted in a comment, not enforced
Both files say "Node builtins only" in their header, and `package.json` has zero runtime `dependencies`. Nothing stops a change from adding `require('chalk')` and a `dependencies` entry — the whole npx-distribution story (no install step, no `node_modules` bloat, instant `npx to-execution`) rests on this staying true.

- **Basis [canonical-list]:** small CLIs distributed via npx pay the dependency cost on every invocation; the canonical list's startup-time and footprint guidance favors builtins for tools this size.
- **Basis [grounded]:** the design intent is already documented in the header comments and `ADR`-adjacent reasoning; a rule turns a comment into a gate.
- **Checkable on a change?** Yes — "a change adds no runtime dependency (no new non-builtin `require`/`import`, no new `dependencies` entry) unless the change body justifies it" is a mechanical diff check. → **STANDARD** (as a justified-default, not an absolute ban).

### 3. Exit-code / stream discipline is practiced but not codified
The code is correct today, but no rule forces the next change to keep errors on stderr, success on stdout, and a non-zero exit on failure. A regression (an error written to stdout, or a failure path that returns 0) would pass every current rule.

- **Basis [official]:** Node `process` docs — exit code `0` is success, non-zero is failure; errors are written to `process.stderr` (the uncaughtException example writes to `process.stderr.fd`).
- **Basis [canonical-list]:** §6.4 "Proper Use of Exit Codes" — *"Terminate your program with proper exit codes that convey a semantic meaning of the error or exit status."* §6.2 — *"A failing error message should tell the user what is required as a fix, rather than complaining that there is an error."*
- **Checkable on a change?** Yes — three pass/fail reads: failure path exits non-zero; diagnostics go to stderr, normal output to stdout; an error message names the fix/expectation (the code already does this — `preflight.js` returns `'user.email is "x", expected "y"'`). → **STANDARD.**

### 4. CLI-argument handling has no required-shape rule
`main()` (`cli.js` 143-157) dispatches on the first arg and falls through to a non-zero exit on an unknown command — correct. But nothing requires the *next* command added to validate its args or to exit non-zero on a bad invocation; a new subcommand could silently no-op on garbage input.

- **Basis [canonical-list]:** §1.1 "Respect POSIX args" and §6.2/§6.4 — an unrecognized or malformed invocation should fail loudly with a non-zero exit and an actionable message, never silently succeed.
- **Checkable on a change?** Partially. "Unknown command / missing required arg → non-zero exit + stderr message" is checkable and folds into rule 3's failure-path check, so it needs no separate rule. Full POSIX short-flag grouping (`-abc`) is a design choice, not a per-change invariant — **research-only.**

### 5. `process.exit()` vs `process.exitCode` — a known nuance, deliberately NOT a rule
Node docs recommend setting `process.exitCode` over calling `process.exit()` because `process.exit()` *"forces the process to exit before additional writes to stdout can be performed."* `cli.js` calls `process.exit(1)` directly.

- **Basis [official]:** Node `process` docs — *"In most situations, it is not actually necessary to call `process.exit()` explicitly… The `process.exitCode` property can be set to tell the process which exit code to use when the process exits gracefully."*
- **Why research-only:** for this CLI the risk the doc warns about (truncated buffered stdout) is near-zero — it writes synchronously and exits. Mandating `process.exitCode` would be a style preference dressed as a rule, and the current `process.exit(1)` is correct here. Precise Minimalism says leave it out of the standard. Recorded here so a future maintainer knows it was considered, not missed.

## Rules considered and left in research (not mechanically checkable on a change)

- **Configuration precedence (args → env → config files)** [canonical-list §3.4] — this CLI has no config-file layer and shouldn't grow one for its scope; a precedence rule judges a design, not a diff.
- **Trackable error codes** [canonical-list §6.1] — looking up whether a code is documented is not a single-diff pass/fail; the actionable-message rule (3) captures the checkable part.
- **Structured-output flag (`--json`)** [canonical-list §3.2] — a feature decision, out of scope for a stamp-and-exit tool; not a per-change invariant.
- **POSIX short-flag grouping** [canonical-list §1.1] — design-level, see gap 4.
- **JSDoc on module-internal helpers** — the current standard already requires docs on *exported* functions; `walk`/`wirePointers`/`init` are module-internal. Whether internal helpers need full JSDoc is a density judgment the existing **Match the idiom** and **File header** rules already cover. Adding a hard "every function, exported or not, carries JSDoc" rule would over-document a 160-line file and violate Precise Minimalism. Left out on purpose.

## Net: what reaches the standard

Four checkable additions, all grounded above: (1) data/config separated from logic, (2) no-new-runtime-dependency default, (3) exit-code + stream discipline, (3a, folded in) loud-failure on bad CLI input. Everything else stays here in research.
