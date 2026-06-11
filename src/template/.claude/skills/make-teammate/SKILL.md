---
name: make-teammate
description: Creates a persistent, named Claude Code agent teammate with messaging capabilities and full tool access. Use when the user asks to create a teammate, spin up an agent, or add a team member.
---

# Make Teammate

Creates a **persistent, named teammate** (not a fire-and-forget sub-agent) that can receive direct messages and collaborate via a shared task system.

## Prerequisites — Verify First

Before creating any teammate, confirm `~/.claude/settings.json` contains:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

If missing, add it and tell the user to restart their terminal before continuing.

## Handle the "Already Leading" Error First

If `TeamCreate` returns: _"Already leading team X. A leader can only manage one team at a time."_

The current session is already bound to a team. You must tear it down completely before creating a new one:

**Graceful shutdown (teammates are still running):**
1. Send `{ "type": "shutdown_request" }` to every active teammate via `SendMessage`
2. Wait for each to reply with `{ "type": "shutdown_response" }`
3. Call `TeamDelete` — this clears the session's team context and removes `~/.claude/teams/<name>/` and `~/.claude/tasks/<name>/`

**Force cleanup (teammates are crashed/orphaned or session was restarted):**
- `TeamDelete` will fail if members are still registered. In that case, manually delete the stale directories:
  ```bash
  rm -rf ~/.claude/teams/<team-name>
  rm -rf ~/.claude/tasks/<team-name>
  ```
  Then proceed with `TeamCreate` as normal.

> Note: `~/.claude/teams/` accumulates directories across sessions. Old folders from past sessions are harmless but can be deleted manually anytime.

## Steps

### 1. Create the team

Use `TeamCreate` with a descriptive `team_name`. This creates:
- `~/.claude/teams/<team-name>/config.json` — member registry the team reads to discover each other
- `~/.claude/tasks/<team-name>/` — shared task list

### 2. Spin up each teammate

Use the `Agent` tool with these params:

| Param | Value |
|---|---|
| `name` | Short identifier for this teammate (e.g. `"architect"`) |
| `team_name` | The team name from step 1 |
| `subagent_type` | Use `"general-purpose"` unless the task is read-only (then `"Explore"` or `"Plan"`) |
| `model` | Only set if the user specified a model — use their exact model ID |
| `prompt` | Role description + explicit instruction to use `SendMessage` to communicate back |

**Do not omit `name` and `team_name`.** Without them the agent is an isolated sub-agent with no messaging.

The prompt must tell the teammate:
- Its role and scope
- To use `SendMessage` to report findings, ask questions, or broadcast
- To use `TaskCreate` / `TaskUpdate` to claim and track shared tasks
- To read `~/.claude/teams/<team-name>/config.json` to discover other teammates by `name`

### 3. Shutdown when done

When all work is complete, send `{ "type": "shutdown_request" }` to each teammate via `SendMessage`, wait for `shutdown_response` from each, then call `TeamDelete`.

## Key Rules

- **`TeamCreate` before any `Agent` call** — the messaging inbox doesn't exist until the team folder is created.
- **Model override** — only pass `model` if the user explicitly named one.
- **No in-process agents** — never use a bare `Agent` call without `name` + `team_name` when the goal is a persistent, messaging-capable teammate.
- **Multiple teammates** — create all under the same `team_name` so they can message each other.
- **One team per lead session** — the leading session can only manage one team at a time; tear down the old one before creating a new one.
