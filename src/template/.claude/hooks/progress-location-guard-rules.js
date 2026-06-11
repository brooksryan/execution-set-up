'use strict';

// progress-location-guard-rules — data for progress-location-guard.js (EXEC-070,
// ADR-0008). The Record suffix that marks a path as a Progress/Runtime Record, the
// two sanctioned homes, and the deny reason surfaced to the model. Data only, no
// logic: the guard owns the decision; this module owns the vocabulary, so phrasing
// and home changes never touch the decision code.

// A path ending in this suffix is a Progress or Runtime Record (ADR-0005 ignore
// class). Only these are location-guarded — every other write passes untouched.
const RECORD_SUFFIX = '_progress.json';

// The two sanctioned Record homes (ADR-0008): agent- and gate-written Progress
// Records under the first, hook- and machine-written Runtime Records under the
// second. A Record whose root-relative path starts with neither is misfiled.
const RECORD_HOME_PREFIXES = ['.excn/progress/', '.excn/runtime/'];

// The deny reason the model sees (PreToolUse permissionDecisionReason doubles as an
// instruction — research §3 — so it redirects rather than dead-ends). PATH_PLACEHOLDER
// is the misfiled path; the reason names both homes and the writer-class rule so the
// writer picks the right one. Location only: schema and content stay the gates' job.
const PATH_PLACEHOLDER = '{path}';
const DENY_REASON_TEMPLATE =
  `Writing the Record "${PATH_PLACEHOLDER}" here is blocked: *${RECORD_SUFFIX} Records live in one of ` +
  'two homes (ADR-0008). Agent- and gate-written Progress Records go under .excn/progress/; hook- and ' +
  'machine-written Runtime Records go under .excn/runtime/. Re-issue the write to the right home — ' +
  'this guard checks location only; schema and content stay the gates\' job.';

module.exports = { RECORD_SUFFIX, RECORD_HOME_PREFIXES, PATH_PLACEHOLDER, DENY_REASON_TEMPLATE };
