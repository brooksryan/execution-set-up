# Prior Art — Shared Coordination / Team Server
**Synthetic PRD id:** shared-coordination  
**Researched:** 2026-06-15  
**Problem:** `to-execution` `.excn/` artifacts (backlog.json monolith, sequential IDs, sprint arrays) produce git merge conflicts when multiple agent sessions or teammates author concurrently.

---

## Existing Approaches

### A. Conflict-Free File Layout Without a Server

#### A1. One-directory-per-issue / one-file-per-record
Every tool that solved the monolithic-file conflict problem landed on the same structural answer: give each record its own directory or file so unrelated edits never touch the same inode.

- **FIT (Filesystem Issue Tracker)** stores each issue as a named subdirectory under `fit/`, with metadata split further into individual tag files (`tag_status_open`, `tag_priority_2`). Because two teammates editing different attributes of different issues change different files, git's 3-way merge produces no conflicts. Numeric IDs are stored as a tag file (`tag_id_1001`) separate from the directory name, so renumbering is a file rename, not a structural move. Source: [FIT Filesystem_Issues.md](https://github.com/grantbow/fit/blob/v0.7.0/docs/Filesystem_Issues.md)
- **git-issue** (dspinellis) uses `issues/xx/xxxxxxx.../` subdirectories where the path is derived from the SHA of the commit that opened the issue, making the ID globally unique without coordination. Each issue component (description, tags, assignees, comments) is a separate file. Source: [github.com/dspinellis/git-issue](https://github.com/dspinellis/git-issue)
- **git-issues (2026 HN Show HN)** stores each issue as a YAML-frontmatter Markdown file in `.issues/`. Designed with an explicit human workflow (list/show/board) and an agent workflow (next → claim → done), with auto-generated `.agent.md` context for Claude Code. No server, single Go binary. Source: [HN Show HN: Git-issues](https://news.ycombinator.com/item?id=47973644)
- **Sophia Bits sentinel pattern**: For JSON files that cannot be restructured, adding a sentinel object key at the bottom of the file (`"ADD_ABOVE_HERE_TO_AVOID_MERGE_CONFLICTS": ""`) makes the final line constant so concurrent appends never conflict on the closing bracket. Low-tech and zero-dependency. Source: [sophiabits.com/blog/avoid-json-file-merge-conflicts](https://sophiabits.com/blog/avoid-json-file-merge-conflicts)

**Gotcha:** Bugs Everywhere also uses one-file-per-issue but stores issues in the working tree (not in a git ref namespace), which means `git merge` must process them as regular files. If two branches both rename an issue directory, git can still conflict. The Matej Cepl survey concluded "issues naturally branch and merge along with the rest of your versioned files" when the layout is per-file, but this breaks down on renames and deletes. Source: [Current State of Distributed Issue Tracking](https://matej.ceplovi.cz/blog/current-state-of-the-distributed-issue-tracking.html)

#### A2. Collision-resistant IDs replacing sequential counters

Sequential counters require coordination to allocate. All collision-resistant ID schemes solve this by making the ID globally unique without a lock.

- **ULID** — 48-bit millisecond timestamp + 80-bit randomness, Crockford base32 encoded, 26 chars, lexicographically sortable. Reduces collision risk 98.42% vs UUIDv7 at high generation rates. Not yet an IETF standard; systems expecting UUID format reject it without a shim. Source: [ResearchGate: Comparative Analysis UUIDv4, UUIDv7, ULID](https://www.researchgate.net/publication/395418057_A_Comparative_Analysis_of_Identifier_Schemes_UUIDv4_UUIDv7_and_ULID_for_Distributed_Systems) / [Honeybadger ULID deep-dive](https://www.honeybadger.io/blog/uuids-and-ulids/)
- **UUIDv7** — IETF RFC 9562 (2024), millisecond timestamp + 74 bits random. Standardized, native language support growing. Sort order correct in string form, but byte-order can vary by database driver. Source: [arxiv.org/abs/2509.08969](https://arxiv.org/abs/2509.08969)
- **KSUID** — 32-bit second-level timestamp + 128 bits random, 160-bit total, 27-char base62 string. Largest entropy of the group. Second-level granularity (not millisecond) means two IDs minted in the same second are unordered relative to each other. Source: [GUIDsGenerator comparison](https://www.guidsgenerator.com/wiki/uuid-vs-others)
- **SHA-based content-addressed IDs** — git-issue uses the SHA of the opening commit as the issue ID, requiring zero coordination (the commit is already unique). Human-readable prefix (first 7 chars) works in practice. Requires git as the generation mechanism. Source: [github.com/dspinellis/git-issue](https://github.com/dspinellis/git-issue)

**Gotcha (time leakage):** All timestamp-prefix schemes (ULID, UUIDv7, KSUID) reveal approximate creation time. For a git-tracked work tracker this is benign, but worth knowing. Source: [GUIDsGenerator comparison](https://www.guidsgenerator.com/wiki/uuid-vs-others)

#### A3. Git-native ref-namespace storage (git-bug model)

git-bug stores each issue as a set of git objects under `refs/bugs/<hash>`, not as working-tree files. IDs are content-addressed SHA hashes of the first operation. **Lamport timestamps** embedded in each operation allow activity to be recorded and replayed without ever encountering a merge conflict — operations are a CRDT-like log that merges by causal ordering, not by line diffing. Sync is `git push`/`git pull` against any remote. Source: [git-bug GitHub](https://github.com/git-bug/git-bug) / [HN git-bug 2025](https://news.ycombinator.com/item?id=43971620)

**Gotcha:** Working-tree files are untouched, so git-bug issues are invisible to normal `git log`, `git diff`, and PR review workflows. For `to-execution` where PRD/issue reviewability in PRs is a stated goal (ADR-0005), this is a disqualifying constraint unless bridged with an export step.

#### A4. CRDTs (Automerge / Yjs) persisted to git

Automerge represents a JSON document as a CRDT: concurrent edits are merged deterministically without conflict. Automerge 2.0 (2022) added an efficient binary format with 30% overhead vs plain text and full change history. Hypermerge combined Automerge with a distributed append-only log (hypercore) for serverless sync. Source: [Automerge 2.0 blog](https://automerge.org/blog/automerge-2/) / [crdt.tech implementations](https://crdt.tech/implementations)

**Gotcha — no git integration out of the box:** Automerge deliberately does not prescribe storage or network. Persisting an Automerge binary blob to a git file means git stores the blob as an opaque binary — human-readable diffs vanish. A custom merge driver can invoke Automerge's merge logic, but this requires every contributor's machine to have the driver installed via `.gitconfig` and `.gitattributes`. Source: [Automerge 2.0 blog](https://automerge.org/blog/automerge-2/)

**Gotcha — last-write-wins semantics:** Automerge's conflict resolution is "last writer wins" for scalar values, which can silently lose data in concurrent sprint-status updates. Source: [stack.convex.dev/automerge-and-convex](https://stack.convex.dev/automerge-and-convex)

---

### B. Lightest-Weight Shared Coordination Servers

#### B1. SQLite + Litestream (single-node, async replication)

Litestream streams SQLite WAL changes to object storage (S3, GCS, R2) continuously. A single-node coordination server (e.g., a tiny HTTP service with one `/next-id` endpoint) backed by SQLite costs $0.03/month for the storage replication layer, plus whatever compute hosts the HTTP process. No clustering needed — one writer, one replica stream. Source: [Medium: Litestream eliminated my database server for $0.03/month](https://www.saashub.com/alternatives/post-dev-2021-05-27-how-litestream-eliminated-my-database-server-for-0-03-month-208471) / [litestream.io/alternatives](https://litestream.io/alternatives/)

**Gotcha:** Litestream is backup/recovery, not real-time replication — it does not provide a read replica for load distribution. If the one node dies, reads fail until restore. Acceptable for an optional coordination sidecar but not for any path that must be always-on.

#### B2. Turso / libSQL embedded replicas

Turso is a hosted libSQL (SQLite fork) with embedded replicas: a local SQLite file syncs from the primary, reads are instant (no network), writes round-trip to the primary. Free tier: 5GB, 100 databases, 500M row reads/month (as of March 2025). The `next-id` query is a single `INSERT RETURNING id` which the primary serializes. Source: [Turso blog: Developer Plan](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan)

**Gotcha:** Embedded replicas require a network call for every write. If the primary is unreachable (offline dev, CI without credentials), writes fail. Any `to-execution` CLI use must degrade gracefully without the Turso credential.

#### B3. PocketBase (single Go binary, SQLite-backed)

A single Go binary with SQLite, auth, file storage, and a real-time API. Zero Docker, zero config files. Self-host on any VPS for fixed cost; the binary is copyable. For a coordination sidecar, the operational surface is: download binary, run, point CLI at it. Source: [leanware.co/insights/supabase-vs-pocketbase](https://leanware.co/insights/supabase-vs-pocketbase) / [uibakery.io/blog/supabase-alternatives](https://uibakery.io/blog/supabase-alternatives)

**Gotcha:** PocketBase runs on a single SQLite writer — no built-in HA. For a dev-team coordination server (not production traffic) this is fine, but it is a standing server someone must operate.

#### B4. Redis INCR as atomic ID counter

`INCR exec_id_counter` is a single-command atomic operation on a single Redis primary, guaranteed sequential, no locking needed. Redis is available as a free managed tier on Railway, Upstash (serverless, per-command pricing, ~$0 for low volume), or fly.io. Source: [oneuptime.com: Redis Unique ID Generator](https://oneuptime.com/blog/post/2026-03-31-redis-unique-id-generator/view) / [edgeindata.com: Redis Atomic Increments](https://edgeindata.com/architecture-redis/power-one-mastering-redis-atomic-increments-high-concurrency-apps)

**Gotcha:** Redis is ID-only — it does not serialize the write of the JSON record itself. Two agents could both call `INCR` (getting sequential IDs) and then both try to commit to `backlog.json` simultaneously, producing the same line-level conflict. The ID problem is solved; the monolithic-file problem is not. Redis only removes the ID-collision half of the problem.

#### B5. GitHub Issues API as the canonical record store

Use the real GitHub Issues API: create issue → GitHub assigns the number atomically, stores the record, handles concurrency. A thin sync script exports GitHub Issues to `.excn/issues/` as JSON files for offline reading and PR review. Source: [GitHub: Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) / [bors-ng merge bot](https://github.com/bors-ng/bors-ng)

**Gotcha:** GitHub Issues are not schema-validated against `issue.schema.json`. Keeping the JSON files as the canonical record (per ADR-0005 intent) while GitHub is the write path requires a two-way sync contract that is error-prone to maintain.

---

### C. Hybrid / Git-Native Coordination

#### C1. Custom git merge driver for JSON arrays

`.gitattributes` can route `*.json` through a custom merge driver. `git-json-merge` performs a 3-way merge on JSON structure rather than text lines, resolving non-conflicting array appends automatically. Setup: register driver in `~/.gitconfig`, add `*.json merge=json-merge` to `.gitattributes`. Source: [github.com/jonatanpedersen/git-json-merge](https://github.com/jonatanpedersen/git-json-merge) / [gregmicek.com: Custom Git Merge Driver](https://www.gregmicek.com/software-coding/2020/01/13/how-to-write-a-custom-git-merge-driver/)

**Gotcha:** `.gitattributes` is in the repo (good — it stamps with `to-execution`), but each contributor's machine must have the external merge driver binary installed. A fresh clone without the driver binary installed falls back to git's default text merge — no error, just silent regression. This is fragile for a distributed CLI tool.

#### C2. GitHub Action as the serializing write agent

A GitHub Action with `concurrency: group: backlog-write, cancel-in-progress: false` serializes all writes to `backlog.json` through a single queue. Agents open PRs with their proposed additions; the action merges them one at a time, assigning IDs atomically in CI. `github-action-locks` achieves the same via DynamoDB conditional writes for cross-workflow locking. Source: [github-action-locks](https://github.com/abatilo/github-action-locks) / [oneuptime.com: GitHub Actions concurrency](https://oneuptime.com/blog/post/2026-01-25-github-actions-concurrency-control/view)

**Gotcha:** Adds a mandatory PR-per-issue overhead. Offline / local-first authoring still produces unresolved state until a PR is merged. Works well for human workflows; agent sessions that author many issues in a sprint will produce many PRs.

#### C3. Jujutsu-style content-addressed operation log

Jujutsu records each operation as a content-addressed object (no lock files), with concurrent operation heads reconciled by 3-way merging the "view" objects. Conflicted states are recorded rather than blocking the operation, then resolved lazily. The key insight for `to-execution`: storing operations as a DAG rather than a mutable array means concurrent appends never fight over the same file location. Source: [jj-vcs.dev concurrency docs](https://docs.jj-vcs.dev/latest/technical/concurrency/)

**Gotcha:** Jujutsu is a VCS replacement, not a library. Adopting its model means reimplementing the operation-log pattern in the `to-execution` CLI — a significant build, not an off-the-shelf integration.

#### C4. Dolt (SQL with git-style branching)

Dolt is a MySQL-compatible SQL database with full git semantics: branch, merge, diff, rebase on relational data. Merge conflicts are detected at the cell level (same row+column edited on two branches) rather than the file level. Free self-host (Go binary). Source: [dolthub.com/blog](https://www.dolthub.com/blog/2024-09-05-rebase-conflict-resolution/) / [github.com/dolthub/dolt](https://github.com/dolthub/dolt)

**Gotcha:** Dolt requires replacing SQLite/JSON files with a running Dolt server. The `.excn/` file artifacts that make work visible in PRs (ADR-0005) would no longer exist as git-tracked files — they become rows in a database. Incompatible with the version-controlled-work-tracking constraint unless Dolt's export is used.

---

### D. Real-World Precedents (Small Teams, Shared Trackers, No Heavy Infra)

- **git-bug** (2018–present): The longest-lived git-native distributed tracker. Stores issues in `refs/bugs/` using Lamport timestamps and content-addressed IDs. Has bridges to GitHub Issues and Jira for teams that need both. >4K GitHub stars. Source: [HN Show HN: git-bug 2018](https://news.ycombinator.com/item?id=17782121) / [git-bug 2025 HN thread](https://news.ycombinator.com/item?id=43971620)
- **git-issues (2026, Show HN)**: Explicitly targets the agent workflow (`next → claim → done`) with auto-generated Claude Code context, showing this problem space is being addressed in real tools. Source: [HN Show HN: Git-issues](https://news.ycombinator.com/item?id=47973644)
- **Convex + Automerge (local-first pattern)**: Convex acts as the sync engine; clients hold Automerge documents locally and submit diffs; Convex broadcasts to other clients. Used by small teams for collaborative document apps. Source: [stack.convex.dev/automerge-and-convex](https://stack.convex.dev/automerge-and-convex)
- **Debbugs**: Debian's email-driven tracker; each bug is a thread, IDs allocated by a central mail server. Canonical precedent for "ID allocation as the only coordination needed." Source: [Wikipedia: Debbugs](https://en.wikipedia.org/wiki/Debbugs)

---

## Gotchas Summary

| Approach | Top Gotcha | Source |
|---|---|---|
| One-file-per-record | Directory renames/deletes still conflict; works only for create/update | [Matej Cepl survey](https://matej.ceplovi.cz/blog/current-state-of-the-distributed-issue-tracking.html) |
| ULID/KSUID | Non-standard format; rejected by systems expecting UUID without a shim | [arxiv.org/abs/2509.08969](https://arxiv.org/abs/2509.08969) |
| git-bug refs/ model | Issues invisible in working tree / PR diffs | [HN thread 2025](https://news.ycombinator.com/item?id=43971620) |
| Automerge binary in git | Opaque binary blob; human-readable diffs lost | [Automerge 2.0 blog](https://automerge.org/blog/automerge-2/) |
| Custom git merge driver | Requires driver binary on every machine; silent regression if missing | [gregmicek.com](https://www.gregmicek.com/software-coding/2020/01/13/how-to-write-a-custom-git-merge-driver/) |
| Redis INCR | Solves ID collision only; monolithic file conflict remains | [oneuptime.com](https://oneuptime.com/blog/post/2026-03-31-redis-unique-id-generator/view) |
| Turso embedded replicas | Writes fail offline; CLI must degrade gracefully | [Turso blog](https://turso.tech/blog/turso-cloud-debuts-the-new-developer-plan) |
| GitHub Action serializer | PR-per-issue overhead; offline authoring is unresolved until CI runs | [github-action-locks](https://github.com/abatilo/github-action-locks) |
| Dolt | Replaces file artifacts with DB rows; breaks ADR-0005 PR visibility | [dolthub.com](https://www.dolthub.com/blog/2024-09-05-rebase-conflict-resolution/) |
| Convex + Automerge | Last-write-wins silently loses scalar values; cross-document consistency absent | [stack.convex.dev](https://stack.convex.dev/automerge-and-convex) |

---

## Nothing Found

- No sourced prior art found for a CLI-distributed npm tool that stamps a coordination server config alongside a file-based tracker and degrades gracefully without it.
- No sourced precedent for agent teams (as distinct from human teams) sharing a git-committed JSON work tracker at scale — git-issues (2026) is the closest, and it avoids the server entirely via one-file-per-issue.
- Searches for "GitHub Action as atomic ID mint for backlog JSON" returned no direct implementation examples — only the general concurrency-group pattern.

---

## Synthesis Note (descriptive, not prescriptive)

The literature clusters around two viable no-server paths: **(1) one-file-per-record with content-addressed or random IDs** (git-issue, FIT, git-issues 2026 — all landed here independently) and **(2) git-ref-namespace storage with Lamport timestamps** (git-bug). Path 1 keeps working-tree files and PR visibility intact (compatible with ADR-0005). Path 2 loses PR visibility. For the lightest-weight server path, a single HTTP process over SQLite (Litestream backup, PocketBase binary, or the existing ADR-0007 viewer server extended with a write endpoint) plus ULID/UUIDv7 for IDs is the operational floor multiple practitioners converged on — Redis INCR is cheaper still but solves only half the problem.
