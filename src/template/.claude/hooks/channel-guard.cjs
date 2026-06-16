#!/usr/bin/env node
'use strict';

// channel-guard — the channel_guard hook feature (EXEC-100, PRD-011, ADR-0011; default
// OFF). Wired in settings.json as PreToolUse on the file-editing tools. When the toggle is
// on and a write targets a path under one of the two guarded homes (.excn/issues/,
// .excn/sprints/), it denies the write with a reason that redirects to the to-execution CLI;
// every other write passes untouched (exit 0, no output). Channel only — it asks solely "is
// this a raw Write/Edit into a guarded home?", never anything about uuids, shape, or schema
// (the writeRecord helper guarantees format by construction, so the hook needs no content
// logic). The helper writes via fs, not the agent Write tool, so its own writes are never
// seen here — only agent Write/Edit tool calls reach a PreToolUse hook. Every firing logs
// one invocation record via hook-lib (CODE_STANDARDS ## Hooks): a deny emitted is `ok`, a
// pass-through is `noop`. FAIL SAFE: a missing/malformed config or payload, or any internal
// error, exits 0 with no output (ADR-0006) — a broken guard never blocks a legitimate write.

const path = require('path');
const lib = require('./hook-lib.cjs');
const {
  GUARDED_HOME_PREFIXES,
  PATH_PLACEHOLDER,
  DENY_REASON_TEMPLATE,
} = require('./channel-guard-rules.cjs');

const FEATURE = 'channel_guard';

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the event
// matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'PreToolUse';

// The PreToolUse decision vocabulary this guard emits.
const PERMISSION_DENY = 'deny';

// The file-editing tools whose tool_input carries a file_path worth channel-checking; the
// settings matcher filters to these, this re-check guards against a miswiring.
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Resolve the write's target to an Instance-root-relative, forward-slash path.
 * @param {string} projectRoot - the Instance root (payload cwd).
 * @param {string} filePath - the tool_input file path (absolute or relative).
 * @returns {string|null} the root-relative path, or null when the write lies outside the
 * Instance (never a guarded home).
 */
function rootRelative(projectRoot, filePath) {
  const relative = path.relative(projectRoot, path.resolve(projectRoot, filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/**
 * Decide this write: deny a raw Write/Edit whose target lies under a guarded home, pass
 * everything else.
 * @param {object} payload - the PreToolUse hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when the deny was emitted,
 * OUTCOME_NOOP when the write passed (not an editing tool, no path, outside the Instance, or
 * not under a guarded home).
 */
function guard(payload, projectRoot) {
  if (!EDIT_TOOLS.has(payload.tool_name)) return lib.OUTCOME_NOOP;
  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (typeof filePath !== 'string' || filePath === '') return lib.OUTCOME_NOOP;
  const relativePath = rootRelative(projectRoot, filePath);
  if (relativePath === null) return lib.OUTCOME_NOOP;
  if (!GUARDED_HOME_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return lib.OUTCOME_NOOP;
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
 * Entry point: read the payload, check the toggle, guard the write. Every path — including
 * thrown errors — logs exactly one invocation record (CODE_STANDARDS ## Hooks) and exits 0
 * (fail safe, ADR-0006: a broken guard never blocks work).
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
