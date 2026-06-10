#!/usr/bin/env node
'use strict';

// message-nudge — hook script for the message follow-through nudge feature
// (ADR-0006; default OFF). Plumbing slice: this script is wired in settings.json
// (PostToolUse on the teammate messaging tool, sender's session) and reads its
// toggle so enabling is a config flip, not a rewiring; the nudge behavior itself
// lands with EXEC-044 — until then the script no-ops even when enabled. FAIL SAFE:
// every path, including thrown errors, exits 0 with no output (PRD-007).

const lib = require('./hook-lib');

const FEATURE = 'message_nudge';

/**
 * Entry point: validate payload and toggle, then no-op (behavior lands with
 * EXEC-044). Every path exits 0 (fail safe, ADR-0006).
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
