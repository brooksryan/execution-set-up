'use strict';

// hook-lib — shared plumbing for the stamped per-feature hook scripts (ADR-0006).
// Contract: hooks are remind-only and FAIL SAFE. Any missing or malformed config,
// unexpected payload, or internal error must end in exit 0 with no output — never a
// block, never a diagnostic the agent has to wade through. This deliberately inverts
// the fail-closed CLI rule (PRD-007 testing decision): a decayed hook must not stop
// work; decay surfaces through the health check, not through hook failures.
// Node builtins only.

const fs = require('fs');
const path = require('path');

// The schema-validated toggle config the Scaffolder seeds into the Instance.
const CONFIG_RELATIVE_PATH = path.join('.excn', 'hooks.config.json');

// The unified invocation log every wired hook appends to (CODE_STANDARDS ## Hooks).
// A Runtime Record — hook-written state lives under .excn/runtime/ (ADR-0008); it
// stays in the *_progress.json ignore class (ADR-0005), so it never lands in git.
const INVOCATION_LOG_RELATIVE_PATH = path.join('.excn', 'runtime', 'hook-invocations_progress.json');
const INVOCATION_LOG_SCHEMA_VERSION = '1.0';

// Rolling-window cap on invocation records (same window shape as load-report's): at
// a handful of records per tool event across a full team this covers days of heavy
// activity while keeping every read/rewrite of the file cheap. Older records drop on
// append — the log is a recency signal for doctor's heartbeats, not an archive.
const MAX_INVOCATION_RECORDS = 5000;

// The outcome vocabulary of an invocation record (CODE_STANDARDS ## Hooks): `ok` —
// the enabled hook ran and acted (emitted a decision/context or wrote state);
// `disabled` — the feature toggle was off (or read as off, fail safe); `noop` —
// enabled, ran, nothing to do; `error` — a failure was swallowed by the fail-safe
// guard (including an unreadable payload).
const OUTCOME_OK = 'ok';
const OUTCOME_DISABLED = 'disabled';
const OUTCOME_NOOP = 'noop';
const OUTCOME_ERROR = 'error';

// Hook payloads arrive as one JSON document on stdin (fd 0).
const STDIN_FD = 0;

/**
 * Read and parse the hook payload from stdin.
 * @returns {object|null} the payload object, or null on any read/parse failure or a
 * non-object document (fail safe — callers treat null as "exit 0, do nothing").
 */
function readPayload() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STDIN_FD, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // fail safe: an unreadable payload means this hook does nothing
  }
}

/**
 * Read and parse a JSON file.
 * @param {string} filePath - absolute path of the JSON file.
 * @returns {object|null} the parsed object, or null if missing/unparseable/non-object
 * (fail safe — absence and corruption are equivalent to "no data").
 */
function readJsonSafe(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // fail safe: missing or malformed file reads as no data
  }
}

/**
 * Decide whether a hook feature is enabled in the Instance's toggle config.
 * @param {string} projectRoot - the Instance root (the hook payload's cwd).
 * @param {string} feature - feature key in the config's `features` map.
 * @returns {boolean} true only when the config parses and carries `true` for the
 * feature; a missing/malformed config or non-boolean value reads as disabled.
 */
function featureEnabled(projectRoot, feature) {
  const config = readJsonSafe(path.join(projectRoot, CONFIG_RELATIVE_PATH));
  return Boolean(config && config.features && config.features[feature] === true);
}

/**
 * Write a JSON file atomically (temp + rename), so concurrent teammate sessions never
 * observe a half-written state file.
 * @param {string} filePath - absolute destination path.
 * @param {object} data - the object to serialize.
 * @returns {void}
 * @throws Propagates fs errors — callers sit inside the script-level fail-safe catch.
 */
function atomicWriteJson(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

/**
 * Emit a hook decision document on stdout (the channel Claude Code reads decisions
 * from; these scripts have no other stdout output).
 * @param {object} decision - the hook-output object to serialize.
 * @returns {void}
 */
function emit(decision) {
  process.stdout.write(JSON.stringify(decision));
}

/**
 * Append one invocation record {ts, script, event, outcome} to the unified hook
 * invocation log, trimming to the newest MAX_INVOCATION_RECORDS (rolling window).
 * The single sanctioned writer of the log (CODE_STANDARDS ## Hooks): every wired
 * hook calls this exactly once, on every exit path.
 * @param {string} projectRoot - the Instance root (payload cwd, or process.cwd()
 * when no payload was readable).
 * @param {string} script - the calling hook script's file basename.
 * @param {string} event - the hook event name (e.g. PostToolUse).
 * @param {string} outcome - one of the OUTCOME_* constants.
 * @returns {void} Never throws: a logging failure is swallowed here so it can never
 * escape past a hook's fail-safe guard (ADR-0006).
 */
function logInvocation(projectRoot, script, event, outcome) {
  try {
    const logFile = path.join(projectRoot, INVOCATION_LOG_RELATIVE_PATH);
    const existing = readJsonSafe(logFile);
    const records = existing && Array.isArray(existing.records) ? existing.records : [];
    records.push({ ts: new Date().toISOString(), script, event, outcome });
    atomicWriteJson(logFile, {
      schema_version: INVOCATION_LOG_SCHEMA_VERSION,
      records: records.slice(-MAX_INVOCATION_RECORDS),
    });
  } catch {
    // Fail safe: observability must never break the hook it observes.
  }
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  readPayload,
  readJsonSafe,
  featureEnabled,
  atomicWriteJson,
  emit,
  logInvocation,
  OUTCOME_OK,
  OUTCOME_DISABLED,
  OUTCOME_NOOP,
  OUTCOME_ERROR,
};
