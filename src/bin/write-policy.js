'use strict';

// to-execution write-policy data — the constants the writeRecord helper (write-record.js)
// and the `issue` / `sprint` CLI surfaces consume (EXEC-097/098/099, PRD-011, ADR-0011).
// Data only, no logic: write-record.js owns minting, slug derivation, validation, canonical
// serialization, and the atomic write; cli.js owns argv parsing and reporting; this module
// owns the lookup tables and named rules those two read, so the policy reads as a table
// rather than literals scattered through logic (the named-constants standard).
//
// Invariants this data must hold:
// - RECORD_KINDS is the kind registry: each entry names where its files live (dirRelative,
//   Instance-root-relative, POSIX-separated) and which schema in the package template
//   validates it. A kind absent here is unwritable — the helper rejects it.
// - UUIDV7_PATTERN matches the canonical hyphenated form of an RFC 9562 UUIDv7. The widened
//   id/prd patterns in the issue and PRD schemas embed this same branch as a JSON-Schema
//   string; keep the two in sync when either moves.
// - Issue slug rules are frozen at create (the filename never moves; references key off the
//   id), so a record's title may later drift in-content without renaming its file.
// - SPRINT_KEY_ORDER + SPRINT_SENTINEL_KEY define the canonical-sentinel byte-layout: every
//   non-sentinel key in declared order (accreting arrays at the tail), then the constant
//   sentinel key dead-last. schema_version is the sentinel — its value is a fixed const, so
//   the object's final line never changes and a step_log append is a minimal, tail-only diff.

// The record kinds, as named discriminants (used in logic and as RECORD_KINDS keys).
const RECORD_KIND = { ISSUE: 'issue', SPRINT: 'sprint' };

// Record file naming. An issue basename is `<id>-<slug><RECORD_FILE_EXTENSION>`; a sprint
// file is `<SPRINT_FILE_PREFIX><N><RECORD_FILE_EXTENSION>`. A write lands on a temp twin
// carrying RECORD_TEMP_SUFFIX before its atomic rename (write-record.js writeAtomic).
const RECORD_FILE_EXTENSION = '.json';
const RECORD_TEMP_SUFFIX = '.tmp';
// Joins the id and the slug in an issue basename — distinct only conceptually from the
// in-slug separator; named so the basename grammar is explicit where it is assembled.
const RECORD_ID_SLUG_JOINER = '-';

// Instance-root-relative homes (POSIX). The issues home is the per-record tracker directory
// (ADR-0011); a sprint partition under it is `<ISSUE_PARTITION_PREFIX><N>/`. The sprints
// home holds one `sprint_<N>.json` per sprint.
const ISSUES_DIR_RELATIVE = '.excn/issues';
const SPRINTS_DIR_RELATIVE = '.excn/sprints';
const ISSUE_PARTITION_PREFIX = 'sprint-'; // issues/sprint-<N>/ (hyphen) — lifecycle partition
const SPRINT_FILE_PREFIX = 'sprint_'; // sprints/sprint_<N>.json (underscore) — sprint record

// Canonical RFC 9562 UUIDv7: 8-4-4-4-12 lowercase hex, version nibble 7, variant 10xx. The
// helper asserts a freshly minted id against this (fail-closed); the schemas embed the same
// branch as their widened pattern.
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Issue slug derivation (write-record.js deriveSlug). Lowercase, collapse every run of
// non-alphanumerics to one separator, trim edge separators, truncate to SLUG_MAX_LENGTH,
// then re-trim a separator the cut may have exposed.
const SLUG_SEPARATOR = '-';
const SLUG_MAX_LENGTH = 60;
const SLUG_DISALLOWED_RUN = /[^a-z0-9]+/g;
const SLUG_EDGE_SEPARATORS = /^-+|-+$/g;

// The kind registry. dirRelative is the kind's home; schema is its per-record schema
// basename under the package template schema dir; defaults fill the schema-required fields a
// bare `issue create --title X` omits, so the minimal create still validates.
const RECORD_KINDS = {
  [RECORD_KIND.ISSUE]: {
    dirRelative: ISSUES_DIR_RELATIVE,
    schema: 'issue-record.schema.json',
    titleField: 'title',
    defaults: {
      status: 'open',
      severity: 'P3',
      scope: ['unspecified'],
      actionable_now: false,
      description: '',
    },
  },
  [RECORD_KIND.SPRINT]: {
    dirRelative: SPRINTS_DIR_RELATIVE,
    schema: 'sprint.schema.json',
  },
};

// The immutable, self-minted id field of an issue (rejected from a create payload and from
// an update's changes — ADR-0011).
const RECORD_ID_FIELD = 'id';

// Legacy monolith layout the one-time migrate-records command splits (EXEC-102). The open
// backlog collection at the issues-home root, and per partition a `sprint-<N>-issues.json`
// companion ({schema_version, issues:[]} wrapper, ISSUE_COLLECTION_FIELD). The patterns
// extract N from a partition dir (`sprint-<N>`) and a sprint record file (`sprint_<N>.json`).
const ISSUE_COLLECTION_FIELD = 'issues';
const LEGACY_BACKLOG_BASENAME = 'backlog.json';
const LEGACY_SPRINT_ISSUES_SUFFIX = '-issues.json';
const PARTITION_DIR_PATTERN = /^sprint-(\d+)$/;
const SPRINT_FILE_PATTERN = /^sprint_(\d+)\.json$/;

// Sprint record fields the helper keys on: the integer identity, its schema minimum, and the
// accreting ledger an append targets.
const SPRINT_ID_FIELD = 'sprint_id';
const SPRINT_ID_MIN = 1;
const SPRINT_STEP_LOG_FIELD = 'step_log';
const ISSUE_ASSIGNED_SPRINT_FIELD = 'assigned_sprint';

// Canonical-sentinel byte-layout for a sprint record. Every non-sentinel key is emitted in
// this order — scalars/objects first, the accreting arrays (the trailing seven, step_log
// last) at the tail — then SPRINT_SENTINEL_KEY is written dead-last. schema_version is the
// sentinel because its value is a fixed constant: the object's final line is therefore
// invariant, so a step_log append touches only the ledger region, never the file's tail.
const SPRINT_KEY_ORDER = [
  'sprint_id',
  'name',
  'status',
  'dates',
  'team',
  'goal',
  'issues_addressed',
  'shipped',
  'in_progress',
  'not_shipped',
  'defects_discovered',
  'decisions',
  'retrospective_notes',
  'step_log',
];
const SPRINT_SENTINEL_KEY = 'schema_version';

// How a flag's value is read. STRING takes the next arg verbatim; INTEGER parses it as an
// integer; LIST splits the next arg on LIST_VALUE_SEPARATOR; BOOLEAN is a presence flag
// (no value, sets true); NULL is a presence flag that sets its field to null (e.g. moving an
// issue back to the backlog). Named so the parser branches on constants, not bare strings.
const FLAG_TYPE = { STRING: 'string', INTEGER: 'integer', LIST: 'list', BOOLEAN: 'boolean', NULL: 'null' };

// Issue field-flag table shared by `issue create` and `issue update`: each flag maps to the
// record field it sets and how its value is read (FLAG_TYPE). There is deliberately no id
// flag — the id is self-minted and immutable. Enum/shape validation is the schema's job.
const ISSUE_FIELD_FLAGS = {
  '--title': { field: 'title', type: FLAG_TYPE.STRING },
  '--description': { field: 'description', type: FLAG_TYPE.STRING },
  '--status': { field: 'status', type: FLAG_TYPE.STRING },
  '--severity': { field: 'severity', type: FLAG_TYPE.STRING },
  '--classification': { field: 'classification', type: FLAG_TYPE.STRING },
  '--slice-type': { field: 'slice_type', type: FLAG_TYPE.STRING },
  '--prd': { field: 'prd', type: FLAG_TYPE.STRING },
  '--root-cause': { field: 'root_cause', type: FLAG_TYPE.STRING },
  '--fix': { field: 'fix', type: FLAG_TYPE.STRING },
  '--notes': { field: 'notes', type: FLAG_TYPE.STRING },
  '--scope': { field: 'scope', type: FLAG_TYPE.LIST },
  '--acceptance-criteria': { field: 'acceptance_criteria', type: FLAG_TYPE.LIST },
  '--depends-on': { field: 'depends_on', type: FLAG_TYPE.LIST },
  '--related-tickets': { field: 'related_tickets', type: FLAG_TYPE.LIST },
  '--assigned-sprint': { field: ISSUE_ASSIGNED_SPRINT_FIELD, type: FLAG_TYPE.INTEGER },
  '--closed-in-sprint': { field: 'closed_in_sprint', type: FLAG_TYPE.INTEGER },
  '--actionable-now': { field: 'actionable_now', type: FLAG_TYPE.BOOLEAN },
  '--to-backlog': { field: ISSUE_ASSIGNED_SPRINT_FIELD, type: FLAG_TYPE.NULL },
};

// The required flag for `issue create`: without a title there is no slug to freeze.
const ISSUE_CREATE_REQUIRED_FLAG = '--title';

// `sprint append-step` flag table → a verdict-ledger entry (step, at, artifact, summary).
// --at defaults to today (ISO date) when omitted; the rest are required.
const STEP_LOG_FLAGS = {
  '--step': { field: 'step', type: FLAG_TYPE.STRING },
  '--at': { field: 'at', type: FLAG_TYPE.STRING },
  '--artifact': { field: 'artifact', type: FLAG_TYPE.STRING },
  '--summary': { field: 'summary', type: FLAG_TYPE.STRING },
};
const STEP_LOG_REQUIRED_FLAGS = ['--step', '--artifact', '--summary'];
const STEP_LOG_DATE_FIELD = 'at';
// An ISO-8601 timestamp's leading date portion is its first 10 chars (YYYY-MM-DD).
const ISO_DATE_LENGTH = 10;

// How a 'list'-typed flag's single argument is split into an array.
const LIST_VALUE_SEPARATOR = ',';

module.exports = {
  RECORD_KIND,
  RECORD_FILE_EXTENSION,
  RECORD_TEMP_SUFFIX,
  RECORD_ID_SLUG_JOINER,
  ISSUES_DIR_RELATIVE,
  SPRINTS_DIR_RELATIVE,
  ISSUE_PARTITION_PREFIX,
  SPRINT_FILE_PREFIX,
  UUIDV7_PATTERN,
  SLUG_SEPARATOR,
  SLUG_MAX_LENGTH,
  SLUG_DISALLOWED_RUN,
  SLUG_EDGE_SEPARATORS,
  RECORD_KINDS,
  RECORD_ID_FIELD,
  ISSUE_COLLECTION_FIELD,
  LEGACY_BACKLOG_BASENAME,
  LEGACY_SPRINT_ISSUES_SUFFIX,
  PARTITION_DIR_PATTERN,
  SPRINT_FILE_PATTERN,
  SPRINT_ID_FIELD,
  SPRINT_ID_MIN,
  SPRINT_STEP_LOG_FIELD,
  ISSUE_ASSIGNED_SPRINT_FIELD,
  SPRINT_KEY_ORDER,
  SPRINT_SENTINEL_KEY,
  FLAG_TYPE,
  ISSUE_FIELD_FLAGS,
  ISSUE_CREATE_REQUIRED_FLAG,
  STEP_LOG_FLAGS,
  STEP_LOG_REQUIRED_FLAGS,
  STEP_LOG_DATE_FIELD,
  ISO_DATE_LENGTH,
  LIST_VALUE_SEPARATOR,
};
