#!/usr/bin/env node
'use strict';

// to-execution publish preflight — fail-closed identity guards (ADR-0001).
// Runs via prepublishOnly. Any miss aborts the publish. Node builtins only.

const { execSync } = require('child_process');
const path = require('path');

const EXPECT = {
  gitEmail: 'brooksryan19@gmail.com',
  gitHubUser: 'brooksryan',
  npmUser: 'brooksryan',
  remoteFragment: 'github.com/brooksryan/',
};

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/true' };

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: GIT_ENV, ...opts }).trim();
}

const checks = [
  {
    name: 'git email is personal',
    run() {
      const email = sh('git config user.email');
      return email === EXPECT.gitEmail || `user.email is "${email}", expected "${EXPECT.gitEmail}"`;
    },
  },
  {
    name: `credential resolves to ${EXPECT.gitHubUser}`,
    run() {
      const out = sh('git credential fill', {
        input: 'protocol=https\nhost=github.com\npath=brooksryan/execution-set-up.git\n\n',
      });
      const get = (k) => (out.split('\n').find((l) => l.startsWith(`${k}=`)) || '').slice(k.length + 1);
      if (get('username') !== EXPECT.gitHubUser) return `credential username is "${get('username')}", expected "${EXPECT.gitHubUser}"`;
      if (!get('password')) return 'no stored credential resolvable (empty password)';
      return true;
    },
  },
  {
    name: `npm whoami is ${EXPECT.npmUser}`,
    run() {
      const who = sh('npm whoami');
      return who === EXPECT.npmUser || `npm whoami is "${who}", expected "${EXPECT.npmUser}"`;
    },
  },
  {
    name: 'origin remote is personal',
    run() {
      const url = sh('git remote get-url origin');
      return url.includes(EXPECT.remoteFragment) || `origin is "${url}", expected to contain "${EXPECT.remoteFragment}"`;
    },
  },
  {
    name: 'working tree clean',
    run() {
      const dirty = sh('git status --porcelain');
      return dirty === '' || `tree is dirty:\n${dirty}`;
    },
  },
  {
    name: 'HEAD tagged v<version>',
    run() {
      const version = require(path.join(__dirname, '..', 'package.json')).version;
      const tags = sh('git tag --points-at HEAD').split('\n').filter(Boolean);
      return tags.includes(`v${version}`) || `HEAD tags [${tags.join(', ')}] do not include "v${version}"`;
    },
  },
];

let failed = 0;
for (const check of checks) {
  let result;
  try {
    result = check.run();
  } catch (err) {
    result = (err.stderr || err.message || 'check threw').toString().trim();
  }
  const ok = result === true;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${check.name}${ok ? '' : ` — ${result}`}\n`);
}

if (failed) {
  process.stderr.write(`\npreflight: ${failed} check(s) failed — publish aborted (fail-closed).\n`);
  process.exit(1);
}
process.stdout.write('\npreflight: all identity guards hold.\n');
