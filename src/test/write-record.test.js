'use strict';

// Unit tests for the writeRecord helper (EXEC-097, PRD-011). Run with `node --test` from
// src/ (so require('ajv') resolves against src/node_modules). Covers the create AC and the
// PRD testing_decisions for issues: valid UUIDv7 mint, supplied-id rejection, slug
// derivation, atomic write (no partial/temp file), and schema-invalid rejection. These
// tests live outside the package `files` set, so they are not published.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

const { writeRecord, updateRecord, appendStepLog, mintUuidV7, deriveSlug, serializeSprint } = require('../bin/write-record');
const { UUIDV7_PATTERN, RECORD_TEMP_SUFFIX, RECORD_KIND, SPRINT_SENTINEL_KEY, SPRINT_STEP_LOG_FIELD } = require('../bin/write-policy');

const ISSUES_DIR_RELATIVE = '.excn/issues';
const SPRINTS_DIR_RELATIVE = '.excn/sprints';

/**
 * Build a minimal schema-valid sprint record, with optional field overrides.
 * @param {object} [overrides] - fields to merge over the base record.
 * @returns {object} a sprint record.
 */
function makeSprint(overrides = {}) {
  return {
    schema_version: '1.0',
    sprint_id: 9,
    name: 'Sprint 9',
    status: 'active',
    dates: { start: '2026-06-16', end: null, duration_note: null },
    team: [{ name: 'builder', role: 'Builder', owns: 'src/bin' }],
    goal: 'Ship PRD-011.',
    issues_addressed: ['EXEC-099'],
    shipped: [],
    in_progress: [],
    not_shipped: [],
    defects_discovered: [],
    decisions: [],
    retrospective_notes: [],
    ...overrides,
  };
}

/**
 * One verdict-ledger step_log entry.
 * @param {string} step - the step name.
 * @returns {object} the entry.
 */
function makeStep(step) {
  return { step, at: '2026-06-16', artifact: 'src/bin/write-record.js', summary: 'PASS — 0 violations' };
}

/**
 * Make a throwaway Instance root for one test.
 * @returns {string} an absolute temp directory path.
 */
function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'excn-write-record-'));
}

/**
 * List the basenames in an Instance's issues directory (empty when it does not exist).
 * @param {string} root - the Instance root.
 * @returns {string[]} the directory entries.
 */
function issueFiles(root) {
  try {
    return fs.readdirSync(path.join(root, ISSUES_DIR_RELATIVE));
  } catch {
    return [];
  }
}

test('mintUuidV7 produces a canonical, version-7, unique id', () => {
  const a = mintUuidV7();
  const b = mintUuidV7();
  assert.match(a, UUIDV7_PATTERN);
  assert.match(b, UUIDV7_PATTERN);
  assert.equal(a[14], '7', 'the version nibble must be 7');
  assert.notEqual(a, b, 'two mints must differ');
});

test('deriveSlug lowercases, hyphenates, and trims edges', () => {
  assert.equal(deriveSlug('  Foo: Bar!!  Baz  '), 'foo-bar-baz');
  assert.equal(deriveSlug('Already-good-slug'), 'already-good-slug');
});

test('deriveSlug rejects a title with no slug characters', () => {
  assert.throws(() => deriveSlug('!!! ??? ...'), /no slug characters/);
});

test('writeRecord mints a valid issue file with a title-derived slug and filled defaults', () => {
  const root = makeTempRoot();
  const result = writeRecord('issue', { title: 'Add the writeRecord helper' }, { targetRoot: root });

  assert.match(result.id, UUIDV7_PATTERN);
  assert.equal(result.slug, 'add-the-writerecord-helper');
  assert.equal(path.basename(result.path), `${result.id}-${result.slug}.json`);

  const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(written.id, result.id);
  assert.equal(written.title, 'Add the writeRecord helper');
  assert.equal(written.status, 'open');
  assert.equal(written.severity, 'P3');
  assert.deepEqual(written.scope, ['unspecified']);
  assert.equal(written.actionable_now, false);
  assert.equal(written.description, '');
});

test('writeRecord rejects a record that arrives with an id on create', () => {
  const root = makeTempRoot();
  assert.throws(
    () => writeRecord('issue', { id: 'EXEC-001', title: 'Has an id' }, { targetRoot: root }),
    /must not carry an id/
  );
  assert.deepEqual(issueFiles(root), [], 'nothing is written when the id is rejected');
});

test('writeRecord rejects an unknown kind and a missing title', () => {
  const root = makeTempRoot();
  assert.throws(() => writeRecord('widget', { title: 'x' }, { targetRoot: root }), /unknown record kind/);
  assert.throws(() => writeRecord('issue', { description: 'no title' }, { targetRoot: root }), /non-empty title/);
  assert.deepEqual(issueFiles(root), []);
});

test('writeRecord rejects a schema-invalid record and writes nothing', () => {
  const root = makeTempRoot();
  assert.throws(
    () => writeRecord('issue', { title: 'Bad severity', severity: 'P9' }, { targetRoot: root }),
    /not a valid issue/
  );
  assert.deepEqual(issueFiles(root), [], 'a rejected record leaves the directory empty');
});

test('writeRecord writes atomically: no temp file remains and ids do not clobber', () => {
  const root = makeTempRoot();
  const first = writeRecord('issue', { title: 'First issue' }, { targetRoot: root });
  const second = writeRecord('issue', { title: 'Second issue' }, { targetRoot: root });

  const files = issueFiles(root);
  assert.equal(files.length, 2, 'two creates yield two distinct files');
  assert.notEqual(first.id, second.id);
  assert.ok(
    !files.some((name) => name.endsWith(RECORD_TEMP_SUFFIX)),
    'no temp file is left behind after a successful write'
  );
});

test('writeRecord accepts list and reference fields and validates them', () => {
  const root = makeTempRoot();
  const result = writeRecord(
    'issue',
    {
      title: 'Wire the channel guard',
      scope: ['src/bin', 'src/template'],
      prd: 'PRD-011',
      acceptance_criteria: ['guard denies raw writes', 'helper writes still pass'],
      actionable_now: true,
    },
    { targetRoot: root }
  );
  const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.deepEqual(written.scope, ['src/bin', 'src/template']);
  assert.equal(written.prd, 'PRD-011');
  assert.equal(written.actionable_now, true);
});

// ── EXEC-098: issue update + partition move ──────────────────────────────────

test('updateRecord flips status and rewrites the file in place', () => {
  const root = makeTempRoot();
  const created = writeRecord(RECORD_KIND.ISSUE, { title: 'Status flip' }, { targetRoot: root });
  const result = updateRecord(RECORD_KIND.ISSUE, created.id, { status: 'in_progress' }, { targetRoot: root });

  assert.equal(result.path, created.path, 'a non-moving update keeps the same path');
  assert.equal(result.movedFrom, null);
  assert.equal(JSON.parse(fs.readFileSync(result.path, 'utf8')).status, 'in_progress');
});

test('updateRecord rejects an attempt to change the id', () => {
  const root = makeTempRoot();
  const created = writeRecord(RECORD_KIND.ISSUE, { title: 'Immutable id' }, { targetRoot: root });
  assert.throws(
    () => updateRecord(RECORD_KIND.ISSUE, created.id, { id: 'EXEC-001' }, { targetRoot: root }),
    /id is immutable/
  );
});

test('updateRecord resolves an issue by short id prefix', () => {
  const root = makeTempRoot();
  const created = writeRecord(RECORD_KIND.ISSUE, { title: 'Prefix lookup' }, { targetRoot: root });
  const result = updateRecord(RECORD_KIND.ISSUE, created.id.slice(0, 8), { notes: 'touched' }, { targetRoot: root });
  assert.equal(result.id, created.id);
  assert.equal(JSON.parse(fs.readFileSync(result.path, 'utf8')).notes, 'touched');
});

test('updateRecord relocates the file into a sprint partition on assigned_sprint', () => {
  const root = makeTempRoot();
  const created = writeRecord(RECORD_KIND.ISSUE, { title: 'Move into sprint' }, { targetRoot: root });
  const basename = path.basename(created.path);
  const result = updateRecord(RECORD_KIND.ISSUE, created.id, { assigned_sprint: 9 }, { targetRoot: root });

  assert.equal(result.movedFrom, created.path);
  assert.ok(!fs.existsSync(created.path), 'the old backlog file is gone after the move');
  assert.equal(result.path, path.join(root, ISSUES_DIR_RELATIVE, 'sprint-9', basename), 'frozen basename preserved in the partition');
  assert.equal(JSON.parse(fs.readFileSync(result.path, 'utf8')).assigned_sprint, 9);
});

test('updateRecord throws on an unknown id', () => {
  const root = makeTempRoot();
  writeRecord(RECORD_KIND.ISSUE, { title: 'Some issue' }, { targetRoot: root });
  assert.throws(() => updateRecord(RECORD_KIND.ISSUE, 'EXEC-999', { status: 'closed' }, { targetRoot: root }), /no issue found/);
});

// ── EXEC-099: sprint authoring + step_log append ─────────────────────────────

test('writeRecord(sprint) writes a valid sprint file in canonical-sentinel order', () => {
  const root = makeTempRoot();
  const result = writeRecord(RECORD_KIND.SPRINT, makeSprint({ step_log: [] }), { targetRoot: root });

  assert.equal(result.path, path.join(root, SPRINTS_DIR_RELATIVE, 'sprint_9.json'));
  const keys = Object.keys(JSON.parse(fs.readFileSync(result.path, 'utf8')));
  assert.equal(keys[keys.length - 1], SPRINT_SENTINEL_KEY, 'the sentinel key is dead-last');
  assert.equal(keys[keys.length - 2], SPRINT_STEP_LOG_FIELD, 'step_log is the last accreting array, just before the sentinel');
});

test('serializeSprint fails closed on a key it cannot place', () => {
  assert.throws(() => serializeSprint(makeSprint({ surprise: true })), /not in the canonical order/);
});

test('appendStepLog adds one entry as a minimal, sibling-stable diff', () => {
  const root = makeTempRoot();
  writeRecord(RECORD_KIND.SPRINT, makeSprint({ step_log: [makeStep('code_standards_pass')] }), { targetRoot: root });
  const sprintPath = path.join(root, SPRINTS_DIR_RELATIVE, 'sprint_9.json');
  const before = fs.readFileSync(sprintPath, 'utf8');

  const result = appendStepLog(9, makeStep('package_qa_pass'), { targetRoot: root });
  const after = fs.readFileSync(sprintPath, 'utf8');

  assert.equal(result.entries, 2);
  const parsed = JSON.parse(after);
  assert.equal(parsed.step_log.length, 2);
  assert.deepEqual(parsed.step_log[0], makeStep('code_standards_pass'), 'the sibling entry is untouched');

  // The prefix up to the step_log open, and the tail from the array close onward (the
  // sentinel + closing brace), are byte-identical — only the entries region grew.
  const openMarker = '  "step_log": [\n';
  const prefixLength = before.indexOf(openMarker) + openMarker.length;
  assert.equal(after.slice(0, prefixLength), before.slice(0, prefixLength), 'prefix through step_log open is stable');
  const closeMarker = '\n  ],\n';
  assert.equal(after.slice(after.lastIndexOf(closeMarker)), before.slice(before.lastIndexOf(closeMarker)), 'tail from the array close (sentinel + brace) is stable');
});

test('appendStepLog throws when the sprint file is missing', () => {
  const root = makeTempRoot();
  assert.throws(() => appendStepLog(9, makeStep('x'), { targetRoot: root }), /cannot read sprint 9/);
});

// ── uuid command ─────────────────────────────────────────────────────────────

test('`to-execution uuid` prints one fresh UUIDv7', () => {
  const out = execFileSync(process.execPath, [CLI_PATH, 'uuid'], { encoding: 'utf8' }).trim();
  assert.match(out, UUIDV7_PATTERN);
});
