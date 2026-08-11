# Token Usage Dashboard — Design

Date: 2026-08-10 · Status: decided, pending implementation plan
Reviewed: external Codex adversarial review 2026-08-10 (verdict on first
draft: not-sound; all 4 blockers and 8 majors accepted and folded in below).

## Goal

A usage dashboard inside Deck showing raw token counts and estimated USD cost
for the AI agent CLIs the current OS user runs, aggregated across this
machine's surviving local history. v1 covers **Claude Code and Codex** only.

Non-goals (v1): per-pane attribution (machine-wide aggregates were chosen
deliberately — they remove the pane→session mapping problem); OpenCode,
Gemini CLI and Antigravity (an adapter seam is left, not built); network
refresh of pricing; Windows verification (assumed same layout under
`%USERPROFILE%`, recorded as an assumption).

Wording discipline: the UI never says "machine-wide" or "all-time" — the data
is the current OS user's history that still exists on disk. Copy says "this
machine, this user" and "recorded history".

## Decisions and forks resolved (2026-08-10)

1. **Content**: raw token counts AND estimated USD. Dollars are estimates at
   API prices; subscription users do not pay per token, and every dollar
   figure carries an "estimated at API prices" label plus the pricing
   snapshot's date.
2. **Scope**: aggregate for the whole user, not per pane.
3. **Surface**: a dedicated full-window screen (`UsageScreen`), same shell
   pattern as `SettingsScreen`. Entry points: a `ChromeActions` icon button
   (both layouts — top tab bar and titlebar — between Prompts and Settings),
   shortcut **⌘⇧U / Ctrl+Shift+U** (verified free) with a View-menu item via
   the menu registry, and a link row in Settings › agents.
4. **Breakdown dimension**: agent × model.
5. **Architecture**: Rust scanner + one Tauri command returning raw
   aggregates; USD computed in the frontend from a pinned LiteLLM pricing
   snapshot shipped in the bundle (approved bundle-content fork). No new
   dependencies, Rust or npm.
6. **Reuse over rebuild** (W7): no drop-in library fits (ccusage needs Node
   at runtime; ccost covers only Claude and would be a new dependency). Deck
   writes its own thin scanner but inherits the community-converged rules:
   LiteLLM pricing data, ccusage's dedupe and delta semantics, and test
   fixtures modeled on their documented failure cases.
7. **DL forks (R2, approved)**: DESIGN-LANGUAGE §11 generalizes from "the
   settings shell" to full-window screens, and a new § defines the
   **read-only data table** for metric screens — non-sortable,
   non-interactive, horizontal overflow scrolls inside the table's own
   container. Without it, daily/breakdown tables have no legal widget.

## Data sources (verified on the dev machine 2026-08-10)

### Claude Code

- Files: `~/.claude/projects/<flattened-cwd>/<sessionId>.jsonl` **and**
  `~/.claude/projects/<flattened-cwd>/<sessionId>/subagents/*.jsonl`.
  Subagent transcripts are ~47% of this machine's Claude history by size;
  omitting them (the first draft's blocker B3) undercounts by almost half.
- Signal: assistant lines carry `message.usage` — `input_tokens`,
  `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`,
  and the tier split `cache_creation.ephemeral_5m_input_tokens` /
  `ephemeral_1h_input_tokens` — plus `message.model`, `timestamp`,
  `message.id`, `requestId`.
- Streaming writes several growing snapshots of the same response. Dedupe
  key is `message.id` + `requestId`; **the last entry wins**. Summing all
  entries overcounts roughly 2×; keeping the first undercounts.

### Codex

- Files: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and
  `~/.codex/archived_sessions/` (skip an archived copy when the active file
  for the same `session_meta.payload.id` exists).
- Signal: `event_msg` lines with `payload.type == "token_count"` carry
  **cumulative** `total_token_usage`: `input_tokens`,
  `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`, `total_tokens`. The active model comes from the
  most recent `turn_context` line.
- **Delta ingestion, not last-snapshot** (blocker B1): real sessions carry
  hundreds of snapshots, span multiple UTC days and switch models
  mid-session. Each `token_count` contributes
  `delta = max(0, cumulative − previous cumulative)` attributed to the
  event's timestamp and the `turn_context` model in effect. A non-advancing
  or regressing total contributes nothing (resumed/forked sessions replay
  inherited totals).
- `cached_input_tokens` is a **subset** of `input_tokens` (blocker B4);
  `total = input + output`. The stored counters keep the subset relationship
  explicit — see the schema.
- The rollout format is community-documented as experimental. The parser is
  fail-soft per line and per field; a format change degrades to skipped
  lines and a visible "n lines skipped" note, never a crash.

## Aggregate schema

Rust returns counters bucketed by **15-minute UTC bucket × agent × model**
(raw model string preserved verbatim; no canonicalization in Rust). The
frontend re-buckets into local calendar days with the JS `Date` — DST-correct
without a timezone dependency in Rust (major M2). Fifteen minutes, not an
hour, because real-world offsets include :30 and :45 (India, Nepal, Chatham);
hourly buckets would put boundary-hour usage on the wrong local day there.

Counters per bucket, kept separate because each prices differently and
merging destroys correctness (blocker B4):

| Counter           | Claude source                              | Codex source                         |
| ----------------- | ------------------------------------------ | ------------------------------------ |
| `input_uncached`  | `input_tokens`                             | `input_tokens − cached_input_tokens` |
| `cache_read`      | `cache_read_input_tokens`                  | `cached_input_tokens`                |
| `cache_create_5m` | `cache_creation.ephemeral_5m_input_tokens` | —                                    |
| `cache_create_1h` | `cache_creation.ephemeral_1h_input_tokens` | —                                    |
| `cache_write`     | —                                          | `cache_write_input_tokens`           |
| `output`          | `output_tokens`                            | `output_tokens` (includes reasoning) |

When Claude's tier split is absent, all `cache_creation_input_tokens` fall
into `cache_create_5m` (ccusage's documented fallback). The snapshot payload
also carries the scan timestamp, per-agent source status
(`ok` / `missing` / `unreadable`), and the skipped-line count.

## Incremental scan and cache

A cache file in Deck's app data dir, JSON, written atomically (temp file +
rename — the settings store already documents the truncate-write hazard this
avoids). Contents:

- `cacheVersion` — parser/schema version; a mismatch discards the cache and
  triggers a full rescan (major M1).
- Per source file: path, session identity (Claude `sessionId` / Codex
  `session_meta.payload.id`, read from the first line), `mtime`, `size`,
  committed byte offset, and the file's **contribution map**.
- Claude's contribution map is `dedupe key → {utcBucket, model, counters}`
  (blocker B2). Last-wins stays correct across offset resumes because a
  re-seen key **replaces** its previous contribution instead of adding a
  second one.
- Codex's per-file record stores the accumulated per-`{utcBucket, model}`
  delta counters **plus** the last cumulative totals seen, so delta
  ingestion resumes from the stored totals instead of re-deriving them.
- Aggregates are recomputed by merging contribution maps globally at
  snapshot time, which also collapses any cross-file duplicate keys
  (resumed/forked Claude sessions).

Scan rules (major M1):

- Offsets are committed only at a complete trailing newline; a partial last
  line is re-read next scan.
- File grew → resume from offset. File shrank or its first-line identity
  changed → rescan that file from zero. File missing → drop its
  contributions. New files → scan from zero.
- One scan at a time (single-flight); a scan whose screen closed mid-flight
  is discarded, and nothing runs while the screen is closed. The cache file
  is rewritten only when a scan actually changed contributions — an
  unchanged poll cycle does no serialization.
- Reading and parsing run on a blocking worker
  (`tauri::async_runtime::spawn_blocking`, the `info.rs` precedent), as a
  streaming line reader with a line-size cap (real Codex lines reach 16 MB;
  the cap skips-and-counts instead of buffering unbounded). This machine
  holds ~2.5 GB of transcripts — the cold scan runs behind a loading state
  and must never block the UI thread.

## Pricing (frontend)

- `src/lib/usage-pricing.ts` ships a pinned snapshot derived from LiteLLM's
  `model_prices_and_context_window.json`, filtered to Anthropic and OpenAI
  models. The snapshot is a **checked-in file** produced by a manually-run
  refresh script under `scripts/` — never fetched at build time, so a build
  can never change what ships without a code change. The snapshot records
  its retrieval date, shown in the UI.
- Rates: `input_uncached` at input price; `cache_read` at cache-read price;
  `cache_create_5m` at cache-write price; `cache_create_1h` at input × 2
  (Anthropic's published 1h-cache premium, ccusage's rule); `cache_write`
  at OpenAI's cache-write price when defined, else input price; `output` at
  output price.
- Unknown model → tokens shown, USD column "—", and the model is listed
  under its raw name. No guessing (ccusage's fallback discipline).
- Alias policy: exact model-id match only in v1; the raw string is visible
  so a missing mapping is diagnosable.

## Surface

- `UsageScreen`, full-bleed over the stage like `SettingsScreen`, rail left:
  **overview** (per-agent totals: today and recorded history), **daily**
  (last 30 local days × agent), **breakdown** (agent × model, all six
  counters + USD). Tables use the new read-only data-table DL rules.
- Overlay coordination (major M4): a `usageOpen` signal beside
  `settingsOpen`; Usage and Settings are mutually exclusive (opening one
  closes the other); the same preflight that keeps Settings from opening
  under a modal draft applies; Escape closes and focus returns to the
  terminal exactly as Settings does. The Settings › agents link row closes
  Settings and opens Usage.
- The action registry gains `toggle-usage` (tier decisions follow
  `toggle-settings` as the template); the menu registry gains the View item;
  generated menu output is never hand-edited (R3).
- Refresh: snapshot on open, then a 5 s poll while open. A failed poll keeps
  the last good data on screen with a "stale" note rather than blanking.

## Error handling and privacy

- Fail-soft per line: malformed JSON, missing fields, oversized lines →
  skip and count; the screen shows "n lines skipped" when nonzero.
- `missing` source dir → "no data yet". `unreadable` (permissions, IO
  errors) → shown as an error state, **not** conflated with "no data"
  (major M7).
- Privacy contract, stated precisely: the scanner necessarily reads file
  bytes that include conversation content, but it parses out and **stores or
  returns only** usage counters, model names, timestamps, session/message
  ids and file paths. Conversation content never leaves the parse loop,
  never enters the cache, never crosses the Tauri IPC boundary.
- The cache contains paths and message ids; it lives in Deck's own app data
  dir with default user-only permissions.

## Testing

- Rust, on fixture JSONL: Claude stream dedupe (last-wins, growing
  snapshots), subagent files included, 5m/1h cache tiers, tier-split-absent
  fallback; Codex delta ingestion across model switch and UTC-day span,
  cached-subset arithmetic, non-advancing totals; malformed and oversized
  lines; partial trailing line; offset resume; shrunken file; same-size
  replacement via identity check; deleted file reconciliation;
  cache-version migration (discard + rescan).
- TS: pricing math per counter class, unknown model, snapshot-date display,
  local-day bucketing across a DST boundary, formatting.
- Existing suites extended per template: action registry dispatch, keymap,
  menu registry check, overlay mutual-exclusion.
- UI approved by eye on screenshots before the feature is called done.
- Performance sanity: cold scan on a multi-GB corpus behind the loading
  state; poll cycle on unchanged files must do no re-reads.

## Assumptions and open items

- Windows paths assumed to mirror macOS under `%USERPROFILE%`; unverified —
  checked when a Windows session exists. The feature degrades to "no data
  yet" if the dirs are absent.
- Codex rollout format is experimental upstream; the fail-soft contract and
  the `cacheVersion`-driven full rescan are the hedges.
- Narrow-window behavior: tables scroll horizontally inside their container
  (new DL §); the shell inherits SettingsScreen's minimum-size behavior.
- The contribution map is unbounded as specified (one entry per Claude
  assistant message ever); the implementation plan must bound it. The safe
  compaction rule: for a file unchanged for N scans, drop its map and keep
  only the per-file aggregate; if a compacted file grows again, rescan it
  from zero. This preserves the subtract-on-reappear correctness of B2,
  because reappearing keys only matter in files that grow.
- OpenCode is the intended third agent (clean per-message JSON store); the
  per-agent adapter trait in `usage.rs` is the seam, nothing more is built.
