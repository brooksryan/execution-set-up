# .excn status viewer

A minimalist, build-free status page that renders the live sprint and the
backlog straight from the `.excn/` work-tracking JSON. Read-only — it never
writes the JSON.

## What it shows

- The **live sprint** (the highest-numbered `sprint_N.json` with status
  `active`): its **Shipped / In progress / Not shipped** work items.
- The open **Backlog** (`.excn/issues/backlog.json`).

All sourced from the JSON — no manual data entry.

## How to open it

The viewer reads the JSON with `fetch()`, which browsers block under the
`file://` scheme. Serve the **repo root** over http and open the viewer there.
Any trivial static server works:

```sh
# from the repo root: /Users/brooks/dev-work/execution-set-up
python3 -m http.server 8000
# then open:
#   http://localhost:8000/viewer/
```

Opening `viewer/index.html` directly from disk shows a banner explaining this
and the one command above — it fails closed rather than rendering a blank board.

## Files

- `index.html` — page skeleton and the four status lanes.
- `styles.css` — all presentation; system fonts, no web-font fetch.
- `viewer.js` — fetches and renders the JSON; no dependencies, no build step.

## Notes

- It expects to be served from the repo root, so `.excn/` resolves at `../.excn`
  relative to `viewer/`.
- Sprint discovery probes `sprint_1.json`, `sprint_2.json`, … upward until a
  gap, since a browser cannot list the directory.
