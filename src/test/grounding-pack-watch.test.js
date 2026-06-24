'use strict';

// Behavioral tests for the grounding-pack-watch hook (sprint-11 S4 — the feature-flagged Grounding
// Pack staleness hook). Run with `node --test` from src/. Each test stamps a throwaway Instance
// (real schemas/CONTEXT.md/ADRs copied in), optionally symlinks this package in as node_modules/
// to-execution so the hook can resolve the S2 regenerator, sets the toggle, and invokes the stamped
// hook as a subprocess with a PostToolUse payload. Asserts the S4 contract: flag off → no-op, no
// pack; an unresolvable regenerator (the dogfood reality) → exit 0, no block, an `error` logged, no
// pack; a source newer-or-equal than an existing pack → the hook regenerates it IN ITS OWN PROCESS
// (the subprocess writes the pack — there is no Claude here, so the write is necessarily in-process).
// These tests live outside the package `files` set, so they are not published.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SRC_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOK_PATH = path.join(SRC_DIR, 'template', '.claude', 'hooks', 'grounding-pack-watch.cjs');
const HOOK_SCRIPT_NAME = 'grounding-pack-watch.cjs';

const PACK_RELATIVE = path.join('.excn', 'runtime', 'grounding-pack.json');
const STATE_RELATIVE = path.join('.excn', 'runtime', 'grounding-pack-watch_progress.json');
const INVOCATION_LOG_RELATIVE = path.join('.excn', 'runtime', 'hook-invocations_progress.json');
const PACK_EXPECTED_KEYS = ['adr_index', 'cli_stamp', 'glossary_terms', 'pack_version', 'schema_digest', 'uuid_pool'];

/**
 * Stamp a throwaway Instance: copy the repo's real pack sources in, write a hooks.config.json with
 * the grounding_pack toggle set, and (optionally) symlink this package as node_modules/to-execution
 * so the hook can resolve the S2 regenerator.
 * @param {object} opts - { flag: boolean, linkPackage: boolean }.
 * @returns {string} the absolute Instance root.
 */
function makeInstance(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-watch-'));
  fs.mkdirSync(path.join(root, '.excn', 'runtime'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'schemas'), path.join(root, '.excn', 'schemas'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'adr'), path.join(root, '.excn', 'adr'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, '.excn', 'CONTEXT.md'), path.join(root, '.excn', 'CONTEXT.md'));
  fs.writeFileSync(
    path.join(root, '.excn', 'hooks.config.json'),
    JSON.stringify({ schema_version: '1.0', features: { grounding_pack: opts.flag } }),
  );
  if (opts.linkPackage) {
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.symlinkSync(SRC_DIR, path.join(root, 'node_modules', 'to-execution'), 'dir');
  }
  return root;
}

/**
 * Run the stamped hook as a subprocess with a PostToolUse(Write) payload for the Instance.
 * @param {string} root - the Instance root (becomes payload.cwd).
 * @returns {{status: number, stdout: string}} the exit code and captured stdout.
 */
function runHook(root) {
  const payload = {
    cwd: root,
    session_id: 's-1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, '.excn', 'CONTEXT.md') },
  };
  const result = spawnSync('node', [HOOK_PATH], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout };
}

test('flag off → no-op: the pack is never written and nothing is emitted', () => {
  const root = makeInstance({ flag: false, linkPackage: true });
  const { status, stdout } = runHook(root);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), '', 'a regenerate-class hook emits no decision');
  assert.equal(fs.existsSync(path.join(root, PACK_RELATIVE)), false, 'no pack when the feature is off');
});

test('unresolvable regenerator (dogfood) → exit 0, no block, error logged, no pack', () => {
  const root = makeInstance({ flag: true, linkPackage: false }); // no node_modules/to-execution
  const { status, stdout } = runHook(root);
  assert.equal(status, 0, 'fail-safe: a broken regenerator never blocks');
  assert.equal(stdout.trim(), '', 'no decision emitted on failure');
  assert.equal(fs.existsSync(path.join(root, PACK_RELATIVE)), false, 'nothing written when resolution fails');

  const log = JSON.parse(fs.readFileSync(path.join(root, INVOCATION_LOG_RELATIVE), 'utf8'));
  const errors = log.records.filter((r) => r.script === HOOK_SCRIPT_NAME && r.outcome === 'error');
  assert.ok(errors.length >= 1, 'the swallowed failure is logged exactly as an error outcome');
});

test('a source newer-or-equal than an existing pack → regenerate fires in-process', () => {
  const root = makeInstance({ flag: true, linkPackage: true });
  const packPath = path.join(root, PACK_RELATIVE);
  // Pre-create a stale placeholder pack and age its mtime into the past, so every (current-mtime)
  // source is newer-or-equal — the deterministic staleness trigger (>= comparison).
  fs.writeFileSync(packPath, JSON.stringify({ stale: true }));
  const pastSeconds = Math.floor((Date.now() - 100000) / 1000);
  fs.utimesSync(packPath, pastSeconds, pastSeconds);

  const { status, stdout } = runHook(root);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), '', 'a regenerate-class hook emits no decision');

  // The subprocess (no Claude in the loop) rewrote the pack: proof the write is in-process.
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  assert.deepEqual(Object.keys(pack).sort(), PACK_EXPECTED_KEYS, 'a full S2 pack replaced the placeholder');
  assert.ok(Array.isArray(pack.uuid_pool) && pack.uuid_pool.length > 0, 'real pool minted');
  assert.ok(fs.statSync(packPath).mtimeMs > pastSeconds * 1000, 'pack mtime advanced past the aged placeholder');

  // The clock-rollback fallback baseline was recorded.
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_RELATIVE), 'utf8'));
  assert.equal(typeof state.source_hash, 'string');
  assert.ok(state.source_hash.length > 0, 'source digest baseline recorded for the fallback');
});

test('a fresh pack (newer than every source) → no-op, pack untouched', () => {
  const root = makeInstance({ flag: true, linkPackage: true });
  const packPath = path.join(root, PACK_RELATIVE);
  // First firing: absent pack → regenerate. The pack is now the newest artifact.
  runHook(root);
  assert.ok(fs.existsSync(packPath), 'first firing created the pack');
  const firstMtime = fs.statSync(packPath).mtimeMs;

  // Age every source below the pack so neither mtime nor the recorded hash reports staleness.
  const past = Math.floor((firstMtime - 5000) / 1000);
  for (const rel of ['schemas', 'adr']) {
    const dir = path.join(root, '.excn', rel);
    for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), past, past);
  }
  fs.utimesSync(path.join(root, '.excn', 'CONTEXT.md'), past, past);

  const { status } = runHook(root);
  assert.equal(status, 0);
  assert.equal(fs.statSync(packPath).mtimeMs, firstMtime, 'a fresh pack is left untouched (no rewrite)');
});
