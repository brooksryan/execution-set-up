#!/usr/bin/env node
'use strict';

// load-report — the per-Teammate load-reporting feature (EXEC-045, ADR-0006; default
// OFF). Wired in settings.json as PostToolUse on every tool. When the toggle is on,
// each firing appends one {ts, agent_type, agent_id?, tool_name} record to
// .excn/runtime/load_progress.json (a Runtime Record, ADR-0008; still the
// *_progress.json ignore class, ADR-0005; schema at
// .excn/schemas/load-progress.schema.json) via atomic temp+rename, so the viewer can
// render per-Teammate load. Bounded growth: the file keeps the newest MAX_RECORDS
// records — older ones are dropped on append (a rolling window, not an archive; load
// is a recency signal). Every firing logs one invocation record via hook-lib
// (CODE_STANDARDS ## Hooks). FAIL SAFE: every path, including thrown errors, exits 0
// with no output (PRD-007).

const path = require('path');
const lib = require('./hook-lib.cjs');

const FEATURE = 'load_reporting';

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the
// event matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'PostToolUse';

// Where the load records live: a Runtime Record under .excn/runtime/ (ADR-0008),
// in the *_progress.json ignore class (ADR-0005).
const RECORD_RELATIVE_PATH = path.join('.excn', 'runtime', 'load_progress.json');
const RECORD_SCHEMA_VERSION = '1.0';

// Rolling-window cap: at one record per tool event this covers days of heavy team
// activity while keeping every read/rewrite of the file cheap.
const MAX_RECORDS = 5000;

/**
 * Append one load record for this tool event, trimming to the newest MAX_RECORDS.
 * @param {object} payload - the PostToolUse hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when a record was
 * appended, OUTCOME_NOOP when the payload carried no usable tool_name.
 */
function appendRecord(payload, projectRoot) {
  if (typeof payload.tool_name !== 'string' || payload.tool_name === '') return lib.OUTCOME_NOOP;
  const recordFile = path.join(projectRoot, RECORD_RELATIVE_PATH);
  const existing = lib.readJsonSafe(recordFile);
  const records = existing && Array.isArray(existing.records) ? existing.records : [];

  const record = {
    ts: new Date().toISOString(),
    agent_type: typeof payload.agent_type === 'string' ? payload.agent_type : 'unknown',
    tool_name: payload.tool_name,
  };
  // agent_id only exists for subagents (research §0); omit rather than null it.
  if (typeof payload.agent_id === 'string' && payload.agent_id !== '') record.agent_id = payload.agent_id;
  records.push(record);

  lib.atomicWriteJson(recordFile, {
    schema_version: RECORD_SCHEMA_VERSION,
    records: records.slice(-MAX_RECORDS),
  });
  return lib.OUTCOME_OK;
}

/**
 * Entry point: on an enabled firing, append this tool event's load record. Every
 * path logs exactly one invocation record (CODE_STANDARDS ## Hooks) and exits 0
 * (fail safe, ADR-0006).
 * @returns {void}
 */
function main() {
  let projectRoot = process.cwd();
  let outcome = lib.OUTCOME_ERROR;
  try {
    const payload = lib.readPayload();
    if (payload) {
      projectRoot = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
      if (!lib.featureEnabled(projectRoot, FEATURE)) outcome = lib.OUTCOME_DISABLED;
      else outcome = appendRecord(payload, projectRoot);
    }
  } catch {
    outcome = lib.OUTCOME_ERROR; // fail safe: a broken hook never blocks work
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, HOOK_EVENT, outcome);
  process.exit(0);
}

main();
