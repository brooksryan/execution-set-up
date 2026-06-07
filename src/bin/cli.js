#!/usr/bin/env node
'use strict';

// to-execution — stamps the invariant layout into a target project.
// The Setup Skill runs this; the agent only writes the variant (grilled) files afterward.
// Node builtins only. Never overwrites an existing file unless --force.

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PKG_ROOT, 'template');
const GITIGNORE_BLOCK = [
  '# to-execution: ephemeral agent work-tracking (promote durable conclusions out before relying on git)',
  'tmp/',
];

function usage() {
  process.stdout.write(
    [
      'to-execution — stamp the invariant agent-execution layout',
      '',
      'Usage:',
      '  npx to-execution init [target]   stamp template/ into target (default: cwd)',
      '  npx to-execution init --force    overwrite existing files',
      '',
      'init never overwrites an existing file unless --force. tmp/ is added to .gitignore.',
      '',
    ].join('\n')
  );
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs));
  }
  return out;
}

function ensureGitignore(target) {
  const file = path.join(target, '.gitignore');
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch (_) {
    /* no .gitignore yet */
  }
  const ignoresTmp = current
    .split('\n')
    .some((line) => line.trim().replace(/\/$/, '') === 'tmp');
  if (ignoresTmp) return 'tmp/ already ignored';
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(file, `${prefix}\n${GITIGNORE_BLOCK.join('\n')}\n`);
  return 'added tmp/ to .gitignore';
}

function init(args) {
  const force = args.includes('--force');
  const target = path.resolve(args.find((a) => !a.startsWith('-')) || '.');

  if (!fs.existsSync(TEMPLATE_DIR)) {
    process.stderr.write(`error: template not found at ${TEMPLATE_DIR}\n`);
    process.exit(1);
  }
  fs.mkdirSync(target, { recursive: true });

  const written = [];
  const skipped = [];
  for (const rel of walk(TEMPLATE_DIR)) {
    const src = path.join(TEMPLATE_DIR, rel);
    const dest = path.join(target, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !force) {
      skipped.push(rel);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(rel);
  }

  const gitignore = ensureGitignore(target);

  process.stdout.write(
    [
      `Stamped invariant layout into ${target}`,
      `  wrote   ${written.length} file(s)`,
      `  skipped ${skipped.length} existing file(s)${skipped.length ? ` (use --force to overwrite): ${skipped.join(', ')}` : ''}`,
      `  ${gitignore}`,
      '',
      'Next: the Setup Skill runs the Setup Grill to write the variant files',
      '(CONTEXT.md terms, PHILOSOPHY.md, TEAM_DIRECTIVE.md, Teammate defs).',
      '',
    ].join('\n')
  );
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'init':
      return init(args);
    case undefined:
    case '-h':
    case '--help':
      return usage();
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n`);
      usage();
      process.exit(1);
  }
}

main();
