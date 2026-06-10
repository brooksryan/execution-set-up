'use strict';

// viewer-server-rules — shared data for the viewer_server hook feature (PRD-008,
// ADR-0007 step 1): the port convention, the serving whitelist, the idle-exit
// threshold, and the discovery-record contract. Data only, no logic; viewer-server.js
// (the SessionStart hook) and viewer-server-daemon.js (the server) both consume it so
// the two sides can never disagree on the contract.

// Ports derive from a hash of the repo path into this quiet range; on collision with
// a foreign listener the hook probes upward, at most PORT_PROBE_LIMIT ports.
const PORT_RANGE_START = 41000;
const PORT_RANGE_SIZE = 1000;
const PORT_PROBE_LIMIT = 20;

// djb2 string-hash parameters (homePort in viewer-server.js): the canonical seed
// and multiplier of the algorithm, named here so the port derivation is auditable.
const DJB2_SEED = 5381;
const DJB2_MULTIPLIER = 33;

// Loopback only — repos can hold credentials; the server is never reachable off-box.
const BIND_HOST = '127.0.0.1';

// The one success status both sides speak: the daemon answers it, and the hook (and
// doctor) accept only it from the health endpoint.
const HTTP_OK = 200;

// Health endpoint: identifies a listener as ours (it echoes the repo path) and keeps
// the page's polling distinguishable from asset traffic. Reserved — never a file path.
const HEALTH_PATH = '/__viewer-server';

// The discovery record ({port, pid, repo, started}) — the contract doctor and the
// PRD-008 step-2 global server read. *_progress.json ignore class (ADR-0005).
const RECORD_RELATIVE_PATH = '.excn/viewer-server_progress.json';
const RECORD_SCHEMA_VERSION = '1.0';

// Idle self-exit (ADR-0007: never a shutdown hook). The open page's polling counts
// as activity; a server nobody requests anything from for this long exits itself.
const IDLE_EXIT_MS = 30 * 60 * 1000;

// How often the daemon compares now against the last request time.
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

// Hook-side probe budget: how long one health probe may take, and how long/often the
// hook polls a freshly spawned daemon before giving up (fail safe, no URL emitted).
const PROBE_TIMEOUT_MS = 300;
const SPAWN_POLL_ATTEMPTS = 10;
const SPAWN_POLL_INTERVAL_MS = 100;

// Serving whitelist (ADR-0007): viewer assets plus the .excn JSON the page reads —
// top-level .excn/*.json and .excn/schemas/*.json. Patterns match the root-relative
// POSIX path of the *resolved* request; anything unmatched is a 404.
const PATH_WHITELIST = [
  /^viewer\/[^/]+$/,
  /^\.excn\/[^/]+\.json$/,
  /^\.excn\/schemas\/[^/]+\.json$/,
];

// The page the bare URL lands on.
const INDEX_RELATIVE_PATH = 'viewer/index.html';

// Content types for the whitelisted asset extensions; anything else serves as octets.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};
const DEFAULT_MIME_TYPE = 'application/octet-stream';

// Content type for the daemon's plain-text error bodies (404/405).
const ERROR_CONTENT_TYPE = 'text/plain; charset=utf-8';

// SessionStart additionalContext announcing the live page; CONTEXT_URL_PLACEHOLDER
// is the token the hook substitutes the server URL into.
const CONTEXT_URL_PLACEHOLDER = '{url}';
const CONTEXT_TEMPLATE =
  `[execution viewer] The live status page for this repo is serving at ${CONTEXT_URL_PLACEHOLDER} ` +
  '(localhost-only, read-only). Share it when the team asks where the sprint stands.';

module.exports = {
  PORT_RANGE_START,
  PORT_RANGE_SIZE,
  PORT_PROBE_LIMIT,
  DJB2_SEED,
  DJB2_MULTIPLIER,
  BIND_HOST,
  HTTP_OK,
  HEALTH_PATH,
  RECORD_RELATIVE_PATH,
  RECORD_SCHEMA_VERSION,
  IDLE_EXIT_MS,
  IDLE_CHECK_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  SPAWN_POLL_ATTEMPTS,
  SPAWN_POLL_INTERVAL_MS,
  PATH_WHITELIST,
  INDEX_RELATIVE_PATH,
  MIME_TYPES,
  DEFAULT_MIME_TYPE,
  ERROR_CONTENT_TYPE,
  CONTEXT_URL_PLACEHOLDER,
  CONTEXT_TEMPLATE,
};
