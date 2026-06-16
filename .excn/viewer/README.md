# .excn status viewer

A minimalist, build-free status page that renders the live sprint and the
backlog straight from the `.excn/` work-tracking JSON. Read-only — it never
writes the JSON.

## What it shows

- A **sprint switcher** over every probed `sprint_N.json`, newest first. The
  **live sprint** (highest-numbered with status `active`, else the newest) is
  selected by default; the selection round-trips through the URL (`?sprint=N`)
  and browser back/forward.
- The selected sprint's **Shipped / In progress / Not shipped** work items, plus
  — for a closed sprint — its **Decisions**, **Retrospective notes**, and
  **Gate verdicts** (`step_log`).
- The open **Backlog**, read from the `.excn/issues/` directory-as-tracker
  (ADR-0011): one `<uuid>-<slug>.json` per issue, unioned with the legacy
  collection files (`backlog.json` and any `sprint-<N>/sprint-<N>-issues.json`)
  so nothing vanishes before or during the one-time migration. Closed issues are
  archived, not shown in the lane; live issues sort by creation order (the
  UUIDv7 timestamp prefix; legacy `EXEC-NNN` ids sort first, by number).
- **Hook health**: doctor-parity per-feature cards (firing / stale / disabled,
  last heartbeat) plus a collapsible recent-invocations table filterable by
  feature and outcome, read from the Runtime Record invocation ledger
  (`.excn/runtime/hook-invocations_progress.json`). An absent or empty ledger
  shows an explicit empty state.
- **Teammate load** (`.excn/runtime/load_progress.json`), when load reporting is on.

All sourced from the JSON — no manual data entry.

## How to open it

The viewer reads the JSON with `fetch()`, which browsers block under the
`file://` scheme. Serve the **repo root** over http and open the viewer there.
Any trivial static server works:

```sh
# from the repo root
python3 -m http.server 8000
# then open:
#   http://localhost:8000/.excn/viewer/
```

Opening `.excn/viewer/index.html` directly from disk shows a banner explaining this
and the one command above — it fails closed rather than rendering a blank board.

## Files

- `index.html` — page skeleton, the sprint switcher, the four status lanes, and the sprint-detail blocks.
- `styles.css` — all presentation; system fonts, no web-font fetch.
- `viewer.js` — fetches and renders the JSON; no dependencies, no build step.

## Notes

- It expects to be served from the repo root: asset refs and JSON fetches use
  root-absolute paths (`/.excn/...`), so the page works both at the bare `/`
  (where the viewer-server daemon maps it) and at `/.excn/viewer/`.
- Sprint discovery probes `sprint_1.json`, `sprint_2.json`, … upward until a
  gap, since a browser cannot list the directory.
- Issue discovery has the same constraint: a browser cannot list `.excn/issues/`,
  so the viewer asks the server for a directory index (a JSON array of names, or
  the autoindex HTML page that `python3 -m http.server` and most static servers
  emit) and reads each per-file record. No manifest file is kept (ADR-0011). A
  server that serves no directory index — the whitelist-only viewer-server daemon
  — still renders the top-level `backlog.json`; serving the per-file records there
  needs a daemon directory-listing endpoint (a separate, server-side change).
