'use strict';

// to-execution grounding-policy data — the constants the Grounding Pack regenerator
// (grounding-pack.js) and the `warm` CLI verb consume (PRD speculative-prewarm, sprint-11
// S2; ADR speculative-prewarm-runtime-staging). Data only, no logic: grounding-pack.js owns
// reading the on-disk sources, deriving each section, sorting, and the atomic write; cli.js
// owns the `warm` argv handling and the stamped-target guard; this module owns the named
// paths, the markdown/frontmatter parse tokens, the pack's key vocabulary, and the verb list,
// so the regenerator reads as logic over named data rather than literals (named-constants standard).
//
// Invariants this data must hold:
// - Paths are Instance-root-relative, POSIX-separated; grounding-pack.js joins them onto the
//   target root (the schema dir is sourced from validate-policy's SCHEMA_DIR_RELATIVE, the one
//   place it is declared).
// - The pack at GROUNDING_PACK_RELATIVE_PATH is machine-written runtime state under
//   .excn/runtime/ (ADR-0008): gitignored, never authoritative, and carrying NO schema and NO
//   _progress.json suffix — the regenerator is its SOLE writer.
// - SCAFFOLDER_VERBS MIRRORS the dispatch switch in cli.js main(). It is maintained here, not
//   imported, to avoid a cli.js ↔ grounding-pack.js require cycle (cli.js requires the
//   regenerator). The issue-create flag NAMES are NOT duplicated — grounding-pack.js reads them
//   from write-policy's ISSUE_FIELD_FLAGS, their canonical home. Keep this list in step with main().
// - The markdown/frontmatter tokens describe the documented shapes the regenerator parses: a
//   CONTEXT.md `## Glossary` section whose `### ` headings are the terms, and an ADR `*.md`
//   carrying optional `id:`/`status:` frontmatter and a leading `# ` H1 title.

// ── pack location and identity ──────────────────────────────────────────────────

// The Grounding Pack's home — a Runtime Record under .excn/runtime/ (ADR-0008). The regenerator
// mkdir -p's the parent and atomically overwrites this file; nothing else writes it.
const GROUNDING_PACK_RELATIVE_PATH = '.excn/runtime/grounding-pack.json';

// Structure version of the pack itself (independent of the framework version). Bumped only
// when the pack's shape changes, so a reader can refuse a layout it does not understand.
const PACK_VERSION = '1';

// How many fresh UUIDv7 the pack pre-mints. The pool is the one non-deterministic section
// (time + randomness), so a synthesis step can pull a ready id without a fresh `uuid` call.
const UUID_POOL_SIZE = 16;

// ── source locations (Instance-root-relative, POSIX) ────────────────────────────

const CONTEXT_RELATIVE_PATH = '.excn/CONTEXT.md';
const ADR_DIR_RELATIVE = '.excn/adr';

// ── source file extensions ──────────────────────────────────────────────────────

const SCHEMA_FILE_EXTENSION = '.json';
const ADR_FILE_EXTENSION = '.md';

// ── CONTEXT.md glossary parse tokens ────────────────────────────────────────────

// The glossary lives under this exact `## ` section; its `### ` headings are the terms,
// collected until the next `## ` section begins. A `### ` line is NOT a `## ` section (its
// third character is `#`, not a space), so the section test never mis-claims a term line.
const GLOSSARY_HEADING = '## Glossary';
const SECTION_HEADING_PREFIX = '## ';
const TERM_HEADING_PREFIX = '### ';

// An ADR's title is its first level-1 (`# `) heading. `## `/`### ` lines fail this prefix test
// (their second character is `#`, not a space), so a subsection is never read as the title.
const H1_HEADING_PREFIX = '# ';

// ── ADR frontmatter parse tokens ────────────────────────────────────────────────

// Frontmatter is the `key: value` block fenced by a leading and a trailing `---` line. The
// regenerator reads `id:` (falling back to the filename stem when absent — the documented rule)
// and `status:` (falling back to ADR_STATUS_FALLBACK when absent).
const FRONTMATTER_FENCE = '---';
const FRONTMATTER_KV_SEPARATOR = ':';
const FRONTMATTER_ID_KEY = 'id';
const FRONTMATTER_STATUS_KEY = 'status';
const ADR_STATUS_FALLBACK = 'unrecorded';

// ── schema digest derivation ────────────────────────────────────────────────────

// The schema property whose type the digest records PER SCHEMA — the exact `notes must be an
// array` fix-loop the pack exists to kill (retro footgun #4). Derived by finding this property
// wherever it sits in each schema; never hand-encoded.
const NOTES_PROPERTY_NAME = 'notes';

// ── pack key vocabulary ─────────────────────────────────────────────────────────

// Top-level pack section keys. UUID_POOL is the lone non-deterministic section: the determinism
// guarantee (byte-identical derived content across regenerations) covers every OTHER key, so a
// determinism check compares the pack with this key stripped.
const PACK_KEY = {
  VERSION: 'pack_version',
  CLI_STAMP: 'cli_stamp',
  SCHEMA_DIGEST: 'schema_digest',
  GLOSSARY_TERMS: 'glossary_terms',
  ADR_INDEX: 'adr_index',
  UUID_POOL: 'uuid_pool',
};

// cli_stamp sub-keys: the dispatchable verbs and the issue-create flag names a synthesis step
// echoes back instead of re-deriving from the CLI.
const CLI_STAMP_KEY = {
  VERBS: 'verbs',
  ISSUE_CREATE_FLAGS: 'issue_create_flags',
};

// One adr_index entry's keys.
const ADR_ENTRY_KEY = {
  ID: 'id',
  TITLE: 'title',
  STATUS: 'status',
};

// A notes-type descriptor's keys: the schema's `type` for the notes field, plus the item type
// when that `type` is an array (so prd's array-of-string is distinguishable from a null union).
const NOTES_DESCRIPTOR_KEY = {
  TYPE: 'type',
  ITEMS: 'items',
};

// The schema keywords the digest reads off a located notes subschema.
const SCHEMA_TYPE_KEYWORD = 'type';
const SCHEMA_ITEMS_KEYWORD = 'items';
const SCHEMA_PROPERTIES_KEYWORD = 'properties';
const SCHEMA_ARRAY_TYPE = 'array';

// ── the dispatchable verbs (mirror of cli.js main() — see invariant) ────────────

const SCAFFOLDER_VERBS = [
  'init',
  'update',
  'migrate',
  'migrate-records',
  'doctor',
  'view-status',
  'validate',
  'issue',
  'sprint',
  'uuid',
  'warm',
];

// ── serialization ───────────────────────────────────────────────────────────────

// Two-space indent and a trailing newline match the record/version-marker idiom across the bin.
// The pack lands on a temp twin carrying PACK_TEMP_SUFFIX before its atomic rename.
const SERIALIZATION_INDENT = 2;
const TRAILING_NEWLINE = '\n';
const PACK_TEMP_SUFFIX = '.tmp';

module.exports = {
  GROUNDING_PACK_RELATIVE_PATH,
  PACK_VERSION,
  UUID_POOL_SIZE,
  CONTEXT_RELATIVE_PATH,
  ADR_DIR_RELATIVE,
  SCHEMA_FILE_EXTENSION,
  ADR_FILE_EXTENSION,
  GLOSSARY_HEADING,
  SECTION_HEADING_PREFIX,
  TERM_HEADING_PREFIX,
  H1_HEADING_PREFIX,
  FRONTMATTER_FENCE,
  FRONTMATTER_KV_SEPARATOR,
  FRONTMATTER_ID_KEY,
  FRONTMATTER_STATUS_KEY,
  ADR_STATUS_FALLBACK,
  NOTES_PROPERTY_NAME,
  PACK_KEY,
  CLI_STAMP_KEY,
  ADR_ENTRY_KEY,
  NOTES_DESCRIPTOR_KEY,
  SCHEMA_TYPE_KEYWORD,
  SCHEMA_ITEMS_KEYWORD,
  SCHEMA_PROPERTIES_KEYWORD,
  SCHEMA_ARRAY_TYPE,
  SCAFFOLDER_VERBS,
  SERIALIZATION_INDENT,
  TRAILING_NEWLINE,
  PACK_TEMP_SUFFIX,
};
