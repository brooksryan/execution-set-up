# Prior Art: Speculative Pre-Warm of the Synthesis Tail
**PRD:** `019ef6f4-4617-7f65-acfd-7b83c541f3a9`  
**Researched:** 2026-06-23

---

## Existing Approaches

### 1. Deterministic cache regeneration and staleness invalidation

**mtime-based invalidation (Make, Ninja)**  
The canonical approach: compare source mtime against cache mtime; rebuild when source is newer. Make uses `>` (strict greater-than), which is wrong at coarse granularity — on 1-second filesystems two sequentially written files can land on the same timestamp, so the cache is never flagged stale. Apenwarr's 2018 writeup documents all three failure modes: (a) clock skew across NFS/distributed builds can make source mtime appear *older* than the cache even when the source changed; (b) `mv`/rename preserves the original mtime, so a replaced file does not register as newer; (c) mtime is not monotonically increasing — `touch` or a system-clock rollback can make a cache appear newer than it is. Recommendation from that analysis: track mtime + size + inode + content hash together, not mtime alone.  
Source: <https://apenwarr.ca/log/20181113>

**Ninja on NTFS — 1-second skew bug**  
A filed Ninja issue shows repeated unnecessary rebuilds on a CentOS box mounting an NTFS share: stored dep timestamps differed by 1 second from actual file timestamps. Root cause: NTFS timestamp resolution plus network timing lag. Workaround: use content hashes. No upstream fix in the issue.  
Source: <https://github.com/ninja-build/ninja/issues/1740>

**Content-hash invalidation (Bazel, Webpack)**  
Bazel hashes every artifact with SHA-256 and stores it under a path derived from that hash; staleness is detected by recomputing the input digest and comparing it to the Action Cache entry. This is immune to clock skew and mtime non-monotonicity. Cost: requires reading file content, not just metadata.  
Webpack's persistent cache uses a hybrid: compare mtime first; if mtime differs, compare content hash. For CI (fresh clone → timestamps always differ), it falls back to content hash only. The Webpack docs name "Timestamp + Contenthash" as the right strategy for build dependencies where unnecessary invalidation is expensive.  
Sources: <https://blogsystem5.substack.com/p/bazel-remote-caching>, <https://github.com/webpack/changelog-v5/blob/master/guides/persistent-caching.md>

**Deterministic (byte-identical) output**  
The PRD requires identical inputs to produce a byte-identical Grounding Pack. This is achievable but requires explicit discipline: no embedded timestamps in the output, stable key ordering in JSON.stringify output (Node's V8 preserves insertion order for string keys — fine as long as object construction order is deterministic), and no UUID minting inside the regenerator (UUIDs are pooled, not generated inline). Build tools achieve this with hermetic sandboxes; without a sandbox, hidden dependencies (e.g. reading a file whose mtime is part of the output) break determinism silently.  
Source: <https://blogsystem5.substack.com/p/bazel-remote-caching> (on Bazel's hermetic action model)

---

### 2. PostToolUse / event-driven regeneration hooks

**Re-entrancy — the 25-run loop bug**  
A published incident: a PostToolUse hook spawned an agent unconditionally. The spawned agent called Bash; that fired PostToolUse again; another agent spawned; 25 iterations ran before the author noticed. Root cause: PostToolUse fires on *every* tool use the agent makes, including tools invoked by hooks. The hook had no guard checking whether it was already inside a triggered run.  
Fix pattern: check an in-flight state before spawning — e.g., whether the target output file already exists and is newer than the source, or whether a session/run ID is already set in the environment.  
Source: <https://dev.to/ji_ai/writing-a-claude-code-book-with-claude-code-when-posttooluse-hooks-loop-25-times-4h46>

**Claude Code hook execution model (synchronous by default)**  
By default, PostToolUse hooks block the agentic loop until they complete. An `async: true` flag makes them non-blocking. If a PostToolUse hook writes files, those writes emit `FileChanged` events; `FileChanged` hooks always run asynchronously and cannot block or deny. The hook platform does *not* deduplicate PostToolUse events for the same file — a regeneration hook that writes the pack will not retrigger itself *unless* the regenerator itself subsequently calls a Write/Edit tool (which it would not, because the pack is written by the hook, not by Claude). The safe pattern: the hook writes the pack via a shell command that does not itself use Claude's tool layer; no feedback loop exists.  
Source: <https://code.claude.com/docs/en/hooks>

**Fail-open vs. fail-closed for an accelerator cache**  
The PRD's ADR-0006 position (hooks fail safe to disabled) aligns with the dominant pattern in build systems: a missing or broken cache causes a full rebuild, not a build failure. The only systems that fail-closed on cache are those where the cache is also the source of truth (wrong for an accelerator). The hooks.config.json feature-flag default of `false` for the new staleness hook is the correct fail-open posture.  
Source: <https://code.claude.com/docs/en/hooks> (hook error handling section)

---

### 3. Background-agent / speculative-draft handoff

**Atomic write — write-temp-then-rename**  
On Linux/macOS, `rename()` is atomic at the filesystem level: readers see either the old file or the new file, never a partial write. However, rename atomicity does not guarantee *durability* across a crash: the kernel may have not yet flushed the directory entry to disk. The full durable-write recipe is: write to temp → `fsync(temp_fd)` → `rename(temp, target)` → `fsync(dir_fd)`. Without the directory fsync, a power loss after rename but before flush leaves the old file on disk after reboot. For an accelerator cache (gitignored, regenerable), durability across crashes is not critical — but the atomic rename is still worth doing to prevent a reader seeing a half-written pack.  
Sources: <https://github.com/npm/write-file-atomic/issues/64>, <https://0xkiire.com/crash-consistency-fsync-rename/>

**Detecting an abandoned or incomplete draft**  
The background drafter writes a speculative PRD-draft Runtime Record. If the drafter is killed mid-write (agent timeout, user interruption), the draft file may be half-written or missing. Two patterns from the research:

- **Sentinel-file age threshold**: the `node-proper-lockfile` ecosystem uses mtime on a separate lock file, updated on a heartbeat interval; a lock is stale when `now - lock_mtime > stale_threshold`. Applied here: a `.draft-in-progress` sentinel with a heartbeat mtime update lets the foreground consumer detect an abandoned drafting run. Cost: the drafter must update the sentinel periodically.  
Source: <https://github.com/moxystudio/node-proper-lockfile>

- **Atomic rename on completion**: the drafter writes to a temp file and renames to the final draft name only on clean completion. A reader that finds no draft file knows either drafting has not yet started or the drafter did not finish cleanly — both map to the same fallback: author from scratch. This is simpler than a sentinel and sufficient for a best-effort accelerator.  
Source: <https://python-atomicwrites.readthedocs.io/> (canonical treatment of the pattern in Python, directly applicable to Node.js)

**Background-to-foreground handoff — artifact-based coordination**  
The research on agentic handoff patterns converges on a single recommendation: use durable artifacts (files, branches, PRs) rather than in-memory or conversation-level state as handoff points. The draft file *is* the artifact; the PRD skill consuming it is the foreground consumer. The failure mode the research names: context loss between agents when "critical information disappears during handoffs due to context limits or misaligned prompts." The PRD's verify-and-land contract (regenerate decision-bearing fields at hand-back) directly addresses this — the draft's decision fields are not trusted wholesale.  
Source: <https://agentic-patterns.com/patterns/seamless-background-to-foreground-handoff/>

---

### 4. Append-only decision logs

**JSONL as the standard format**  
JSONL (one JSON object per newline) is the accepted format for append-only logs: appending is a single `write()` call with no need to parse or rewrite the file. Readers process line-by-line, so partial reads are naturally bounded to the lines received.  
Sources: <https://jsonparser.com/ndjson-guide>, <https://scrapfly.io/blog/posts/jsonl-vs-json>

**Torn write / partial-line recovery**  
If the writer is killed mid-line, the final line is a partial JSON object that will fail `JSON.parse()`. The consensus recovery pattern: wrap each line parse in try/catch; skip (or log) the bad line; continue with prior lines. The last partial line is the only data at risk — all prior appended records are intact. This means the decisions log never needs a write-ahead log or two-phase commit; worst case the last decision is dropped and must be re-stated.  
Source: <https://jsonparser.com/ndjson-guide> ("partial writes are normal; if a process gets killed mid-stream, the last partial line is the only bad record")

---

## Gotchas

**G1 — Staleness hook writes the pack, which itself fires PostToolUse → risk if the pack write goes through Claude's tool layer**  
If the staleness hook triggers a pack regeneration by emitting a `hookSpecificOutput` message that causes Claude to call `Write` on the pack file, that Write fires PostToolUse again, which re-enters the staleness hook. Guard required: the regenerator must write the pack via a shell command inside the hook process (not via Claude's Write tool), so the write is outside the PostToolUse-visible tool layer. If Claude writes the pack, add an exit-early guard checking whether the written file path is the pack itself.  
Source: <https://dev.to/ji_ai/writing-a-claude-code-book-with-claude-code-when-posttooluse-hooks-loop-25-times-4h46>

**G2 — mtime-only staleness check will false-negative on same-second writes and false-positive after a clock adjustment**  
If the staleness hook compares `source_mtime > pack_mtime` using `fs.stat().mtimeMs`, it is vulnerable to: (a) two files written within the same filesystem timestamp quantum appearing equal (1-second on FAT/NTFS, 0.01s on ext4 in practice); (b) a clock rollback making the pack appear newer than a genuinely changed source. The safe check: use `source_mtime >= pack_mtime` (greater-than-or-equal) to catch the equal-timestamp case, and add a content-hash check on the CONTEXT.md + ADR index files when performance allows.  
Source: <https://apenwarr.ca/log/20181113>

**G3 — The pack's "byte-identical for identical inputs" invariant breaks if JSON.stringify key order is non-deterministic**  
Node's V8 serializes string keys in insertion order, which is deterministic only if the object is built the same way every call. If any part of the regenerator builds an object by iterating over `fs.readdirSync()` (which does not guarantee order) or over `Object.entries()` on a hash, the serialized JSON will differ across runs even on identical inputs. Fix: sort all keys before serializing.  
Source: <https://apenwarr.ca/log/20181113> (Bazel's hermetic action model cited by contrast — the same discipline applies)

**G4 — Atomic rename without fsync(dir) is not crash-durable; safe for accelerator but matters on macOS APFS**  
On macOS (APFS), the kernel flushes metadata aggressively, so the practical risk of a missing directory fsync is low. But on Linux ext4 without `data=journal`, a crash between rename and directory flush leaves the old pack on disk. For a gitignored Runtime Record that is always regenerable, this is acceptable — but the reader must not assume the pack is valid after a crash-recovery without re-running the regenerator. The staleness hook's "is pack present and fresh?" check handles this.  
Source: <https://github.com/npm/write-file-atomic/issues/64>

**G5 — A background drafter killed mid-write leaves a half-written draft; the foreground PRD skill must not read it**  
Without the write-temp-rename pattern, the draft file exists but is incomplete JSON. `JSON.parse()` on it throws; if the skill catches the exception and falls back to from-scratch authoring, this is fine — but only if the catch is explicit. The acceptance check: the skill must treat a `SyntaxError` from parsing the draft as equivalent to a missing draft, never as a hard error.  
Source: <https://python-atomicwrites.readthedocs.io/>

**G6 — The decisions log's last line may be a partial record after a drafter crash; reader must skip it**  
The append-only JSONL decisions log is safe to all prior entries after a torn write. But a reader that does `JSON.parse(fs.readFileSync(...))` on the whole file (treating it as a JSON array) will throw on the partial last line. Reader must split by newline and parse line-by-line, skipping lines that fail parse. This is a one-line difference in implementation with a large failure-mode difference.  
Source: <https://jsonparser.com/ndjson-guide>

---

## Nothing Found

- **Debounce patterns for PostToolUse hooks specifically**: no sourced prior art on rate-limiting a regeneration hook that fires too frequently (e.g. on every keystroke during a grill). The Claude Code docs do not mention debouncing; the hook `async: true` flag avoids blocking but does not coalesce rapid firings. This gap is an open implementation decision.

- **Checkpoint-respawning background agent patterns**: no sourced implementations of the specific "re-spawn agent at grill checkpoints, each run reads the current decisions log" pattern. The agentic handoff literature covers one-shot handoffs and continuous streaming but not this checkpoint-respawn loop. Implementation will need to define how "checkpoint" is detected and how stale in-flight drafters are recognized and discarded.
