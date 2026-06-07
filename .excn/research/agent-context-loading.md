# How Coding-Agent Harnesses Discover and Load Project Context Files

**Research date:** 2026-06-07. All sources fetched live on this date. Items are official-docs-sourced unless marked **[community]** or **[inferred]**. Empirical tests run locally (ripgrep 15.1.0, macOS; GitHub code search via `gh api`).

**Question:** which instruction files each harness auto-loads, from which paths, and critically WHEN — session start in full, lazily on file-read, description-triggered, glob-triggered, or manual.

---

## 1. Claude Code (Anthropic)

Source: official memory docs (code.claude.com/docs/en/memory), fetched 2026-06-07.

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| Managed `CLAUDE.md` | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS), `/etc/claude-code/` (Linux), or `claudeMd` key in managed-settings.json | Session start, in full | Org policy; cannot be excluded |
| `~/.claude/CLAUDE.md` | User home | Session start, in full | User scope, all projects |
| `CLAUDE.md` / `.claude/CLAUDE.md` | Project root **and every ancestor directory** of cwd | Session start, in full | "CLAUDE.md and CLAUDE.local.md files in the directory hierarchy above the working directory are loaded in full at launch." Concatenated root→cwd; closer files appear later |
| `CLAUDE.local.md` | Alongside any CLAUDE.md | Session start, in full | Appended after CLAUDE.md at the same level; gitignored personal notes |
| `CLAUDE.md` in **subdirectories** below cwd | Anywhere in the subtree | **Lazy** — "included when Claude reads files in those subdirectories" | Not loaded at launch. Not re-injected after `/compact` until next read in that subtree |
| `.claude/rules/*.md` (no `paths` frontmatter) | Project `.claude/rules/`, recursive; symlinks supported | Session start, in full | Same priority as `.claude/CLAUDE.md` |
| `.claude/rules/*.md` (with `paths` frontmatter) | Same | **Glob-triggered** — "trigger when Claude reads files matching the pattern, not on every tool use" | Mechanism-enforced lazy loading |
| `~/.claude/rules/*.md` | User home | Session start (unconditional ones); loaded before project rules | Project rules win |
| Skills | `.claude/skills/`, plugins | **Description-triggered / manual** — "only load when you invoke them or when Claude determines they're relevant to your prompt" | Lazy by design |
| Auto memory `MEMORY.md` | `~/.claude/projects/<project>/memory/` | Session start, capped at first 200 lines or 25KB | Topic files "are not loaded at startup. Claude reads them on demand" |

**Imports/composition:** `@path/to/import` syntax anywhere in CLAUDE.md. **Imports inline at launch** — "Imported files are expanded and loaded into context at launch"; "Splitting into @path imports helps organization but does not reduce context." Max depth 4 hops; relative paths resolve from the importing file. External (outside-repo) imports require one-time user approval. So `@import` is NOT a lazy pointer. A *prose* pointer ("read `docs/x.md` before doing Y") is lazy but advisory — Claude follows it with its Read tool at its own discretion.

**AGENTS.md:** "Claude Code reads `CLAUDE.md`, not `AGENTS.md`." Recommended bridge: `@AGENTS.md` import or symlink. `/init` reads an existing AGENTS.md (and `.cursorrules`, `.devin/rules/`, `.windsurfrules`) and merges rather than overwrites.

**Size guidance:** "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." No hard cap on CLAUDE.md ("loaded in full regardless of length"). Auto-memory MEMORY.md hard cap: 200 lines / 25KB. HTML block comments are stripped before injection (free maintainer notes). `claudeMdExcludes` setting skips files by glob. `--add-dir` directories' CLAUDE.md NOT loaded unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.

---

## 2. OpenAI Codex CLI

Sources: developers.openai.com/codex/guides/agents-md and /codex/config-reference, fetched 2026-06-07.

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| `~/.codex/AGENTS.override.md`, else `~/.codex/AGENTS.md` | Codex home (`CODEX_HOME` overridable) | Session start | Global scope, first in chain |
| `AGENTS.override.md` / `AGENTS.md` / fallback names | **Each directory from repo root down to cwd** (at most one file per directory) | **Session start, once per run** — "rebuilds the instruction chain at every session start, not continuously" | "Codex concatenates files from the root down, joining them with blank lines. Files closer to your current directory override earlier guidance because they appear later" |
| `AGENTS.md` **below** cwd | Subdirectories deeper than launch dir | **Never auto-loaded** | Chain stops at cwd. Open feature requests: "Dynamically loading nested AGENTS.md" (openai/codex #12115), "Codex doesn't load AGENTS.md in all the parent directories" (#13288) **[community, open issues, checked 2026-06-07]** |

**Composition:** no import syntax. Plain concatenation. A root AGENTS.md can *point* at deeper docs in prose; Codex may read them with its tools mid-task (advisory, not mechanism-enforced).

**Caps:** `project_doc_max_bytes` — "Maximum bytes read from AGENTS.md when building project instructions"; **default 32 KiB** per the agents-md guide ("Codex skips empty files and stops adding files once the combined size reaches the limit"). `project_doc_fallback_filenames` adds alternative filenames. `model_instructions_file` replaces the built-in instructions file entirely.

---

## 3. Cursor

Source: cursor.com/docs/context/rules, fetched 2026-06-07.

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| `.cursor/rules/*.mdc`, `alwaysApply: true` | Project `.cursor/rules/` (subfolders allowed) | Every session/request — "rule contents are included at the start of the model context" | Always rule; globs/description ignored |
| `.mdc` with `globs` | Same | **Glob-triggered** — auto-attached when matching files are in context | Auto Attached |
| `.mdc` with `description` only | Same | **Description-triggered** — "Agent reads and decides" relevance | Agent Requested (model-mediated) |
| `.mdc` with neither | Same | **Manual** — only via `@rule-name` mention | Manual |
| `AGENTS.md` | Project root | Applied for work in the project | Plain-markdown alternative, no frontmatter |
| `AGENTS.md` (nested) | Any subdirectory | **Lazy/scoped** — "automatically applied when working with files in that directory or its children" | Nested support |
| `.cursorrules` | Project root | Still read | **Deprecated** since ~0.43; docs no longer document it; slated for removal **[community: Cursor forum + third-party guides, 2025–2026]** |
| User Rules | Cursor Settings (not a file) | Every Agent chat | Not applied to Inline Edit/Tab |

**Composition:** rules support `@filename.ts` references; docs explicitly advise "Reference files instead of copying their contents — this keeps rules short and prevents them from becoming stale." A plain `.md` in `.cursor/rules` is ignored (needs `.mdc` frontmatter).

**Size guidance:** "Keep rules under 500 lines"; "Split large rules into multiple, composable rules." No published hard byte cap.

---

## 4. GitHub Copilot

Sources: docs.github.com — add-repository-instructions, response-customization concept, custom-instructions-support reference; fetched 2026-06-07.

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| `copilot-instructions.md` | `.github/` | Per request — "automatically added to requests that you submit to Copilot," effective "as soon as you save" | Repo-wide; supported by Chat/Cloud Agent/Code Review across IDEs + CLI |
| `*.instructions.md` with `applyTo:` glob frontmatter | `.github/instructions/` (subdirs allowed) | **Glob-triggered** — applied to requests touching matching paths | Path-specific; supported in VS Code, JetBrains, Xcode chat + cloud agent + code review; CLI |
| `AGENTS.md` | "Anywhere in repository" — "the nearest AGENTS.md file in the directory tree will take precedence" | When the agent works in that subtree | Coding agent (cloud), VS Code chat, CLI |
| `CLAUDE.md` / `GEMINI.md` | Root only | Coding-agent requests | Compatibility shims for the cloud agent |
| Personal / Organization instructions | github.com settings | Per request on github.com | Priority: personal > repository > organization |

**Caps:** Copilot **code review reads only the first 4,000 characters** of any custom-instruction file. Copilot cloud agent guidance: "Instructions must be no longer than 2 pages." Code review on a PR uses instructions from the PR's **base branch**.

**Composition:** no import syntax documented. Prose pointers possible; the coding agent has repo file access (advisory).

---

## 5. Windsurf (now Devin Desktop / Cascade — Cognition)

Source: docs.windsurf.com 307-redirects to docs.devin.ai/desktop/cascade/memories; fetched 2026-06-07. (Brand note: Windsurf docs now live under Devin.)

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| `global_rules.md` | `~/.codeium/windsurf/memories/` | Always on, every workspace | 6,000-char limit |
| `.devin/rules/*.md` (preferred), `.windsurf/rules/*.md` (fallback) | Workspace + **all subdirectories**; "also searches up to the git root directory" | Per activation mode (below) | One file per rule; 12,000 chars per file |
| `.windsurfrules` | Workspace root | Still read | Legacy single file |
| `AGENTS.md` | Root and subdirectories | "root-level = always-on, subdirectory = auto-glob for that directory" | Mapped into the same rules engine |

**Activation modes (per-rule frontmatter):**
- `always_on` — "Full rule content is included in the system prompt on every message."
- `model_decision` — "Only the `description` is shown in the system prompt"; model pulls the body when relevant (**description-triggered, two-stage lazy**).
- `glob` — "applied when Cascade reads or edits a file matching the `globs` pattern" (**glob-triggered**).
- `manual` — "not in the system prompt. You activate it by typing `@rule-name`."

**Caps:** 6,000 chars global file; 12,000 chars per rule file. (Older Windsurf docs cited a 12,000-char combined total; current Devin docs state per-file — current wording used here.)

---

## 6. Aider

Sources: aider.chat/docs/usage/conventions.html and /docs/config/options.html, fetched 2026-06-07.

| File | Location | WHEN loaded | Mechanism |
|---|---|---|---|
| *(none auto-load)* | — | — | **No instruction file loads without explicit configuration** |
| `CONVENTIONS.md` (convention, any name works) | Anywhere | Session start, **only if pinned** via `aider --read CONVENTIONS.md`, `/read`, or `read:` in `.aider.conf.yml` | Loaded read-only; "cached if prompt caching is enabled" |
| `.aider.conf.yml` | git root, cwd, or home | Session start | Config, not instructions; its `read:` list effectively auto-loads chosen files every session |

**AGENTS.md:** agents.md lists Aider as an ecosystem adopter, but aider's own options reference documents **no** AGENTS.md auto-load and no `--conventions-file` flag (an open docs issue, Aider-AI/aider #4363, July 2025, proposes recommending the AGENTS.md name — doc change only). **Conflict flagged: treat aider as NOT auto-loading AGENTS.md.** Per-repo "auto"-load is achieved by committing `.aider.conf.yml` with `read: [AGENTS.md]`.

**Caps:** none published. **[community]** guidance: keep conventions under 150–200 lines.

---

## Q5 — Arbitrary-directory ingestion, dotfolder visibility, filename triggers

**Does any tool ingest arbitrary directories without a pointer?** No. Every harness loads instructions only from fixed filenames (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `copilot-instructions.md`) and fixed directories (`.claude/rules/`, `.cursor/rules/`, `.devin|.windsurf/rules/`, `.github/instructions/`). A directory with a novel name is invisible to all auto-load mechanisms; its content enters context only via an explicit pointer (import, config entry, or prose instruction) or an agent's ad-hoc file reads.

**Is dotfolder content hidden from default search tooling?** Empirically yes (tested 2026-06-07, ripgrep 15.1.0, temp dir with `.excn/research/doc.md` + `normal/doc.md` containing the same token):
- `rg <token>` → finds only `normal/doc.md` (dotfolder skipped). Same inside a git repo.
- `rg --hidden <token>` → finds both.
- `grep -rl <token> .` → finds both.

So ripgrep-based agent search (the default in most harnesses) will not surface dotfolder content unless invoked with `--hidden` or given the path explicitly. **[inferred]** Claude Code's Grep tool wraps ripgrep; whether it passes `--hidden` by default was not testable from this agent context — direct Read of an explicit dotfolder path always works in all tools.

**Do specific FILENAMES trigger ingestion anywhere in a tree?**
- `CLAUDE.md`: yes within Claude Code — ancestors at launch, subdirectories lazily on file-read.
- `AGENTS.md`: yes in Cursor (nested, applied when working in that dir), Copilot (anywhere, nearest wins), Windsurf/Devin (subdir = auto-glob); in Codex only on the root→cwd chain, never below cwd; in Claude Code and Aider, not at all.
- No tool scans *hidden* directories for these filenames as part of instruction discovery; discovery is directory-tree-walk based on visible project structure rooted at cwd/repo root.

## Q6 — Namespace claims

| Dotfolder | Claimed by | Status |
|---|---|---|
| `.github` | GitHub (Copilot instructions, workflows) | Vendor, entrenched |
| `.claude` | Anthropic Claude Code (rules, agents, skills, settings) | Vendor |
| `.cursor` | Cursor (rules) | Vendor |
| `.codex` | OpenAI Codex — as **home** dir `~/.codex` (config.toml, global AGENTS.md); no documented in-repo role | Vendor (home only) |
| `.windsurf`, `.devin` | Windsurf/Devin (rules; `.devin` preferred post-acquisition) | Vendor |
| `.codeium` | `~/.codeium/windsurf/memories/` global rules | Vendor (home) |
| `.agents` | **Contested by community spec proposals**: dot-agents.com, agentsfolder/spec, bgreenwell/dotagents — no vendor implementation **[community]** | Avoid: ambiguous |
| `.aider.*` | Aider (conf/cache files, not a folder) | Vendor |
| `.gemini`, `.junie`, `.clinerules`, `.roo`, `.goosehints`, `.augment` | Gemini CLI, JetBrains Junie, Cline, Roo, Goose, Augment **[community/vendor, not re-verified today]** | Claimed |
| **`.excn`** | **Nobody.** GitHub code search `path:.excn` → **0 results** (2026-06-07). Web search: no tool, spec, or extension claims it. The string collides only with unrelated repo names (ExCNet, EXCN token). | **Unclaimed** |

**AGENTS.md standard adoption:** agents.md reports use by "over 60k open-source projects"; adopters include OpenAI Codex, Google Jules, Cursor, Zed, VS Code/GitHub Copilot, Devin/Windsurf, Gemini CLI, JetBrains Junie, Aider (listed; see §6 caveat), and 20+ others. It is the de-facto cross-tool root-instruction filename. Claude Code is the notable holdout (CLAUDE.md + import/symlink bridge). Nearest-file-wins nesting is the documented standard semantic, but per-tool WHEN differs sharply (Codex: launch-time chain only; Cursor/Copilot/Devin: scoped/lazy).

## Assumption verdicts

**(A) Host projects already carry auto-loaded agent instructions a scaffolder must not conflict with — TRUE.** Any repo containing `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, or `.devin|.windsurf/rules/` injects those files automatically into the respective harness, and home-level files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `global_rules.md`) inject regardless of project. Multiple tools concatenate rather than override (Claude Code ancestors; Codex chain), so a scaffolder that writes its own root `CLAUDE.md`/`AGENTS.md` would silently merge with — or clobber — host instructions. Safe patterns the vendors themselves document: append/import (`@AGENTS.md`), symlink, or merge (Claude `/init` "suggests improvements rather than overwriting").

**(B) Modular, only-when-needed instruction sets are achievable per tool — TRUE for 4 of 6, with two distinct mechanisms.**
- *Mechanism-enforced lazy:* Claude Code (`.claude/rules` `paths:` frontmatter; subdirectory CLAUDE.md on file-read; skills), Cursor (`globs` auto-attach; `description` agent-requested; nested AGENTS.md), Windsurf/Devin (`glob` + `model_decision` modes), Copilot (`applyTo` globs in `.instructions.md`; nested AGENTS.md nearest-wins).
- *Not natively achievable:* Codex CLI (entire root→cwd chain loads at session start under a 32 KiB cap; nothing below cwd ever auto-loads) and Aider (explicit pin only).
- *Universal fallback:* a small root file that **points in prose** at deeper docs ("when doing X, first read `<dir>/X.md`") works in every tool, because all six agents have file-read tools — but it is advisory (model-mediated), not mechanism-enforced. Claude Code's `@import` is NOT this: imports inline at launch and "do not reduce context."

## Implications for folder naming + wiring (factual)

1. `.excn` is unclaimed by any tool, spec, or convention (0 GitHub code-search hits, no web claims, 2026-06-07). No harness will ever auto-ingest its contents, and no future collision with documented vendor namespaces (`.claude`, `.cursor`, `.codex`, `.github`, `.windsurf`, `.devin`, `.agents`) exists today.
2. Because it is a dotfolder, default ripgrep-based search skips it; agents reach its content only through an explicit pointer or an exact path. Wiring therefore requires a pointer in a file each harness actually loads.
3. Pointer cost differs by mechanism: Claude Code `@.excn/...` imports inline at launch (full token cost); a prose pointer costs ~1 line and defers tokens until read; `.claude/rules/*.md` with `paths:` gives mechanism-enforced lazy loading scoped to globs.
4. For Codex, the only auto-loaded surface is the AGENTS.md chain (root→cwd, 32 KiB default cap) — deep-doc loading must be prose-pointer driven from a root AGENTS.md.
5. For Cursor/Copilot/Devin, glob- and description-triggered rule files provide native lazy loading; for Aider, only a committed `.aider.conf.yml` `read:` list pins instructions.
6. Any scaffolder-written root instruction file must merge with, import, or sit alongside pre-existing `CLAUDE.md`/`AGENTS.md` — never replace them, since every harness auto-loads what is already there.

## Sources (all accessed 2026-06-07)

- Claude Code memory docs — https://code.claude.com/docs/en/memory (official)
- AGENTS.md standard site — https://agents.md/ (official, OpenAI-stewarded)
- Codex AGENTS.md guide — https://developers.openai.com/codex/guides/agents-md (official)
- Codex config reference — https://developers.openai.com/codex/config-reference (official)
- Cursor rules docs — https://cursor.com/docs/context/rules (official)
- Copilot repository instructions — https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions (official)
- Copilot response customization — https://docs.github.com/en/copilot/concepts/prompting/response-customization (official)
- Copilot support matrix — https://docs.github.com/en/copilot/reference/custom-instructions-support (official)
- Windsurf/Devin rules & memories — https://docs.devin.ai/desktop/cascade/memories (official; via 307 redirect from docs.windsurf.com)
- Aider conventions — https://aider.chat/docs/usage/conventions.html (official)
- Aider options reference — https://aider.chat/docs/config/options.html (official)
- openai/codex #12115 "Dynamically loading nested AGENTS.md"; #13288 "Codex doesn't load AGENTS.md in all the parent directories" — github.com/openai/codex/issues [community, open]
- Aider-AI/aider #4363 — github.com/aider-ai/aider/issues/4363 [community, open, filed 2025-07-19]
- `.cursorrules` deprecation — Cursor community forum (forum.cursor.com/t/51779, /t/113200) + third-party migration guides [community]
- `.agents` proposals — dot-agents.com; github.com/agentsfolder/spec; github.com/bgreenwell/dotagents [community]
- Empirical: ripgrep 15.1.0 hidden-dir test (local, /tmp); GitHub code search `path:.excn` via `gh api` → 0 results
