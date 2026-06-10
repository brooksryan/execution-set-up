'use strict';

// to-execution stamp-policy data — classifies stamped paths for the update path
// (PRD-007 "Update path" decision). Data only, no logic: cli.js owns stamping and
// updating; this module owns which files the update command may touch and where
// the version marker lives, so the logic file reads as logic.
//
// Invariants this data must hold:
// - Paths are stamped-destination relative paths (after the gitignore rename),
//   POSIX-separated; cli.js normalizes before matching.
// - VARIANT_FILES are the Setup Grill's project-specific outputs (and teammate
//   defs): seeded by init, owned by the Instance afterward — update never writes them.
// - WORK_TRACKING_DIR_PREFIXES cover the Instance's work-tracking state; anything
//   under them (including the template's backlog seed) is update-untouchable.
// - VERSION_MARKER_PATH must stay outside every ignore rule in the stamped
//   .excn/.gitignore so the marker survives being committed.

// Grill-output / teammate-definition / per-Instance-state files: stamped once as
// seeds, never updated. hooks.config.json is here because its toggles are
// per-Instance state (EXEC-052): update neither overwrites nor drift-reports it.
// A hash recorded for it by an older stamp simply drops out of the marker on the
// next update — the marker rewrite carries forward invariant hashes only.
const VARIANT_FILES = [
  '.excn/CONTEXT.md',
  '.excn/PHILOSOPHY.md',
  '.excn/TEAM_DIRECTIVE.md',
  '.excn/hooks.config.json',
  '.claude/agents/scribe.md',
];

// Work-tracking state roots: everything beneath them belongs to the Instance.
const WORK_TRACKING_DIR_PREFIXES = [
  '.excn/issues/',
  '.excn/sprints/',
  '.excn/prds/',
  '.excn/retros/',
];

// Per-session progress state matches by suffix wherever it lives (mirrors the
// stamped .gitignore's *_progress.json class).
const PROGRESS_FILE_SUFFIX = '_progress.json';

// Where init records the stamping framework version and the stamped-form hashes
// of invariant files; update reads it for drift detection and rewrites it.
const VERSION_MARKER_PATH = '.excn/framework-version.json';

// Shape version of the marker file itself, independent of the framework version.
const MARKER_SCHEMA_VERSION = '1.0';

module.exports = {
  VARIANT_FILES,
  WORK_TRACKING_DIR_PREFIXES,
  PROGRESS_FILE_SUFFIX,
  VERSION_MARKER_PATH,
  MARKER_SCHEMA_VERSION,
};
