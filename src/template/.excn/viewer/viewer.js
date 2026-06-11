'use strict';

// .excn status viewer — client-side render of a selectable sprint + backlog.
//
// Contract: READ-ONLY. Fetches the work-tracking JSON under .excn/ and renders
// it; never writes. No build step and no dependencies — plain DOM. Must run over
// http(s): file:// blocks fetch() of sibling files, so the page fails closed
// with a serve instruction rather than rendering a half-empty board.
//
// Sprint discovery without a directory listing: the browser cannot list .excn/,
// so we probe sprint files by number from 1 upward until a gap (EXEC-036), and
// keep every one. A switcher (EXEC-071) lists them newest-first; the active
// sprint (highest-N "active") is selected by default, falling back to the newest
// when none is active. Switching re-renders from the already-probed records —
// the page is a load-time snapshot, matching the no-poll behaviour it always had.
// Selecting a closed sprint also renders its decisions, retrospective notes, and
// step_log gate verdicts. The selection round-trips through the History API so
// browser back/forward and a ?sprint=N URL both work.
//
// The sprint record itself carries the shipped/in_progress/not_shipped lanes, so
// the other fetches are the backlog and the optional per-Teammate load records
// (EXEC-045). A 404 ends sprint probing; any other fetch failure aborts loudly —
// except the optional load file, whose absence means load reporting is off.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Root-absolute path to the work-tracking tree. The viewer lives at
// .excn/viewer/ but the daemon also serves this page at the bare '/', so no
// relative path resolves correctly from both bases; the serving root is always
// the repo root (see README.md), so the absolute form holds everywhere.
const EXCN_ROOT = '/.excn';

const SPRINT_PATH = (n) => `${EXCN_ROOT}/sprints/sprint_${n}.json`;
const BACKLOG_PATH = `${EXCN_ROOT}/issues/backlog.json`;

// Per-Teammate load telemetry (EXEC-045, load-progress.schema.json). A Runtime
// Record under .excn/runtime/ (ADR-0008, EXEC-067). Optional: the load-report
// hook only creates this file when load reporting is enabled, so a 404 means the
// feature is off — render an off state, never an error.
const LOAD_PROGRESS_PATH = `${EXCN_ROOT}/runtime/load_progress.json`;

// The unified hook invocation ledger (CODE_STANDARDS ## Hooks) — a Runtime
// Record under .excn/runtime/ (ADR-0008). Every wired hook appends one
// {ts, script, event, outcome} record per firing; the viewer reads it for the
// hook-health panel (EXEC-072). Mirrors INVOCATION_LOG_PATH in health-policy.js.
// Optional: an absent file means no hook has fired yet (or the daemon predates
// the ledger) — render an empty state, never an error.
const INVOCATION_LOG_PATH = `${EXCN_ROOT}/runtime/hook-invocations_progress.json`;

// Probe ceiling — a hard stop so a misconfigured serve can never loop forever.
// Far above any realistic sprint count; raise it only if sprints exceed it.
const MAX_SPRINT_PROBE = 200;

// The "active" status marks the one live sprint (sprint.schema.json status enum).
const STATUS_ACTIVE = 'active';

// HTTP status that means "no such sprint file" — the signal that probing is done.
const HTTP_NOT_FOUND = 404;

// Severity that warrants visual emphasis on a backlog card.
const SEVERITY_HIGH = 'P1';

// Query-string key the switcher reads on load and writes on each selection, so a
// ?sprint=N URL deep-links to one sprint and back/forward navigate the history.
const SPRINT_QUERY_PARAM = 'sprint';

const ELEMENT_IDS = {
  sprintLine: 'sprint-line',
  switcher: 'switcher',
  sprintSelect: 'sprint-select',
  detail: 'sprint-detail',
  loadError: 'load-error',
  board: 'board',
};

// Hook-health panel element ids (EXEC-072).
const HOOK_IDS = {
  panel: 'hooks-panel',
  note: 'hooks-note',
  count: 'count-hooks',
  cards: 'hooks-cards',
  log: 'hooks-log',
  countInvocations: 'count-invocations',
  filterFeature: 'filter-feature',
  filterOutcome: 'filter-outcome',
  table: 'hooks-table',
};

// Sprint-detail blocks (EXEC-071), in render order. `field` is the sprint-record
// array each renders; `build` names the per-entry card builder (resolved in
// renderDetail, since the builders are declared below the constants section).
const DETAIL_BLOCKS = [
  { field: 'decisions', build: 'decision', block: 'block-decisions', body: 'detail-decisions', count: 'count-decisions' },
  { field: 'retrospective_notes', build: 'retro', block: 'block-retro', body: 'detail-retro', count: 'count-retro' },
  { field: 'step_log', build: 'stepLog', block: 'block-steplog', body: 'detail-steplog', count: 'count-steplog' },
];

// Lane id → the sprint work-item array it renders.
const SPRINT_LANES = [
  { field: 'shipped', body: 'lane-shipped', count: 'count-shipped' },
  { field: 'in_progress', body: 'lane-in-progress', count: 'count-in-progress' },
  { field: 'not_shipped', body: 'lane-not-shipped', count: 'count-not-shipped' },
];

const BACKLOG_LANE = { body: 'lane-backlog', count: 'count-backlog' };

const LOAD_PANEL = { panel: 'load-panel', note: 'load-note', body: 'load-body', count: 'count-load' };

// Recency windows for the load aggregation and last-seen phrasing (ms).
const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Hook health (EXEC-072) ----------------------------------------------------

// A feature's heartbeat newer than this reads as "firing"; older (or absent)
// reads as "stale". Mirrors HEARTBEAT_FRESH_MS in src/bin/health-policy.js so the
// viewer's cards and doctor agree on the firing/stale line — one contract, two
// packages (doctor is Node-side; the viewer cannot require() the policy module).
const HEARTBEAT_FRESH_MS = ONE_DAY_MS;

// The stamped hook features, in card order, mirroring HOOK_FEATURES in
// src/bin/health-policy.js (key + scripts; the viewer adds a human `label`). A
// feature's heartbeat is the latest invocation-ledger record across its scripts.
// Keep this list in lockstep with health-policy.js when features are added.
const HOOK_FEATURES = [
  { key: 'gate_reminders', label: 'Gate reminders', scripts: ['gate-watch.cjs'] },
  { key: 'message_nudge', label: 'Message nudge', scripts: ['message-nudge.cjs'] },
  { key: 'load_reporting', label: 'Load reporting', scripts: ['load-report.cjs'] },
  { key: 'viewer_server', label: 'Viewer server', scripts: ['viewer-server.cjs'] },
  { key: 'spawn_guard', label: 'Spawn guard', scripts: ['spawn-guard.cjs'] },
  { key: 'progress_location_guard', label: 'Progress-location guard', scripts: ['progress-location-guard.cjs'] },
];

// Doctor-parity health states the cards render (firing/stale derive from the
// heartbeat age; disabled from the latest record's outcome). Each value is also
// the CSS modifier suffix on the status pill (hook-status-<state>).
const HOOK_STATUS_FIRING = 'firing';
const HOOK_STATUS_STALE = 'stale';
const HOOK_STATUS_DISABLED = 'disabled';

// The invocation outcomes a hook records (CODE_STANDARDS ## Hooks) — the values
// the outcome filter offers. OUTCOME_DISABLED is the one that maps a feature's
// card to the disabled state (the hook fired but found its toggle off).
const HOOK_OUTCOMES = ['ok', 'noop', 'disabled', 'error'];
const OUTCOME_DISABLED = 'disabled';

// The most recent invocations the log table renders (newest first) after any
// filter; older rows are summarized as a count, never silently dropped.
const RECENT_INVOCATIONS_MAX = 100;

// The filter <select> sentinel meaning "no filter" (every feature / every outcome).
const FILTER_ALL = 'all';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

// The probed sprint records, keyed by sprint_id, populated once at load. The
// switcher and History handlers re-render from this map without refetching —
// the page is a load-time snapshot, so switching never hits the network again.
const sprintsById = new Map();

// The default sprint id (highest "active", else newest), resolved once at load.
// popstate and a bare or unknown ?sprint= URL fall back to it.
let defaultSprintId = null;

// The hook invocation-ledger records, kept once at load so the log-table filters
// re-render without refetching (EXEC-072). Empty until the panel loads them.
let invocationRecords = [];

// ---------------------------------------------------------------------------
// Fetch helpers (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Fetch and parse a required JSON file.
 * @param {string} url - path relative to this page.
 * @returns {Promise<object>} the parsed JSON.
 * @throws {Error} if the request fails, returns non-OK, or the body is not JSON.
 */
async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    // Network/CORS failure — under file:// this is where we land.
    throw new Error(`could not fetch ${url} (${cause.message})`);
  }
  if (!response.ok) {
    throw new Error(`fetch ${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${url} is not valid JSON (${cause.message})`);
  }
}

/**
 * Fetch an optional JSON file, distinguishing "absent" from "broken".
 * @param {string} url - path relative to this page.
 * @returns {Promise<object|null>} parsed JSON, or null on a 404.
 * @throws {Error} on any failure other than a clean 404 (fail-closed).
 */
async function fetchOptionalJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (cause) {
    throw new Error(`could not fetch ${url} (${cause.message})`);
  }
  if (response.status === HTTP_NOT_FOUND) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`fetch ${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${url} is not valid JSON (${cause.message})`);
  }
}

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

/**
 * Probe sprint files from 1 upward and return every one found, ascending.
 * Probing stops at the first missing number (the contiguous sequence ends).
 * @returns {Promise<Array<object>>} sprint records ordered by sprint_id ascending
 *   (empty when no sprint file exists yet).
 * @throws {Error} if a sprint file exists but cannot be fetched or parsed.
 */
async function probeSprints() {
  const sprints = [];
  for (let n = 1; n <= MAX_SPRINT_PROBE; n += 1) {
    const sprint = await fetchOptionalJson(SPRINT_PATH(n));
    if (sprint === null) {
      break; // First gap ends the contiguous sprint sequence.
    }
    sprints.push(sprint);
  }
  return sprints;
}

/**
 * Pick the sprint to show by default: the highest-numbered "active" sprint (the
 * live one), or the newest sprint when none is active.
 * @param {Array<object>} sprints - probed sprint records, ascending by sprint_id.
 * @returns {object} the sprint to select by default (caller guarantees non-empty).
 */
function defaultSprint(sprints) {
  let active = null;
  for (const sprint of sprints) {
    if (sprint.status === STATUS_ACTIVE) {
      active = sprint; // Keep the highest active seen; numbering ascends.
    }
  }
  return active === null ? sprints[sprints.length - 1] : active;
}

/**
 * Load the open backlog issues.
 * @returns {Promise<Array<object>>} the backlog issue records (possibly empty).
 * @throws {Error} if backlog.json is missing or unparseable.
 */
async function loadBacklog() {
  const collection = await fetchJson(BACKLOG_PATH);
  return collection.issues;
}

/**
 * Load the per-Teammate load records, distinguishing "feature off" from data.
 * @returns {Promise<Array<object>|null>} the load records (possibly empty), or
 *   null when load_progress.json is absent (load reporting disabled).
 * @throws {Error} if the file exists but cannot be fetched, parsed, or lacks
 *   the schema's records array (fail-closed on a present-but-broken file).
 */
async function loadLoadRecords() {
  const collection = await fetchOptionalJson(LOAD_PROGRESS_PATH);
  if (collection === null) {
    return null;
  }
  if (!Array.isArray(collection.records)) {
    throw new Error(`${LOAD_PROGRESS_PATH} has no records array (load-progress.schema.json)`);
  }
  return collection.records;
}

/**
 * Aggregate load records per Teammate: agent_type, plus agent_id when present,
 * keys an entry (load-progress.schema.json identity fields).
 * @param {Array<object>} records - load records ({ts, agent_type, agent_id?, tool_name}).
 * @param {number} nowMs - reference time for the recency windows (epoch ms).
 * @returns {Array<object>} entries {label, total, lastHour, lastDay, lastSeenMs},
 *   sorted by total descending (heaviest load first).
 */
function aggregateLoad(records, nowMs) {
  const byTeammate = new Map();
  for (const record of records) {
    const label = record.agent_id ? `${record.agent_type} · ${record.agent_id}` : record.agent_type;
    let entry = byTeammate.get(label);
    if (entry === undefined) {
      entry = { label, total: 0, lastHour: 0, lastDay: 0, lastSeenMs: 0 };
      byTeammate.set(label, entry);
    }
    const tsMs = Date.parse(record.ts);
    entry.total += 1;
    if (nowMs - tsMs <= ONE_HOUR_MS) {
      entry.lastHour += 1;
    }
    if (nowMs - tsMs <= ONE_DAY_MS) {
      entry.lastDay += 1;
    }
    if (tsMs > entry.lastSeenMs) {
      entry.lastSeenMs = tsMs;
    }
  }
  return Array.from(byTeammate.values()).sort((a, b) => b.total - a.total);
}

/**
 * Load the hook invocation ledger, distinguishing "absent" from "broken".
 * @returns {Promise<Array<object>|null>} the invocation records (possibly empty),
 *   or null when the ledger is absent (no hook has fired yet).
 * @throws {Error} if the ledger exists but cannot be fetched, parsed, or lacks
 *   the records array (fail-closed on a present-but-broken file).
 */
async function loadInvocationLedger() {
  const collection = await fetchOptionalJson(INVOCATION_LOG_PATH);
  if (collection === null) {
    return null;
  }
  if (!Array.isArray(collection.records)) {
    throw new Error(`${INVOCATION_LOG_PATH} has no records array (invocation ledger)`);
  }
  return collection.records;
}

/**
 * Find the hook feature that owns a script basename.
 * @param {string} script - an invocation record's script basename.
 * @returns {object|null} the HOOK_FEATURES entry, or null for a script no feature
 *   claims (e.g. a renamed or legacy hook still present in the ledger).
 */
function featureForScript(script) {
  for (const feature of HOOK_FEATURES) {
    if (feature.scripts.includes(script)) {
      return feature;
    }
  }
  return null;
}

/**
 * Derive one feature's doctor-parity health from the invocation ledger alone.
 * The viewer cannot probe wiring or live pids the way doctor does, so health is
 * read purely from the feature's latest record: a "disabled" outcome means the
 * toggle is off; otherwise a heartbeat within HEARTBEAT_FRESH_MS is firing, and
 * an older or absent heartbeat is stale.
 * @param {object} feature - a HOOK_FEATURES entry.
 * @param {Array<object>} records - all invocation records.
 * @param {number} nowMs - reference time for the freshness window (epoch ms).
 * @returns {object} {status, lastSeenMs, outcome, count}; lastSeenMs/outcome are
 *   null when the feature has no records.
 */
function featureHealth(feature, records, nowMs) {
  const scripts = new Set(feature.scripts);
  let latest = null;
  let count = 0;
  for (const record of records) {
    if (!scripts.has(record.script)) {
      continue;
    }
    count += 1;
    const tsMs = Date.parse(record.ts);
    if (latest === null || tsMs > latest.tsMs) {
      latest = { tsMs, outcome: record.outcome };
    }
  }
  if (latest === null) {
    return { status: HOOK_STATUS_STALE, lastSeenMs: null, outcome: null, count: 0 };
  }
  let status;
  if (latest.outcome === OUTCOME_DISABLED) {
    status = HOOK_STATUS_DISABLED;
  } else if (nowMs - latest.tsMs <= HEARTBEAT_FRESH_MS) {
    status = HOOK_STATUS_FIRING;
  } else {
    status = HOOK_STATUS_STALE;
  }
  return { status, lastSeenMs: latest.tsMs, outcome: latest.outcome, count };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Build a card element for a sprint work item.
 * @param {object} item - a sprint work_item (id, type, title, owner, summary, closes_issues).
 * @returns {HTMLElement} the card.
 */
function renderWorkItem(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(spanWithText('card-id', item.id));
  head.appendChild(spanWithText('tag', item.type));
  card.appendChild(head);

  card.appendChild(elementWithText('h3', 'card-title', item.title));
  card.appendChild(elementWithText('p', 'card-summary', item.summary));

  const closes = item.closes_issues.length ? `closes ${item.closes_issues.join(', ')} · ` : '';
  card.appendChild(elementWithText('p', 'card-meta', `${closes}owner: ${item.owner}`));
  return card;
}

/**
 * Build a card element for a backlog issue.
 * @param {object} issue - a backlog issue (id, title, status, severity, scope, description…).
 * @returns {HTMLElement} the card.
 */
function renderBacklogIssue(issue) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(spanWithText('card-id', issue.id));
  const severityTag = spanWithText('tag', issue.severity);
  if (issue.severity === SEVERITY_HIGH) {
    severityTag.classList.add('tag-p1');
  }
  head.appendChild(severityTag);
  card.appendChild(head);

  card.appendChild(elementWithText('h3', 'card-title', issue.title));
  card.appendChild(elementWithText('p', 'card-meta', `scope: ${issue.scope.join(', ')}`));
  return card;
}

/**
 * Fill a lane: render each item via the builder, or show an empty placeholder.
 * @param {string} bodyId - element id of the lane body.
 * @param {string} countId - element id of the lane's count badge.
 * @param {Array<object>} items - the records to render.
 * @param {(item: object) => HTMLElement} build - card builder for one record.
 */
function fillLane(bodyId, countId, items, build) {
  const body = byId(bodyId);
  body.replaceChildren(); // Idempotent: clear any prior render before refilling on a switch.
  byId(countId).textContent = String(items.length);
  if (items.length === 0) {
    body.appendChild(elementWithText('p', 'empty', 'none'));
    return;
  }
  for (const item of items) {
    body.appendChild(build(item));
  }
}

/**
 * Render the backlog lane. The backlog is global (current open issues), not
 * sprint-scoped, so it renders once at load and does not change when the
 * sprint switcher selects a different sprint.
 * @param {Array<object>} backlog - open backlog issues.
 */
function renderBacklogLane(backlog) {
  fillLane(BACKLOG_LANE.body, BACKLOG_LANE.count, backlog, renderBacklogIssue);
}

/**
 * Render one sprint's lanes and detail: the sprint line, the three work-item
 * lanes, and the decisions / retrospective / step_log detail blocks. Idempotent
 * — safe to call repeatedly as the switcher changes selection.
 * @param {object} sprint - the sprint record to render.
 */
function renderSprint(sprint) {
  byId(ELEMENT_IDS.sprintLine).textContent = sprintLineText(sprint);
  for (const lane of SPRINT_LANES) {
    fillLane(lane.body, lane.count, sprint[lane.field], renderWorkItem);
  }
  renderDetail(sprint);
}

/**
 * Phrase the sprint line: id, name, status, and the date span.
 * @param {object} sprint - the sprint record.
 * @returns {string} the one-line summary shown under the page title.
 */
function sprintLineText(sprint) {
  const span = sprint.dates.end ? `${sprint.dates.start} – ${sprint.dates.end}` : `started ${sprint.dates.start}`;
  return `Sprint ${sprint.sprint_id}: ${sprint.name} — ${sprint.status}, ${span}`;
}

/**
 * Build a card element for a sprint decision.
 * @param {object} decision - a decision ({title, summary}).
 * @returns {HTMLElement} the card.
 */
function renderDecision(decision) {
  const card = document.createElement('article');
  card.className = 'card';
  card.appendChild(elementWithText('h3', 'card-title', decision.title));
  card.appendChild(elementWithText('p', 'card-summary', decision.summary));
  return card;
}

/**
 * Build a card element for a retrospective note.
 * @param {object} note - a retrospective note ({title, body}).
 * @returns {HTMLElement} the card.
 */
function renderRetroNote(note) {
  const card = document.createElement('article');
  card.className = 'card';
  card.appendChild(elementWithText('h3', 'card-title', note.title));
  card.appendChild(elementWithText('p', 'card-summary', note.body));
  return card;
}

/**
 * Build a card element for a step_log gate verdict.
 * @param {object} entry - a step_log entry ({step, at, artifact, summary}).
 * @returns {HTMLElement} the card.
 */
function renderStepLogEntry(entry) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(spanWithText('card-id', entry.step));
  head.appendChild(spanWithText('tag', entry.at));
  card.appendChild(head);

  card.appendChild(elementWithText('p', 'card-meta', `artifact: ${entry.artifact}`));
  card.appendChild(elementWithText('p', 'card-summary', entry.summary));
  return card;
}

// Resolve a DETAIL_BLOCKS `build` key to its card builder. Kept beside the
// builders rather than in the constants block so the constants stay pure data.
const DETAIL_BUILDERS = {
  decision: renderDecision,
  retro: renderRetroNote,
  stepLog: renderStepLogEntry,
};

/**
 * Render the sprint-detail region: decisions, retrospective notes, and step_log
 * verdicts for the selected sprint. Each block is shown only when the sprint has
 * entries for it; the region is hidden when every block is empty.
 * @param {object} sprint - the selected sprint record.
 */
function renderDetail(sprint) {
  let anyShown = false;
  for (const blockCfg of DETAIL_BLOCKS) {
    const items = Array.isArray(sprint[blockCfg.field]) ? sprint[blockCfg.field] : [];
    const shown = fillDetailBlock(blockCfg, items, DETAIL_BUILDERS[blockCfg.build]);
    anyShown = anyShown || shown;
  }
  byId(ELEMENT_IDS.detail).hidden = !anyShown;
}

/**
 * Fill one detail block, or hide it when empty. Idempotent across re-renders.
 * @param {object} blockCfg - a DETAIL_BLOCKS entry ({block, body, count, …}).
 * @param {Array<object>} items - the entries to render.
 * @param {(item: object) => HTMLElement} build - card builder for one entry.
 * @returns {boolean} true when the block has content and is shown.
 */
function fillDetailBlock(blockCfg, items, build) {
  const body = byId(blockCfg.body);
  body.replaceChildren(); // Idempotent: clear any prior render before refilling on a switch.
  if (items.length === 0) {
    byId(blockCfg.block).hidden = true;
    return false;
  }
  byId(blockCfg.count).textContent = String(items.length);
  for (const item of items) {
    body.appendChild(build(item));
  }
  byId(blockCfg.block).hidden = false;
  return true;
}

/**
 * Format a last-seen timestamp as a relative phrase ("just now", "Nm ago"…).
 * @param {number} lastSeenMs - the event time (epoch ms).
 * @param {number} nowMs - reference time (epoch ms).
 * @returns {string} the relative phrase.
 */
function formatLastSeen(lastSeenMs, nowMs) {
  const ageMs = nowMs - lastSeenMs;
  if (ageMs < ONE_MINUTE_MS) {
    return 'just now';
  }
  if (ageMs < ONE_HOUR_MS) {
    return `${Math.floor(ageMs / ONE_MINUTE_MS)}m ago`;
  }
  if (ageMs < ONE_DAY_MS) {
    return `${Math.floor(ageMs / ONE_HOUR_MS)}h ago`;
  }
  return `${Math.floor(ageMs / ONE_DAY_MS)}d ago`;
}

/**
 * Build a card element for one Teammate's aggregated load.
 * @param {object} entry - {label, total, lastHour, lastDay, lastSeenMs} from aggregateLoad.
 * @param {number} nowMs - reference time for the last-seen phrase (epoch ms).
 * @returns {HTMLElement} the card.
 */
function renderLoadEntry(entry, nowMs) {
  const card = document.createElement('article');
  card.className = 'card';
  card.appendChild(elementWithText('h3', 'card-title', entry.label));

  const stats = document.createElement('p');
  stats.className = 'load-stats';
  const pairs = [
    ['total', entry.total],
    ['last hour', entry.lastHour],
    ['last day', entry.lastDay],
  ];
  for (const [name, value] of pairs) {
    stats.appendChild(elementWithText('strong', '', String(value)));
    stats.appendChild(document.createTextNode(` ${name} · `));
  }
  stats.appendChild(document.createTextNode(`seen ${formatLastSeen(entry.lastSeenMs, nowMs)}`));
  card.appendChild(stats);
  return card;
}

/**
 * Render the Teammate-load panel: off state (records null), empty state, or
 * one card per Teammate. The count badge shows total events rendered.
 * @param {Array<object>|null} records - load records, or null when reporting is off.
 */
function renderLoadPanel(records) {
  const note = byId(LOAD_PANEL.note);
  byId(LOAD_PANEL.panel).hidden = false;
  if (records === null) {
    note.hidden = false;
    note.textContent = 'Load reporting is off — no load_progress.json. Enable the load-report hook to populate this panel.';
    return;
  }
  byId(LOAD_PANEL.count).textContent = String(records.length);
  if (records.length === 0) {
    note.hidden = false;
    note.textContent = 'Load reporting is on, but no events are recorded yet.';
    return;
  }
  const body = byId(LOAD_PANEL.body);
  const nowMs = Date.now();
  for (const entry of aggregateLoad(records, nowMs)) {
    body.appendChild(renderLoadEntry(entry, nowMs));
  }
}

/**
 * Build a doctor-parity health card for one hook feature: the feature name, a
 * status pill (firing/stale/disabled), its last heartbeat, and a one-line detail
 * (scripts, records logged, last outcome).
 * @param {object} feature - a HOOK_FEATURES entry.
 * @param {object} health - the featureHealth result for this feature.
 * @param {number} nowMs - reference time for the last-seen phrase (epoch ms).
 * @returns {HTMLElement} the card.
 */
function renderHookCard(feature, health, nowMs) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(elementWithText('h3', 'card-title', feature.label));
  const pill = spanWithText('hook-status', health.status);
  pill.classList.add(`hook-status-${health.status}`);
  head.appendChild(pill);
  card.appendChild(head);

  const heartbeat = health.lastSeenMs === null ? 'no heartbeat yet' : `last fired ${formatLastSeen(health.lastSeenMs, nowMs)}`;
  card.appendChild(elementWithText('p', 'card-meta', heartbeat));

  const detail = health.outcome === null
    ? feature.scripts.join(', ')
    : `${feature.scripts.join(', ')} · ${health.count} logged · last ${health.outcome}`;
  card.appendChild(elementWithText('p', 'card-meta', detail));
  return card;
}

/**
 * Render one health card per hook feature, in HOOK_FEATURES order.
 * @param {Array<object>} records - all invocation records.
 * @param {number} nowMs - reference time (epoch ms).
 */
function renderHooksCards(records, nowMs) {
  const cards = byId(HOOK_IDS.cards);
  for (const feature of HOOK_FEATURES) {
    cards.appendChild(renderHookCard(feature, featureHealth(feature, records, nowMs), nowMs));
  }
}

/**
 * Populate the feature and outcome filter <select>s, each led by an "all" option.
 */
function populateHookFilters() {
  const featureSelect = byId(HOOK_IDS.filterFeature);
  featureSelect.replaceChildren();
  featureSelect.appendChild(makeOption(FILTER_ALL, 'All features'));
  for (const feature of HOOK_FEATURES) {
    featureSelect.appendChild(makeOption(feature.key, feature.label));
  }
  const outcomeSelect = byId(HOOK_IDS.filterOutcome);
  outcomeSelect.replaceChildren();
  outcomeSelect.appendChild(makeOption(FILTER_ALL, 'All outcomes'));
  for (const outcome of HOOK_OUTCOMES) {
    outcomeSelect.appendChild(makeOption(outcome, outcome));
  }
}

/**
 * Test whether an invocation record passes the current feature and outcome filters.
 * @param {object} record - an invocation record ({ts, script, event, outcome}).
 * @param {string} featureKey - a HOOK_FEATURES key, or FILTER_ALL.
 * @param {string} outcome - a HOOK_OUTCOMES value, or FILTER_ALL.
 * @returns {boolean} true when the record should be shown.
 */
function invocationMatches(record, featureKey, outcome) {
  if (outcome !== FILTER_ALL && record.outcome !== outcome) {
    return false;
  }
  if (featureKey !== FILTER_ALL) {
    const feature = featureForScript(record.script);
    if (feature === null || feature.key !== featureKey) {
      return false;
    }
  }
  return true;
}

/**
 * Build the invocation table header row.
 * @returns {HTMLElement} the <thead>.
 */
function renderInvocationHead() {
  const thead = document.createElement('thead');
  const row = document.createElement('tr');
  for (const label of ['Time', 'Feature', 'Event', 'Outcome']) {
    row.appendChild(elementWithText('th', 'hooks-th', label));
  }
  thead.appendChild(row);
  return thead;
}

/**
 * Build a table row for one invocation record. The time cell carries the exact
 * timestamp as its tooltip; the outcome cell is colour-coded by outcome.
 * @param {object} record - an invocation record ({ts, script, event, outcome}).
 * @param {number} nowMs - reference time for the relative time (epoch ms).
 * @returns {HTMLElement} the <tr>.
 */
function renderInvocationRow(record, nowMs) {
  const row = document.createElement('tr');
  const feature = featureForScript(record.script);

  const timeCell = elementWithText('td', 'hooks-cell', formatLastSeen(Date.parse(record.ts), nowMs));
  timeCell.title = record.ts; // Exact ISO timestamp on hover; the cell shows the relative phrase.
  row.appendChild(timeCell);

  row.appendChild(elementWithText('td', 'hooks-cell', feature === null ? record.script : feature.label));
  row.appendChild(elementWithText('td', 'hooks-cell', record.event));

  const outcomeCell = elementWithText('td', 'hooks-cell', record.outcome);
  outcomeCell.classList.add(`hook-outcome-${record.outcome}`);
  row.appendChild(outcomeCell);
  return row;
}

/**
 * Render the recent-invocations table from the kept records under the current
 * filters: newest first, capped at RECENT_INVOCATIONS_MAX with the remainder
 * summarized (never silently dropped). Re-invoked on every filter change.
 */
function renderInvocationTable() {
  const featureKey = byId(HOOK_IDS.filterFeature).value;
  const outcome = byId(HOOK_IDS.filterOutcome).value;
  const matched = invocationRecords.filter((record) => invocationMatches(record, featureKey, outcome));
  byId(HOOK_IDS.countInvocations).textContent = String(matched.length);

  const container = byId(HOOK_IDS.table);
  container.replaceChildren(); // Idempotent: rebuild the table on every filter change.

  if (matched.length === 0) {
    container.appendChild(elementWithText('p', 'empty', 'No invocations match the current filter.'));
    return;
  }

  // Records are appended oldest-first; reverse a copy for newest-first display.
  const newestFirst = matched.slice().reverse();
  const shown = newestFirst.slice(0, RECENT_INVOCATIONS_MAX);
  const nowMs = Date.now();

  const table = document.createElement('table');
  table.className = 'hooks-table-el';
  table.appendChild(renderInvocationHead());
  const tbody = document.createElement('tbody');
  for (const record of shown) {
    tbody.appendChild(renderInvocationRow(record, nowMs));
  }
  table.appendChild(tbody);
  container.appendChild(table);

  if (matched.length > shown.length) {
    container.appendChild(
      elementWithText('p', 'hooks-truncated', `Showing the newest ${shown.length} of ${matched.length} matching invocations.`),
    );
  }
}

/**
 * Render the hook-health panel: an explicit empty state when the ledger is absent
 * (records null) or empty, otherwise the per-feature cards plus the collapsible,
 * filterable invocation table.
 * @param {Array<object>|null} records - invocation records, or null when the
 *   ledger is absent.
 */
function renderHooksPanel(records) {
  const note = byId(HOOK_IDS.note);
  byId(HOOK_IDS.panel).hidden = false;
  if (records === null) {
    note.hidden = false;
    note.textContent = 'No hook invocation ledger yet — no hook has fired, or this Instance predates the ledger.';
    return;
  }
  byId(HOOK_IDS.count).textContent = String(records.length);
  if (records.length === 0) {
    note.hidden = false;
    note.textContent = 'The invocation ledger is present but empty — no hook has fired yet.';
    return;
  }
  invocationRecords = records;
  renderHooksCards(records, Date.now());
  populateHookFilters();
  renderInvocationTable();
  byId(HOOK_IDS.filterFeature).addEventListener('change', renderInvocationTable);
  byId(HOOK_IDS.filterOutcome).addEventListener('change', renderInvocationTable);
  byId(HOOK_IDS.log).hidden = false;
}

// ---------------------------------------------------------------------------
// DOM utilities
// ---------------------------------------------------------------------------

/**
 * Look up a required element by id.
 * @param {string} id - the element id.
 * @returns {HTMLElement} the element.
 * @throws {Error} if no such element exists (a markup/JS contract break).
 */
function byId(id) {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`missing required element #${id}`);
  }
  return el;
}

/**
 * Create an element with a class and text content.
 * @param {string} tag - the tag name.
 * @param {string} className - the class to set.
 * @param {string} text - the text content (assigned, never parsed as HTML).
 * @returns {HTMLElement} the element.
 */
function elementWithText(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Create a <span> with a class and text content.
 * @param {string} className - the class to set.
 * @param {string} text - the text content.
 * @returns {HTMLSpanElement} the span.
 */
function spanWithText(className, text) {
  return elementWithText('span', className, text);
}

/**
 * Create an <option> with a value and visible label.
 * @param {string} value - the option value.
 * @param {string} text - the visible label.
 * @returns {HTMLOptionElement} the option.
 */
function makeOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/**
 * Surface a load failure in place of the board, with a serve instruction.
 * @param {string} detail - the underlying error message.
 */
function showLoadError(detail) {
  const box = byId(ELEMENT_IDS.loadError);
  box.hidden = false;
  box.replaceChildren(); // Clear any prior message.
  box.appendChild(elementWithText('strong', '', 'Could not load the .excn JSON.'));
  box.appendChild(
    elementWithText(
      'p',
      '',
      'The viewer reads the JSON over http(s); opening this file directly (file://) blocks those reads. Serve the repo root and open the viewer there:',
    ),
  );
  box.appendChild(elementWithText('p', '', 'python3 -m http.server 8000   (then open http://localhost:8000/viewer/)'));
  box.appendChild(elementWithText('p', '', detail));
}

// ---------------------------------------------------------------------------
// Sprint switcher (History API)
// ---------------------------------------------------------------------------

/**
 * Populate the switcher <select> with one option per probed sprint, newest
 * first, and reveal it. The option value is the sprint_id.
 * @param {Array<object>} sprints - probed sprint records, ascending by sprint_id.
 */
function buildSwitcher(sprints) {
  const select = byId(ELEMENT_IDS.sprintSelect);
  select.replaceChildren();
  // Newest first: walk the ascending probe order in reverse.
  for (let i = sprints.length - 1; i >= 0; i -= 1) {
    const sprint = sprints[i];
    select.appendChild(makeOption(String(sprint.sprint_id), `Sprint ${sprint.sprint_id} — ${sprint.name} (${sprint.status})`));
  }
  byId(ELEMENT_IDS.switcher).hidden = false;
}

/**
 * Read the sprint id from the URL query string when it names a probed sprint.
 * popstate does not fire on initial load, so the initial selection comes from
 * location.search (so refresh and deep links work), not from history state.
 * @returns {number|null} the requested sprint_id when present and known, else null.
 */
function sprintIdFromUrl() {
  const raw = new URLSearchParams(window.location.search).get(SPRINT_QUERY_PARAM);
  if (raw === null) {
    return null;
  }
  const id = Number.parseInt(raw, 10);
  return sprintsById.has(id) ? id : null;
}

/**
 * Render the named sprint and sync the switcher value. Optionally push a history
 * entry so back/forward navigate selections and the URL carries ?sprint=N.
 * @param {number} sprintId - a sprint_id known to sprintsById.
 * @param {boolean} pushHistory - true on a user switch (push a history entry);
 *   false on the initial render and on popstate (history already moved).
 * @throws {Error} if sprintId names no probed sprint (a caller contract break).
 */
function selectSprint(sprintId, pushHistory) {
  const sprint = sprintsById.get(sprintId);
  if (sprint === undefined) {
    throw new Error(`no probed sprint with id ${sprintId}`);
  }
  byId(ELEMENT_IDS.sprintSelect).value = String(sprintId);
  renderSprint(sprint);
  if (pushHistory) {
    window.history.pushState({ sprintId }, '', `?${SPRINT_QUERY_PARAM}=${sprintId}`);
  }
}

/**
 * Switcher change handler: render the chosen sprint and push a history entry.
 */
function onSwitcherChange() {
  const sprintId = Number.parseInt(byId(ELEMENT_IDS.sprintSelect).value, 10);
  selectSprint(sprintId, true);
}

/**
 * popstate handler: re-render the sprint named by the history state, then the
 * URL, then the default — whichever is the first known sprint. History already
 * moved, so this never pushes a new entry.
 * @param {PopStateEvent} event - the popstate event.
 */
function onPopState(event) {
  const fromState = event.state && typeof event.state.sprintId === 'number' ? event.state.sprintId : null;
  const candidate = fromState !== null ? fromState : sprintIdFromUrl();
  const sprintId = candidate !== null && sprintsById.has(candidate) ? candidate : defaultSprintId;
  selectSprint(sprintId, false);
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Render the Teammate-load panel, containing its own failures: a broken
 * load_progress.json names itself in the panel note instead of taking down
 * the board (which renders from independent files).
 */
async function initLoadPanel() {
  try {
    renderLoadPanel(await loadLoadRecords());
  } catch (err) {
    const note = byId(LOAD_PANEL.note);
    byId(LOAD_PANEL.panel).hidden = false;
    note.hidden = false;
    note.textContent = `Could not load the load records: ${err.message}`;
  }
}

/**
 * Render the hook-health panel, containing its own failures: a broken invocation
 * ledger names itself in the panel note instead of taking down the board (which
 * renders from independent files).
 */
async function initHooksPanel() {
  try {
    renderHooksPanel(await loadInvocationLedger());
  } catch (err) {
    const note = byId(HOOK_IDS.note);
    byId(HOOK_IDS.panel).hidden = false;
    note.hidden = false;
    note.textContent = `Could not load the hook invocation ledger: ${err.message}`;
  }
}

/**
 * Entry point: probe every sprint, render the backlog, then render the selected
 * sprint (URL ?sprint=N if known, else the default) and wire the switcher and
 * History navigation. Any fetch/parse failure shows the error surface instead of
 * a partial board. The load panel renders independently — it is optional telemetry.
 */
async function init() {
  try {
    const sprints = await probeSprints();
    const backlog = await loadBacklog();
    renderBacklogLane(backlog);
    if (sprints.length === 0) {
      byId(ELEMENT_IDS.sprintLine).textContent = 'No sprints yet.';
      byId(ELEMENT_IDS.board).hidden = false;
      await initLoadPanel();
      await initHooksPanel();
      return;
    }
    for (const sprint of sprints) {
      sprintsById.set(sprint.sprint_id, sprint);
    }
    defaultSprintId = defaultSprint(sprints).sprint_id;
    buildSwitcher(sprints);
    const initialId = sprintIdFromUrl();
    selectSprint(initialId === null ? defaultSprintId : initialId, false);
    byId(ELEMENT_IDS.sprintSelect).addEventListener('change', onSwitcherChange);
    window.addEventListener('popstate', onPopState);
    byId(ELEMENT_IDS.board).hidden = false;
    await initLoadPanel();
    await initHooksPanel();
  } catch (err) {
    showLoadError(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
