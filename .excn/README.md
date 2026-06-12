# to-execution CLI quick reference

`npm install to-execution` only downloads the package — it stamps nothing.
Stamping is `init`'s job. Every verb runs as `npx to-execution <verb>`:

- `init [target]` — stamp the invariant layout into target (default: cwd); `--force` overwrites existing files
- `update [target]` — re-stamp invariant files at the installed version; variant (grilled) files and work-tracking state are never touched
- `migrate [target]` — relocate legacy records and move `.js` hooks to `.cjs`
- `doctor [target]` — report per-feature hook health and outdated status
- `view-status [target]` — start the viewer server if needed and open the status page
- `validate <file> [--schema <path>]` — validate a work-tracking JSON file against its schema

`npx to-execution --help` carries the full contract for each verb.
