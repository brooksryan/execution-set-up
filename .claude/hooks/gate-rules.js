'use strict';

// gate-rules — data module for the gate-reminders hook feature: which Instance paths
// put which QA gates on the hook, and the reminder/block phrasing injected back.
// Data only (no logic); gate-watch.js consumes it. Phrasing constraint (ADR-0006,
// research §3.1): injected text is model-judged, so it must read as legitimate
// operational instruction grounded in the documented QA-gate protocol.

// Path prefixes (Instance-root-relative, forward slashes) mapped to the gates due
// when a file under them is edited.
const GATE_PATH_RULES = [
  { prefix: 'src/bin/', gates: ['code-standards', 'package-qa'] },
  { prefix: '.claude/agents/', gates: ['alignment'] },
  { prefix: '.excn/adr/', gates: ['alignment'] },
];

// The persistent .excn docs (exact root-relative paths) whose edits put the
// alignment gate on the hook.
const GATED_DOC_FILES = [
  '.excn/CONTEXT.md',
  '.excn/PROCESS.md',
  '.excn/PHILOSOPHY.md',
  '.excn/TEAM_DIRECTIVE.md',
  '.excn/CODE_STANDARDS.md',
];
const GATED_DOC_GATES = ['alignment'];

// PostToolUse additionalContext, with {path} and {gates} placeholders.
const REMINDER_TEMPLATE =
  'Ops reminder (QA-gate protocol, .excn/PROCESS.md): the edit to {path} touched a ' +
  'gate-relevant path. The {gates} gate(s) are due on this change before it lands. ' +
  'When this edit batch is complete, have the gate run and record its verdict in the ' +
  "active sprint record's step_log (.excn/sprints/sprint_<N>.json) or the session " +
  'progress record (.excn/*_progress.json). Do not spawn the gate mid-batch.';

// Stop-block reason, with {paths} and {gates} placeholders.
const BLOCK_REASON_TEMPLATE =
  'QA-gate protocol (.excn/PROCESS.md): this session edited gate-relevant paths ' +
  '({paths}) but no gate verdict has been recorded. The {gates} gate(s) are due — ' +
  'run them (or hand off to the Team Lead) and record the verdict in the active ' +
  "sprint record's step_log (.excn/sprints/sprint_<N>.json) or the session progress " +
  'record (.excn/*_progress.json) before idling.';

module.exports = {
  GATE_PATH_RULES,
  GATED_DOC_FILES,
  GATED_DOC_GATES,
  REMINDER_TEMPLATE,
  BLOCK_REASON_TEMPLATE,
};
