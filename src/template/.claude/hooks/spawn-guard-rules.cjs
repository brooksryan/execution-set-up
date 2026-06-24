'use strict';

// spawn-guard-rules — data for spawn-guard.cjs (EXEC-064; realigned in sprint-11 S9).
// Which tool_input keys carry a spawn request's agent type, the key that marks a spawn
// as an addressable persistent Teammate, and the deny reason surfaced to the model.
// Data only, no logic: spawn-guard.cjs owns the decision; this module owns the
// vocabulary, so phrasing and payload-shape changes never touch the decision code.

// tool_input keys that can carry the requested agent type on the spawn tool, in
// preference order. `subagent_type` is the Agent/Task tool's key (research
// .excn/research/teammate-hook-triggers.md §0/§4); `agent_type` covers builds whose
// spawn payload mirrors the hook-payload identity field.
const AGENT_TYPE_KEYS = ['subagent_type', 'agent_type'];

// The tool_input key that marks a spawn as an addressable, continuable persistent
// Teammate: a non-empty `name`. A named spawn runs as the rostered Teammate — loads its
// .claude/agents definition and is addressable/continuable via SendMessage — so the
// guard allows it even for a rostered type; an unnamed one-shot spawn carries no name
// and stays denied. (The earlier name+team_name pair is gone: the Agent/Task API
// collapsed to a single implicit team and ignores team_name — sprint-11 S9.) The
// decision logic lives in spawn-guard.cjs; this is the key vocabulary.
const PERSISTENT_SPAWN_KEY = 'name';

// The deny reason the model sees (PreToolUse permissionDecisionReason doubles as an
// instruction). It points at the routing rule's home and names the current mechanism —
// spawn with a name — so the denial redirects rather than dead-ends.
const TYPE_PLACEHOLDER = '{type}';
const DENY_REASON_TEMPLATE =
  `Spawning "${TYPE_PLACEHOLDER}" as an unnamed one-shot agent is blocked: ${TYPE_PLACEHOLDER} is a ` +
  'rostered persistent Teammate (see: .excn/TEAM_DIRECTIVE.md). Spawn it with a name to run it as an ' +
  `addressable Teammate, or SendMessage the existing ${TYPE_PLACEHOLDER} Teammate instead of a transient copy.`;

module.exports = { AGENT_TYPE_KEYS, PERSISTENT_SPAWN_KEY, TYPE_PLACEHOLDER, DENY_REASON_TEMPLATE };
