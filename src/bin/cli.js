#!/usr/bin/env node
'use strict';

// to-execution — stamps the invariant layout into a target project.
// The Setup Skill runs this; the agent only writes the variant (grilled) files afterward.
// Node builtins only. Never overwrites an existing file unless --force.

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PKG_ROOT, 'template');

function usage() {
  process.stdout.write(
    [
      'to-execution — stamp the invariant agent-execution layout',
      '',
      'Usage:',
      '  npx to-execution init [target]   stamp template/ into target (default: cwd)',
      '  npx to-execution init --force    overwrite existing files',
      '',
      'init stamps the .excn/ namespace; .excn/.gitignore keeps .excn/tmp/ out of git.',
      'init never overwrites an existing file unless --force.',
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

  process.stdout.write(
    [
      `Stamped invariant layout into ${target}`,
      `  wrote   ${written.length} file(s)`,
      `  skipped ${skipped.length} existing file(s)${skipped.length ? ` (use --force to overwrite): ${skipped.join(', ')}` : ''}`,
      '',
      'Next: the Setup Skill runs the Setup Grill to write the variant files',
      '(.excn/CONTEXT.md terms, .excn/PHILOSOPHY.md, .excn/TEAM_DIRECTIVE.md, Teammate defs).',
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
