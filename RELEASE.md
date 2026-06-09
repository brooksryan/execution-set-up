# Releasing to-execution

How this repo publishes the `to-execution` npm package. Repo operations — committed here, never shipped (the published package is `src/`; this file lives at the repo root, outside it).

## Auth: project-scoped, no global dotfile

Publish auth is scoped to this project so it neither depends on nor clobbers the global `~/.npmrc` (EXEC-034):

- `src/.npmrc` holds only an env-var reference — `//registry.npmjs.org/:_authToken=${TO_EXECUTION_NPM_TOKEN}`. No literal token. It is gitignored (`src/.gitignore`) and npm excludes `.npmrc` from every tarball, so the secret can never leak.
- The token is sourced from the macOS Keychain at publish time and exists only in the publish process's environment.

## Recipe

Run from `src/`:

```sh
TO_EXECUTION_NPM_TOKEN=$(security find-generic-password -a "$USER" -s "npm-personal-token" -w) npm publish
```

The token is read by reference and never written to disk or echoed. `~/.npmrc` is untouched.

## Before publishing

`prepublishOnly` runs `scripts/preflight.js`, which holds the release: it requires the brooksryan git/npm identity, a clean tree, the GitHub origin, and `HEAD` tagged `v<version>`. Bump the version, commit, and tag `v<version>` before running the recipe. preflight is the authority on the full guard set — this file does not restate it.

## 2FA caveat

`npm whoami` proves the token authenticates, but the 2FA gate only fires on a write (`publish`). If `npm-personal-token` is a classic personal token, the publish may still demand an OTP / E403. Fix: overwrite the Keychain item's value with an automation (or granular-automation) token that bypasses 2FA — `src/.npmrc` and the recipe stay unchanged. Verifying this on the next real release is tracked as a follow-up issue.
