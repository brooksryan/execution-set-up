'use strict';

// Behavioral tests for the spawn-guard hook (sprint-11 S9 — name-based addressability
// after team_name deprecation). Run with `node --test` from src/. Invokes the stamped
// hook as a subprocess with a crafted PreToolUse payload and a temp Instance whose
// hooks.config.json enables the toggle and rosters a persistent type. Asserts the S9
// contract: a rostered type spawned WITH a name passes (no output); spawned UNNAMED
// denies with the reason; the reason points at .excn/TEAM_DIRECTIVE.md and never names
// team_name. These tests live outside the package `files` set, so they are not published.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK_PATH = path.join(__dirname, '..', 'template', '.claude', 'hooks', 'spawn-guard.cjs');
const ROSTERED_TYPE = 'builder';

/**
 * Stamp a temp Instance with the toggle on and one rostered persistent type, run the
 * hook with the given tool_input, and return its stdout (the decision JSON, or '').
 */
function runGuard(toolInput) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-guard-'));
  fs.mkdirSync(path.join(root, '.excn', 'runtime'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.excn', 'hooks.config.json'),
    JSON.stringify({
      schema_version: '1.0',
      features: { spawn_guard: true },
      spawn_guard_persistent_types: [ROSTERED_TYPE],
    }),
  );
  const payload = { cwd: root, tool_name: 'Agent', tool_input: toolInput };
  return execFileSync('node', [HOOK_PATH], { input: JSON.stringify(payload), encoding: 'utf8' });
}

test('rostered type spawned UNNAMED is denied with the routing reason', () => {
  const out = runGuard({ subagent_type: ROSTERED_TYPE, description: 'd', prompt: 'p' });
  assert.notEqual(out.trim(), '', 'expected a decision payload on deny');
  const decision = JSON.parse(out);
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  const reason = decision.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, new RegExp(ROSTERED_TYPE), 'reason names the type');
  assert.match(reason, /\.excn\/TEAM_DIRECTIVE\.md/, 'reason points at the directive');
  assert.doesNotMatch(reason, /team_name/, 'reason must not name the deprecated team_name');
});

test('rostered type spawned WITH a name passes (no output)', () => {
  const out = runGuard({ subagent_type: ROSTERED_TYPE, name: ROSTERED_TYPE, description: 'd', prompt: 'p' });
  assert.equal(out.trim(), '', 'a named rostered spawn must pass untouched');
});

test('a non-rostered type spawned unnamed passes (no output)', () => {
  const out = runGuard({ subagent_type: 'general-purpose', description: 'd', prompt: 'p' });
  assert.equal(out.trim(), '', 'an unguarded type must pass untouched');
});
