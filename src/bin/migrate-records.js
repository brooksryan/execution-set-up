'use strict';

// to-execution migrate-records — the one-time cutover from the legacy monolith layout to the
// per-file UUIDv7 tracker (EXEC-102, PRD-011, ADR-0011). Distinct from `migrate`, which stays
// location-only (ADR-0008). It (1) splits the open backlog.json and each sprint-<N>-issues.json
// collection into per-file <id>-<slug>.json records, GRANDFATHERING existing EXEC-NNN ids
// (never rewriting an id), and (2) retrofits each sprint_<N>.json to canonical-sentinel form.
// All writes go through the writeRecord helpers (fs writes, never the agent Write tool — so the
// channel guard never blocks the migration). Safety, from the postmortems:
//  - Idempotent: a second run is a no-op; an existing per-file record is never clobbered.
//  - Verify-before-destroy: every issue in a monolith must re-read schema-valid as a per-file
//    record BEFORE that monolith is deleted; a single failure aborts the delete (the source
//    survives, recoverable). Sprint retrofit overwrites in place — nothing is deleted.
// The caller (cli.js) resolves the repo root by absolute path (git rev-parse --show-toplevel),
// never an inherited cwd (the phantom-wipe lesson); this module takes that root as input.

const fs = require('fs');
const path = require('path');
const { writeRecord, writeExistingRecord, recordIsValid } = require('./write-record');
const {
  RECORD_KIND,
  ISSUES_DIR_RELATIVE,
  SPRINTS_DIR_RELATIVE,
  ISSUE_PARTITION_PREFIX,
  ISSUE_COLLECTION_FIELD,
  LEGACY_BACKLOG_BASENAME,
  LEGACY_SPRINT_ISSUES_SUFFIX,
  PARTITION_DIR_PATTERN,
  SPRINT_FILE_PATTERN,
} = require('./write-policy');

// The partition a backlog issue belongs to: none — it stays at the issues-home root.
const BACKLOG_PARTITION = null;

/**
 * Read and parse a JSON file.
 * @param {string} filePath - absolute path.
 * @returns {*} the parsed value.
 * @throws {Error} when the file is missing or unparseable (the caller decides whether that is
 *   fatal or a skip).
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Split one legacy issue collection into per-file records, then delete the monolith only once
 * every record re-reads schema-valid on disk (verify-before-destroy). An existing per-file
 * record is skipped, never clobbered (idempotent).
 * @param {string} targetRoot - absolute repo root.
 * @param {string} monolithPath - absolute path of the collection file.
 * @param {number|null} partition - the sprint number whose partition the records land in, or
 *   BACKLOG_PARTITION for the issues-home root.
 * @returns {{ source: string, written: string[], skipped: string[], deleted: boolean, failures: string[] }}
 * @throws {Error} when the monolith is unreadable or not a {issues:[]} collection.
 */
function splitCollection(targetRoot, monolithPath, partition) {
  const sourceRel = path.relative(targetRoot, monolithPath);
  const collection = readJson(monolithPath);
  const issues = collection && collection[ISSUE_COLLECTION_FIELD];
  if (!Array.isArray(issues)) {
    throw new Error(`${sourceRel} is not an issue collection ({${ISSUE_COLLECTION_FIELD}: [...]}); refusing to split`);
  }

  const written = [];
  const skipped = [];
  const verified = [];
  for (const issue of issues) {
    const result = writeExistingRecord(RECORD_KIND.ISSUE, issue, { targetRoot, partition });
    (result.written ? written : skipped).push(result.id);
    verified.push(result.path);
  }

  // Verify-before-destroy: every per-file record must exist and re-read schema-valid before
  // the monolith is deleted, so a botched write never costs data.
  const failures = [];
  for (const recordPath of verified) {
    let valid = false;
    try {
      valid = recordIsValid(RECORD_KIND.ISSUE, readJson(recordPath));
    } catch {
      valid = false; // unreadable/unparseable counts as a verification failure
    }
    if (!valid) failures.push(path.relative(targetRoot, recordPath));
  }

  let deleted = false;
  if (failures.length === 0) {
    fs.rmSync(monolithPath);
    deleted = true;
  }
  return { source: sourceRel, written, skipped, deleted, failures };
}

/**
 * Discover and split every legacy issue collection under the issues home: backlog.json at the
 * root (BACKLOG_PARTITION) and each sprint-<N>/sprint-<N>-issues.json companion (partition N).
 * @param {string} targetRoot - absolute repo root.
 * @returns {Array<object>} one splitCollection report per monolith found (empty when none).
 */
function splitAllCollections(targetRoot) {
  const issuesDir = path.join(targetRoot, ISSUES_DIR_RELATIVE);
  const reports = [];

  const backlogPath = path.join(issuesDir, LEGACY_BACKLOG_BASENAME);
  if (fs.existsSync(backlogPath)) {
    reports.push(splitCollection(targetRoot, backlogPath, BACKLOG_PARTITION));
  }

  let entries;
  try {
    entries = fs.readdirSync(issuesDir, { withFileTypes: true });
  } catch {
    return reports; // no issues home yet — nothing more to split
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const partitionMatch = PARTITION_DIR_PATTERN.exec(entry.name);
    if (!partitionMatch) continue;
    const partition = Number(partitionMatch[1]);
    const companion = path.join(issuesDir, entry.name, `${ISSUE_PARTITION_PREFIX}${partition}${LEGACY_SPRINT_ISSUES_SUFFIX}`);
    if (fs.existsSync(companion)) {
      reports.push(splitCollection(targetRoot, companion, partition));
    }
  }
  return reports;
}

/**
 * Retrofit every sprint_<N>.json to canonical-sentinel form by re-writing it through the
 * helper (validate → canonical-sentinel serialize → atomic overwrite). Content-idempotent: a
 * re-run produces byte-identical output. Nothing is deleted.
 * @param {string} targetRoot - absolute repo root.
 * @returns {Array<{ source: string, sprintId: number }>} one entry per retrofitted sprint.
 * @throws {Error} when a sprint file is unreadable or fails schema validation.
 */
function retrofitSprints(targetRoot) {
  const sprintsDir = path.join(targetRoot, SPRINTS_DIR_RELATIVE);
  let entries;
  try {
    entries = fs.readdirSync(sprintsDir, { withFileTypes: true });
  } catch {
    return []; // no sprints home — nothing to retrofit
  }
  const retrofitted = [];
  for (const entry of entries) {
    if (!entry.isFile() || !SPRINT_FILE_PATTERN.test(entry.name)) continue;
    const sprintPath = path.join(sprintsDir, entry.name);
    const result = writeRecord(RECORD_KIND.SPRINT, readJson(sprintPath), { targetRoot });
    retrofitted.push({ source: path.relative(targetRoot, sprintPath), sprintId: result.sprintId });
  }
  return retrofitted;
}

/**
 * Run the one-time records migration over an absolute repo root: split every issue collection
 * (verify-before-destroy, no-clobber) and retrofit every sprint record to canonical-sentinel
 * form. Idempotent — a fully-migrated tree yields empty splits and content-identical sprint
 * rewrites.
 * @param {object} opts - { targetRoot } the absolute repo root (resolved by the caller).
 * @returns {{ collections: object[], sprints: object[], aborted: object[] }} the per-monolith
 *   split reports, the sprint retrofit reports, and any collections left undeleted on a
 *   verification failure.
 * @throws {Error} when targetRoot is missing, or a collection/sprint is malformed.
 */
function migrateRecords(opts = {}) {
  const targetRoot = opts.targetRoot;
  if (typeof targetRoot !== 'string' || targetRoot === '') {
    throw new Error('migrateRecords needs an absolute targetRoot');
  }
  const collections = splitAllCollections(targetRoot);
  const sprints = retrofitSprints(targetRoot);
  const aborted = collections.filter((report) => !report.deleted);
  return { collections, sprints, aborted };
}

module.exports = { migrateRecords };
