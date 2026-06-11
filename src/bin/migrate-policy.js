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

// --- EXEC-076: the .cjs hook-layout migration -----------------------------------
// Hooks ship as CommonJS. An Instance stamped before EXEC-075 carries them as `.js`;
// a host package.json with "type":"module" then makes Node load them as ESM and every
// hook throws `require is not defined`. This migration renames each stamped hook/rules
// file from .js to .cjs and fixes the now-stale sibling references so Node loads them
// as CommonJS again. cli.js owns the file moving, the marker-hash safety check, and the
// settings rewrite; this module owns the identity and the reference-rewrite rules.
//
// Invariants this data must hold:
// - HOOK_DIR / HOOK_SETTINGS_FILE are Instance-root-relative, POSIX-separated; cli.js
//   joins them. They mirror HOOKS_DIR / SETTINGS_PATH in health-policy (one contract).
// - Each rewrite is a {pattern, replacement} pair fed to `new RegExp(pattern, 'g')`
//   and String.replace; replacement uses $1/$2 backrefs. Every pattern is idempotent —
//   a reference that already carries a .cjs extension no longer matches, so a second
//   run rewrites nothing.
const HOOK_DIR = '.claude/hooks';
const HOOK_SETTINGS_FILE = '.claude/settings.json';

// The extension a migrated hook lands on — CommonJS, so Node loads it as CJS even
// under a host package.json with "type":"module". The migration's target side; the
// legacy source side is health-policy's LEGACY_HOOK_EXTENSION.
const CJS_HOOK_EXTENSION = '.cjs';

// Identity of the hook-layout migration, surfaced in migrate's report. Versioned
// alongside MIGRATION_ID so the two relocations report independently.
const HOOK_CJS_MIGRATION_ID = 'exec-076-cjs-hook-layout';

// Rewrites applied to a hook's text when it is renamed .js → .cjs:
// 1. an extensionless relative require of a sibling module resolves only to .js under
//    CommonJS, so it must name the new extension: require('./hook-lib') →
//    require('./hook-lib.cjs').
// 2. a sibling script path built for spawning (the viewer hook launches its daemon):
//    path.join(__dirname, 'viewer-server-daemon.js') → '…-daemon.cjs'.
const HOOK_CONTENT_REWRITES = [
  { pattern: String.raw`require\((['"])\.\/([\w-]+)\1\)`, replacement: 'require($1./$2.cjs$1)' },
  { pattern: String.raw`(__dirname,\s*['"])([\w-]+)\.js(['"])`, replacement: '$1$2.cjs$3' },
];

// Rewrite applied to settings.json: every stamped hook command points node at a
// .claude/hooks/<name>.js path; the migration repoints it at the .cjs file. Surgical
// (only the hook-path substring moves), so an Instance's other settings are untouched.
const HOOK_COMMAND_REWRITE = {
  pattern: String.raw`(\.claude/hooks/[\w-]+)\.js`,
  replacement: '$1.cjs',
};

module.exports = {
  RUNTIME_RECORD_BASENAMES,
  PROGRESS_HOME,
  RUNTIME_HOME,
  LEGACY_RECORD_DIR,
  MIGRATION_ID,
  HOOK_DIR,
  HOOK_SETTINGS_FILE,
  CJS_HOOK_EXTENSION,
  HOOK_CJS_MIGRATION_ID,
  HOOK_CONTENT_REWRITES,
  HOOK_COMMAND_REWRITE,
};
