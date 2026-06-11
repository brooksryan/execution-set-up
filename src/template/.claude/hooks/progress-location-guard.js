#!/usr/bin/env node
'use strict';

// progress-location-guard — the progress_location_guard hook feature (EXEC-070,
// ADR-0008; default OFF). Wired in settings.json as PreToolUse on the file-editing
// tools. When the toggle is on and a write targets a *_progress.json Record outside
// the two sanctioned homes (.excn/progress/, .excn/runtime/), it denies the write
// with a redirect reason naming the right home; every other write passes untouched
// (exit 0, no output). Location only — schema and content stay the gates' job
// (ADR-0006 division: a mechanical check may deny, judgment stays with gates). Every
// firing logs one invocation record via hook-lib (CODE_STANDARDS ## Hooks): a deny
// emitted is `ok`, a pass-through is `noop`. FAIL SAFE: a missing/malformed config or
// payload, or any internal error, exits 0 with no output (ADR-0006) — a broken guard
// never blocks a legitimate write.

const path = require('path');
const lib = require('./hook-lib');
const {
  RECORD_SUFFIX,
  RECORD_HOME_PREFIXES,
  PATH_PLACEHOLDER,
  DENY_REASON_TEMPLATE,
} = require('./progress-location-guard-rules');

const FEATURE = 'progress_location_guard';

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the
// event matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'PreToolUse';

// The PreToolUse decision vocabulary this guard emits (research §3.1, [empirical]).
const PERMISSION_DENY = 'deny';

// The file-editing tools whose tool_input carries a file_path worth location-checking;
// the settings matcher filters to these, this re-check guards against a miswiring.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Resolve the write's target to an Instance-root-relative, forward-slash path.
 * @param {string} projectRoot - the Instance root (payload cwd).
 * @param {string} filePath - the tool_input file path (absolute or relative).
 * @returns {string|null} the root-relative path, or null when the write lies outside
 * the Instance (never a guarded Record location).
 */
function rootRelative(projectRoot, filePath) {
  const relative = path.relative(projectRoot, path.resolve(projectRoot, filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/**
 * Decide this write: deny a *_progress.json Record written outside the two homes,
 * pass everything else.
 * @param {object} payload - the PreToolUse hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when the deny was emitted,
 * OUTCOME_NOOP when the write passed (not an editing tool, no path, not a Record, or
 * already inside a home).
 */
function guard(payload, projectRoot) {
  if (!EDIT_TOOLS.has(payload.tool_name)) return lib.OUTCOME_NOOP;
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath === '') return lib.OUTCOME_NOOP;
  const relativePath = rootRelative(projectRoot, filePath);
  if (relativePath === null || !relativePath.endsWith(RECORD_SUFFIX)) return lib.OUTCOME_NOOP;
  if (RECORD_HOME_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return lib.OUTCOME_NOOP;
  lib.emit({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: PERMISSION_DENY,
      permissionDecisionReason: DENY_REASON_TEMPLATE.split(PATH_PLACEHOLDER).join(relativePath),
    },
  });
  return lib.OUTCOME_OK;
}

/**
 * Entry point: read the payload, check the toggle, guard the write. Every path —
 * including thrown errors — logs exactly one invocation record (CODE_STANDARDS
 * ## Hooks) and exits 0 (fail safe, ADR-0006: a broken guard never blocks work).
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
      else outcome = guard(payload, projectRoot);
    }
  } catch {
    outcome = lib.OUTCOME_ERROR; // fail safe: a broken guard never blocks a write
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, HOOK_EVENT, outcome);
  process.exit(0);
}

main();
