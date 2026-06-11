'use strict';

// spawn-guard-rules — data for spawn-guard.cjs (EXEC-064). Which tool_input keys may
// carry a spawn request's agent type, and the deny reason surfaced to the model.
// Data only, no logic: spawn-guard.cjs owns the decision; this module owns the
// vocabulary, so phrasing and payload-shape changes never touch the decision code.

// tool_input keys that can carry the requested agent type on the one-shot spawn
// tool, in preference order. `subagent_type` is the Task tool's key (research
// .excn/research/teammate-hook-triggers.md §0/§4); `agent_type` covers builds whose
// spawn payload mirrors the hook-payload identity field.
const AGENT_TYPE_KEYS = ['subagent_type', 'agent_type'];

// tool_input keys that together mark a spawn as a persistent-Teammate spawn into a
// team: a `name` to address the Teammate by and the `team_name` to spawn it into.
// When BOTH carry a value the spawn is the legitimate rostered mechanism (the
// Teammate runs with its .claude/agents definition), so the guard allows it even for
// a rostered type; a bare one-shot spawn carries neither and stays denied. Decision
// logic (require both present) lives in spawn-guard.cjs — this is the key vocabulary.
const TEAM_SPAWN_KEYS = ['name', 'team_name'];

// The deny reason the model sees (PreToolUse permissionDecisionReason doubles as an
// instruction — research §3). It cites the TEAM_DIRECTIVE routing rule and names the
// allowed mechanism, so the denial redirects rather than dead-ends.
const TYPE_PLACEHOLDER = '{type}';
const DENY_REASON_TEMPLATE =
  `Spawning "${TYPE_PLACEHOLDER}" as a one-shot agent is blocked: ${TYPE_PLACEHOLDER} is a rostered ` +
  'persistent Teammate. TEAM_DIRECTIVE routing rule: "Sprint slices route to the rostered ' +
  'persistent Teammates; Invoked Agents are for gates and one-shot checks only." To run ' +
  `${TYPE_PLACEHOLDER} as its rostered self, spawn it with both name and team_name into the team ` +
  `(so it loads its .claude/agents definition); otherwise message the persistent ${TYPE_PLACEHOLDER} ` +
  'Teammate (SendMessage) instead of spawning a transient copy.';

module.exports = { AGENT_TYPE_KEYS, TEAM_SPAWN_KEYS, TYPE_PLACEHOLDER, DENY_REASON_TEMPLATE };
