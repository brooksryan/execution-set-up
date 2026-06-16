'use strict';

// channel-guard-rules — data for channel-guard.cjs (EXEC-100, PRD-011, ADR-0011). The two
// guarded record homes and the deny reason surfaced to the model. Data only, no logic: the
// guard owns the decision; this module owns the vocabulary, so phrasing and home changes
// never touch the decision code (mirrors progress-location-guard-rules).

// The two homes whose records are written exclusively through the to-execution CLI/helper
// (ADR-0011: the writeRecord helper is the sole write path for issues and sprints). Any raw
// Write/Edit whose root-relative path starts with one of these is a channel bypass — the
// helper writes via fs, never the agent Write tool, so it is never caught here.
const GUARDED_HOME_PREFIXES = ['.excn/issues/', '.excn/sprints/'];

// The deny reason the model sees (PreToolUse permissionDecisionReason doubles as an
// instruction — it redirects to the CLI rather than dead-ending). PATH_PLACEHOLDER is the
// bypassed path; the reason names the CLI verbs so the writer re-issues through the channel.
// Channel only: it asserts nothing about uuids, shape, or schema — format is guaranteed by
// construction at the helper, so the hook carries no schema logic (it subsumes the
// monolith-shape and uuid/serialization checks an inline content check would otherwise need).
const PATH_PLACEHOLDER = '{path}';
const DENY_REASON_TEMPLATE =
  `Writing "${PATH_PLACEHOLDER}" directly is blocked: issues and sprints are written only through the ` +
  'to-execution CLI (ADR-0011), never by a raw Write/Edit. Records under .excn/issues/ and .excn/sprints/ ' +
  'are minted, validated, and canonically serialized by the writeRecord helper — a hand-edit reintroduces ' +
  'the malformed-JSON and id-collision defects the channel exists to prevent. Re-issue this as a command: ' +
  '`to-execution issue create|update …` for an issue, `to-execution sprint write|append-step …` for a ' +
  'sprint. This guard checks the write channel only; format and content are guaranteed by the helper.';

module.exports = { GUARDED_HOME_PREFIXES, PATH_PLACEHOLDER, DENY_REASON_TEMPLATE };
