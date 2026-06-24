'use strict';

// Unit tests for the Grounding Pack regenerator (sprint-11 S2; ADR speculative-prewarm-runtime-staging).
// Run with `node --test` from src/ (so the regenerator's lazy deps resolve against src/node_modules).
// Covers the slice's testing AC: (a) the DERIVED sections are byte-identical across two regenerations
// (uuid_pool stripped — it is the one non-deterministic section), (b) the per-schema notes-type digest
// is correct (prd array-of-string; issue-record/issue/sprint the ["string","null"] union), and (c) the
// uuid_pool is non-empty and every entry is a canonical UUIDv7. These tests live outside the package
// `files` set, so they are not published.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { regenerateGroundingPack, serializePack } = require('../bin/grounding-pack');
const { PACK_KEY, ADR_ENTRY_KEY, SCAFFOLDER_VERBS } = require('../bin/grounding-policy');
const { UUIDV7_PATTERN } = require('../bin/write-policy');

const CLI_SOURCE_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
// A `case '<label>':` line in cli.js main()'s dispatch (the only string-cased switch in the file).
const DISPATCH_CASE_PATTERN = /case '([^']+)':/g;
// Help flags share the switch but are not dispatchable verbs; like every flag they lead with this.
const FLAG_PREFIX = '-';

// The repo this test tree lives in is itself a stamped Instance — its .excn/ carries the real
// schemas, CONTEXT.md, and ADRs the regenerator derives from. Two levels up from src/test/.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Regenerate the pack against the repo root into a throwaway runtime dir, so the test never
 * disturbs the real .excn/runtime/grounding-pack.json. Achieved by copying the derived sources
 * into a temp Instance root.
 * @returns {string} an absolute temp Instance root carrying .excn/{schemas,adr,CONTEXT.md}.
 */
function makeTempInstance() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'excn-grounding-'));
  const excn = path.join(root, '.excn');
  fs.mkdirSync(path.join(excn, 'runtime'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'schemas'), path.join(excn, 'schemas'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'adr'), path.join(excn, 'adr'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'CONTEXT.md'), path.join(excn, 'CONTEXT.md'));
  return root;
}

/**
 * Serialize a pack with its non-deterministic uuid_pool removed — the byte-identical comparison
 * surface for the determinism AC (every section EXCEPT the pool must reproduce exactly).
 * @param {object} pack - a regenerated pack.
 * @returns {string} the serialized derived sections.
 */
function serializeDerived(pack) {
  const { [PACK_KEY.UUID_POOL]: pool, ...derived } = pack; // eslint-disable-line no-unused-vars
  return serializePack(derived);
}

test('derived sections are byte-identical across two regenerations (pool stripped)', () => {
  const root = makeTempInstance();
  const first = regenerateGroundingPack({ targetRoot: root });
  const second = regenerateGroundingPack({ targetRoot: root });
  assert.equal(serializeDerived(second.pack), serializeDerived(first.pack));
});

test('per-schema notes type is derived correctly from the schemas', () => {
  const root = makeTempInstance();
  const { pack } = regenerateGroundingPack({ targetRoot: root });
  const digest = pack[PACK_KEY.SCHEMA_DIGEST];

  // prd's notes is an array-of-string.
  assert.deepEqual(digest['prd.schema.json'], { type: 'array', items: 'string' });
  // The record schemas use the ["string","null"] union.
  for (const schema of ['issue-record.schema.json', 'issue.schema.json', 'sprint.schema.json']) {
    assert.deepEqual(digest[schema], { type: ['string', 'null'] }, `${schema} notes type`);
  }
});

test('uuid_pool is non-empty and every entry is a canonical UUIDv7', () => {
  const root = makeTempInstance();
  const { pack } = regenerateGroundingPack({ targetRoot: root });
  const pool = pack[PACK_KEY.UUID_POOL];
  assert.ok(Array.isArray(pool) && pool.length > 0, 'pool is non-empty');
  for (const id of pool) assert.match(id, UUIDV7_PATTERN);
});

test('SCAFFOLDER_VERBS matches the verbs cli.js actually dispatches (drift guard)', () => {
  // Read cli.js's source and extract its dispatch case labels, dropping the help flags (they
  // lead with FLAG_PREFIX) so only dispatchable verbs remain. The test — not the policy module —
  // may read cli.js freely, keeping the cli.js ↔ grounding-pack.js require cycle out. A verb added
  // to main()'s switch without updating the mirror fails here instead of stamping a stale set.
  const source = fs.readFileSync(CLI_SOURCE_PATH, 'utf8');
  const dispatched = [...source.matchAll(DISPATCH_CASE_PATTERN)]
    .map((match) => match[1])
    .filter((label) => !label.startsWith(FLAG_PREFIX));
  assert.deepEqual([...dispatched].sort(), [...SCAFFOLDER_VERBS].sort());
});

test('adr index is id-sorted with a title and status per entry', () => {
  const root = makeTempInstance();
  const { pack } = regenerateGroundingPack({ targetRoot: root });
  const index = pack[PACK_KEY.ADR_INDEX];
  assert.ok(index.length > 0, 'index is non-empty (the repo ships ADRs)');
  const ids = index.map((entry) => entry[ADR_ENTRY_KEY.ID]);
  assert.deepEqual(ids, [...ids].sort(), 'entries are id-sorted');
  for (const entry of index) {
    assert.equal(typeof entry[ADR_ENTRY_KEY.TITLE], 'string');
    assert.ok(entry[ADR_ENTRY_KEY.TITLE].length > 0, 'title is non-empty');
    assert.equal(typeof entry[ADR_ENTRY_KEY.STATUS], 'string');
  }
});
