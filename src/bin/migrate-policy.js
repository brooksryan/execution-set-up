'use strict';

// to-execution migrate-policy data — the record relocation the `migrate` verb applies
// (PRD-009, ADR-0008). Data only, no logic: cli.js owns the moving and the scan; this
// module owns which records belong in which home and the migration's identity, so the
// logic file reads as logic. Location only — migrate never rewrites content.
//
// Invariants this data must hold:
// - Basenames and dirs are Instance-root-relative, POSIX-separated; cli.js joins them.
// - RUNTIME_RECORD_BASENAMES are the hook- and machine-written records as of ADR-0008;
//   every other *_progress.json at the legacy base is an agent/gate Progress Record.
// - The two homes match the .excn/progress/ + .excn/runtime/ prefixes the stamp policy
//   classes as work-tracking (one contract, two modules).

// Hook- and machine-written records relocate to the Runtime home; every other
// *_progress.json at the legacy base is an agent/gate Progress Record (Progress home).
const RUNTIME_RECORD_BASENAMES = [
  'hook-invocations_progress.json',
  'gate-watch_progress.json',
  'viewer-server_progress.json',
  'load_progress.json',
];

// The two homes records relocate into (ADR-0008), Instance-root-relative.
const PROGRESS_HOME = '.excn/progress';
const RUNTIME_HOME = '.excn/runtime';

// The legacy flat layout: records piled up directly under .excn before ADR-0008.
// migrate scans this directory's top level (never the homes beneath it); doctor counts
// what remains here to detect the legacy layout and point at migrate.
const LEGACY_RECORD_DIR = '.excn';

// Identity of this relocation, surfaced in migrate's report. Versioned so a later
// migration is a new id rather than a silent change to this one.
const MIGRATION_ID = 'adr-0008-progress-runtime-split';

module.exports = {
  RUNTIME_RECORD_BASENAMES,
  PROGRESS_HOME,
  RUNTIME_HOME,
  LEGACY_RECORD_DIR,
  MIGRATION_ID,
};
