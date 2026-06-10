#!/usr/bin/env node
'use strict';

// message-nudge — the message follow-through nudge feature (EXEC-044, ADR-0006;
// default OFF). Wired in settings.json as PostToolUse on SendMessage (the agent-teams
// messaging tool — verified against the Claude Code agent-teams docs), so it fires in
// the SENDER's session. When the toggle is on, it scans the sent message's content for
// the follow-through it implies (record update, issue, gate — nudge-rules.js) and
// injects that as additionalContext back to the sender. Remind-only: it never blocks
// and never watches recipients. Every firing logs one invocation record via hook-lib
// (CODE_STANDARDS ## Hooks). FAIL SAFE: every path, including thrown errors, exits
// 0 (PRD-007); injected phrasing must read as legitimate ops instruction (§3.1).

const path = require('path');
const lib = require('./hook-lib');
const { FOLLOW_THROUGH_RULES, DEFAULT_ACTION, NUDGE_TEMPLATE } = require('./nudge-rules');

const FEATURE = 'message_nudge';

// Identity and event name for the invocation log (CODE_STANDARDS ## Hooks); the
// event matches this script's settings.json wiring.
const SCRIPT_NAME = path.basename(__filename);
const HOOK_EVENT = 'PostToolUse';

// SendMessage payload shapes vary by message type; these tool_input keys are the
// candidate carriers of the human-readable message body and the recipient name.
const CONTENT_KEYS = ['message', 'content', 'text', 'summary'];
const RECIPIENT_KEYS = ['recipient', 'to', 'name'];
const DEFAULT_RECIPIENT = 'your teammate';

/**
 * Pull the first non-empty string under any of the candidate keys.
 * @param {object} toolInput - the hook payload's tool_input object.
 * @param {string[]} keys - candidate keys, in preference order.
 * @returns {string} the first hit, or '' when none carries a string.
 */
function firstString(toolInput, keys) {
  for (const key of keys) {
    if (typeof toolInput[key] === 'string' && toolInput[key] !== '') return toolInput[key];
  }
  return '';
}

/**
 * Name the follow-through actions a message's content implies.
 * @param {string} content - the sent message body.
 * @returns {string} matched actions joined for the nudge, or the default obligation
 * when nothing specific matches.
 */
function impliedActions(content) {
  const actions = FOLLOW_THROUGH_RULES.filter((rule) => rule.pattern.test(content)).map(
    (rule) => rule.action
  );
  return actions.length > 0 ? actions.join('; and ') : DEFAULT_ACTION;
}

/**
 * Entry point: on an enabled firing, inject the content-derived follow-through nudge
 * as PostToolUse additionalContext in the sender's session. Every path logs exactly
 * one invocation record (CODE_STANDARDS ## Hooks) and exits 0 (fail safe, ADR-0006).
 * @returns {void}
 */
function main() {
  let projectRoot = process.cwd();
  let outcome = lib.OUTCOME_ERROR;
  try {
    const payload = lib.readPayload();
    if (payload) {
      projectRoot = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();
      if (!lib.featureEnabled(projectRoot, FEATURE)) {
        outcome = lib.OUTCOME_DISABLED;
      } else {
        const toolInput = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
        const recipient = firstString(toolInput, RECIPIENT_KEYS) || DEFAULT_RECIPIENT;
        lib.emit({
          hookSpecificOutput: {
            hookEventName: HOOK_EVENT,
            additionalContext: NUDGE_TEMPLATE.replace('{recipient}', recipient).replace(
              '{actions}',
              impliedActions(firstString(toolInput, CONTENT_KEYS))
            ),
          },
        });
        outcome = lib.OUTCOME_OK;
      }
    }
  } catch {
    outcome = lib.OUTCOME_ERROR; // fail safe: a broken hook never blocks work
  }
  lib.logInvocation(projectRoot, SCRIPT_NAME, HOOK_EVENT, outcome);
  process.exit(0);
}

main();
