'use strict';

// grounding-pack-watch-rules — data for grounding-pack-watch.cjs (sprint-11 S4, the
// feature-flagged Grounding Pack staleness hook; ADR speculative-prewarm-runtime-staging).
// Data only, no logic: the hook owns the staleness decision, the regenerator call, and the
// state write; this module owns the tunable vocabulary — which on-disk artifacts are the pack's
// SOURCES, how the regenerator is located in the installed package, the hash parameters, and the
// edit-tool set — so a source-set or binding change never touches the decision code.
//
// Invariants this data must hold:
// - The regenerator is the S2 module shipped in the installed `to-execution` package's bin/. The
//   hook resolves REGENERATOR_MODULE_SPECIFIER against the Instance and calls REGENERATOR_EXPORT
//   IN ITS OWN PROCESS (never via a Claude Write tool — that would re-trigger PostToolUse). An
//   Instance whose installed package predates S2 cannot resolve the specifier; the hook fail-safes
//   (ADR-0006) rather than acting — the documented dogfood case (to-execution@0.8.0 has no regenerator).
// - The SOURCE set mirrors what the regenerator derives from: every schema under .excn/schemas/,
//   .excn/CONTEXT.md, and every ADR under .excn/adr/. A source whose mtime is >= the pack's mtime
//   (>=, not > — equal-quantum timestamps on coarse filesystems are stale, prior-art G2) makes the
//   pack stale; a content-hash of CONTEXT.md + the ADR files is the clock-rollback / coarse-mtime
//   fallback (G2) when mtime alone would miss a real edit.

// How the hook locates the S2 regenerator inside the installed package, and the export it calls.
// The hook require.resolve's this against the Instance root; a pre-S2 package fails to resolve it.
const REGENERATOR_MODULE_SPECIFIER = 'to-execution/bin/grounding-pack.js';
const REGENERATOR_EXPORT = 'regenerateGroundingPack';

// The source-file extensions whose presence under the schema / ADR dirs feeds staleness.
const SCHEMA_FILE_EXTENSION = '.json';
const ADR_FILE_EXTENSION = '.md';

// The file-editing tools whose PostToolUse firings warrant a staleness check; the settings matcher
// filters to these, and this re-check guards against a miswiring (mirrors the sibling guards).
const EDIT_TOOL_NAMES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

// Content-hash parameters for the clock-rollback / coarse-mtime fallback (G2). The hash digests
// CONTEXT.md + the ADR files; a mismatch against the last recorded digest forces a regenerate even
// when every mtime reads fresh.
const HASH_ALGORITHM = 'sha256';
const HASH_ENCODING = 'hex';

// Shape version of this hook's own state Record (the recorded source digest under .excn/runtime/).
const STATE_SCHEMA_VERSION = '1.0';

module.exports = {
  REGENERATOR_MODULE_SPECIFIER,
  REGENERATOR_EXPORT,
  SCHEMA_FILE_EXTENSION,
  ADR_FILE_EXTENSION,
  EDIT_TOOL_NAMES,
  HASH_ALGORITHM,
  HASH_ENCODING,
  STATE_SCHEMA_VERSION,
};
