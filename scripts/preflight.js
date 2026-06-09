#!/usr/bin/env node
'use strict';

// to-execution publish preflight — fail-closed identity guards (ADR-0001).
// Repo-root release tooling: it gates our own publish and is NOT shipped in the
// tarball (the published package is src/; this lives outside it, like RELEASE.md).
// Runs via src/package.json prepublishOnly (`node ../scripts/preflight.js`), so its
// cwd is src/ at publish time but its own path is repo-root/scripts/.
// Any failed check aborts the publish (non-zero exit). Node builtins only.

const { execSync } = require('child_process');
const path = require('path');

// The personal identity every publish must run under (ADR-0001). A check FAILs unless
// the live git/npm environment matches these exactly.
const EXPECTED = {
  gitEmail: 'brooksryan19@gmail.com',
  gitHubUser: 'brooksryan',
  npmUser: 'brooksryan',
  remoteFragment: 'github.com/brooksryan/',
};

// The package whose version HEAD must be tagged with — src/package.json, resolved from
// this file's own location (repo-root/scripts/ → ../src/package.json), independent of cwd.
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'src', 'package.json');

// Run git non-interactively: never prompt for credentials, never hang a publish.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/true' };

// Sentinel return value of a check's run() when the guard holds. Any other return
// (a string) is the actionable failure message.
const CHECK_PASSED = true;

/**
 * Run a shell command and return its trimmed stdout.
 * @param {string} command - the command to execute.
 * @param {object} [options] - extra child_process.execSync options (e.g. `input`).
 * @returns {string} the command's stdout, trimmed.
 * @throws Propagates the execSync error (caught per-check and rendered as a failure).
 */
function shell(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: GIT_ENV,
    ...options,
  }).trim();
}

// Each check's run() returns CHECK_PASSED (true) when the guard holds, or an actionable
// failure string naming what was found versus what was expected.
const CHECKS = [
  {
    name: 'git email is personal',
    run() {
      const email = shell('git config user.email');
      return email === EXPECTED.gitEmail || `user.email is "${email}", expected "${EXPECTED.gitEmail}"`;
    },
  },
  {
    name: `credential resolves to ${EXPECTED.gitHubUser}`,
    run() {
      const out = shell('git credential fill', {
        input: 'protocol=https\nhost=github.com\npath=brooksryan/execution-set-up.git\n\n',
      });
      const field = (key) => (out.split('\n').find((line) => line.startsWith(`${key}=`)) || '').slice(key.length + 1);
      if (field('username') !== EXPECTED.gitHubUser) {
        return `credential username is "${field('username')}", expected "${EXPECTED.gitHubUser}"`;
      }
      if (!field('password')) return 'no stored credential resolvable (empty password)';
      return CHECK_PASSED;
    },
  },
  {
    name: `npm whoami is ${EXPECTED.npmUser}`,
    run() {
      const who = shell('npm whoami');
      return who === EXPECTED.npmUser || `npm whoami is "${who}", expected "${EXPECTED.npmUser}"`;
    },
  },
  {
    name: 'origin remote is personal',
    run() {
      const url = shell('git remote get-url origin');
      return url.includes(EXPECTED.remoteFragment) || `origin is "${url}", expected to contain "${EXPECTED.remoteFragment}"`;
    },
  },
  {
    name: 'working tree clean',
    run() {
      const dirty = shell('git status --porcelain');
      return dirty === '' || `tree is dirty:\n${dirty}`;
    },
  },
  {
    name: 'HEAD tagged v<version>',
    run() {
      const version = require(PACKAGE_JSON_PATH).version;
      const tags = shell('git tag --points-at HEAD').split('\n').filter(Boolean);
      return tags.includes(`v${version}`) || `HEAD tags [${tags.join(', ')}] do not include "v${version}"`;
    },
  },
];

/**
 * Run every identity guard, reporting each to stdout, and exit. Exits non-zero with a
 * fail-closed summary on stderr if any check fails; exits zero when all guards hold.
 * @returns {void}
 */
function main() {
  let failedCount = 0;
  for (const check of CHECKS) {
    let result;
    try {
      result = check.run();
    } catch (err) {
      result = (err.stderr || err.message || 'check threw').toString().trim();
    }
    const passed = result === CHECK_PASSED;
    if (!passed) failedCount += 1;
    process.stdout.write(`${passed ? 'ok  ' : 'FAIL'}  ${check.name}${passed ? '' : ` — ${result}`}\n`);
  }

  if (failedCount) {
    process.stderr.write(`\npreflight: ${failedCount} check(s) failed — publish aborted (fail-closed).\n`);
    process.exit(1);
  }
  process.stdout.write('\npreflight: all identity guards hold.\n');
}

main();
