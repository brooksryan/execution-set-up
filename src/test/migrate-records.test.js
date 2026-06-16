'use strict';

// Unit + integration tests for the one-time migrate-records command (EXEC-102, PRD-011).
// Run with `node --test` from src/ (so require('ajv') resolves against src/node_modules).
// Covers the record ACs: split grandfathers legacy ids, sprint retrofit to canonical-sentinel,
// idempotent re-run, no-clobber, verify-before-destroy, and absolute-path (git) resolution.
// These tests live outside the package `files` set, so they are not published.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { migrateRecords } = require('../bin/migrate-records');
const { SPRINT_SENTINEL_KEY } = require('../bin/write-policy');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const ISSUES_DIR_RELATIVE = '.excn/issues';
const SPRINTS_DIR_RELATIVE = '.excn/sprints';

/**
 * Make a throwaway repo root (symlinks resolved, so a git toplevel comparison holds).
 * @returns {string} an absolute temp directory path.
 */
function makeTempRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'excn-migrate-')));
}

/**
 * A full, schema-valid issue record carrying a legacy id.
 * @param {string} id - the legacy id (e.g. EXEC-097).
 * @param {string} title - the issue title.
 * @param {number|null} assignedSprint - assigned_sprint value.
 * @returns {object} the issue record.
 */
function makeIssue(id, title, assignedSprint) {
  return {
    id,
    title,
    status: 'open',
    severity: 'P2',
    scope: ['cli'],
    actionable_now: true,
    description: 'legacy issue',
    assigned_sprint: assignedSprint,
  };
}

/**
 * Write an issue collection file ({schema_version, issues:[]}).
 * @param {string} filePath - absolute destination.
 * @param {object[]} issues - the issues.
 * @returns {void}
 */
function writeCollection(filePath, issues) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ schema_version: '1.0', issues }, null, 2)}\n`);
}

/**
 * Write a minimal schema-valid sprint record (deliberately NOT in canonical order, so the
 * retrofit has something to reorder).
 * @param {string} root - the repo root.
 * @param {number} sprintId - the sprint id.
 * @returns {string} the sprint file path.
 */
function writeSprintFile(root, sprintId) {
  const record = {
    sprint_id: sprintId,
    schema_version: '1.0', // first here; the retrofit moves it dead-last
    name: `Sprint ${sprintId}`,
    status: 'closed',
    dates: { start: '2026-06-16', end: '2026-06-16', duration_note: null },
    team: [{ name: 'builder', role: 'Builder', owns: 'src/bin' }],
    goal: 'Legacy sprint.',
    issues_addressed: [],
    shipped: [],
    in_progress: [],
    not_shipped: [],
    defects_discovered: [],
    decisions: [],
    retrospective_notes: [],
  };
  const filePath = path.join(root, SPRINTS_DIR_RELATIVE, `sprint_${sprintId}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return filePath;
}

/**
 * List per-record issue file basenames at a directory (empty when absent).
 * @param {string} dir - absolute directory.
 * @returns {string[]} the entries.
 */
function listFiles(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

test('splits collections into per-file records, grandfathering legacy ids', () => {
  const root = makeTempRoot();
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json'), [
    makeIssue('EXEC-201', 'First legacy issue', null),
    makeIssue('EXEC-202', 'Second legacy issue', null),
  ]);
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'sprint-9', 'sprint-9-issues.json'), [
    makeIssue('EXEC-097', 'In a sprint partition', 9),
  ]);

  const report = migrateRecords({ targetRoot: root });

  assert.equal(report.aborted.length, 0);
  // Backlog records land at the issues-home root, keeping their legacy ids in the filename.
  assert.deepEqual(listFiles(path.join(root, ISSUES_DIR_RELATIVE)).filter((n) => n.endsWith('.json')), [
    'EXEC-201-first-legacy-issue.json',
    'EXEC-202-second-legacy-issue.json',
  ]);
  // Partition record lands under sprint-9/, monolith gone.
  assert.deepEqual(listFiles(path.join(root, ISSUES_DIR_RELATIVE, 'sprint-9')), ['EXEC-097-in-a-sprint-partition.json']);
  assert.ok(!fs.existsSync(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json')), 'backlog monolith deleted');
  // The id inside the per-file record is preserved verbatim (not rewritten to a uuid).
  const split = JSON.parse(fs.readFileSync(path.join(root, ISSUES_DIR_RELATIVE, 'EXEC-201-first-legacy-issue.json'), 'utf8'));
  assert.equal(split.id, 'EXEC-201');
});

test('retrofits sprint records to canonical-sentinel form', () => {
  const root = makeTempRoot();
  const sprintPath = writeSprintFile(root, 9);
  migrateRecords({ targetRoot: root });
  const keys = Object.keys(JSON.parse(fs.readFileSync(sprintPath, 'utf8')));
  assert.equal(keys[keys.length - 1], SPRINT_SENTINEL_KEY, 'schema_version is moved dead-last');
});

test('is idempotent — a second run splits nothing and rewrites sprints identically', () => {
  const root = makeTempRoot();
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json'), [makeIssue('EXEC-201', 'Only issue', null)]);
  const sprintPath = writeSprintFile(root, 9);

  migrateRecords({ targetRoot: root });
  const afterFirst = fs.readFileSync(sprintPath, 'utf8');
  const second = migrateRecords({ targetRoot: root });

  assert.equal(second.collections.length, 0, 'no collections remain to split on the second run');
  assert.equal(fs.readFileSync(sprintPath, 'utf8'), afterFirst, 'sprint rewrite is byte-identical');
});

test('never clobbers an existing per-file record', () => {
  const root = makeTempRoot();
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json'), [makeIssue('EXEC-201', 'Only issue', null)]);
  // Pre-place the destination per-file record with distinct (but valid) content.
  const destination = path.join(root, ISSUES_DIR_RELATIVE, 'EXEC-201-only-issue.json');
  const preExisting = makeIssue('EXEC-201', 'Only issue', null);
  preExisting.description = 'pre-existing — must not be clobbered';
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(preExisting, null, 2)}\n`);

  const report = migrateRecords({ targetRoot: root });

  assert.equal(report.collections[0].written.length, 0, 'nothing written');
  assert.deepEqual(report.collections[0].skipped, ['EXEC-201'], 'the record is skipped, not clobbered');
  assert.equal(JSON.parse(fs.readFileSync(destination, 'utf8')).description, 'pre-existing — must not be clobbered');
  assert.ok(!fs.existsSync(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json')), 'monolith deleted — record verified valid');
});

test('verify-before-destroy keeps the monolith when a record fails to verify', () => {
  const root = makeTempRoot();
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json'), [makeIssue('EXEC-201', 'Only issue', null)]);
  // Pre-place an INVALID per-file record at the destination: no-clobber leaves it, then the
  // verify pass must catch it and refuse to delete the monolith.
  const destination = path.join(root, ISSUES_DIR_RELATIVE, 'EXEC-201-only-issue.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify({ id: 'EXEC-201', severity: 'NOT-A-SEVERITY' }, null, 2)}\n`);

  const report = migrateRecords({ targetRoot: root });

  assert.equal(report.aborted.length, 1, 'the failed collection is reported aborted');
  assert.equal(report.collections[0].deleted, false);
  assert.ok(report.collections[0].failures.length > 0, 'the invalid record is named as a verification failure');
  assert.ok(fs.existsSync(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json')), 'monolith KEPT — source survives');
});

test('migrateRecords requires an absolute targetRoot', () => {
  assert.throws(() => migrateRecords({}), /needs an absolute targetRoot/);
});

test('the CLI resolves the repo root by git from a subdirectory (absolute-path)', () => {
  const root = makeTempRoot();
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeCollection(path.join(root, ISSUES_DIR_RELATIVE, 'backlog.json'), [makeIssue('EXEC-201', 'Resolve from subdir', null)]);
  const subdir = path.join(root, 'src', 'bin');
  fs.mkdirSync(subdir, { recursive: true });

  // Run from a nested subdir: the command must resolve the repo root (git toplevel), not cwd.
  const out = execFileSync(process.execPath, [CLI_PATH, 'migrate-records'], { cwd: subdir, encoding: 'utf8' });

  assert.match(out, /Migrated records in/);
  assert.ok(
    fs.existsSync(path.join(root, ISSUES_DIR_RELATIVE, 'EXEC-201-resolve-from-subdir.json')),
    'the record was written under the repo root, not the subdir'
  );
  assert.ok(!fs.existsSync(path.join(subdir, ISSUES_DIR_RELATIVE)), 'nothing was written under the inherited cwd');
});
