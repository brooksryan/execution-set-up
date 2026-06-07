# Principles

The universal rules of this framework. They hold in **every** project, are not re-litigated per project, and are baked into the agents and the Setup Skill rather than shipped as a per-project document. The `alignment` Adherence Agent checks proposed changes against these (plus the project's `PHILOSOPHY.md`).

Distinct from **Philosophy**: Principles are universal and fixed here; Philosophy is project-specific and grilled into each project's `PHILOSOPHY.md`.

## The principles

- **Minimalism.** Prefer less — less documentation, less scaffolding, less prescription. Add only what is needed to reproduce the work or make a decision. If removing a sentence causes no confusion, remove it.

- **Structured reference docs.** Every reference document has one declared, consistent shape. `CONTEXT.md` is a pure glossary and nothing else — no specs, no scratch, no implementation decisions.

- **JSON for progress.** Work and sprint and issue *state* lives in schema-validated JSON, never freeform Markdown. Markdown carries prose and reference; JSON carries state and adherence. Structure is what makes adherence checkable.

- **Persistent Teammates, consistent prompts.** Lean on named, persistent members with stable definitions. A Teammate definition states what it **owns** and what it **must not do** — ownership, not cognition. It does not coach reasoning, priorities, or how to feel about trade-offs. If a definition reads like a coaching session, it is too long.

- **Adherence Agents.** Use Invoked Agents liberally as adversarial and adherence gates. An Adherence Agent reads a rubric, reviews one input, returns `PASS`/`FAIL` with violations cited by rule, logs the verdict, and **never fixes the input or re-judges whether a rule applies**.

- **Single responsibility.** One job per agent, per function, per artifact. When an artifact starts doing two things, that is the first sign of drift — name the violation and fix it.

- **Non-prescriptive teardowns.** Session and sprint close documents describe what *is*, not what comes next. "Next steps", "plan to", "consider", and "should" have no place in a teardown artifact. Future sessions choose their own trajectory.

- **The Retro Loop is the sole path to a definition change.** Teammate and persistent-doc definitions are never edited ad hoc mid-sprint. Observations go into retrospective notes; scribe proposes changes at close; the `alignment` agent gates them; the Team Lead approves. That is the only path.

- **Grill-first.** A new domain or major feature starts with a grill (`grill-with-docs`) before any code or content — grill → PRD → issues. Bug fixes and small additions skip it.

## Not in this framework

- **No ADRs.** The retro is the decision record. Hard-to-reverse decisions land in retrospective notes and, when they change terminology, in `CONTEXT.md`.
