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
// reported and left in place. Diagnostics to stderr, results to stdout, non-zero exit
// on any failure. Node builtins only; pointer-block content and the update file-policy
// live in the sibling data modules.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { POINTER_FILES, POINTER_SENTINEL, CODEX_CHAIN_CAP, POINTER_BLOCK } = require('./pointer-block');
const {
  VARIANT_FILES,
  WORK_TRACKING_DIR_PREFIXES,
  PROGRESS_FILE_SUFFIX,
  VERSION_MARKER_PATH,
  MARKER_SCHEMA_VERSION,
} = require('./stamp-policy');

// Package root is one level up from bin/; the template ships beside it.
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'template');

// npm pack treats an in-package .gitignore as an ignore spec and strips it, so the
// template ships the file un-dotted as `gitignore`; stamping restores the real name.
const SHIPPED_GITIGNORE_NAME = 'gitignore';
const STAMPED_GITIGNORE_NAME = '.gitignore';

// First positional arg that is not a flag selects the target; this prefix marks a flag.
const FLAG_PREFIX = '-';
const FORCE_FLAG = '--force';

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
      '',
      'init stamps the .excn/ namespace; .excn/.gitignore keeps per-session *_progress.json out of git.',
      'init records the framework version and stamped-form hashes in .excn/framework-version.json.',
      'update refreshes invariant files only: variant (grilled) files and work-tracking state',
      'are never touched, and a locally drifted invariant file is reported, not overwritten.',
      'init wires a pointer block into existing CLAUDE.md / AGENTS.md (append-only,',
      'even under --force; both created if neither exists).',
      'init never overwrites an existing manifest file unless --force.',
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
 * Variant files and work-tracking state are never touched. An invariant file whose
 * current content differs from its recorded stamped-form hash has drifted locally:
 * it is reported and left in place (its old hash is kept so drift stays anchored to
 * what was actually stamped). Ends by rewriting the version marker at the installed
 * version. Reports refreshed/unchanged/drifted to stdout.
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
    if (recordedHash !== undefined && currentHash !== recordedHash) {
      // Drifted from its stamped form: the Instance edited it on purpose or by
      // accident — either way the decision is theirs, so report and keep the old
      // hash as the drift anchor.
      drifted.push(posixRel);
      nextHashes[posixRel] = recordedHash;
      continue;
    }
    if (recordedHash === undefined && currentHash !== templateHash) {
      // No stamped-form record (pre-marker stamp or untracked local file) and the
      // content is not the installed version's: unverifiable, treat as drifted.
      // Anchor on the template hash, never the current content — recording the
      // local content would make the next run read it as unchanged-from-recorded
      // and overwrite the user's edit. With the template hash recorded, current
      // != recorded holds on every later run until the user resolves the drift.
      drifted.push(posixRel);
      nextHashes[posixRel] = templateHash;
      continue;
    }

    if (currentHash === templateHash) unchanged.push(posixRel);
    else {
      fs.writeFileSync(destination, templateContent);
      refreshed.push(posixRel);
    }
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
 * Entry point: dispatch on the first CLI argument. `init` stamps; `update`
 * re-stamps invariants; no command or
 * -h/--help prints usage and exits zero; any other word fails non-zero with usage.
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
