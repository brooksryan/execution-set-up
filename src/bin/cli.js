#!/usr/bin/env node
'use strict';

// to-execution — stamps the invariant layout into a target project.
// The Setup Skill runs this; the agent only writes the variant (grilled) files afterward.
// Node builtins only. Never overwrites an existing file unless --force.

const fs = require('fs');
const path = require('path');

const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_DIR = path.join(PKG_ROOT, 'template');

// Pointer wiring (CLI-owned, outside the manifest walk; see ADR-0002 / PRD-003).
// Claude Code reads only CLAUDE.md; Codex/Cursor/Copilot/Devin read AGENTS.md.
// Append-only under every flag including --force. Sentinel is visible text —
// Claude Code strips HTML comments before injection. No @import: it inlines at launch.
const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md'];
const POINTER_SENTINEL = '## to-execution framework (.excn/)';
const CODEX_CHAIN_CAP = 32 * 1024;
const POINTER_BLOCK = [
  POINTER_SENTINEL,
  '',
  'This project runs on the to-execution framework. Framework docs live in `.excn/`,',
  'a dotfolder hidden from default search — reach them by the explicit paths below,',
  'and only when the work needs them.',
  '',
  '- .excn/CONTEXT.md — domain glossary and team roster',
  '- .excn/PROCESS.md — how work moves: the Lifecycle, Retro Loop, QA gates',
  '- .excn/PHILOSOPHY.md — project working philosophies',
  '- .excn/TEAM_DIRECTIVE.md — roster, routing, gates, Don\'ts',
  '- .excn/adr/ — decision records · .excn/research/ — durable research',
  '- .excn/schemas/ — JSON schemas for sprint/issue/PRD/progress artifacts',
  '- .excn/{sprints,issues,prds,retros}/ + *_progress.json — ephemeral work-tracking (gitignored)',
].join('\n');

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
      const prefix = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
      fs.appendFileSync(file, `${prefix}${POINTER_BLOCK}\n`);
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

function usage() {
  process.stdout.write(
    [
      'to-execution — stamp the invariant agent-execution layout',
      '',
      'Usage:',
      '  npx to-execution init [target]   stamp template/ into target (default: cwd)',
      '  npx to-execution init --force    overwrite existing files',
      '',
      'init stamps the .excn/ namespace; .excn/.gitignore keeps the work-tracking set out of git.',
      'init wires a pointer block into existing CLAUDE.md / AGENTS.md (append-only,',
      'even under --force; both created if neither exists).',
      'init never overwrites an existing manifest file unless --force.',
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
    // npm pack treats in-package .gitignore files as ignore specs and strips them,
    // so the template ships them un-dotted; stamp restores the real name.
    const destRel =
      path.basename(rel) === 'gitignore' ? path.join(path.dirname(rel), '.gitignore') : rel;
    const dest = path.join(target, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !force) {
      skipped.push(destRel);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(destRel);
  }

  const pointers = wirePointers(target);

  process.stdout.write(
    [
      `Stamped invariant layout into ${target}`,
      `  wrote   ${written.length} file(s)`,
      `  skipped ${skipped.length} existing file(s)${skipped.length ? ` (use --force to overwrite): ${skipped.join(', ')}` : ''}`,
      ...pointers.map((p) => `  ${p}`),
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
