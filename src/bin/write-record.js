'use strict';

// to-execution writeRecord helper — the EXCLUSIVE write path for work-tracking records
// (EXEC-097/098/099, PRD-011, ADR-0011). One choke point guarantees format by construction
// for both issues and sprints: it mints self-identifying UUIDv7 ids, rejects a caller-set id
// (the id is immutable), freezes a title-derived slug, validates against the bundled schema,
// writes atomically (temp file + rename) so a mid-write failure can never leave a partial
// file, and serializes through one library path so a trailing comma is impossible. Sprint
// records emit canonical-sentinel form (declared key order, accreting arrays last, the
// constant schema_version key dead-last) so a step_log append is a minimal, sibling-stable
// diff. Lookup tables and named rules live in write-policy.js; this module owns the logic.
//
// Public surface:
//   writeRecord(kind, record[, opts])      → create an issue (mint id) or write a whole sprint
//   updateRecord(kind, id, changes[, opts]) → update an issue's fields / relocate its partition
//   appendStepLog(sprintId, entry[, opts])  → append one verdict to a sprint's step_log
//   mintUuidV7(), deriveSlug(title), serializeSprint(record) — exported for reuse and tests
// Every path throws (never partial-writes) on an unknown kind/op, a supplied or changed id, a
// missing title, a schema-invalid record, a missing target, or I/O failure — the caller
// surfaces it (the CLI maps it to a non-zero exit).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SCHEMA_DIR_RELATIVE } = require('./validate-policy');
const {
  RECORD_KIND,
  RECORD_FILE_EXTENSION,
  RECORD_TEMP_SUFFIX,
  RECORD_ID_SLUG_JOINER,
  ISSUE_PARTITION_PREFIX,
  SPRINT_FILE_PREFIX,
  UUIDV7_PATTERN,
  SLUG_SEPARATOR,
  SLUG_MAX_LENGTH,
  SLUG_DISALLOWED_RUN,
  SLUG_EDGE_SEPARATORS,
  RECORD_KINDS,
  RECORD_ID_FIELD,
  SPRINT_ID_FIELD,
  SPRINT_ID_MIN,
  SPRINT_STEP_LOG_FIELD,
  ISSUE_ASSIGNED_SPRINT_FIELD,
  SPRINT_KEY_ORDER,
  SPRINT_SENTINEL_KEY,
} = require('./write-policy');

// The package root is one level up from bin/; the canonical schemas ship under the template
// beside it, so the helper validates against the shipped schema without locating the Instance
// or ad-hoc-installing anything (the host-root lesson, EXEC-081).
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, 'template', SCHEMA_DIR_RELATIVE);

// JSON.stringify indent for canonical serialization, and the trailing newline every record
// file ends with (matches the version-marker/record-writing idiom in cli.js).
const SERIALIZATION_INDENT = 2;
const TRAILING_NEWLINE = '\n';

// UUIDv7 byte layout (RFC 9562): 16 bytes, the first 6 a big-endian millisecond timestamp,
// the version nibble (7) in the high nibble of byte 6, the variant bits (10) in the high bits
// of byte 8, the rest random.
const UUID_BYTE_LENGTH = 16;
const UUID_TIMESTAMP_BYTES = 6;
const UUID_VERSION = 7;
const UUID_VERSION_BYTE = 6;
const UUID_VARIANT_BYTE = 8;
const BYTE_VALUES = 256; // a byte holds 0..255; dividing by this shifts right one byte
const BYTE_MASK = 0xff;
const NIBBLE_BITS = 4;
const LOW_NIBBLE_MASK = 0x0f;
const VARIANT_HIGH_BITS = 0x80; // 10xx xxxx
const VARIANT_CLEAR_MASK = 0x3f; // keep the low 6 bits, clear the top 2 for the variant
// Hyphen offsets that split the 32-hex-char string into the canonical 8-4-4-4-12 groups.
const UUID_HYPHEN_OFFSETS = [8, 12, 16, 20];

// Compiled validators, cached by kind so repeated writes do not recompile.
const validatorCache = new Map();

/**
 * Mint a UUIDv7: a 48-bit millisecond timestamp prefix (time-sortable) followed by random
 * bits, with the RFC 9562 version and variant markers set. The freshly minted id is asserted
 * against UUIDV7_PATTERN so a layout bug fails closed rather than writing a malformed id.
 * @returns {string} the canonical hyphenated lowercase UUIDv7.
 * @throws {Error} if the assembled id does not match the canonical UUIDv7 form.
 */
function mintUuidV7() {
  const bytes = crypto.randomBytes(UUID_BYTE_LENGTH);
  let timestampMs = Date.now();
  for (let index = UUID_TIMESTAMP_BYTES - 1; index >= 0; index -= 1) {
    bytes[index] = timestampMs & BYTE_MASK;
    timestampMs = Math.floor(timestampMs / BYTE_VALUES);
  }
  bytes[UUID_VERSION_BYTE] = (UUID_VERSION << NIBBLE_BITS) | (bytes[UUID_VERSION_BYTE] & LOW_NIBBLE_MASK);
  bytes[UUID_VARIANT_BYTE] = VARIANT_HIGH_BITS | (bytes[UUID_VARIANT_BYTE] & VARIANT_CLEAR_MASK);

  const hex = bytes.toString('hex');
  let id = '';
  let cursor = 0;
  for (const offset of UUID_HYPHEN_OFFSETS) {
    id += hex.slice(cursor, offset) + RECORD_ID_SLUG_JOINER;
    cursor = offset;
  }
  id += hex.slice(cursor);

  if (!UUIDV7_PATTERN.test(id)) {
    throw new Error(`minted id ${id} is not a valid UUIDv7 — refusing to write`);
  }
  return id;
}

/**
 * Derive the frozen filename slug from a title: lowercase, collapse every run of
 * non-alphanumerics to a single separator, trim edge separators, truncate to
 * SLUG_MAX_LENGTH, then re-trim any separator the cut exposed.
 * @param {string} title - the record's title.
 * @returns {string} a non-empty slug.
 * @throws {Error} if the title yields no slug characters (e.g. empty or all punctuation).
 */
function deriveSlug(title) {
  const slug = title
    .toLowerCase()
    .replace(SLUG_DISALLOWED_RUN, SLUG_SEPARATOR)
    .replace(SLUG_EDGE_SEPARATORS, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(SLUG_EDGE_SEPARATORS, '');
  if (slug === '') {
    throw new Error(`title ${JSON.stringify(title)} yields no slug characters — cannot name the record file`);
  }
  return slug;
}

/**
 * Build (and cache) the ajv validator for a kind's schema. Every shipped schema is registered
 * so a cross-file $ref resolves (the sprint schema's step_log $refs verdict-ledger). ajv +
 * ajv-formats are required lazily here so a missing install only ever affects record writes,
 * never the builtin-only stamp verbs, and is resolved from the bundled package (EXEC-081).
 * @param {object} kindConfig - a RECORD_KINDS entry.
 * @param {string} kind - the kind name (cache key and error context).
 * @returns {Function} the compiled ajv validate function for the kind's schema.
 * @throws {Error} if ajv is not installed, a schema is unreadable, or the kind's schema is absent.
 */
function recordValidator(kindConfig, kind) {
  const cached = validatorCache.get(kind);
  if (cached) return cached;

  let Ajv;
  let addFormats;
  try {
    Ajv = require('ajv'); // eslint-disable-line global-require
    addFormats = require('ajv-formats'); // eslint-disable-line global-require
  } catch (cause) {
    throw new Error(`writeRecord needs ajv — reinstall the package (${cause.message})`);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  // Key each schema by its basename so a cross-file $ref by filename resolves (mirrors
  // cli.js buildAjv); a schema carrying its own $id keeps that too.
  for (const file of fs.readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith(RECORD_FILE_EXTENSION)) continue;
    ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8')), file);
  }
  const validate = ajv.getSchema(kindConfig.schema);
  if (!validate) {
    throw new Error(`no schema named ${kindConfig.schema} for kind ${kind} in ${SCHEMAS_DIR}`);
  }
  validatorCache.set(kind, validate);
  return validate;
}

/**
 * Format ajv errors into a single human-readable string (JSON path + message per error).
 * @param {object[]} errors - the validator's `.errors` array.
 * @returns {string} the joined violation detail.
 */
function formatErrors(errors) {
  return errors.map((error) => `${error.instancePath || '(root)'} ${error.message}`).join('; ');
}

/**
 * Serialize the buffer to a destination atomically: write a sibling temp file, then rename it
 * into place (rename is atomic on a single filesystem). A failure before the rename leaves
 * only the temp file, never a partial destination; the temp file is best-effort removed.
 * @param {string} destination - absolute path of the file to create.
 * @param {string} contents - the bytes to write.
 * @returns {void}
 * @throws {Error} re-throws any I/O failure after cleaning up the temp file.
 */
function writeAtomic(destination, contents) {
  const tempPath = `${destination}${RECORD_TEMP_SUFFIX}`;
  try {
    fs.writeFileSync(tempPath, contents);
    fs.renameSync(tempPath, destination);
  } catch (cause) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; the original failure below is what the caller must see.
    }
    throw cause;
  }
}

/**
 * Serialize an issue record canonically: one library stringify pass, stable key order from
 * the object, trailing newline. A trailing comma is structurally impossible.
 * @param {object} record - the full issue record.
 * @returns {string} the file contents.
 */
function serializeIssue(record) {
  return JSON.stringify(record, null, SERIALIZATION_INDENT) + TRAILING_NEWLINE;
}

/**
 * Serialize a sprint record in canonical-sentinel form: every non-sentinel key in
 * SPRINT_KEY_ORDER (accreting arrays last), then the constant SPRINT_SENTINEL_KEY dead-last,
 * so the byte-layout is deterministic and a step_log append is a minimal, sibling-stable
 * diff. Fails closed if the record carries a key the order does not place — a silent drop
 * would lose data and the order must track the schema.
 * @param {object} record - the full sprint record (must include the sentinel key).
 * @returns {string} the file contents.
 * @throws {Error} if the record has a key not in SPRINT_KEY_ORDER and not the sentinel.
 */
function serializeSprint(record) {
  const placeable = new Set([...SPRINT_KEY_ORDER, SPRINT_SENTINEL_KEY]);
  const unplaced = Object.keys(record).filter((key) => !placeable.has(key));
  if (unplaced.length > 0) {
    throw new Error(`sprint record has key(s) not in the canonical order: ${unplaced.join(', ')} — update SPRINT_KEY_ORDER`);
  }
  const ordered = {};
  for (const key of SPRINT_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(record, key)) ordered[key] = record[key];
  }
  ordered[SPRINT_SENTINEL_KEY] = record[SPRINT_SENTINEL_KEY]; // sentinel dead-last
  return JSON.stringify(ordered, null, SERIALIZATION_INDENT) + TRAILING_NEWLINE;
}

/**
 * Create a new issue: reject a caller-supplied id, mint a UUIDv7, freeze a title-derived
 * slug, fill the kind defaults, validate, and atomically write <id>-<slug>.json under the
 * issues home.
 * @param {object} kindConfig - the issue RECORD_KINDS entry.
 * @param {object} record - the issue fields WITHOUT an id; must carry the title field.
 * @param {object} opts - { targetRoot }.
 * @returns {{ id: string, slug: string, path: string }}
 * @throws {Error} on a supplied id, a missing/empty title, or a schema-invalid record.
 */
function createIssue(kindConfig, record, opts) {
  if (record && Object.prototype.hasOwnProperty.call(record, RECORD_ID_FIELD)) {
    throw new Error(`record must not carry an ${RECORD_ID_FIELD} on create — the id is self-minted and immutable (ADR-0011)`);
  }
  const title = record ? record[kindConfig.titleField] : undefined;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`record needs a non-empty ${kindConfig.titleField} to mint an issue`);
  }

  const id = mintUuidV7();
  const slug = deriveSlug(title);
  // Defaults first so explicit caller fields win; id last so it can never be overridden.
  const fullRecord = { [RECORD_ID_FIELD]: id, ...kindConfig.defaults, ...record };

  const validate = recordValidator(kindConfig, RECORD_KIND.ISSUE);
  if (!validate(fullRecord)) {
    throw new Error(`record is not a valid issue: ${formatErrors(validate.errors)}`);
  }

  const directory = path.join(opts.targetRoot || process.cwd(), kindConfig.dirRelative);
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${id}${RECORD_ID_SLUG_JOINER}${slug}${RECORD_FILE_EXTENSION}`);
  writeAtomic(destination, serializeIssue(fullRecord));
  return { id, slug, path: destination };
}

/**
 * Write a whole sprint record (scribe's open/close) as an upsert: validate, serialize in
 * canonical-sentinel form, and atomically write sprints/sprint_<N>.json. No id is minted —
 * sprint_id is the caller-supplied integer identity.
 * @param {object} kindConfig - the sprint RECORD_KINDS entry.
 * @param {object} record - the full sprint record (with sprint_id and schema_version).
 * @param {object} opts - { targetRoot }.
 * @returns {{ sprintId: number, path: string }}
 * @throws {Error} if sprint_id is not an integer >= SPRINT_ID_MIN, or the record is schema-invalid.
 */
function writeSprint(kindConfig, record, opts) {
  const sprintId = record ? record[SPRINT_ID_FIELD] : undefined;
  if (!Number.isInteger(sprintId) || sprintId < SPRINT_ID_MIN) {
    throw new Error(`sprint record needs an integer ${SPRINT_ID_FIELD} >= ${SPRINT_ID_MIN}`);
  }
  const validate = recordValidator(kindConfig, RECORD_KIND.SPRINT);
  if (!validate(record)) {
    throw new Error(`record is not a valid sprint: ${formatErrors(validate.errors)}`);
  }
  const directory = path.join(opts.targetRoot || process.cwd(), kindConfig.dirRelative);
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${SPRINT_FILE_PREFIX}${sprintId}${RECORD_FILE_EXTENSION}`);
  writeAtomic(destination, serializeSprint(record));
  return { sprintId, path: destination };
}

/**
 * Create a new record through the single sanctioned path. Dispatches by kind: an issue is
 * minted (createIssue), a sprint is upserted whole (writeSprint).
 * @param {string} kind - RECORD_KIND.ISSUE or RECORD_KIND.SPRINT.
 * @param {object} record - the record fields (issue: no id; sprint: with sprint_id).
 * @param {object} [opts] - { targetRoot=process.cwd() }.
 * @returns {object} the kind's result (issue: {id,slug,path}; sprint: {sprintId,path}).
 * @throws {Error} on an unknown kind or any per-kind failure above.
 */
function writeRecord(kind, record, opts = {}) {
  const kindConfig = RECORD_KINDS[kind];
  if (!kindConfig) {
    throw new Error(`unknown record kind ${JSON.stringify(kind)} — known kinds: ${Object.keys(RECORD_KINDS).join(', ')}`);
  }
  if (kind === RECORD_KIND.ISSUE) return createIssue(kindConfig, record, opts);
  return writeSprint(kindConfig, record, opts);
}

/**
 * List per-record issue files under the issues home: the *.json at its top level plus the
 * *.json one level down in each partition subdirectory (issues/sprint-<N>/). The temp twins
 * and any non-.json entries are skipped; collection files (backlog.json, sprint-issues
 * companions) are returned but later filtered out by their missing single-record id.
 * @param {string} issuesDir - absolute issues home.
 * @returns {string[]} absolute file paths (empty when the home is absent).
 */
function listIssueRecordFiles(issuesDir) {
  let entries;
  try {
    entries = fs.readdirSync(issuesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(issuesDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(RECORD_FILE_EXTENSION)) {
      files.push(full);
    } else if (entry.isDirectory()) {
      for (const child of fs.readdirSync(full, { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith(RECORD_FILE_EXTENSION)) files.push(path.join(full, child.name));
      }
    }
  }
  return files;
}

/**
 * Locate a single per-record issue file by id: an exact id match wins; failing that, a unique
 * id-prefix match (so a short uuid prefix resolves the file, as commit SHAs do). Collection
 * files have no single-record id and are ignored.
 * @param {string} issuesDir - absolute issues home.
 * @param {string} id - the full id or a unique prefix.
 * @returns {{ path: string, record: object }} the located file and its parsed record.
 * @throws {Error} when nothing matches or a prefix is ambiguous.
 */
function locateIssueFile(issuesDir, id) {
  const records = [];
  for (const file of listIssueRecordFiles(issuesDir)) {
    let record;
    try {
      record = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // unreadable/unparseable file is not a locatable record
    }
    if (record && typeof record[RECORD_ID_FIELD] === 'string') records.push({ path: file, record });
  }
  const exact = records.filter((entry) => entry.record[RECORD_ID_FIELD] === id);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`id ${id} matches ${exact.length} issue files — the id is not unique`);
  }
  const prefixed = records.filter((entry) => entry.record[RECORD_ID_FIELD].startsWith(id));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) {
    throw new Error(`id prefix ${id} is ambiguous — matches ${prefixed.length} issues; use a longer prefix`);
  }
  throw new Error(`no issue found with id (or id prefix) ${id} under ${issuesDir}`);
}

/**
 * Resolve the destination partition directory for an issue from its assigned_sprint: an
 * integer N homes it under issues/sprint-<N>/ (location-as-state), null/absent keeps it at
 * the issues-home root (the backlog).
 * @param {string} issuesDir - absolute issues home.
 * @param {object} record - the issue record.
 * @returns {string} the absolute destination directory.
 */
function issuePartitionDir(issuesDir, record) {
  const sprintNumber = record[ISSUE_ASSIGNED_SPRINT_FIELD];
  if (Number.isInteger(sprintNumber)) return path.join(issuesDir, `${ISSUE_PARTITION_PREFIX}${sprintNumber}`);
  return issuesDir;
}

/**
 * Update an issue's fields and, when assigned_sprint changes, relocate its per-record file to
 * the matching partition (location-as-state). The id is immutable — a changes payload that
 * carries an id is rejected. The frozen filename (id + slug) is preserved across a move; only
 * the directory changes. Reuses the canonical serialization and atomic write, then removes the
 * old file only after the new one is in place.
 * @param {string} kind - RECORD_KIND.ISSUE (the only supported update kind).
 * @param {string} id - the issue id or a unique prefix.
 * @param {object} changes - fields to set (must not include id).
 * @param {object} [opts] - { targetRoot=process.cwd() }.
 * @returns {{ id: string, path: string, movedFrom: string|null }}
 * @throws {Error} on an unsupported kind, an id in changes, no/ambiguous match, or invalidity.
 */
function updateRecord(kind, id, changes, opts = {}) {
  if (kind !== RECORD_KIND.ISSUE) {
    throw new Error(`updateRecord supports kind ${RECORD_KIND.ISSUE} only, not ${JSON.stringify(kind)}`);
  }
  if (changes && Object.prototype.hasOwnProperty.call(changes, RECORD_ID_FIELD)) {
    throw new Error(`the ${RECORD_ID_FIELD} is immutable — an update may not change it (ADR-0011)`);
  }
  const kindConfig = RECORD_KINDS[kind];
  const issuesDir = path.join(opts.targetRoot || process.cwd(), kindConfig.dirRelative);
  const current = locateIssueFile(issuesDir, id);
  const merged = { ...current.record, ...changes };

  const validate = recordValidator(kindConfig, RECORD_KIND.ISSUE);
  if (!validate(merged)) {
    throw new Error(`updated record is not a valid issue: ${formatErrors(validate.errors)}`);
  }

  const destinationDir = issuePartitionDir(issuesDir, merged);
  fs.mkdirSync(destinationDir, { recursive: true });
  const destination = path.join(destinationDir, path.basename(current.path));
  writeAtomic(destination, serializeIssue(merged));

  let movedFrom = null;
  if (path.resolve(destination) !== path.resolve(current.path)) {
    fs.rmSync(current.path); // new file is in place; drop the old partition copy
    movedFrom = current.path;
  }
  return { id: merged[RECORD_ID_FIELD], path: destination, movedFrom };
}

/**
 * Write a record that already carries its id, preserving (grandfathering) that id rather
 * than minting a new one — the migration write path (EXEC-102). Derives the frozen slug from
 * the title, validates, and atomically writes <id>-<slug>.json under the issues home (or its
 * sprint-<N> partition when opts.partition is an integer). NO-CLOBBER: an existing target is
 * left untouched and reported, never overwritten (idempotent re-run; restamp-clobber lesson).
 * @param {string} kind - RECORD_KIND.ISSUE (the only supported migration kind).
 * @param {object} record - a full issue record WITH its existing id.
 * @param {object} [opts] - { targetRoot=process.cwd(), partition=null }.
 * @returns {{ id: string, path: string, written: boolean }} written is false when the target
 *   already existed (skipped, not clobbered).
 * @throws {Error} on an unsupported kind, a missing id/title, or a schema-invalid record.
 */
function writeExistingRecord(kind, record, opts = {}) {
  if (kind !== RECORD_KIND.ISSUE) {
    throw new Error(`writeExistingRecord supports kind ${RECORD_KIND.ISSUE} only, not ${JSON.stringify(kind)}`);
  }
  const kindConfig = RECORD_KINDS[kind];
  const id = record ? record[RECORD_ID_FIELD] : undefined;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`writeExistingRecord needs a record carrying an existing ${RECORD_ID_FIELD} (grandfathering)`);
  }
  const title = record[kindConfig.titleField];
  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`record ${id} needs a non-empty ${kindConfig.titleField} to derive its filename`);
  }
  const validate = recordValidator(kindConfig, RECORD_KIND.ISSUE);
  if (!validate(record)) {
    throw new Error(`record ${id} is not a valid issue: ${formatErrors(validate.errors)}`);
  }

  const issuesDir = path.join(opts.targetRoot || process.cwd(), kindConfig.dirRelative);
  const directory = Number.isInteger(opts.partition)
    ? path.join(issuesDir, `${ISSUE_PARTITION_PREFIX}${opts.partition}`)
    : issuesDir;
  const slug = deriveSlug(title);
  const destination = path.join(directory, `${id}${RECORD_ID_SLUG_JOINER}${slug}${RECORD_FILE_EXTENSION}`);
  if (fs.existsSync(destination)) return { id, path: destination, written: false };
  fs.mkdirSync(directory, { recursive: true });
  writeAtomic(destination, serializeIssue(record));
  return { id, path: destination, written: true };
}

/**
 * Validate a parsed record against its kind's schema — the verify side of migrate-records'
 * verify-before-destroy (a written per-file record must re-read schema-valid before the
 * monolith it came from is deleted).
 * @param {string} kind - RECORD_KIND.ISSUE or RECORD_KIND.SPRINT.
 * @param {object} record - the parsed record to check.
 * @returns {boolean} true when the record validates against the kind's schema.
 * @throws {Error} on an unknown kind (a caller bug, not a data condition).
 */
function recordIsValid(kind, record) {
  const kindConfig = RECORD_KINDS[kind];
  if (!kindConfig) {
    throw new Error(`unknown record kind ${JSON.stringify(kind)}`);
  }
  return Boolean(recordValidator(kindConfig, kind)(record));
}

/**
 * Append one entry to a sprint's step_log without rewriting siblings: read the record, push
 * the entry onto step_log, validate, and re-emit in canonical-sentinel form. Because the
 * serializer is deterministic and the sentinel key is dead-last, the diff is the new entry
 * only — sibling entries and the file's tail stay byte-stable.
 * @param {number} sprintId - the integer sprint identity.
 * @param {object} entry - one verdict-ledger entry (step, at, artifact, summary).
 * @param {object} [opts] - { targetRoot=process.cwd() }.
 * @returns {{ sprintId: number, path: string, entries: number }}
 * @throws {Error} if the sprint file is missing/unreadable or the entry makes it schema-invalid.
 */
function appendStepLog(sprintId, entry, opts = {}) {
  if (!Number.isInteger(sprintId) || sprintId < SPRINT_ID_MIN) {
    throw new Error(`appendStepLog needs an integer sprintId >= ${SPRINT_ID_MIN}`);
  }
  const kindConfig = RECORD_KINDS[RECORD_KIND.SPRINT];
  const directory = path.join(opts.targetRoot || process.cwd(), kindConfig.dirRelative);
  const destination = path.join(directory, `${SPRINT_FILE_PREFIX}${sprintId}${RECORD_FILE_EXTENSION}`);

  let record;
  try {
    record = JSON.parse(fs.readFileSync(destination, 'utf8'));
  } catch (cause) {
    throw new Error(`cannot read sprint ${sprintId} at ${destination}: ${cause.message}`);
  }
  if (!Array.isArray(record[SPRINT_STEP_LOG_FIELD])) record[SPRINT_STEP_LOG_FIELD] = [];
  record[SPRINT_STEP_LOG_FIELD].push(entry);

  const validate = recordValidator(kindConfig, RECORD_KIND.SPRINT);
  if (!validate(record)) {
    throw new Error(`step_log append makes sprint ${sprintId} invalid: ${formatErrors(validate.errors)}`);
  }
  writeAtomic(destination, serializeSprint(record));
  return { sprintId, path: destination, entries: record[SPRINT_STEP_LOG_FIELD].length };
}

module.exports = {
  writeRecord,
  updateRecord,
  appendStepLog,
  writeExistingRecord,
  recordIsValid,
  mintUuidV7,
  deriveSlug,
  serializeSprint,
};
