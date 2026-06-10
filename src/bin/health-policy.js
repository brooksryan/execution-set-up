'use strict';

// to-execution health-policy data — what the `doctor` verb checks (PRD-007 health
// check, EXEC-050). Data only, no logic: cli.js owns the checking; this module owns
// which hook features exist, where their wiring and firing evidence live, and the
// freshness threshold that separates "firing" from "stale".
//
// Invariants this data must hold:
// - Paths are Instance-root-relative, POSIX-separated.
// - `key` matches the feature's toggle key in .excn/hooks.config.json (and the
//   hooks-config schema's required feature list).
// - `scripts` are the basenames the stamped .claude/settings.json commands invoke;
//   doctor calls a feature broken (disarmed) when a script is unwired or missing.
// - `evidence` is the *_progress.json heartbeat the feature writes when it fires,
//   or null for stateless features that leave no firing trace (wired+enabled is the
//   strongest claim doctor can make for those).

// The stamped hook features, in report order.
const HOOK_FEATURES = [
  {
    key: 'gate_reminders',
    scripts: ['gate-watch.js'],
    evidence: '.excn/gate-watch_progress.json',
  },
  {
    key: 'message_nudge',
    scripts: ['message-nudge.js'],
    evidence: null,
  },
  {
    key: 'load_reporting',
    scripts: ['load-report.js'],
    evidence: '.excn/load_progress.json',
  },
];

// Where the stamped hook wiring and toggle config live in an Instance.
const SETTINGS_PATH = '.claude/settings.json';
const HOOKS_DIR = '.claude/hooks';
const HOOKS_CONFIG_PATH = '.excn/hooks.config.json';
const HOOKS_CONFIG_SCHEMA_PATH = '.excn/schemas/hooks-config.schema.json';

// Evidence newer than this counts as firing; an enabled feature whose heartbeat is
// older (or absent) reads as stale. One day covers a normal working cadence without
// flagging overnight gaps.
const HEARTBEAT_FRESH_MS = 24 * 60 * 60 * 1000;

module.exports = {
  HOOK_FEATURES,
  SETTINGS_PATH,
  HOOKS_DIR,
  HOOKS_CONFIG_PATH,
  HOOKS_CONFIG_SCHEMA_PATH,
  HEARTBEAT_FRESH_MS,
};
