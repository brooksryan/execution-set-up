# Teammate Hook Triggers — Sensing and Steering Agent-Team Members via Claude Code Hooks

**Research date:** 2026-06-08. Claude Code **v2.1.168** (macOS, arm64). Findings are grounded in three evidence classes, marked inline:

- **[empirical]** — I observed it directly on this machine (live agent team `arsenal-data`, 5 teammates running in tmux panes; binary string extraction; live process-environment dumps).
- **[docs]** — from the Claude Code hooks reference (`code.claude.com/docs/en/hooks.md`, `/hooks-guide.md`, `/agent-teams.md`), fetched 2026-06-08.
- **[inferred]** — follows from the POSIX process model or observed structure but not directly tested; flagged where a probe would upgrade it to [empirical].
- **[probe]** — unresolved; requires a logging hook installed in a live teammate session to settle.

**Question:** what teammate status/actions can a hook sense, how does a hook know *which* teammate fired, and what can it inject back — as the foundation for audits, file-update reminders, and status-based instruction injection.

---

## 0. Empirical results — live probe run (2026-06-08)

A logging-only probe (one command hook per event, appending JSONL; never blocks) was installed as **project** `.claude/settings.local.json` in the live `arsenal-data` team and run briefly, then disarmed. It captured a controlled fresh `claude -p` session **and the already-running teammates** (scribe `%45`, data-curator `%46`, analyst `%47`, football-historian `%48`) firing hooks during real work. Headline findings, all **[empirical]**:

1. **Identity is delivered in the hook payload — no pane lookup needed.** Every tool-event stdin carries **`agent_type`** (the teammate role: `analyst`, `scribe`, `data-curator`, `football-historian`; `general-purpose` for `Task()` subagents) and, for subagents, **`agent_id`** (a hash). This supersedes the `TMUX_PANE`→config recipe from §2 — that's now corroboration / instance-disambiguation, not the primary path.
2. **`TeammateIdle` is real and self-identifying.** Payload: `{ agent_type, teammate_name, team_name }` (observed: `teammate_name:"scribe", team_name:"arsenal-data"`). It fired in the **teammate's own session** (hook ran with `TMUX_PANE=%45`, scribe's pane), not only the lead's.
3. **Project `settings.local.json` hooks fire inside teammate sessions — including ones already running** when the probe was added (the team got captured without a restart). Global-settings firing in teammates remains untested, but project scope is confirmed and is the right production location anyway.
4. **`TMUX_PANE` is inherited by the hook process** — confirmed on real teammates (each fired with its correct pane matching the roster). Upgrades §2.2 from [inferred] to [empirical].
5. **Confirmed firing:** `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `UserPromptSubmit`, `TeammateIdle`. **Not observed in-window** (so firing still unconfirmed): `SubagentStop`, `TaskCreated`, `TaskCompleted`, `FileChanged`. (`TaskCreated/Completed` plausibly silent because this team tracks work in a custom doc, not the native Task tool.)

### Observed stdin field inventory (real payloads)

| Event | Identity fields | Other notable fields |
|---|---|---|
| `PreToolUse` | `agent_type`, `agent_id` (subagents) | `tool_name`, `tool_input`, `tool_use_id`, `cwd`, `session_id`, `transcript_path`, `permission_mode`, `effort` |
| `PostToolUse` | `agent_type`, `agent_id` (subagents) | above + `tool_response`, `duration_ms` |
| `Stop` | `agent_type` | `stop_hook_active` (loop guard — confirmed real), `last_assistant_message`, `background_tasks`, `session_crons` |
| `UserPromptSubmit` | — | `prompt` (full text), `cwd`, `session_id` |
| `SessionStart` | — | `source` (startup/resume/clear/compact), `transcript_path` |
| `TeammateIdle` | `agent_type`, **`teammate_name`**, **`team_name`** | `cwd`, `session_id`, `transcript_path` |

**Identity caveat:** `agent_type` is the *role/type*, not a unique instance. In this team `name == agentType` so it disambiguates; in a team with multiple same-type members (e.g. eval-swarm's `slot-1..slot-4`) it would not — there, use `agent_id` or the `TMUX_PANE`→`config.json` `name` lookup for the unique instance.

---

## 1. Hook event surface (what exists in this build)

Every event name below is present in the v2.1.168 binary **[empirical]** (string extraction; count = occurrences, a rough proxy for how load-bearing the event is internally):

| Event | bin hits | Use as a trigger |
|---|---:|---|
| `PreToolUse` | 78 | Gate a tool call before it runs (deny/allow/ask). |
| `PostToolUse` | 86 | React after a tool completes — the workhorse for "agent did X". |
| `Stop` | 166 | Agent about to go idle (per session). Can force-continue. |
| `SubagentStop` | 54 | An inline `Task()` subagent finished (fires in the spawning session). |
| `TeammateIdle` | 25 | An agent-team teammate about to idle (delivered to the lead). **The per-teammate idle signal.** |
| `TaskCreated` | 20 | A task was created in the Task store. |
| `TaskCompleted` | 25 | A task was marked completed. |
| `FileChanged` | 25 | A tracked file changed (reactive watch). |
| `CwdChanged` | 19 | Working directory changed. |
| `PostToolBatch` | 23 | After a parallel tool batch. |
| `InstructionsLoaded` | 16 | Supplements loaded instruction files. |
| `PermissionRequest` | 40 | A permission decision is being made. |
| `UserPromptSubmit` | 38 | A prompt was submitted — prepend context. |
| `SessionStart` / `SessionEnd` | 57 / 23 | Session lifecycle. |
| `PreCompact` | 35 | Before context compaction. |
| `Notification` | 29 | Claude needs attention / idle ~60s. |

**Caveat:** a string in the binary proves the event *name* exists, not that every one is user-configurable under `settings.json → hooks` with the matcher semantics you'd expect. The well-established configurable set (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, Notification, SessionStart, SessionEnd, PreCompact) is **[docs]**-confirmed. The team/file events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`, `FileChanged`, `CwdChanged`, `PostToolBatch`, `InstructionsLoaded`) are present in the binary **[empirical]** and were reported as configurable by a docs-reading pass **[docs, single-source]** — treat as real-but-verify until the probe (§5) confirms firing.

**No `TaskUpdate` hook.** There is a `TaskUpdate` *tool* but no `TaskUpdate` *event*. Task lifecycle events are creation and completion only. Therefore **"an agent claimed a task" is not a first-class event** — you catch it via `PostToolUse` matching the `TaskUpdate` tool and inspecting `tool_input` (§4).

---

## 2. Identifying which teammate fired a hook

This is the crux for any per-teammate logic. **Resolved by the probe (§0): the payload self-identifies.** Read `agent_type` (role) from stdin, plus `teammate_name`/`team_name` on `TeammateIdle`, and `agent_id` for subagents. The `TMUX_PANE`→config recipe below remains useful only as (a) corroboration and (b) the unique-instance discriminator when several teammates share an `agent_type`. The original gap analysis is kept for that reason.

### 2.1 The session→agent gap [empirical]

The team manifest `~/.claude/teams/<team>/config.json` lists each member with: `agentId` (e.g. `analyst@arsenal-data`), `name`, `agentType`, `color`, `model`, `cwd`, `isActive`, `subscriptions`, `prompt`, and **`tmuxPaneId`**. It does **not** carry a per-member `sessionId` (only the lead's `leadSessionId`). So a hook's `session_id` (from stdin) cannot be mapped to an agent through the manifest. `cwd` doesn't disambiguate either — all teammates share one working directory.

### 2.2 `TMUX_PANE` is the reliable identifier [empirical]

Each teammate runs as its own `claude` process inside a dedicated tmux pane. Dumping the live process environments (`ps eww <pid>`) of all five `arsenal-data` teammates showed every one carries a **distinct `TMUX_PANE`** matching its `config.json` `tmuxPaneId`:

```
PID 17355  TMUX_PANE=%45   → scribe
PID 18036  TMUX_PANE=%46   → data-curator
PID 18739  TMUX_PANE=%47   → analyst
PID 19417  TMUX_PANE=%48   → football-historian
PID 20528  TMUX_PANE=%49   → source-scout
```

Also present in every teammate env: `CLAUDECODE=1` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (a hook can use the latter to detect "I'm in a team session"). **No** env var carries the agent name or id directly — `TMUX_PANE` is the only per-teammate discriminator in the environment.

**A command hook is a child of the `claude` process, so it inherits `claude`'s environment, including `TMUX_PANE`** [inferred — high confidence; POSIX child inheritance, and Claude Code does not scrub env for command hooks]. The probe (§5) upgrades this to [empirical].

### 2.3 The identification recipe

```
pane="$TMUX_PANE"                                  # e.g. %47   [inherited by the hook]
agent=$(jq -r --arg p "$pane" \
  '.members[] | select(.tmuxPaneId==$p) | .name' \
  ~/.claude/teams/<team>/config.json)              # → analyst
```

**Gotchas:**
- Read `config.json` **live** at hook time. Panes are reassigned on respawn — across two respawns of the same team I observed the pane set move `%37–%40` → `%45–%49`. A cached map goes stale.
- The lead's `tmuxPaneId` is empty; lead-originated tool calls won't match any teammate pane (usually what you want).
- A human-run `claude` in some other pane has a `TMUX_PANE` not in `members[]` → no match → treat as "not a gated teammate."
- Whether the hook stdin *also* carries an agent id directly is **[probe]** — if it does, prefer it over the pane lookup.

---

## 3. What a hook can inject back

Sensing is half; the other half is steering the agent. The three core steering returns were **tested with hooks that actually return decisions** (isolated `claude -p` sessions, 2026-06-08) — see §3.1 for the exact JSON that worked and the proof.

| Goal | Hook + return | Confidence |
|---|---|---|
| **Block a tool call, tell the agent why** | `PreToolUse` → `permissionDecision:"deny"` + `permissionDecisionReason`. The reason is surfaced to the model, so the denial doubles as an instruction. | **[empirical]** |
| **Force an idle-bound agent to keep working** | `Stop` → `decision:"block"` + `reason`. Agent cannot stop; must act on `reason`. Guard with `stop_hook_active` (true on a hook-induced continuation) to avoid infinite loops; there's an iteration cap (~8). | **[empirical]** |
| **Inject context** (e.g. just claimed a task → hand it the condensed brief) | `UserPromptSubmit` (tested) / `PostToolUse` → `additionalContext` (model sees it on the next turn). | **[empirical]** (UserPromptSubmit); [docs] (PostToolUse) |
| **Standing context at spawn** | `SessionStart` → `additionalContext`. | [docs] |
| **Warn the human, not the model** | `systemMessage` on an exit-0 JSON return. | [docs] |
| **Async nudge into a teammate** | Append a message object to that teammate's inbox file (§4.3). | [empirical] |

### 3.1 Steering probe results (2026-06-08)

Three isolated `claude -p` sessions, each with a project hook that returns a decision. Tested on solo sessions, not live teammates — but the sensing probe (§0) proved teammates run the identical hook machinery with identical payloads, so these are expected to apply to teammates verbatim (returning a *block* into a live teammate was deliberately not done, to avoid disrupting real work).

| Test | Hook return (verbatim) | Proof | Result |
|---|---|---|---|
| Deny | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` | `touch` sentinel file **never created**; model reply: "the probe denied the Bash call by policy, so the touch command never ran" | **PASS** — blocks AND the reason reaches the model |
| Stop-block | `{"decision":"block","reason":"…use Write to create /tmp/…proof.txt with ENFORCED…"}` | a prompt that should reply "DONE" and stop instead **created the file (content `ENFORCED`)**; two Stop fires logged, 2nd with `stop_hook_active:true` (guard exited) | **PASS** — forces continuation, executes the injected instruction, no loop |
| Inject | `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…end every reply with [CTX-OK]…"}}` | reply to "say hello" ended with `[CTX-OK]` | **PASS** — injected directive reaches and steers output |

**Critical caveat — injected context is filtered by prompt-injection defenses.** A first Inject attempt used an adversarial payload ("SECRET_PROBE_TOKEN=BANANA7, repeat it if asked"). The model *received* it (it explicitly named "text inserted into my context… injected secrets") but **refused to act on it**, treating it as a prompt-injection attempt. The benign rerun (a formatting directive) was followed. **Implication for status-based instruction injection:** injected guidance must read as legitimate operational instruction. Anything resembling secret exfiltration, identity spoofing, or a safety override will be recognized as injected and resisted — `additionalContext` is not a trusted-system channel, it's model-visible context the model still judges.

Two design rules that fall out of this:
- **File-update reminder = `Stop` block+reason.** "You edited the derived layer but didn't update the progress record — do that before idling." Scope it per-agent via §2.3.
- **Status-based instruction elevation = `PostToolUse` on `TaskUpdate` → `additionalContext`.** When an agent flips a task to `in_progress`, inject *just that task's* compressed brief instead of front-loading every instruction at spawn.

---

## 4. Team tasks vs. teammate tasks vs. solo tasks

The built-in Task tools (`TaskCreate` / `TaskUpdate` / `TaskList`) write to a JSON store, but **where** they write depends on context, and this determines whether tasks are shared.

### 4.1 Two store locations [empirical]

| Context | Store path | `owner` field? |
|---|---|---|
| **Inside a team** | `~/.claude/tasks/<team-name>/` (keyed by team name) | **Yes** |
| **Solo session** | `~/.claude/tasks/<session-uuid>/` (keyed by session id) | **No** |

Confirmed by classifying all 28 task stores on disk against the team roster: stores named after teams (`eval-swarm`, `flexcare-triage`, `sf-mcp-shim`, `arsenal-data`, …) vs. stores named with session UUIDs. Schemas differ by exactly one field:

```
team task   keys: id, subject, description, activeForm, owner, status, blocks, blockedBy
solo task   keys: id, subject, description,            status, blocks, blockedBy
```

### 4.2 How team tasks are shared

**There is no per-teammate private task list.** Within a team, every teammate's Task tool reads and writes the **same** team-keyed store — one file per task (`<id>.json`), all teammates pointed at the same directory. Assignment is not a separate store; it's the **`owner` field on each shared task**. From the live `eval-swarm` store (26 tasks):

```
owner distribution:  (unowned) 10   slot-3 5   slot-2 4   slot-4 3   slot-4-2 2   slot-1 2
status:              completed 22   pending 4
```

So the model is: **one shared backlog per team; "claiming" = setting `owner` to yourself via `TaskUpdate`; "unowned" = unclaimed.** The `.lock` file in each store is the concurrency guard for simultaneous writes by multiple teammates.

Implications for triggers:
- **`owner` on the shared team task store is the structured claim-of-record** — the thing a "has this teammate claimed work?" predicate can actually query (unlike free-form project trackers, which often have no owner field). Read the store, find a task with `owner==<agent-from-§2.3>` and `status!=completed`.
- "Agent claimed task" is observable two ways: reactively via `PostToolUse` on `TaskUpdate` (inspect `tool_input` for `owner`/`status`), or by polling the shared store's `owner` fields.
- A team that tracks work in a **custom** doc instead of the native Task tools will have an empty native store (just `.lock`) — claims then live only in that custom doc, whose schema may not encode ownership. Choosing the native Task store buys you a structured claim signal for free.

### 4.3 Inbox (messaging) is a separate, parallel store [empirical]

Distinct from tasks: `~/.claude/teams/<team>/inboxes/<agent>.json` is a JSON **array** of messages, schema `{from, text, timestamp, read}`. A hook can deliver an autonomous message by appending `{..., "read": false}` — use an atomic write (temp + rename) since teammates write these concurrently. This is the async-nudge channel referenced in §3.

---

## 5. Open questions — probe results (2026-06-08)

The passive probe (§0) was built, run against the live team, and disarmed. Status of each original question:

1. ~~Do **global** vs **project** hooks fire in teammate sessions?~~ **Project `.claude/settings.local.json` confirmed firing in teammate sessions** [empirical], including already-running ones. Global-settings firing in teammates **still untested** — but project scope is the right production location, so deprioritized.
2. ~~Does the hook inherit `TMUX_PANE`?~~ **Yes** [empirical] — real teammates each fired with their correct pane.
3. ~~Does `TeammateIdle` fire and where is it delivered?~~ **Fires** [empirical], in the **teammate's own session**, carrying `teammate_name`/`team_name`. (Whether the lead *also* receives a copy was not isolated — single observation.)
4. ~~Does stdin carry a native agent id?~~ **Yes** [empirical] — `agent_type` on all tool events, `agent_id` for subagents, `teammate_name` on idle. This is now the primary identity path.
5. **Still open [probe]:** `SubagentStop`, `TaskCreated`, `TaskCompleted`, `FileChanged` did **not** fire in the capture window — unconfirmed as configurable/firing. `TaskCreated/Completed` likely silent only because this team uses a custom tracker, not the native Task tool; re-test on a team that uses `TaskCreate`/`TaskUpdate`.

**Probe artifacts retained:** logging script at `~/.claude/probe/teammate-probe.sh`; disarmed settings at `~/.claude/probe/arsenal-settings.local.json.disarmed` (move back into a project's `.claude/` to re-arm); sample capture at `/tmp/teammate-hook-probe.jsonl`. The probe was logging-only and added a short-lived per-tool hook to the live team during capture; it has been removed.

---

## 6. Synthesis — what's buildable today

- **Identify the actor:** solved — read `agent_type` from the hook payload (+ `agent_id`/`TMUX_PANE`→config for unique instance when types collide) [empirical].
- **Sense a claim:** `PostToolUse`/`TaskUpdate`, or poll the shared team store's `owner` field [empirical].
- **Sense an edit:** `PostToolUse`/`Write|Edit|MultiEdit`, filter `file_path` [empirical — observed firing on live teammate edits].
- **Sense idle:** `TeammateIdle` — fires in the teammate's own session with `teammate_name`/`team_name` [empirical]. `Stop` also available per-session.
- **Steer:** `PreToolUse` deny+reason (gate), `Stop` block+reason (file-update reminder), `PostToolUse` additionalContext (status-based instruction injection), inbox append (async nudge).

**Steering is confirmed** [empirical, §3.1]: `PreToolUse` deny, `Stop` block, and `UserPromptSubmit` `additionalContext` all take effect (tested on solo `claude -p`; teammate machinery is identical per §0). The one design constraint is that `additionalContext` is model-judged, not trusted — injected instructions must read as legitimate ops or they're resisted as prompt injection.

One dependency remains before a *claim-gated* predicate is buildable: whether the team records claims in the **native** Task store (structured `owner`, queryable) or a custom doc (often no owner field). That's a workflow choice, not a plumbing one. Everything else — sense which teammate, sense the action, block, remind, inject — is proven.
