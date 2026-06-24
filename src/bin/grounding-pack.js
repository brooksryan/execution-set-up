'use strict';

// to-execution Grounding Pack regenerator — the SOLE writer of .excn/runtime/grounding-pack.json
// (PRD speculative-prewarm, sprint-11 S2; ADR speculative-prewarm-runtime-staging). It resolves a
// deterministic grounding context with NO model call: a per-schema digest of the `notes` field
// type, the CONTEXT.md glossary terms, an ADR index, the CLI stamp (verbs + issue-create flags),
// and a freshly-minted UUIDv7 pool — every section derived from on-disk sources, never hand-encoded
// (the regenerator hand-writing a schema fact is the exact `notes must be an array` fix-loop the
// pack exists to kill). Constants and the verb list live in grounding-policy.js; this module owns
// the logic. cli.js's `warm` verb is its caller and owns the stamped-target guard.
//
// Public surface:
//   regenerateGroundingPack({ targetRoot[, poolSize] }) → { path, pack } — derive and atomically write
//   deriveCliStamp(), deriveSchemaDigest(dir), deriveGlossaryTerms(text), deriveAdrIndex(dir),
//   serializePack(pack) — exported for reuse and the determinism/notes/pool unit tests
//
// Determinism contract: every DERIVED section is byte-identical across two regenerations on
// identical sources, because serializePack deep-sorts all object keys before emitting (a raw
// readdirSync / Object.entries order is otherwise non-deterministic — prior-art G3). The
// uuid_pool is the lone exception (time + randomness), so a byte-identical comparison strips it.
// A failure to read a core source (schemas, CONTEXT.md) throws; cli.js maps it to a non-zero exit.

const fs = require('fs');
const path = require('path');
const { SCHEMA_DIR_RELATIVE } = require('./validate-policy');
const { mintUuidV7 } = require('./write-record');
const { ISSUE_FIELD_FLAGS } = require('./write-policy');
const {
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
} = require('./grounding-policy');

const LINE_SEPARATOR = '\n';

// ── deterministic serialization ─────────────────────────────────────────────────

/**
 * Recursively return a copy of a value with every object's keys in sorted order, so a
 * readdirSync- or Object.entries-derived section serializes identically regardless of the
 * platform's enumeration order (prior-art G3). Arrays keep their order — that order is the
 * regenerator's own (sorted verbs/flags, id-sorted ADRs, document-order glossary, the pool) —
 * but their object elements are sorted too. Primitives pass through.
 * @param {*} value - any JSON-serializable value.
 * @returns {*} the key-sorted copy.
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * Serialize a pack to its on-disk form: deep-sort all object keys, stringify at the shared
 * indent, end with a trailing newline. Two packs with identical derived sections (uuid_pool
 * aside) serialize byte-identically.
 * @param {object} pack - the assembled pack object.
 * @returns {string} the file contents.
 */
function serializePack(pack) {
  return JSON.stringify(sortKeysDeep(pack), null, SERIALIZATION_INDENT) + TRAILING_NEWLINE;
}

/**
 * Write contents to a destination atomically: a sibling temp file then a rename (atomic on one
 * filesystem), so a mid-write failure never leaves a partial pack. The temp twin is best-effort
 * removed on failure; the original error is what propagates.
 * @param {string} destination - absolute path of the file to (over)write.
 * @param {string} contents - the bytes to write.
 * @returns {void}
 * @throws {Error} re-throws any I/O failure after cleaning up the temp file.
 */
function writeAtomic(destination, contents) {
  const tempPath = `${destination}${PACK_TEMP_SUFFIX}`;
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

// ── section derivations ─────────────────────────────────────────────────────────

/**
 * Mint a pool of fresh UUIDv7 for a synthesis step to draw ready ids from. This is the pack's
 * one non-deterministic section (each id embeds the current time and random bits).
 * @param {number} size - how many ids to mint.
 * @returns {string[]} `size` canonical UUIDv7 strings.
 * @throws {Error} if minting fails its self-assertion (a layout bug, surfaced by mintUuidV7).
 */
function mintUuidPool(size) {
  const pool = [];
  for (let index = 0; index < size; index += 1) pool.push(mintUuidV7());
  return pool;
}

/**
 * Derive the CLI stamp: the dispatchable verbs (from SCAFFOLDER_VERBS, the maintained mirror of
 * cli.js) and the issue-create flag names (from write-policy's ISSUE_FIELD_FLAGS, their canonical
 * home — read here, never re-listed, and never via a cli.js require, to keep the cycle out). Both
 * lists are sorted so the section is order-stable regardless of source declaration order.
 * @returns {{verbs: string[], issue_create_flags: string[]}} the stamp section.
 */
function deriveCliStamp() {
  return {
    [CLI_STAMP_KEY.VERBS]: [...SCAFFOLDER_VERBS].sort(),
    [CLI_STAMP_KEY.ISSUE_CREATE_FLAGS]: Object.keys(ISSUE_FIELD_FLAGS).sort(),
  };
}

/**
 * Find the `notes` property's subschema anywhere in a parsed schema: return the first one a
 * deterministic depth-first walk reaches (keys visited in sorted order so the result never
 * depends on declaration order). Handles a top-level `properties.notes` (prd, issue-record) and
 * a nested one under array `items.properties.notes` (issue, sprint) alike.
 * @param {*} node - a schema node (object, array, or primitive).
 * @returns {object|null} the notes subschema, or null when the schema carries no notes field.
 */
function findNotesSchema(node) {
  if (!node || typeof node !== 'object') return null;
  if (!Array.isArray(node)) {
    const properties = node[SCHEMA_PROPERTIES_KEYWORD];
    if (properties && typeof properties === 'object'
      && Object.prototype.hasOwnProperty.call(properties, NOTES_PROPERTY_NAME)) {
      return properties[NOTES_PROPERTY_NAME];
    }
  }
  const children = Array.isArray(node) ? node : Object.keys(node).sort().map((key) => node[key]);
  for (const child of children) {
    const found = findNotesSchema(child);
    if (found) return found;
  }
  return null;
}

/**
 * Describe a located notes subschema by its declared `type`, plus the item type when that type
 * is `array` (so prd's array-of-string reads distinctly from the `["string","null"]` union the
 * record schemas use). The descriptor is read off the schema verbatim — never asserted by hand.
 * @param {object} notesSchema - the notes subschema (its `type`, optional `items`).
 * @returns {object} the type descriptor.
 */
function describeNotes(notesSchema) {
  const descriptor = { [NOTES_DESCRIPTOR_KEY.TYPE]: notesSchema[SCHEMA_TYPE_KEYWORD] };
  const items = notesSchema[SCHEMA_ITEMS_KEYWORD];
  if (notesSchema[SCHEMA_TYPE_KEYWORD] === SCHEMA_ARRAY_TYPE && items && items[SCHEMA_TYPE_KEYWORD] !== undefined) {
    descriptor[NOTES_DESCRIPTOR_KEY.ITEMS] = items[SCHEMA_TYPE_KEYWORD];
  }
  return descriptor;
}

/**
 * Derive the per-schema notes-type digest: read every `*.json` under the schema dir and, for
 * each schema that carries a `notes` field, record its type descriptor keyed by schema basename.
 * Schemas without a notes field are omitted (the digest is about the notes footgun specifically).
 * @param {string} schemasDir - absolute path of the Instance's schema directory.
 * @returns {Object<string,object>} schema basename → notes type descriptor.
 * @throws {Error} if the schema dir is unreadable or a schema file is unparseable — the digest is
 *   a core section, so a missing source fails closed rather than silently emitting an empty digest.
 */
function deriveSchemaDigest(schemasDir) {
  let entries;
  try {
    entries = fs.readdirSync(schemasDir);
  } catch (cause) {
    throw new Error(`cannot read schema dir ${schemasDir}: ${cause.message}`);
  }
  const digest = {};
  for (const file of entries) {
    if (!file.endsWith(SCHEMA_FILE_EXTENSION)) continue;
    const full = path.join(schemasDir, file);
    let schema;
    try {
      schema = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (cause) {
      throw new Error(`cannot parse schema ${full}: ${cause.message}`);
    }
    const notesSchema = findNotesSchema(schema);
    if (notesSchema) digest[file] = describeNotes(notesSchema);
  }
  return digest;
}

/**
 * Derive the glossary terms from CONTEXT.md: the `### ` headings under the `## Glossary` section,
 * in document order (which is itself deterministic), collected until the next `## ` section.
 * @param {string} contextText - the full CONTEXT.md contents.
 * @returns {string[]} the term names (heading text with the `### ` prefix stripped).
 */
function deriveGlossaryTerms(contextText) {
  const terms = [];
  let inGlossary = false;
  for (const line of contextText.split(LINE_SEPARATOR)) {
    if (line.startsWith(SECTION_HEADING_PREFIX)) {
      // A new `## ` section opens (or closes) the glossary; `### ` term lines fail this test.
      inGlossary = line.trim() === GLOSSARY_HEADING;
      continue;
    }
    if (inGlossary && line.startsWith(TERM_HEADING_PREFIX)) {
      terms.push(line.slice(TERM_HEADING_PREFIX.length).trim());
    }
  }
  return terms;
}

/**
 * Parse one ADR's id, title, and status from its markdown. id is the `id:` frontmatter value or,
 * when absent, the filename stem (the documented fallback); status is the `status:` frontmatter
 * value or ADR_STATUS_FALLBACK; title is the first `# ` H1 heading or, when absent, the stem.
 * @param {string} text - the ADR file contents.
 * @param {string} stem - the filename without its extension (the id/title fallback).
 * @returns {{id: string, title: string, status: string}} the index entry fields.
 */
function parseAdr(text, stem) {
  const lines = text.split(LINE_SEPARATOR);
  let id = stem;
  let status = ADR_STATUS_FALLBACK;

  if (lines[0] !== undefined && lines[0].trim() === FRONTMATTER_FENCE) {
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index].trim() === FRONTMATTER_FENCE) break; // closing fence ends the block
      const separator = lines[index].indexOf(FRONTMATTER_KV_SEPARATOR);
      if (separator === -1) continue;
      const key = lines[index].slice(0, separator).trim();
      const value = lines[index].slice(separator + 1).trim();
      if (key === FRONTMATTER_ID_KEY) id = value;
      else if (key === FRONTMATTER_STATUS_KEY) status = value;
    }
  }

  let title = stem;
  for (const line of lines) {
    if (line.startsWith(H1_HEADING_PREFIX)) {
      title = line.slice(H1_HEADING_PREFIX.length).trim();
      break;
    }
  }
  return { [ADR_ENTRY_KEY.ID]: id, [ADR_ENTRY_KEY.TITLE]: title, [ADR_ENTRY_KEY.STATUS]: status };
}

/**
 * Derive the ADR index: one {id, title, status} entry per `*.md` under the ADR dir, sorted by id
 * (readdirSync order is not portable — prior-art G3 — so the sort is what makes it deterministic).
 * A missing ADR dir is a legitimate empty-index condition (a fresh Instance ships none), mirroring
 * the codebase's listIssueRecordFiles idiom — not a swallowed error.
 * @param {string} adrDir - absolute path of the Instance's ADR directory.
 * @returns {Array<{id: string, title: string, status: string}>} the id-sorted index.
 * @throws {Error} if an ADR file present in the listing is unreadable (a real I/O fault, not absence).
 */
function deriveAdrIndex(adrDir) {
  let files;
  try {
    files = fs.readdirSync(adrDir);
  } catch {
    return []; // absent ADR dir → no ADRs (documented empty-index condition)
  }
  const index = [];
  for (const file of files) {
    if (!file.endsWith(ADR_FILE_EXTENSION)) continue;
    const full = path.join(adrDir, file);
    const text = fs.readFileSync(full, 'utf8'); // a listed-but-unreadable file is a real fault — let it throw
    index.push(parseAdr(text, path.basename(file, ADR_FILE_EXTENSION)));
  }
  index.sort((left, right) => left[ADR_ENTRY_KEY.ID].localeCompare(right[ADR_ENTRY_KEY.ID]));
  return index;
}

// ── public surface ──────────────────────────────────────────────────────────────

/**
 * Regenerate the Grounding Pack for a target Instance and atomically write it to
 * .excn/runtime/grounding-pack.json. Every section is derived from on-disk sources under the
 * target root; the regenerator is the pack's sole writer and hand-encodes nothing. The caller
 * (cli.js `warm`) guards that the target is a stamped Instance before calling.
 * @param {object} opts - { targetRoot: absolute Instance root, poolSize=UUID_POOL_SIZE }.
 * @returns {{path: string, pack: object}} the written path and the in-memory pack.
 * @throws {Error} if targetRoot is missing, a core source (schemas / CONTEXT.md) is unreadable,
 *   or the atomic write fails.
 */
function regenerateGroundingPack(opts = {}) {
  const targetRoot = opts.targetRoot;
  if (typeof targetRoot !== 'string' || targetRoot === '') {
    throw new Error('regenerateGroundingPack needs a targetRoot (absolute Instance root)');
  }
  const poolSize = opts.poolSize === undefined ? UUID_POOL_SIZE : opts.poolSize;

  const schemasDir = path.join(targetRoot, SCHEMA_DIR_RELATIVE);
  const contextPath = path.join(targetRoot, CONTEXT_RELATIVE_PATH);
  const adrDir = path.join(targetRoot, ADR_DIR_RELATIVE);

  let contextText;
  try {
    contextText = fs.readFileSync(contextPath, 'utf8');
  } catch (cause) {
    throw new Error(`cannot read glossary source ${contextPath}: ${cause.message}`);
  }

  const pack = {
    [PACK_KEY.VERSION]: PACK_VERSION,
    [PACK_KEY.CLI_STAMP]: deriveCliStamp(),
    [PACK_KEY.SCHEMA_DIGEST]: deriveSchemaDigest(schemasDir),
    [PACK_KEY.GLOSSARY_TERMS]: deriveGlossaryTerms(contextText),
    [PACK_KEY.ADR_INDEX]: deriveAdrIndex(adrDir),
    [PACK_KEY.UUID_POOL]: mintUuidPool(poolSize),
  };

  const destination = path.join(targetRoot, GROUNDING_PACK_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  writeAtomic(destination, serializePack(pack));
  return { path: destination, pack };
}

module.exports = {
  regenerateGroundingPack,
  serializePack,
  deriveCliStamp,
  deriveSchemaDigest,
  deriveGlossaryTerms,
  deriveAdrIndex,
};
