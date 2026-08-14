# Agent Session History — Design

Date: 2026-08-14 · Status: decided, pending user approval
Target host: **Electron only**. Nothing here ships on Tauri.
Source context: [electron migration design](2026-08-11-electron-migration-design.md)
`decided` · usage ingest layer: [`electron/usage/`](../../electron/usage/model.ts)
`current` (read-only dependency).

## Goal

A browsable history of past agent CLI sessions — who ran, where, when, about
what — with one primary action: **resume** a session in a new tab, in the right
directory, with the right command. V1 covers **Claude Code and Codex**; the
data layer is a provider interface so further agents are additive.

Filtering: **All** sessions, or **by project**, where a project is the
session's **CWD as recorded in its own transcript** — never inferred from
Deck's workspace list, never decoded from Claude's lossy directory encoding.

**Non-goals for this document:** a transcript viewer (read-only replay of a
session's content); providers for OpenCode, Gemini CLI, or Antigravity; a
persistent on-disk index; mapping worktree CWDs back to their primary
workspace; a keyboard shortcut for the screen (icon-only in v1); any Tauri
implementation. Each is a plausible next step and none is in v1.

## 1. Data layer — `electron/sessions/`

A new main-process module. It **imports path constants from
[`electron/usage/model.ts`](../../electron/usage/model.ts) read-only and
changes nothing under `electron/usage/`** — that module is locked by the
Rust golden-fixture parity test and this feature must not disturb it.

### 1.1 Provider interface

Each agent is one provider file implementing:

```ts
interface SessionProvider {
  readonly agentId: string; // catalog id: "claude" | "codex"
  listCandidates(): SessionCandidate[]; // stat-level: path, mtime, size
  enrich(candidate): SessionMeta | null; // bounded head read; null = not a listable session
  resumeCommand(meta): string; // verbatim command line for the pane
}
```

`SessionMeta`: `{ agent, sessionId, cwd, lastActivityMs, title, sourcePath }`.
`lastActivityMs` is file mtime. `title` is the first user-authored text found
in the head window, trimmed for display; falls back to the session id.

### 1.2 Claude provider

- Scans `~/.claude/projects/*/*.jsonl` (constants `CLAUDE_DIR`,
  `CLAUDE_PROJECTS_DIR`, `TRANSCRIPT_EXTENSION`).
- **CWD comes from the `cwd` field on transcript lines**, found inside the
  head window. The project directory name encodes the CWD with `/` and `.`
  both mapped to `-`; that is lossy and is never decoded.
- Subagent transcripts (`CLAUDE_SUBAGENTS_DIR`) are excluded — they are not
  top-level resumable sessions.
- Session id: the `sessionId` field on transcript lines (also the filename).
- Resume command: `claude --resume <sessionId>` (flag verified against the
  installed CLI, 2026-08-14). Resume finds the session because the pane is
  spawned with the session's own CWD (§4).

### 1.3 Codex provider

- Scans `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (constants
  `CODEX_DIR`, `CODEX_SESSIONS_DIR`, `CODEX_ROLLOUT_PREFIX`, walk depth
  bounded by `MAX_WALK_DEPTH`).
- The first line is `session_meta`; `payload.id` is the session id,
  `payload.cwd` the project.
- **Interactive sessions only:** a `session_meta` whose `source` marks a
  non-interactive run (e.g. `"exec"`, SDK originators) is skipped. This
  surface exists to resume work; SDK/exec rollouts are noise here and this
  machine has many of them.
- `~/.codex/archived_sessions/` is **excluded** in v1: archived means the
  user put it away.
- Title: first `user_message` event text in the head window.
- Resume command: `codex resume <sessionId>` (subcommand verified against the
  installed CLI, 2026-08-14; an explicit UUID bypasses the picker's cwd
  filtering).

### 1.4 Scan shape: stat first, heads lazy

1. `listCandidates()` stats every transcript file — cheap, thousands per
   second.
2. Candidates sort by mtime descending; only the **newest 500 per agent**
   are enriched with a bounded head read (`IDENTITY_HEAD_BYTES`, 64 KiB —
   the same cap the usage layer uses so a pasted blob on line one cannot
   trigger an unbounded read).
3. Enrichment results are cached in memory keyed by
   `path + mtime + size`; re-opening the screen re-stats and re-reads only
   changed files.
4. The 500-per-agent cap is surfaced, not silent: when candidates exceed it
   the UI shows "showing latest 500" (§3.2).

**Privacy:** titles and CWDs live in RAM only. Nothing from a transcript is
persisted to disk — consistent with the usage module's contract that the
cache never stores conversation bytes. A persistent index is out of scope
until this design is _measured_ slow.

A file that fails to parse, names no session, or names no CWD enriches to
`null` and is dropped from the list — never a crash, never a partial row.

## 2. IPC and the renderer facade

- New channel **`sessions:list`** in
  [`electron/ipc/channels.ts`](../../electron/ipc/channels.ts) `current`,
  exposed through the preload. Arguments are **flat keys** per R6
  (`{ limit }`, default 500 per agent); the response carries the enriched
  entries plus per-agent candidate totals so the UI can render the cap
  label. New entries land in
  [`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts)
  `current`.
- Renderer facade **`src/host/sessions-host.ts`**, following the existing
  host-facade pattern. On a host without the channel (Tauri, browser
  `npm run dev`) it reports `unsupported`; the toolbar icon and Open board
  section then render nothing. Fail-soft, no throw.
- Renderer state: `src/sessions/sessions-client.ts` + `sessions-store.ts`,
  mirroring the `src/usage/` split. The store owns: entries, per-agent
  totals, the agent filter, the project filter, and loading/error state.
  Both surfaces (§3) consume this one store.

## 3. Surfaces

UI strings are English (R1); chrome styling follows numbered DL rules and
implementation must pass the screenshot / frontend-design-bar gate — build
output alone does not close this feature.

### 3.1 Full-window screen — `src/ui/sessions/`

Follows the `UsageScreen` pattern
([`usage-screen.tsx`](../../src/ui/usage/usage-screen.tsx) `current`):
full-window, Esc closes, **mutually exclusive** with Settings and Usage
(opening any of the three closes the other two). Opened by a **new toolbar
icon** (history glyph). **No keyboard shortcut in v1** — a shortcut touches
the verified 42-entry commands table in `tab-manager.ts` and is deferred
until asked for.

### 3.2 List, filters, states

- Row: agent badge · title · abbreviated project path · relative time.
  Sorted by `lastActivityMs` descending. Row click = resume (§4).
- Filters: agent (All / Claude Code / Codex) and project — a dropdown of
  the distinct CWDs present in the enriched set, plus All. Filters compose.
- Cap label: when an agent's candidates exceed the enrichment cap, the
  screen says "showing latest 500" for that agent.
- Empty state: short copy explaining nothing was found and where Deck
  looked. Unsupported host: the icon is hidden, so the screen is
  unreachable there by construction.
- A session whose CWD no longer exists on disk renders with a warning mark
  and resume disabled (§4).

### 3.3 Open board — "Recent sessions"

The Open board home ([`open-board-home.tsx`](../../src/open-board/open-board-home.tsx)
`current`) gains a small "Recent sessions" block for the **selected
workspace**: the newest five sessions whose CWD equals or is inside the
workspace path, each row resumable in place.

**Named v1 limitation:** sessions run inside a git worktree that lives
outside the workspace path do not prefix-match and will not appear under
that workspace. They remain reachable on the full screen. Worktree mapping
(Deck already has `electron/worktrees.ts`) is future work, not v1.

## 4. Resume

Clicking a session materializes **one new single-pane tab in the current
window**:

- CWD = the session's recorded CWD.
- The pane arms the provider's verbatim resume command
  (`claude --resume <id>` / `codex resume <id>`), typed by the existing
  launcher once the shell is ready.
- Mechanism: `MaterializeIntent` gains an optional **`command`** field — a
  verbatim command line that, when present, is armed instead of resolving
  `intent.agent` through the catalog. The launcher already takes a plain
  string, so nothing below the intent changes.
- **Fork notice:** this touches tab materialization, a listed fork in
  [`AGENTS.md`](../../AGENTS.md). The brainstorm behind this spec is the
  ask; on landing, the fork queue gets its one-line record.

Failure handling:

- **Dead CWD:** checked before spawn; the row shows the problem and resume
  is disabled. Deck must not inherit the existing silent
  dead-CWD-lands-in-`$HOME` spawn behavior for this path — resuming a
  session in the wrong directory is worse than not resuming it.
- **Missing binary:** same fail-soft behavior as the current agent launch
  flow — the tab opens as a shell and the typed command fails visibly in
  the pane. No new error machinery.

## 5. Testing and verification

- **Providers:** unit tests with synthetic JSONL fixtures per agent —
  session id + CWD extraction, subagent exclusion (Claude), non-interactive
  and archived exclusion (Codex), title fallback, oversized first line
  bounded by the head cap, unparseable file → `null`.
- **Scan:** stat-first ordering, cap at 500 per agent, mtime-keyed cache
  hit/miss.
- **IPC:** `sessions:list` added to the live contract test with flat keys.
- **Store/UI:** filter composition, cap label, empty and unsupported
  states, dead-CWD disabled row — following the existing usage-store and
  usage-screen test patterns.
- **Gates:** `npm test && npm run build && npm run generate:menu:check`
  plus `npm run electron:build` (changes under `electron/`). Rendered UI
  requires screenshot approval; automated checks do not establish visual
  correctness.

## 6. Decisions fixed by this spec

| Decision                                    | Choice                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Primary action                              | Resume in a new tab (not view-only)              |
| V1 agents                                   | Claude Code + Codex, provider interface for more |
| Project identity                            | Session CWD from transcript content              |
| Placement                                   | Full screen (toolbar icon) + Open board block    |
| Codex non-interactive (`exec`/SDK) sessions | Excluded                                         |
| Codex `archived_sessions/`                  | Excluded                                         |
| Claude subagent transcripts                 | Excluded                                         |
| Enrichment cap                              | Newest 500 per agent, labeled in UI              |
| Persistence                                 | In-memory only; no disk cache                    |
| Keyboard shortcut                           | None in v1                                       |
| Host                                        | Electron only; Tauri/browser fail soft to hidden |
