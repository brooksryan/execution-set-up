'use strict';

// spawn-guard-rules — data for spawn-guard.js (EXEC-064). Which tool_input keys may
// carry a spawn request's agent type, and the deny reason surfaced to the model.
// Data only, no logic: spawn-guard.js owns the decision; this module owns the
// vocabulary, so phrasing and payload-shape changes never touch the decision code.

// tool_input keys that can carry the requested agent type on the one-shot spawn
// tool, in preference order. `subagent_type` is the Task tool's key (research
// .excn/research/teammate-hook-triggers.md §0/§4); `agent_type` covers builds whose
// spawn payload mirrors the hook-payload identity field.
const AGENT_TYPE_KEYS = ['subagent_type', 'agent_type'];

// The deny reason the model sees (PreToolUse permissionDecisionReason doubles as an
// instruction — research §3). It cites the TEAM_DIRECTIVE routing rule and names the
// right mechanism, so the denial redirects rather than dead-ends.
const TYPE_PLACEHOLDER = '{type}';
const DENY_REASON_TEMPLATE =
  `Spawning "${TYPE_PLACEHOLDER}" as a one-shot agent is blocked: ${TYPE_PLACEHOLDER} is a rostered ` +
  'persistent Teammate. TEAM_DIRECTIVE routing rule: "Sprint slices route to the rostered ' +
  'persistent Teammates; Invoked Agents are for gates and one-shot checks only." Message the ' +
  `persistent ${TYPE_PLACEHOLDER} Teammate (SendMessage) instead of spawning a transient copy.`;

module.exports = { AGENT_TYPE_KEYS, TYPE_PLACEHOLDER, DENY_REASON_TEMPLATE };
