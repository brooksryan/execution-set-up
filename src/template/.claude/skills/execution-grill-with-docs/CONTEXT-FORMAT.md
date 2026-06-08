# CONTEXT.md Format

One `.excn/CONTEXT.md` per Instance — a single context. It holds a glossary and the team roster, nothing else.

## Structure

```md
# {Project} Domain Context

{One or two sentences: what this context is and why it exists.}

## Glossary

### Order
{One-sentence definition — what it IS, not what it does.}
_Avoid_: Purchase, transaction

### Invoice
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

## Relationships

- An **Order** produces one or more **Invoices**
- An **Invoice** belongs to exactly one **Customer**

## Example dialogue

> **Dev:** "When a **Customer** places an **Order**, do we create the **Invoice** immediately?"
> **Expert:** "No — an **Invoice** is generated only once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "account" meant both **Customer** and **User** — resolved: distinct concepts.

## Team roster

| Teammate | Role | Owns |
|---|---|---|
| scribe | structured artifacts | sprint/issue JSON, CONTEXT.md term additions, the Retro Loop |
```

## Rules

- **Be opinionated.** When several words mean one concept, pick the best and list the rest as `_Avoid_` aliases.
- **Flag conflicts explicitly.** An ambiguous term goes under "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One sentence. Define what it IS.
- **Show relationships.** Bold term names; express cardinality where obvious.
- **Only project-specific terms.** General programming concepts (timeouts, retries, utility patterns) don't belong even if used heavily. Ask: unique to this domain, or general? Only the former.
- **Group under `### Term` subheadings**, clustered under `##` sections when natural clusters emerge.
- **Write an example dialogue** — a dev/expert exchange showing how the terms interact and where their boundaries lie.
- **The roster lives here too** — persistent Teammates and what each owns. Interaction rules (routing, gates, Don'ts) live in `.excn/TEAM_DIRECTIVE.md`, not here.

## One context only

This framework is single-context: one `.excn/CONTEXT.md`. Do not create a root `CONTEXT.md`, a `CONTEXT-MAP.md`, or per-directory glossaries. When natural clusters emerge, they become `##` subheadings inside the one glossary.
