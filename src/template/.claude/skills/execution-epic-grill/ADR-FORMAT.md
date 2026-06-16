# ADR Format

ADRs live in `.excn/adr/`, identified by a UUIDv7: mint one with `npx to-execution uuid`, put it in the `id:` frontmatter, and name the file `<uuid>-slug.md`. Never self-increment a sequential number — legacy `0001-slug.md` ADRs are grandfathered; new ADRs are always UUIDv7. Never create `docs/adr/` or any other ADR home.

## Template

```md
---
id: {uuidv7}
status: accepted
date: {YYYY-MM-DD}
---
# {Short title of the decision}

{1–3 sentences: the context, what was decided, and why.}
```

An ADR can be a single paragraph. The value is recording *that* a decision was made and *why* — not filling sections.

## Optional sections

Include only when they add genuine value; most ADRs won't need them.

- **`## Considered Options`** — when the rejected alternatives are worth remembering.
- **`## Consequences`** — when non-obvious downstream effects need calling out.
- **`## Amendment — {date}`** — when a later decision revises this one without rewriting history.

Status frontmatter values: `accepted | proposed | deprecated | superseded by <id>` (the superseding ADR's id or 8-char short prefix).

## When to offer an ADR

All three must hold:

1. **Hard to reverse** — changing your mind later costs meaningfully.
2. **Surprising without context** — a future reader looks at the result and wonders "why on earth this way?"
3. **The result of a real trade-off** — genuine alternatives existed and you picked one for specific reasons.

If it's easy to reverse, skip it. If it's not surprising, nobody will wonder. If there was no real alternative, there's nothing to record.

### What qualifies

- **Architectural shape.** "Work-tracking is partitioned by lifecycle location." "The write model is event-sourced."
- **Integration patterns.** "These two parts communicate via events, not synchronous calls."
- **Choices that carry lock-in.** Namespace, schema shape, distribution channel — the ones that take a quarter to swap.
- **Boundary and scope decisions.** The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path** — so the next person doesn't "fix" something that was intentional.
- **Constraints not visible in the code.** Compliance limits, contractual response times, ecosystem behaviors (e.g. a packaging tool's file handling).
- **Rejected alternatives whose rejection is non-obvious** — otherwise someone re-proposes them in six months.
