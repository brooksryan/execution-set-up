#!/usr/bin/env node
'use strict';

// load-report — hook script for the per-Teammate load-reporting feature (ADR-0006;
// default OFF). Plumbing slice: wired in settings.json (PostToolUse, all tools) and
// reads its toggle so enabling is a config flip, not a rewiring; the record append
// to .excn/load_progress.json and its schema land with EXEC-045 — until then the
// script no-ops even when enabled. FAIL SAFE: every path, including thrown errors,
// exits 0 with no output (PRD-007).

const lib = require('./hook-lib');

const FEATURE = 'load_reporting';

/**
 * Entry point: validate payload and toggle, then no-op (behavior lands with
 * EXEC-045). Every path exits 0 (fail safe, ADR-0006).
 * @returns {void}
 */
function main() {
  try {
    const payload = lib.readPayload();
    if (!payload) process.exit(0);
    const projectRoot = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
    if (!lib.featureEnabled(projectRoot, FEATURE)) process.exit(0);
    process.exit(0);
  } catch {
    process.exit(0); // fail safe: a broken hook never blocks work
  }
}

main();
