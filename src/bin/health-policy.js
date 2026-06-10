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
// - Heartbeats come from the unified invocation log (INVOCATION_LOG_PATH; every
//   wired hook appends a {ts, script, event, outcome} record per CODE_STANDARDS
//   ## Hooks): a feature's latest record across its `scripts` is its heartbeat.
// - `evidence` is the feature's own *_progress.json state file, kept as the
//   fallback heartbeat for Instances stamped before the invocation log existed;
//   null when the feature writes none.
// - `spawnedScripts` (optional) are scripts the feature's hook spawns itself rather
//   than settings invoking them — checked for disk presence only, never for wiring.
// - `liveness` (optional) marks a feature whose evidence is a live-process discovery
//   record ({port, pid, repo}) judged by pid/port probing, not heartbeat age.

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
  {
    key: 'viewer_server',
    scripts: ['viewer-server.js'],
    spawnedScripts: ['viewer-server-daemon.js'],
    evidence: '.excn/viewer-server_progress.json',
    liveness: true,
  },
  {
    key: 'spawn_guard',
    scripts: ['spawn-guard.js'],
    evidence: null,
  },
];

// The unified hook invocation log (CODE_STANDARDS ## Hooks) — doctor's primary
// heartbeat source; mirrors INVOCATION_LOG_RELATIVE_PATH in the stamped hook-lib.js
// (one contract, two packages).
const INVOCATION_LOG_PATH = '.excn/hook-invocations_progress.json';

// How doctor probes a viewer_server discovery record: the daemon's loopback health
// endpoint (it echoes {repo, pid, version}), with a short budget so a wedged
// listener reads as unreachable instead of hanging the report.
const VIEWER_HEALTH_HOST = '127.0.0.1';
const VIEWER_HEALTH_PATH = '/__viewer-server';
const VIEWER_PROBE_TIMEOUT_MS = 500;
// The only status the daemon's health endpoint answers with on success — mirrors
// HTTP_OK in the stamped viewer-server-rules.js (one contract, two packages).
const VIEWER_HEALTH_OK_STATUS = 200;

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
  INVOCATION_LOG_PATH,
  SETTINGS_PATH,
  HOOKS_DIR,
  HOOKS_CONFIG_PATH,
  HOOKS_CONFIG_SCHEMA_PATH,
  HEARTBEAT_FRESH_MS,
  VIEWER_HEALTH_HOST,
  VIEWER_HEALTH_PATH,
  VIEWER_PROBE_TIMEOUT_MS,
  VIEWER_HEALTH_OK_STATUS,
};
