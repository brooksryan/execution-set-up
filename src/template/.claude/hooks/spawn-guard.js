#!/usr/bin/env node
'use strict';

// spawn-guard — the spawn_guard hook feature (EXEC-064, ADR-0006 toggle plumbing;
// default OFF). Wired in settings.json as PreToolUse on the one-shot agent-spawn
// tool. When the toggle is on and the requested agent type is in the Instance's
// configured persistent-Teammate list (hooks.config.json, variant-classed per
// Instance), it denies the spawn with a reason citing the TEAM_DIRECTIVE routing
// rule; every other spawn passes untouched (exit 0, no output). Every firing logs
// one invocation record via hook-lib (CODE_STANDARDS ## Hooks) — outcome semantics:
// a deny emitted is `ok` (the enabled guard acted), a pass-through is `noop`, a
// missing/malformed persistent-types list is `noop` (nothing to guard against).
// FAIL SAFE: missing/malformed config or payload, or any internal error, exits 0
// with no output (ADR-0006) — a broken guard never blocks legitimate spawns.

const path = require('path');
const lib = require('./hook-lib');
const { AGENT_TYPE_KEYS, TYPE_PLACEHOLDER, DENY_REASON_TEMPLATE } = require('./spawn-guard-rules');

const FEATURE = 'spawn_guard';

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the
// event matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'PreToolUse';

// The PreToolUse decision vocabulary this guard emits (research
// .excn/research/teammate-hook-triggers.md §3.1, [empirical]).
const PERMISSION_DENY = 'deny';

// Top-level hooks.config.json key carrying the Instance's rostered
// persistent-Teammate types (per-Instance roster, so it lives in the
// variant-classed config beside the toggle, not in stamped code).
const PERSISTENT_TYPES_KEY = 'spawn_guard_persistent_types';

/**
 * Read the Instance's configured persistent-Teammate type list.
 * @param {string} projectRoot - the Instance root.
 * @returns {string[]} the configured types; empty when the config or list is
 * missing/malformed (fail safe — an unconfigured guard denies nothing).
 */
function persistentTypes(projectRoot) {
  const config = lib.readJsonSafe(path.join(projectRoot, lib.CONFIG_RELATIVE_PATH));
  const list = config && config[PERSISTENT_TYPES_KEY];
  return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : [];
}

/**
 * Pull the requested agent type from a spawn payload's tool_input.
 * @param {object} payload - the PreToolUse hook payload.
 * @returns {string|null} the requested type, or null when no candidate key carries
 * one (treated as not-a-guarded-spawn — pass).
 */
function requestedType(payload) {
  const toolInput = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  for (const key of AGENT_TYPE_KEYS) {
    if (typeof toolInput[key] === 'string' && toolInput[key] !== '') return toolInput[key];
  }
  return null;
}

/**
 * Decide this spawn: deny a configured persistent-Teammate type with the routing
 * reason, pass everything else.
 * @param {object} payload - the PreToolUse hook payload.
 * @param {string} projectRoot - the Instance root.
 * @returns {string} an invocation-log outcome: OUTCOME_OK when the deny was
 * emitted, OUTCOME_NOOP when the spawn passed (not a guarded type, or no list).
 */
function guard(payload, projectRoot) {
  const type = requestedType(payload);
  if (type === null || !persistentTypes(projectRoot).includes(type)) return lib.OUTCOME_NOOP;
  lib.emit({
    hookSpecificOutput: {
      hookEventName: HOOK_EVENT,
      permissionDecision: PERMISSION_DENY,
      permissionDecisionReason: DENY_REASON_TEMPLATE.split(TYPE_PLACEHOLDER).join(type),
    },
  });
  return lib.OUTCOME_OK;
}

/**
 * Entry point: read the payload, check the toggle, guard the spawn. Every path —
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
    outcome = lib.OUTCOME_ERROR; // fail safe: a broken guard never blocks spawns
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, HOOK_EVENT, outcome);
  process.exit(0);
}

main();
