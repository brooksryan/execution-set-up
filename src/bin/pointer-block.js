'use strict';

// to-execution pointer-block data — the fixed content cli.js wires into a target's
// CLAUDE.md / AGENTS.md (ADR-0002 / PRD-003). Data only, no logic: cli.js owns the
// wiring; this module owns what gets wired so the logic file reads as logic.
//
// Invariants this data must hold:
// - The block's first line is the sentinel, so a wired file always contains it and
//   re-runs detect "already present" by substring match.
// - The sentinel is visible Markdown text, not an HTML comment: Claude Code strips
//   HTML comments before injection, so a comment sentinel would vanish.
// - No @import directive: Claude Code/Codex inline these files at launch, so the
//   pointer must be literal text the agent reads, not a reference.

// Manifest files that carry the pointer. Claude Code reads only CLAUDE.md;
// Codex/Cursor/Copilot/Devin read AGENTS.md — both get the same block.
const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md'];

// First line of the block and the substring that marks a file as already wired.
const POINTER_SENTINEL = '## to-execution framework (.excn/)';

// Codex reads at most this many bytes of an instruction file
// (project_doc_max_bytes default); past it the chain is truncated, so an
// over-cap AGENTS.md warrants a warning.
const CODEX_CHAIN_CAP = 32 * 1024;

// The literal block, sentinel first. Joined with '\n'; cli.js appends the
// trailing newline when it writes, matching the historical on-disk shape.
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

module.exports = { POINTER_FILES, POINTER_SENTINEL, CODEX_CHAIN_CAP, POINTER_BLOCK };
