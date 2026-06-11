'use strict';

// nudge-rules — data module for the message follow-through nudge feature (EXEC-044):
// which message content implies which follow-through, and the nudge phrasing injected
// back into the SENDER's session. Data only (no logic); message-nudge.cjs consumes it.
// Phrasing constraint (ADR-0006, research §3.1): injected text is model-judged, so it
// must read as legitimate operational instruction grounded in the documented process —
// never an override or an out-of-band command.

// Content patterns mapped to the follow-through each implies. First-match-per-rule,
// all matching rules accumulate; order is most-specific first.
const FOLLOW_THROUGH_RULES = [
  {
    pattern: /\b(gate|verdict|pass(?:ed)?|fail(?:ed)?)\b/i,
    action: 'record the gate verdict in the session progress record (.excn/*_progress.json)',
  },
  {
    pattern: /\b(issue|bug|ticket|backlog|EXEC-\d+)\b/i,
    action: 'file or update the corresponding issue in the .excn issue tracker',
  },
  {
    pattern: /\b(done|complete[d]?|finished|shipped|landed|closed)\b/i,
    action: 'update the progress record so the recorded state matches what you just reported',
  },
  {
    pattern: /\b(blocked|blocker|waiting on|stuck)\b/i,
    action: 'record the blocker in the progress record so it is visible beyond this message',
  },
];

// Fallback when no rule matches: the protocol obligation still holds.
const DEFAULT_ACTION =
  'check whether it implies a record update, an issue, or a gate, and do that follow-through now';

// The injected nudge, with {recipient} and {actions} placeholders.
const NUDGE_TEMPLATE =
  'Ops reminder (messaging follow-through, .excn/PROCESS.md): the message you just ' +
  'sent to {recipient} carries follow-through on your side — {actions}. A message is ' +
  'a report, not a record: the work-tracking JSON must reflect what you told your teammate.';

module.exports = { FOLLOW_THROUGH_RULES, DEFAULT_ACTION, NUDGE_TEMPLATE };
