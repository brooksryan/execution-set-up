---
status: accepted
date: 2026-06-14
---
# 0010 — context-grill may seed PHILOSOPHY.md once via a stamped sentinel; the Retro Loop owns it thereafter

The Retro-loop-as-sole-change-path Principle says PHILOSOPHY.md grows only through the Retro Loop. But a fresh Instance's PHILOSOPHY.md is a near-empty stub — the Setup Grill seeds a few philosophies at install, and a later context-grill session may need to establish the first batch of project principles before any sprint has run (and therefore before any retro exists to loop through). Blocking first-establishment on a retro that hasn't happened yet stalls adoption with no safety benefit: there's nothing established to protect.

We resolve this with a **stamped sentinel line** in PHILOSOPHY.md (`<!-- principles: unestablished -->`). While the sentinel is present, context-grill may **append** principles to the file — it never overwrites existing body content. The first established edit (the one that makes the file a real working document) removes the sentinel. Once the sentinel is absent, all PHILOSOPHY edits route through the Retro Loop as before.

This edges the Retro-loop-as-sole-change-path Principle without breaking it: the Principle protects *established* content from ad-hoc mid-sprint edits; the sentinel distinguishes "nothing established yet" from "established but thin." The detection is a positive signal in the file itself — not an inference from emptiness or line count — avoiding the phantom-wipe failure class (postmortem 2026-06-10) where a false reading of file state drove a destructive action.

## Considered Options

- **Emptiness heuristic** — seed when the file is empty or has no entries under `## Project philosophies`. Rejected: indistinguishable from a project that deliberately keeps philosophy thin; a false positive overwrites established content. This is the phantom-wipe failure class.
- **Out-of-file marker** — track established-state in `framework-version.json` or a separate marker file. Rejected: splits the signal from the artifact it guards; a stale marker (e.g. after a manual edit to PHILOSOPHY.md) creates the same false-reading risk.
- **No seed path — require the retro** — block all PHILOSOPHY writes until the first retro closes. Rejected: forces an empty retro sprint just to bootstrap principles, adding ceremony with no safety benefit when there's nothing established to protect.

## Consequences

- The Scaffolder's stamped `PHILOSOPHY.md` gains the sentinel line. Existing Instances on `update` receive it only if their PHILOSOPHY.md is invariant (un-grilled); a grilled Instance's file is variant and untouched by `update` — correct, because a grilled file already has established content.
- context-grill's write-guardrail names the sentinel check: "you may append to PHILOSOPHY.md only while the sentinel `<!-- principles: unestablished -->` is present in the file; if absent, route principles to the Retro Loop."
- The sentinel is an HTML comment, invisible in rendered markdown, self-documenting in source view.
- If a user manually removes the sentinel before any real philosophies are written, context-grill correctly treats the file as established and routes to the retro — safe failure mode.
