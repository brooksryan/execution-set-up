#!/usr/bin/env node
'use strict';

// to-execution — stamps the invariant layout into a target project.
// The Setup Skill runs this; the agent only writes the variant (grilled) files afterward.
// Contract: `init [target]` copies template/ into target, never overwriting an existing
// file unless --force, wires the framework pointer block (append-only, even under
// --force) into the target's CLAUDE.md / AGENTS.md, and records the framework version
// plus stamped-form hashes in a version marker. `update [target]` re-stamps only
// invariant files at the installed version: variant files and work-tracking state are
// never touched, and an invariant file that drifted from its recorded stamped form is
// reported and left in place. `doctor [target]` reports per-feature hook health
// (enabled / firing / stale / broken), toggle-config validity, dead settings commands
// and .js/.cjs hook twins (EXEC-087), and outdated detection (recorded vs installed
// framework version); it exits non-zero only on an unstamped target — a degraded
// Instance is a report, not a failure. Diagnostics to stderr,
// results to stdout, non-zero exit on any failure. Node builtins only, except the
// `validate` verb, which uses ajv (a real dependency, EXEC-081) lazily required so the
// other verbs stay builtin-only; pointer-block content, the update file-policy, the
// health-check policy, and the schema-detection rules live in the sibling data modules.

const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { POINTER_FILES, POINTER_SENTINEL, CODEX_CHAIN_CAP, POINTER_BLOCK } = require('./pointer-block');
const {
  VARIANT_FILES,
  WORK_TRACKING_DIR_PREFIXES,
  PROGRESS_FILE_SUFFIX,
  VERSION_MARKER_PATH,
  MARKER_SCHEMA_VERSION,
} = require('./stamp-policy');
const {
  RUNTIME_RECORD_BASENAMES,
  PROGRESS_HOME,
  RUNTIME_HOME,
  LEGACY_RECORD_DIR,
  MIGRATION_ID,
  HOOK_DIR,
  HOOK_SETTINGS_FILE,
  CJS_HOOK_EXTENSION,
  HOOK_CJS_MIGRATION_ID,
  HOOK_CONTENT_REWRITES,
  HOOK_COMMAND_REWRITE,
} = require('./migrate-policy');
const {
  HOOK_FEATURES,
  INVOCATION_LOG_PATH,
  SETTINGS_PATH,
  HOOKS_DIR,
  HOOKS_CONFIG_PATH,
  HOOKS_CONFIG_SCHEMA_PATH,
  LEGACY_HOOK_EXTENSION,
  HOOK_COMMAND_SCRIPT_PATTERN,
  HEARTBEAT_FRESH_MS,
  VIEWER_HEALTH_HOST,
  VIEWER_HEALTH_PATH,
  VIEWER_PROBE_TIMEOUT_MS,
  VIEWER_HEALTH_OK_STATUS,
} = require('./health-policy');
const { SCHEMA_DIR_RELATIVE, DETECTION_RULES } = require('./validate-policy');

// Package root is one level up from bin/; the template ships beside it.
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'template');

// npm pack treats an in-package .gitignore as an ignore spec and strips it, so the
// template ships the file un-dotted as `gitignore`; stamping restores the real name.
const SHIPPED_GITIGNORE_NAME = 'gitignore';
const STAMPED_GITIGNORE_NAME = '.gitignore';

// Unit conversions for doctor's human-readable heartbeat ages.
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

// First positional arg that is not a flag selects the target; this prefix marks a flag.
const FLAG_PREFIX = '-';
const FORCE_FLAG = '--force';
const SCHEMA_FLAG = '--schema';

// Where the canonical schemas ship inside the package (beside the template the bin
// stamps); validate resolves auto-detected schemas here, so the npm-installed package
// validates without locating the Instance or ad-hoc-installing anything.
const SCHEMAS_DIR = path.join(TEMPLATE_DIR, SCHEMA_DIR_RELATIVE);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * List every file under a directory tree, as paths relative to its root.
 * @param {string} dir - directory to scan (recursed).
 * @param {string} [root=dir] - tree root the returned paths are relative to.
 * @returns {string[]} relative file paths (directories are descended, not listed).
 */
function listFilesRecursive(dir, root = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(absolutePath, root));
    else files.push(path.relative(root, absolutePath));
  }
  return files;
}

/**
 * Resolve a template-relative path to its stamped destination name, restoring the
 * dotted `.gitignore` that npm pack strips on publish (see SHIPPED_GITIGNORE_NAME).
 * @param {string} relativePath - path of a template file, relative to TEMPLATE_DIR.
 * @returns {string} the destination-relative path to write under the target.
 */
function stampedDestination(relativePath) {
  if (path.basename(relativePath) !== SHIPPED_GITIGNORE_NAME) return relativePath;
  return path.join(path.dirname(relativePath), STAMPED_GITIGNORE_NAME);
}

/**
 * Hash file content for stamped-form drift detection. SHA-256 is overkill for
 * integrity but ubiquitous and stable across Node versions.
 * @param {Buffer|string} content - file content to hash.
 * @returns {string} lowercase hex digest.
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Classify a stamped-destination relative path against the update file-policy.
 * @param {string} destinationRel - stamped path relative to the target root.
 * @returns {'invariant'|'variant'|'work-tracking'} the update-policy class.
 */
function classifyStampedPath(destinationRel) {
  // Policy paths are POSIX-separated; normalize so matching works on Windows too.
  const posixPath = destinationRel.split(path.sep).join('/');
  if (posixPath.endsWith(PROGRESS_FILE_SUFFIX)) return 'work-tracking';
  if (WORK_TRACKING_DIR_PREFIXES.some((prefix) => posixPath.startsWith(prefix))) return 'work-tracking';
  if (VARIANT_FILES.includes(posixPath)) return 'variant';
  return 'invariant';
}

/**
 * Read the installed package's version from package.json beside the template.
 * @returns {string} the framework version that would stamp right now.
 * @throws Exits non-zero (after a stderr message) if package.json is unreadable.
 */
function installedVersion() {
  const manifest = path.join(PACKAGE_ROOT, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  } catch (cause) {
    process.stderr.write(`error: cannot read installed version from ${manifest}: ${cause.message}\n`);
    process.exit(1);
  }
}

/**
 * Write the version marker into the target: the stamping framework version plus
 * the stamped-form hash of every invariant file, keyed by stamped relative path.
 * The marker is what `update` later reads to detect local drift.
 * @param {string} target - absolute path of the target project root.
 * @param {string} version - framework version to record.
 * @param {Object<string,string>} files - invariant path → sha256 of stamped form.
 * @returns {void}
 */
function writeVersionMarker(target, version, files) {
  const marker = {
    schema_version: MARKER_SCHEMA_VERSION,
    framework_version: version,
    stamped: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(target, VERSION_MARKER_PATH), `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Wire the framework pointer block into the target's manifest files.
 * If neither manifest exists, both are created carrying the block. Otherwise each
 * existing manifest gets the block appended (idempotent: a file already containing
 * the sentinel is left untouched). Append-only — never overwrites existing content,
 * even under --force. Warns on stderr when AGENTS.md exceeds the Codex chain cap.
 * @param {string} target - absolute path of the target project root.
 * @returns {string[]} human-readable report lines describing each action taken.
 */
function wirePointers(target) {
  const report = [];
  const existing = POINTER_FILES.filter((name) => fs.existsSync(path.join(target, name)));

  if (existing.length === 0) {
    for (const name of POINTER_FILES) {
      fs.writeFileSync(path.join(target, name), `${POINTER_BLOCK}\n`);
      report.push(`created ${name} (pointer)`);
    }
    return report;
  }

  for (const name of existing) {
    const file = path.join(target, name);
    const current = fs.readFileSync(file, 'utf8');
    if (current.includes(POINTER_SENTINEL)) {
      report.push(`${name}: pointer already present`);
    } else {
      // Separate the appended block from prior content: nothing if the file is empty,
      // one newline if it already ends in one, two to guarantee a blank-line gap.
      const separator = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
      fs.appendFileSync(file, `${separator}${POINTER_BLOCK}\n`);
      report.push(`${name}: pointer appended`);
    }
    if (name === 'AGENTS.md') {
      const size = fs.statSync(file).size;
      if (size > CODEX_CHAIN_CAP) {
        process.stderr.write(
          `warning: AGENTS.md is ${size} bytes — Codex truncates instruction chains at 32 KiB (project_doc_max_bytes default).\n`
        );
      }
    }
  }
  return report;
}

/**
 * Validate a document against the subset of JSON Schema draft-07 the stamped
 * hooks-config schema uses: object/boolean/string types, `const`, `required`,
 * `properties`, and `additionalProperties: false`. A hand-rolled subset keeps the
 * no-runtime-dependency rule; the schema file itself stays the source of truth for
 * which feature keys must exist.
 * @param {object} schema - the (sub)schema to check against.
 * @param {*} data - the value under validation.
 * @param {string} [where='config'] - human-readable location for error messages.
 * @returns {string[]} violation messages (empty when the document conforms).
 */
function schemaViolations(schema, data, where = 'config') {
  const violations = [];
  if (schema.const !== undefined && data !== schema.const) {
    violations.push(`${where} must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.type === 'boolean' && typeof data !== 'boolean') {
    violations.push(`${where} must be a boolean`);
  } else if (schema.type === 'string' && typeof data !== 'string') {
    violations.push(`${where} must be a string`);
  } else if (schema.type === 'object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      violations.push(`${where} must be an object`);
      return violations;
    }
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in data)) violations.push(`${where} is missing required key "${key}"`);
    }
    for (const [key, value] of Object.entries(data)) {
      if (key in properties) violations.push(...schemaViolations(properties[key], value, `${where}.${key}`));
      else if (schema.additionalProperties === false) violations.push(`${where} has unknown key "${key}"`);
    }
  }
  return violations;
}

/**
 * Check the toggle config at the target: present, parseable, and conformant to the
 * stamped hooks-config schema.
 * @param {string} target - absolute path of the target project root.
 * @returns {{ valid: boolean, detail: string }} validity plus a named reason —
 * "missing", "unparseable", or the first schema violations — or "valid".
 */
function checkHooksConfig(target) {
  const configFile = path.join(target, HOOKS_CONFIG_PATH);
  let raw;
  try {
    raw = fs.readFileSync(configFile, 'utf8');
  } catch {
    return { valid: false, detail: `missing (${HOOKS_CONFIG_PATH} not found)` };
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (cause) {
    return { valid: false, detail: `unparseable JSON (${cause.message})` };
  }
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(path.join(target, HOOKS_CONFIG_SCHEMA_PATH), 'utf8'));
  } catch {
    // No schema to judge against: parseable config is the best claim available.
    return { valid: true, detail: `parses (schema missing at ${HOOKS_CONFIG_SCHEMA_PATH} — conformance unverified)` };
  }
  const violations = schemaViolations(schema, config);
  if (violations.length > 0) return { valid: false, detail: `schema-invalid: ${violations.join('; ')}` };
  return { valid: true, detail: 'valid against its schema' };
}

/**
 * Read and flatten every hook command string configured in the stamped settings. The
 * settings shape is event → matcher groups → hooks; for command-level checks (is a
 * script wired, does its file exist) only the command strings matter.
 * @param {string} target - absolute path of the target project root.
 * @returns {{readable: boolean, commands: string[]}} readable is false when settings
 * is missing or unparseable; commands is the flat list of hook command strings.
 */
function readHookCommands(target) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(target, SETTINGS_PATH), 'utf8'));
  } catch {
    return { readable: false, commands: [] };
  }
  const commands = [];
  if (settings && settings.hooks && typeof settings.hooks === 'object') {
    for (const groups of Object.values(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const hook of (group && group.hooks) || []) {
          if (hook && typeof hook.command === 'string') commands.push(hook.command);
        }
      }
    }
  }
  return { readable: true, commands };
}

/**
 * Check one feature's wiring: every script it rides is both referenced by a hook
 * command in the stamped settings and present on disk.
 * @param {string} target - absolute path of the target project root.
 * @param {object} feature - a HOOK_FEATURES entry.
 * @returns {string[]} wiring problems (empty when fully wired).
 */
function wiringProblems(target, feature) {
  const problems = [];
  const { readable, commands } = readHookCommands(target);
  for (const script of feature.scripts) {
    if (!readable) problems.push(`${SETTINGS_PATH} missing or unparseable`);
    else if (!commands.some((command) => command.includes(script))) {
      problems.push(`no hook entry in ${SETTINGS_PATH} invokes ${script}`);
    }
    if (!fs.existsSync(path.join(target, HOOKS_DIR, script))) {
      problems.push(`hook script missing: ${HOOKS_DIR}/${script}`);
    }
  }
  // Spawned scripts are launched by the feature's own hook, not by settings — disk
  // presence is the only wiring claim to check.
  for (const script of feature.spawnedScripts || []) {
    if (!fs.existsSync(path.join(target, HOOKS_DIR, script))) {
      problems.push(`hook script missing: ${HOOKS_DIR}/${script}`);
    }
  }
  // settings-missing repeats per script when a feature rides several; report once.
  return [...new Set(problems)];
}

/**
 * Find settings.json hook commands whose target script is missing from the hooks dir —
 * a dead command, the worst failure mode (an enforcement hook that silently never
 * fires, EXEC-087). Scans every command, so a custom command the Instance added is
 * covered, not just the stamped HOOK_FEATURES.
 * @param {string} target - absolute path of the target project root.
 * @returns {Array<{command: string, missing: string}>} each dead command paired with
 * the hooks-relative path it names that does not exist on disk.
 */
function deadHookCommands(target) {
  const { commands } = readHookCommands(target);
  const scriptPattern = new RegExp(HOOK_COMMAND_SCRIPT_PATTERN, 'g');
  const dead = [];
  for (const command of commands) {
    for (const match of command.matchAll(scriptPattern)) {
      const basename = match[1];
      if (!fs.existsSync(path.join(target, HOOKS_DIR, basename))) {
        dead.push({ command, missing: `${HOOKS_DIR}/${basename}` });
      }
    }
  }
  return dead;
}

/**
 * Name which extension the settings commands invoke for a twinned hook base name.
 * @param {string[]} commands - the flat settings hook command strings.
 * @param {string} base - the hook base name (no extension).
 * @returns {string} the invoked file name, "both …" when commands name each extension,
 * or a note when no command names the hook at all.
 */
function invokedHookExtension(commands, base) {
  const jsName = `${base}${LEGACY_HOOK_EXTENSION}`;
  const cjsName = `${base}${CJS_HOOK_EXTENSION}`;
  const invokesJs = commands.some((command) => command.includes(jsName));
  const invokesCjs = commands.some((command) => command.includes(cjsName));
  if (invokesJs && invokesCjs) return `both ${jsName} and ${cjsName}`;
  if (invokesCjs) return cjsName;
  if (invokesJs) return jsName;
  return 'neither — no command names it';
}

/**
 * Find hooks present under both the legacy .js and the migrated .cjs extension — the
 * twin a hash-less marker leaves behind (every hook classed untracked, so migrate
 * renames nothing and a later update stamps a fresh .cjs beside the orphaned .js,
 * EXEC-086/087). For each twin, name which extension the settings commands invoke so
 * the live copy is unambiguous.
 * @param {string} target - absolute path of the target project root.
 * @returns {Array<{name: string, invoked: string}>} each twinned base name with the
 * extension settings invokes.
 */
function hookExtensionTwins(target) {
  let present;
  try {
    present = new Set(
      fs
        .readdirSync(path.join(target, HOOKS_DIR), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    );
  } catch {
    return [];
  }
  const { commands } = readHookCommands(target);
  const twins = [];
  for (const fileName of present) {
    if (!fileName.endsWith(LEGACY_HOOK_EXTENSION)) continue;
    const base = fileName.slice(0, -LEGACY_HOOK_EXTENSION.length);
    if (!present.has(`${base}${CJS_HOOK_EXTENSION}`)) continue;
    twins.push({ name: base, invoked: invokedHookExtension(commands, base) });
  }
  return twins;
}

/**
 * Find a feature's latest heartbeat in the unified hook invocation log: the newest
 * record (any outcome — disabled/noop/error firings are still firings) whose script
 * is one of the feature's wired scripts.
 * @param {string} target - absolute path of the target project root.
 * @param {object} feature - a HOOK_FEATURES entry.
 * @returns {number|null} the latest record's epoch ms, or null when the log is
 * missing/unreadable or carries no record for the feature's scripts.
 */
function latestInvocationMs(target, feature) {
  let records;
  try {
    records = JSON.parse(fs.readFileSync(path.join(target, INVOCATION_LOG_PATH), 'utf8')).records;
  } catch {
    return null;
  }
  if (!Array.isArray(records)) return null;
  let latest = null;
  for (const record of records) {
    if (!record || !feature.scripts.includes(record.script)) continue;
    const ms = Date.parse(record.ts);
    if (!Number.isNaN(ms) && (latest === null || ms > latest)) latest = ms;
  }
  return latest;
}

/**
 * Describe a feature's firing evidence: fresh heartbeat, stale, or no signal yet.
 * Primary source is the unified invocation log (every wired hook appends a record
 * per firing, CODE_STANDARDS ## Hooks); the feature's own state file mtime is the
 * fallback for Instances whose hooks predate the log.
 * @param {string} target - absolute path of the target project root.
 * @param {object} feature - a HOOK_FEATURES entry.
 * @returns {{ status: 'firing'|'stale', detail: string }}
 */
function firingEvidence(target, feature) {
  const invocationMs = latestInvocationMs(target, feature);
  if (invocationMs !== null) {
    const ageMs = Date.now() - invocationMs;
    if (ageMs <= HEARTBEAT_FRESH_MS) {
      return { status: 'firing', detail: `heartbeat ${Math.max(1, Math.round(ageMs / MS_PER_MINUTE))}m ago in ${INVOCATION_LOG_PATH}` };
    }
    return { status: 'stale', detail: `last invocation ${Math.round(ageMs / MS_PER_HOUR)}h ago in ${INVOCATION_LOG_PATH}` };
  }
  if (feature.evidence === null) {
    return { status: 'stale', detail: `no invocation records yet in ${INVOCATION_LOG_PATH} (appears at next firing)` };
  }
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(path.join(target, feature.evidence)).mtimeMs;
  } catch {
    return { status: 'stale', detail: `no firing evidence (no record in ${INVOCATION_LOG_PATH}, ${feature.evidence} absent)` };
  }
  const ageMs = Date.now() - mtimeMs;
  if (ageMs <= HEARTBEAT_FRESH_MS) {
    return { status: 'firing', detail: `heartbeat ${Math.max(1, Math.round(ageMs / MS_PER_MINUTE))}m ago in ${feature.evidence} (legacy fallback — no invocation-log record)` };
  }
  return { status: 'stale', detail: `last firing evidence ${Math.round(ageMs / MS_PER_HOUR)}h ago in ${feature.evidence}` };
}

/**
 * Probe a health endpoint and classify the listener. Shared by doctor's liveness
 * check and view-status's server discovery so the two can never disagree on what
 * "our server" means.
 * @param {{host: string, port: number, healthPath: string, timeoutMs: number, okStatus: number}} options
 * @returns {Promise<{state: 'ours', body: object}|{state: 'foreign'}|{state: 'free'}>}
 * 'ours' when our daemon answers (body is its health JSON), 'foreign' when something
 * else answers (or accepts but stays silent), 'free' when nothing answers.
 */
function probeHealthEndpoint({ host, port, healthPath, timeoutMs, okStatus }) {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: healthPath, timeout: timeoutMs }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          const body = JSON.parse(raw);
          if (response.statusCode === okStatus && body && typeof body.repo === 'string') {
            resolve({ state: 'ours', body });
            return;
          }
        } catch {
          // Non-JSON answer: some other process owns the port.
        }
        resolve({ state: 'foreign' });
      });
      response.on('error', () => resolve({ state: 'foreign' }));
    });
    // A listener that accepts but never answers within the budget reads as foreign.
    request.on('timeout', () => { request.destroy(); resolve({ state: 'foreign' }); });
    request.on('error', () => resolve({ state: 'free' }));
  });
}

/**
 * Probe a viewer-server discovery record's health endpoint (doctor's view).
 * @param {number} port - the recorded port, probed on the loopback host.
 * @returns {Promise<object|null>} the daemon's health body ({repo, pid, version})
 * when our server answers, or null when nothing ours answers (refused, timeout,
 * non-JSON, or wrong shape).
 */
async function probeViewerHealth(port) {
  const probe = await probeHealthEndpoint({
    host: VIEWER_HEALTH_HOST,
    port,
    healthPath: VIEWER_HEALTH_PATH,
    timeoutMs: VIEWER_PROBE_TIMEOUT_MS,
    okStatus: VIEWER_HEALTH_OK_STATUS,
  });
  return probe.state === 'ours' ? probe.body : null;
}

/**
 * Is a pid alive? signal 0 is an existence check that sends nothing.
 * @param {number} pid - the process id to test.
 * @returns {boolean} true when the process exists (and is signalable).
 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verdict for an enabled liveness feature (viewer_server): judge the discovery
 * record by whether its pid is alive and its port answers our health endpoint, per
 * PRD-008 — orphan/stale detection, not heartbeat age.
 * @param {string} target - absolute path of the target project root.
 * @param {object} feature - a HOOK_FEATURES entry with `liveness` set.
 * @returns {Promise<string>} the doctor line's verdict text.
 */
async function livenessVerdict(target, feature) {
  const record = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(target, feature.evidence), 'utf8'));
    } catch {
      return null;
    }
  })();
  if (!record || !Number.isInteger(record.pid) || !Number.isInteger(record.port)) {
    return `stale — enabled but no usable discovery record at ${feature.evidence} (starts at next SessionStart)`;
  }
  if (!pidAlive(record.pid)) {
    return `stale record — pid ${record.pid} not running (server idle-exited or died; next SessionStart restarts it)`;
  }
  const health = await probeViewerHealth(record.port);
  if (health === null || health.repo !== target) {
    return `stale record — pid ${record.pid} alive but port ${record.port} not answering as this repo's server (possible orphan; next SessionStart re-resolves)`;
  }
  return `running (http://${VIEWER_HEALTH_HOST}:${record.port}/ — pid ${record.pid})`;
}

/**
 * Resolve a stamped viewer asset in the target's hooks dir, preferring the .cjs
 * layout (EXEC-075) and falling back to a pre-migration .js Instance.
 * @param {string} target - absolute Instance root.
 * @param {string} basename - asset basename without extension.
 * @returns {string|null} absolute path, or null when neither extension exists.
 */
function resolveViewerAsset(target, basename) {
  for (const extension of [CJS_HOOK_EXTENSION, LEGACY_HOOK_EXTENSION]) {
    const candidate = path.join(target, HOOKS_DIR, `${basename}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Derive a repo's home port: djb2 over the absolute path into the rules' quiet range.
 * Mirrors homePort in the stamped viewer-server hook so the CLI lands on the same port
 * the SessionStart hook would.
 * @param {string} repoPath - absolute Instance root.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @returns {number} a port in [PORT_RANGE_START, PORT_RANGE_START + PORT_RANGE_SIZE).
 */
function viewerHomePort(repoPath, rules) {
  let hash = rules.DJB2_SEED;
  for (let i = 0; i < repoPath.length; i += 1) {
    hash = ((hash * rules.DJB2_MULTIPLIER) ^ repoPath.charCodeAt(i)) >>> 0; // eslint-disable-line no-bitwise
  }
  return rules.PORT_RANGE_START + (hash % rules.PORT_RANGE_SIZE);
}

/**
 * Probe a viewer port with the Instance's stamped rules constants.
 * @param {number} port - port to probe on the loopback host.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @returns {Promise<{state: 'ours', body: object}|{state: 'foreign'}|{state: 'free'}>}
 */
function probeViewerPort(port, rules) {
  return probeHealthEndpoint({
    host: rules.BIND_HOST,
    port,
    healthPath: rules.HEALTH_PATH,
    timeoutMs: rules.PROBE_TIMEOUT_MS,
    okStatus: rules.HTTP_OK,
  });
}

/**
 * Reuse a running viewer server from the discovery record, applying doctor's exact
 * staleness logic: a usable record whose pid is alive and whose port answers our
 * health endpoint as this repo's server.
 * @param {string} target - absolute Instance root.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @returns {Promise<{port: number, pid: number}|null>} the live server, or null when
 * no record, a stale record, or a non-answering/foreign port.
 */
async function runningViewerFromRecord(target, rules) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(path.join(target, rules.RECORD_RELATIVE_PATH), 'utf8'));
  } catch {
    return null;
  }
  if (!record || !Number.isInteger(record.pid) || !Number.isInteger(record.port) || !pidAlive(record.pid)) {
    return null;
  }
  const probe = await probeViewerPort(record.port, rules);
  return probe.state === 'ours' && probe.body.repo === target ? { port: record.port, pid: record.pid } : null;
}

/**
 * Spawn the stamped daemon detached on a port and poll its health endpoint until it
 * answers. Mirrors the SessionStart hook's spawnDaemon.
 * @param {string} target - absolute Instance root the daemon will serve.
 * @param {number} port - port to bind.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @param {string} daemonPath - absolute path to the stamped viewer-server-daemon.
 * @returns {Promise<number|null>} the daemon's pid once healthy, or null when it never
 * answered within the poll budget (bind lost to a foreign listener, or startup failed).
 */
async function spawnViewerDaemon(target, port, rules, daemonPath) {
  const child = spawn(process.execPath, [daemonPath, '--root', target, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {}); // a spawn failure surfaces as a never-healthy poll below
  child.unref(); // the daemon outlives this command; idle self-exit reaps it later
  for (let attempt = 0; attempt < rules.SPAWN_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, rules.SPAWN_POLL_INTERVAL_MS));
    const probe = await probeViewerPort(port, rules);
    if (probe.state === 'ours' && probe.body.repo === target) return probe.body.pid;
    if (probe.state === 'foreign') return null; // lost the port race to someone else
  }
  return null;
}

/**
 * Ensure this repo has a running server: walk up from the home port past foreign
 * listeners, reuse our own live daemon when one answers, spawn on the first free port
 * otherwise. Mirrors the SessionStart hook's ensureServer.
 * @param {string} target - absolute Instance root.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @param {string} daemonPath - absolute path to the stamped viewer-server-daemon.
 * @returns {Promise<{port: number, pid: number}|null>} the live server, or null when
 * the probe budget ran out.
 */
async function ensureViewerServer(target, rules, daemonPath) {
  let port = viewerHomePort(target, rules);
  for (let attempt = 0; attempt < rules.PORT_PROBE_LIMIT; attempt += 1) {
    const probe = await probeViewerPort(port, rules);
    if (probe.state === 'ours' && probe.body.repo === target) return { port, pid: probe.body.pid };
    if (probe.state === 'free') {
      const pid = await spawnViewerDaemon(target, port, rules, daemonPath);
      if (pid !== null) return { port, pid };
    }
    port += 1; // foreign listener, our daemon for another repo, or a lost race: next port
  }
  return null;
}

/**
 * Write the viewer discovery record (mirrors the hook's announce, minus the session
 * additionalContext): records the live server so doctor and a later view-status find it.
 * @param {string} target - absolute Instance root.
 * @param {object} rules - the Instance's stamped viewer-server-rules module.
 * @param {number} port - the port the daemon serves on.
 * @param {number} pid - the daemon's pid.
 * @returns {void}
 */
function writeViewerRecord(target, rules, port, pid) {
  const recordPath = path.join(target, rules.RECORD_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const record = {
    schema_version: rules.RECORD_SCHEMA_VERSION,
    port,
    pid,
    repo: target,
    started: new Date().toISOString(),
  };
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Open the default browser at a URL, best-effort: macOS `open`, Windows `start`, else
 * `xdg-open`. A missing opener never fails view-status (the URL was already printed).
 * @param {string} url - the URL to open.
 * @returns {void}
 */
function openBrowser(url) {
  const byPlatform = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '', url]],
  };
  const [command, commandArgs] = byPlatform[process.platform] || ['xdg-open', [url]];
  try {
    const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // opener absent (e.g. headless): swallow, URL is printed
    child.unref();
  } catch {
    // never fatal — the URL is on stdout regardless
  }
}

/**
 * Run the `view-status` command: ensure this Instance's viewer server is running
 * (reusing a live one per the discovery record, else starting the stamped daemon the
 * way SessionStart does), print the status-page URL, and open the default browser to
 * it. Fail-closed: a non-stamped target, or one missing the stamped viewer assets,
 * exits non-zero. doctor's viewer_server card stays the health authority.
 * @param {string[]} args - args after the command word (target only).
 * @returns {Promise<void>}
 * @throws Exits non-zero (after a stderr message) on a non-stamped/asset-less target
 * or an exhausted port-probe budget.
 */
async function viewStatus(args) {
  const target = path.resolve(args.find((arg) => !arg.startsWith(FLAG_PREFIX)) || '.');
  if (!fs.existsSync(path.join(target, VERSION_MARKER_PATH))) {
    process.stderr.write(
      `error: not a stamped Instance — no version marker at ${path.join(target, VERSION_MARKER_PATH)}; run \`to-execution init\` first\n`
    );
    process.exit(1);
  }
  const rulesPath = resolveViewerAsset(target, 'viewer-server-rules');
  const daemonPath = resolveViewerAsset(target, 'viewer-server-daemon');
  if (!rulesPath || !daemonPath) {
    process.stderr.write(
      `error: viewer assets not stamped in ${target} (${HOOKS_DIR}/viewer-server-{rules,daemon}); run \`to-execution update\`\n`
    );
    process.exit(1);
  }
  const rules = require(rulesPath); // eslint-disable-line global-require, import/no-dynamic-require

  let server = await runningViewerFromRecord(target, rules);
  if (!server) {
    server = await ensureViewerServer(target, rules, daemonPath);
    if (server) writeViewerRecord(target, rules, server.port, server.pid);
  }
  if (!server) {
    process.stderr.write(
      `error: could not start the viewer server for ${target} (port range busy); see \`to-execution doctor\`\n`
    );
    process.exit(1);
  }

  const url = `http://${rules.BIND_HOST}:${server.port}/`;
  process.stdout.write(`${url}\n`);
  openBrowser(url);
  process.exit(0);
}

/**
 * Run the `doctor` command: report per-feature hook health and outdated detection.
 * Per-feature verdicts: `broken` (wiring missing — a disarmed hook — or the toggle
 * config invalid), `disabled`, `firing` (enabled with a fresh heartbeat in the
 * unified invocation log, or its legacy state-file fallback), or `stale` (enabled,
 * no recent evidence). Liveness features (viewer_server) report `running` or
 * `stale record` from pid/port probing instead. Two Instance-wide hook checks run
 * alongside (EXEC-087): every settings command is resolved against disk so a command
 * naming a missing hook file is reported BROKEN (custom commands included), and the
 * hooks dir is scanned for a hook present as both .js and .cjs (a twin), naming which
 * extension settings invokes. A degraded Instance still exits 0 — doctor's job is the
 * report; only an unstamped target (no version marker) is a non-zero failure.
 * @param {string[]} args - args after the `doctor` command word (target only).
 * @returns {Promise<void>}
 * @throws Exits non-zero (after a stderr message) when the target is unstamped.
 */
async function doctor(args) {
  const target = path.resolve(args.find((arg) => !arg.startsWith(FLAG_PREFIX)) || '.');

  const markerFile = path.join(target, VERSION_MARKER_PATH);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (cause) {
    process.stderr.write(
      `error: not a stamped Instance — no readable version marker at ${markerFile} (${cause.message}); run \`to-execution init\` first\n`
    );
    process.exit(1);
  }

  const lines = [`to-execution doctor — ${target}`];

  const recorded = typeof marker.framework_version === 'string' ? marker.framework_version : '(unrecorded)';
  const installed = installedVersion();
  lines.push(
    recorded === installed
      ? `framework: up to date (recorded ${recorded} = installed ${installed})`
      : `framework: OUTDATED — stamped at ${recorded}, installed package is ${installed}; run \`to-execution update\``
  );

  const config = checkHooksConfig(target);
  lines.push(`toggle config: ${config.valid ? config.detail : `BROKEN — ${config.detail}`}`);

  const legacy = legacyRecords(target);
  lines.push(
    legacy.length > 0
      ? `record layout: LEGACY — ${legacy.length} record(s) at the ${LEGACY_RECORD_DIR} base; run \`to-execution migrate\` to relocate into ${PROGRESS_HOME}/ and ${RUNTIME_HOME}/ (ADR-0008)`
      : `record layout: ADR-0008 homes (no records at the ${LEGACY_RECORD_DIR} base)`
  );

  const legacyHooks = legacyHookFiles(target);
  lines.push(
    legacyHooks.length > 0
      ? `hook layout: MIGRATION-DUE — ${legacyHooks.length} hook(s) still on the .js layout (${legacyHooks.join(', ')}); a host package.json with "type":"module" mis-loads these as ESM. Run \`to-execution migrate\` to move them to .cjs (EXEC-076)`
      : 'hook layout: .cjs (CommonJS-safe under "type":"module")'
  );

  const deadCommands = deadHookCommands(target);
  lines.push(
    deadCommands.length > 0
      ? `hook commands: BROKEN — ${deadCommands.length} command(s) name a hook file that is absent: ${deadCommands.map((dead) => `\`${dead.command}\` → ${dead.missing} missing`).join('; ')} (the command silently never fires)`
      : 'hook commands: every settings command resolves to a present hook file'
  );

  const twins = hookExtensionTwins(target);
  lines.push(
    twins.length > 0
      ? `hook files: TWINS — ${twins.length} hook(s) present as both .js and .cjs: ${twins.map((twin) => `${twin.name} (settings invokes ${twin.invoked})`).join('; ')}`
      : 'hook files: no .js/.cjs twins'
  );

  // Toggles are read straight from the file even when schema-invalid: the hooks
  // themselves fail safe to disabled in that case, and the per-feature verdict
  // below carries the broken-config reason instead of guessing intent.
  const toggles = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(target, HOOKS_CONFIG_PATH), 'utf8')).features || {};
    } catch {
      return {};
    }
  })();

  for (const feature of HOOK_FEATURES) {
    const problems = wiringProblems(target, feature);
    let verdict;
    if (problems.length > 0) verdict = `broken — ${problems.join('; ')}`;
    else if (!config.valid) verdict = `broken — toggle config ${config.detail} (hook fails safe to disabled)`;
    else if (toggles[feature.key] !== true) verdict = 'disabled (wired; enable in .excn/hooks.config.json)';
    else if (feature.liveness === true) verdict = await livenessVerdict(target, feature);
    else {
      const evidence = firingEvidence(target, feature);
      if (evidence.status === 'firing') verdict = `firing (${evidence.detail})`;
      else verdict = `stale — enabled but ${evidence.detail}`;
    }
    lines.push(`feature ${feature.key}: ${verdict}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Write the usage text to stdout. Used for --help / no command, and after an
 * unrecognized command (the caller owns the non-zero exit in that case).
 * @returns {void}
 */
function printUsage() {
  process.stdout.write(
    [
      'to-execution — stamp the invariant agent-execution layout',
      '',
      'Usage:',
      '  npx to-execution init [target]   stamp template/ into target (default: cwd)',
      '  npx to-execution init --force    overwrite existing files',
      '  npx to-execution update [target] re-stamp invariant files at the installed version',
      '  npx to-execution migrate [target] relocate legacy records and move .js hooks to .cjs',
      '  npx to-execution doctor [target] report per-feature hook health and outdated status',
      '  npx to-execution view-status [target]  start the viewer server if needed and open the status page',
      '  npx to-execution validate <file> [--schema <path>]  validate a work-tracking JSON file against its schema',
      '',
      'init stamps the .excn/ namespace; .excn/.gitignore keeps per-session *_progress.json out of git.',
      'init records the framework version and stamped-form hashes in .excn/framework-version.json.',
      'update refreshes invariant files only: variant (grilled) files and work-tracking state',
      'are never touched, and a locally drifted invariant file is reported, not overwritten.',
      'migrate relocates legacy *_progress.json records into .excn/progress/ (agent/gate-written)',
      'and .excn/runtime/ (hook-written) by writer class (ADR-0008), and moves pre-EXEC-075 .js hooks',
      'to .cjs so a host "type":"module" package.json cannot mis-load them as ESM. Idempotent; only',
      'hooks byte-identical to their stamped form are renamed — locally modified hooks are reported,',
      'never clobbered. doctor flags both legacy layouts and names this command.',
      'init wires a pointer block into existing CLAUDE.md / AGENTS.md (append-only,',
      'even under --force; both created if neither exists).',
      'init never overwrites an existing manifest file unless --force.',
      'doctor reports each hook feature as disabled, firing, stale, or broken (viewer_server:',
      'running or stale record) — heartbeats read .excn/runtime/hook-invocations_progress.json — names',
      'a broken toggle config, flags a settings command pointing at a missing hook file (custom commands',
      'included) and any hook present as both .js and .cjs, and flags an Instance stamped at an older',
      'framework version.',
      'view-status reuses a running viewer server (per the discovery record, doctor\'s staleness logic)',
      'or starts the stamped daemon, prints the URL, and opens the default browser; doctor stays the',
      'health authority. validate auto-detects the schema (backlog/sprint-issues, sprint, PRD, progress,',
      'hooks-config, verdict-ledger) from the file shape, or takes --schema; exit 0 valid, non-zero lists',
      'each violation with its JSON path. Both verbs exit non-zero on a non-stamped target.',
      '',
    ].join('\n')
  );
}

// ── public surface ─────────────────────────────────────────────────────────────

/**
 * Run the `init` command: stamp the template into the target and wire pointers.
 * Skips an existing destination file unless --force is set. Reports the write/skip
 * counts and the pointer actions to stdout.
 * @param {string[]} args - args after the `init` command word (target and flags).
 * @returns {void}
 * @throws Exits non-zero (after a stderr message) if the template is missing.
 */
function init(args) {
  const force = args.includes(FORCE_FLAG);
  const target = path.resolve(args.find((arg) => !arg.startsWith(FLAG_PREFIX)) || '.');

  if (!fs.existsSync(TEMPLATE_DIR)) {
    process.stderr.write(`error: template not found at ${TEMPLATE_DIR}\n`);
    process.exit(1);
  }
  fs.mkdirSync(target, { recursive: true });

  const written = [];
  const skipped = [];
  // Stamped-form hashes come from the template, not the destination: even for a
  // skipped (pre-existing) file, the stamped form at this version is the template's.
  const invariantHashes = {};
  for (const relativePath of listFilesRecursive(TEMPLATE_DIR)) {
    const source = path.join(TEMPLATE_DIR, relativePath);
    const destinationRel = stampedDestination(relativePath);
    const destination = path.join(target, destinationRel);
    if (classifyStampedPath(destinationRel) === 'invariant') {
      invariantHashes[destinationRel.split(path.sep).join('/')] = sha256(fs.readFileSync(source));
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && !force) {
      skipped.push(destinationRel);
      continue;
    }
    fs.copyFileSync(source, destination);
    written.push(destinationRel);
  }

  const version = installedVersion();
  writeVersionMarker(target, version, invariantHashes);
  const pointers = wirePointers(target);

  process.stdout.write(
    [
      `Stamped invariant layout into ${target} at framework version ${version}`,
      `  recorded version marker at ${VERSION_MARKER_PATH}`,
      `  wrote   ${written.length} file(s)`,
      `  skipped ${skipped.length} existing file(s)${skipped.length ? ` (use --force to overwrite): ${skipped.join(', ')}` : ''}`,
      ...pointers.map((line) => `  ${line}`),
      '',
      'Next: the Setup Skill runs the Setup Grill to write the variant files',
      '(.excn/CONTEXT.md terms, .excn/PHILOSOPHY.md, .excn/TEAM_DIRECTIVE.md, Teammate defs).',
      '',
    ].join('\n')
  );
}

/**
 * Run the `update` command: re-stamp only invariant files at the installed version.
 * Variant files and work-tracking state are never touched. A file byte-identical to
 * the incoming template is unchanged, whatever its recorded hash. Otherwise, an
 * invariant file whose content differs from its recorded stamped-form hash has
 * drifted locally: it is reported and left in place (its old hash is kept so drift
 * stays anchored to what was actually stamped). A file still at its stamped form
 * when the template has moved on is refreshed. Ends by rewriting the version marker
 * at the installed version. Reports refreshed/unchanged/drifted to stdout.
 * @param {string[]} args - args after the `update` command word (target only).
 * @returns {void}
 * @throws Exits non-zero (after a stderr message) if the template is missing or the
 *         target has no readable version marker (i.e. was never stamped by init).
 */
function update(args) {
  const target = path.resolve(args.find((arg) => !arg.startsWith(FLAG_PREFIX)) || '.');

  if (!fs.existsSync(TEMPLATE_DIR)) {
    process.stderr.write(`error: template not found at ${TEMPLATE_DIR}\n`);
    process.exit(1);
  }
  const markerFile = path.join(target, VERSION_MARKER_PATH);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch (cause) {
    process.stderr.write(
      `error: no readable version marker at ${markerFile} (${cause.message}) — run \`to-execution init\` to stamp first\n`
    );
    process.exit(1);
  }
  const recordedHashes = marker.files || {};

  const refreshed = [];
  const unchanged = [];
  const drifted = [];
  const nextHashes = {};
  for (const relativePath of listFilesRecursive(TEMPLATE_DIR)) {
    const destinationRel = stampedDestination(relativePath);
    if (classifyStampedPath(destinationRel) !== 'invariant') continue;

    const source = path.join(TEMPLATE_DIR, relativePath);
    const destination = path.join(target, destinationRel);
    const posixRel = destinationRel.split(path.sep).join('/');
    const templateContent = fs.readFileSync(source);
    const templateHash = sha256(templateContent);

    if (!fs.existsSync(destination)) {
      // Missing invariant files (deleted locally, or new in this version) are restored.
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, templateContent);
      refreshed.push(posixRel);
      nextHashes[posixRel] = templateHash;
      continue;
    }

    const currentHash = sha256(fs.readFileSync(destination));
    const recordedHash = recordedHashes[posixRel];
    if (currentHash === templateHash) {
      // Byte-identical to the incoming template: unchanged, whatever the recorded
      // hash says. A stale anchor (recorded != template, left by a prior lockstep
      // stamp) must not read as drift — test template match before the drift check.
      // Re-anchor on the template hash so the stale anchor is not carried forward.
      unchanged.push(posixRel);
      nextHashes[posixRel] = templateHash;
      continue;
    }
    if (recordedHash !== undefined && currentHash !== recordedHash) {
      // Differs from both the template and its stamped form: the Instance edited it
      // on purpose or by accident — either way the decision is theirs, so report and
      // keep the old hash as the drift anchor.
      drifted.push(posixRel);
      nextHashes[posixRel] = recordedHash;
      continue;
    }
    if (recordedHash === undefined) {
      // No stamped-form record (pre-marker stamp or untracked local file) and (per
      // the template-match check above) not the installed version's content:
      // unverifiable, treat as drifted. Anchor on the template hash, never the
      // current content — recording the local content would make the next run read
      // it as unchanged-from-recorded and overwrite the user's edit. With the
      // template hash recorded, current != recorded holds on every later run until
      // the user resolves the drift.
      drifted.push(posixRel);
      nextHashes[posixRel] = templateHash;
      continue;
    }

    // Recorded form matches the current content but the template moved on: a clean
    // upgrade — refresh to the installed version and re-anchor.
    fs.writeFileSync(destination, templateContent);
    refreshed.push(posixRel);
    nextHashes[posixRel] = templateHash;
  }

  const version = installedVersion();
  writeVersionMarker(target, version, nextHashes);

  process.stdout.write(
    [
      `Updated invariant layout in ${target} to framework version ${version}`,
      `  refreshed ${refreshed.length} file(s)${refreshed.length ? `: ${refreshed.join(', ')}` : ''}`,
      `  unchanged ${unchanged.length} file(s) already at this version`,
      `  drifted   ${drifted.length} file(s) left in place${drifted.length ? `: ${drifted.join(', ')}` : ''}`,
      '(variant files and work-tracking state are never touched by update)',
      '',
    ].join('\n')
  );
}

/**
 * Class a legacy-base record by writer to its ADR-0008 home: the hook- and
 * machine-written Runtime Records to .excn/runtime/, every other *_progress.json to
 * the agent/gate Progress home .excn/progress/.
 * @param {string} basename - the record's file basename.
 * @returns {string} the destination home, Instance-root-relative.
 */
function recordHome(basename) {
  return RUNTIME_RECORD_BASENAMES.includes(basename) ? RUNTIME_HOME : PROGRESS_HOME;
}

/**
 * List the legacy flat-layout records: *_progress.json directly under the .excn base.
 * The homes beneath it are the migrated location, not legacy, so the scan is the base
 * top level only. migrate moves these; doctor counts them to detect the legacy layout.
 * @param {string} target - absolute Instance root.
 * @returns {string[]} base-level record basenames (empty when none or .excn is absent).
 */
function legacyRecords(target) {
  try {
    return fs
      .readdirSync(path.join(target, LEGACY_RECORD_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(PROGRESS_FILE_SUFFIX))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * List the legacy-layout hook files: scripts in the hooks dir still carrying the
 * pre-EXEC-075 .js extension. Used by migrate to relocate them and by doctor to flag
 * an Instance as migration-due. The .cjs files beside them are already-migrated, so the
 * scan filters on the legacy extension only.
 * @param {string} target - absolute Instance root.
 * @returns {string[]} legacy hook basenames (empty when none or the dir is absent).
 */
function legacyHookFiles(target) {
  try {
    return fs
      .readdirSync(path.join(target, HOOK_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(LEGACY_HOOK_EXTENSION))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Apply the hook content-reference rewrites (migrate-policy) to a hook's text: fix the
 * sibling references that a .js → .cjs rename would otherwise break (extensionless
 * relative requires and the spawned-daemon path). Each rewrite is idempotent.
 * @param {string} text - the hook file's UTF-8 content.
 * @returns {string} the content with sibling references repointed at .cjs.
 */
function rewriteHookReferences(text) {
  return HOOK_CONTENT_REWRITES.reduce(
    (acc, { pattern, replacement }) => acc.replace(new RegExp(pattern, 'g'), replacement),
    text
  );
}

/**
 * Decide whether a legacy hook named in a settings.json command is one migrate renamed,
 * so its command may be repointed at the .cjs file. True when the hook was renamed this
 * run, or a completed prior run already left the .cjs in place with no .js twin (an
 * interrupted earlier migrate that renamed the file but never reached the settings
 * rewrite). False when the .js still exists (a skipped or untracked hook migrate left
 * alone) or neither extension exists (a dead command migrate must not invent a target
 * for) — those commands keep naming the file they already name.
 * @param {string} target - absolute Instance root (for the on-disk existence checks).
 * @param {string} name - the bare hook name from the command (no extension).
 * @param {Set<string>} renamedThisRun - bare hook names migrate renamed in this run.
 * @returns {boolean} whether the command's `.js` may be rewritten to `.cjs`.
 */
function hookCommandMigrated(target, name, renamedThisRun) {
  if (renamedThisRun.has(name)) return true;
  const jsExists = fs.existsSync(path.join(target, HOOK_DIR, `${name}${LEGACY_HOOK_EXTENSION}`));
  const cjsExists = fs.existsSync(path.join(target, HOOK_DIR, `${name}${CJS_HOOK_EXTENSION}`));
  return cjsExists && !jsExists;
}

/**
 * Rewrite only the settings.json hook commands migrate actually renamed, and report the
 * rest. A command whose target hook was renamed (this run or a completed prior run) is
 * repointed at .cjs; a command naming a hook migrate left as .js (skipped or untracked)
 * is left untouched so it keeps firing against the existing file, and its name is
 * collected for migrate to report (EXEC-086 — the unconditional rewrite silently killed
 * such commands by pointing them at a .cjs that does not exist).
 * @param {string} settingsText - the settings.json UTF-8 content.
 * @param {string} target - absolute Instance root (for the on-disk existence checks).
 * @param {Set<string>} renamedThisRun - bare hook names migrate renamed in this run.
 * @returns {{text: string, reported: string[]}} the rewritten text and the commands left as .js.
 */
function rewriteHookCommands(settingsText, target, renamedThisRun) {
  const reported = [];
  const text = settingsText.replace(new RegExp(HOOK_COMMAND_REWRITE.pattern, 'g'), (match, stem, name) => {
    if (hookCommandMigrated(target, name, renamedThisRun)) return `${stem}${CJS_HOOK_EXTENSION}`;
    if (fs.existsSync(path.join(target, HOOK_DIR, `${name}${LEGACY_HOOK_EXTENSION}`))) {
      reported.push(`${name}${LEGACY_HOOK_EXTENSION} (hook not migrated — command left pointing at the existing .js)`);
    }
    return match;
  });
  return { text, reported };
}

/**
 * Migrate an Instance's hook layout from .js to .cjs (EXEC-076). For each legacy hook
 * whose content is byte-identical to its recorded stamped-form hash (an unmodified
 * framework hook), write the .cjs file with sibling references repointed, remove the
 * .js copy, and re-key the marker entry. A hook with no marker record (untracked) or
 * one that differs from its recorded hash (locally edited) is left untouched and
 * reported, never clobbered. Then repoint the settings.json hook commands scoped to
 * exactly the hooks migrate renamed (this run or a completed prior run); a command
 * naming a hook left as .js is reported and left untouched so it keeps firing (EXEC-086).
 * Idempotent: once no .js hooks remain and settings already name .cjs paths, a re-run
 * changes nothing. The marker is rewritten (preserving its recorded framework version —
 * migrate is not an update) only when something moved.
 * @param {string} target - absolute Instance root.
 * @returns {{migrated: string[], skipped: string[], settingsRewritten: boolean, settingsReported: string[], markerMissing: boolean}}
 */
function migrateHookLayout(target) {
  const result = { migrated: [], skipped: [], settingsRewritten: false, settingsReported: [], markerMissing: false };

  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(target, VERSION_MARKER_PATH), 'utf8'));
  } catch {
    marker = null;
  }
  const recordedHashes = (marker && marker.files) || {};
  const nextHashes = { ...recordedHashes };
  const renamedThisRun = new Set();

  for (const name of legacyHookFiles(target)) {
    const jsPosix = `${HOOK_DIR}/${name}`;
    const jsPath = path.join(target, HOOK_DIR, name);
    const content = fs.readFileSync(jsPath);
    const recordedHash = recordedHashes[jsPosix];
    if (recordedHash === undefined) {
      result.skipped.push(`${name} (untracked — not a recorded framework hook; left in place)`);
      continue;
    }
    if (recordedHash !== sha256(content)) {
      result.skipped.push(`${name} (locally modified — differs from its stamped form; left in place)`);
      continue;
    }
    const baseName = name.slice(0, -LEGACY_HOOK_EXTENSION.length);
    const cjsName = `${baseName}${CJS_HOOK_EXTENSION}`;
    const cjsPosix = `${HOOK_DIR}/${cjsName}`;
    const rewritten = rewriteHookReferences(content.toString('utf8'));
    fs.writeFileSync(path.join(target, HOOK_DIR, cjsName), rewritten);
    fs.rmSync(jsPath);
    delete nextHashes[jsPosix];
    nextHashes[cjsPosix] = sha256(rewritten);
    result.migrated.push(`${name} → ${cjsName}`);
    renamedThisRun.add(baseName);
  }

  // Repoint settings.json hook commands, scoped to the hooks migrate renamed. A command
  // pointing at a skipped or untracked hook is reported and left naming its existing .js
  // (EXEC-086): a dead enforcement hook is the worst failure mode, so migrate never
  // repoints a command at a .cjs that does not exist. The scope still covers an Instance
  // part-migrated by an interrupted run — a completed-rename whose settings never caught
  // up — because hookCommandMigrated also accepts a .cjs-present/.js-absent hook. The
  // marker's settings hash is left as-is (not re-anchored) so a later `update` still
  // classifies a locally customized settings.json correctly rather than overwriting it.
  const settingsPath = path.join(target, HOOK_SETTINGS_FILE);
  if (fs.existsSync(settingsPath)) {
    const before = fs.readFileSync(settingsPath, 'utf8');
    const { text: after, reported } = rewriteHookCommands(before, target, renamedThisRun);
    result.settingsReported = reported;
    if (after !== before) {
      fs.writeFileSync(settingsPath, after);
      result.settingsRewritten = true;
    }
  }

  if (!marker) {
    result.markerMissing = true;
  } else if (result.migrated.length > 0) {
    writeVersionMarker(target, marker.framework_version, nextHashes);
  }

  return result;
}

/**
 * Run the `migrate` command: relocate legacy flat-layout records into their ADR-0008
 * homes. Location only — each record is moved byte-identical (fs.rename, never a
 * rewrite). Every *_progress.json at the .excn base is classed by writer (recordHome)
 * and moved unless its name already exists at the destination, in which case it is left
 * in place and reported, never clobbered. Idempotent: a re-run (or an already-relocated
 * record) finds nothing at the base and is a no-op. update's never-touch-work-tracking
 * contract is unaffected — relocation is migrate's job alone (ADR-0008). Then migrates
 * the hook layout from .js to .cjs (EXEC-076). Reports moved/skipped to stdout.
 * @param {string[]} args - args after the `migrate` command word (target only).
 * @returns {void}
 * @throws Exits non-zero (after a stderr message) when the target has no .excn directory.
 */
function migrate(args) {
  const target = path.resolve(args.find((arg) => !arg.startsWith(FLAG_PREFIX)) || '.');
  const legacyDir = path.join(target, LEGACY_RECORD_DIR);
  if (!fs.existsSync(legacyDir)) {
    process.stderr.write(`error: no ${LEGACY_RECORD_DIR} directory at ${legacyDir} — run \`to-execution init\` first\n`);
    process.exit(1);
  }

  const moved = [];
  const skipped = [];
  for (const basename of legacyRecords(target)) {
    const home = recordHome(basename);
    const destinationDir = path.join(target, home);
    const destination = path.join(destinationDir, basename);
    if (fs.existsSync(destination)) {
      // Already relocated, or a name clash: never clobber a record at its home.
      skipped.push(`${basename} (already present in ${home}/)`);
      continue;
    }
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.renameSync(path.join(legacyDir, basename), destination);
    moved.push(`${basename} → ${home}/`);
  }

  const hooks = migrateHookLayout(target);

  process.stdout.write(
    [
      `Migrated legacy records in ${target} (${MIGRATION_ID})`,
      `  moved   ${moved.length} record(s)${moved.length ? `: ${moved.join(', ')}` : ''}`,
      `  skipped ${skipped.length} already-placed record(s)${skipped.length ? `: ${skipped.join(', ')}` : ''}`,
      '(location only — record content is never rewritten; update never touches work-tracking)',
      `Migrated hook layout in ${target} (${HOOK_CJS_MIGRATION_ID})`,
      `  renamed ${hooks.migrated.length} hook(s) to .cjs${hooks.migrated.length ? `: ${hooks.migrated.join(', ')}` : ''}`,
      `  skipped ${hooks.skipped.length} hook(s)${hooks.skipped.length ? `: ${hooks.skipped.join(', ')}` : ''}`,
      `  settings.json hook commands ${hooks.settingsRewritten ? 'repointed at .cjs' : 'already current'}`,
      hooks.settingsReported.length
        ? `  left ${hooks.settingsReported.length} command(s) pointing at unmigrated hooks (still firing): ${hooks.settingsReported.join(', ')}`
        : '  all settings commands align with the on-disk hooks',
      hooks.markerMissing
        ? '  (no version marker — could not verify hooks against their stamped form; nothing renamed)'
        : '(sibling references repointed at .cjs; locally modified hooks are reported, never clobbered)',
      '',
    ].join('\n')
  );
}

/**
 * Auto-detect which schema a parsed work-tracking file should validate against, by
 * the shape signatures in validate-policy (first match wins).
 * @param {*} data - the parsed JSON.
 * @returns {string|null} the schema basename, or null when nothing matched.
 */
function detectSchema(data) {
  for (const rule of DETECTION_RULES) {
    if (rule.topLevelArray) {
      if (Array.isArray(data)) return rule.schema;
      continue;
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && rule.requiredKeys.every((key) => key in data)) {
      return rule.schema;
    }
  }
  return null;
}

/**
 * Build an Ajv instance with every shipped schema registered, so cross-file $refs
 * (e.g. sprint → verdict-ledger) resolve and any detected schema can be compiled.
 * ajv + ajv-formats are required lazily here (EXEC-081) so the other verbs stay
 * builtin-only and a missing install only ever affects `validate`.
 * @returns {object} a configured Ajv instance.
 * @throws Exits non-zero (after a stderr message) when ajv is not installed.
 */
function buildAjv() {
  let Ajv;
  let addFormats;
  try {
    Ajv = require('ajv'); // eslint-disable-line global-require
    addFormats = require('ajv-formats'); // eslint-disable-line global-require
  } catch (cause) {
    process.stderr.write(`error: validate needs ajv — reinstall the package (${cause.message})\n`);
    process.exit(1);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of fs.readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8'));
    // Key each schema by its basename so a cross-file $ref by filename resolves; a
    // schema carrying its own $id keeps that too (ajv accepts both as lookup keys).
    ajv.addSchema(schema, file);
  }
  return ajv;
}

/**
 * Run the `validate` command: validate a work-tracking JSON file against its schema —
 * auto-detected from the file shape (validate-policy) or named by --schema. Exit 0 on
 * a valid file; non-zero with each violation (JSON path + message) on an invalid one.
 * Fail-closed: an unreadable/unparseable file, an undetectable schema, or a missing
 * schema all exit non-zero.
 * @param {string[]} args - args after the command word: the file, optional --schema <path>.
 * @returns {void}
 * @throws Exits non-zero (after a stderr message) on any failure above.
 */
function validate(args) {
  const schemaFlagIndex = args.indexOf(SCHEMA_FLAG);
  const schemaOverride = schemaFlagIndex !== -1 ? args[schemaFlagIndex + 1] : null;
  if (schemaFlagIndex !== -1 && !schemaOverride) {
    process.stderr.write(`error: ${SCHEMA_FLAG} needs a schema path\n`);
    process.exit(1);
  }
  const schemaValueIndex = schemaFlagIndex === -1 ? -1 : schemaFlagIndex + 1;
  const positional = args.filter((arg, index) => !arg.startsWith(FLAG_PREFIX) && index !== schemaValueIndex);
  const file = positional[0];
  if (!file) {
    process.stderr.write('error: validate needs a file path — usage: to-execution validate <file> [--schema <path>]\n');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (cause) {
    process.stderr.write(`error: cannot read or parse ${file}: ${cause.message}\n`);
    process.exit(1);
  }

  const ajv = buildAjv();
  let validateFn;
  let schemaLabel;
  if (schemaOverride) {
    let schema;
    try {
      schema = JSON.parse(fs.readFileSync(path.resolve(schemaOverride), 'utf8'));
    } catch (cause) {
      process.stderr.write(`error: cannot read or parse schema ${schemaOverride}: ${cause.message}\n`);
      process.exit(1);
    }
    // Drop $id before compiling: the override may be one of the shipped schemas (already
    // registered by id in buildAjv), and ajv refuses a duplicate id. Its $refs still
    // resolve against the registered schemas by their filename keys.
    const { $id, ...schemaBody } = schema; // eslint-disable-line no-unused-vars
    validateFn = ajv.compile(schemaBody);
    schemaLabel = schemaOverride;
  } else {
    const detected = detectSchema(data);
    if (!detected) {
      process.stderr.write(
        `error: could not auto-detect a schema for ${file} (unrecognized shape); pass ${SCHEMA_FLAG} <path>\n`
      );
      process.exit(1);
    }
    validateFn = ajv.getSchema(detected);
    schemaLabel = detected;
  }

  if (validateFn(data)) {
    process.stdout.write(`valid: ${file} conforms to ${schemaLabel}\n`);
    return;
  }
  process.stderr.write(`invalid: ${file} violates ${schemaLabel}\n`);
  for (const error of validateFn.errors) {
    const jsonPath = error.instancePath || '(root)';
    process.stderr.write(`  ${jsonPath} ${error.message}\n`);
  }
  process.exit(1);
}

/**
 * Entry point: dispatch on the first CLI argument. `init` stamps; `update`
 * re-stamps invariants; `migrate` relocates legacy records into their ADR-0008 homes;
 * `doctor` reports hook health; `view-status` opens the status page; `validate`
 * checks a work-tracking file against its schema; no command or -h/--help prints usage
 * and exits zero; any other word fails non-zero with usage.
 * @returns {void}
 * @throws Exits non-zero (after usage on stderr+stdout) on an unrecognized command.
 */
function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'init':
      return init(args);
    case 'update':
      return update(args);
    case 'migrate':
      return migrate(args);
    case 'doctor':
      return doctor(args);
    case 'view-status':
      return viewStatus(args);
    case 'validate':
      return validate(args);
    case undefined:
    case '-h':
    case '--help':
      return printUsage();
    default:
      process.stderr.write(`unknown command: ${command}\n\n`);
      printUsage();
      process.exit(1);
  }
}

main();
