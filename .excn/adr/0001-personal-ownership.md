---
status: accepted
date: 2026-06-07
---
# 0001 — The published artifact lives under the personal account `brooksryan`

The GitHub repo (`brooksryan/execution-set-up`) and the npm package (`to-execution`, renamed from `execution-scaffold` at approval) are owned by the personal account. Nothing about this artifact pushes or publishes under the work identity (GitHub `Brooks-Ryan`, git email `brooks@evolvco.com`). Two parts made this an ADR: npm binds a name to the publishing account at first publish — moving it later means npm support intervention or deprecate-and-republish, and a rename breaks every consumer's `npx to-execution` invocation; and git bakes author identity into history at commit time — the machine's defaults (active gh account, global git email) all pointed at the work identity, so the personal choice had to be enforced, not assumed.

## Considered Options

- **Work account (`Brooks-Ryan`).** Rejected: a personal project under work ownership entangles IP and access with employment.
- **GitHub org.** Deferred: org-vs-personal is reversible later (repo transfer preserves history and redirects); personal-vs-work is the irreversible axis. An org adds administration for a one-package project.
- **npm scope (`@brooksryan/to-execution`).** Not taken: the unscoped name was available and the shipped docs invoke `npx to-execution init`; the npm username was confirmed equal to the GitHub login, removing the ownership-signal argument.

## Consequences

- Repo-local git identity (`brooksryan <brooksryan19@gmail.com>`) set before the first commit; global work config untouched.
- gh operations for this repo run as `brooksryan`; credential path isolation is repo-local (`credential.usehttppath` + a username pin), so the host-level work keychain item can never serve this repo — wrong identity fails closed rather than silently authenticating.
- The publish path asserts identity fail-closed via the `prepublishOnly` preflight: git email, credential-fill username, `npm whoami`, origin remote, clean tree, version tag. Any miss aborts. The preflight is a packaging change and passes package-qa like any other.
- `to-execution` was first published 2026-06-07 under `brooksryan`, binding the unscoped name to the personal account.
