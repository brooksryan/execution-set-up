# Authoring one-off Adherence Agents

The Team Lead owns this. The framework stamps two universal Adherence Agents — `process-adherence` (rubric `PROCESS.md`) and `alignment` (rubric Principles + `PHILOSOPHY.md`). Everything else with a **project-specific rubric** — directive enforcement, code style, source fidelity, security — is a one-off you author from the shape below.

**Rule of thumb: invariant rubric → stamped agent; variant rubric → one-off agent.**

## The invariant shape

Every Adherence Agent, stamped or one-off, obeys the same *output contract*:

1. Read its rubric document in full.
2. Review exactly one input against every rule.
3. Return `PASS` or `FAIL` with each violation cited by rule name.
4. Append the verdict to the active progress JSON (`.excn/tmp/.../*_progress.json` or the sprint JSON).
5. **Never** fix the input. **Never** re-judge whether a rule should apply — every rule applies until the lead changes the rubric.

The *input* contract is per-agent — that is the part you decide when authoring.

## What to decide per agent

- **Rubric** — the one document it reads (a fixed path). One rubric per agent; single responsibility.
- **Input** — what it reviews: an artifact's content, a workflow transition, or a proposed change. Name the exact fields the caller passes (e.g. `output_file`, `sources`, `progress_file`, `task_name`, `agent_name`).
- **When it fires** — after authoring an artifact, at a step transition, or only in the Retro Loop.

## Template

```markdown
---
name: <kebab-name>-adherence
description: "Called by <who> after <when>. Verifies <output> conforms to <rubric path>. The caller passes: <input fields>. Reads <rubric path>. Returns PASS or FAIL with violations cited by rule. <Order note if part of a gate sequence>."
---

You verify that <input> conforms to `<rubric path>`.

## What you receive
- `<field>` — <meaning>
- `progress_file` — the active progress JSON to log into
- `task_name`, `agent_name`

## What you do
1. Read `<rubric path>` in full. Read the input in full. Do not skim.
2. Evaluate the input against every rule. Key checks: <enumerate the rubric's rule classes>.
3. Append a `step_log` entry to `progress_file`: `{ "step": "<name>_pass|<name>_fail", "at": "<YYYY-MM-DD>", "artifact": "<input>", "summary": "<verdict + violation count>" }`.
4. Return: `<NAME>: PASS|FAIL` / `Violations: <count>` / `<list if FAIL, else conforms>`.

## Verdict criteria
- PASS — no violations of any rule.
- FAIL — any single violation. The caller revises and resubmits.

## What you do NOT do
- Do not fix or suggest corrections.
- Do not check anything outside this rubric (that is another agent's job).
- Do not decide a rule shouldn't apply.
```

## Sequencing gates

When two gates apply to the same artifact, order them and make the order explicit in each `description` (e.g. fidelity before directive). A `FAIL` at any gate sends the author back to revise, then back through the gates — never forward.
