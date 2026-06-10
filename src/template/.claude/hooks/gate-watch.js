#!/usr/bin/env node
'use strict';

// gate-watch — the gate-reminders hook feature (ADR-0006, remind-only; default ON).
// Two modes, selected by argv: `post-tool` (PostToolUse on Write/Edit) watches
// gate-relevant paths and injects a gate-due reminder as additionalContext; `stop`
// (Stop) blocks ONCE — guarded by stop_hook_active — when gated paths were edited
// this session but no gate verdict has been recorded, naming the gates due. It never
// spawns an agent. Session state lives in .excn/gate-watch_progress.json (the
// *_progress.json ignore class, ADR-0005). Every firing logs one invocation record
// via hook-lib (CODE_STANDARDS ## Hooks). FAIL SAFE: any missing/malformed config,
// unexpected payload, or internal error exits 0 with no output (PRD-007) — this
// intentionally inverts the fail-closed CLI rule; the health check surfaces decay.

const fs = require('fs');
const path = require('path');
const lib = require('./hook-lib');
const {
  GATE_PATH_RULES,
  GATED_DOC_FILES,
  GATED_DOC_GATES,
  REMINDER_TEMPLATE,
  BLOCK_REASON_TEMPLATE,
} = require('./gate-rules');

const FEATURE = 'gate_reminders';
const MODE_POST_TOOL = 'post-tool';
const MODE_STOP = 'stop';

// Identity and event names for the invocation log (CODE_STANDARDS ## Hooks). The
// event derives from the argv mode — the wiring is the source of truth; an
// unrecognized mode logs the fallback name with an `error` outcome.
const SCRIPT_NAME = path.basename(__filename);
const MODE_EVENTS = { [MODE_POST_TOOL]: 'PostToolUse', [MODE_STOP]: 'Stop' };
const EVENT_UNKNOWN = 'unknown';

// Per-session pending-gate state, keyed by session_id; in the *_progress.json
// ignore class so it never lands in git.
const STATE_RELATIVE_PATH = path.join('.excn', 'gate-watch_progress.json');
const STATE_SCHEMA_VERSION = '1.0';

// Sessions idle longer than this are pruned so the state file cannot grow unbounded
// across many teammate sessions.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// The file-editing tools whose payloads carry a file_path worth classifying.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// A write to any progress record or to a sprint record is where gate verdicts land
// (PROCESS.md; gates append step_log entries to .excn/sprints/sprint_<N>.json), so
// either clears this session's pending gates — except a write to this feature's own
// state.
const PROGRESS_FILE_PATTERN = /^\.excn\/[^/]*_progress\.json$/;
const SPRINT_FILE_PATTERN = /^\.excn\/sprints\/sprint_\d+\.json$/;
const OWN_STATE_BASENAME = 'gate-watch_progress.json';

// Stop-time evidence scan: gates run as their own sessions, so their verdict writes
// never fire as PostToolUse events in the spawning session. Before blocking, these
// verdict-ledger locations are checked for content newer than the session's first
// pending gate (mtime approximation of "a verdict entry was appended after the
// gated edit").
const SPRINTS_DIR = path.join('.excn', 'sprints');
const EXCN_DIR = '.excn';

/**
 * Normalize an edited file's path to Instance-root-relative, forward-slash form.
 * @param {string} projectRoot - the Instance root (payload cwd).
 * @param {string} filePath - the tool_input file path (absolute or relative).
 * @returns {string|null} the root-relative path, or null when the file lies outside
 * the Instance (never gate-relevant).
 */
function rootRelative(projectRoot, filePath) {
  const relative = path.relative(projectRoot, path.resolve(projectRoot, filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/**
 * Name the QA gates an edit to a path puts on the hook.
 * @param {string} relativePath - Instance-root-relative, forward-slash path.
 * @returns {string[]} gate names due (empty when the path is not gate-relevant).
 */
function gatesFor(relativePath) {
  for (const rule of GATE_PATH_RULES) {
    if (relativePath.startsWith(rule.prefix)) return rule.gates;
  }
  if (GATED_DOC_FILES.includes(relativePath)) return GATED_DOC_GATES;
  return [];
}

/**
 * Load the pending-gate state, pruning sessions idle past the TTL.
 * @param {string} stateFile - absolute path of the state file.
 * @returns {object} `{ schema_version, sessions }` (fresh shape when missing/corrupt).
 */
function loadState(stateFile) {
  const raw = lib.readJsonSafe(stateFile);
  const sessions = raw && raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of Object.entries(sessions)) {
    if (!session || typeof session.updated_at !== 'number' || session.updated_at < cutoff) {
      delete sessions[id];
    }
  }
  return { schema_version: STATE_SCHEMA_VERSION, sessions };
}

/**
 * PostToolUse mode: classify the edited path. A gate-relevant edit records the gates
 * as pending for this session and injects the gate-due reminder; a progress-record
 * write clears the session's pending gates (the verdict landed).
 * @param {object} payload - the PostToolUse hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when the hook acted
 * (reminder emitted or pending state mutated), OUTCOME_NOOP otherwise.
 */
function handlePostTool(payload, projectRoot) {
  if (!EDIT_TOOLS.has(payload.tool_name) || !payload.session_id) return lib.OUTCOME_NOOP;
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath === '') return lib.OUTCOME_NOOP;
  const relativePath = rootRelative(projectRoot, filePath);
  if (relativePath === null) return lib.OUTCOME_NOOP;

  const stateFile = path.join(projectRoot, STATE_RELATIVE_PATH);
  const gates = gatesFor(relativePath);

  if (gates.length > 0) {
    const state = loadState(stateFile);
    const session = state.sessions[payload.session_id] || { pending: {}, paths: [], updated_at: 0 };
    if (typeof session.first_pending_at !== 'number') session.first_pending_at = Date.now();
    for (const gate of gates) session.pending[gate] = true;
    if (!session.paths.includes(relativePath)) session.paths.push(relativePath);
    session.updated_at = Date.now();
    state.sessions[payload.session_id] = session;
    lib.atomicWriteJson(stateFile, state);
    lib.emit({
      hookSpecificOutput: {
        hookEventName: MODE_EVENTS[MODE_POST_TOOL],
        additionalContext: REMINDER_TEMPLATE.replace('{path}', relativePath).replace(
          '{gates}',
          gates.join(' and ')
        ),
      },
    });
    return lib.OUTCOME_OK;
  }

  const verdictWrite =
    (PROGRESS_FILE_PATTERN.test(relativePath) && path.basename(relativePath) !== OWN_STATE_BASENAME) ||
    SPRINT_FILE_PATTERN.test(relativePath);
  if (verdictWrite) {
    const state = loadState(stateFile);
    const session = state.sessions[payload.session_id];
    if (session && Object.keys(session.pending).length > 0) {
      // The verdict record landed — this session is square with the protocol.
      delete state.sessions[payload.session_id];
      lib.atomicWriteJson(stateFile, state);
      return lib.OUTCOME_OK;
    }
  }
  return lib.OUTCOME_NOOP;
}

/**
 * Check the verdict-ledger files for evidence written after the session's first
 * pending gate: any sprint record (.excn/sprints/sprint_<N>.json, where gates append
 * step_log entries) or progress record (.excn/*_progress.json, excluding this
 * feature's own state) with an mtime newer than the threshold counts. mtime is an
 * accepted approximation of "a verdict entry was appended after the gated edit";
 * gates run as separate sessions, so this is the only signal the spawning session
 * ever sees. Unreadable directories/files count as no evidence (fail toward the
 * one-time reminder, which itself never wedges).
 * @param {string} projectRoot - the Instance root.
 * @param {number} sinceMs - epoch ms of the session's first pending gate.
 * @returns {boolean} true when a verdict ledger was touched after sinceMs.
 */
function verdictEvidenceSince(projectRoot, sinceMs) {
  const candidates = [];
  try {
    const sprintsDir = path.join(projectRoot, SPRINTS_DIR);
    for (const name of fs.readdirSync(sprintsDir)) {
      if (SPRINT_FILE_PATTERN.test(`${EXCN_DIR}/sprints/${name}`)) {
        candidates.push(path.join(sprintsDir, name));
      }
    }
  } catch {
    // No sprints directory — progress records may still carry the verdict.
  }
  try {
    const excnDir = path.join(projectRoot, EXCN_DIR);
    for (const name of fs.readdirSync(excnDir)) {
      if (PROGRESS_FILE_PATTERN.test(`${EXCN_DIR}/${name}`) && name !== OWN_STATE_BASENAME) {
        candidates.push(path.join(excnDir, name));
      }
    }
  } catch {
    // No .excn directory — nothing to read, no evidence.
  }
  for (const file of candidates) {
    try {
      if (fs.statSync(file).mtimeMs > sinceMs) return true;
    } catch {
      // Raced away or unreadable: skip it.
    }
  }
  return false;
}

/**
 * Stop mode: block once when the session holds pending gates with no verdict
 * recorded — but first scan the verdict ledgers, since gate verdicts are written by
 * separate gate sessions whose writes this session never observes as events. stop_hook_active guards the loop — on the hook-induced continuation the
 * pending state is cleared and the agent stops freely (one reminder, never a wedge).
 * @param {object} payload - the Stop hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when the hook acted
 * (block emitted or pending state cleared), OUTCOME_NOOP when nothing was pending.
 */
function handleStop(payload, projectRoot) {
  if (!payload.session_id) return lib.OUTCOME_NOOP;
  const stateFile = path.join(projectRoot, STATE_RELATIVE_PATH);
  const state = loadState(stateFile);
  const session = state.sessions[payload.session_id];
  const pendingGates = session ? Object.keys(session.pending) : [];
  if (pendingGates.length === 0) return lib.OUTCOME_NOOP;

  const since =
    typeof session.first_pending_at === 'number' ? session.first_pending_at : session.updated_at;
  if (verdictEvidenceSince(projectRoot, since)) {
    // A verdict ledger was written after the gated edit — the gate (run in its own
    // session) recorded its verdict; this session is square with the protocol.
    delete state.sessions[payload.session_id];
    lib.atomicWriteJson(stateFile, state);
    return lib.OUTCOME_OK;
  }

  if (payload.stop_hook_active === true) {
    // Second stop after our block: the reminder was delivered; clear and let go.
    delete state.sessions[payload.session_id];
    lib.atomicWriteJson(stateFile, state);
    return lib.OUTCOME_OK;
  }

  const editedPaths = Array.isArray(session.paths) ? session.paths : [];
  lib.emit({
    decision: 'block',
    reason: BLOCK_REASON_TEMPLATE.replace('{paths}', editedPaths.join(', ')).replace(
      '{gates}',
      pendingGates.join(' and ')
    ),
  });
  return lib.OUTCOME_OK;
}

/**
 * Entry point: read the payload, check the feature toggle, dispatch on the argv
 * mode. Every path — including thrown errors — logs exactly one invocation record
 * (CODE_STANDARDS ## Hooks) and exits 0 (fail safe, ADR-0006).
 * @returns {void}
 */
function main() {
  let projectRoot = process.cwd();
  const event = MODE_EVENTS[process.argv[2]] || EVENT_UNKNOWN;
  let outcome = lib.OUTCOME_ERROR;
  try {
    const mode = process.argv[2];
    const payload = lib.readPayload();
    if (mode !== MODE_POST_TOOL && mode !== MODE_STOP) {
      // Miswired argv: a swallowed failure, not a legitimate no-op.
      outcome = lib.OUTCOME_ERROR;
    } else if (!payload) {
      outcome = lib.OUTCOME_ERROR;
    } else {
      projectRoot = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
      if (!lib.featureEnabled(projectRoot, FEATURE)) outcome = lib.OUTCOME_DISABLED;
      else if (mode === MODE_POST_TOOL) outcome = handlePostTool(payload, projectRoot);
      else outcome = handleStop(payload, projectRoot);
    }
  } catch {
    outcome = lib.OUTCOME_ERROR; // fail safe: a broken hook never blocks work
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, event, outcome);
  process.exit(0);
}

main();
