'use strict';

// hook-lib — shared plumbing for the stamped per-feature hook scripts (ADR-0006).
// Contract: hooks are remind-only and FAIL SAFE. Any missing or malformed config,
// unexpected payload, or internal error must end in exit 0 with no output — never a
// block, never a diagnostic the agent has to wade through. This deliberately inverts
// the fail-closed CLI rule (PRD-007 testing decision): a decayed hook must not stop
// work; decay surfaces through the health check, not through hook failures.
// Node builtins only.

const fs = require('fs');
const path = require('path');

// The schema-validated toggle config the Scaffolder seeds into the Instance.
const CONFIG_RELATIVE_PATH = path.join('.excn', 'hooks.config.json');

// Hook payloads arrive as one JSON document on stdin (fd 0).
const STDIN_FD = 0;

/**
 * Read and parse the hook payload from stdin.
 * @returns {object|null} the payload object, or null on any read/parse failure or a
 * non-object document (fail safe — callers treat null as "exit 0, do nothing").
 */
function readPayload() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STDIN_FD, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // fail safe: an unreadable payload means this hook does nothing
  }
}

/**
 * Read and parse a JSON file.
 * @param {string} filePath - absolute path of the JSON file.
 * @returns {object|null} the parsed object, or null if missing/unparseable/non-object
 * (fail safe — absence and corruption are equivalent to "no data").
 */
function readJsonSafe(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // fail safe: missing or malformed file reads as no data
  }
}

/**
 * Decide whether a hook feature is enabled in the Instance's toggle config.
 * @param {string} projectRoot - the Instance root (the hook payload's cwd).
 * @param {string} feature - feature key in the config's `features` map.
 * @returns {boolean} true only when the config parses and carries `true` for the
 * feature; a missing/malformed config or non-boolean value reads as disabled.
 */
function featureEnabled(projectRoot, feature) {
  const config = readJsonSafe(path.join(projectRoot, CONFIG_RELATIVE_PATH));
  return Boolean(config && config.features && config.features[feature] === true);
}

/**
 * Write a JSON file atomically (temp + rename), so concurrent teammate sessions never
 * observe a half-written state file.
 * @param {string} filePath - absolute destination path.
 * @param {object} data - the object to serialize.
 * @returns {void}
 * @throws Propagates fs errors — callers sit inside the script-level fail-safe catch.
 */
function atomicWriteJson(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

/**
 * Emit a hook decision document on stdout (the channel Claude Code reads decisions
 * from; these scripts have no other stdout output).
 * @param {object} decision - the hook-output object to serialize.
 * @returns {void}
 */
function emit(decision) {
  process.stdout.write(JSON.stringify(decision));
}

module.exports = { readPayload, readJsonSafe, featureEnabled, atomicWriteJson, emit };
