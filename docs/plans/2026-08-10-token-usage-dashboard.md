# Token Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the token usage dashboard — a full-window `UsageScreen` inside Deck showing raw token counts and estimated USD for the Claude Code and Codex CLIs this OS user has run on this machine, aggregated from surviving local transcript history.

**Source spec:** [`docs/specs/2026-08-10-token-usage-dashboard-design.md`](../specs/2026-08-10-token-usage-dashboard-design.md) `decided`. Where this plan departs from the spec, §0.3 says so explicitly and why. Spec statements found wrong against the real data are in §0.4.

**Architecture:** A new Rust module `src-tauri/src/usage/` streams the two CLIs' JSONL transcripts on a blocking worker, keeps an incremental cache in Deck's app data dir, and returns raw counters bucketed by 15-minute UTC bucket × agent × model through one Tauri command. The frontend re-buckets into local calendar days, prices the counters from a checked-in LiteLLM snapshot, and renders three read-only views inside a `SettingsScreen`-shaped shell.

**Tech Stack:** Rust (`std` only — `serde`, `serde_json`, `tauri`), Preact + `@preact/signals`, Vitest, plain CSS in `src/styles.css`. **No new dependencies, Rust or npm** (spec §5).

---

## 0.1 Global Constraints

- **AUTHORITATIVE ANCHOR TABLE — added 2026-08-10 after an independent plan review, verified against `3ef72a9` in this worktree. Where a task body cites a different line number for one of these, THIS TABLE WINS.** Sections A/B/D were authored against `69abe81`; the branch moved under them.

  | Symbol | File | Real line at `3ef72a9` |
  | ------ | ---- | ---------------------- |
  | `closeSettingsPanel` | `src/ui/app.tsx` | 133 |
  | `toggleSettingsPanel` | `src/ui/app.tsx` | 165 |
  | `requestAttentionFocus` overlays literal | `src/ui/app.tsx` | 251 |
  | `restoreFocusAfterSettings` | `src/ui/app.tsx` | ~285 |
  | `closePanel` | `src/ui/app.tsx` | 302 |
  | `toggleSettings` | `src/ui/app.tsx` | 313 |
  | `createTabManager(host, …)` deps site | `src/ui/app.tsx` | 322 |
  | `overlayCoversPane` | `src/ui/app.tsx` | 617 |
  | `<SettingsScreen …>` mount | `src/ui/app.tsx` | 779 |
  | `COMMAND_ACTIONS` | `src/terminal/tab-manager.ts` | 117 |
  | `onToggleSettings?:` on `TabManagerDeps` | `src/terminal/tab-manager.ts` | 263 |
  | `const commands = {` | `src/terminal/tab-manager.ts` | 1227 |
  | `openOverlayRanks()` | `src/terminal/tab-manager.ts` | 1337 |
  | `toggle-prompts` registry row | `src/terminal/action-registry.ts` | 372 |
  | `toggle-prompts` macOS binding | `src/terminal/action-registry.ts` | 656 |
  | `toggle-prompts` Windows binding | `src/terminal/action-registry.ts` | 798 |
  | the id census `it(...)` | `src/terminal/action-registry.test.ts` | 75 |
  | the `alwaysActions` census `it(...)` | `src/terminal/tab-manager.test.ts` | 2660 |
  | temp-dir fixture helper | `src-tauri/src/prompt_assets.rs` | 513 |

  **Do not trust any other line number in this plan without re-reading first.** Locate by symbol, not by line.

- **TWO CENSUS TESTS GO RED IN TASK D1, NOT ONE.** Both enumerate a literal `Set` and both must be widened in the same step group:
  1. `src/terminal/action-registry.test.ts:75` — the id census. It already reads **44**, not 43: the concurrent pane-detach work added `"move-pane-to-new-window"`. Retitle **44 → 45** and add `"toggle-usage"` beside `"toggle-prompts"`.
  2. `src/terminal/tab-manager.test.ts:2660` `"reads scope from ACTION_REGISTRY, not a hardcoded list"` — it pins the five ids with `scope: "always"` (`check-for-updates`, `focus-next-attention`, `open-release-notes`, `toggle-settings`, `open-tab-options`). `toggle-usage` is `scope: "always"` (§0.2.6), so this set becomes six. **Section D's Findings (e) table omits this test**, and that same section says "no test outside this table should change — stop and report it". This bullet is the amendment: expect it, widen it, do not stop.

- **All four `lucide-preact` icon names in §0.7 exist** in the installed `lucide-preact@1.30.0` — `ChartColumn`, `Gauge`, `CalendarDays`, `Table2`, each verified present in `node_modules/lucide-preact/dist/lucide-preact.d.ts`.

- **Baseline in this worktree, measured 2026-08-10 before any task ran:** `npm test` → **104 files, 1214 tests, all passing**; `cargo test --locked --no-run` → compiles clean (5 pre-existing warnings). Every "PASS (n tests)" count written inside a task was estimated by its author against a different baseline — treat those numbers as approximate and the **green/red verdict** as the real assertion.

- **R1 — English only** for every string, comment, doc and commit message in this repo. No Vietnamese.
- **No new dependencies.** Not in `src-tauri/Cargo.toml`, not in `package.json`, not as `[dev-dependencies]`. `dirs`, `walkdir`, `tempfile`, `chrono` and `memchr` appear in `src-tauri/Cargo.lock` as _transitive_ Tauri deps — they are **not importable**, and declaring one is a fork requiring user approval (`AGENTS.md`). `tokio` is declared with `features = ["time"]` only, so **`tokio::fs` does not exist**; use `std::fs` inside `spawn_blocking`.
- **R4 — do not touch the load-bearing `src-tauri` seams:** PTY, window coordinator, tab materialize, layout engine, close coordinator. This feature adds a leaf module directory and two lines in `lib.rs`; nothing else in `src-tauri/src/` changes except the generated `menu_registry.rs`. Note that other modules in that directory ARE changing concurrently (§0.5) — that is someone else's work, not yours.
- **R3 — menu code is generated.** Never hand-edit `src-tauri/src/menu_registry.rs`. Add the registry entry in `src/terminal/action-registry.ts` and run `npm run generate:menu`.
- **R2 — chrome styling follows `docs/DESIGN-LANGUAGE.md`.** Rules are numbered `DL-x.y` and cited from code comments. The two DL forks this feature needs are **already approved** (`AGENTS.md` in-flight list): §11 generalizes from "the settings shell" to full-window screens, and a **new §15 defines the read-only data table**. No other DL change is in scope.
- **C1 — immutability.** Every transform returns a new value; nothing mutates a shared object in place. This is why the Rust aggregation merges contribution maps into a fresh map rather than accumulating into the cached one.
- **C9 — no hardcoded values.** Every threshold, path fragment, cap and version is a named `const` with a comment saying why it has that value.
- **F4 / W8 — no scratch files in the repo.** Experiment output goes to the session scratchpad, never to a tracked path.
- **This repo uses `npm`, not pnpm.**
- **Verification commands** (`AGENTS.md` "Prove it with commands"; L5/W4 — no output, no "done"):
  - `npm test`
  - `npm run build` (`tsc && vite build` — this is the typecheck)
  - `npm run generate:menu:check`
  - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  - `bash ~/.claude/scripts/docs-compliance.sh` · `bash ~/.claude/scripts/docs-anchors.sh`
  - There is **no `lint` script** in this repo.
- **There is no `vitest.config.ts`, and `vite.config.ts` has no `test` key.** The default environment is `node`. **Every new DOM/component test carries `// @vitest-environment jsdom` on the FIRST line.** No globals: every test imports `{ describe, expect, it, vi }` from `"vitest"` explicitly.
- **Tests are colocated** as `<module>.test.ts` / `.test.tsx` beside the module. There is no `tests/` directory.
- **Line anchors drift.** Every `file.ts:123` in this plan was verified against working-tree HEAD `69abe81`–`3ef72a9` (the branch moved under the authors; see §0.5). Re-check with a fresh read before editing; the working tree is dirty (see §0.5).
- **Rust tests build fixtures at runtime in the OS temp dir** — there are no fixture files under `src-tauri/`, and adding `tempfile` is forbidden. Follow the documented helper at `src-tauri/src/prompt_assets.rs:512-517`: `std::env::temp_dir().join(format!("deck-usage-{name}-{}", std::process::id()))`, `remove_dir_all` first, best-effort cleanup after.

---

## 0.2 Frozen cross-section contract

Everything in this section is fixed before any section starts. A section that
needs to change one of these stops and says so rather than diverging.

### 0.2.1 The Tauri command

```rust
#[tauri::command]
pub async fn usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshot, String>
```

Registered as `usage::usage_snapshot` in `src-tauri/src/lib.rs`'s
`generate_handler!` list. `Err` is returned **only** when the blocking worker
panics; every ordinary failure is in-band via `sources[].state` and
`skippedLines` (the fail-soft convention of `prompt_assets.rs` / `agents.rs`).

**`mod usage;` placement — corrected 2026-08-10 after authoring.** `lib.rs`
grew from 13 to 18 modules **while this plan was being written** (a concurrent
session landing the pane-detach work; see §0.5). The modules are now `agents,
coordinator, images, info, links, menu, menu_registry, migrate, pane_census,
platform, prompt_assets, pty, quit_flow, settings_merge, shell_integration,
update_flight, window_close, window_lifecycle`. `usage`'s alphabetical slot is
**between `update_flight;` and `window_close;`** — not last, not after
`shell_integration`. In the handler list, anchor the new entry after
`prompt_assets::list_prompt_assets,`: that entry exists in every revision and,
unlike the tail of the list, is not adjacent to the comma-less last item.
**Read `lib.rs` fresh before editing it** — it may have moved again.

### 0.2.2 The payload — Rust definition

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCounters {
    pub input_uncached: u64,
    pub cache_read: u64,
    pub cache_create_5m: u64,
    pub cache_create_1h: u64,
    pub cache_write: u64,
    pub output: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageAgent { Claude, Codex }

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSourceState { Ok, Missing, Unreadable }

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSource {
    pub agent: UsageAgent,
    pub state: UsageSourceState,
    pub files_scanned: u32,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// Unix ms at the start of the 15-minute UTC bucket.
    pub bucket_start_ms: u64,
    pub agent: UsageAgent,
    /// The raw model string, verbatim — no canonicalization in Rust.
    pub model: String,
    pub counters: UsageCounters,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Unix ms when this scan finished.
    pub scanned_at_ms: u64,
    /// Sorted by (bucket_start_ms, agent, model) so the payload is stable.
    pub buckets: Vec<UsageBucket>,
    /// Exactly two entries, Claude then Codex.
    pub sources: Vec<UsageSource>,
    pub skipped_lines: u64,
}
```

Two field semantics the first draft of §0 left undefined, settled here so Rust
and TS cannot disagree:

- **`skipped_lines` is CUMULATIVE across the corpus, not per scan.** It is
  accumulated per cache file record and summed at snapshot time. Per-scan would
  blank the "n lines skipped" note on every warm poll, which reads as the
  problem having fixed itself.
- **`files_scanned` is the number of live cache records for that agent after
  reconciliation** — i.e. how many transcript files that agent's history spans,
  not how many files this particular scan opened. Stable across polls, and
  never zero merely because a warm poll opened nothing.

### 0.2.3 The payload — TS mirror (`src/lib/usage-snapshot.ts`, pure)

```ts
export type UsageAgent = "claude" | "codex";
export type UsageSourceState = "ok" | "missing" | "unreadable";

export interface UsageCounters {
  readonly inputUncached: number;
  readonly cacheRead: number;
  readonly cacheCreate5m: number;
  readonly cacheCreate1h: number;
  readonly cacheWrite: number;
  readonly output: number;
}

export interface UsageSource {
  readonly agent: UsageAgent;
  readonly state: UsageSourceState;
  readonly filesScanned: number;
}

export interface UsageBucket {
  readonly bucketStartMs: number;
  readonly agent: UsageAgent;
  readonly model: string;
  readonly counters: UsageCounters;
}

/** Mirror of the Rust `UsageSnapshot` payload from the `usage_snapshot` command. */
export interface UsageSnapshot {
  readonly scannedAtMs: number;
  readonly buckets: readonly UsageBucket[];
  readonly sources: readonly UsageSource[];
  readonly skippedLines: number;
}
```

**Section A MUST write a serialization-contract test** asserting the exact JSON
of one fully-populated `UsageSnapshot` against a `serde_json::json!` literal —
the `src-tauri/src/info.rs:320-340` precedent. A serde rename drift here breaks
TS silently; that test is the only thing that catches it.

### 0.2.4 Frozen constants

| Constant                | Value                                      | Where                               | Why this value                                                                                                                                                                           |
| ----------------------- | ------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USAGE_CACHE_VERSION`   | `1`                                        | `usage.rs`                          | Parser/schema version. A mismatch discards the cache and forces a full rescan (spec, major M1).                                                                                          |
| `USAGE_CACHE_FILE`      | `"usage-cache.json"`                       | `usage.rs`                          | In `app.path().app_data_dir()`, beside the plugin stores. Written temp+rename.                                                                                                           |
| `BUCKET_MS`             | `15 * 60 * 1000`                           | `usage.rs`                          | 15-minute UTC buckets — :30 and :45 offsets (India, Nepal, Chatham) put boundary-hour usage on the wrong local day with hourly buckets.                                                  |
| `MAX_LINE_BYTES`        | `8 * 1024 * 1024`                          | `usage.rs`                          | Largest Claude line measured on the dev machine is 1.22 MB; Codex conversation lines reach ~16 MB but carry no usage. Over the cap → skip-and-count, discarding bytes without buffering. |
| `COMPACT_AFTER_MS`      | `48 * 60 * 60 * 1000`                      | `usage.rs`                          | A file whose mtime is older than 48 h gets its contribution map dropped (see §0.3 decision 4).                                                                                           |
| `USAGE_POLL_MS`         | `5000`                                     | `src/usage/usage-store.ts`          | Spec §Surface: snapshot on open, then a 5 s poll **while open**.                                                                                                                         |
| `PRICING_SNAPSHOT_DATE` | `"2026-08-10"` (set by the refresh script) | `src/lib/usage-pricing-snapshot.ts` | Shown in the UI beside every dollar figure.                                                                                                                                              |

### 0.2.5 Frontend module map and the names each publishes

| Module                              | Purity          | Publishes                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/usage-snapshot.ts`         | pure            | The types in §0.2.3, plus `EMPTY_USAGE_SNAPSHOT`, `addCounters(a, b): UsageCounters`, `totalTokens(c: UsageCounters): number`, `EMPTY_COUNTERS`.                                                                                                               |
| `src/lib/usage-pricing-snapshot.ts` | pure, generated | `interface ModelPricing`, `PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>>`, `PRICING_SNAPSHOT_DATE: string`, `PRICING_SOURCE_URL: string`.                                                                                                           |
| `src/lib/usage-pricing.ts`          | pure            | `estimateCostUsd(model: string, counters: UsageCounters): number                                                                                                                                                                                               | null`, `isPricedModel(model: string): boolean`, `formatUsd(value: number): string`. |
| `src/lib/usage-aggregate.ts`        | pure            | `localDayKey(utcMs: number): string`, `agentTotals(buckets, sinceMs \| null): readonly AgentTotal[]`, `dailyRows(buckets, days: number, nowMs: number): readonly DailyRow[]`, `breakdownRows(buckets): readonly BreakdownRow[]`, and the three row interfaces. |
| `src/usage/usage-client.ts`         | impure (IPC)    | `interface UsageClient { snapshot(): Promise<UsageSnapshot> }`, `createTauriUsageClient()`, `createMemoryUsageClient(snapshot?, options?)`, `defaultUsageClient`.                                                                                              |
| `src/usage/usage-store.ts`          | impure          | `usageSnapshot: Signal<UsageSnapshot \| null>`, `usageStale: Signal<boolean>`, `usageLoading: Signal<boolean>`, `startUsagePolling(client?): void`, `stopUsagePolling(): void`.                                                                                |
| `src/ui/usage/**`                   | components      | `UsageScreen`, `UsageNav`, `USAGE_VIEWS`, `activeUsageView`.                                                                                                                                                                                                   |

`ModelPricing` is frozen as:

```ts
export interface ModelPricing {
  readonly inputPerToken: number;
  readonly outputPerToken: number;
  readonly cacheReadPerToken: number | null;
  readonly cacheWritePerToken: number | null;
}
```

`AgentTotal`, `DailyRow`, `BreakdownRow` are frozen as:

```ts
export interface AgentTotal {
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null; // null when ANY contributing model is unpriced
  readonly unpricedModels: readonly string[];
}
export interface DailyRow {
  readonly day: string; // local calendar day, "YYYY-MM-DD"
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}
export interface BreakdownRow {
  readonly agent: UsageAgent;
  readonly model: string; // raw string, verbatim
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
}
```

### 0.2.6 Overlay and action wiring — frozen names

- Signal: `export const usageOpen = signal(false);` in `src/chrome/events.ts`, immediately after `settingsOpen`, carrying a doc comment that says it **is** a grid-covering overlay (the inverse of `promptsOpen`'s comment).
- Module-scope helpers in `src/ui/app.tsx`, mirroring `closeSettingsPanel` / `toggleSettingsPanel`: `export function closeUsagePanel(focusActive: () => void): void` and `export function toggleUsagePanel(focusActive: () => void): void`.
- Action entry, placed immediately after `toggle-prompts` in `ACTION_REGISTRY`:
  ```ts
  {
    id: "toggle-usage",
    label: "Token Usage…",
    scope: "always",
    menu: { submenu: "View", group: "usage" },
  }
  ```
- Bindings: `{ key: "u", meta: true, shift: true, action: "toggle-usage" }` in `MACOS_KEYMAP`, `{ key: "u", ctrl: true, shift: true, action: "toggle-usage" }` in `WINDOWS_KEYMAP`. **`CharKeyBinding`, not `PhysicalKeyBinding`** — the action carries a macOS menu item and a Cocoa accelerator is declared by character (the RULE at `action-registry.ts:475-510`). `u` is bound nowhere on either keymap at any modifier combination, verified exhaustively.
- Dispatch: `"toggle-usage": () => deps.onToggleUsage?.()` — the **seam style** of `toggle-settings`, not the direct-signal style of `toggle-prompts`, because App owns the close-and-return-focus flow. Requires `readonly onToggleUsage?: () => void` on `TabManagerDeps` and `"toggle-usage"` in `COMMAND_ACTIONS`.
- `openOverlayRanks()` in `tab-manager.ts` pushes **`TIER_RANK.settings`** when `usageOpen.value`. **Do not add a member to the `OverlayTier` union** — no action is tiered `"settings"` today (locked by `TIER_RANK`'s own doc comment), so reusing the rank is behavior-preserving and costs no new concept.
- `overlayCoversPane()` in `app.tsx` gains `|| usageOpen.value`.
- `attention-focus-coordinator.ts`'s `overlays` object gains `usage: boolean` and its deps gain `dismissUsage: () => void`.
- Reduced-motion scope list in `src/styles.css` gains `.usage-screen, .usage-screen *` (DL-1.5: by scope, never by allowlist).

### 0.2.7 DL section numbers

- **§11** keeps its number and its five rules `DL-11.1`…`DL-11.5`; only the heading and preamble generalize from "the settings surface" to "a full-window screen", and the rules reword "the settings shell" → "a full-window screen shell". No rule is renumbered — `DL-11.1` is cited from `src/ui/settings/settings-screen.tsx` and `src/styles.css`, and renumbering would silently break those citations.
- **§15. Read-only data tables** is the new section, inserted after §14 and before the trailing `## Chưa khớp thực tế` heading, written in §13's shape: date + feature + which § it forks + why it is not a new widget genre, then `DL-15.1`… bullets.

---

## 0.3 Decisions this plan makes

| #   | Question the spec left open                                                                                 | Decision, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spec §Pricing says `src/lib/usage-pricing.ts` "ships a pinned snapshot".                                    | **Split into two files:** `usage-pricing-snapshot.ts` (generated data, rewritten wholesale by the refresh script) and `usage-pricing.ts` (hand-written math). A script that rewrites a file containing hand-written logic is a script that can destroy logic; keeping the generated payload alone in its own module makes the refresh a whole-file write, which is the same discipline `menu_registry.rs` already uses.                                                                                     |
| 2   | Spec §Assumptions: "the contribution map is unbounded as specified; the implementation plan must bound it." | **Compact by file mtime age, not by scan count.** When a file's mtime is older than `COMPACT_AFTER_MS` (48 h), drop its contribution map and keep only its rolled-up per-`{bucket, model}` counters, setting `compacted: true`. If a compacted file later changes (size or mtime moves), rescan it from zero and rebuild its map. Scan-count compaction was rejected: with a 5 s poll, a session merely paused for two minutes would compact and then force a full re-read the moment the user typed again. |
| 3   | Whether `toggle-usage` needs a new `OverlayTier`.                                                           | **No.** It pushes `TIER_RANK.settings`. See §0.2.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | Where focus goes when Usage closes, given Usage and Settings are mutually exclusive.                        | **`restoreFocusAfterSettings`, unchanged; Settings does not reopen.** The spec says "Escape closes and focus returns to the terminal exactly as Settings does". Reopening a surface the user displaced is a second, unspecified behavior.                                                                                                                                                                                                                                                                   |
| 5   | `usage_snapshot`'s return type.                                                                             | `Result<UsageSnapshot, String>`, `Err` only on worker panic. Everything else is in-band. This is what lets the poll's failure path ("keep last good data, mark stale") have exactly one trigger.                                                                                                                                                                                                                                                                                                            |
| 6   | The refresh script's invocation.                                                                            | `scripts/refresh-usage-pricing.mjs`, plain Node ESM, wired as `"refresh:pricing"` in `package.json` — matching `preview:updater`. It is **never** run by `predev`/`prebuild`/CI: a build must not be able to change what ships.                                                                                                                                                                                                                                                                             |
| 7   | Whether `cacheRead` should be folded into `inputUncached` for display.                                      | **No.** All six counters stay separate everywhere, including the breakdown table, because each prices differently (spec blocker B4) and Codex's `cachedInputTokens` is a _subset_ of its input.                                                                                                                                                                                                                                                                                                             |
| 8   | What a `costUsd` of `null` means in a rollup that mixes priced and unpriced models.                         | **`null` wins.** A partial sum presented as a total is worse than no number. The row carries `unpricedModels` so the UI can say which model is missing, and the breakdown view always shows the raw model string.                                                                                                                                                                                                                                                                                           |
| 9   | Commit granularity under parallel execution.                                                                | **Section subagents never run git.** See §0.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | Section A's Rust lands at ~1 500 lines, over the 800-line ceiling in the global rules (C2/F8). | **`usage.rs` becomes a directory module `src-tauri/src/usage/`,** following the `src-tauri/src/platform/` precedent. `mod usage;` in `lib.rs` is unchanged; only the file layout differs. Keeping one file was defensible on repo precedent (`coordinator.rs` 1829 lines, `links.rs` 993, `pty.rs` 870), but the ceiling exists for a reason and the split costs nothing. **Every type, function and test name in Section A stays exactly as written** — see the task→file map below. |
| 11  | `estimateCostUsd` for a model whose counters are all zero. | **Returns `0`, for any model id, before the price lookup.** Claude Code writes assistant lines whose `message.model` is the literal `<synthetic>` — 138 of them on this machine, every counter zero. Without this rule, decision 8's "null wins" would blank the Claude dollar column permanently. This is arithmetic, not a price guess, and it special-cases no id. |
| 12  | Rates the spec does not name: a model with no published `cache_read_input_token_cost`, and a Claude-shaped `cache_create_5m` under a model with no cache-write rate. | **Both fall back to `inputPerToken`,** extending the spec's documented `cache_write` fallback to the two cases it omits. Degrading a dollar figure beats deleting it. Dead code on observed data — all 12 model ids this machine emits publish a cache-read rate. |
| 13  | Who owns the poll lifecycle, which Section B's store and Section C's screen could each claim. | **Section C's screen owns start/stop, keyed on the `open` prop. Section B's store polls only between an explicit `startUsagePolling()` and `stopUsagePolling()`, never at module load,** and refuses a second request while one is in flight, so a slow cold scan reads as loading rather than as a frozen repeat of the last snapshot. |

**Task → file map for the `src-tauri/src/usage/` split (decision 10).** Section A's
tasks are written as "add to `usage.rs`"; read that as the file named here.

| Section A task | File |
| -------------- | ---- |
| A1 — capped line reader, `parse_rfc3339_ms` | `src-tauri/src/usage/reader.rs` |
| A2 — payload types, cache record types, constants | `src-tauri/src/usage/mod.rs` |
| A3 — Claude ingestion | `src-tauri/src/usage/claude.rs` |
| A4 — Codex ingestion | `src-tauri/src/usage/codex.rs` |
| A5 — cache load, version discard, atomic write | `src-tauri/src/usage/cache.rs` |
| A6 — discovery and session identity | `src-tauri/src/usage/discover.rs` |
| A7 — incremental scan, reconciliation, aggregation | `src-tauri/src/usage/scan.rs` |
| A8 — the command, single-flight state, `lib.rs` | `src-tauri/src/usage/mod.rs` + `src-tauri/src/lib.rs` |

Each file keeps its own inline `#[cfg(test)] mod tests`, so a task's tests move with
its code. Cross-file visibility is `pub(crate)` inside `usage`; only `usage_snapshot`
and the payload types are `pub`.

---

## 0.4 Spec errata — found while planning, verified against real files on the dev machine 2026-08-10

1. **Codex cumulative totals are nested one level deeper than the spec says.** The spec's Data-sources section implies `payload.total_token_usage`. The real path is **`payload.info.total_token_usage`**. Verified in `~/.codex/sessions/2026/08/10/rollout-2026-08-10T11-45-40-019fe9fd-9d9e-7b30-be60-3ac6783e56f0.jsonl`:
   ```json
   {"timestamp":"2026-08-10T04:45:59.358Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":33328,"cached_input_tokens":6912,"cache_write_input_tokens":0,"output_tokens":587,"reasoning_output_tokens":108,"total_tokens":33915},"last_token_usage":{…},"model_context_window":258400},"rate_limits":{…}}}
   ```
   A parser written from the spec text finds nothing and reports zero Codex usage while looking perfectly healthy. **Section A parses `payload.info.total_token_usage`.**
2. **`payload.info.last_token_usage` exists and equals the per-event delta** in the observed data (event 2: `total.input 74619 − prev total.input 33328 = 41291 = last.input`). The plan still computes `delta = max(0, cumulative − previous)` per the spec, because that rule is the one that survives an offset resume and a forked session replaying inherited totals. `last_token_usage` is used only as a **cross-check assertion in one Rust test**, never as the ingestion path.
3. **The Codex session id is available under two keys.** `session_meta.payload` carries both `session_id` and `id` with the same value. The spec names `session_meta.payload.id`; read that, fall back to `session_id`.
4. **Claude's `message.usage` carries an `iterations` array** repeating the same counters per inference iteration, plus `server_tool_use`, `service_tier`, `speed` and `inference_geo`. Only the top-level counters are read; `iterations` is **not** summed — doing so would double-count. Verified shape:
   ```json
   {"input_tokens":2,"cache_creation_input_tokens":44316,"cache_read_input_tokens":23190,"output_tokens":116,
    "cache_creation":{"ephemeral_1h_input_tokens":44316,"ephemeral_5m_input_tokens":0}, "iterations":[…]}
   ```
5. **Corpus size, measured:** `~/.claude/projects` 1.9 GB, `~/.codex/sessions` 681 MB, 126 `subagents/` directories present. The spec's "~2.5 GB" is accurate. Largest single Claude line measured across the 30 newest transcripts: **1.22 MB** — comfortably under `MAX_LINE_BYTES`.
6. **`~/.codex/archived_sessions/` is FLAT, not dated.** The spec lists it beside `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, which reads as the same layout. On this machine it holds 20 `rollout-*.jsonl` files directly, with no year/month/day levels. A scanner that assumes the dated layout finds nothing there and silently loses every archived session. Both roots are walked recursively.
7. **A Claude transcript's first line is never an assistant line, and one subagent file carries no `sessionId` at all.** The spec says session identity is "read from the first line". Across 400 sampled top-level transcripts the first line is `last-prompt` / `mode` / `queue-operation` / `ai-title` / `bridge-session`, all of which do carry `sessionId`; of 200 subagent files, one opens with a `fork-context-ref` line that does not. The fallback is an FNV-1a hash of the bounded head — a hash, not the bytes, because storing the head of a `type: "user"` line in the cache would break the spec's own privacy contract.
8. **Claude's `requestId` is sometimes absent** — 3 of 6 941 real assistant usage lines, all on the `<synthetic>` model. The spec's dedupe key names both halves and says nothing about a missing one. The key is `id + "\u{1}" + ""`; the line is skipped only when **both** halves are absent.
9. **`<synthetic>` is a real Claude model string and it is not in LiteLLM.** 138 lines on this machine, every counter zero in all of them. See §0.3 decision 11 for why that matters and how it is handled.
10. **One real Codex session has no `turn_context` line at all.** The spec says the model "comes from the most recent `turn_context` line" and offers no fallback. That file also has zero `token_count` events, so nothing is lost today, but the code answers with an `UNKNOWN_MODEL` constant, which the frontend prices as unknown and renders as a dash. `session_meta` is not an alternative — its payload carries no `model` key.
11. **Codex `cache_write_input_tokens` is 0 in all 1 938 events measured.** The counter is carried faithfully, but nothing on this machine proves the mapping. Its pricing path will be untested by real data until the user hits a provider that charges for cache writes.
12. **Nothing near 16 MB was observed.** Largest line measured across the 40 newest files of each corpus: Claude 1 224 491 B, Codex 1 962 823 B. `MAX_LINE_BYTES` is therefore a guard that real data never trips, and the skip-and-count path is exercised only by fixtures. That is fine, and worth knowing before someone "verifies" it against a live corpus.

---

## 0.5 Accepted residual risks

- **RESOLVED 2026-08-10 — this plan executes in an isolated git worktree.** Branch `feat/token-usage-dashboard`, worktree at `/Users/kyantran/Documents/Development/spacevibe-deck-worktrees/token-usage-dashboard`, branched from `3ef72a9`. Its own `node_modules` (run `npm install` once). Nothing here touches the main checkout, so the collision described below cannot happen; it is kept because it explains why the worktree exists and because the merge back to `main` will have to reconcile with whatever pane-detach lands meanwhile. **Every path in this plan is relative to the worktree root, not to the main checkout.**
- **The hazard that forced the worktree.** Planning started at HEAD `69abe81`; three commits later it was `3ef72a9`, and `src-tauri/src/lib.rs` grew from 13 modules to 18 while Section A was being authored. The concurrent work is the **pane-detach-window** feature (`pane_census.rs`, `quit_flow.rs`, `settings_merge.rs`, `update_flight.rs`, `window_close.rs`, `window_lifecycle.rs`, and commits touching `menu`, `tabs` and `quit`). Its Sections C/D touch `src/terminal/action-registry.ts`, `src/terminal/tab-manager.ts`, `src/ui/app.tsx` and `src-tauri/src/menu_registry.rs` — **exactly this plan's Section D**, and `src/styles.css` (Section C's file) is already dirty. Before executing: re-check `git status` and `git log`, read every file fresh immediately before editing it, and never revert a hunk you did not write. If the two features are in flight at the same time, running this plan in a separate git worktree is the safer choice.

- **Windows path layout is unverified.** `%USERPROFILE%\.claude` / `.codex` is assumed to mirror macOS. `crate::platform::user_home()` already resolves `USERPROFILE` on Windows, so the code is correct-by-construction if the layout matches; if the dirs are absent the feature degrades to `state: "missing"` → "no data yet". Not a blocker, recorded as an assumption.
- **The Codex rollout format is experimental upstream.** The hedges are the fail-soft-per-line contract, the visible skipped-line count, and `USAGE_CACHE_VERSION`.
- **The working tree is dirty at planning time** — `git status` at HEAD `69abe81` shows modified `.github/workflows/release.yml`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `marketing/landing-prototype/src/directions/a.js`, `scripts/release-workflow.test.ts`, `src-tauri/src/coordinator.rs`, `src/styles.css`, plus untracked plans/specs and `scripts/generate-release-notes.*`. **`src/styles.css` and `docs/CONTEXT.md` are already modified by other work — re-read them before editing and never revert someone else's hunk.** Re-check `git status` at execution time.
- **`agy`, OpenCode and Gemini usage is invisible.** v1 is Claude + Codex; `usage.rs`'s per-agent adapter split is the seam and nothing more is built.

---

## 0.6 Wave order, file ownership, and commit discipline

```
Wave 1 (parallel):  Section A — Rust scanner        ∥  Section B — TS data, pricing, client, store
Wave 2:             Section C — the UsageScreen surface + DL doc     (needs B's types)
Wave 3:             Section D — wiring, entry points, final verification  (needs C's component)
```

**File ownership is disjoint. A section edits only files in its own row.**

| Section | Owns                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | `src-tauri/src/usage/**` (create — see the task→file map in §0.3 decision 10) · `src-tauri/src/lib.rs` (two lines)                                                                                                                                                                                                                                                                                                                                                     |
| B       | `src/lib/usage-snapshot.ts` · `src/lib/usage-pricing-snapshot.ts` · `src/lib/usage-pricing.ts` · `src/lib/usage-aggregate.ts` · `src/usage/usage-client.ts` · `src/usage/usage-store.ts` · their `.test.ts` siblings · `scripts/refresh-usage-pricing.mjs` + `scripts/refresh-usage-pricing.test.ts` · `package.json` (one script line)                                                                                    |
| C       | `src/ui/usage/**` (create) · `src/styles.css` (**the whole file — including the reduced-motion scope list**) · `docs/DESIGN-LANGUAGE.md`                                                                                                                                                                                                                                                                                   |
| D       | `src/chrome/events.ts` · `src/terminal/action-registry.ts` (+ test) · `src/terminal/keymap.test.ts` · `src/terminal/tab-manager.ts` (+ test) · `src/ui/app.tsx` (+ test) · `src/ui/chrome-actions.tsx` · `src/ui/tab-bar.tsx` · `src/ui/attention-focus-coordinator.ts` (+ test) · `src/ui/settings/sections/agents-section.tsx` · `src-tauri/src/menu_registry.rs` (**generated only**) · `AGENTS.md` · `docs/CONTEXT.md` |

`src/styles.css` is given entirely to C — including D's reduced-motion line — because C runs strictly before D and one owner beats a two-owner file.

**Commit discipline.** No branches (W6): all work lands on the current branch.
**Section subagents run no git command at all** — not `add`, not `commit`, not
`status`. Two concurrent `git commit`s in one checkout race `index.lock`, and
Wave 1 runs two sections at once. The orchestrating session commits at each
wave boundary, one conventional commit per task, with **explicit paths** and
never `git add -A`.

**D14 — documentation is not committed until the user approves it.** That
covers this plan file, `docs/DESIGN-LANGUAGE.md`, `docs/CONTEXT.md` and
`AGENTS.md`. Explicit-path commits are what keep those out of the code commits.

---

## 0.7 Defaults taken without asking

Each of these is cheap to reverse and none changes the shape of the work.

1. **Menu label** is `Token Usage…` (View menu, its own group, so the generator emits a separator above it).
2. **Rail labels** are `overview`, `daily`, `breakdown` — the spec's own words, lowercase per DL-11.4.
3. **Chrome button icon** is `ChartColumn` from `lucide-preact`, at `CHROME_ICON` (13). Meaning over decoration (DL-14.5): the screen is a chart of counts, not a wallet.
4. **Rail icons** are `Gauge` (overview), `CalendarDays` (daily), `Table2` (breakdown), at `RAIL_ICON` (16), wrapped as named components in `src/ui/usage/usage-nav-icons.tsx` the way `settings-nav-icons.tsx` does it.
5. **The Settings › agents link row** is an ordinary `ConfigRow` with a `cfg-btn` `action` pill reading `open …` — the exact pattern `about-section.tsx`'s "Release notes" row already uses, so no new DL value kind is invented (DL §6 is a closed set).

---

---

# Section A — Rust usage scanner

Owns `src-tauri/src/usage.rs` (create) and exactly two lines of
`src-tauri/src/lib.rs`. Nothing else in `src-tauri/` is touched. No new crate,
Rust or npm (§0.1). Every string, comment and doc in English (R1).

## Verified source facts this section builds on

Read at HEAD `69abe81` with a dirty working tree on 2026-08-10. Re-read before
editing — `lib.rs` moved **while this section was being written** (see Findings b).

**Code precedents**

| Fact                                                                                                                                  | Where                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Injected-roots testability seam: `fn collect(agent: &str, home: &Path, project: Option<&Path>)`, so tests never touch a real home dir | `src-tauri/src/prompt_assets.rs:351`                                                 |
| Runtime temp-dir fixture helper — `std::env::temp_dir().join(format!(…))`, `remove_dir_all` first, best-effort cleanup after          | `src-tauri/src/prompt_assets.rs:512-517`                                             |
| `crate::platform::user_home()` used fail-soft from a command                                                                          | `src-tauri/src/prompt_assets.rs:404-410`                                             |
| `read_dir` + `entry.file_type()` with symlinks skipped                                                                                | `src-tauri/src/prompt_assets.rs:247-263`, `:267-291`                                 |
| `serde_json::Value` navigation with `.get(…).and_then(Value::as_str)`                                                                 | `src-tauri/src/prompt_assets.rs:224-243`                                             |
| `tauri::async_runtime::spawn_blocking(move \|\| …).await` inside a `#[tauri::command] pub async fn`                                   | `src-tauri/src/info.rs:195-198`                                                      |
| Serialization-contract test asserting a payload against a `serde_json::json!` literal                                                 | `src-tauri/src/info.rs:320-340`                                                      |
| `app.path().app_data_dir()` — the only precedent — with `use tauri::Manager;`                                                         | `src-tauri/src/migrate.rs:4`, `:21-22`                                               |
| `user_home()` is re-exported per platform and validated by `validate_user_home` (absolute + is_dir)                                   | `src-tauri/src/platform/mod.rs:12-26`, `:127-135`                                    |
| A module-level `static … OnceLock` already exists, so a `static` inside `usage.rs` is not a new pattern                               | `src-tauri/src/platform/windows/shell.rs:30`                                         |
| `Mutex`-guarded state with `let Ok(state) = self.state.lock() else { … }`                                                             | `src-tauri/src/coordinator.rs:305`, `:313-320`                                       |
| A command may take `app: tauri::AppHandle` directly                                                                                   | `src-tauri/src/lib.rs` (`quit_flow::confirm_quit`), and the pre-churn `confirm_quit` |
| Declared dependency set is exactly `tauri, tauri-plugin-*, serde, serde_json, portable-pty, tokio{time}, base64` (+ per-target)       | `src-tauri/Cargo.toml:20-33`                                                         |
| Large single Rust modules are normal here: `coordinator.rs` 1829 lines, `links.rs` 993, `pty.rs` 870, `prompt_assets.rs` 692          | `wc -l src-tauri/src/*.rs`                                                           |
| Toolchain: `cargo 1.90.0`, `rustc 1.90.0` — `Mutex::new` is const, `std::io::Error::other` is stable                                  | `cargo --version`                                                                    |

**Real data facts, measured on the dev machine 2026-08-10**

- Codex cumulative totals live at **`payload.info.total_token_usage`** (§0.4
  erratum 1 confirmed) in
  `~/.codex/sessions/2026/08/10/rollout-2026-08-10T11-45-40-019fe9fd-9d9e-7b30-be60-3ac6783e56f0.jsonl`.
  Event 1 `input 33328 / cached 6912 / cache_write 0 / output 587`; event 2
  `74619 / 39424 / 0 / 1226` with `last_token_usage` `41291 / 32512 / 0 / 639`
  — exactly the computed delta (§0.4 erratum 2 confirmed).
- `session_meta.payload` carries **both** `id` and `session_id` with the same
  value (§0.4 erratum 3 confirmed). Keys observed: `base_instructions,
cli_version, context_window, cwd, git, history_mode, id, model_provider,
originator, session_id, source, thread_source, timestamp` — **no `model`**,
  so `session_meta` is not a model fallback.
- **`~/.codex/archived_sessions/` is FLAT** — 20 `rollout-*.jsonl` directly in
  it, no `YYYY/MM/DD` nesting, every first line `session_meta`. The spec
  implies the dated layout for both. A recursive walk covers both shapes.
- 460 active rollouts, 20 archived, **zero id overlap** on this machine — the
  archived-skip rule is untested by real data and must be proven by fixture.
- Of the 40 newest rollouts, **1 has no `turn_context` at all** (it also has 0
  `token_count` events); **0** have a `token_count` before their first
  `turn_context`; 1938 `token_count` events, **0** with `info == null`.
- No rollout in the 60 newest switches model mid-session — the model-switch
  path is fixture-only.
- Claude: 438 top-level `projects/*/*.jsonl`, **972**
  `projects/*/*/subagents/*.jsonl`. **No deeper nesting** (`*/*/*/subagents/*.jsonl`
  = 0, `*/*/*.jsonl` = 0), so the two globs in §0.2 are exhaustive. Sibling
  dirs under a session dir are `subagents`, `tool-results`, `workflows` — only
  `subagents` holds transcripts.
- Claude first lines are `last-prompt` (260), `mode` (123), `queue-operation`
  (10), `ai-title` (6), `bridge-session` (1) of 400 sampled — **never an
  assistant line** — and 0 of 400 lacked `sessionId`. Of 200 subagent files,
  199 open with `type: "user"` and **1 (`fork-context-ref`) has no `sessionId`**
  → the identity function needs a fallback.
- Assistant usage lines in the 40 newest transcripts: 6941. **0** lacked
  `cache_creation`; **3** lacked `requestId`; models seen `claude-opus-5`
  (5790), `claude-fable-5` (1148), `<synthetic>` (3).
- Largest line measured: Claude **1 224 491 B**, Codex **1 962 823 B** — both
  well under `MAX_LINE_BYTES` (8 MiB), so the cap is a guard, not a routine path.
- Reference epoch values used as literals in the tests below:
  `1970-01-01T00:00:00Z` = `0`; `2026-08-10T04:45:59.358Z` = `1786337159358`
  (bucket `1786337100000`); `2026-08-10T05:06:00.351Z` = `1786338360351`
  (bucket `1786338000000`); `2024-02-29T12:00:00Z` = `1709208000000`;
  `2026-08-10T00:00:00Z` = `1786320000000`; `2026-08-11T00:00:00Z` =
  `1786406400000`.

## What this section produces for later sections

One Tauri command, registered as `usage::usage_snapshot`:

```rust
#[tauri::command]
pub async fn usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshot, String>
```

`Err` is returned **only** when the blocking worker panics. Every ordinary
failure is in-band via `sources[].state` and `skippedLines` (§0.2.1, §0.3
decision 5). Restated so an implementer of Section B who reads only this
section is not blocked, the serialized payload is:

```jsonc
{
  "scannedAtMs": 1786338360351, // Unix ms when this scan finished
  "buckets": [
    // sorted by (bucketStartMs, agent, model)
    {
      "bucketStartMs": 1786337100000, // start of a 15-minute UTC bucket
      "agent": "claude", // "claude" | "codex"
      "model": "claude-opus-5", // the raw model string, verbatim
      "counters": {
        "inputUncached": 0,
        "cacheRead": 0,
        "cacheCreate5m": 0,
        "cacheCreate1h": 0,
        "cacheWrite": 0,
        "output": 0,
      },
    },
  ],
  "sources": [
    // exactly two entries, Claude then Codex
    { "agent": "claude", "state": "ok", "filesScanned": 1410 },
    { "agent": "codex", "state": "missing", "filesScanned": 0 },
  ],
  "skippedLines": 0,
}
```

`state` is `"ok" | "missing" | "unreadable"`, and `"unreadable"` is **never**
conflated with `"missing"` (spec major M7). `skippedLines` is cumulative across
the cache, not per scan, so the number the UI shows does not flicker between
polls.

Section A produces **no TypeScript**. `src/lib/usage-snapshot.ts` (§0.2.3) is
Section B's file; the Rust serialization-contract test in Task A2 is the only
guard against the two drifting.

## Task order

| Task | What it proves                                                                        | Depends on |
| ---- | ------------------------------------------------------------------------------------- | ---------- |
| A1   | The capped line reader and the hand-rolled RFC3339 parser — the two riskiest pieces   | —          |
| A2   | The frozen payload and cache types, the constants, the serialization contract         | A1         |
| A3   | Claude line ingestion: dedupe key, last-wins, cache tiers, the tier fallback          | A2         |
| A4   | Codex line ingestion: `payload.info`, deltas, the high-water mark, model attribution  | A2, A3     |
| A5   | The cache file: load, version discard, temp-file-plus-rename write                    | A2         |
| A6   | Discovery: the two Claude globs, the two Codex roots, identity, missing vs unreadable | A2, A5     |
| A7   | `scan_all` — resume, shrink, replacement, deletion, compaction — and aggregation      | A3–A6      |
| A8   | The command, the single-flight statics, the two `lib.rs` lines, full verification     | A7         |

Every task is independently testable and every test in it runs under
`cargo test --manifest-path src-tauri/Cargo.toml usage::`.

---

### Task A1: The capped line reader and the RFC3339 parser

**Files:**

- Create: `src-tauri/src/usage.rs`
- Modify: `src-tauri/src/lib.rs` (**line 1 of 2** — the `mod usage;` declaration;
  the handler line lands in Task A8)

**Interfaces:**

- Consumes: nothing (first task).
- Produces (crate-internal):
  - `const MAX_LINE_BYTES: usize`, `const READ_BUFFER_BYTES: usize`
  - `enum LineEvent { Line(Vec<u8>, u64), Oversized(u64), End }`
  - `struct LineReader<R: std::io::Read>` with `new(source, start)` and
    `next_line() -> std::io::Result<LineEvent>`
  - `fn parse_rfc3339_ms(text: &str) -> Option<u64>`
  - `fn days_from_civil(year: i64, month: u32, day: u32) -> i64`,
    `fn is_leap_year(year: i64) -> bool`, `fn days_in_month(year: i64, month: u32) -> u32`

- [ ] **Step 1: Declare the module so `cargo test` can see it**

Re-read `src-tauri/src/lib.rs` first — it changed during planning. Insert
`mod usage;` in the existing alphabetical `mod` block, **after `mod update_flight;`
and before `mod window_close;`**. That is the alphabetical slot; §0.2.1's
"declared last, alphabetically after `mod shell_integration;`" was written
against an older revision (Findings b).

```rust
mod update_flight;
mod usage;
mod window_close;
```

- [ ] **Step 2: Write the module doc comment and the failing tests**

Create `src-tauri/src/usage.rs` containing **only** this. Every function it
references is missing on purpose, so the first `cargo test` fails to compile.

```rust
//! Machine-wide token usage, read out of the Claude Code and Codex CLI
//! transcripts this OS user has on disk.
//!
//! **Privacy contract.** The scanner necessarily reads file bytes that include
//! conversation content, but the parse loop keeps and returns **only** usage
//! counters, model strings, timestamps, session/message ids and file paths.
//! Conversation content never leaves this loop: it never enters the cache, it
//! never crosses the Tauri IPC boundary, and the one place a raw byte range
//! could have escaped — the session-identity fallback — hashes the bytes
//! instead of storing them.
//!
//! Not one of the R4 load-bearing seams: this is a leaf module with one
//! command. Every failure is fail-soft and in-band, the convention
//! `prompt_assets.rs` and `agents.rs` already follow — a missing directory, an
//! unreadable file or a malformed line degrades the answer instead of
//! returning an error.
//!
//! Zero new crates. No `chrono` (timestamps are parsed by hand), no `walkdir`
//! (`std::fs::read_dir` recursion with a depth cap), no `memchr`
//! (`slice::iter().position()`), no `tempfile` (tests build fixtures in the OS
//! temp dir). All three are in `Cargo.lock` as transitive Tauri dependencies
//! and none of them is importable.

#[cfg(test)]
mod tests {
    use super::*;

    fn read_all(data: &[u8], start: u64, cap: usize) -> Vec<LineEvent> {
        let mut reader = LineReader::with_cap(std::io::Cursor::new(data.to_vec()), start, cap);
        let mut events = Vec::new();
        loop {
            let event = reader.next_line().expect("cursor reads never fail");
            let done = matches!(event, LineEvent::End);
            events.push(event);
            if done {
                return events;
            }
        }
    }

    fn text(event: &LineEvent) -> Option<String> {
        match event {
            LineEvent::Line(bytes, _) => Some(String::from_utf8_lossy(bytes).into_owned()),
            _ => None,
        }
    }

    #[test]
    fn reads_complete_lines_and_commits_the_offset_past_each_newline() {
        let events = read_all(b"one\ntwo\n", 0, 64);
        assert_eq!(events.len(), 3);
        assert_eq!(text(&events[0]).as_deref(), Some("one"));
        assert_eq!(text(&events[1]).as_deref(), Some("two"));
        assert!(matches!(events[0], LineEvent::Line(_, 4)));
        assert!(matches!(events[1], LineEvent::Line(_, 8)));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn discards_a_partial_trailing_line_without_committing_it() {
        // "two" has no newline: it is not emitted, and the last committed
        // offset stays at 4 so the next scan re-reads it.
        let events = read_all(b"one\ntwo", 0, 64);
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], LineEvent::Line(_, 4)));
        assert!(matches!(events[1], LineEvent::End));
    }

    #[test]
    fn an_empty_line_is_a_line_not_an_end() {
        let events = read_all(b"\na\n", 0, 64);
        assert_eq!(text(&events[0]).as_deref(), Some(""));
        assert_eq!(text(&events[1]).as_deref(), Some("a"));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn keeps_a_line_of_exactly_the_cap_and_skips_one_byte_over() {
        let at_cap = read_all(b"12345678\n", 0, 8);
        assert_eq!(text(&at_cap[0]).as_deref(), Some("12345678"));

        let over_cap = read_all(b"123456789\n", 0, 8);
        assert!(matches!(over_cap[0], LineEvent::Oversized(10)));
    }

    #[test]
    fn skips_an_oversized_line_and_still_reads_the_next_one() {
        let events = read_all(b"123456789\nkept\n", 0, 8);
        assert!(matches!(events[0], LineEvent::Oversized(10)));
        assert_eq!(text(&events[1]).as_deref(), Some("kept"));
        assert!(matches!(events[1], LineEvent::Line(_, 15)));
        assert!(matches!(events[2], LineEvent::End));
    }

    #[test]
    fn an_oversized_line_spanning_several_buffer_fills_is_still_one_event() {
        // Longer than the reader's own buffer, so `fill_buf` returns a chunk
        // with NO newline in it at least twice. That is the "already
        // oversized, keep discarding" branch — the one that must consume and
        // drop bytes instead of appending them. A line that fits in one fill
        // never reaches it.
        let mut data = vec![b'x'; READ_BUFFER_BYTES + 500];
        data.push(b'\n');
        data.extend_from_slice(b"kept\n");
        let expected = (READ_BUFFER_BYTES + 500 + 1) as u64;
        let mut reader = LineReader::with_cap(std::io::Cursor::new(data), 0, 16);
        assert!(
            matches!(reader.next_line().unwrap(), LineEvent::Oversized(n) if n == expected)
        );
        assert!(
            matches!(reader.next_line().unwrap(), LineEvent::Line(_, n) if n == expected + 5)
        );
    }

    #[test]
    fn resumes_offsets_from_the_start_it_was_handed() {
        let events = read_all(b"two\n", 4, 64);
        assert!(matches!(events[0], LineEvent::Line(_, 8)));
    }

    #[test]
    fn the_production_cap_is_the_frozen_value() {
        assert_eq!(MAX_LINE_BYTES, 8 * 1024 * 1024);
    }

    #[test]
    fn parses_the_two_timestamp_shapes_both_clis_actually_write() {
        // Codex, verified in rollout-2026-08-10T11-45-40-019fe9fd…jsonl.
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.358Z"),
            Some(1_786_337_159_358)
        );
        // Claude, verified in projects/…/aa8311ee-….jsonl.
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T05:06:00.351Z"),
            Some(1_786_338_360_351)
        );
    }

    #[test]
    fn parses_the_epoch_and_a_leap_day() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(
            parse_rfc3339_ms("2024-02-29T12:00:00Z"),
            Some(1_709_208_000_000)
        );
        assert_eq!(parse_rfc3339_ms("2023-02-29T12:00:00Z"), None);
    }

    #[test]
    fn truncates_fractional_seconds_past_milliseconds_and_pads_short_ones() {
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.3589999Z"),
            Some(1_786_337_159_358)
        );
        assert_eq!(
            parse_rfc3339_ms("2026-08-10T04:45:59.5Z"),
            Some(1_786_337_159_500)
        );
    }

    #[test]
    fn refuses_anything_that_is_not_zulu_utc() {
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59+07:00"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T04:45:59.358"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10 04:45:59Z"), None);
        assert_eq!(parse_rfc3339_ms("not a timestamp"), None);
        assert_eq!(parse_rfc3339_ms(""), None);
    }

    #[test]
    fn refuses_out_of_range_fields_and_pre_epoch_dates() {
        assert_eq!(parse_rfc3339_ms("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-00-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-32T00:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T24:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-08-10T00:60:00Z"), None);
        // A leap second is legal RFC3339 and never appears in either CLI's
        // output; refusing it beats inventing a mapping onto Unix time.
        assert_eq!(parse_rfc3339_ms("2026-08-10T00:00:60Z"), None);
        assert_eq!(parse_rfc3339_ms("1969-12-31T23:59:59Z"), None);
    }

    #[test]
    fn days_from_civil_matches_the_known_anchors() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2024, 2, 29), 19_782);
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2024));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2023, 2), 28);
        assert_eq!(days_in_month(2026, 8), 31);
        assert_eq!(days_in_month(2026, 4), 30);
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0433]: failed to resolve: use of undeclared type
'LineReader'`, `error[E0425]: cannot find function 'parse_rfc3339_ms' in this
scope`, `error[E0425]: cannot find value 'MAX_LINE_BYTES' in this scope`. The
crate does not compile, so no test runs.

- [ ] **Step 4: Write the capped line reader**

Insert immediately after the module doc comment, before `#[cfg(test)] mod tests`:

```rust
/// Largest line the parser will hold in memory.
///
/// The largest Claude line measured on the dev machine is 1.22 MB and the
/// largest Codex line 1.96 MB, so 8 MiB is a guard rather than a routine path.
/// Codex conversation lines are documented to reach ~16 MB and carry no usage
/// at all: past the cap the bytes are consumed to the next newline and thrown
/// away without ever being buffered.
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Read granularity. Bigger than the default 8 KiB because a cold scan walks
/// ~2.5 GB of transcripts and the syscall count dominates.
const READ_BUFFER_BYTES: usize = 64 * 1024;

/// What one turn of the reader produced.
enum LineEvent {
    /// A complete line without its newline, and the byte offset just past that
    /// newline — the offset that is safe to commit.
    Line(Vec<u8>, u64),
    /// A complete line longer than the cap. Its bytes were consumed and
    /// discarded; the offset is still safe to commit.
    Oversized(u64),
    /// No further complete line. A partial trailing line stays uncommitted and
    /// is re-read by the next scan.
    End,
}

/// A streaming line reader with a hard per-line byte cap.
///
/// Hand-rolled because `BufRead::read_line` is unbounded — one malformed
/// multi-gigabyte line would be pulled into memory in full — and because
/// `memchr` is a transitive dependency that is not importable (§0.1). The
/// committed offset only ever advances past a newline, which is what makes an
/// interrupted append safe to resume.
struct LineReader<R: std::io::Read> {
    reader: std::io::BufReader<R>,
    /// Byte offset just past the last complete line handed out.
    committed: u64,
    /// Bytes consumed so far, including a partial trailing line.
    consumed: u64,
    cap: usize,
}

impl<R: std::io::Read> LineReader<R> {
    fn build(source: R, start: u64, cap: usize) -> Self {
        Self {
            reader: std::io::BufReader::with_capacity(READ_BUFFER_BYTES, source),
            committed: start,
            consumed: start,
            cap,
        }
    }

    fn new(source: R, start: u64) -> Self {
        Self::build(source, start, MAX_LINE_BYTES)
    }

    /// The cap as a parameter, so the boundary can be proven on eight bytes
    /// instead of allocating eight megabytes in a unit test.
    #[cfg(test)]
    fn with_cap(source: R, start: u64, cap: usize) -> Self {
        Self::build(source, start, cap)
    }

    fn next_line(&mut self) -> std::io::Result<LineEvent> {
        let mut line: Vec<u8> = Vec::new();
        let mut oversized = false;
        loop {
            let available = match self.reader.fill_buf() {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            if available.is_empty() {
                return Ok(LineEvent::End);
            }
            let (taken, newline) = match available.iter().position(|byte| *byte == b'\n') {
                Some(index) => (index + 1, true),
                None => (available.len(), false),
            };
            let payload = if newline { taken - 1 } else { taken };
            if oversized || line.len() + payload > self.cap {
                // Drop what was already held as well: the point of the cap is
                // that an over-long line never occupies memory.
                oversized = true;
                line = Vec::new();
            } else {
                line.extend_from_slice(&available[..payload]);
            }
            self.reader.consume(taken);
            self.consumed += taken as u64;
            if newline {
                self.committed = self.consumed;
                return Ok(if oversized {
                    LineEvent::Oversized(self.committed)
                } else {
                    LineEvent::Line(line, self.committed)
                });
            }
        }
    }
}
```

- [ ] **Step 5: Write the RFC3339 parser**

Insert after the `LineReader` impl:

```rust
/// `YYYY-MM-DDTHH:MM:SS[.fraction]Z` → Unix milliseconds.
///
/// Hand-rolled: `chrono` sits in `Cargo.lock` as a transitive Tauri dependency
/// and is not importable (§0.1), and both CLIs write exactly this shape —
/// Codex `2026-08-10T04:45:59.358Z`, Claude `2026-08-10T05:06:00.351Z`.
/// Anything not ending in `Z` is refused rather than guessed at: silently
/// reading a `+07:00` stamp as UTC would move seven hours of usage onto the
/// wrong local day, which is the exact failure 15-minute buckets exist to
/// prevent. Fractions past three digits are truncated, not rounded.
fn parse_rfc3339_ms(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || !text.is_ascii() {
        return None;
    }
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return None;
    }
    let year = i64::from(digits(&bytes[0..4])?);
    let month = digits(&bytes[5..7])?;
    let day = digits(&bytes[8..10])?;
    let hour = digits(&bytes[11..13])?;
    let minute = digits(&bytes[14..16])?;
    let second = digits(&bytes[17..19])?;
    let millis = fraction_ms(&bytes[19..])?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let seconds = days_from_civil(year, month, day).checked_mul(86_400)?.checked_add(
        i64::from(hour) * 3_600 + i64::from(minute) * 60 + i64::from(second),
    )?;
    u64::try_from(seconds)
        .ok()?
        .checked_mul(1_000)?
        .checked_add(u64::from(millis))
}

/// An all-ASCII-digit run as a number. `None` on any other byte, so a stray
/// `+` or letter in a fixed field is a refusal rather than a silent zero.
fn digits(bytes: &[u8]) -> Option<u32> {
    let mut value: u32 = 0;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + u32::from(byte - b'0');
    }
    Some(value)
}

/// The `[.fraction]Z` tail as whole milliseconds.
fn fraction_ms(tail: &[u8]) -> Option<u32> {
    if tail == b"Z" {
        return Some(0);
    }
    if tail.first() != Some(&b'.') || tail.last() != Some(&b'Z') || tail.len() < 3 {
        return None;
    }
    let fraction = &tail[1..tail.len() - 1];
    if !fraction.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut millis: u32 = 0;
    for index in 0..3 {
        let digit = fraction
            .get(index)
            .map(|byte| u32::from(byte - b'0'))
            .unwrap_or(0);
        millis = millis * 10 + digit;
    }
    Some(millis)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Days between 1970-01-01 and the given civil date — Howard Hinnant's
/// `days_from_civil`, which is exact for the whole proleptic Gregorian
/// calendar and needs no table. March is treated as month 0 so the leap day
/// falls at the end of the year and the month-length series becomes the
/// closed form `(153 * m + 2) / 5`.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400; // [0, 399]
    let shifted_month = i64::from((month + 9) % 12); // March = 0
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1; // [0, 365]
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (14 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 7: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs` (created)
- `src-tauri/src/lib.rs` (one line: `mod usage;`)

---

### Task A2: Frozen payload types, cache record types and constants

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: A1's `parse_rfc3339_ms`.
- Produces:
  - The §0.2.2 payload types verbatim: `UsageCounters`, `UsageAgent`,
    `UsageSourceState`, `UsageSource`, `UsageBucket`, `UsageSnapshot`
  - Cache record types: `UsageCache`, `FileRecord`, `Contribution`, `CodexTotals`
  - Constants: `USAGE_CACHE_VERSION`, `USAGE_CACHE_FILE`, `BUCKET_MS`,
    `COMPACT_AFTER_MS`, `UNKNOWN_MODEL`, `DEDUPE_SEPARATOR`, `IDENTITY_HEAD_BYTES`,
    `CACHE_TEMP_SUFFIX`, the path fragments
  - `fn bucket_start(ms: u64) -> u64`, `fn add_counters(a, b) -> UsageCounters`,
    `fn now_ms() -> u64`, `fn mtime_ms(meta: &std::fs::Metadata) -> u64`

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    #[test]
    fn buckets_floor_to_fifteen_minute_utc_boundaries() {
        assert_eq!(bucket_start(1_786_337_159_358), 1_786_337_100_000);
        assert_eq!(bucket_start(1_786_338_360_351), 1_786_338_000_000);
        assert_eq!(bucket_start(1_786_320_000_000), 1_786_320_000_000);
        assert_eq!(bucket_start(0), 0);
        assert_eq!(BUCKET_MS, 15 * 60 * 1000);
    }

    #[test]
    fn counters_add_without_overflowing() {
        let left = UsageCounters {
            input_uncached: 1,
            cache_read: 2,
            cache_create_5m: 3,
            cache_create_1h: 4,
            cache_write: 5,
            output: 6,
        };
        let right = UsageCounters {
            input_uncached: 10,
            cache_read: 20,
            cache_create_5m: 30,
            cache_create_1h: 40,
            cache_write: 50,
            output: 60,
        };
        let sum = add_counters(left, right);
        assert_eq!(sum.input_uncached, 11);
        assert_eq!(sum.cache_read, 22);
        assert_eq!(sum.cache_create_5m, 33);
        assert_eq!(sum.cache_create_1h, 44);
        assert_eq!(sum.cache_write, 55);
        assert_eq!(sum.output, 66);

        let huge = UsageCounters {
            input_uncached: u64::MAX,
            ..UsageCounters::default()
        };
        assert_eq!(add_counters(huge, huge).input_uncached, u64::MAX);
    }

    #[test]
    fn the_frozen_constants_hold_their_frozen_values() {
        assert_eq!(USAGE_CACHE_VERSION, 1);
        assert_eq!(USAGE_CACHE_FILE, "usage-cache.json");
        assert_eq!(COMPACT_AFTER_MS, 48 * 60 * 60 * 1000);
    }

    /// The one thing that catches a serde rename drifting away from
    /// `src/lib/usage-snapshot.ts` (§0.2.3). Modelled on the contract test at
    /// `src-tauri/src/info.rs:320-340`. Fully populated on purpose: both
    /// sources, both states, a nonzero skipped count.
    #[test]
    fn serializes_the_snapshot_contract() {
        let snapshot = UsageSnapshot {
            scanned_at_ms: 1_786_338_360_351,
            buckets: vec![
                UsageBucket {
                    bucket_start_ms: 1_786_337_100_000,
                    agent: UsageAgent::Claude,
                    model: "claude-opus-5".into(),
                    counters: UsageCounters {
                        input_uncached: 2,
                        cache_read: 23_190,
                        cache_create_5m: 0,
                        cache_create_1h: 44_316,
                        cache_write: 0,
                        output: 116,
                    },
                },
                UsageBucket {
                    bucket_start_ms: 1_786_337_100_000,
                    agent: UsageAgent::Codex,
                    model: "gpt-5.6-sol".into(),
                    counters: UsageCounters {
                        input_uncached: 26_416,
                        cache_read: 6_912,
                        cache_create_5m: 0,
                        cache_create_1h: 0,
                        cache_write: 0,
                        output: 587,
                    },
                },
            ],
            sources: vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Ok,
                    files_scanned: 1_410,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
            ],
            skipped_lines: 7,
        };

        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            serde_json::json!({
                "scannedAtMs": 1_786_338_360_351u64,
                "buckets": [
                    {
                        "bucketStartMs": 1_786_337_100_000u64,
                        "agent": "claude",
                        "model": "claude-opus-5",
                        "counters": {
                            "inputUncached": 2,
                            "cacheRead": 23_190,
                            "cacheCreate5m": 0,
                            "cacheCreate1h": 44_316,
                            "cacheWrite": 0,
                            "output": 116,
                        },
                    },
                    {
                        "bucketStartMs": 1_786_337_100_000u64,
                        "agent": "codex",
                        "model": "gpt-5.6-sol",
                        "counters": {
                            "inputUncached": 26_416,
                            "cacheRead": 6_912,
                            "cacheCreate5m": 0,
                            "cacheCreate1h": 0,
                            "cacheWrite": 0,
                            "output": 587,
                        },
                    },
                ],
                "sources": [
                    { "agent": "claude", "state": "ok", "filesScanned": 1_410 },
                    { "agent": "codex", "state": "unreadable", "filesScanned": 0 },
                ],
                "skippedLines": 7,
            })
        );
    }

    #[test]
    fn a_cache_round_trips_through_json_with_camel_case_keys() {
        let mut entries = std::collections::BTreeMap::new();
        entries.insert(
            "msg_1\u{1}req_1".to_string(),
            Contribution {
                bucket_start_ms: 1_786_337_100_000,
                model: "claude-opus-5".into(),
                counters: UsageCounters {
                    output: 116,
                    ..UsageCounters::default()
                },
            },
        );
        let mut files = std::collections::BTreeMap::new();
        files.insert(
            "/tmp/a.jsonl".to_string(),
            FileRecord {
                entries,
                ..FileRecord::empty(UsageAgent::Claude, "sess-1".into(), 10, 20)
            },
        );
        let cache = UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        };

        let encoded = serde_json::to_vec(&cache).unwrap();
        let text = String::from_utf8(encoded.clone()).unwrap();
        assert!(text.contains("\"cacheVersion\":1"));
        assert!(text.contains("\"bucketStartMs\""));
        assert_eq!(
            serde_json::from_slice::<UsageCache>(&encoded).unwrap(),
            cache
        );
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'bucket_start' in this
scope`, `error[E0422]: cannot find struct, variant or union type
'UsageSnapshot' in this scope`, `error[E0425]: cannot find value 'BUCKET_MS' in
this scope`.

- [ ] **Step 3: Write the constants and the payload types**

Insert after the module doc comment, above `const MAX_LINE_BYTES`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Parser/schema version of the on-disk cache. A mismatch discards the cache
/// and forces a full rescan (spec, major M1) — bump it whenever a field's
/// meaning changes, not merely when one is added.
const USAGE_CACHE_VERSION: u32 = 1;

/// Cache file name, inside `app.path().app_data_dir()` beside the plugin
/// stores. Written temp-file-plus-rename, never truncate-in-place.
const USAGE_CACHE_FILE: &str = "usage-cache.json";

/// Suffix of the same-directory temp file the cache is written through.
const CACHE_TEMP_SUFFIX: &str = ".tmp";

/// Fifteen-minute UTC buckets. Not hourly: real-world offsets include :30 and
/// :45 (India, Nepal, Chatham), where an hourly bucket puts boundary-hour
/// usage on the wrong local day once the frontend re-buckets into local days.
const BUCKET_MS: u64 = 15 * 60 * 1000;

/// A file whose mtime is older than this loses its per-message contribution
/// map and keeps only its rolled-up counters (§0.3 decision 2). Age, not scan
/// count: with a 5 s poll a session merely paused for two minutes would
/// compact and then force a full re-read the moment the user typed again.
const COMPACT_AFTER_MS: u64 = 48 * 60 * 60 * 1000;

/// Separator inside the Claude dedupe key. `\u{1}` cannot occur in either id,
/// so `a\u{1}bc` and `ab\u{1}c` can never collide.
const DEDUPE_SEPARATOR: &str = "\u{1}";

/// Model string used when a transcript records usage without naming a model.
/// It stays raw and visible: the frontend prices only exact matches, so an
/// unpriced row shows tokens and a dash rather than a guessed dollar figure.
const UNKNOWN_MODEL: &str = "unknown";

/// Bytes read when resolving a file's session identity. Bounded because a
/// subagent transcript opens with a `type: "user"` line that can carry a
/// pasted blob — the same reason the line reader has a cap.
const IDENTITY_HEAD_BYTES: usize = 64 * 1024;

const CLAUDE_DIR: &str = ".claude";
const CLAUDE_PROJECTS_DIR: &str = "projects";
const CLAUDE_SUBAGENTS_DIR: &str = "subagents";
const CODEX_DIR: &str = ".codex";
const CODEX_SESSIONS_DIR: &str = "sessions";
const CODEX_ARCHIVED_DIR: &str = "archived_sessions";
const CODEX_ROLLOUT_PREFIX: &str = "rollout-";
const TRANSCRIPT_EXTENSION: &str = "jsonl";

/// Directory depth the Codex walk will descend. `sessions/YYYY/MM/DD/file` is
/// three levels; six bounds a pathological tree without a symlink loop being
/// able to run the scan forever.
const MAX_WALK_DEPTH: usize = 6;

const CLAUDE_ASSISTANT_TYPE: &str = "assistant";
const CLAUDE_TIER_5M: &str = "ephemeral_5m_input_tokens";
const CLAUDE_TIER_1H: &str = "ephemeral_1h_input_tokens";
const CODEX_TURN_CONTEXT_TYPE: &str = "turn_context";
const CODEX_EVENT_TYPE: &str = "event_msg";
const CODEX_TOKEN_COUNT_TYPE: &str = "token_count";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCounters {
    pub input_uncached: u64,
    pub cache_read: u64,
    pub cache_create_5m: u64,
    pub cache_create_1h: u64,
    pub cache_write: u64,
    pub output: u64,
}

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "lowercase")]
pub enum UsageAgent {
    Claude,
    Codex,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageSourceState {
    Ok,
    Missing,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSource {
    pub agent: UsageAgent,
    pub state: UsageSourceState,
    pub files_scanned: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// Unix ms at the start of the 15-minute UTC bucket.
    pub bucket_start_ms: u64,
    pub agent: UsageAgent,
    /// The raw model string, verbatim — no canonicalization in Rust.
    pub model: String,
    pub counters: UsageCounters,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    /// Unix ms when this scan finished.
    pub scanned_at_ms: u64,
    /// Sorted by (bucket_start_ms, agent, model) so the payload is stable.
    pub buckets: Vec<UsageBucket>,
    /// Exactly two entries, Claude then Codex.
    pub sources: Vec<UsageSource>,
    pub skipped_lines: u64,
}
```

- [ ] **Step 4: Write the cache record types and the shared helpers**

Insert after the payload types:

```rust
/// One `{bucket, model}` worth of counters. Used twice: as a Claude message's
/// individual contribution (keyed by its dedupe key) and as an entry in a
/// file's rolled-up totals.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contribution {
    bucket_start_ms: u64,
    model: String,
    counters: UsageCounters,
}

/// The last cumulative totals seen in a Codex rollout, so delta ingestion
/// resumes from the stored numbers instead of re-deriving them from the top of
/// the file.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexTotals {
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
}

/// Everything the cache remembers about one transcript file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileRecord {
    agent: UsageAgent,
    /// Session identity read from the first line. A file whose identity
    /// changed is a different session at the same path, so it is rescanned
    /// from zero even when its size did not move.
    identity: String,
    mtime_ms: u64,
    size: u64,
    /// Byte offset just past the last complete line ingested.
    offset: u64,
    /// Cumulative for this file across scans, so the number the UI shows does
    /// not flicker on a poll that read nothing.
    #[serde(default)]
    skipped_lines: u64,
    /// Set once the file aged past `COMPACT_AFTER_MS`: `entries` was rolled
    /// into `totals` and dropped.
    #[serde(default)]
    compacted: bool,
    /// Claude only, and only while uncompacted: dedupe key → contribution.
    /// Last-wins survives an offset resume because a re-seen key REPLACES its
    /// previous contribution instead of adding a second one (spec, blocker B2).
    #[serde(default)]
    entries: BTreeMap<String, Contribution>,
    /// Codex's accumulated per-`{bucket, model}` deltas, and where a compacted
    /// file's roll-up lives for either agent.
    #[serde(default)]
    totals: Vec<Contribution>,
    /// Codex only: the model from the most recent `turn_context` line. Stored
    /// because that line is usually behind the resume offset.
    #[serde(default)]
    last_model: Option<String>,
    /// Codex only: the high-water cumulative totals seen so far.
    #[serde(default)]
    cumulative: Option<CodexTotals>,
}

impl FileRecord {
    fn empty(agent: UsageAgent, identity: String, mtime_ms: u64, size: u64) -> Self {
        Self {
            agent,
            identity,
            mtime_ms,
            size,
            offset: 0,
            skipped_lines: 0,
            compacted: false,
            entries: BTreeMap::new(),
            totals: Vec::new(),
            last_model: None,
            cumulative: None,
        }
    }
}

/// The whole cache. Keyed by path string so the map is ordered, which makes
/// both the serialized bytes and the cross-file merge deterministic.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageCache {
    cache_version: u32,
    files: BTreeMap<String, FileRecord>,
}

impl Default for UsageCache {
    /// A fresh cache is stamped with the CURRENT version, never zero — a
    /// default that claimed version 0 would be discarded by its own loader.
    fn default() -> Self {
        Self {
            cache_version: USAGE_CACHE_VERSION,
            files: BTreeMap::new(),
        }
    }
}

fn bucket_start(unix_ms: u64) -> u64 {
    unix_ms - unix_ms % BUCKET_MS
}

/// Saturating throughout: a corrupt transcript claiming `u64::MAX` tokens must
/// degrade to a wrong-but-finite number, never panic a release build's
/// neighbour in debug.
fn add_counters(left: UsageCounters, right: UsageCounters) -> UsageCounters {
    UsageCounters {
        input_uncached: left.input_uncached.saturating_add(right.input_uncached),
        cache_read: left.cache_read.saturating_add(right.cache_read),
        cache_create_5m: left.cache_create_5m.saturating_add(right.cache_create_5m),
        cache_create_1h: left.cache_create_1h.saturating_add(right.cache_create_1h),
        cache_write: left.cache_write.saturating_add(right.cache_write),
        output: left.output.saturating_add(right.output),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// A file's modification time in Unix ms. An unreadable or pre-epoch mtime
/// reads as 0, which makes the file look permanently stale — it is compacted
/// and never resumed, which is the safe direction.
fn mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (19 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 6: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A3: Claude line ingestion

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: A1's `parse_rfc3339_ms`, A2's types, constants, `bucket_start`, `add_counters`.
- Produces:
  - `enum LineOutcome { Counted, Ignored, Skipped }`
  - `fn ingest_claude_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome`
  - `fn claude_cache_creation(usage: &serde_json::Value) -> (u64, u64)`
  - `fn u64_field(node: &serde_json::Value, key: &str) -> u64`
  - `fn add_total(totals: &mut Vec<Contribution>, bucket_start_ms: u64, model: &str, counters: UsageCounters)`
  - `fn sort_totals(totals: &mut [Contribution])`

**What counts as a skipped line.** Exactly three cases, and no more: an
oversized line (A1), a line `serde_json` cannot parse, and a line of the right
shape whose usage cannot be attributed (unparseable timestamp, or no
`message.id` _and_ no `requestId`). A well-formed line that simply is not a
usage line — a user turn, a tool result, a blank line — is `Ignored` and never
counted. Counting those would put five-figure numbers behind the UI's "n lines
skipped" note on a perfectly healthy corpus.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    fn claude_record() -> FileRecord {
        FileRecord::empty(UsageAgent::Claude, "sess-1".into(), 0, 0)
    }

    /// One assistant line in the exact shape verified on disk 2026-08-10,
    /// including the `iterations` array that must NOT be summed (§0.4
    /// erratum 4) and the `server_tool_use` / `service_tier` noise.
    fn claude_line(
        message_id: &str,
        request_id: &str,
        timestamp: &str,
        output: u64,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": timestamp,
            "requestId": request_id,
            "sessionId": "sess-1",
            "message": {
                "id": message_id,
                "role": "assistant",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_creation_input_tokens": 44_316,
                    "cache_read_input_tokens": 23_190,
                    "output_tokens": output,
                    "service_tier": "standard",
                    "server_tool_use": { "web_search_requests": 0 },
                    "cache_creation": {
                        "ephemeral_1h_input_tokens": 44_316,
                        "ephemeral_5m_input_tokens": 0,
                    },
                    "iterations": [
                        {
                            "input_tokens": 2,
                            "cache_read_input_tokens": 23_190,
                            "output_tokens": output,
                        },
                    ],
                },
            },
        }))
        .unwrap()
    }

    #[test]
    fn claude_dedupe_keeps_the_last_of_several_growing_snapshots() {
        let mut record = claude_record();
        // Streaming writes the same response three times, each larger.
        for output in [10u64, 60, 116] {
            assert!(matches!(
                ingest_claude_line(
                    &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", output),
                    &mut record
                ),
                LineOutcome::Counted
            ));
        }
        assert_eq!(record.entries.len(), 1);
        let contribution = record.entries.get("msg_1\u{1}req_1").unwrap();
        // Last wins: summing would give 186, keeping the first would give 10.
        assert_eq!(contribution.counters.output, 116);
        assert_eq!(contribution.bucket_start_ms, 1_786_338_000_000);
        assert_eq!(contribution.model, "claude-opus-5");
    }

    #[test]
    fn claude_keys_on_both_the_message_id_and_the_request_id() {
        let mut record = claude_record();
        ingest_claude_line(
            &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 1),
            &mut record,
        );
        // Same message id, different request: a retried request is separate work.
        ingest_claude_line(
            &claude_line("msg_1", "req_2", "2026-08-10T05:06:00.351Z", 2),
            &mut record,
        );
        assert_eq!(record.entries.len(), 2);
        // 3 of 6941 real assistant lines carry no requestId; the id alone
        // still keys them, it does not skip them.
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "message": {
                "id": "msg_3",
                "model": "<synthetic>",
                "usage": { "input_tokens": 5, "output_tokens": 6 },
            },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&line, &mut record),
            LineOutcome::Counted
        ));
        assert_eq!(record.entries.get("msg_3\u{1}").unwrap().model, "<synthetic>");
    }

    #[test]
    fn claude_reads_the_five_minute_and_one_hour_cache_tiers_separately() {
        let mut record = claude_record();
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "requestId": "req_1",
            "message": {
                "id": "msg_1",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_read_input_tokens": 23_190,
                    "cache_creation_input_tokens": 44_316,
                    "output_tokens": 116,
                    "cache_creation": {
                        "ephemeral_5m_input_tokens": 300,
                        "ephemeral_1h_input_tokens": 44_016,
                    },
                },
            },
        }))
        .unwrap();
        ingest_claude_line(&line, &mut record);
        let counters = record.entries.values().next().unwrap().counters;
        assert_eq!(counters.input_uncached, 2);
        assert_eq!(counters.cache_read, 23_190);
        assert_eq!(counters.cache_create_5m, 300);
        assert_eq!(counters.cache_create_1h, 44_016);
        // The flat total is ignored once the split is present; adding both
        // would double-count the whole cache write.
        assert_eq!(
            counters.cache_create_5m + counters.cache_create_1h,
            44_316
        );
        assert_eq!(counters.cache_write, 0);
        assert_eq!(counters.output, 116);
    }

    #[test]
    fn claude_falls_back_to_the_five_minute_tier_when_the_split_is_absent() {
        let mut record = claude_record();
        let line = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "requestId": "req_1",
            "message": {
                "id": "msg_1",
                "model": "claude-opus-5",
                "usage": {
                    "input_tokens": 2,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 44_316,
                    "output_tokens": 116,
                },
            },
        }))
        .unwrap();
        ingest_claude_line(&line, &mut record);
        let counters = record.entries.values().next().unwrap().counters;
        assert_eq!(counters.cache_create_5m, 44_316);
        assert_eq!(counters.cache_create_1h, 0);
    }

    #[test]
    fn claude_ignores_the_iterations_array_entirely() {
        let mut record = claude_record();
        ingest_claude_line(
            &claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116),
            &mut record,
        );
        let counters = record.entries.values().next().unwrap().counters;
        // The fixture's single iteration repeats every counter. Summing it in
        // would double input, cache_read and output.
        assert_eq!(counters.input_uncached, 2);
        assert_eq!(counters.cache_read, 23_190);
        assert_eq!(counters.output, 116);
    }

    #[test]
    fn claude_skips_only_what_it_cannot_attribute() {
        let mut record = claude_record();
        assert!(matches!(
            ingest_claude_line(b"{ not json", &mut record),
            LineOutcome::Skipped
        ));
        // Right shape, unparseable timestamp.
        let bad_time = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "yesterday",
            "requestId": "req_1",
            "message": { "id": "msg_1", "usage": { "output_tokens": 1 } },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&bad_time, &mut record),
            LineOutcome::Skipped
        ));
        // Right shape, no ids at all: one key would swallow every such line.
        let no_ids = serde_json::to_vec(&serde_json::json!({
            "type": "assistant",
            "timestamp": "2026-08-10T05:06:00.351Z",
            "message": { "usage": { "output_tokens": 1 } },
        }))
        .unwrap();
        assert!(matches!(
            ingest_claude_line(&no_ids, &mut record),
            LineOutcome::Skipped
        ));
        assert!(record.entries.is_empty());
    }

    #[test]
    fn claude_ignores_lines_that_are_simply_not_usage() {
        let mut record = claude_record();
        for line in [
            serde_json::to_vec(&serde_json::json!({
                "type": "user", "sessionId": "sess-1"
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({
                "type": "last-prompt", "sessionId": "sess-1", "leafUuid": "u"
            }))
            .unwrap(),
            // An assistant line from a version that carried no usage block.
            serde_json::to_vec(&serde_json::json!({
                "type": "assistant",
                "timestamp": "2026-08-10T05:06:00.351Z",
                "message": { "id": "msg_1", "role": "assistant" },
            }))
            .unwrap(),
        ] {
            assert!(matches!(
                ingest_claude_line(&line, &mut record),
                LineOutcome::Ignored
            ));
        }
        assert!(record.entries.is_empty());
    }

    #[test]
    fn totals_accumulate_per_bucket_and_model_and_sort_stably() {
        let mut totals: Vec<Contribution> = Vec::new();
        let one = UsageCounters {
            output: 1,
            ..UsageCounters::default()
        };
        add_total(&mut totals, 2_000, "b", one);
        add_total(&mut totals, 1_000, "a", one);
        add_total(&mut totals, 1_000, "a", one);
        add_total(&mut totals, 1_000, "b", one);
        sort_totals(&mut totals);
        assert_eq!(totals.len(), 3);
        assert_eq!((totals[0].bucket_start_ms, totals[0].model.as_str()), (1_000, "a"));
        assert_eq!(totals[0].counters.output, 2);
        assert_eq!((totals[1].bucket_start_ms, totals[1].model.as_str()), (1_000, "b"));
        assert_eq!((totals[2].bucket_start_ms, totals[2].model.as_str()), (2_000, "b"));
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'ingest_claude_line' in
this scope`, `error[E0433]: failed to resolve: use of undeclared type
'LineOutcome'`, `error[E0425]: cannot find function 'add_total' in this scope`.

- [ ] **Step 3: Write the Claude ingestion**

Insert after the shared helpers from Task A2:

```rust
/// What one parsed line did to a file record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LineOutcome {
    /// Usage was recorded.
    Counted,
    /// A well-formed line that carries no usage. Not an error, not counted.
    Ignored,
    /// Unparseable, or usage that cannot be attributed. Counted for the UI.
    Skipped,
}

/// A numeric field, defaulting to zero. Missing counters are genuinely zero in
/// both formats — an absent `cache_write_input_tokens` means none were written.
fn u64_field(node: &serde_json::Value, key: &str) -> u64 {
    node.get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}

/// Add `counters` into the `{bucket, model}` slot, creating it if new.
///
/// A linear scan on purpose: one file holds a handful of buckets per hour of
/// work, and a map here would have to be re-sorted into a `Vec` for the cache
/// anyway.
fn add_total(
    totals: &mut Vec<Contribution>,
    bucket_start_ms: u64,
    model: &str,
    counters: UsageCounters,
) {
    if let Some(slot) = totals
        .iter_mut()
        .find(|entry| entry.bucket_start_ms == bucket_start_ms && entry.model == model)
    {
        slot.counters = add_counters(slot.counters, counters);
        return;
    }
    totals.push(Contribution {
        bucket_start_ms,
        model: model.to_string(),
        counters,
    });
}

/// Deterministic order, so the serialized cache does not churn between scans
/// that produced identical numbers.
fn sort_totals(totals: &mut [Contribution]) {
    totals.sort_by(|left, right| {
        left.bucket_start_ms
            .cmp(&right.bucket_start_ms)
            .then_with(|| left.model.cmp(&right.model))
    });
}

/// The cache-creation tier split, with ccusage's documented fallback.
///
/// When `cache_creation` is present it is authoritative and the flat
/// `cache_creation_input_tokens` is ignored — adding both would double-count
/// every cache write. When it is absent, everything falls into the 5-minute
/// tier, which is the cheaper of the two and therefore the conservative guess.
fn claude_cache_creation(usage: &serde_json::Value) -> (u64, u64) {
    if let Some(split) = usage.get("cache_creation") {
        if split.get(CLAUDE_TIER_5M).is_some() || split.get(CLAUDE_TIER_1H).is_some() {
            return (
                u64_field(split, CLAUDE_TIER_5M),
                u64_field(split, CLAUDE_TIER_1H),
            );
        }
    }
    (u64_field(usage, "cache_creation_input_tokens"), 0)
}

/// One line of a Claude Code transcript.
///
/// Only the top-level counters of `message.usage` are read. `usage.iterations`
/// repeats the same counters once per inference iteration (§0.4 erratum 4);
/// summing it would roughly double every number on multi-iteration turns.
fn ingest_claude_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return LineOutcome::Skipped;
    };
    if value.get("type").and_then(serde_json::Value::as_str) != Some(CLAUDE_ASSISTANT_TYPE) {
        return LineOutcome::Ignored;
    }
    let Some(usage) = value.get("message").and_then(|message| message.get("usage")) else {
        return LineOutcome::Ignored;
    };
    let message = value.get("message").expect("checked just above");
    let Some(bucket_start_ms) = value
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_rfc3339_ms)
        .map(bucket_start)
    else {
        return LineOutcome::Skipped;
    };
    let message_id = message
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let request_id = value
        .get("requestId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if message_id.is_empty() && request_id.is_empty() {
        // With neither id every such line collapses onto one key and the last
        // write silently discards all the others.
        return LineOutcome::Skipped;
    }
    let model = message
        .get("model")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(UNKNOWN_MODEL)
        .to_string();
    let (cache_create_5m, cache_create_1h) = claude_cache_creation(usage);
    let counters = UsageCounters {
        input_uncached: u64_field(usage, "input_tokens"),
        cache_read: u64_field(usage, "cache_read_input_tokens"),
        cache_create_5m,
        cache_create_1h,
        // Claude has no equivalent of Codex's separate cache-write counter.
        cache_write: 0,
        output: u64_field(usage, "output_tokens"),
    };
    // Last entry wins: streaming writes several growing snapshots of the same
    // response, so a re-seen key REPLACES its contribution rather than adding a
    // second one (spec, blocker B2). Summing overcounts roughly 2x.
    record.entries.insert(
        format!("{message_id}{DEDUPE_SEPARATOR}{request_id}"),
        Contribution {
            bucket_start_ms,
            model,
            counters,
        },
    );
    LineOutcome::Counted
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (27 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 5: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A4: Codex line ingestion

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: A2's types and constants, A3's `LineOutcome`, `u64_field`, `add_total`.
- Produces:
  - `fn ingest_codex_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome`
  - `fn ingest(agent: UsageAgent, bytes: &[u8], record: &mut FileRecord) -> LineOutcome`

**The two rules that are easy to get wrong.** First, the cumulative totals are
at **`payload.info.total_token_usage`**, one level deeper than the spec text
implies (§0.4 erratum 1) — a parser written from the spec finds nothing and
reports zero Codex usage while looking perfectly healthy. Second, the stored
previous total is a **high-water mark**, not the last value seen: with
last-seen, a session whose totals go 100 → 50 → 120 contributes 100 then 70,
inventing 70 tokens out of a replayed number. With a high-water mark it
contributes 100 then 20, which is what "a non-advancing or regressing total
contributes nothing" actually means.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    fn codex_record() -> FileRecord {
        FileRecord::empty(UsageAgent::Codex, "019fe9fd".into(), 0, 0)
    }

    fn turn_context(timestamp: &str, model: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "timestamp": timestamp,
            "type": "turn_context",
            "payload": { "model": model, "cwd": "/tmp", "effort": "high" },
        }))
        .unwrap()
    }

    /// The exact envelope observed in
    /// `rollout-2026-08-10T11-45-40-019fe9fd-9d9e-7b30-be60-3ac6783e56f0.jsonl`:
    /// totals nested under `payload.info`, with `rate_limits` alongside.
    fn token_count(
        timestamp: &str,
        input: u64,
        cached: u64,
        cache_write: u64,
        output: u64,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": input,
                        "cached_input_tokens": cached,
                        "cache_write_input_tokens": cache_write,
                        "output_tokens": output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": input + output,
                    },
                    "model_context_window": 258_400,
                },
                "rate_limits": { "limit_id": "codex" },
            },
        }))
        .unwrap()
    }

    #[test]
    fn codex_reads_the_cumulative_totals_from_payload_info() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"), &mut record);
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:45:59.358Z", 33_328, 6_912, 0, 587),
                &mut record
            ),
            LineOutcome::Counted
        ));
        assert_eq!(record.totals.len(), 1);
        let entry = &record.totals[0];
        assert_eq!(entry.bucket_start_ms, 1_786_337_100_000);
        assert_eq!(entry.model, "gpt-5.6-sol");
        // cached_input_tokens is a SUBSET of input_tokens (spec, blocker B4).
        assert_eq!(entry.counters.input_uncached, 33_328 - 6_912);
        assert_eq!(entry.counters.cache_read, 6_912);
        assert_eq!(entry.counters.cache_write, 0);
        assert_eq!(entry.counters.output, 587);
        assert_eq!(entry.counters.cache_create_5m, 0);
        assert_eq!(entry.counters.cache_create_1h, 0);
    }

    /// §0.4 erratum 2: `payload.info.last_token_usage` exists and equals the
    /// per-event delta. It is never the ingestion path — it does not survive an
    /// offset resume — but it is a free oracle for the delta arithmetic.
    #[test]
    fn codex_deltas_agree_with_the_observed_last_token_usage() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"), &mut record);
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 33_328, 6_912, 0, 587),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 74_619, 39_424, 0, 1_226),
            &mut record,
        );
        // Real file, event 2: last_token_usage = input 41291, cached 32512,
        // cache_write 0, output 639.
        assert_eq!(record.totals.len(), 1);
        let counters = record.totals[0].counters;
        assert_eq!(counters.cache_read, 6_912 + 32_512);
        assert_eq!(counters.input_uncached, (33_328 - 6_912) + (41_291 - 32_512));
        assert_eq!(counters.output, 587 + 639);
    }

    #[test]
    fn codex_attributes_deltas_to_the_model_in_effect_at_the_time() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"), &mut record);
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100),
            &mut record,
        );
        ingest_codex_line(&turn_context("2026-08-10T04:46:00.000Z", "gpt-5.6-mini"), &mut record);
        ingest_codex_line(
            &token_count("2026-08-10T04:46:13.066Z", 1_500, 0, 0, 160),
            &mut record,
        );
        sort_totals(&mut record.totals);
        assert_eq!(record.totals.len(), 2);
        // Same 15-minute bucket, two models, split by the turn_context switch.
        assert_eq!(record.totals[0].model, "gpt-5.6-mini");
        assert_eq!(record.totals[0].counters.input_uncached, 500);
        assert_eq!(record.totals[0].counters.output, 60);
        assert_eq!(record.totals[1].model, "gpt-5.6-sol");
        assert_eq!(record.totals[1].counters.input_uncached, 1_000);
        assert_eq!(record.totals[1].counters.output, 100);
    }

    #[test]
    fn codex_splits_one_session_across_a_utc_day_boundary() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T23:00:00.000Z", "gpt-5.6-sol"), &mut record);
        ingest_codex_line(
            &token_count("2026-08-10T23:59:59.999Z", 1_000, 0, 0, 10),
            &mut record,
        );
        ingest_codex_line(
            &token_count("2026-08-11T00:00:00.000Z", 3_000, 0, 0, 30),
            &mut record,
        );
        sort_totals(&mut record.totals);
        assert_eq!(record.totals.len(), 2);
        assert_eq!(record.totals[0].bucket_start_ms, 1_786_405_500_000);
        assert_eq!(record.totals[0].counters.input_uncached, 1_000);
        assert_eq!(record.totals[1].bucket_start_ms, 1_786_406_400_000);
        assert_eq!(record.totals[1].counters.input_uncached, 2_000);
    }

    #[test]
    fn codex_never_lowers_its_high_water_mark() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"), &mut record);
        // 100 -> 50 -> 120 must contribute 100 then nothing then 20.
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 0),
            &mut record,
        );
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:46:13.066Z", 50, 0, 0, 0),
                &mut record
            ),
            LineOutcome::Ignored
        ));
        ingest_codex_line(
            &token_count("2026-08-10T04:46:25.314Z", 120, 0, 0, 0),
            &mut record,
        );
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.input_uncached, 120);
        assert_eq!(
            record.cumulative.unwrap().input_tokens,
            120,
            "the stored total is the high-water mark, not the last value seen"
        );
    }

    #[test]
    fn codex_ignores_a_repeated_identical_total() {
        let mut record = codex_record();
        ingest_codex_line(&turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol"), &mut record);
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 10),
            &mut record,
        );
        assert!(matches!(
            ingest_codex_line(
                &token_count("2026-08-10T04:46:13.066Z", 100, 0, 0, 10),
                &mut record
            ),
            LineOutcome::Ignored
        ));
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 10);
    }

    #[test]
    fn codex_attributes_to_the_unknown_model_before_any_turn_context() {
        let mut record = codex_record();
        ingest_codex_line(
            &token_count("2026-08-10T04:45:59.358Z", 100, 0, 0, 10),
            &mut record,
        );
        assert_eq!(record.totals[0].model, UNKNOWN_MODEL);
    }

    #[test]
    fn codex_skips_a_token_count_it_cannot_read() {
        let mut record = codex_record();
        assert!(matches!(
            ingest_codex_line(b"{ not json", &mut record),
            LineOutcome::Skipped
        ));
        let no_info = serde_json::to_vec(&serde_json::json!({
            "timestamp": "2026-08-10T04:45:59.358Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "rate_limits": {} },
        }))
        .unwrap();
        assert!(matches!(
            ingest_codex_line(&no_info, &mut record),
            LineOutcome::Skipped
        ));
        // The spec's shallow path must NOT be read (§0.4 erratum 1).
        let shallow = serde_json::to_vec(&serde_json::json!({
            "timestamp": "2026-08-10T04:45:59.358Z",
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "total_token_usage": { "input_tokens": 999 },
            },
        }))
        .unwrap();
        assert!(matches!(
            ingest_codex_line(&shallow, &mut record),
            LineOutcome::Skipped
        ));
        assert!(record.totals.is_empty());
    }

    #[test]
    fn codex_ignores_the_events_that_are_not_token_counts() {
        let mut record = codex_record();
        for line in [
            serde_json::to_vec(&serde_json::json!({
                "timestamp": "2026-08-10T04:45:41.202Z",
                "type": "session_meta",
                "payload": { "id": "019fe9fd", "session_id": "019fe9fd" },
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({
                "timestamp": "2026-08-10T04:45:50.000Z",
                "type": "event_msg",
                "payload": { "type": "agent_message", "message": "hi" },
            }))
            .unwrap(),
            serde_json::to_vec(&serde_json::json!({ "type": "response_item" })).unwrap(),
        ] {
            assert!(matches!(
                ingest_codex_line(&line, &mut record),
                LineOutcome::Ignored
            ));
        }
        assert!(record.totals.is_empty());
    }

    #[test]
    fn a_blank_line_is_ignored_by_either_agent() {
        let mut claude = claude_record();
        let mut codex = codex_record();
        for bytes in [b"".as_slice(), b"   ", b"\t"] {
            assert!(matches!(
                ingest(UsageAgent::Claude, bytes, &mut claude),
                LineOutcome::Ignored
            ));
            assert!(matches!(
                ingest(UsageAgent::Codex, bytes, &mut codex),
                LineOutcome::Ignored
            ));
        }
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'ingest_codex_line' in
this scope`, `error[E0425]: cannot find function 'ingest' in this scope`.

- [ ] **Step 3: Write the Codex ingestion and the dispatcher**

Insert after `ingest_claude_line`:

```rust
/// One line of a Codex rollout.
///
/// `token_count` events carry **cumulative** totals for the whole session, so
/// each one contributes `max(0, cumulative - previous)` per counter, attributed
/// to the event's own timestamp and to the model from the most recent
/// `turn_context`. Last-snapshot ingestion is wrong here: real sessions carry
/// hundreds of snapshots, span multiple UTC days and switch models mid-session
/// (spec, blocker B1).
fn ingest_codex_line(bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return LineOutcome::Skipped;
    };
    let kind = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let Some(payload) = value.get("payload") else {
        return LineOutcome::Ignored;
    };
    if kind == CODEX_TURN_CONTEXT_TYPE {
        if let Some(model) = payload.get("model").and_then(serde_json::Value::as_str) {
            record.last_model = Some(model.to_string());
        }
        return LineOutcome::Ignored;
    }
    if kind != CODEX_EVENT_TYPE
        || payload.get("type").and_then(serde_json::Value::as_str) != Some(CODEX_TOKEN_COUNT_TYPE)
    {
        return LineOutcome::Ignored;
    }
    // §0.4 erratum 1: `payload.info.total_token_usage`, NOT
    // `payload.total_token_usage`. Reading the shallow path finds nothing and
    // reports zero Codex usage while looking perfectly healthy.
    let Some(totals) = payload
        .get("info")
        .and_then(|info| info.get("total_token_usage"))
    else {
        return LineOutcome::Skipped;
    };
    let Some(bucket_start_ms) = value
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .and_then(parse_rfc3339_ms)
        .map(bucket_start)
    else {
        return LineOutcome::Skipped;
    };
    let seen = CodexTotals {
        input_tokens: u64_field(totals, "input_tokens"),
        cached_input_tokens: u64_field(totals, "cached_input_tokens"),
        cache_write_input_tokens: u64_field(totals, "cache_write_input_tokens"),
        output_tokens: u64_field(totals, "output_tokens"),
    };
    let previous = record.cumulative.unwrap_or_default();
    let delta = CodexTotals {
        input_tokens: seen.input_tokens.saturating_sub(previous.input_tokens),
        cached_input_tokens: seen
            .cached_input_tokens
            .saturating_sub(previous.cached_input_tokens),
        cache_write_input_tokens: seen
            .cache_write_input_tokens
            .saturating_sub(previous.cache_write_input_tokens),
        output_tokens: seen.output_tokens.saturating_sub(previous.output_tokens),
    };
    // High-water mark, not last-seen. A resumed or forked session replays
    // inherited totals; storing the lower number would turn the later climb
    // back to the old high into tokens nobody spent.
    record.cumulative = Some(CodexTotals {
        input_tokens: previous.input_tokens.max(seen.input_tokens),
        cached_input_tokens: previous.cached_input_tokens.max(seen.cached_input_tokens),
        cache_write_input_tokens: previous
            .cache_write_input_tokens
            .max(seen.cache_write_input_tokens),
        output_tokens: previous.output_tokens.max(seen.output_tokens),
    });
    let counters = UsageCounters {
        // `cached_input_tokens` is a SUBSET of `input_tokens` (spec, blocker
        // B4), so the uncached part is the difference, never the whole input.
        input_uncached: delta
            .input_tokens
            .saturating_sub(delta.cached_input_tokens),
        cache_read: delta.cached_input_tokens,
        // Codex has no 5m/1h tier split; its cache writes are one counter.
        cache_create_5m: 0,
        cache_create_1h: 0,
        cache_write: delta.cache_write_input_tokens,
        // Already includes reasoning tokens; adding
        // `reasoning_output_tokens` would double-count them.
        output: delta.output_tokens,
    };
    if counters == UsageCounters::default() {
        // A non-advancing or regressing total contributes nothing.
        return LineOutcome::Ignored;
    }
    let model = record
        .last_model
        .clone()
        .unwrap_or_else(|| UNKNOWN_MODEL.to_string());
    add_total(&mut record.totals, bucket_start_ms, &model, counters);
    LineOutcome::Counted
}

/// Route one line to its agent's parser.
///
/// A blank line is ignored before either parser sees it: a trailing newline at
/// the end of every transcript must not inflate the "n lines skipped" note the
/// UI shows.
fn ingest(agent: UsageAgent, bytes: &[u8], record: &mut FileRecord) -> LineOutcome {
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return LineOutcome::Ignored;
    }
    match agent {
        UsageAgent::Claude => ingest_claude_line(bytes, record),
        UsageAgent::Codex => ingest_codex_line(bytes, record),
    }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (37 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 5: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A5: The cache file — load, version discard, atomic write

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: A2's `UsageCache`, `USAGE_CACHE_VERSION`, `CACHE_TEMP_SUFFIX`.
- Produces:
  - `fn load_cache(path: Option<&Path>) -> UsageCache`
  - `fn write_cache(path: &Path, cache: &UsageCache) -> std::io::Result<()>`
  - Test helper `fn fixture(name: &str) -> PathBuf`, reused by A6 and A7.

**Why temp file plus rename.** This repo has no atomic writer yet — this is the
first one. A truncate-in-place write that is interrupted leaves a JSON file
that parses as garbage, and the loader would then discard a cache describing
2.5 GB of already-scanned transcripts, turning the next open of the screen into
a full cold scan. `std::fs::rename` replaces an existing destination on both
macOS and Windows (`MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`), so the
reader either sees the whole old file or the whole new one.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    /// A throwaway tree under the OS temp dir. No `tempfile` dev-dependency:
    /// this feature ships zero new crates, test-only included. Same shape as
    /// `prompt_assets.rs:512-517`, with the process id so two `cargo test`
    /// runs cannot collide.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("deck-usage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_cache() -> UsageCache {
        let mut files = BTreeMap::new();
        files.insert(
            "/tmp/a.jsonl".to_string(),
            FileRecord::empty(UsageAgent::Codex, "019fe9fd".into(), 1_000, 2_000),
        );
        UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        }
    }

    #[test]
    fn writes_the_cache_through_a_temp_file_and_leaves_none_behind() {
        let dir = fixture("cache-write");
        let path = dir.join(USAGE_CACHE_FILE);
        write_cache(&path, &sample_cache()).unwrap();

        assert_eq!(load_cache(Some(&path)), sample_cache());
        let temp = dir.join(format!("{USAGE_CACHE_FILE}{CACHE_TEMP_SUFFIX}"));
        assert!(!temp.exists(), "the temp file must not survive the rename");

        // A second write replaces the first rather than failing on an
        // existing destination.
        let mut grown = sample_cache();
        grown.files.insert(
            "/tmp/b.jsonl".to_string(),
            FileRecord::empty(UsageAgent::Claude, "sess-2".into(), 3, 4),
        );
        write_cache(&path, &grown).unwrap();
        assert_eq!(load_cache(Some(&path)), grown);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_the_cache_directory_when_it_does_not_exist_yet() {
        let dir = fixture("cache-mkdir");
        let path = dir.join("nested").join("deeper").join(USAGE_CACHE_FILE);
        write_cache(&path, &sample_cache()).unwrap();
        assert!(path.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discards_a_cache_written_by_another_parser_version() {
        let dir = fixture("cache-version");
        let path = dir.join(USAGE_CACHE_FILE);
        let stale = UsageCache {
            cache_version: USAGE_CACHE_VERSION + 1,
            ..sample_cache()
        };
        std::fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();

        let loaded = load_cache(Some(&path));
        assert!(loaded.files.is_empty(), "a version mismatch forces a full rescan");
        assert_eq!(loaded.cache_version, USAGE_CACHE_VERSION);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn discards_unparseable_or_missing_cache_bytes() {
        let dir = fixture("cache-garbage");
        let path = dir.join(USAGE_CACHE_FILE);
        std::fs::write(&path, b"{ half a file").unwrap();
        assert_eq!(load_cache(Some(&path)), UsageCache::default());
        assert_eq!(
            load_cache(Some(&dir.join("nothing-here.json"))),
            UsageCache::default()
        );
        assert_eq!(load_cache(None), UsageCache::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'write_cache' in this
scope`, `error[E0425]: cannot find function 'load_cache' in this scope`.

- [ ] **Step 3: Write the cache IO**

Insert after `ingest`:

```rust
/// The cache from disk, or an empty one.
///
/// Every failure path — no path, unreadable file, unparseable JSON, a version
/// this build does not understand — returns an empty cache, which makes the
/// next scan a full rescan. That is slow exactly once and always correct;
/// half-trusting a cache this build cannot interpret is neither.
fn load_cache(path: Option<&Path>) -> UsageCache {
    let Some(path) = path else {
        return UsageCache::default();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return UsageCache::default();
    };
    let Ok(cache) = serde_json::from_slice::<UsageCache>(&bytes) else {
        return UsageCache::default();
    };
    if cache.cache_version != USAGE_CACHE_VERSION {
        return UsageCache::default();
    }
    cache
}

/// Write the cache atomically: same-directory temp file, then rename.
///
/// The rename is what makes it atomic — a same-filesystem rename either
/// happens or does not, so a reader never sees a half-written cache. Writing
/// in place would leave unparseable JSON behind on a crash, and the loader
/// would then throw away a cache describing gigabytes of already-scanned
/// transcripts.
fn write_cache(path: &Path, cache: &UsageCache) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(cache).map_err(std::io::Error::other)?;
    let mut temp = path.as_os_str().to_os_string();
    temp.push(CACHE_TEMP_SUFFIX);
    let temp = PathBuf::from(temp);
    std::fs::write(&temp, &bytes)?;
    if let Err(error) = std::fs::rename(&temp, path) {
        // Never leave the temp file behind: it would be mistaken for a cache
        // by nothing, but it would grow one stale copy per failed write.
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (41 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 5: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A6: Discovery and session identity

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: A2's path constants and `mtime_ms`, A5's `fixture` helper.
- Produces:
  - `enum DiscoveryState { Missing, Unreadable, Present }`
  - `struct Discovery { files: Vec<PathBuf>, state: DiscoveryState }`
  - `struct CodexDiscovery { active: Vec<PathBuf>, archived: Vec<PathBuf>, state: DiscoveryState }`
  - `fn discover_claude(home: &Path) -> Discovery`
  - `fn discover_codex(home: &Path) -> CodexDiscovery`
  - `fn file_identity(path: &Path) -> Option<String>`
  - `fn identity_from_head(head: &[u8]) -> String`, `fn fnv1a64(bytes: &[u8]) -> u64`
  - `fn read_first_line(path: &Path, cap: usize) -> Option<Vec<u8>>`

**Roots are injected.** Both discovery functions take `home: &Path` and join
the well-known subdirectories themselves — the `prompt_assets.rs:351`
`collect(agent, home, project)` seam. Tests pass a temp directory, so no test
ever reads a real `~/.claude` or `~/.codex`.

**`missing` is not `unreadable` (spec major M7).** `Missing` means the root
path does not exist — the honest "no data yet". `Unreadable` means the path
exists but `read_dir` fails: wrong permissions, or something that is not a
directory. Those two must render differently, so they must be distinguished
here rather than collapsed into "empty".

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    fn write_file(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn names(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn discovers_claude_session_and_subagent_transcripts() {
        let home = fixture("discover-claude");
        let projects = home.join(".claude").join("projects").join("-Users-dev-repo");
        write_file(&projects.join("sess-1.jsonl"), "{}\n");
        write_file(&projects.join("sess-2.jsonl"), "{}\n");
        write_file(
            &projects.join("sess-1").join("subagents").join("agent-a.jsonl"),
            "{}\n",
        );
        // Neighbours that are not transcripts must not be picked up.
        write_file(&projects.join("sess-1").join("MEMORY.md"), "notes\n");
        write_file(
            &projects.join("sess-1").join("tool-results").join("r.jsonl"),
            "{}\n",
        );
        write_file(&projects.join("notes.txt"), "text\n");

        let found = discover_claude(&home);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert_eq!(names(&found.files), vec!["agent-a.jsonl", "sess-1.jsonl", "sess-2.jsonl"]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn tells_a_missing_claude_root_apart_from_an_unreadable_one() {
        let home = fixture("claude-missing");
        let found = discover_claude(&home);
        assert!(matches!(found.state, DiscoveryState::Missing));
        assert!(found.files.is_empty());

        // `projects` exists but is a regular file: it exists, and `read_dir`
        // on it fails. That is the M7 "unreadable", not "no data yet".
        let broken = fixture("claude-unreadable");
        write_file(&broken.join(".claude").join("projects"), "not a directory");
        let found = discover_claude(&broken);
        assert!(matches!(found.state, DiscoveryState::Unreadable));
        assert!(found.files.is_empty());

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&broken);
    }

    #[test]
    fn discovers_codex_rollouts_under_both_the_dated_and_the_flat_layout() {
        let home = fixture("discover-codex");
        let codex = home.join(".codex");
        write_file(
            &codex.join("sessions/2026/08/10/rollout-2026-08-10T11-45-40-a.jsonl"),
            "{}\n",
        );
        write_file(
            &codex.join("sessions/2026/08/09/rollout-2026-08-09T09-00-00-b.jsonl"),
            "{}\n",
        );
        // archived_sessions is FLAT on the dev machine, verified 2026-08-10.
        write_file(
            &codex.join("archived_sessions/rollout-2026-04-27T12-16-52-c.jsonl"),
            "{}\n",
        );
        // Not a rollout, and not a transcript extension.
        write_file(&codex.join("sessions/2026/08/10/notes.jsonl"), "{}\n");
        write_file(&codex.join("sessions/2026/08/10/rollout-x.txt"), "{}\n");

        let found = discover_codex(&home);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert_eq!(
            names(&found.active),
            vec![
                "rollout-2026-08-09T09-00-00-b.jsonl",
                "rollout-2026-08-10T11-45-40-a.jsonl",
            ]
        );
        assert_eq!(names(&found.archived), vec!["rollout-2026-04-27T12-16-52-c.jsonl"]);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_is_missing_only_when_both_roots_are_absent() {
        let home = fixture("codex-missing");
        assert!(matches!(discover_codex(&home).state, DiscoveryState::Missing));

        // Only the archived root exists: present, not missing.
        let partial = fixture("codex-archived-only");
        write_file(
            &partial.join(".codex/archived_sessions/rollout-a.jsonl"),
            "{}\n",
        );
        let found = discover_codex(&partial);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert!(found.active.is_empty());
        assert_eq!(found.archived.len(), 1);

        // A `sessions` that is a file, with no archived root at all.
        let broken = fixture("codex-unreadable");
        write_file(&broken.join(".codex").join("sessions"), "not a directory");
        assert!(matches!(
            discover_codex(&broken).state,
            DiscoveryState::Unreadable
        ));

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&partial);
        let _ = std::fs::remove_dir_all(&broken);
    }

    #[test]
    fn reads_the_session_identity_out_of_the_first_line() {
        // Claude: `sessionId` on whatever the first line happens to be.
        assert_eq!(
            identity_from_head(br#"{"type":"mode","sessionId":"aa8311ee","mode":"x"}"#),
            "aa8311ee"
        );
        // Codex: `payload.id`, with `payload.session_id` as the fallback the
        // spec names (§0.4 erratum 3 — both keys exist and agree).
        assert_eq!(
            identity_from_head(
                br#"{"type":"session_meta","payload":{"session_id":"019fe9fd","id":"019fe9fd"}}"#
            ),
            "019fe9fd"
        );
        assert_eq!(
            identity_from_head(br#"{"type":"session_meta","payload":{"session_id":"only"}}"#),
            "only"
        );
    }

    #[test]
    fn falls_back_to_a_hash_when_the_first_line_carries_no_session_id() {
        // 1 of 200 real subagent files opens with a `fork-context-ref` line
        // that has no sessionId, so the fallback is not hypothetical.
        let one = identity_from_head(br#"{"type":"fork-context-ref","ref":"abc"}"#);
        let two = identity_from_head(br#"{"type":"fork-context-ref","ref":"abd"}"#);
        assert!(one.starts_with("h:"));
        assert_ne!(one, two, "different first lines are different identities");
        assert_eq!(one, identity_from_head(br#"{"type":"fork-context-ref","ref":"abc"}"#));
        // Not valid JSON at all still yields a stable identity.
        assert!(identity_from_head(b"half a line").starts_with("h:"));
        // The hash is over bytes, never over stored content: the identity is
        // 18 characters no matter how long the line was.
        assert_eq!(one.len(), 18);
    }

    #[test]
    fn the_identity_read_is_bounded_and_stops_at_the_first_newline() {
        let dir = fixture("identity-head");
        let path = dir.join("big.jsonl");
        let mut contents = format!(r#"{{"sessionId":"sess-1","blob":"{}"}}"#, "x".repeat(200));
        contents.push('\n');
        contents.push_str("{\"second\":true}\n");
        std::fs::write(&path, &contents).unwrap();

        assert_eq!(file_identity(&path).as_deref(), Some("sess-1"));
        // Truncated below the JSON's length: the parse fails and the hash of
        // the bounded head is used instead of reading the whole line.
        assert_eq!(read_first_line(&path, 32).unwrap().len(), 32);
        assert!(identity_from_head(&read_first_line(&path, 32).unwrap()).starts_with("h:"));
        assert!(file_identity(&dir.join("gone.jsonl")).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'discover_claude' in this
scope`, `error[E0433]: failed to resolve: use of undeclared type
'DiscoveryState'`, `error[E0425]: cannot find function 'identity_from_head' in
this scope`.

- [ ] **Step 3: Write the identity helpers**

Insert after `write_cache`:

```rust
/// Up to `cap` bytes of a file, truncated at the first newline.
///
/// Deliberately not `BufRead::read_line`: a subagent transcript opens with a
/// `type: "user"` line that can carry a pasted blob, and an unbounded read
/// here would reintroduce exactly the hazard the capped line reader exists to
/// remove.
fn read_first_line(path: &Path, cap: usize) -> Option<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut head = Vec::new();
    file.take(cap as u64).read_to_end(&mut head).ok()?;
    let end = head
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(head.len());
    head.truncate(end);
    Some(head)
}

/// FNV-1a, 64-bit. Not a security hash — it exists so a file whose first line
/// names no session still gets a stable, content-free identity.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// A file's session identity, from its first line.
///
/// Claude writes `sessionId` on every line including the first; Codex writes
/// `payload.id` (and the identical `payload.session_id`) on its `session_meta`
/// line. When neither is there — 1 of 200 real subagent files opens with a
/// `fork-context-ref` line — the fallback is a **hash** of the head, never the
/// head itself: the cache must not store conversation bytes (privacy
/// contract).
fn identity_from_head(head: &[u8]) -> String {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(head) {
        let named = value
            .get("sessionId")
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                value
                    .get("payload")
                    .and_then(|payload| payload.get("id"))
                    .and_then(serde_json::Value::as_str)
            })
            .or_else(|| {
                value
                    .get("payload")
                    .and_then(|payload| payload.get("session_id"))
                    .and_then(serde_json::Value::as_str)
            });
        if let Some(identity) = named.filter(|text| !text.is_empty()) {
            return identity.to_string();
        }
    }
    format!("h:{:016x}", fnv1a64(head))
}

fn file_identity(path: &Path) -> Option<String> {
    read_first_line(path, IDENTITY_HEAD_BYTES).map(|head| identity_from_head(&head))
}
```

- [ ] **Step 4: Write the discovery walk**

Insert after `file_identity`:

```rust
/// Whether a source root could be looked at, before anything was read from it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DiscoveryState {
    /// The root does not exist. The honest "no data yet".
    Missing,
    /// The root exists but cannot be listed. NOT the same as missing (spec,
    /// major M7) — it is an error state the UI has to show as one.
    Unreadable,
    Present,
}

struct Discovery {
    files: Vec<PathBuf>,
    state: DiscoveryState,
}

struct CodexDiscovery {
    active: Vec<PathBuf>,
    archived: Vec<PathBuf>,
    state: DiscoveryState,
}

/// Regular, non-symlinked entries of `dir` matching `prefix` (when given) and
/// the transcript extension. Symlinks are refused rather than followed: one
/// can point straight out of the scanned tree.
fn push_transcripts(dir: &Path, prefix: Option<&str>, out: &mut Vec<PathBuf>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let is_file = entry
            .file_type()
            .map(|kind| kind.is_file() && !kind.is_symlink())
            .unwrap_or(false);
        if !is_file {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some(TRANSCRIPT_EXTENSION) {
            continue;
        }
        if let Some(prefix) = prefix {
            let matches = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with(prefix))
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }
        out.push(path);
    }
    true
}

/// Directory entries of `dir` that are real directories, sorted.
fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect();
    dirs.sort();
    dirs
}

/// `<home>/.claude/projects/*/*.jsonl` and
/// `<home>/.claude/projects/*/*/subagents/*.jsonl`.
///
/// Both globs, not just the first: subagent transcripts are ~47% of this
/// machine's Claude history by size, and omitting them undercounts by almost
/// half (spec, blocker B3). Verified 2026-08-10 that nothing nests deeper.
fn discover_claude(home: &Path) -> Discovery {
    let root = home.join(CLAUDE_DIR).join(CLAUDE_PROJECTS_DIR);
    if !root.exists() {
        return Discovery {
            files: Vec::new(),
            state: DiscoveryState::Missing,
        };
    }
    let Ok(projects) = std::fs::read_dir(&root) else {
        return Discovery {
            files: Vec::new(),
            state: DiscoveryState::Unreadable,
        };
    };
    let mut files = Vec::new();
    let mut project_dirs: Vec<PathBuf> = projects
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect();
    project_dirs.sort();
    for project in project_dirs {
        push_transcripts(&project, None, &mut files);
        for session in child_dirs(&project) {
            push_transcripts(&session.join(CLAUDE_SUBAGENTS_DIR), None, &mut files);
        }
    }
    files.sort();
    Discovery {
        files,
        state: DiscoveryState::Present,
    }
}

/// Every `rollout-*.jsonl` under a Codex root, at any depth up to the cap.
///
/// Recursive because the two roots have different shapes: `sessions/` is
/// `YYYY/MM/DD/`, while `archived_sessions/` is FLAT on the dev machine
/// (verified 2026-08-10, against the spec's implication that both are dated).
/// The depth cap bounds a pathological tree; symlinked directories are never
/// descended, so a loop cannot be built out of them either.
fn walk_rollouts(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> bool {
    if depth > MAX_WALK_DEPTH {
        return true;
    }
    if !push_transcripts(dir, Some(CODEX_ROLLOUT_PREFIX), out) {
        return false;
    }
    for child in child_dirs(dir) {
        walk_rollouts(&child, depth + 1, out);
    }
    true
}

/// `<home>/.codex/sessions/**` and `<home>/.codex/archived_sessions/**`.
///
/// Missing only when BOTH roots are absent — a machine that has archived
/// sessions but no live ones still has data to show.
fn discover_codex(home: &Path) -> CodexDiscovery {
    let base = home.join(CODEX_DIR);
    let live = base.join(CODEX_SESSIONS_DIR);
    let old = base.join(CODEX_ARCHIVED_DIR);
    let live_exists = live.exists();
    let old_exists = old.exists();
    if !live_exists && !old_exists {
        return CodexDiscovery {
            active: Vec::new(),
            archived: Vec::new(),
            state: DiscoveryState::Missing,
        };
    }
    let mut active = Vec::new();
    let mut archived = Vec::new();
    let mut readable = false;
    if live_exists && walk_rollouts(&live, 0, &mut active) {
        readable = true;
    }
    if old_exists && walk_rollouts(&old, 0, &mut archived) {
        readable = true;
    }
    active.sort();
    archived.sort();
    CodexDiscovery {
        active,
        archived,
        state: if readable {
            DiscoveryState::Present
        } else {
            DiscoveryState::Unreadable
        },
    }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (48 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 6: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A7: Incremental scan, reconciliation and aggregation

**Files:**

- Modify: `src-tauri/src/usage.rs`

**Interfaces:**

- Consumes: everything from A1–A6.
- Produces:
  - `enum FileScan { Updated(FileRecord), Failed }`
  - `fn scan_file(agent, path, previous: Option<&FileRecord>, now_ms) -> FileScan`
  - `fn compacted(record: FileRecord, now_ms: u64) -> FileRecord`
  - `fn scan_into(agent, paths, previous, now_ms, files) -> u32`
  - `struct ScanOutcome { cache, changed, claude, codex }`
  - `fn scan_all(previous: &UsageCache, home: &Path, now_ms: u64) -> ScanOutcome`
  - `fn aggregate_buckets(cache: &UsageCache) -> Vec<UsageBucket>`
  - `fn count_files(cache: &UsageCache, agent: UsageAgent) -> u32`
  - `fn build_snapshot(outcome: &ScanOutcome, scanned_at_ms: u64) -> UsageSnapshot`

**The scan rules, stated once so they cannot be re-derived wrong.**

| Situation                                      | What happens                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| mtime **and** size both unchanged              | Nothing is opened. The record is reused, after the compaction check.                   |
| File grew, identity unchanged, not compacted   | Resume from the committed offset.                                                      |
| File shrank                                    | Rescan from zero.                                                                      |
| First-line identity changed (same size or not) | Rescan from zero — a different session now lives at that path.                         |
| Previously compacted and anything moved        | Rescan from zero; its contribution map no longer exists to resume into.                |
| File is new                                    | Scan from zero.                                                                        |
| File is gone                                   | Its record — and so its contributions — is dropped.                                    |
| `stat` or `open` failed                        | Keep the previous record untouched. A transient permission error must not delete data. |
| Root `Missing`                                 | Drop every record for that agent.                                                      |
| Root `Unreadable`                              | Keep every record for that agent untouched, and report `unreadable`.                   |

**"Opened" means the stat succeeded.** A warm poll opens no file contents at
all, so counting content-opens would make every healthy warm poll report
`unreadable`. `files_scanned` is the number of live records for that agent
after reconciliation, which is stable across polls.

**Compaction runs on the warm path too.** The check is `now - mtime >
COMPACT_AFTER_MS`, and a file scanned fresh today only crosses that line on a
later poll where nothing about it moved. Compacting an unchanged record is
itself a change to the cache, so it flips `changed` and the cache is rewritten
once.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    const DAY_MS: u64 = 24 * 60 * 60 * 1000;

    /// `now` for tests that must not depend on the wall clock. Well inside
    /// `COMPACT_AFTER_MS` of a file written right now, because a fixture file
    /// carries the real current mtime.
    fn scan_now() -> u64 {
        now_ms()
    }

    fn claude_transcript(home: &Path, project: &str, session: &str) -> PathBuf {
        home.join(CLAUDE_DIR)
            .join(CLAUDE_PROJECTS_DIR)
            .join(project)
            .join(format!("{session}.jsonl"))
    }

    fn codex_transcript(home: &Path, name: &str) -> PathBuf {
        home.join(CODEX_DIR)
            .join(CODEX_SESSIONS_DIR)
            .join("2026/08/10")
            .join(format!("{CODEX_ROLLOUT_PREFIX}{name}.jsonl"))
    }

    fn claude_first_line(session: &str) -> String {
        format!("{{\"type\":\"mode\",\"sessionId\":\"{session}\",\"mode\":\"x\"}}\n")
    }

    fn codex_first_line(session: &str) -> String {
        format!(
            "{{\"timestamp\":\"2026-08-10T04:45:41.202Z\",\"type\":\"session_meta\",\
             \"payload\":{{\"id\":\"{session}\",\"session_id\":\"{session}\"}}}}\n"
        )
    }

    fn line(bytes: Vec<u8>) -> String {
        let mut text = String::from_utf8(bytes).unwrap();
        text.push('\n');
        text
    }

    fn append(path: &Path, text: &str) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    fn bucket_of<'a>(
        snapshot: &'a UsageSnapshot,
        agent: UsageAgent,
        model: &str,
    ) -> Option<&'a UsageBucket> {
        snapshot
            .buckets
            .iter()
            .find(|bucket| bucket.agent == agent && bucket.model == model)
    }

    fn snapshot_of(cache: &UsageCache, home: &Path, now: u64) -> (UsageSnapshot, ScanOutcome) {
        let outcome = scan_all(cache, home, now);
        let snapshot = build_snapshot(&outcome, now);
        (snapshot, outcome)
    }

    #[test]
    fn scans_a_fresh_corpus_and_aggregates_both_agents() {
        let home = fixture("scan-fresh");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );
        // A subagent transcript beside it. Subagent files are ~47% of this
        // machine's Claude history by size (spec, blocker B3), so this asserts
        // their usage reaches a bucket, not merely that discovery lists them.
        let subagent = home
            .join(CLAUDE_DIR)
            .join(CLAUDE_PROJECTS_DIR)
            .join("-Users-dev-repo")
            .join("sess-1")
            .join(CLAUDE_SUBAGENTS_DIR)
            .join("agent-a.jsonl");
        write_file(&subagent, &claude_first_line("sess-1"));
        append(
            &subagent,
            &line(claude_line("msg_sub", "req_sub", "2026-08-10T05:06:00.351Z", 44)),
        );
        let codex = codex_transcript(&home, "2026-08-10T11-45-40-019fe9fd");
        write_file(&codex, &codex_first_line("019fe9fd"));
        append(&codex, &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")));
        append(
            &codex,
            &line(token_count("2026-08-10T04:45:59.358Z", 33_328, 6_912, 0, 587)),
        );

        let (snapshot, outcome) = snapshot_of(&UsageCache::default(), &home, scan_now());
        assert!(outcome.changed);
        assert_eq!(snapshot.skipped_lines, 0);
        assert_eq!(
            snapshot.sources,
            vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Ok,
                    // The session transcript AND its subagent transcript.
                    files_scanned: 2,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Ok,
                    files_scanned: 1,
                },
            ]
        );
        assert_eq!(snapshot.buckets.len(), 2);
        // Sorted by (bucket, agent, model): the Codex bucket at 04:45 comes
        // before the Claude bucket at 05:06.
        assert_eq!(snapshot.buckets[0].bucket_start_ms, 1_786_337_100_000);
        assert_eq!(snapshot.buckets[0].agent, UsageAgent::Codex);
        assert_eq!(snapshot.buckets[1].bucket_start_ms, 1_786_338_000_000);
        assert_eq!(snapshot.buckets[1].agent, UsageAgent::Claude);
        assert_eq!(
            bucket_of(&snapshot, UsageAgent::Claude, "claude-opus-5")
                .unwrap()
                .counters
                .output,
            // 116 from the session transcript + 44 from its subagent.
            160
        );
        assert_eq!(
            bucket_of(&snapshot, UsageAgent::Codex, "gpt-5.6-sol")
                .unwrap()
                .counters
                .cache_read,
            6_912
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_unchanged_second_scan_changes_nothing() {
        let home = fixture("scan-warm");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        assert!(first.changed);
        let second = scan_all(&first.cache, &home, now);
        assert!(!second.changed, "an unchanged poll must not rewrite the cache");
        assert_eq!(second.cache, first.cache);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn resumes_from_the_committed_offset_when_a_file_grows() {
        let home = fixture("scan-resume");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 10)),
        );
        // A partial trailing line: written, but not terminated.
        let partial = claude_line("msg_2", "req_2", "2026-08-10T05:06:00.351Z", 20);
        append(&claude, &String::from_utf8(partial.clone()).unwrap());

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        let record = first.cache.files.get(&key).unwrap();
        assert_eq!(record.entries.len(), 1, "the partial line is not ingested");
        let committed = record.offset;
        assert_eq!(
            committed as usize,
            claude_first_line("sess-1").len()
                + claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 10).len()
                + 1
        );

        // Finish the line and add one more.
        append(&claude, "\n");
        append(
            &claude,
            &line(claude_line("msg_3", "req_3", "2026-08-10T05:06:00.351Z", 30)),
        );
        let second = scan_all(&first.cache, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert!(second.changed);
        assert_eq!(record.entries.len(), 3);
        assert!(record.offset > committed);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rescans_a_shrunken_file_from_zero() {
        let home = fixture("scan-shrink");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        for id in ["msg_1", "msg_2", "msg_3"] {
            append(
                &claude,
                &line(claude_line(id, "req", "2026-08-10T05:06:00.351Z", 10)),
            );
        }
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        assert_eq!(first.cache.files.get(&key).unwrap().entries.len(), 3);

        // Truncated back to the header plus one message.
        let mut shrunk = claude_first_line("sess-1");
        shrunk.push_str(&line(claude_line(
            "msg_1",
            "req",
            "2026-08-10T05:06:00.351Z",
            10,
        )));
        std::fs::write(&claude, &shrunk).unwrap();

        let second = scan_all(&first.cache, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert_eq!(record.offset, shrunk.len() as u64);
        assert_eq!(
            record.entries.len(),
            1,
            "a shrunken file is rescanned from zero, not resumed"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rescans_a_same_size_replacement_caught_by_the_identity_check() {
        let home = fixture("scan-replace");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let original = format!(
            "{}{}",
            claude_first_line("sess-1"),
            line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 10))
        );
        write_file(&claude, &original);
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();

        // A different session of exactly the same byte length. The mtime in
        // the cached record is aged by hand so the test does not depend on
        // filesystem timestamp resolution.
        let replacement = format!(
            "{}{}",
            claude_first_line("sess-2"),
            line(claude_line("msg_9", "req_9", "2026-08-10T05:06:00.351Z", 99))
        );
        assert_eq!(replacement.len(), original.len());
        std::fs::write(&claude, &replacement).unwrap();
        let mut aged = first.cache.clone();
        aged.files.get_mut(&key).unwrap().mtime_ms = 1;

        let second = scan_all(&aged, &home, now);
        let record = second.cache.files.get(&key).unwrap();
        assert_eq!(record.identity, "sess-2");
        assert_eq!(record.entries.len(), 1);
        assert!(record.entries.contains_key("msg_9\u{1}req_9"));
        assert!(!record.entries.contains_key("msg_1\u{1}req_1"));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn drops_the_contributions_of_a_deleted_file() {
        let home = fixture("scan-delete");
        let one = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let two = claude_transcript(&home, "-Users-dev-repo", "sess-2");
        for (path, session, id) in [(&one, "sess-1", "msg_1"), (&two, "sess-2", "msg_2")] {
            write_file(path, &claude_first_line(session));
            append(
                path,
                &line(claude_line(id, "req", "2026-08-10T05:06:00.351Z", 10)),
            );
        }
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        assert_eq!(build_snapshot(&first, now).buckets[0].counters.output, 20);

        std::fs::remove_file(&two).unwrap();
        let second = scan_all(&first.cache, &home, now);
        assert!(second.changed);
        assert_eq!(second.cache.files.len(), 1);
        let snapshot = build_snapshot(&second, now);
        assert_eq!(snapshot.buckets[0].counters.output, 10);
        assert_eq!(snapshot.sources[0].files_scanned, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn keeps_every_record_when_a_root_turns_unreadable() {
        let home = fixture("scan-unreadable");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);

        // Replace the whole projects tree with a regular file.
        let projects = home.join(CLAUDE_DIR).join(CLAUDE_PROJECTS_DIR);
        std::fs::remove_dir_all(&projects).unwrap();
        std::fs::write(&projects, "not a directory").unwrap();

        let second = scan_all(&first.cache, &home, now);
        assert_eq!(second.claude, UsageSourceState::Unreadable);
        assert!(!second.changed, "an unreadable root must not discard data");
        let snapshot = build_snapshot(&second, now);
        assert_eq!(snapshot.buckets[0].counters.output, 116);
        assert_eq!(snapshot.sources[0].state, UsageSourceState::Unreadable);
        assert_eq!(snapshot.sources[0].files_scanned, 1);

        // A root that vanishes entirely is a different story: the data is gone.
        std::fs::remove_file(&projects).unwrap();
        let third = scan_all(&second.cache, &home, now);
        assert_eq!(third.claude, UsageSourceState::Missing);
        assert!(third.cache.files.is_empty());
        assert!(build_snapshot(&third, now).buckets.is_empty());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn compacts_a_stale_file_and_rescans_it_from_zero_when_it_regrows() {
        let home = fixture("scan-compact");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 10)),
        );
        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let key = claude.to_string_lossy().into_owned();
        assert!(!first.cache.files.get(&key).unwrap().compacted);

        // Three days later, nothing about the file has moved.
        let later = now + 3 * DAY_MS;
        let second = scan_all(&first.cache, &home, later);
        let record = second.cache.files.get(&key).unwrap();
        assert!(second.changed, "compaction is itself a cache change");
        assert!(record.compacted);
        assert!(record.entries.is_empty());
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 10);
        // The numbers the UI sees are unchanged by compaction.
        assert_eq!(build_snapshot(&second, later).buckets[0].counters.output, 10);

        // It grows again: rescanned from zero, and the rebuilt map must not
        // double the contribution that is already in `totals`.
        append(
            &claude,
            &line(claude_line("msg_2", "req_2", "2026-08-10T05:06:00.351Z", 20)),
        );
        let third = scan_all(&second.cache, &home, later);
        let record = third.cache.files.get(&key).unwrap();
        assert!(record.compacted, "still older than the compaction window");
        assert_eq!(record.totals.len(), 1);
        assert_eq!(record.totals[0].counters.output, 30);
        assert_eq!(build_snapshot(&third, later).buckets[0].counters.output, 30);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn collapses_a_duplicate_claude_key_across_two_files() {
        let home = fixture("scan-fork");
        // A forked session copies the parent's messages into a second file.
        let parent = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        let fork = claude_transcript(&home, "-Users-dev-repo", "sess-2");
        let shared = line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116));
        write_file(&parent, &claude_first_line("sess-1"));
        append(&parent, &shared);
        write_file(&fork, &claude_first_line("sess-2"));
        append(&fork, &shared);

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.sources[0].files_scanned, 2);
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(
            snapshot.buckets[0].counters.output, 116,
            "the same message in two files is counted once"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn skips_an_archived_rollout_whose_active_copy_still_exists() {
        let home = fixture("scan-archived");
        let active = codex_transcript(&home, "2026-08-10T11-45-40-019fe9fd");
        write_file(&active, &codex_first_line("019fe9fd"));
        append(&active, &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")));
        append(
            &active,
            &line(token_count("2026-08-10T04:45:59.358Z", 1_000, 0, 0, 100)),
        );

        // The same session, also sitting in the flat archived directory.
        let archived = home
            .join(CODEX_DIR)
            .join(CODEX_ARCHIVED_DIR)
            .join("rollout-2026-08-10T11-45-40-019fe9fd.jsonl");
        std::fs::create_dir_all(archived.parent().unwrap()).unwrap();
        std::fs::copy(&active, &archived).unwrap();

        // And one archived session with no active copy, which must be kept.
        let orphan = home
            .join(CODEX_DIR)
            .join(CODEX_ARCHIVED_DIR)
            .join("rollout-2026-04-27T12-16-52-019dcd5e.jsonl");
        write_file(&orphan, &codex_first_line("019dcd5e"));
        append(&orphan, &line(turn_context("2026-08-10T04:45:45.349Z", "gpt-5.6-sol")));
        append(
            &orphan,
            &line(token_count("2026-08-10T04:45:59.358Z", 500, 0, 0, 50)),
        );

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.sources[1].files_scanned, 2);
        assert!(!outcome
            .cache
            .files
            .contains_key(&archived.to_string_lossy().into_owned()));
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(
            snapshot.buckets[0].counters.output, 150,
            "the archived duplicate must not be counted a second time"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn counts_a_malformed_and_an_oversized_line_and_keeps_reading() {
        let home = fixture("scan-skipped");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(&claude, "{ not json at all\n");
        append(&claude, "\n");
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&first, now);
        assert_eq!(
            snapshot.skipped_lines, 1,
            "the blank line is ignored, not skipped"
        );
        assert_eq!(snapshot.buckets[0].counters.output, 116);

        // The count is cumulative: a poll that read nothing keeps it.
        let second = scan_all(&first.cache, &home, now);
        assert_eq!(build_snapshot(&second, now).skipped_lines, 1);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn an_oversized_line_is_skipped_and_the_following_line_still_parses() {
        let home = fixture("scan-oversized");
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        // One line past MAX_LINE_BYTES. Built as a JSON string so the file is
        // shaped like a real transcript, and written once so the test stays
        // under a second.
        let huge = format!(
            "{{\"type\":\"user\",\"text\":\"{}\"}}\n",
            "x".repeat(MAX_LINE_BYTES)
        );
        append(&claude, &huge);
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );

        let now = scan_now();
        let outcome = scan_all(&UsageCache::default(), &home, now);
        let snapshot = build_snapshot(&outcome, now);
        assert_eq!(snapshot.skipped_lines, 1);
        assert_eq!(snapshot.buckets[0].counters.output, 116);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_cache_version_mismatch_discards_and_rescans_the_whole_corpus() {
        let home = fixture("scan-version");
        let dir = fixture("scan-version-cache");
        let cache_path = dir.join(USAGE_CACHE_FILE);
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );

        let now = scan_now();
        let first = scan_all(&UsageCache::default(), &home, now);
        write_cache(&cache_path, &first.cache).unwrap();

        // Rewrite the file on disk with a version this build cannot read.
        let stale = UsageCache {
            cache_version: USAGE_CACHE_VERSION + 1,
            files: first.cache.files.clone(),
        };
        write_cache(&cache_path, &stale).unwrap();
        let reloaded = load_cache(Some(&cache_path));
        assert!(reloaded.files.is_empty());

        // The rescan from the discarded cache reproduces the same numbers.
        let second = scan_all(&reloaded, &home, now);
        assert_eq!(second.cache.files, first.cache.files);
        assert!(second.changed);

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'scan_all' in this scope`,
`error[E0425]: cannot find function 'build_snapshot' in this scope`,
`error[E0412]: cannot find type 'ScanOutcome' in this scope`.

- [ ] **Step 3: Write the per-file scan and compaction**

Insert after `discover_codex`:

```rust
/// What one file contributed to this pass.
enum FileScan {
    /// The file was accounted for. Its record replaces whatever was cached.
    Updated(FileRecord),
    /// The file could not be statted or opened. The caller keeps the previous
    /// record: a transient permission error must not delete a scan's worth of
    /// contributions.
    Failed,
}

/// Roll a stale file's per-message map into its totals.
///
/// Bounds the cache (spec, "the contribution map is unbounded as specified;
/// the implementation plan must bound it"). Age, not scan count (§0.3
/// decision 2): with a 5 s poll a session paused for two minutes would compact
/// and then force a full re-read the moment the user typed again. Correctness
/// survives because a compacted file that changes is rescanned from zero, and
/// reappearing dedupe keys only matter in files that grow.
fn compacted(mut record: FileRecord, now_ms: u64) -> FileRecord {
    if record.compacted || now_ms.saturating_sub(record.mtime_ms) <= COMPACT_AFTER_MS {
        return record;
    }
    let entries = std::mem::take(&mut record.entries);
    for contribution in entries.values() {
        add_total(
            &mut record.totals,
            contribution.bucket_start_ms,
            &contribution.model,
            contribution.counters,
        );
    }
    sort_totals(&mut record.totals);
    record.cumulative = None;
    record.compacted = true;
    record
}

/// One transcript file, resumed or rescanned as the scan rules require.
fn scan_file(
    agent: UsageAgent,
    path: &Path,
    previous: Option<&FileRecord>,
    now_ms: u64,
) -> FileScan {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return FileScan::Failed;
    };
    if meta.file_type().is_symlink() || !meta.is_file() {
        return FileScan::Failed;
    }
    let size = meta.len();
    let mtime = mtime_ms(&meta);

    // Warm path. Nothing about the file moved, so nothing is opened — this is
    // what keeps a 5 s poll over ~2.5 GB of transcripts to one stat per file.
    // The compaction check still runs: a file scanned fresh today only crosses
    // the 48 h line on a later poll where nothing moved.
    if let Some(record) = previous {
        if record.mtime_ms == mtime && record.size == size {
            return FileScan::Updated(compacted(record.clone(), now_ms));
        }
    }

    let Some(identity) = file_identity(path) else {
        return FileScan::Failed;
    };
    // Resume only when the same session is still there, the file has not
    // shrunk, and there is still a contribution map to resume into.
    let resumable = previous.filter(|record| {
        record.identity == identity && record.size <= size && !record.compacted
    });
    let mut record = match resumable {
        Some(record) => FileRecord {
            mtime_ms: mtime,
            size,
            ..record.clone()
        },
        None => FileRecord::empty(agent, identity, mtime, size),
    };

    let Ok(mut file) = std::fs::File::open(path) else {
        return FileScan::Failed;
    };
    if record.offset > 0 {
        use std::io::Seek;
        if file
            .seek(std::io::SeekFrom::Start(record.offset))
            .is_err()
        {
            return FileScan::Failed;
        }
    }
    let mut reader = LineReader::new(file, record.offset);
    loop {
        match reader.next_line() {
            Ok(LineEvent::Line(bytes, offset)) => {
                if ingest(agent, &bytes, &mut record) == LineOutcome::Skipped {
                    record.skipped_lines = record.skipped_lines.saturating_add(1);
                }
                record.offset = offset;
            }
            Ok(LineEvent::Oversized(offset)) => {
                record.skipped_lines = record.skipped_lines.saturating_add(1);
                record.offset = offset;
            }
            Ok(LineEvent::End) => break,
            // A read error mid-file: commit the lines already ingested and let
            // the next scan resume from there rather than losing them.
            Err(_) => break,
        }
    }
    sort_totals(&mut record.totals);
    FileScan::Updated(compacted(record, now_ms))
}
```

- [ ] **Step 4: Write `scan_all` and the reconciliation**

Insert after `scan_file`:

```rust
struct ScanOutcome {
    cache: UsageCache,
    /// Whether anything about the contributions moved. The cache file is
    /// rewritten only when this is true — an unchanged poll does no
    /// serialization at all.
    changed: bool,
    claude: UsageSourceState,
    codex: UsageSourceState,
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Scan every path for one agent into `files`, returning how many were
/// accounted for.
///
/// "Accounted for" means the stat succeeded, not that bytes were read: the
/// warm path opens nothing, and counting content-opens would make every
/// healthy warm poll look unreadable.
fn scan_into(
    agent: UsageAgent,
    paths: &[PathBuf],
    previous: &UsageCache,
    now_ms: u64,
    files: &mut BTreeMap<String, FileRecord>,
) -> u32 {
    let mut accounted: u32 = 0;
    for path in paths {
        let key = path_key(path);
        let prior = previous
            .files
            .get(&key)
            .filter(|record| record.agent == agent);
        match scan_file(agent, path, prior, now_ms) {
            FileScan::Updated(record) => {
                files.insert(key, record);
                accounted = accounted.saturating_add(1);
            }
            FileScan::Failed => {
                if let Some(record) = prior {
                    files.insert(key, record.clone());
                }
            }
        }
    }
    accounted
}

/// Carry every record for one agent across unchanged. Used when a root exists
/// but cannot be listed: the data is still on disk, this scan simply could not
/// look at it.
fn carry_over(previous: &UsageCache, agent: UsageAgent, files: &mut BTreeMap<String, FileRecord>) {
    for (key, record) in &previous.files {
        if record.agent == agent {
            files.insert(key.clone(), record.clone());
        }
    }
}

/// `Ok` unless every candidate failed, which means the root is listable but
/// nothing inside it is.
fn source_state(accounted: u32, candidates: usize) -> UsageSourceState {
    if accounted == 0 && candidates > 0 {
        return UsageSourceState::Unreadable;
    }
    UsageSourceState::Ok
}

/// A whole incremental scan. `home` is injected, so no test reads a real home
/// directory — the `prompt_assets.rs:351` seam.
fn scan_all(previous: &UsageCache, home: &Path, now_ms: u64) -> ScanOutcome {
    let mut files: BTreeMap<String, FileRecord> = BTreeMap::new();

    let claude_found = discover_claude(home);
    let claude = match claude_found.state {
        // The root is gone: so is the data it described.
        DiscoveryState::Missing => UsageSourceState::Missing,
        DiscoveryState::Unreadable => {
            carry_over(previous, UsageAgent::Claude, &mut files);
            UsageSourceState::Unreadable
        }
        DiscoveryState::Present => {
            let accounted = scan_into(
                UsageAgent::Claude,
                &claude_found.files,
                previous,
                now_ms,
                &mut files,
            );
            source_state(accounted, claude_found.files.len())
        }
    };

    let codex_found = discover_codex(home);
    let codex = match codex_found.state {
        DiscoveryState::Missing => UsageSourceState::Missing,
        DiscoveryState::Unreadable => {
            carry_over(previous, UsageAgent::Codex, &mut files);
            UsageSourceState::Unreadable
        }
        DiscoveryState::Present => {
            let mut accounted = scan_into(
                UsageAgent::Codex,
                &codex_found.active,
                previous,
                now_ms,
                &mut files,
            );
            // An archived copy of a session that is still active would be
            // counted twice, so it is dropped rather than scanned.
            let active_ids: std::collections::HashSet<String> = codex_found
                .active
                .iter()
                .filter_map(|path| files.get(&path_key(path)).map(|record| record.identity.clone()))
                .collect();
            let archived: Vec<PathBuf> = codex_found
                .archived
                .into_iter()
                .filter(|path| match cached_identity(path, previous) {
                    Some(identity) => !active_ids.contains(&identity),
                    None => true,
                })
                .collect();
            accounted = accounted.saturating_add(scan_into(
                UsageAgent::Codex,
                &archived,
                previous,
                now_ms,
                &mut files,
            ));
            source_state(
                accounted,
                codex_found.active.len().saturating_add(archived.len()),
            )
        }
    };

    // A fresh map, never an accumulation into the cached one (C1): the whole
    // point of comparing against `previous` is that the previous value is
    // still intact to compare with.
    let changed = files != previous.files;
    ScanOutcome {
        cache: UsageCache {
            cache_version: USAGE_CACHE_VERSION,
            files,
        },
        changed,
        claude,
        codex,
    }
}

/// A file's identity, reusing the cached one when the file has not moved.
/// Saves re-reading the head of every archived rollout on every poll.
fn cached_identity(path: &Path, previous: &UsageCache) -> Option<String> {
    if let Some(record) = previous.files.get(&path_key(path)) {
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if record.size == meta.len() && record.mtime_ms == mtime_ms(&meta) {
                return Some(record.identity.clone());
            }
        }
    }
    file_identity(path)
}
```

- [ ] **Step 5: Write the aggregation**

Insert after `cached_identity`:

```rust
/// Every file's contributions merged into one sorted bucket list.
///
/// Two passes on purpose. Claude's live per-message entries are collapsed
/// globally first, so the same message appearing in a resumed or forked
/// session's second file is counted once (spec, blocker B2); the fold into
/// buckets happens afterwards. `files` is a `BTreeMap`, so "last write wins"
/// is decided by path order and the result is deterministic.
///
/// Documented limit: a **compacted** file no longer has per-message entries,
/// so a duplicate shared with a compacted file cannot be collapsed. That is
/// the spec's own reasoning — "reappearing keys only matter in files that
/// grow" — and a compacted file is by definition one that has not.
fn aggregate_buckets(cache: &UsageCache) -> Vec<UsageBucket> {
    let mut claude_entries: BTreeMap<&str, &Contribution> = BTreeMap::new();
    let mut totals: BTreeMap<(u64, UsageAgent, &str), UsageCounters> = BTreeMap::new();
    for record in cache.files.values() {
        for (key, contribution) in &record.entries {
            claude_entries.insert(key.as_str(), contribution);
        }
        for contribution in &record.totals {
            let slot = totals
                .entry((
                    contribution.bucket_start_ms,
                    record.agent,
                    contribution.model.as_str(),
                ))
                .or_default();
            *slot = add_counters(*slot, contribution.counters);
        }
    }
    for contribution in claude_entries.values() {
        let slot = totals
            .entry((
                contribution.bucket_start_ms,
                UsageAgent::Claude,
                contribution.model.as_str(),
            ))
            .or_default();
        *slot = add_counters(*slot, contribution.counters);
    }
    // `BTreeMap` iteration is already (bucket_start_ms, agent, model) order —
    // `UsageAgent` derives `Ord` in declaration order, Claude before Codex.
    totals
        .into_iter()
        .map(|((bucket_start_ms, agent, model), counters)| UsageBucket {
            bucket_start_ms,
            agent,
            model: model.to_string(),
            counters,
        })
        .collect()
}

fn count_files(cache: &UsageCache, agent: UsageAgent) -> u32 {
    let count = cache
        .files
        .values()
        .filter(|record| record.agent == agent)
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

fn build_snapshot(outcome: &ScanOutcome, scanned_at_ms: u64) -> UsageSnapshot {
    UsageSnapshot {
        scanned_at_ms,
        buckets: aggregate_buckets(&outcome.cache),
        sources: vec![
            UsageSource {
                agent: UsageAgent::Claude,
                state: outcome.claude,
                files_scanned: count_files(&outcome.cache, UsageAgent::Claude),
            },
            UsageSource {
                agent: UsageAgent::Codex,
                state: outcome.codex,
                files_scanned: count_files(&outcome.cache, UsageAgent::Codex),
            },
        ],
        // Cumulative across the cache, not per scan: a poll that read nothing
        // must not blank out the "n lines skipped" note the UI is showing.
        skipped_lines: outcome
            .cache
            .files
            .values()
            .fold(0u64, |total, record| {
                total.saturating_add(record.skipped_lines)
            }),
    }
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (61 tests)

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

- [ ] **Step 7: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`

---

### Task A8: The command, single-flight state and the second `lib.rs` line

**Files:**

- Modify: `src-tauri/src/usage.rs`
- Modify: `src-tauri/src/lib.rs` (**line 2 of 2** — the handler registration)

**Interfaces:**

- Consumes: everything from A1–A7.
- Produces:
  - `static SCAN: Mutex<ScanState>`, `static LAST: Mutex<Option<UsageSnapshot>>`
  - `fn snapshot_blocking(home: Option<PathBuf>, cache_path: Option<PathBuf>) -> UsageSnapshot`
  - `fn unreadable_snapshot(scanned_at_ms: u64) -> UsageSnapshot`
  - `#[tauri::command] pub async fn usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshot, String>`

**Why `static`s and not `.manage()`.** §0.6 gives Section A exactly two lines of
`lib.rs`, and `.manage(usage::UsageState::default())` would be a third. Module
statics keep the budget and cost nothing: this state is a rebuildable cache and
a single-flight guard, neither of which any other module reads. There is a
precedent for a module-level static in this crate at
`src-tauri/src/platform/windows/shell.rs:30`.

**Lock discipline.** `SCAN` is held for the whole scan and is what makes the
scan single-flight; `LAST` is taken only briefly, and only ever _after_ `SCAN`
or entirely on its own. No path takes `LAST` and then `SCAN`, so the order can
never invert. A poll that arrives while a cold scan is running gets the last
published snapshot instead of queueing a second pass over the same 2.5 GB.

**Poisoning is recovered from, not propagated.** The repo's usual style is to
bail on a poisoned lock (`coordinator.rs:313`), but a poisoned lock here would
brick the Usage screen for the rest of the process's life. The guarded value is
a cache that can always be rebuilt from disk, and the scan builds a fresh
`UsageCache` before assigning it, so there is no half-updated state to inherit.

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests`:

```rust
    #[test]
    fn an_unresolvable_home_still_answers_with_exactly_two_sources() {
        let snapshot = unreadable_snapshot(1_786_338_360_351);
        assert_eq!(snapshot.scanned_at_ms, 1_786_338_360_351);
        assert!(snapshot.buckets.is_empty());
        assert_eq!(snapshot.skipped_lines, 0);
        assert_eq!(
            snapshot.sources,
            vec![
                UsageSource {
                    agent: UsageAgent::Claude,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
                UsageSource {
                    agent: UsageAgent::Codex,
                    state: UsageSourceState::Unreadable,
                    files_scanned: 0,
                },
            ]
        );
        // A home that cannot be resolved is an error, never "no data yet".
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap()["sources"][0]["state"],
            serde_json::json!("unreadable")
        );
    }

    #[test]
    fn the_blocking_entry_point_scans_writes_and_republishes() {
        let home = fixture("blocking-entry");
        let cache_dir = fixture("blocking-entry-cache");
        let cache_path = cache_dir.join(USAGE_CACHE_FILE);
        let claude = claude_transcript(&home, "-Users-dev-repo", "sess-1");
        write_file(&claude, &claude_first_line("sess-1"));
        append(
            &claude,
            &line(claude_line("msg_1", "req_1", "2026-08-10T05:06:00.351Z", 116)),
        );

        let snapshot = snapshot_blocking(Some(home.clone()), Some(cache_path.clone()));
        assert_eq!(snapshot.buckets.len(), 1);
        assert_eq!(snapshot.buckets[0].counters.output, 116);
        assert!(cache_path.is_file(), "a changed scan writes the cache");
        assert_eq!(load_cache(Some(&cache_path)).files.len(), 1);

        // The second call re-uses the in-memory cache and republishes the same
        // numbers. It is also what proves the statics survive a second entry.
        let again = snapshot_blocking(Some(home.clone()), Some(cache_path.clone()));
        assert_eq!(again.buckets, snapshot.buckets);
        assert_eq!(again.sources, snapshot.sources);

        // A home that cannot be resolved is in-band, never an error.
        let empty = snapshot_blocking(None, Some(cache_path.clone()));
        assert_eq!(empty.sources[0].state, UsageSourceState::Unreadable);

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&cache_dir);
    }
```

> The two tests above share the process-global `SCAN` / `LAST` statics with
> nothing else, because they are the only tests that call `snapshot_blocking`.
> Every other test drives `scan_all` / `build_snapshot` directly, which take
> their state as parameters — that is deliberate, and a new test that calls
> `snapshot_blocking` must be added to this pair rather than written separately,
> or `cargo test`'s thread pool will interleave two scans of different fixtures
> through one static cache.

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: FAIL — `error[E0425]: cannot find function 'unreadable_snapshot' in
this scope`, `error[E0425]: cannot find function 'snapshot_blocking' in this
scope`.

- [ ] **Step 3: Write the single-flight state and the blocking entry point**

Insert after `build_snapshot`:

```rust
/// The in-memory half of the cache, plus the single-flight lock.
///
/// A module static rather than Tauri managed state: §0.6 gives this feature
/// exactly two lines in `lib.rs`, and `.manage(…)` would be a third. Nothing
/// outside this module reads it. `platform/windows/shell.rs:30` is the
/// existing precedent for a module-level static in this crate.
struct ScanState {
    /// `None` until the first scan has loaded the cache from disk.
    cache: Option<UsageCache>,
}

static SCAN: std::sync::Mutex<ScanState> = std::sync::Mutex::new(ScanState { cache: None });

/// The last snapshot handed to the frontend. Read only when a scan is already
/// in flight, so a poll arriving mid-scan gets an answer instead of queueing a
/// second pass over the same corpus.
static LAST: std::sync::Mutex<Option<UsageSnapshot>> = std::sync::Mutex::new(None);

/// Lock, recovering from poisoning.
///
/// Deliberately not the repo's usual bail-on-poison style: the guarded value
/// is a rebuildable cache, and refusing it forever would leave the Usage
/// screen dead for the rest of the process's life over one unrelated panic.
fn lock<T>(mutex: &'static std::sync::Mutex<T>) -> std::sync::MutexGuard<'static, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The answer when the home directory cannot be resolved at all.
///
/// `unreadable`, never `missing` (spec, major M7): nothing was looked at, so
/// "no data yet" would be a claim this code is in no position to make.
fn unreadable_snapshot(scanned_at_ms: u64) -> UsageSnapshot {
    UsageSnapshot {
        scanned_at_ms,
        buckets: Vec::new(),
        sources: vec![
            UsageSource {
                agent: UsageAgent::Claude,
                state: UsageSourceState::Unreadable,
                files_scanned: 0,
            },
            UsageSource {
                agent: UsageAgent::Codex,
                state: UsageSourceState::Unreadable,
                files_scanned: 0,
            },
        ],
        skipped_lines: 0,
    }
}

/// One whole scan, on a blocking worker.
///
/// Single-flight: `SCAN` is held for the duration. A caller that finds it busy
/// takes the last published snapshot rather than waiting, unless nothing has
/// been published yet — on the very first cold scan there is nothing better to
/// return, so it waits.
fn snapshot_blocking(home: Option<PathBuf>, cache_path: Option<PathBuf>) -> UsageSnapshot {
    let Some(home) = home else {
        return unreadable_snapshot(now_ms());
    };
    let mut state = match SCAN.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(std::sync::TryLockError::WouldBlock) => {
            let published = lock(&LAST).as_ref().cloned();
            match published {
                Some(snapshot) => return snapshot,
                None => lock(&SCAN),
            }
        }
    };
    if state.cache.is_none() {
        state.cache = Some(load_cache(cache_path.as_deref()));
    }
    let previous = state.cache.take().unwrap_or_default();
    let outcome = scan_all(&previous, &home, now_ms());
    if outcome.changed {
        if let Some(path) = cache_path.as_deref() {
            // A failed write costs the next cold start some time and nothing
            // else, so it is not worth surfacing.
            let _ = write_cache(path, &outcome.cache);
        }
    }
    let snapshot = build_snapshot(&outcome, now_ms());
    state.cache = Some(outcome.cache);
    *lock(&LAST) = Some(snapshot.clone());
    snapshot
}
```

- [ ] **Step 4: Write the command**

Insert at the end of the module, immediately before `#[cfg(test)] mod tests`:

```rust
/// The one command behind the Usage screen.
///
/// Reading and parsing run on a blocking worker — the `info.rs:195` precedent —
/// because this machine holds ~2.5 GB of transcripts and the cold scan must
/// never touch the UI thread. `Err` is returned **only** when that worker
/// panics (§0.3 decision 5): every ordinary failure is in-band through
/// `sources[].state` and `skippedLines`, which is what lets the frontend's
/// poll have exactly one "keep the last good data, mark it stale" trigger.
#[tauri::command]
pub async fn usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshot, String> {
    let home = crate::platform::user_home().ok();
    let cache_path = app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(USAGE_CACHE_FILE));
    tauri::async_runtime::spawn_blocking(move || snapshot_blocking(home, cache_path))
        .await
        .map_err(|error| format!("the usage scan worker failed: {error}"))
}
```

Add `use tauri::Manager;` to the module's `use` block — `app.path()` is an
extension-trait method and does not resolve without it (`migrate.rs:4`).

- [ ] **Step 5: Register the command in `lib.rs`**

Re-read `src-tauri/src/lib.rs` first; it moved during planning. Add
`usage::usage_snapshot,` to the `tauri::generate_handler!` list, immediately
after `prompt_assets::list_prompt_assets,`:

```rust
            prompt_assets::list_prompt_assets,
            usage::usage_snapshot,
            images::read_image_as_data_url,
```

That anchor rather than the end of the list on purpose: the list's last entry
carries no trailing comma, so appending there is the one edit that can break
the macro. The order inside `generate_handler!` has no meaning.

- [ ] **Step 6: Run the full verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml usage::`
Expected: PASS (63 tests)

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`
Expected: PASS — the whole crate, with the new `usage::tests::*` alongside the
existing suites and no regression.

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS (no output)

Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -c "^warning" || true`
Expected: prints `0` — no `dead_code` warning survives; every function written
in A1–A8 is reachable from `usage_snapshot` or from a test. (`grep -c` exits 1
when it counts zero, hence the `|| true`; read the printed number, not the exit
code.)

Run: `npm test`
Expected: PASS — unchanged. Section A adds no TypeScript; this is the
no-collateral-damage check, not a new assertion.

- [ ] **Step 7: Report the task complete**

Files touched:

- `src-tauri/src/usage.rs`
- `src-tauri/src/lib.rs` (one line: `usage::usage_snapshot,` in `generate_handler!`)

Both `lib.rs` lines from §0.6 are now spent: `mod usage;` (Task A1) and the
handler registration (this task). Nothing else in `src-tauri/` was touched, and
no R4 seam was opened.

---

## Findings

### (a) Spec claims wrong against the code or the real data files

1. **`payload.info.total_token_usage`, not `payload.total_token_usage`.** The
   spec's Data-sources section implies the shallow path. Confirmed wrong
   against `~/.codex/sessions/2026/08/10/rollout-2026-08-10T11-45-40-019fe9fd-…jsonl`.
   §0.4 erratum 1 already records this; Task A4 carries a test asserting the
   shallow path is _not_ read, because a parser that reads it reports zero
   Codex usage while looking perfectly healthy.
2. **`~/.codex/archived_sessions/` is FLAT, not dated.** The spec writes
   `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and
   `~/.codex/archived_sessions/` together, which reads as the same layout. On
   the dev machine the archived directory holds 20 `rollout-*.jsonl` files
   directly, no year/month/day levels at all. A `read_dir` on
   `archived_sessions/YYYY/…` would find nothing and Codex history older than
   the retention window would silently vanish. Handled by walking both roots
   recursively.
3. **A Claude transcript's first line is never an assistant line, and one
   subagent file has no `sessionId` at all.** The spec says session identity is
   "read from the first line". Of 400 sampled top-level transcripts the first
   line is `last-prompt` / `mode` / `queue-operation` / `ai-title` /
   `bridge-session`, all of which do carry `sessionId`; of 200 subagent files,
   one opens with a `fork-context-ref` line that does not. Without a fallback
   that file has no identity and would be rescanned from zero on every poll.
   Resolved with an FNV-1a hash of the bounded head — a hash, not the head
   itself, because storing the bytes of a `type: "user"` line in the cache
   would break the spec's own privacy contract.
4. **Claude's `requestId` is sometimes absent.** 3 of 6941 real assistant usage
   lines (all `<synthetic>` model) have no `requestId`. The spec's dedupe key
   is `message.id` + `requestId` with no statement about a missing half. The
   plan keys on `id + "\u{1}" + ""` and only skips when _both_ halves are
   absent.
5. **The spec's "~2.5 GB" and 16 MB line claims are directionally right but
   the measured numbers differ.** `~/.claude/projects` 1.9 GB,
   `~/.codex/sessions` 681 MB. Largest line actually measured across the 40
   newest files of each: Claude 1 224 491 B, Codex 1 962 823 B — nothing near
   16 MB was observed, so `MAX_LINE_BYTES` is a guard that in practice never
   fires. That is fine; it is cheap. Worth knowing that the skip-and-count path
   is therefore **not** exercised by real data and only ever by the fixture in
   Task A7.
6. **One real Codex session has no `turn_context` line at all.** The spec says
   "the active model comes from the most recent `turn_context` line" and offers
   no fallback. That file also has zero `token_count` events, so nothing is
   lost today, but the code needs an answer regardless: it attributes to the
   `UNKNOWN_MODEL` constant, which the frontend prices as unknown and shows
   with a dash. `session_meta` is not an alternative — its payload carries no
   `model` key.

### (b) Things in the frozen §0 I believe are wrong

1. **§0.2.1's placement instruction for `mod usage;` is stale.** It says
   "declared last (alphabetically after `mod shell_integration;`)". At the
   revision §0 was written against, `lib.rs` had 13 modules ending in
   `window_lifecycle`; **`lib.rs` changed while this section was being
   written** and now declares 17: `agents, coordinator, images, info, links,
menu, menu_registry, migrate, pane_census, platform, prompt_assets, pty,
quit_flow, shell_integration, update_flight, window_close,
window_lifecycle`. `usage` is neither last nor immediately after
   `shell_integration`; its alphabetical slot is **between `update_flight` and
   `window_close`**. The plan instructs that placement and a fresh `Read` of
   `lib.rs` at execution time. The two-line budget is unaffected.
2. **§0.2.1's handler-list claim needs the same treatment.** `confirm_quit` has
   moved into `quit_flow` and the list gained `coordinator::*` and
   `quit_flow::cancel_quit`. The plan anchors the new entry after
   `prompt_assets::list_prompt_assets,` — an entry present in both revisions
   and, unlike the end of the list, not adjacent to the comma-less last item.
3. **§0.1's "nothing else in `src-tauri/src/` changes except the generated
   `menu_registry.rs`" is at odds with the working tree.** `coordinator.rs` is
   modified and three new modules (`pane_census`, `quit_flow`, `update_flight`,
   `window_close`) exist that §0's snapshot did not see. This does not conflict
   with Section A — the ownership is still disjoint — but the orchestrator's
   commit at the wave boundary must use explicit paths, because `git add -A` in
   this tree would sweep in another feature's in-flight work.
4. **§0.2.4 does not name `skippedLines`' accumulation window.** Making it
   per-scan would blank the UI note on every warm poll. This section makes it
   cumulative per file record and sums it at snapshot time. If §0 intended
   per-scan, that is a contract change and the frontend copy has to change with
   it.
5. **`UsageSource.files_scanned` has no definition in §0.** Defined here as the
   number of live cache records for that agent after reconciliation — stable
   across polls, and never zero merely because a warm poll opened no file.

### (c) Forks I hit and did NOT decide

1. **A single ~1 500-line `usage.rs` exceeds the 800-line ceiling in the global
   rules (C2/F8).** The frozen §0.6 gives Section A exactly one Rust file, and
   `coordinator.rs` (1829 lines), `links.rs` (993) and `pty.rs` (870) show the
   ceiling is already routinely passed in `src-tauri`. I kept the frozen
   contract. Splitting into `src-tauri/src/usage/{mod,reader,claude,codex,cache}.rs`
   is a one-hour mechanical change if the user wants the rule honoured, but it
   is a change to the file-ownership table and therefore not mine to make.
2. **A forked Codex session's first `token_count` replays its parent's
   inherited totals and is counted a second time.** The frozen delta rule
   (`previous` starts at zero for a new file) makes this unavoidable without a
   parent-child link the rollout format does not obviously carry. Not observed
   in the 460 rollouts on this machine — no two sessions share an id — but it
   is a real overcount if the user forks sessions. Deciding it needs a product
   call about whether to attempt parent detection at all.
3. **Codex `cache_write_input_tokens` is 0 in every event measured (1938
   events).** The counter is carried through faithfully, but nothing on this
   machine proves the mapping is right. If the user has never used a provider
   that charges for cache writes, the `cacheWrite` column will be permanently
   empty and its pricing path (Section B) will be untested by real data.
4. **Whether a poll that arrives mid-scan should re-poll.** This section
   returns the last published snapshot immediately. That is right for a 5 s
   poll, but Section B's store also needs to not issue a second request while
   one is in flight, or a cold scan on a slow disk will hand back the same
   stale snapshot repeatedly and the screen will look frozen rather than
   loading. That is Section B's contract, flagged here because it is only
   correct if both halves agree.

### (d) What I deliberately left out

1. **No `OpenCode`, `Gemini` or `agy` adapter.** `UsageAgent` is a two-variant
   enum and `ingest` is the seam; nothing more is built (spec, non-goals).
2. **No leap-second handling.** `parse_rfc3339_ms` refuses `:60`. RFC3339
   permits it, Unix time has no representation for it, no leap second is
   scheduled, and neither CLI has ever written one. A refusal costs one skipped
   line in a scenario that has not occurred since 2016.
3. **No pre-1970 timestamps.** `parse_rfc3339_ms` returns `None` for them
   rather than widening the payload to `i64`. A transcript dated before the
   epoch is a corrupt clock, not history worth charting.
4. **No symlink following.** Both discovery walks refuse symlinked files and
   directories — the `prompt_assets.rs:247-263` rule. A symlinked transcript
   outside the scanned tree is invisible. This also removes any possibility of
   a directory loop making the walk non-terminating, on top of
   `MAX_WALK_DEPTH`.
5. **No `usage.iterations` summation, and no `reasoning_output_tokens`
   addition.** Both would double-count (§0.4 erratum 4; the spec's own note
   that Codex `output_tokens` already includes reasoning). Task A3 and A4 each
   carry a test that fails if someone adds them back.
6. **No cross-file dedupe for compacted Claude files.** A compacted file has no
   per-message map left to compare against. The spec's own reasoning covers it
   — "reappearing keys only matter in files that grow" — and a compacted file
   is by definition one that has not grown in 48 hours. Documented at the merge
   site rather than silently accepted.
7. **No cache size cap beyond compaction.** A machine with a hundred thousand
   _active_ transcripts younger than 48 hours would hold a large map in memory.
   Not reachable from any realistic corpus: this machine's 1410 transcripts
   produce a cache in the low megabytes.
8. **No Windows verification.** `crate::platform::user_home()` resolves
   `USERPROFILE`, and the code is correct-by-construction if
   `%USERPROFILE%\.claude` and `.codex` mirror macOS. If they do not, both
   sources report `missing` and the screen says "no data yet" — the accepted
   residual risk in §0.5. Nothing in this section assumes a path separator.
9. **No `pty_info` or pane linkage of any kind.** Per-pane attribution was
   deliberately rejected by the spec, and this module never touches the PTY
   state.

---

# Section B — Frontend data, pricing and client

Wave 1, runs in parallel with Section A. Nothing here imports from
`src-tauri`, and nothing here touches a file Section A, C or D owns.

**Files this section creates:** `src/lib/usage-snapshot.ts` ·
`src/lib/usage-pricing-snapshot.ts` · `src/lib/usage-pricing.ts` ·
`src/lib/usage-aggregate.ts` · `src/usage/usage-client.ts` ·
`src/usage/usage-store.ts` · a colocated `.test.ts` for each ·
`scripts/refresh-usage-pricing.mjs` · `scripts/refresh-usage-pricing.test.ts`.
**Modifies:** `package.json` — exactly one line.

`src/usage/` does not exist yet; Task B5 creates it.

---

## Verified source facts this section builds on

Read at working-tree HEAD `69abe81` on 2026-08-10. Re-read before editing —
line anchors drift.

| Fact                                                                                                                                                                                                                                         | Where                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The client seam is an interface + `createTauri…Client()` + `createMemory…Client(value?, options?)` + a `default…Client` const. Section B copies it verbatim.                                                                                 | `src/prompts/prompt-assets-client.ts:22-52`                                                                 |
| The canonical Tauri mock is a module-scope `vi.fn()` re-exported through `vi.mock("@tauri-apps/api/core")`, declared **above** the import under test.                                                                                        | `src/prompts/prompt-assets-client.test.ts:3-6`                                                              |
| A pure `src/lib/` module opens with a docblock that states its purity ("Pure — no signals, no Tauri, no DOM") and explains the load-bearing invariant.                                                                                       | `src/lib/agent-catalog.ts:1-10`                                                                             |
| Lookups into a string-keyed object literal are guarded with `Object.prototype.hasOwnProperty.call` — object literals inherit from `Object.prototype`.                                                                                        | `src/lib/process-info.ts:34-40`                                                                             |
| A poller's `start()` is a no-op while already running and `stop()` clears the handle; the failure path keeps the last known values and never breaks the loop.                                                                                | `src/terminal/pane-info-poller.ts:66-105`                                                                   |
| Module stores are window-scoped `signal()` at module top level (R5).                                                                                                                                                                         | `src/settings/logo-store.ts:17`                                                                             |
| A `scripts/*.mjs` guards its CLI entry with `import.meta.url === pathToFileURL(process.argv[1]).href`, writes to stdout, and sets `process.exitCode = 1`.                                                                                    | `scripts/generate-release-notes.mjs:550-561`                                                                |
| A `scripts/*.test.ts` (vitest, TypeScript) imports the `.mjs` directly by its `.mjs` specifier.                                                                                                                                              | `scripts/generate-release-notes.test.ts:1-12`                                                               |
| `npm test` is `vitest run` with two `--exclude`s for `.test.mjs` files only — a new `scripts/*.test.ts` is picked up automatically.                                                                                                          | `package.json:21`                                                                                           |
| `"preview:updater": "node scripts/capture-updater-preview.mjs"` is the precedent for a manually-run node script.                                                                                                                             | `package.json:16`                                                                                           |
| `tsconfig.json` has `"include": ["src"]`, so `scripts/**` is **not** typechecked by `npm run build`, but every `src/**/*.test.ts` **is**.                                                                                                    | `tsconfig.json`                                                                                             |
| `strict`, `noUnusedLocals`, `noUnusedParameters` are on. Every test file under `src/` must be strict-clean or `npm run build` goes red.                                                                                                      | `tsconfig.json`                                                                                             |
| There is no `vitest.config.ts` and `vite.config.ts` has no `test` key — default environment is `node`. No file in this section needs jsdom.                                                                                                  | `vite.config.ts`                                                                                            |
| No `prettier` dependency, no prettier config, no `.vscode` formatter setting, no `lint` script, and 522 lines in `src/` already exceed 80 columns.                                                                                           | `package.json`, `.vscode/` (only `extensions.json`)                                                         |
| **There is no `@types/node`**, `lib` is `ES2020` + DOM only, no `types` key — and no file under `src/` references `process`. `process` in a `src/` test is a `tsc` error.                                                                    | `package.json` devDependencies, `tsconfig.json`, `node_modules/@types/` (only `chai`, `deep-eql`, `estree`) |
| Setting `process.env.TZ` at runtime re-notifies V8's date configuration in Node 24 — verified inside this repo's own vitest 3.2.6 (see Task B4, point 3-4).                                                                                 | measured 2026-08-10                                                                                         |
| Every module and test in this section was written out and run for real before this plan was finalised: 7 files, **86 tests passing**, `tsc -p tsconfig.json` exit 0, and the generated snapshot byte-identical to the script's own renderer. | measured 2026-08-10                                                                                         |

---

## What this section produces for later sections

Section C's author reads only their own section. Everything C needs from B is
restated here in full.

### `src/lib/usage-snapshot.ts` (pure)

```ts
export type UsageAgent = "claude" | "codex";
export type UsageSourceState = "ok" | "missing" | "unreadable";
export interface UsageCounters {
  readonly inputUncached: number;
  readonly cacheRead: number;
  readonly cacheCreate5m: number;
  readonly cacheCreate1h: number;
  readonly cacheWrite: number;
  readonly output: number;
}
export interface UsageSource {
  readonly agent: UsageAgent;
  readonly state: UsageSourceState;
  readonly filesScanned: number;
}
export interface UsageBucket {
  readonly bucketStartMs: number;
  readonly agent: UsageAgent;
  readonly model: string;
  readonly counters: UsageCounters;
}
export interface UsageSnapshot {
  readonly scannedAtMs: number;
  readonly buckets: readonly UsageBucket[];
  readonly sources: readonly UsageSource[];
  readonly skippedLines: number;
}
export const EMPTY_COUNTERS: UsageCounters;
export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot;
export function addCounters(
  left: UsageCounters,
  right: UsageCounters,
): UsageCounters;
export function totalTokens(counters: UsageCounters): number;
```

`totalTokens` sums all six classes and that is a **real** total, not a
double count: `usage.rs` stores `input_uncached = input − cached` precisely
because Codex reports `cached_input_tokens` as a subset of `input_tokens`.

`EMPTY_USAGE_SNAPSHOT.sources` is **not** `[]` — it carries both agents in
the `missing` state, so the frozen "exactly two entries, Claude then Codex"
invariant holds everywhere C looks, including in the default fake.

### `src/lib/usage-pricing-snapshot.ts` (pure, generated)

```ts
export interface ModelPricing {
  readonly inputPerToken: number;
  readonly outputPerToken: number;
  readonly cacheReadPerToken: number | null;
  readonly cacheWritePerToken: number | null;
}
export const PRICING_SNAPSHOT_DATE: string; // "2026-08-10"
export const PRICING_SOURCE_URL: string;
export const PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>>; // 84 models
```

C shows `PRICING_SNAPSHOT_DATE` beside every dollar figure, together with the
words "estimated at API prices" (spec §Decisions 1).

### `src/lib/usage-pricing.ts` (pure)

```ts
export function estimateCostUsd(
  model: string,
  counters: UsageCounters,
): number | null;
export function isPricedModel(model: string): boolean;
export function formatUsd(value: number): string;
```

`formatUsd` is the house dollar format, defined by this section because
nothing in `src/` formats a number today (no `Intl`, no `toFixed` anywhere):

| Input               | Output      | Why                                                         |
| ------------------- | ----------- | ----------------------------------------------------------- |
| `0` (or ≤ 0)        | `$0.00`     | the canonical zero                                          |
| `0 < v < 0.0001`    | `< $0.0001` | four decimals would round it to `$0.0000`, which reads zero |
| `0.0001 ≤ v < 0.01` | `$0.0042`   | a cheap day must not render as `$0.00`                      |
| `v ≥ 0.01`          | `$1,234.50` | two decimals, `en-US` grouping                              |

C must render a `costUsd` of `null` as `—` (spec §Pricing) — **never** by
passing `null` through `formatUsd`.

### `src/lib/usage-aggregate.ts` (pure)

```ts
export interface AgentTotal {
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}
export interface DailyRow {
  readonly day: string; // local calendar day, "YYYY-MM-DD"
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}
export interface BreakdownRow {
  readonly agent: UsageAgent;
  readonly model: string; // raw string, verbatim
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
}
export function localDayKey(utcMs: number): string;
export function agentTotals(
  buckets: readonly UsageBucket[],
  sinceMs: number | null,
): readonly AgentTotal[];
export function dailyRows(
  buckets: readonly UsageBucket[],
  days: number,
  nowMs: number,
): readonly DailyRow[];
export function breakdownRows(
  buckets: readonly UsageBucket[],
): readonly BreakdownRow[];
```

Contract details C depends on:

- **`agentTotals` returns a row only for an agent that has data in range.**
  It is a lookup, not a layout. C renders both agent slots from
  `snapshot.sources` (frozen: exactly two entries, Claude then Codex) and
  falls back to `EMPTY_COUNTERS` / `costUsd: null` for an agent with no row.
- **"Today" is the caller's** — `agentTotals(buckets, sinceMs)` filters out
  buckets with `bucketStartMs < sinceMs`. For the overview's "today" card C
  passes the local midnight that starts today; for "recorded history" it
  passes `null`.
- **`dailyRows` sort order is day descending, then agent ascending.**
  One row per `(day, agent)` that has data — no zero-filled rows.
- **`breakdownRows` sort order is agent ascending, then raw model ascending.**
- **`costUsd` is `null` when any contributing model is unpriced**, and
  `unpricedModels` lists them deduped and ascending (§0.3 decision 8). A
  model whose counters are all zero contributes `0` and is **not** listed as
  unpriced — see Findings (a), `<synthetic>`.
- **The `30` in "last 30 local days" is not exported by B.** §0.2.5 freezes
  this module's export list and the constant is not on it, so C declares its
  own named const (C9) and passes it as `days`.

### `src/usage/usage-client.ts`

```ts
export interface UsageClient {
  snapshot(): Promise<UsageSnapshot>;
}
export function createTauriUsageClient(): UsageClient;
export function createMemoryUsageClient(
  snapshot?: UsageSnapshot,
  options?: { readonly fail?: boolean },
): UsageClient;
export const defaultUsageClient: UsageClient;
```

`snapshot()` rejects **only** when the Rust worker panicked (§0.3 decision 5).
Every ordinary failure arrives in-band.

### `src/usage/usage-store.ts`

```ts
export const usageSnapshot: Signal<UsageSnapshot | null>;
export const usageStale: Signal<boolean>;
export const usageLoading: Signal<boolean>;
export function startUsagePolling(client?: UsageClient): void;
export function stopUsagePolling(): void;
```

The three-signal state machine, spelled out because C renders every cell of
it:

| `usageSnapshot` | `usageLoading` | `usageStale` | What C shows                                                |
| --------------- | -------------- | ------------ | ----------------------------------------------------------- |
| `null`          | `true`         | `false`      | cold scan running — the loading state                       |
| `null`          | `false`        | `true`       | the first scan failed; the poll is still retrying every 5 s |
| snapshot        | `false`        | `false`      | live data                                                   |
| snapshot        | `false`        | `true`       | last good data, with the "stale" note (spec §Surface)       |

- **`usageStale` means one thing only: `snapshot()` rejected.** It does not
  mean "no data". Missing or unreadable transcript directories arrive
  in-band through `sources[].state` and C must render those separately —
  `missing` → "no data yet", `unreadable` → an error state (spec §Error
  handling, major M7). Conflating them is the exact mistake M7 names.
- **A failed poll never blanks the screen.** `usageSnapshot` keeps its last
  good value.
- **`usageLoading` is only ever true for a cold scan** (when
  `usageSnapshot.value === null`), so the screen does not flash a spinner
  every five seconds.
- **`startUsagePolling` fetches immediately, then every 5 s.** Calling it
  again while already polling is a no-op — no second timer, no second fetch.
- **`stopUsagePolling` is idempotent** and discards any scan still in flight.
- **The shell never unmounts.** `UsageScreen` follows `SettingsScreen`, which
  stays mounted and is driven by an `open` prop. C must therefore drive the
  poll from `open` — start when it becomes true, stop when it becomes false —
  and the store is built to survive that being called repeatedly in any order.

---

## Task order

Each task depends only on the ones before it.

| Task | Produces                                                      | Depends on |
| ---- | ------------------------------------------------------------- | ---------- |
| B1   | `usage-snapshot.ts` — the payload mirror and counter algebra  | —          |
| B2   | `usage-pricing-snapshot.ts` — the checked-in LiteLLM data     | —          |
| B3   | `usage-pricing.ts` — the cost math and the dollar format      | B1, B2     |
| B4   | `usage-aggregate.ts` — local days and the three row builders  | B1, B3     |
| B5   | `usage/usage-client.ts` — the IPC seam                        | B1         |
| B6   | `usage/usage-store.ts` — signals and the poll lifecycle       | B1, B5     |
| B7   | `scripts/refresh-usage-pricing.mjs` + the `package.json` line | B2         |

---

### Task B1: The payload mirror and the counter algebra

**Files:**

- Create: `src/lib/usage-snapshot.ts`
- Create: `src/lib/usage-snapshot.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: the types in §0.2.3, plus `EMPTY_COUNTERS`,
  `EMPTY_USAGE_SNAPSHOT`, `addCounters`, `totalTokens`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addCounters,
  EMPTY_COUNTERS,
  EMPTY_USAGE_SNAPSHOT,
  totalTokens,
  type UsageCounters,
} from "./usage-snapshot";

const counters = (patch: Partial<UsageCounters> = {}): UsageCounters => ({
  inputUncached: 1,
  cacheRead: 2,
  cacheCreate5m: 3,
  cacheCreate1h: 4,
  cacheWrite: 5,
  output: 6,
  ...patch,
});

describe("EMPTY_COUNTERS", () => {
  it("is the additive identity on both sides", () => {
    expect(addCounters(counters(), EMPTY_COUNTERS)).toEqual(counters());
    expect(addCounters(EMPTY_COUNTERS, counters())).toEqual(counters());
  });

  it("totals zero", () => {
    expect(totalTokens(EMPTY_COUNTERS)).toBe(0);
  });
});

describe("addCounters", () => {
  it("sums every counter class separately", () => {
    expect(addCounters(counters(), counters())).toEqual({
      inputUncached: 2,
      cacheRead: 4,
      cacheCreate5m: 6,
      cacheCreate1h: 8,
      cacheWrite: 10,
      output: 12,
    });
  });

  it("returns a new object and mutates neither argument", () => {
    const left = counters();
    const right = counters({ output: 0 });
    const sum = addCounters(left, right);

    expect(sum).not.toBe(left);
    expect(sum).not.toBe(right);
    expect(left).toEqual(counters());
    expect(right).toEqual(counters({ output: 0 }));
  });
});

describe("totalTokens", () => {
  it("adds all six classes", () => {
    expect(totalTokens(counters())).toBe(21);
  });

  it("counts a Codex-shaped bucket once, not twice", () => {
    // usage.rs stores input_uncached = input - cached, so a Codex event with
    // input 100 of which 40 were cached becomes 60 + 40 and totals 100.
    expect(
      totalTokens(
        counters({
          inputUncached: 60,
          cacheRead: 40,
          cacheCreate5m: 0,
          cacheCreate1h: 0,
          cacheWrite: 0,
          output: 0,
        }),
      ),
    ).toBe(100);
  });
});

describe("EMPTY_USAGE_SNAPSHOT", () => {
  it("still carries both sources, so the two-entry invariant always holds", () => {
    expect(EMPTY_USAGE_SNAPSHOT.sources).toEqual([
      { agent: "claude", state: "missing", filesScanned: 0 },
      { agent: "codex", state: "missing", filesScanned: 0 },
    ]);
  });

  it("has no buckets, no skipped lines and no scan time", () => {
    expect(EMPTY_USAGE_SNAPSHOT.buckets).toEqual([]);
    expect(EMPTY_USAGE_SNAPSHOT.skippedLines).toBe(0);
    expect(EMPTY_USAGE_SNAPSHOT.scannedAtMs).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/usage-snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-snapshot" from "src/lib/usage-snapshot.test.ts". Does the file exist?`

- [ ] **Step 3: Write `src/lib/usage-snapshot.ts`**

```ts
/**
 * The `usage_snapshot` payload mirrored in TypeScript, plus the two counter
 * operations every rollup needs. Pure — no signals, no Tauri, no DOM.
 *
 * The field names here are the camelCase serde output of the Rust structs in
 * `src-tauri/src/usage.rs`. Nothing in TypeScript can catch a rename on the
 * Rust side; the serialization-contract test in that module is what does.
 *
 * The six counters never overlap, so summing them is a real token total. That
 * is a property of the Rust mapping and not a coincidence: Codex reports
 * `cached_input_tokens` as a SUBSET of `input_tokens`, and `usage.rs` stores
 * `input_uncached = input - cached` precisely so nothing is counted twice.
 */

export type UsageAgent = "claude" | "codex";
export type UsageSourceState = "ok" | "missing" | "unreadable";

export interface UsageCounters {
  readonly inputUncached: number;
  readonly cacheRead: number;
  readonly cacheCreate5m: number;
  readonly cacheCreate1h: number;
  readonly cacheWrite: number;
  readonly output: number;
}

export interface UsageSource {
  readonly agent: UsageAgent;
  readonly state: UsageSourceState;
  readonly filesScanned: number;
}

export interface UsageBucket {
  /** Unix ms at the start of the 15-minute UTC bucket. */
  readonly bucketStartMs: number;
  readonly agent: UsageAgent;
  /** The raw model string, verbatim — no canonicalization in Rust. */
  readonly model: string;
  readonly counters: UsageCounters;
}

/** Mirror of the Rust `UsageSnapshot` payload from the `usage_snapshot` command. */
export interface UsageSnapshot {
  /** Unix ms when the scan finished. */
  readonly scannedAtMs: number;
  /** Sorted by (bucketStartMs, agent, model) so the payload is stable. */
  readonly buckets: readonly UsageBucket[];
  /** Exactly two entries, Claude then Codex. */
  readonly sources: readonly UsageSource[];
  readonly skippedLines: number;
}

export const EMPTY_COUNTERS: UsageCounters = {
  inputUncached: 0,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheWrite: 0,
  output: 0,
};

/**
 * The "nothing found" snapshot, used as the default for the in-memory client.
 *
 * `sources` carries both agents in the `missing` state rather than an empty
 * array: the payload's "exactly two entries" invariant is what lets the screen
 * render an agent slot without a presence check, and a constant that quietly
 * breaks it would only fail in the one code path nobody exercises.
 */
export const EMPTY_USAGE_SNAPSHOT: UsageSnapshot = {
  scannedAtMs: 0,
  buckets: [],
  sources: [
    { agent: "claude", state: "missing", filesScanned: 0 },
    { agent: "codex", state: "missing", filesScanned: 0 },
  ],
  skippedLines: 0,
};

/** Field-wise sum. Returns a new object; neither argument is touched (C1). */
export function addCounters(
  left: UsageCounters,
  right: UsageCounters,
): UsageCounters {
  return {
    inputUncached: left.inputUncached + right.inputUncached,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheCreate5m: left.cacheCreate5m + right.cacheCreate5m,
    cacheCreate1h: left.cacheCreate1h + right.cacheCreate1h,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    output: left.output + right.output,
  };
}

/** Every token in the bucket. Safe to add up — see the module comment. */
export function totalTokens(counters: UsageCounters): number {
  return (
    counters.inputUncached +
    counters.cacheRead +
    counters.cacheCreate5m +
    counters.cacheCreate1h +
    counters.cacheWrite +
    counters.output
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/usage-snapshot.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Report the task complete**

Files touched: `src/lib/usage-snapshot.ts` (created),
`src/lib/usage-snapshot.test.ts` (created).

---

### Task B2: The checked-in LiteLLM pricing snapshot

**Files:**

- Create: `src/lib/usage-pricing-snapshot.ts`
- Create: `src/lib/usage-pricing-snapshot.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ModelPricing`, `PRICING_SNAPSHOT`, `PRICING_SNAPSHOT_DATE`,
  `PRICING_SOURCE_URL`.

The module body below is **real data**, fetched from
`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
on 2026-08-10 (HTTP 200, 1 676 411 bytes) and rendered by the exact
`renderSnapshotModule` that Task B7 checks in. Paste it verbatim. Do not
retype a number, and do not reorder a row — Task B7's round-trip test compares
this file byte-for-byte against the renderer's output.

The test in this task deliberately asserts **presence and structure, never a
price**. A price genuinely changing is what a refresh is for; a test that
pins prices would have to be hand-edited on every refresh, and a test people
routinely edit stops being a tripwire.

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage-pricing-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PRICING_SNAPSHOT,
  PRICING_SNAPSHOT_DATE,
  PRICING_SOURCE_URL,
} from "./usage-pricing-snapshot";

/**
 * Every model id the Claude Code and Codex CLIs on the dev machine had
 * actually written into their transcripts as of 2026-08-10 — with the single
 * exception of `<synthetic>`, which is Claude Code's marker for a locally
 * produced message and is deliberately unpriced (it always carries zero
 * tokens; see `usage-pricing.ts`).
 *
 * This list is the tripwire for a refresh that drops a provider tag or
 * renames a cost field upstream: the regenerated snapshot would still parse,
 * still typecheck, and quietly price nothing.
 */
const OBSERVED_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.1-codex-mini",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];

/** A refresh that halves the catalog is a bug, not a price change. */
const MIN_MODELS = 40;

describe("PRICING_SNAPSHOT", () => {
  it("prices every model these two CLIs have actually emitted here", () => {
    const missing = OBSERVED_MODELS.filter(
      (model) => PRICING_SNAPSHOT[model] === undefined,
    );

    expect(missing).toEqual([]);
  });

  it("still holds a plausible number of models", () => {
    expect(Object.keys(PRICING_SNAPSHOT).length).toBeGreaterThanOrEqual(
      MIN_MODELS,
    );
  });

  it("gives every model a finite, non-negative input and output rate", () => {
    const broken = Object.entries(PRICING_SNAPSHOT).filter(
      ([, pricing]) =>
        !Number.isFinite(pricing.inputPerToken) ||
        !Number.isFinite(pricing.outputPerToken) ||
        pricing.inputPerToken < 0 ||
        pricing.outputPerToken < 0,
    );

    expect(broken.map(([model]) => model)).toEqual([]);
  });

  it("keeps cache rates either null or a finite, non-negative number", () => {
    const broken = Object.entries(PRICING_SNAPSHOT).filter(([, pricing]) =>
      [pricing.cacheReadPerToken, pricing.cacheWritePerToken].some(
        (rate) => rate !== null && (!Number.isFinite(rate) || rate < 0),
      ),
    );

    expect(broken.map(([model]) => model)).toEqual([]);
  });

  it("never prices output below input or a cache read above input", () => {
    // Both hold for all 84 models as fetched. A violation means the renderer
    // mixed two models' fields up, which no other assertion here would catch.
    const suspicious = Object.entries(PRICING_SNAPSHOT).filter(
      ([, pricing]) =>
        pricing.outputPerToken < pricing.inputPerToken ||
        (pricing.cacheReadPerToken !== null &&
          pricing.cacheReadPerToken > pricing.inputPerToken),
    );

    expect(suspicious.map(([model]) => model)).toEqual([]);
  });

  it("is sorted by model id, so a hand-appended row is visible", () => {
    const ids = Object.keys(PRICING_SNAPSHOT);

    expect(ids).toEqual([...ids].sort());
  });
});

describe("snapshot provenance", () => {
  it("records the retrieval date as YYYY-MM-DD", () => {
    expect(PRICING_SNAPSHOT_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("records where the numbers came from", () => {
    expect(PRICING_SOURCE_URL).toBe(
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/usage-pricing-snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-pricing-snapshot" from "src/lib/usage-pricing-snapshot.test.ts". Does the file exist?`

This block is fenced as `text`, not `ts`, purely so no markdown
formatter can reflow it — the bytes have to survive into the repo exactly.
The file itself is TypeScript. One row per model is deliberate: it is a data
table, and 84 models cost 121 lines this way against 534 expanded. The repo
ships no formatter (no `prettier` dependency, no config, no editor setting,
and 522 lines under `src/` already exceed 80 columns), so nothing will
reflow it in place either.

- [ ] **Step 3: Create `src/lib/usage-pricing-snapshot.ts` with exactly this content**

```text
/**
 * GENERATED FILE — rewritten wholesale by `npm run refresh:pricing`
 * (`scripts/refresh-usage-pricing.mjs`). Do not edit by hand.
 *
 * Data only. The pricing math lives in `usage-pricing.ts`, so a script that
 * overwrites a whole file can never destroy hand-written logic — the same
 * discipline `menu_registry.rs` already uses.
 *
 * USD per token, from LiteLLM's published catalog, filtered to the Anthropic
 * and OpenAI model families the Claude Code and Codex CLIs can emit. These
 * are list prices for direct API use; a subscription user does not pay them,
 * which is why every figure on screen is labelled an estimate and carries
 * `PRICING_SNAPSHOT_DATE`.
 */

export interface ModelPricing {
  /** USD per uncached input token. */
  readonly inputPerToken: number;
  /** USD per output token, reasoning tokens included. */
  readonly outputPerToken: number;
  /** USD per cache-read token; null when the provider publishes no cache rate. */
  readonly cacheReadPerToken: number | null;
  /** USD per cache-write token; null when the provider publishes no cache rate. */
  readonly cacheWritePerToken: number | null;
}

/** Retrieval date of the table below. Shown beside every dollar figure. */
export const PRICING_SNAPSHOT_DATE = "2026-08-10";

/** Where the numbers came from, so a reader can check them. */
export const PRICING_SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** Exact model-id match only — no aliasing, no prefix fallback (spec §Pricing). */
export const PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>> = {
  "claude-3-7-sonnet-20250219": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-3-haiku-20240307": { inputPerToken: 2.5e-7, outputPerToken: 0.00000125, cacheReadPerToken: 3e-8, cacheWritePerToken: 3e-7 },
  "claude-3-opus-20240229": { inputPerToken: 0.000015, outputPerToken: 0.000075, cacheReadPerToken: 0.0000015, cacheWritePerToken: 0.00001875 },
  "claude-4-opus-20250514": { inputPerToken: 0.000015, outputPerToken: 0.000075, cacheReadPerToken: 0.0000015, cacheWritePerToken: 0.00001875 },
  "claude-4-sonnet-20250514": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-fable-5": { inputPerToken: 0.00001, outputPerToken: 0.00005, cacheReadPerToken: 0.000001, cacheWritePerToken: 0.0000125 },
  "claude-haiku-4-5": { inputPerToken: 0.000001, outputPerToken: 0.000005, cacheReadPerToken: 1e-7, cacheWritePerToken: 0.00000125 },
  "claude-haiku-4-5-20251001": { inputPerToken: 0.000001, outputPerToken: 0.000005, cacheReadPerToken: 1e-7, cacheWritePerToken: 0.00000125 },
  "claude-opus-4-1": { inputPerToken: 0.000015, outputPerToken: 0.000075, cacheReadPerToken: 0.0000015, cacheWritePerToken: 0.00001875 },
  "claude-opus-4-1-20250805": { inputPerToken: 0.000015, outputPerToken: 0.000075, cacheReadPerToken: 0.0000015, cacheWritePerToken: 0.00001875 },
  "claude-opus-4-20250514": { inputPerToken: 0.000015, outputPerToken: 0.000075, cacheReadPerToken: 0.0000015, cacheWritePerToken: 0.00001875 },
  "claude-opus-4-5": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-5-20251101": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-6": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-6-20260205": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-7": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-7-20260416": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-4-8": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-opus-5": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "claude-sonnet-4-20250514": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-sonnet-4-5": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-sonnet-4-5-20250929": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-sonnet-4-6": { inputPerToken: 0.000003, outputPerToken: 0.000015, cacheReadPerToken: 3e-7, cacheWritePerToken: 0.00000375 },
  "claude-sonnet-5": { inputPerToken: 0.000002, outputPerToken: 0.00001, cacheReadPerToken: 2e-7, cacheWritePerToken: 0.0000025 },
  "codex-mini-latest": { inputPerToken: 0.0000015, outputPerToken: 0.000006, cacheReadPerToken: 3.75e-7, cacheWritePerToken: null },
  "gpt-5": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-2025-08-07": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-chat": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-chat-latest": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-codex": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-mini": { inputPerToken: 2.5e-7, outputPerToken: 0.000002, cacheReadPerToken: 2.5e-8, cacheWritePerToken: null },
  "gpt-5-mini-2025-08-07": { inputPerToken: 2.5e-7, outputPerToken: 0.000002, cacheReadPerToken: 2.5e-8, cacheWritePerToken: null },
  "gpt-5-nano": { inputPerToken: 5e-8, outputPerToken: 4e-7, cacheReadPerToken: 5e-9, cacheWritePerToken: null },
  "gpt-5-nano-2025-08-07": { inputPerToken: 5e-8, outputPerToken: 4e-7, cacheReadPerToken: 5e-9, cacheWritePerToken: null },
  "gpt-5-pro": { inputPerToken: 0.000015, outputPerToken: 0.00012, cacheReadPerToken: null, cacheWritePerToken: null },
  "gpt-5-pro-2025-10-06": { inputPerToken: 0.000015, outputPerToken: 0.00012, cacheReadPerToken: null, cacheWritePerToken: null },
  "gpt-5-search-api": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5-search-api-2025-10-14": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1-2025-11-13": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1-chat-latest": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1-codex": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1-codex-max": { inputPerToken: 0.00000125, outputPerToken: 0.00001, cacheReadPerToken: 1.25e-7, cacheWritePerToken: null },
  "gpt-5.1-codex-mini": { inputPerToken: 2.5e-7, outputPerToken: 0.000002, cacheReadPerToken: 2.5e-8, cacheWritePerToken: null },
  "gpt-5.2": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.2-2025-12-11": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.2-chat-latest": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.2-codex": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.2-pro": { inputPerToken: 0.000021, outputPerToken: 0.000168, cacheReadPerToken: null, cacheWritePerToken: null },
  "gpt-5.2-pro-2025-12-11": { inputPerToken: 0.000021, outputPerToken: 0.000168, cacheReadPerToken: null, cacheWritePerToken: null },
  "gpt-5.3-chat-latest": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.3-codex": { inputPerToken: 0.00000175, outputPerToken: 0.000014, cacheReadPerToken: 1.75e-7, cacheWritePerToken: null },
  "gpt-5.4": { inputPerToken: 0.0000025, outputPerToken: 0.000015, cacheReadPerToken: 2.5e-7, cacheWritePerToken: null },
  "gpt-5.4-2026-03-05": { inputPerToken: 0.0000025, outputPerToken: 0.000015, cacheReadPerToken: 2.5e-7, cacheWritePerToken: null },
  "gpt-5.4-mini": { inputPerToken: 7.5e-7, outputPerToken: 0.0000045, cacheReadPerToken: 7.5e-8, cacheWritePerToken: null },
  "gpt-5.4-mini-2026-03-17": { inputPerToken: 7.5e-7, outputPerToken: 0.0000045, cacheReadPerToken: 7.5e-8, cacheWritePerToken: null },
  "gpt-5.4-nano": { inputPerToken: 2e-7, outputPerToken: 0.00000125, cacheReadPerToken: 2e-8, cacheWritePerToken: null },
  "gpt-5.4-nano-2026-03-17": { inputPerToken: 2e-7, outputPerToken: 0.00000125, cacheReadPerToken: 2e-8, cacheWritePerToken: null },
  "gpt-5.4-pro": { inputPerToken: 0.00003, outputPerToken: 0.00018, cacheReadPerToken: 0.000003, cacheWritePerToken: null },
  "gpt-5.4-pro-2026-03-05": { inputPerToken: 0.00003, outputPerToken: 0.00018, cacheReadPerToken: 0.000003, cacheWritePerToken: null },
  "gpt-5.5": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
  "gpt-5.5-2026-04-23": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
  "gpt-5.5-pro": { inputPerToken: 0.00003, outputPerToken: 0.00018, cacheReadPerToken: 0.000003, cacheWritePerToken: null },
  "gpt-5.5-pro-2026-04-23": { inputPerToken: 0.00003, outputPerToken: 0.00018, cacheReadPerToken: 0.000003, cacheWritePerToken: null },
  "gpt-5.6": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "gpt-5.6-luna": { inputPerToken: 2e-7, outputPerToken: 0.0000012, cacheReadPerToken: 2e-8, cacheWritePerToken: 2.5e-7 },
  "gpt-5.6-sol": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },
  "gpt-5.6-terra": { inputPerToken: 0.000002, outputPerToken: 0.000012, cacheReadPerToken: 2e-7, cacheWritePerToken: 0.0000025 },
  "o1": { inputPerToken: 0.000015, outputPerToken: 0.00006, cacheReadPerToken: 0.0000075, cacheWritePerToken: null },
  "o1-2024-12-17": { inputPerToken: 0.000015, outputPerToken: 0.00006, cacheReadPerToken: 0.0000075, cacheWritePerToken: null },
  "o1-pro": { inputPerToken: 0.00015, outputPerToken: 0.0006, cacheReadPerToken: null, cacheWritePerToken: null },
  "o1-pro-2025-03-19": { inputPerToken: 0.00015, outputPerToken: 0.0006, cacheReadPerToken: null, cacheWritePerToken: null },
  "o3": { inputPerToken: 0.000002, outputPerToken: 0.000008, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
  "o3-2025-04-16": { inputPerToken: 0.000002, outputPerToken: 0.000008, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
  "o3-deep-research": { inputPerToken: 0.00001, outputPerToken: 0.00004, cacheReadPerToken: 0.0000025, cacheWritePerToken: null },
  "o3-deep-research-2025-06-26": { inputPerToken: 0.00001, outputPerToken: 0.00004, cacheReadPerToken: 0.0000025, cacheWritePerToken: null },
  "o3-mini": { inputPerToken: 0.0000011, outputPerToken: 0.0000044, cacheReadPerToken: 5.5e-7, cacheWritePerToken: null },
  "o3-mini-2025-01-31": { inputPerToken: 0.0000011, outputPerToken: 0.0000044, cacheReadPerToken: 5.5e-7, cacheWritePerToken: null },
  "o3-pro": { inputPerToken: 0.00002, outputPerToken: 0.00008, cacheReadPerToken: null, cacheWritePerToken: null },
  "o3-pro-2025-06-10": { inputPerToken: 0.00002, outputPerToken: 0.00008, cacheReadPerToken: null, cacheWritePerToken: null },
  "o4-mini": { inputPerToken: 0.0000011, outputPerToken: 0.0000044, cacheReadPerToken: 2.75e-7, cacheWritePerToken: null },
  "o4-mini-2025-04-16": { inputPerToken: 0.0000011, outputPerToken: 0.0000044, cacheReadPerToken: 2.75e-7, cacheWritePerToken: null },
  "o4-mini-deep-research": { inputPerToken: 0.000002, outputPerToken: 0.000008, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
  "o4-mini-deep-research-2025-06-26": { inputPerToken: 0.000002, outputPerToken: 0.000008, cacheReadPerToken: 5e-7, cacheWritePerToken: null },
};
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/usage-pricing-snapshot.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Report the task complete**

Files touched: `src/lib/usage-pricing-snapshot.ts` (created),
`src/lib/usage-pricing-snapshot.test.ts` (created).

---

### Task B3: Cost estimation and the dollar format

**Files:**

- Create: `src/lib/usage-pricing.ts`
- Create: `src/lib/usage-pricing.test.ts`

**Interfaces:**

- Consumes: `UsageCounters` + `totalTokens` (B1), `PRICING_SNAPSHOT` +
  `ModelPricing` (B2).
- Produces: `estimateCostUsd`, `isPricedModel`, `formatUsd`.

Rates, from spec §Pricing:

| Counter         | Rate                                          |
| --------------- | --------------------------------------------- |
| `inputUncached` | `inputPerToken`                               |
| `cacheRead`     | `cacheReadPerToken ?? inputPerToken`          |
| `cacheCreate5m` | `cacheWritePerToken ?? inputPerToken`         |
| `cacheCreate1h` | `inputPerToken × 2` (Anthropic's 1 h premium) |
| `cacheWrite`    | `cacheWritePerToken ?? inputPerToken`         |
| `output`        | `outputPerToken`                              |

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage-pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatUsd, isPricedModel } from "./usage-pricing";
import { EMPTY_COUNTERS, type UsageCounters } from "./usage-snapshot";

const counters = (patch: Partial<UsageCounters> = {}): UsageCounters => ({
  ...EMPTY_COUNTERS,
  ...patch,
});

describe("isPricedModel", () => {
  it("recognises a model in the snapshot", () => {
    expect(isPricedModel("claude-opus-5")).toBe(true);
    expect(isPricedModel("gpt-5.6-sol")).toBe(true);
  });

  it("rejects an unknown model and Claude Code's synthetic marker", () => {
    expect(isPricedModel("claude-from-the-future")).toBe(false);
    expect(isPricedModel("<synthetic>")).toBe(false);
  });

  it("does not mistake an Object.prototype key for a model", () => {
    // PRICING_SNAPSHOT is an object literal, so it inherits `toString` and
    // friends. Plain indexing would return a function here.
    expect(isPricedModel("toString")).toBe(false);
    expect(isPricedModel("constructor")).toBe(false);
  });

  it("matches exactly — no prefix or alias fallback in v1", () => {
    expect(isPricedModel("claude-opus-5-20260801")).toBe(false);
    expect(isPricedModel("opus")).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  it("prices every counter class at its own rate", () => {
    // claude-opus-5: input 5e-6, output 2.5e-5, cacheRead 5e-7, cacheWrite 6.25e-6
    //   1000 * 5e-6      = 0.005
    // + 2000 * 5e-7      = 0.001
    // + 3000 * 6.25e-6   = 0.01875
    // + 4000 * 1e-5      = 0.04     (1h = input * 2)
    // + 5000 * 2.5e-5    = 0.125
    expect(
      estimateCostUsd(
        "claude-opus-5",
        counters({
          inputUncached: 1000,
          cacheRead: 2000,
          cacheCreate5m: 3000,
          cacheCreate1h: 4000,
          output: 5000,
        }),
      ),
    ).toBeCloseTo(0.18975, 10);
  });

  it("charges the 1h cache tier at twice the input rate", () => {
    const oneHour = estimateCostUsd(
      "claude-opus-5",
      counters({ cacheCreate1h: 1000 }),
    );
    const uncached = estimateCostUsd(
      "claude-opus-5",
      counters({ inputUncached: 1000 }),
    );

    expect(oneHour).not.toBeNull();
    expect(uncached).not.toBeNull();
    expect(oneHour).toBeCloseTo((uncached ?? 0) * 2, 12);
  });

  it("falls back to the input rate when no cache-write rate is published", () => {
    // gpt-5.5: input 5e-6, output 3e-5, cacheRead 5e-7, cacheWrite null
    //   1000 * 5e-6   = 0.005
    // + 1000 * 5e-7   = 0.0005
    // + 1000 * 5e-6   = 0.005    (cacheWrite falls back to input)
    // + 1000 * 3e-5   = 0.03
    expect(
      estimateCostUsd(
        "gpt-5.5",
        counters({
          inputUncached: 1000,
          cacheRead: 1000,
          cacheWrite: 1000,
          output: 1000,
        }),
      ),
    ).toBeCloseTo(0.0405, 10);
  });

  it("returns null for an unknown model rather than guessing", () => {
    expect(
      estimateCostUsd("claude-from-the-future", counters({ output: 1 })),
    ).toBeNull();
    expect(estimateCostUsd("toString", counters({ output: 1 }))).toBeNull();
  });

  it("costs zero tokens at zero dollars, whatever the model is", () => {
    // Claude Code writes 138 `<synthetic>` usage lines on this machine, every
    // one of them all-zero. Returning null for those would make the whole
    // Claude column read "—" forever.
    expect(estimateCostUsd("<synthetic>", EMPTY_COUNTERS)).toBe(0);
    expect(estimateCostUsd("claude-opus-5", EMPTY_COUNTERS)).toBe(0);
  });
});

describe("formatUsd", () => {
  it("renders zero as the canonical two-decimal zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("uses four decimals below a cent so a cheap day is not $0.00", () => {
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.0001)).toBe("$0.0001");
  });

  it("says 'less than' rather than rounding a real cost to zero", () => {
    expect(formatUsd(0.00004)).toBe("< $0.0001");
  });

  it("uses two decimals and grouping from a cent upwards", () => {
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("does not print NaN or Infinity at the user", () => {
    expect(formatUsd(Number.NaN)).toBe("$0.00");
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("$0.00");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/usage-pricing.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-pricing" from "src/lib/usage-pricing.test.ts". Does the file exist?`

- [ ] **Step 3: Write `src/lib/usage-pricing.ts`**

```ts
/**
 * Turning raw token counters into an estimated dollar figure, and rendering
 * that figure. Pure — no signals, no Tauri, no DOM.
 *
 * The numbers come from `usage-pricing-snapshot.ts`, which is generated and
 * rewritten wholesale by `npm run refresh:pricing`. Nothing in this file is
 * generated: that split is the whole point of having two modules (plan §0.3
 * decision 1) — a script that overwrites a file must never be pointed at one
 * containing logic.
 *
 * Every figure is an ESTIMATE at published list prices. A subscription user
 * does not pay per token, so the surface must always show the estimate label
 * and `PRICING_SNAPSHOT_DATE` beside the number (spec §Decisions 1).
 */

import { PRICING_SNAPSHOT, type ModelPricing } from "./usage-pricing-snapshot";
import { totalTokens, type UsageCounters } from "./usage-snapshot";

/**
 * Anthropic's published premium for a 1-hour cache write: twice the base
 * input rate (spec §Pricing, ccusage's rule). Verified against LiteLLM on
 * 2026-08-10 — for every Claude model this machine has run,
 * `cache_creation_input_token_cost_above_1hr` is exactly
 * `input_cost_per_token * 2`. The rate is not a field on `ModelPricing`
 * because that shape is frozen at four fields (plan §0.2.5).
 */
const CACHE_1H_INPUT_MULTIPLIER = 2;

/** Below a cent, two decimals round to `$0.00` and tell the user nothing. */
const CENT = 0.01;

/** Below this even four decimals round to zero, so the UI says "less than". */
const MIN_SHOWN_USD = 0.0001;

/**
 * Explicit locale, not the host's: the format must be identical on every
 * machine and in every test run, and `en-US` is what the rest of the UI's
 * English copy assumes.
 */
const USD_LOCALE = "en-US";
const USD_CENTS = new Intl.NumberFormat(USD_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_FRACTIONS = new Intl.NumberFormat(USD_LOCALE, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const ZERO_USD = `$${USD_CENTS.format(0)}`;
const BELOW_MIN_USD = `< $${USD_FRACTIONS.format(MIN_SHOWN_USD)}`;

/**
 * Whether the snapshot prices this exact model id. Exact match only in v1
 * (spec §Pricing, alias policy) — the raw string stays visible in the
 * breakdown so a missing mapping is diagnosable rather than invisible.
 *
 * `hasOwnProperty` and not plain indexing: `PRICING_SNAPSHOT` is an object
 * literal, so `PRICING_SNAPSHOT["toString"]` would answer with a function.
 * Same guard as `AGENT_DOT_VARS` in `process-info.ts`.
 */
export function isPricedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICING_SNAPSHOT, model);
}

function pricingFor(model: string): ModelPricing | null {
  return isPricedModel(model) ? PRICING_SNAPSHOT[model] : null;
}

/**
 * Estimated USD for one model's counters, or `null` when the model is not in
 * the snapshot. Never a guess: an unpriced model propagates `null` all the
 * way to the row (§0.3 decision 8) and the UI shows an em dash.
 *
 * The zero short-circuit comes first and applies to unknown models too, which
 * is arithmetic rather than pricing: no tokens cost no dollars. It is what
 * keeps Claude Code's `<synthetic>` marker — 138 lines on this machine, every
 * one of them all-zero — from turning the entire Claude dollar column into a
 * permanent em dash.
 */
export function estimateCostUsd(
  model: string,
  counters: UsageCounters,
): number | null {
  if (totalTokens(counters) === 0) {
    return 0;
  }
  const pricing = pricingFor(model);
  if (pricing === null) {
    return null;
  }
  // A provider that publishes no cache rate charges cache traffic as ordinary
  // input; falling back to the input rate is the documented rule for the
  // OpenAI cache-write case and the only non-inventing option for the rest.
  const cacheRead = pricing.cacheReadPerToken ?? pricing.inputPerToken;
  const cacheWrite = pricing.cacheWritePerToken ?? pricing.inputPerToken;
  return (
    counters.inputUncached * pricing.inputPerToken +
    counters.cacheRead * cacheRead +
    counters.cacheCreate5m * cacheWrite +
    counters.cacheCreate1h * pricing.inputPerToken * CACHE_1H_INPUT_MULTIPLIER +
    counters.cacheWrite * cacheWrite +
    counters.output * pricing.outputPerToken
  );
}

/**
 * The house dollar format. Two decimals from a cent upwards, four below it so
 * a genuinely cheap day is not flattened to `$0.00`, and an explicit
 * "less than" once even four decimals would round to zero.
 *
 * A `costUsd` of `null` is NOT this function's job — the caller renders an em
 * dash for that. Non-finite input is treated as zero rather than shown,
 * because `$NaN` on screen is worse than a wrong zero and unreachable anyway:
 * counters are integers and every rate in the snapshot is finite.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return ZERO_USD;
  }
  if (value < MIN_SHOWN_USD) {
    return BELOW_MIN_USD;
  }
  const format = value < CENT ? USD_FRACTIONS : USD_CENTS;
  return `$${format.format(value)}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/usage-pricing.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Report the task complete**

Files touched: `src/lib/usage-pricing.ts` (created),
`src/lib/usage-pricing.test.ts` (created).

---

### Task B4: Local-day re-bucketing and the three row builders

**Files:**

- Create: `src/lib/usage-aggregate.ts`
- Create: `src/lib/usage-aggregate.test.ts`

**Interfaces:**

- Consumes: `UsageBucket`, `UsageCounters`, `addCounters`, `EMPTY_COUNTERS`
  (B1); `estimateCostUsd` (B3).
- Produces: `AgentTotal`, `DailyRow`, `BreakdownRow`, `localDayKey`,
  `agentTotals`, `dailyRows`, `breakdownRows`.

**On pinning the timezone.** The DST assertions only mean anything in a zone
that observes DST, so the test sets `process.env.TZ = "America/New_York"` at
the top of the file. Four things about that, all verified rather than
assumed:

1. Node re-reads `TZ` on assignment and re-notifies V8's date configuration
   immediately — even `Date` objects constructed earlier start reporting the
   new offset. Confirmed on Node v24.16.0.
2. ESM hoists `import` declarations, so the assignment actually executes
   **after** the imports evaluate — but still before any test body. That is
   soon enough here because `usage-aggregate.ts` constructs every `Date`
   inside a function call, never at module load. It would **not** be soon
   enough for a module that captured the zone at import time.
3. **`process` does not typecheck under `src/` without help.** This repo has
   no `@types/node`, `tsconfig.json` declares only
   `"lib": ["ES2020", "DOM", "DOM.Iterable"]` and no `"types"`, and **no file
   under `src/` references `process` today** — so writing `process.env.TZ`
   naively produces four `TS2580: Cannot find name 'process'` errors and turns
   `npm run build` red while `npx vitest` stays green. The one-line ambient
   `declare const process` at the top of the test file fixes it with no new
   dependency and no emitted code. (`vite.config.ts` solves the same problem
   with `// @ts-expect-error process is a nodejs global`, but that file is
   outside `tsconfig.json`'s `include` and the trick would need repeating at
   every use site.) Do **not** "fix" this by adding `@types/node` — that is a
   dependency change, and a fork.
4. The whole arrangement — pin, ambient declaration, `afterAll` restore and
   these exact assertions — was run against this repo's own vitest **3.2.6**
   and its own `tsc`: 23 tests pass and `tsc -p tsconfig.json` exits 0.

`afterAll` restores the previous value because a vitest worker process is
reused across test files and a leaked `TZ` would make an unrelated suite's
dates depend on this one having run first. The first test asserts the offset
actually moves across the boundary, so the DST cases cannot silently degrade
into a no-op if the pin ever stops working.

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage-aggregate.test.ts`:

```ts
// This repo has no `@types/node` and `tsconfig.json` lists only ES2020 + DOM,
// so `process` is not a known global under `src/` — declaring it here is what
// keeps `npm run build` green. Ambient, so nothing is emitted.
declare const process: { env: Record<string, string | undefined> };

// The zone is pinned before anything reads it: `America/New_York` observes
// DST, which is what makes the local-day assertions below meaningful. ESM
// hoists the imports above this line, so it runs after they evaluate but
// before any test body — soon enough, because `usage-aggregate` builds every
// Date at call time rather than at module load.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

import { afterAll, describe, expect, it } from "vitest";
import {
  agentTotals,
  breakdownRows,
  dailyRows,
  localDayKey,
} from "./usage-aggregate";
import {
  EMPTY_COUNTERS,
  type UsageBucket,
  type UsageCounters,
} from "./usage-snapshot";

afterAll(() => {
  // Worker processes are reused across test files; a leaked TZ would make
  // another suite's dates depend on this one having run first.
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

function bucket(
  isoStart: string,
  agent: UsageBucket["agent"],
  model: string,
  patch: Partial<UsageCounters> = {},
): UsageBucket {
  return {
    bucketStartMs: Date.parse(isoStart),
    agent,
    model,
    counters: { ...EMPTY_COUNTERS, ...patch },
  };
}

describe("localDayKey", () => {
  it("is a meaningful test — the pinned zone really does shift", () => {
    expect(
      new Date(Date.parse("2026-03-08T06:30:00Z")).getTimezoneOffset(),
    ).toBe(300);
    expect(
      new Date(Date.parse("2026-03-08T07:30:00Z")).getTimezoneOffset(),
    ).toBe(240);
  });

  it("keeps both sides of a spring-forward transition on the same local day", () => {
    expect(localDayKey(Date.parse("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
    expect(localDayKey(Date.parse("2026-03-08T07:30:00Z"))).toBe("2026-03-08");
  });

  it("keeps both sides of a fall-back transition on the same local day", () => {
    expect(localDayKey(Date.parse("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(localDayKey(Date.parse("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
  });

  it("rolls the day at local midnight, not UTC midnight", () => {
    expect(localDayKey(Date.parse("2026-08-10T03:59:00Z"))).toBe("2026-08-09");
    expect(localDayKey(Date.parse("2026-08-10T04:01:00Z"))).toBe("2026-08-10");
  });

  it("zero-pads month and day", () => {
    expect(localDayKey(Date.parse("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("agentTotals", () => {
  const buckets = [
    bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", { output: 1000 }),
    bucket("2026-08-10T12:15:00Z", "claude", "claude-sonnet-5", {
      output: 1000,
    }),
    bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", { output: 1000 }),
    bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", {
      inputUncached: 1000,
    }),
  ];

  it("sums per agent across models and buckets, Claude before Codex", () => {
    const totals = agentTotals(buckets, null);

    expect(totals.map((row) => row.agent)).toEqual(["claude", "codex"]);
    expect(totals[0].counters.output).toBe(3000);
    expect(totals[1].counters.inputUncached).toBe(1000);
  });

  it("prices the total from each contributing model's own rate", () => {
    const totals = agentTotals(buckets, null);

    // 2000 output on claude-opus-5 at 2.5e-5 + 1000 on claude-sonnet-5 at 1e-5
    expect(totals[0].costUsd).toBeCloseTo(0.06, 10);
    // 1000 uncached input on gpt-5.6-sol at 5e-6
    expect(totals[1].costUsd).toBeCloseTo(0.005, 10);
  });

  it("drops buckets that start before sinceMs", () => {
    const todayStart = Date.parse("2026-08-10T04:00:00Z"); // local midnight

    const totals = agentTotals(buckets, todayStart);

    expect(totals[0].counters.output).toBe(2000);
  });

  it("returns no row for an agent with nothing in range", () => {
    const totals = agentTotals(buckets, Date.parse("2026-08-10T12:10:00Z"));

    expect(totals.map((row) => row.agent)).toEqual(["claude"]);
  });

  it("returns nothing at all for an empty input", () => {
    expect(agentTotals([], null)).toEqual([]);
  });

  it("refuses a partial total when a contributing model is unpriced", () => {
    const totals = agentTotals(
      [
        ...buckets,
        bucket("2026-08-10T12:30:00Z", "claude", "claude-from-the-future", {
          output: 5,
        }),
      ],
      null,
    );

    expect(totals[0].costUsd).toBeNull();
    expect(totals[0].unpricedModels).toEqual(["claude-from-the-future"]);
    // Codex is untouched — null does not spread across agents.
    expect(totals[1].costUsd).toBeCloseTo(0.005, 10);
  });

  it("lists unpriced models deduped and sorted", () => {
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "zeta-model", { output: 1 }),
        bucket("2026-08-10T12:15:00Z", "claude", "alpha-model", { output: 1 }),
        bucket("2026-08-10T12:30:00Z", "claude", "zeta-model", { output: 1 }),
      ],
      null,
    );

    expect(totals[0].unpricedModels).toEqual(["alpha-model", "zeta-model"]);
  });

  it("is not poisoned by an all-zero unpriced model", () => {
    // Claude Code's `<synthetic>` marker: 138 lines on this machine, all zero.
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "<synthetic>"),
      ],
      null,
    );

    expect(totals[0].unpricedModels).toEqual([]);
    expect(totals[0].costUsd).toBeCloseTo(0.025, 10);
  });
});

describe("dailyRows", () => {
  const nowMs = Date.parse("2026-08-10T18:00:00Z"); // 14:00 local

  it("emits one row per day and agent that has data, newest day first", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", { output: 1 }),
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows.map((row) => [row.day, row.agent])).toEqual([
      ["2026-08-10", "claude"],
      ["2026-08-10", "codex"],
      ["2026-08-09", "claude"],
    ]);
  });

  it("merges every bucket of the same local day into one row", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 100,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "claude-opus-5", {
          output: 200,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].counters.output).toBe(300);
  });

  it("assigns a bucket to its LOCAL day, not its UTC day", () => {
    // 03:00Z on the 8th is 23:00 on the 7th in New York, so it falls outside
    // a three-day window ending on the 10th.
    const rows = dailyRows(
      [
        bucket("2026-08-08T03:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-08-08T05:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows.map((row) => row.day)).toEqual(["2026-08-08"]);
  });

  it("neither skips nor repeats a day across a DST transition", () => {
    // 2026-11-01 is the US fall-back date. Local noon on three consecutive
    // days must produce three distinct, consecutive keys.
    const afterFallBack = Date.parse("2026-11-02T17:00:00Z");
    const rows = dailyRows(
      [
        bucket("2026-10-31T16:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-11-01T17:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-11-02T17:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      afterFallBack,
    );

    expect(rows.map((row) => row.day)).toEqual([
      "2026-11-02",
      "2026-11-01",
      "2026-10-31",
    ]);
  });

  it("drops anything older than the window", () => {
    const rows = dailyRows(
      [
        bucket("2026-07-01T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows).toEqual([]);
  });

  it("returns nothing for a non-positive or unusable window", () => {
    const one = [
      bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", { output: 1 }),
    ];

    expect(dailyRows(one, 0, nowMs)).toEqual([]);
    expect(dailyRows(one, -1, nowMs)).toEqual([]);
    expect(dailyRows(one, 3, Number.NaN)).toEqual([]);
  });

  it("carries the same null-cost rule as the totals", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "claude-from-the-future", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows[0].costUsd).toBeNull();
    expect(rows[0].unpricedModels).toEqual(["claude-from-the-future"]);
  });
});

describe("breakdownRows", () => {
  it("emits one row per agent and raw model, sorted by both", () => {
    const rows = breakdownRows([
      bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", {
        inputUncached: 10,
      }),
      bucket("2026-08-10T12:00:00Z", "claude", "claude-sonnet-5", {
        output: 20,
      }),
      bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", { output: 30 }),
      bucket("2026-08-10T12:15:00Z", "claude", "claude-opus-5", { output: 40 }),
    ]);

    expect(rows.map((row) => [row.agent, row.model])).toEqual([
      ["claude", "claude-opus-5"],
      ["claude", "claude-sonnet-5"],
      ["codex", "gpt-5.6-sol"],
    ]);
    expect(rows[0].counters.output).toBe(70);
  });

  it("keeps the raw model string verbatim and prices it on its own", () => {
    const rows = breakdownRows([
      bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
        output: 1000,
      }),
      bucket("2026-08-10T12:00:00Z", "claude", "claude-from-the-future", {
        output: 1000,
      }),
    ]);

    expect(rows[0].model).toBe("claude-from-the-future");
    expect(rows[0].costUsd).toBeNull();
    expect(rows[1].costUsd).toBeCloseTo(0.025, 10);
  });

  it("returns nothing for an empty input", () => {
    expect(breakdownRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/usage-aggregate.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-aggregate" from "src/lib/usage-aggregate.test.ts". Does the file exist?`

- [ ] **Step 3: Write `src/lib/usage-aggregate.ts`**

```ts
/**
 * Re-bucketing the Rust payload into the three views the usage screen shows.
 * Pure — no signals, no Tauri, no DOM.
 *
 * Rust hands back 15-minute UTC buckets and does no timezone work at all
 * (spec §Aggregate schema, major M2). Everything local happens here, using the
 * JS `Date`, which carries the host's zone rules and its DST history — which
 * is why the fifteen-minute grain matters: real offsets include :30 and :45
 * (India, Nepal, Chatham), and an hourly grain would put boundary-hour usage
 * on the wrong local day there.
 */

import { estimateCostUsd } from "./usage-pricing";
import {
  addCounters,
  EMPTY_COUNTERS,
  type UsageAgent,
  type UsageBucket,
  type UsageCounters,
} from "./usage-snapshot";

export interface AgentTotal {
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  /** null when ANY contributing model is unpriced (plan §0.3 decision 8). */
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

export interface DailyRow {
  /** Local calendar day, "YYYY-MM-DD". */
  readonly day: string;
  readonly agent: UsageAgent;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

export interface BreakdownRow {
  readonly agent: UsageAgent;
  /** The raw model string, verbatim. */
  readonly model: string;
  readonly counters: UsageCounters;
  readonly costUsd: number | null;
}

/**
 * Joins a day key to an agent inside a Map key. A space cannot appear in either
 * half — the agent is a closed union and the day is digits and dashes — so
 * the split back apart is unambiguous.
 */
const KEY_SEPARATOR = "�";

/**
 * Local noon, not local midnight, as the anchor for day arithmetic. A DST
 * transition that lands on the anchor instant makes midnight either
 * non-existent or ambiguous; noon is never within a transition anywhere.
 */
const DAY_ANCHOR_HOUR = 12;

function pad2(value: number): string {
  return `${value}`.padStart(2, "0");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The host-local calendar day containing `utcMs`, as "YYYY-MM-DD". */
export function localDayKey(utcMs: number): string {
  const at = new Date(utcMs);
  return [
    `${at.getFullYear()}`.padStart(4, "0"),
    pad2(at.getMonth() + 1),
    pad2(at.getDate()),
  ].join("-");
}

/** The last `days` local calendar days ending on the day containing `nowMs`. */
function recentDayKeys(days: number, nowMs: number): readonly string[] {
  const now = new Date(nowMs);
  const keys: string[] = [];
  for (let back = 0; back < days; back += 1) {
    const anchor = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - back,
      DAY_ANCHOR_HOUR,
    );
    keys.push(localDayKey(anchor.getTime()));
  }
  return keys;
}

/**
 * Group buckets by a caller-chosen key, keeping the model dimension inside
 * each group. The model split has to survive grouping: a row's cost is the
 * sum of its models' costs, and merging counters across models first would
 * make that sum unrecoverable.
 */
function groupByModel<Key extends string>(
  buckets: readonly UsageBucket[],
  keyOf: (bucket: UsageBucket) => Key | null,
): ReadonlyMap<Key, ReadonlyMap<string, UsageCounters>> {
  const groups = new Map<Key, Map<string, UsageCounters>>();
  for (const bucket of buckets) {
    const key = keyOf(bucket);
    if (key === null) {
      continue;
    }
    const byModel = groups.get(key) ?? new Map<string, UsageCounters>();
    byModel.set(
      bucket.model,
      addCounters(byModel.get(bucket.model) ?? EMPTY_COUNTERS, bucket.counters),
    );
    groups.set(key, byModel);
  }
  return groups;
}

function sumCounters(
  byModel: ReadonlyMap<string, UsageCounters>,
): UsageCounters {
  let total = EMPTY_COUNTERS;
  for (const counters of byModel.values()) {
    total = addCounters(total, counters);
  }
  return total;
}

interface CostRollup {
  readonly costUsd: number | null;
  readonly unpricedModels: readonly string[];
}

/**
 * Sum the per-model costs of one group. A single unpriced model makes the
 * whole figure `null`: a partial sum presented as a total is worse than no
 * number at all (plan §0.3 decision 8). A model contributing zero tokens is
 * never "unpriced" — `estimateCostUsd` answers 0 for it, which is arithmetic
 * and not a price lookup.
 */
function rollupCost(byModel: ReadonlyMap<string, UsageCounters>): CostRollup {
  const unpriced: string[] = [];
  let total = 0;
  for (const [model, counters] of byModel) {
    const cost = estimateCostUsd(model, counters);
    if (cost === null) {
      unpriced.push(model);
      continue;
    }
    total += cost;
  }
  const unpricedModels = [...new Set(unpriced)].sort(compareStrings);
  return {
    costUsd: unpricedModels.length > 0 ? null : total,
    unpricedModels,
  };
}

/**
 * Per-agent totals, optionally from `sinceMs` onwards. "Today" is the
 * caller's definition — it passes the local midnight that starts today, or
 * `null` for the whole recorded history.
 *
 * Only agents with data in range get a row. The screen renders both agent
 * slots from the snapshot's `sources`, which always carries exactly two.
 */
export function agentTotals(
  buckets: readonly UsageBucket[],
  sinceMs: number | null,
): readonly AgentTotal[] {
  const groups = groupByModel<UsageAgent>(buckets, (bucket) =>
    sinceMs !== null && bucket.bucketStartMs < sinceMs ? null : bucket.agent,
  );
  return [...groups.entries()]
    .map(([agent, byModel]) => ({
      agent,
      counters: sumCounters(byModel),
      ...rollupCost(byModel),
    }))
    .sort((left, right) => compareStrings(left.agent, right.agent));
}

/**
 * One row per (local day, agent) with data, across the last `days` local days
 * ending on the day containing `nowMs`. Newest day first, then agent. Days
 * with no usage are absent rather than zero-filled — the table shows what
 * happened, not a calendar.
 */
export function dailyRows(
  buckets: readonly UsageBucket[],
  days: number,
  nowMs: number,
): readonly DailyRow[] {
  if (days <= 0 || !Number.isFinite(nowMs)) {
    return [];
  }
  const window = new Set(recentDayKeys(days, nowMs));
  const groups = groupByModel<string>(buckets, (bucket) => {
    const day = localDayKey(bucket.bucketStartMs);
    return window.has(day) ? `${day}${KEY_SEPARATOR}${bucket.agent}` : null;
  });
  return [...groups.entries()]
    .map(([key, byModel]) => {
      const [day, agent] = key.split(KEY_SEPARATOR) as [string, UsageAgent];
      return {
        day,
        agent,
        counters: sumCounters(byModel),
        ...rollupCost(byModel),
      };
    })
    .sort(
      (left, right) =>
        compareStrings(right.day, left.day) ||
        compareStrings(left.agent, right.agent),
    );
}

/**
 * One row per (agent, raw model) over the whole recorded history. This is the
 * view where an unpriced model is diagnosable: the string is shown verbatim
 * and its own `costUsd` is `null`, so a missing snapshot entry names itself.
 */
export function breakdownRows(
  buckets: readonly UsageBucket[],
): readonly BreakdownRow[] {
  const groups = groupByModel<UsageAgent>(buckets, (bucket) => bucket.agent);
  const rows: BreakdownRow[] = [];
  for (const [agent, byModel] of groups) {
    for (const [model, counters] of byModel) {
      rows.push({
        agent,
        model,
        counters,
        costUsd: estimateCostUsd(model, counters),
      });
    }
  }
  return rows.sort(
    (left, right) =>
      compareStrings(left.agent, right.agent) ||
      compareStrings(left.model, right.model),
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/usage-aggregate.test.ts`
Expected: PASS (23 tests)

- [ ] **Step 5: Prove nothing else moved**

Run: `npx vitest run src/lib`
Expected: PASS — the whole `src/lib` suite green, including the pre-existing
modules.

- [ ] **Step 6: Report the task complete**

Files touched: `src/lib/usage-aggregate.ts` (created),
`src/lib/usage-aggregate.test.ts` (created).

---

### Task B5: The `usage_snapshot` IPC seam

**Files:**

- Create: `src/usage/usage-client.ts` (creates the `src/usage/` directory)
- Create: `src/usage/usage-client.test.ts`

**Interfaces:**

- Consumes: `UsageSnapshot`, `EMPTY_USAGE_SNAPSHOT` (B1).
- Produces: `UsageClient`, `createTauriUsageClient`,
  `createMemoryUsageClient`, `defaultUsageClient`.

The Rust command takes `app: tauri::AppHandle`, which Tauri injects — so
`invoke` is called with the command name and **no** argument object.

- [ ] **Step 1: Write the failing test**

Create `src/usage/usage-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import {
  createMemoryUsageClient,
  createTauriUsageClient,
} from "./usage-client";
import {
  EMPTY_USAGE_SNAPSHOT,
  type UsageSnapshot,
} from "../lib/usage-snapshot";

const snapshot: UsageSnapshot = {
  scannedAtMs: 1_754_820_000_000,
  buckets: [
    {
      bucketStartMs: 1_754_819_100_000,
      agent: "claude",
      model: "claude-opus-5",
      counters: {
        inputUncached: 10,
        cacheRead: 20,
        cacheCreate5m: 30,
        cacheCreate1h: 40,
        cacheWrite: 0,
        output: 50,
      },
    },
  ],
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1881 },
    { agent: "codex", state: "missing", filesScanned: 0 },
  ],
  skippedLines: 3,
};

describe("createTauriUsageClient", () => {
  it("invokes the command with no arguments — AppHandle is injected in Rust", async () => {
    invoke.mockResolvedValueOnce(snapshot);

    await expect(createTauriUsageClient().snapshot()).resolves.toEqual(
      snapshot,
    );
    expect(invoke).toHaveBeenCalledWith("usage_snapshot");
  });
});

describe("createMemoryUsageClient", () => {
  it("answers with the empty snapshot by default", async () => {
    await expect(createMemoryUsageClient().snapshot()).resolves.toEqual(
      EMPTY_USAGE_SNAPSHOT,
    );
  });

  it("answers with the configured snapshot", async () => {
    await expect(createMemoryUsageClient(snapshot).snapshot()).resolves.toEqual(
      snapshot,
    );
  });

  it("can be made to fail, so the caller's stale path is testable", async () => {
    const client = createMemoryUsageClient(EMPTY_USAGE_SNAPSHOT, {
      fail: true,
    });

    await expect(client.snapshot()).rejects.toThrow("usage_snapshot failed");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/usage/usage-client.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-client" from "src/usage/usage-client.test.ts". Does the file exist?`

- [ ] **Step 3: Write `src/usage/usage-client.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_USAGE_SNAPSHOT,
  type UsageSnapshot,
} from "../lib/usage-snapshot";

/** Scanner seam — real IPC in production, fakes in tests. */
export interface UsageClient {
  /**
   * Rejects **only** when the Rust blocking worker panicked (plan §0.3
   * decision 5). Missing directories, unreadable files and malformed lines
   * all arrive in-band through `sources[].state` and `skippedLines`, so the
   * store's failure path has exactly one trigger.
   */
  snapshot(): Promise<UsageSnapshot>;
}

export function createTauriUsageClient(): UsageClient {
  return {
    snapshot() {
      // No argument object: the command's only parameter is `app:
      // tauri::AppHandle`, which Tauri injects on the Rust side.
      return invoke<UsageSnapshot>("usage_snapshot");
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryUsageClient(
  snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT,
  options: { readonly fail?: boolean } = {},
): UsageClient {
  return {
    async snapshot() {
      if (options.fail === true) {
        throw new Error("usage_snapshot failed");
      }
      return snapshot;
    },
  };
}

/** Shared production client — callers accept an override for tests. */
export const defaultUsageClient: UsageClient = createTauriUsageClient();
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/usage/usage-client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Report the task complete**

Files touched: `src/usage/usage-client.ts` (created),
`src/usage/usage-client.test.ts` (created).

---

### Task B6: The store and the poll lifecycle

**Files:**

- Create: `src/usage/usage-store.ts`
- Create: `src/usage/usage-store.test.ts`

**Interfaces:**

- Consumes: `UsageSnapshot` (B1), `UsageClient` + `defaultUsageClient` (B5).
- Produces: `usageSnapshot`, `usageStale`, `usageLoading`,
  `startUsagePolling`, `stopUsagePolling`.

Three properties the design turns on, each with its own test below:

1. **Single-flight, per generation.** A cold scan over ~2.5 GB can outlast the
   5 s tick, so a poll already running for the current generation is skipped
   rather than stacked. Keying the in-flight marker to the generation (not a
   bare boolean) is what lets a fresh `start` after a `stop` fetch
   immediately instead of waiting out the discarded scan.
2. **A generation counter, bumped by both start and stop.** A reply from a
   superseded generation is dropped on arrival, so a scan whose screen closed
   mid-flight can never write into the signals.
3. **Failure keeps the data.** A rejected call sets `usageStale` and leaves
   `usageSnapshot` exactly as it was.

- [ ] **Step 1: Write the failing test**

Create `src/usage/usage-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "./usage-store";
import type { UsageClient } from "./usage-client";
import {
  EMPTY_USAGE_SNAPSHOT,
  type UsageSnapshot,
} from "../lib/usage-snapshot";

/** The poll interval, restated here so a change to it fails a test. */
const POLL_MS = 5000;

const first: UsageSnapshot = { ...EMPTY_USAGE_SNAPSHOT, scannedAtMs: 1 };
const second: UsageSnapshot = { ...EMPTY_USAGE_SNAPSHOT, scannedAtMs: 2 };

interface Deferred {
  readonly promise: Promise<UsageSnapshot>;
  resolve(value: UsageSnapshot): void;
}

function deferred(): Deferred {
  let resolve: (value: UsageSnapshot) => void = () => undefined;
  const promise = new Promise<UsageSnapshot>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * A client that hands out queued replies, then repeats the last one. Replies
 * are FACTORIES, not promises: a `Promise.reject` sitting in an array is an
 * unhandled rejection until something consumes it, and vitest reports that as
 * an error even when every test passes.
 */
type Reply = () => Promise<UsageSnapshot>;

function queuedClient(replies: readonly Reply[]): {
  readonly client: UsageClient;
  calls(): number;
} {
  const pending = [...replies];
  let calls = 0;
  return {
    client: {
      snapshot() {
        calls += 1;
        const next = pending.shift();
        return next === undefined ? Promise.resolve(second) : next();
      },
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  stopUsagePolling();
  usageSnapshot.value = null;
  usageStale.value = false;
  usageLoading.value = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startUsagePolling", () => {
  it("fetches once immediately", async () => {
    const { client, calls } = queuedClient([() => Promise.resolve(first)]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls()).toBe(1);
    expect(usageSnapshot.value).toEqual(first);
    expect(usageStale.value).toBe(false);
  });

  it("fetches again on every interval tick", async () => {
    const { client, calls } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(calls()).toBe(2);
    expect(usageSnapshot.value).toEqual(second);
  });

  it("is a no-op while already polling — no second timer", async () => {
    const { client, calls } = queuedClient([]);

    startUsagePolling(client);
    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(calls()).toBe(2);
  });

  it("does not stack a second scan on top of one still running", async () => {
    const slow = deferred();
    const { client, calls } = queuedClient([() => slow.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(calls()).toBe(1);

    slow.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toEqual(first);
  });

  it("keeps the last good snapshot and marks it stale when a poll fails", async () => {
    const { client } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.reject(new Error("worker panicked")),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(usageSnapshot.value).toEqual(first);
    expect(usageStale.value).toBe(true);
  });

  it("clears the stale mark once a poll succeeds again", async () => {
    const { client } = queuedClient([
      () => Promise.resolve(first),
      () => Promise.reject(new Error("worker panicked")),
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(usageStale.value).toBe(false);
    expect(usageSnapshot.value).toEqual(second);
  });

  it("marks a failed cold scan stale without inventing an empty snapshot", async () => {
    const { client } = queuedClient([() => Promise.reject(new Error("panic"))]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toBeNull();
    expect(usageStale.value).toBe(true);
    expect(usageLoading.value).toBe(false);
  });
});

describe("usageLoading", () => {
  it("is true only while the cold scan runs", async () => {
    const cold = deferred();
    const warm = deferred();
    const { client } = queuedClient([() => cold.promise, () => warm.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(true);

    cold.resolve(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(false);

    // A later poll must not flash the loading state every five seconds.
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(usageLoading.value).toBe(false);

    warm.resolve(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageSnapshot.value).toEqual(second);
  });
});

describe("stopUsagePolling", () => {
  it("stops further polls and is idempotent", async () => {
    const { client, calls } = queuedClient([() => Promise.resolve(first)]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    stopUsagePolling();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(calls()).toBe(1);
  });

  it("clears the cold-scan loading flag", async () => {
    const cold = deferred();
    const { client } = queuedClient([() => cold.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    expect(usageLoading.value).toBe(true);

    stopUsagePolling();

    expect(usageLoading.value).toBe(false);
  });

  it("discards a scan that was still in flight", async () => {
    const orphan = deferred();
    const { client } = queuedClient([() => orphan.promise]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    orphan.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toBeNull();
    expect(usageStale.value).toBe(false);
  });

  it("lets a restart fetch immediately instead of waiting out the orphan", async () => {
    const orphan = deferred();
    const { client, calls } = queuedClient([
      () => orphan.promise,
      () => Promise.resolve(second),
    ]);

    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);
    stopUsagePolling();
    startUsagePolling(client);
    await vi.advanceTimersByTimeAsync(0);

    expect(calls()).toBe(2);
    expect(usageSnapshot.value).toEqual(second);

    orphan.resolve(first);
    await vi.advanceTimersByTimeAsync(0);

    expect(usageSnapshot.value).toEqual(second);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/usage/usage-store.test.ts`
Expected: FAIL — `Failed to resolve import "./usage-store" from "src/usage/usage-store.test.ts". Does the file exist?`

- [ ] **Step 3: Write `src/usage/usage-store.ts`**

```ts
import { signal } from "@preact/signals";
import { defaultUsageClient, type UsageClient } from "./usage-client";
import type { UsageSnapshot } from "../lib/usage-snapshot";

/**
 * The usage screen's data: a snapshot signal and a poll bound to the screen
 * being open. Window-scoped module store, per R5.
 *
 * The shell this drives never unmounts — `UsageScreen` follows
 * `SettingsScreen`, which stays mounted and is switched by an `open` prop.
 * So start and stop are called repeatedly over a session's life, in any
 * order, and everything below is written to survive that: a second start is a
 * no-op, stop is idempotent, and a reply from a superseded generation is
 * dropped rather than written.
 */

/**
 * Spec §Surface: a snapshot on open, then a 5 s poll while open. Not tuned
 * for cost — the Rust scanner is incremental, so a cycle over unchanged files
 * re-reads nothing and rewrites no cache.
 */
const USAGE_POLL_MS = 5000;

/** Last successful scan; null until the first one lands. */
export const usageSnapshot = signal<UsageSnapshot | null>(null);

/**
 * The last poll failed and what is on screen may be out of date.
 *
 * This means one thing only: the command rejected, which happens only when
 * the Rust worker panicked. "No transcripts found" is NOT this — it arrives
 * in-band as `sources[].state === "missing"`, and conflating the two is the
 * mistake spec major M7 exists to prevent.
 */
export const usageStale = signal(false);

/** A cold scan is running and there is nothing yet to show. */
export const usageLoading = signal(false);

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Bumped by every start and every stop. A poll captures the value at launch
 * and compares on reply, so a scan whose screen closed mid-flight cannot
 * write into the signals.
 */
let generation = 0;

/**
 * Generation of the scan currently running, or null. Keyed to the generation
 * rather than a bare boolean on purpose: a close-then-reopen must fetch at
 * once instead of waiting out the scan it just abandoned.
 */
let inFlightGeneration: number | null = null;

async function poll(client: UsageClient, forGeneration: number): Promise<void> {
  if (inFlightGeneration === forGeneration) {
    return; // a cold scan can outlast the tick; never stack a second one
  }
  inFlightGeneration = forGeneration;
  if (usageSnapshot.value === null) {
    usageLoading.value = true;
  }
  try {
    const next = await client.snapshot();
    if (forGeneration === generation) {
      usageSnapshot.value = next;
      usageStale.value = false;
    }
  } catch (error: unknown) {
    if (forGeneration === generation) {
      // Keep the last good snapshot on screen. Blanking it would turn a
      // transient worker failure into "you have no usage", which is a lie.
      console.warn("usage_snapshot failed:", error);
      usageStale.value = true;
    }
  } finally {
    if (inFlightGeneration === forGeneration) {
      inFlightGeneration = null;
    }
    if (forGeneration === generation) {
      usageLoading.value = false;
    }
  }
}

/** Fetch now, then every 5 s. Calling it while already polling does nothing. */
export function startUsagePolling(
  client: UsageClient = defaultUsageClient,
): void {
  if (timer !== null) {
    return;
  }
  generation += 1;
  const forGeneration = generation;
  timer = setInterval(() => {
    void poll(client, forGeneration);
  }, USAGE_POLL_MS);
  void poll(client, forGeneration);
}

/**
 * Stop polling. Idempotent: the generation bump is unconditional, so a scan
 * still in flight can never land afterwards and a second call has nothing
 * left to do. `usageSnapshot` and `usageStale` are deliberately left alone —
 * reopening the screen should show the data it had, not a blank.
 */
export function stopUsagePolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  generation += 1;
  usageLoading.value = false;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/usage/usage-store.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Report the task complete**

Files touched: `src/usage/usage-store.ts` (created),
`src/usage/usage-store.test.ts` (created).

---

### Task B7: The pricing refresh script

**Files:**

- Create: `scripts/refresh-usage-pricing.mjs`
- Create: `scripts/refresh-usage-pricing.test.ts`
- Modify: `package.json` — add exactly one line to the `scripts` block

**Interfaces:**

- Consumes: `PRICING_SNAPSHOT` + `PRICING_SNAPSHOT_DATE` (B2), for the
  round-trip test only.
- Produces: `selectModels`, `toModelPricing`, `renderSnapshotModule`,
  `refreshPricingSnapshot` (all from the `.mjs`).

Three rules the script exists to enforce:

- **It writes nothing unless the data is usable.** A fetch failure, a parse
  failure, a catalog that shrank below the floor, or a catalog that no longer
  prices one of `REQUIRED_MODELS` all throw before `writeFileSync` is reached,
  so the checked-in snapshot survives a bad day upstream untouched.
- **It is never wired into `predev`, `prebuild` or CI.** A build that can
  reach the network is a build that can change what ships without a code
  change (§0.3 decision 6).
- **Its output is byte-identical to the checked-in file for the same data.**
  The last test below proves it, offline, by re-rendering from the module the
  app actually imports. That is what keeps a refresh's diff to real price
  changes instead of formatting churn.

- [ ] **Step 1: Write the failing test**

Create `scripts/refresh-usage-pricing.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  refreshPricingSnapshot,
  renderSnapshotModule,
  selectModels,
  toModelPricing,
} from "./refresh-usage-pricing.mjs";
import {
  PRICING_SNAPSHOT,
  PRICING_SNAPSHOT_DATE,
} from "../src/lib/usage-pricing-snapshot";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "deck-refresh-pricing-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "usage-pricing-snapshot.ts");
  writeFileSync(path, contents, "utf8");
  return path;
}

function anthropicEntry(overrides: Record<string, unknown> = {}) {
  return {
    litellm_provider: "anthropic",
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_read_input_token_cost: 5e-7,
    cache_creation_input_token_cost: 0.00000625,
    ...overrides,
  };
}

function openaiEntry(overrides: Record<string, unknown> = {}) {
  return {
    litellm_provider: "openai",
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.00003,
    cache_read_input_token_cost: 5e-7,
    ...overrides,
  };
}

/**
 * The script's own `REQUIRED_MODELS` list, restated. If someone edits that
 * list, this fixture goes stale and every write test below fails loudly —
 * which is the intended forcing function, not an accident.
 */
const REQUIRED_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.1-codex-mini",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];

/** A catalog big enough to clear the script's minimum-count floor. */
function usableCatalog(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const catalog: Record<string, unknown> = {};
  for (const id of REQUIRED_MODELS) {
    catalog[id] = id.startsWith("claude-") ? anthropicEntry() : openaiEntry();
  }
  for (let index = 0; index < 40; index += 1) {
    catalog[`gpt-5.9-filler-${index}`] = openaiEntry();
  }
  return { ...catalog, ...overrides };
}

function respondWith(catalog: unknown) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(catalog),
  });
}

describe("toModelPricing", () => {
  it("maps the four LiteLLM cost keys", () => {
    expect(toModelPricing(anthropicEntry())).toEqual({
      inputPerToken: 0.000005,
      outputPerToken: 0.000025,
      cacheReadPerToken: 5e-7,
      cacheWritePerToken: 0.00000625,
    });
  });

  it("nulls the cache rates the catalog omits", () => {
    expect(toModelPricing(openaiEntry())).toEqual({
      inputPerToken: 0.000005,
      outputPerToken: 0.00003,
      cacheReadPerToken: 5e-7,
      cacheWritePerToken: null,
    });
  });

  it("rejects an entry with no usable input or output rate", () => {
    expect(
      toModelPricing(anthropicEntry({ input_cost_per_token: undefined })),
    ).toBeNull();
    expect(
      toModelPricing(anthropicEntry({ output_cost_per_token: "free" })),
    ).toBeNull();
    expect(
      toModelPricing(anthropicEntry({ input_cost_per_token: -1 })),
    ).toBeNull();
    expect(toModelPricing(null)).toBeNull();
  });
});

describe("selectModels", () => {
  it("keeps the Anthropic and OpenAI families these CLIs emit, sorted", () => {
    const models = selectModels({
      "gpt-5.6-sol": openaiEntry(),
      "claude-opus-5": anthropicEntry(),
      "o3-mini": openaiEntry(),
      "codex-mini-latest": openaiEntry(),
    });

    expect(models.map(([id]: [string, unknown]) => id)).toEqual([
      "claude-opus-5",
      "codex-mini-latest",
      "gpt-5.6-sol",
      "o3-mini",
    ]);
  });

  it("drops other providers, unrelated ids and the schema sample", () => {
    const models = selectModels({
      "gemini-3-pro": { ...openaiEntry(), litellm_provider: "vertex_ai" },
      "gpt-4o": openaiEntry(),
      "claude-opus-5": { ...anthropicEntry(), litellm_provider: "bedrock" },
      sample_spec: openaiEntry(),
      "gpt-5.6-sol": openaiEntry(),
    });

    expect(models.map(([id]: [string, unknown]) => id)).toEqual([
      "gpt-5.6-sol",
    ]);
  });

  it("refuses a catalog that is not a JSON object", () => {
    expect(() => selectModels(null)).toThrow(
      "Pricing catalog is not a JSON object",
    );
  });
});

describe("renderSnapshotModule", () => {
  const module = renderSnapshotModule(
    [
      [
        "claude-opus-5",
        {
          inputPerToken: 0.000005,
          outputPerToken: 0.000025,
          cacheReadPerToken: 5e-7,
          cacheWritePerToken: 0.00000625,
        },
      ],
      [
        "gpt-5.5",
        {
          inputPerToken: 0.000005,
          outputPerToken: 0.00003,
          cacheReadPerToken: 5e-7,
          cacheWritePerToken: null,
        },
      ],
    ],
    "2026-02-03",
  );

  it("marks the file generated and stamps the retrieval date", () => {
    expect(module).toContain("GENERATED FILE");
    expect(module).toContain(
      'export const PRICING_SNAPSHOT_DATE = "2026-02-03";',
    );
  });

  it("records the source URL", () => {
    expect(module).toContain(
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    );
  });

  it("emits one row per model with null for an absent rate", () => {
    expect(module).toContain(
      '  "claude-opus-5": { inputPerToken: 0.000005, outputPerToken: 0.000025, cacheReadPerToken: 5e-7, cacheWritePerToken: 0.00000625 },',
    );
    expect(module).toContain(
      '  "gpt-5.5": { inputPerToken: 0.000005, outputPerToken: 0.00003, cacheReadPerToken: 5e-7, cacheWritePerToken: null },',
    );
  });

  it("ends with a newline, like every other file in the tree", () => {
    expect(module.endsWith("};\n")).toBe(true);
  });
});

describe("refreshPricingSnapshot", () => {
  it("writes the module and reports what it wrote", async () => {
    const outputPath = temporaryFile("stale\n");

    const result = await refreshPricingSnapshot({
      fetchImpl: respondWith(usableCatalog()),
      outputPath,
      now: new Date("2026-02-03T09:00:00Z"),
    });

    expect(result.modelCount).toBe(REQUIRED_MODELS.length + 40);
    expect(result.snapshotDate).toBe("2026-02-03");
    expect(readFileSync(outputPath, "utf8")).toContain(
      '"claude-opus-5": { inputPerToken:',
    );
  });

  it("leaves the file alone when the request fails", async () => {
    const outputPath = temporaryFile("keep me\n");

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          text: async () => "",
        }),
        outputPath,
      }),
    ).rejects.toThrow("HTTP 503");
    expect(readFileSync(outputPath, "utf8")).toBe("keep me\n");
  });

  it("leaves the file alone when the network throws", async () => {
    const outputPath = temporaryFile("keep me\n");

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
        outputPath,
      }),
    ).rejects.toThrow("Could not reach the pricing catalog");
    expect(readFileSync(outputPath, "utf8")).toBe("keep me\n");
  });

  it("leaves the file alone when the body is not JSON", async () => {
    const outputPath = temporaryFile("keep me\n");

    await expect(
      refreshPricingSnapshot({
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => "<html>404</html>",
        }),
        outputPath,
      }),
    ).rejects.toThrow("Pricing catalog is not valid JSON");
    expect(readFileSync(outputPath, "utf8")).toBe("keep me\n");
  });

  it("refuses a catalog that no longer prices a model we depend on", async () => {
    const outputPath = temporaryFile("keep me\n");
    const catalog = usableCatalog();
    delete catalog["claude-opus-5"];

    await expect(
      refreshPricingSnapshot({ fetchImpl: respondWith(catalog), outputPath }),
    ).rejects.toThrow("no longer prices: claude-opus-5");
    expect(readFileSync(outputPath, "utf8")).toBe("keep me\n");
  });

  it("refuses a catalog that shrank below the floor", async () => {
    const outputPath = temporaryFile("keep me\n");

    await expect(
      refreshPricingSnapshot({
        fetchImpl: respondWith({ "claude-opus-5": anthropicEntry() }),
        outputPath,
      }),
    ).rejects.toThrow("expected at least");
    expect(readFileSync(outputPath, "utf8")).toBe("keep me\n");
  });
});

describe("the checked-in snapshot", () => {
  it("is exactly what the renderer would write for the same data", () => {
    // Offline round trip: re-render from the module the app actually imports.
    // A hand edit, a reordered row or a renderer change that was not applied
    // to the checked-in file all show up here, and a real refresh's diff stays
    // limited to prices that genuinely moved.
    const path = fileURLToPath(
      new URL("../src/lib/usage-pricing-snapshot.ts", import.meta.url),
    );

    expect(readFileSync(path, "utf8")).toBe(
      renderSnapshotModule(
        Object.entries(PRICING_SNAPSHOT),
        PRICING_SNAPSHOT_DATE,
      ),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/refresh-usage-pricing.test.ts`
Expected: FAIL — `Failed to resolve import "./refresh-usage-pricing.mjs" from "scripts/refresh-usage-pricing.test.ts". Does the file exist?`

- [ ] **Step 3: Write `scripts/refresh-usage-pricing.mjs`**

```js
#!/usr/bin/env node

/**
 * Rewrite `src/lib/usage-pricing-snapshot.ts` from LiteLLM's published price
 * catalog.
 *
 * Run by hand — `npm run refresh:pricing`. NEVER from `predev`, `prebuild` or
 * CI: a build that can reach the network is a build that can change what
 * ships without a code change, and the checked-in snapshot is the only
 * pricing the app ever reads.
 *
 * Nothing is written unless the response parsed, the filter kept a plausible
 * number of models, and every model in `REQUIRED_MODELS` survived. An
 * upstream field rename would otherwise produce a snapshot that parses,
 * typechecks, passes its own tests and silently prices nothing.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const OUTPUT_URL = new URL(
  "../src/lib/usage-pricing-snapshot.ts",
  import.meta.url,
);

/**
 * Which catalog entries are worth shipping. Anthropic's whole `claude-*` line
 * is 24 entries, so it is kept whole; OpenAI publishes 219, of which only the
 * GPT-5, o-series and codex families are reachable from the Codex CLI.
 * Matching is by family prefix rather than by the exact ids seen on one
 * machine, because pricing lookup is exact-match only — a model missing from
 * the snapshot shows no dollars at all, and the next CLI release picks a new
 * default model without asking.
 */
const MODEL_SELECTORS = [
  { provider: "anthropic", pattern: /^claude-/u },
  { provider: "openai", pattern: /^(?:gpt-5|o[134](?:-|$)|codex-)/u },
];

/**
 * Every model id Claude Code and Codex had actually written into their
 * transcripts on this machine as of 2026-08-10. These must survive the
 * filter; if one stops doing so, the catalog changed shape and a human has to
 * look before anything is written.
 */
const REQUIRED_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.1-codex-mini",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];

/** 84 models survived on 2026-08-10. Half that means the filter broke. */
const MIN_SELECTED_MODELS = 40;

/** LiteLLM's own schema placeholder, not a model. */
const SCHEMA_SAMPLE_KEY = "sample_spec";

function finiteRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * One catalog entry as `ModelPricing`, or null when it carries no usable
 * input and output rate — a model we cannot price at all is worse in the
 * snapshot than out of it, because presence is what `isPricedModel` reads.
 */
export function toModelPricing(entry) {
  if (entry === null || typeof entry !== "object") {
    return null;
  }
  const inputPerToken = finiteRate(entry.input_cost_per_token);
  const outputPerToken = finiteRate(entry.output_cost_per_token);
  if (inputPerToken === null || outputPerToken === null) {
    return null;
  }
  return {
    inputPerToken,
    outputPerToken,
    cacheReadPerToken: finiteRate(entry.cache_read_input_token_cost),
    cacheWritePerToken: finiteRate(entry.cache_creation_input_token_cost),
  };
}

function isSelectedId(id, entry) {
  if (entry === null || typeof entry !== "object") {
    return false;
  }
  return MODEL_SELECTORS.some(
    (selector) =>
      entry.litellm_provider === selector.provider && selector.pattern.test(id),
  );
}

/** The catalog reduced to sorted `[id, ModelPricing]` pairs. */
export function selectModels(catalog) {
  if (catalog === null || typeof catalog !== "object") {
    throw new Error("Pricing catalog is not a JSON object");
  }
  const selected = [];
  for (const id of Object.keys(catalog).sort()) {
    if (id === SCHEMA_SAMPLE_KEY) {
      continue;
    }
    const entry = catalog[id];
    if (!isSelectedId(id, entry)) {
      continue;
    }
    const pricing = toModelPricing(entry);
    if (pricing !== null) {
      selected.push([id, pricing]);
    }
  }
  return selected;
}

function rate(value) {
  // String() gives the shortest literal that round-trips exactly, so
  // 5e-7 stays 5e-7 and no precision is lost writing it out.
  return value === null ? "null" : String(value);
}

/** The whole `usage-pricing-snapshot.ts` file, as text. */
export function renderSnapshotModule(models, snapshotDate) {
  const rows = models.map(
    ([id, pricing]) =>
      `  ${JSON.stringify(id)}: { inputPerToken: ${rate(pricing.inputPerToken)}, outputPerToken: ${rate(pricing.outputPerToken)}, cacheReadPerToken: ${rate(pricing.cacheReadPerToken)}, cacheWritePerToken: ${rate(pricing.cacheWritePerToken)} },`,
  );
  return [
    "/**",
    " * GENERATED FILE — rewritten wholesale by `npm run refresh:pricing`",
    " * (`scripts/refresh-usage-pricing.mjs`). Do not edit by hand.",
    " *",
    " * Data only. The pricing math lives in `usage-pricing.ts`, so a script that",
    " * overwrites a whole file can never destroy hand-written logic — the same",
    " * discipline `menu_registry.rs` already uses.",
    " *",
    " * USD per token, from LiteLLM's published catalog, filtered to the Anthropic",
    " * and OpenAI model families the Claude Code and Codex CLIs can emit. These",
    " * are list prices for direct API use; a subscription user does not pay them,",
    " * which is why every figure on screen is labelled an estimate and carries",
    " * `PRICING_SNAPSHOT_DATE`.",
    " */",
    "",
    "export interface ModelPricing {",
    "  /** USD per uncached input token. */",
    "  readonly inputPerToken: number;",
    "  /** USD per output token, reasoning tokens included. */",
    "  readonly outputPerToken: number;",
    "  /** USD per cache-read token; null when the provider publishes no cache rate. */",
    "  readonly cacheReadPerToken: number | null;",
    "  /** USD per cache-write token; null when the provider publishes no cache rate. */",
    "  readonly cacheWritePerToken: number | null;",
    "}",
    "",
    "/** Retrieval date of the table below. Shown beside every dollar figure. */",
    `export const PRICING_SNAPSHOT_DATE = ${JSON.stringify(snapshotDate)};`,
    "",
    "/** Where the numbers came from, so a reader can check them. */",
    "export const PRICING_SOURCE_URL =",
    `  ${JSON.stringify(SOURCE_URL)};`,
    "",
    "/** Exact model-id match only — no aliasing, no prefix fallback (spec §Pricing). */",
    "export const PRICING_SNAPSHOT: Readonly<Record<string, ModelPricing>> = {",
    ...rows,
    "};",
    "",
  ].join("\n");
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchCatalog(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(SOURCE_URL);
  } catch (error) {
    throw new Error(
      `Could not reach the pricing catalog: ${describeError(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Pricing catalog request failed: HTTP ${response.status}`);
  }
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `Pricing catalog is not valid JSON: ${describeError(error)}`,
    );
  }
}

function assertUsable(models) {
  if (models.length < MIN_SELECTED_MODELS) {
    throw new Error(
      `Only ${models.length} models survived the filter; expected at least ${MIN_SELECTED_MODELS}`,
    );
  }
  const present = new Set(models.map(([id]) => id));
  const missing = REQUIRED_MODELS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(`Pricing catalog no longer prices: ${missing.join(", ")}`);
  }
}

/**
 * Fetch, filter, validate, then write. `fetchImpl`, `outputPath` and `now`
 * are injectable so the tests cover the whole path without a network call.
 */
export async function refreshPricingSnapshot(options = {}) {
  const {
    fetchImpl = fetch,
    outputPath = fileURLToPath(OUTPUT_URL),
    now = new Date(),
  } = options;
  const catalog = await fetchCatalog(fetchImpl);
  const models = selectModels(catalog);
  assertUsable(models);
  const snapshotDate = now.toISOString().slice(0, "YYYY-MM-DD".length);
  writeFileSync(outputPath, renderSnapshotModule(models, snapshotDate), "utf8");
  return { modelCount: models.length, snapshotDate, outputPath };
}

function summarize(result) {
  return [
    `refresh-usage-pricing: wrote ${result.modelCount} models`,
    `  date:   ${result.snapshotDate}`,
    `  source: ${SOURCE_URL}`,
    `  output: ${result.outputPath}`,
    "",
  ].join("\n");
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.stdout.write(summarize(await refreshPricingSnapshot()));
  } catch (error) {
    process.stderr.write(`refresh-usage-pricing: ${describeError(error)}\n`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/refresh-usage-pricing.test.ts`
Expected: PASS (17 tests)

If the last test — "is exactly what the renderer would write for the same
data" — is the only failure, the checked-in `src/lib/usage-pricing-snapshot.ts`
from Task B2 was not pasted verbatim. Fix the checked-in file to match the
renderer's output; do **not** bend the renderer to match a mistyped file.

- [ ] **Step 5: Add the one script line to `package.json`**

In the `scripts` block, immediately after
`"preview:updater": "node scripts/capture-updater-preview.mjs",`
(`package.json:16`), add:

```json
    "refresh:pricing": "node scripts/refresh-usage-pricing.mjs",
```

Nothing else in `package.json` changes. In particular `predev` and `prebuild`
keep running only `generate:menu` — wiring the refresh into either of them
would let a build change what ships.

- [ ] **Step 6: Prove the script is reachable and the whole section is green**

Run: `npm run refresh:pricing -- --help 2>&1 | head -1`
Expected: the script ignores unknown arguments and performs a real refresh, so
this is **not** the check to run. Instead run:

Run: `node -e "import('./scripts/refresh-usage-pricing.mjs').then((m) => console.log(Object.keys(m).sort().join(',')))"`
Expected: PASS — prints
`refreshPricingSnapshot,renderSnapshotModule,selectModels,toModelPricing`
and exits 0, proving the module loads and the `pathToFileURL` guard did not
fire (no network call, no file written).

Run: `npx vitest run src/lib/usage-snapshot.test.ts src/lib/usage-pricing-snapshot.test.ts src/lib/usage-pricing.test.ts src/lib/usage-aggregate.test.ts src/usage scripts/refresh-usage-pricing.test.ts`
Expected: PASS (86 tests across 7 files)

Run: `npm run build`
Expected: PASS — `tsc` clean (this is the typecheck; `scripts/**` is outside
`tsconfig.json`'s `include`, every new `src/**` file is inside it) followed by
a successful `vite build`.

Run: `npm test`
Expected: PASS — the full suite, with the new files included and nothing
pre-existing broken.

- [ ] **Step 7: Report the task complete**

Files touched: `scripts/refresh-usage-pricing.mjs` (created),
`scripts/refresh-usage-pricing.test.ts` (created), `package.json` (one line
added to `scripts`).

---

## Findings

### (a) Spec claims wrong, or incomplete, against the real data

1. **`<synthetic>` would have made the entire Claude dollar column an em
   dash.** Claude Code writes assistant lines whose `message.model` is the
   literal string `<synthetic>` — 138 of them across this machine's 1 882
   transcripts. It is not in LiteLLM and never will be. Under the spec's
   "unknown model → no USD" rule combined with §0.3 decision 8's
   "null wins", every Claude `AgentTotal` and every Claude `DailyRow` would
   have reported `costUsd: null` forever, with `unpricedModels:
["<synthetic>"]`, and the dashboard's headline number would never appear.
   **Measured before deciding:** all 138 lines carry
   `input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0,
cache_read_input_tokens: 0` and a `cache_creation` block of two zeros —
   the aggregate over all of them is exactly zero in every counter class.
   The plan therefore short-circuits `estimateCostUsd` to `0` whenever
   `totalTokens(counters) === 0`, for **any** model id. That is arithmetic,
   not a price guess, and it is model-agnostic so no id is special-cased.
   Section A may additionally choose to drop all-zero contributions before
   they become buckets; Section B is correct either way.
2. **Spec §Pricing under-specifies two of the six rates.** It names a
   fallback only for `cache_write` ("OpenAI's cache-write price when defined,
   else input price"). It says nothing about a model whose
   `cache_read_input_token_cost` is absent, or a Claude-shaped
   `cache_create_5m` under a model with no cache-write rate. See (c).
3. **The spec's 1 h rule is confirmed by the source, not merely inherited
   from ccusage.** For all five Claude models this machine has run, LiteLLM's
   `cache_creation_input_token_cost_above_1hr` is _exactly_
   `input_cost_per_token × 2` (opus-5 5e-6 → 1e-5; sonnet-5 2e-6 → 4e-6;
   fable-5 1e-5 → 2e-5; opus-4-8 5e-6 → 1e-5; sonnet-4-6 3e-6 → 6e-6).
   22 of the 24 Anthropic entries publish the key. The plan still computes
   `input × 2` rather than carrying a fifth field, because `ModelPricing` is
   frozen at four — but the rule is now evidence-backed rather than folklore.
4. **Codex `archived_sessions/` exists on this machine** (20 of the 480
   rollout files). That is Section A's problem, not B's, but the spec's
   dedupe-by-session-id rule is exercised by real data here rather than
   hypothetically.

### (b) Objections to the frozen §0

None that block. Two notes, neither divergent:

1. **§0.2.4 places `USAGE_POLL_MS = 5000` in `usage-store.ts` but §0.2.5 does
   not list it among that module's published names.** The plan honours the
   stricter of the two: the constant exists, named, with a comment saying why
   it is 5 000, but it is **not exported**. The store test restates `5000` as
   its own local const, which makes a change to the interval fail a test
   instead of passing silently.
2. **§0.2.5 lists `estimateCostUsd`'s signature across a table-cell boundary**
   (`… ): number` / `| null` land in different columns of the markdown
   table). Read as `number | null`; that is unambiguous from the row's
   context and from the `AgentTotal.costUsd` freeze. No divergence, just a
   rendering artifact worth not misreading.

### (c) Forks I did not decide

1. **The two invented rate fallbacks.** `cacheRead` falls back to
   `inputPerToken` when the provider publishes no cache-read rate, and
   `cacheCreate5m` uses `cacheWritePerToken ?? inputPerToken` — extending the
   spec's documented `cache_write` rule to the two cases it does not name.
   The stricter alternative is to return `null` (unpriced) whenever a missing
   rate meets a nonzero counter. I chose the fallback because it degrades a
   dollar figure rather than deleting it. **Both are dead code on observed
   data:** every one of the 12 model ids this machine emits publishes
   `cache_read_input_token_cost`, and only four models in the whole snapshot
   lack it (`gpt-5-pro`, `gpt-5.2-pro`, `o1-pro`, `o3-pro`), none of which
   Codex CLI can select. If the user prefers strictness, it is a
   three-line change in `estimateCostUsd`.
2. **The family-prefix filter (84 models) versus a strict "ids actually
   emitted" filter (12 models).** The brief says "further narrowed to the
   model ids these two CLIs actually emit"; I narrowed to the _families_
   instead. Reason: pricing is exact-match-only in v1, so a model absent from
   the snapshot silently shows no dollars, and the next CLI release changes
   its default model without asking. 84 rows cost 121 lines of generated
   data. If the user wants the strict reading, the change is one line in
   `MODEL_SELECTORS`.
3. **`formatUsd`'s exact shape.** Nothing in `src/` formats a number today —
   no `Intl`, no `toFixed`, no `toLocaleString` anywhere — so this section
   invents the house format rather than following one. The `< $0.0001` band
   in particular is a judgement call. It is one function with five tests.
4. **`EMPTY_USAGE_SNAPSHOT.sources` carrying two `missing` entries rather
   than `[]`.** Defensible either way; I chose the one that keeps the
   payload's "exactly two" invariant true everywhere, so C never needs a
   presence check. Reversible in one edit.

### (c-bis) Two defects found by running the plan's own code, and fixed in it

Every file in this section was written out to a scratch tree and executed
against this repo's own vitest 3.2.6 and `tsc` before the plan was finalised.
Two things that read as obviously correct turned out not to be:

1. **`process.env.TZ` in a `src/` test breaks `npm run build`.** Four
   `TS2580: Cannot find name 'process'` errors — this repo carries no
   `@types/node` and no file under `src/` had ever touched `process`. The
   tests still passed under `npx vitest`, so the failure would only have
   surfaced at the final build. Fixed with a one-line ambient
   `declare const process` in the one test that needs it; see Task B4's
   point 3. **No dependency was added** — `@types/node` would be a fork.
2. **Queuing `Promise.reject(...)` in an array is an unhandled rejection.**
   The store test's original `queuedClient` took ready-made promises, so the
   two rejection fixtures were unhandled from the moment the array literal
   evaluated: vitest reported `Errors 2` beside `86 passed`. Fixed by making
   the queue hold **factories** (`() => Promise<UsageSnapshot>`), so a
   rejection is only created when the client is actually called. The final
   run is 86 passed, 0 errors.

3. **A markdown formatter will reflow the generated snapshot if you let
   it.** That is why Task B2's block is fenced as `text` rather than `ts`:
   reflowed into one property per line it stops being byte-identical to the
   renderer, and B7's round-trip test fails. The repo itself ships no
   formatter, so this is a hazard of editing the plan, not of the code.

Corrected counts after those fixes: B1 8, B2 8, B3 14, B4 23, B5 4, B6 12,
B7 17 — **86 in total**, `tsc -p tsconfig.json` exit 0.

### (d) Deliberate omissions

1. **No `DAILY_WINDOW_DAYS` export.** §0.2.5 freezes this module's export
   list; the 30 belongs to C as its own named const (C9). Stated in "What
   this section produces" so C is not left guessing.
2. **No `USAGE_AGENTS` constant.** For the same freeze reason. C reads both
   agent slots from `snapshot.sources`, which the Rust contract guarantees to
   be exactly two, Claude then Codex.
3. **No jsdom anywhere in this section.** Every module here is node-safe;
   `@preact/signals` needs no DOM to create a signal. No file carries the
   `// @vitest-environment jsdom` pragma.
4. **No prices asserted in `usage-pricing-snapshot.test.ts`.** A price change
   is what a refresh is for; a test that pins prices gets hand-edited on
   every refresh and stops being a tripwire. Presence, structure, ordering
   and provenance are asserted instead. The one place exact prices _are_
   pinned is `usage-pricing.test.ts`, where they are arithmetic inputs to a
   hand-checked total — if a real price moves, exactly one test needs its
   number recomputed, and that is the right amount of friction.
5. **No integration test that actually hits the network.** The refresh
   script's happy path is covered with an injected `fetchImpl`; a test that
   reached GitHub would be flaky and would make `npm test` require internet.
   The offline round-trip test in B7 is what proves the checked-in file and
   the renderer agree.
6. **`estimateCostUsd` does no alias resolution.** Spec §Pricing pins v1 to
   exact match. The five short aliases this machine's transcripts contain
   (`opus`, `sonnet`, `haiku`, `fable`, `opus[1m]`) appear only on lines
   **without** `message.usage`, so they never reach the pricing path — see
   the provenance paragraph.
7. **No debounce or backoff on a repeatedly failing poll.** It retries every
   5 s while the screen is open, which is what the spec asks for. A screen
   the user closes stops it.

### (e) Pricing-data provenance

**The data is real and was obtained at planning time.**

- **URL:** `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
- **Fetched:** 2026-08-10, with `curl` — HTTP 200, 1 676 411 bytes, 2 988
  top-level keys.
- **Field names confirmed in the real file**, exactly as the brief listed
  them: `input_cost_per_token`, `output_cost_per_token`,
  `cache_read_input_token_cost`, `cache_creation_input_token_cost`,
  `litellm_provider`. Also present and deliberately **not** used:
  `cache_creation_input_token_cost_above_1hr`,
  `input_cost_per_token_above_200k_tokens`, and the `_flex` / `_priority`
  service-tier variants — `ModelPricing` is frozen at four fields, and none
  of the tier variants can be attributed from a transcript anyway.
- **Provider counts in the raw file:** 24 `anthropic`, 219 `openai`.
- **Survived the filter: 84 models** — all 24 Anthropic `claude-*`, plus 60
  OpenAI ids matching `gpt-5*`, `o1*`, `o3*`, `o4*`, `codex-*`. Rendered as
  121 lines. Verified over the selected set: ids are sorted ascending, every
  `output_cost_per_token >= input_cost_per_token`, and every published
  `cache_read_input_token_cost <= input_cost_per_token`.

**Distinct model strings found in the local transcripts.**

Claude — full scan of all 1 882 files under `~/.claude/projects` (1 444 of
them in `subagents/` directories), reading `message.model` on every line that
carried a `message.usage` object: 126 826 such lines, 19 unparsable.

| `message.model`     | usage lines | Status                                                 |
| ------------------- | ----------- | ------------------------------------------------------ |
| `claude-opus-5`     | 52 836      | **priced**                                             |
| `claude-sonnet-5`   | 33 608      | **priced**                                             |
| `claude-fable-5`    | 22 846      | **priced**                                             |
| `claude-opus-4-8`   | 16 444      | **priced**                                             |
| `claude-sonnet-4-6` | 954         | **priced**                                             |
| `<synthetic>`       | 138         | **unpriced — always zero tokens, so it costs `$0.00`** |

Codex — all 480 rollout files under `~/.codex/sessions` **and**
`~/.codex/archived_sessions`, reading `turn_context.payload.model`:

| `turn_context.payload.model` | occurrences | Status     |
| ---------------------------- | ----------- | ---------- |
| `gpt-5.6-sol`                | 1 601       | **priced** |
| `gpt-5.5`                    | 402         | **priced** |
| `gpt-5.6-terra`              | 123         | **priced** |
| `gpt-5.4`                    | 108         | **priced** |
| `gpt-5.6-luna`               | 45          | **priced** |
| `gpt-5.3-codex`              | 21          | **priced** |
| `gpt-5.1-codex-mini`         | 7           | **priced** |

**Every distinct string is accounted for: 12 of the 13 are in the snapshot,
and the thirteenth (`<synthetic>`) is unpriced by design and provably
free.**

One further observation worth recording so nobody re-derives it. A naive
`grep '"model":"…"'` over the same Claude corpus also surfaces `sonnet`,
`opus`, `haiku`, `fable` and `opus[1m]`. Those are **not** `message.model` on
a usage-bearing line — they come from other JSON in the transcript (slash
command payloads, tool inputs, session metadata). Parsing properly, as the
table above does, they disappear entirely. A scanner that greps instead of
parsing will manufacture five unpriced models out of nothing and blank the
Claude dollar column just as surely as `<synthetic>` would have.

---

# Section C — The UsageScreen surface and DL rules

> Wave 2. Depends on Section B's exported names (§0.2.5) and, for the eye
> review only, on Section A's `usage_snapshot` command being live.
> **Files this section owns:** `src/ui/usage/**` (create) · `src/styles.css`
> (the whole file, including the reduced-motion scope list) ·
> `docs/DESIGN-LANGUAGE.md`. Nothing else. `src/ui/app.tsx` is touched **only**
> inside Task C8 and is reverted before that task ends — Section D owns it.

---

## Verified source facts this section builds on

Every reference below was read at working-tree HEAD `69abe81` on 2026-08-10.
Line anchors drift (§0.1) — re-read before editing.

**The shell this section clones**

- `src/ui/settings/settings-screen.tsx:10-13` — `interface SettingsScreenProps { open: boolean; onClose: () => void }`. `UsageScreen` takes exactly this shape.
- `src/ui/settings/settings-screen.tsx:32-36` — mount focus: `useEffect(() => { if (open) escRef.current?.focus({ preventScroll: true }); }, [open])`. Keyed on `open`, **not** on mount, because the screen never unmounts.
- `src/ui/settings/settings-screen.tsx:40-63` — the window-level Escape handler, keyed `[open, onClose]`, with the `target instanceof Element && target.closest(".xterm")` bail-out and the `target.blur()` before `onClose()`.
- `src/ui/settings/settings-screen.tsx:68-71` — unknown active id falls back to the first registry entry rather than rendering an empty panel.
- `src/ui/settings/settings-screen.tsx:74-107` — `<aside class="settings-screen ${open ? "is-open" : ""}" aria-label aria-hidden={!open}>`, `__head` (`__path` + `__esc`), `__grid` (nav + `<section role="tabpanel">`).
- `src/ui/app.tsx:779` — `<SettingsScreen open={settingsOpen.value} onClose={closePanel} />` is mounted unconditionally inside `<main>`; the surface is always in the tree. This is why polling must be driven by the `open` prop. (Its import is at `:58`. Both moved during planning — `app.tsx` is Section D's file and is being edited elsewhere, so re-read before Task C8.)

**The rail this section clones**

- `src/ui/settings/settings-nav.tsx:25-88` — `role="tablist"` + `role="tab"`, `aria-orientation="vertical"`, `↑`/`↓` roving with `(from + step + length) % length`, DOM focus moved together with the signal.
- `src/ui/settings/settings-categories.ts:26` — one stable `SECTION_PANEL_ID`, not one id per category; `:29-31` — `categoryTabId()`; `:33-39` — `{ id, label, Icon, Section }`; `:49-77` — the registry as `readonly SettingsCategory[]`.
- `src/ui/settings/active-category-store.ts:9-18` — a bare module signal, window-scoped, not persisted (R5).
- `src/ui/settings/settings-nav-icons.tsx:17-47` — icons wrapped as named semantic components over `DeckIcon` at `RAIL_ICON`.
- `src/ui/controls/deck-icon.tsx:17-23` — `CHROME_ICON` 13, `ROW_ICON` 14, `BOARD_ICON` 15, `RAIL_ICON` 16.

**CSS facts**

- `src/styles.css` is **2829 lines**; the settings screen block runs `2709-2829` and the settings rail block `2639-2707`. Both end the file — the new usage blocks append after them.
- `src/styles.css:1431-1440` — the reduced-motion block, currently five selector groups: `.settings-screen`, `.settings-screen *`, `.tabbar *`, `.wsbar *`, `.prompt-popover *`, `.status *`. **The other four must survive** the edit.
- `src/styles.css:28-34` — the `:root` comment that states there is deliberately **no `--mono` companion token**. DL-15.4 quotes this reasoning; do not contradict it.
- `src/styles.css:1197` — `.cfg-btn` already sets `font-variant-numeric: tabular-nums`, the DL-4.2 mechanism DL-15.4 reuses.
- `src/styles.css:2794-2799` — `.settings-screen__grid { grid-template-columns: 220px minmax(0, 1fr) }` with `min-height: 0`. The `minmax(0, 1fr)` is what lets an overflowing child actually shrink; DL-15.3 depends on it.
- `src/styles.css:2811-2814` — the settings section clamps `.cfg-row` / `.cfg-group` to `max-width: 620px`. The usage section deliberately does **not** inherit that clamp (a 9-column table needs the width).

**Doc facts**

- `docs/DESIGN-LANGUAGE.md:200-221` — §11 as it stands today, quoted verbatim in Task C1.
- `docs/DESIGN-LANGUAGE.md:167-186` — §9, whose item 3 names `.settings-screen *` as _the_ reduced-motion scope example.
- `docs/DESIGN-LANGUAGE.md:188-198` — §10's migration-status table.
- `docs/DESIGN-LANGUAGE.md:252-272` / `:274-307` — §13 and §14, the shape §15 copies (dated preamble → which § it forks → why it is not a new genre → numbered bullets).
- `docs/DESIGN-LANGUAGE.md:309-316` — the trailing `## Chưa khớp thực tế` ledger. §15 goes **before** it.
- `~/.claude/scripts/docs-anchors.sh:26-28` — a markdown link in a living doc whose target file does not exist is a hard failure. `~/.claude/scripts/docs-compliance.sh:33-37` — every markdown link in a living doc must carry a `current`/`decided`/`building`/`deprecated` label. **Consequence: §15 cites code in inline backticks only, never as a markdown link** — exactly what §12/§13/§14 already do. Adding `[metric-table.tsx](../src/ui/usage/metric-table.tsx)` in Task C1 would fail `docs-anchors.sh`, because C3 has not created the file yet.
- Only one markdown link exists in the whole of `DESIGN-LANGUAGE.md` today (DL-4.1's `toFontStack`, already labelled `current`). Neither the §11 rewrite nor §15 adds a second.

**Data / contract facts**

- `src/lib/agent-catalog.ts:29-38` — `BUILTIN_AGENTS` labels Claude `"Claude Code"` and Codex `"Codex"`. `USAGE_AGENT_LABEL` must match those words; the same tool must not carry two names in one app.
- §0.2.4 fixes `BUCKET_MS = 15 * 60 * 1000`. Local midnight always lands on a 15-minute UTC boundary for every real-world offset (including :30 and :45), so the overview's "today" filter `bucketStartMs >= startOfLocalDay(now)` is **exact**, not an approximation — that is precisely why the bucket is 15 minutes and not an hour.
- §0.2.5 freezes what Section B publishes. This section imports only: `UsageSnapshot`, `UsageAgent`, `UsageCounters`, `totalTokens` from `src/lib/usage-snapshot`; `AgentTotal`, `DailyRow`, `BreakdownRow`, `agentTotals`, `dailyRows`, `breakdownRows` from `src/lib/usage-aggregate`; `formatUsd` from `src/lib/usage-pricing`; `PRICING_SNAPSHOT_DATE` from `src/lib/usage-pricing-snapshot`; `usageSnapshot`, `usageStale`, `usageLoading`, `startUsagePolling`, `stopUsagePolling` from `src/usage/usage-store`.

**Toolchain facts**

- `preact@10.29.3`, `@preact/signals@2.9.2` (installed, verified with `node -p`). `useId` is exported from `preact/hooks` (`node_modules/preact/hooks/src/index.d.ts:145`).
- `node_modules/@preact/signals/dist/signals.d.ts:6` — `useSignalEffect(cb, options?)` takes **no dependency array**. It re-runs only when a _signal_ read inside `cb` changes; a prop change cannot re-trigger it. See Findings (d).
- `src/prompts/prompt-popover.test.tsx:52-59` — the repo-specific trap: `useSignalEffect` schedules through `options.requestAnimationFrame`, so a signal write is not observable on the next microtask. The documented workaround is `new Promise((resolve) => setTimeout(resolve, 32))`.
- `src/ui/workspace-sidebar.test.tsx:19` and `src/open-board/open-board.removal.test.tsx:27-33` — the `vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))` idiom used whenever a component's import chain reaches `invoke`.
- `src/ui/settings/sections/reset-section.test.tsx:1-79` and `src/ui/settings/settings-nav.test.tsx:1-53` — the canonical jsdom + Preact + `act()` shapes (explicit vitest imports, host div per test, `render(null, host)` in `afterEach`).
- `scripts/icon-system.test.ts:44-53` — `RETIRED_GLYPHS` is `↩ ▾ ‹ › × ＋ ↹ ↺`. The em dash `—` is **not** on that list, so DL-15.6's dash does not trip the icon guard. (`·` is not on it either.)
- `grep -rn "<table\|<thead\|<tbody\|role=\"table\"" src marketing` returns **nothing**. There is no existing data table in this app.

---

## What this section produces for Section D

Exactly one public component:

```ts
import { UsageScreen } from "./usage/usage-screen"; // from src/ui/app.tsx

interface UsageScreenProps {
  open: boolean;
  onClose: () => void;
}
```

Path: `src/ui/usage/usage-screen.tsx`. Props are byte-for-byte
`SettingsScreenProps` (`src/ui/settings/settings-screen.tsx:10-13`), so
Section D mounts it the same way `app.tsx:779` mounts Settings:

```tsx
<UsageScreen open={usageOpen.value} onClose={closeUsagePanel} />
```

Behaviour Section D can rely on:

- The screen is **always mounted**. `open` drives visibility (`.is-open`), mount
  focus, the Escape listener, and the snapshot poll. Section D must not
  conditionally render it.
- The screen starts `startUsagePolling()` when `open` goes true and calls
  `stopUsagePolling()` when it goes false or the tree unmounts. Section D wires
  no polling of its own.
- The screen owns Escape (including the `.xterm` bail-out and the pre-close
  `blur()`); Section D does not add a second Escape path.
- z-index is 35 — the same layer as `.settings-screen`, which is safe because
  §0.2.6 makes the two mutually exclusive.

Everything else under `src/ui/usage/` is internal to this section:
`usage-nav.tsx`, `usage-views.ts` (`USAGE_VIEWS`), `usage-nav-icons.tsx`,
`active-usage-view-store.ts` (`activeUsageView`), `usage-format.ts`,
`metric-table.tsx`, `usage-status.tsx`, `sections/*.tsx`.

---

## Task order

| Task | What it lands                                                                         | Why here                                            |
| ---- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| C1   | `docs/DESIGN-LANGUAGE.md`: §11 generalized, new §15, §9.3 example widened             | Rules exist before any code or CSS cites them       |
| C2   | `active-usage-view-store.ts`, `usage-format.ts` + tests                               | Pure leaves; everything else imports them           |
| C3   | `metric-table.tsx` + test — the DL §15 widget                                         | The three sections are all made of it               |
| C4   | `usage-status.tsx` + test — loading / missing / unreadable / skipped / stale          | Independent of the tables; keeps the screen thin    |
| C5   | `sections/overview-section.tsx`, `daily-section.tsx`, `breakdown-section.tsx` + tests | Needs C2 + C3                                       |
| C6   | `usage-nav-icons.tsx`, `usage-views.ts`, `usage-nav.tsx`, `usage-screen.tsx` + tests  | The registry imports the sections, so it comes last |
| C7   | `src/styles.css` — shell, rail, status, table blocks + the reduced-motion scope list  | Cites DL numbers created in C1                      |
| C8   | Eye review on `npm run tauri dev`, 3 views × 2 themes                                 | The only completion criterion for a UI change       |

---

### Task C1: Generalize DESIGN-LANGUAGE §11 and add §15 (read-only data tables)

**Files:**

- Modify: `docs/DESIGN-LANGUAGE.md` (§9 item 3 at ~line 176-178; §11 at ~lines 200-221; insert §15 between §14's last bullet ~line 307 and the `## Chưa khớp thực tế` heading ~line 309)

**Interfaces:**

- Consumes: nothing.
- Produces: rule numbers `DL-11.1`…`DL-11.5` (unchanged), `DL-15.1`…`DL-15.8` (new). Tasks C3 and C7 cite them from code comments.

**Both DL changes are pre-approved R2 forks** — `AGENTS.md` in-flight list,
spec §Decisions 7, plan §0.2.7. Do not re-ask.

**Hard constraint, load-bearing:** cite code in **inline backticks only**.
A markdown link here goes through `docs-anchors.sh`, which fails on a target
file that does not exist — and `src/ui/usage/metric-table.tsx` is not created
until Task C3. `docs-compliance.sh` additionally demands an intent label on
every link. §12, §13 and §14 already reference file paths in backticks; follow
them.

- [ ] **Step 1: Confirm the text you are about to replace is still what this task quotes**

Run: `sed -n '176,178p;200,221p;307,316p' docs/DESIGN-LANGUAGE.md`

Expected: the §9 item-3 fragment, then §11 exactly as quoted in Step 2, then
§14's last bullet followed by the `## Chưa khớp thực tế` heading. If any of
the three differs, stop and report rather than editing blind.

- [ ] **Step 2: Replace §11 — heading and preamble generalize, the five numbers do not move**

The current §11, **verbatim** (`docs/DESIGN-LANGUAGE.md:200-221`):

```md
## 11. Settings shell

The settings surface is a full-window screen, not a drawer: a fixed category
rail beside a section area. §5's config row is still the only control inside a
section — these rules govern the frame around it.

- **DL-11.1** The settings shell is a two-column surface: a fixed nav rail, and
  a section area that owns **all** scrolling. The rail never scrolls with the
  content beside it.
- **DL-11.2** The active category is marked by a 2px left accent bar plus a 4%
  `--fg` wash — the same signifier as config row hover (DL-5.1), so "active"
  reads the same everywhere in the app. No shadow, no fill (DL-1.3).
- **DL-11.3** Category icons are Lucide icons rendered through `DeckIcon` (§14)
  at 16px, one per category, chosen for what the category _is_ rather than for
  variety. They were hand-drawn inline SVG until 2026-08-09; the rule now
  points at §14 so icon questions are settled in one place instead of once per
  category.
- **DL-11.4** Category labels are lowercase `--ui-font` (DL-4.1, like all
  chrome). The rail item _is_ the group label it replaced, so a section does
  not repeat its own name as a heading inside itself.
- **DL-11.5** Destructive actions never sit among navigable categories. They
  are pinned to the rail's foot, below a hairline, marked `--red` (DL-3.2).
```

Replace it with **exactly** this:

```md
## 11. Full-window screens

A full-window screen covers the stage instead of sitting beside it: a fixed
nav rail beside a section area. Settings was the first and is still the
reference implementation; the token usage screen (2026-08-10) is the second,
which is why these rules now say "a full-window screen" where they used to say
"the settings shell". §5's config row is still the only control inside a
settings section — these rules govern the frame around it, whatever a given
screen puts in its sections.

- **DL-11.1** A full-window screen shell is a two-column surface: a fixed nav
  rail, and a section area that owns **all** scrolling. The rail never scrolls
  with the content beside it.
- **DL-11.2** The active rail item is marked by a 2px left accent bar plus a 4%
  `--fg` wash — the same signifier as config row hover (DL-5.1), so "active"
  reads the same everywhere in the app. No shadow, no fill (DL-1.3).
- **DL-11.3** Rail icons are Lucide icons rendered through `DeckIcon` (§14)
  at 16px, one per rail item, chosen for what the item _is_ rather than for
  variety. They were hand-drawn inline SVG until 2026-08-09; the rule now
  points at §14 so icon questions are settled in one place instead of once per
  item.
- **DL-11.4** Rail labels are lowercase `--ui-font` (DL-4.1, like all
  chrome). The rail item _is_ the group label it replaced, so a section does
  not repeat its own name as a heading inside itself.
- **DL-11.5** Destructive actions never sit among navigable rail items. They
  are pinned to the rail's foot, below a hairline, marked `--red` (DL-3.2). A
  screen with no destructive action has no foot at all; the slot is not filled
  with something else to keep the shape symmetrical.
```

Five numbers, same five subjects, same five recipes. The only rule with new
sentences is DL-11.5, and it only says what an empty foot means — the usage
screen has no destructive action and must not invent one.

- [ ] **Step 3: Widen §9 item 3's reduced-motion example**

There is now a second scope, and §9 is the checklist an agent actually reads.
Replace, in `docs/DESIGN-LANGUAGE.md:176-178`:

```md
3. Any animation fits the budget in §7 and the constraints in §1. Reduced-motion
   is handled **by scope** (`.settings-screen *`), never by an allowlist of
   class names — an allowlist silently misses the next class.
```

with:

```md
3. Any animation fits the budget in §7 and the constraints in §1. Reduced-motion
   is handled **by scope** (`.settings-screen *`, `.usage-screen *`), never by
   an allowlist of class names — an allowlist silently misses the next class.
   A new full-window screen adds its own scope to that list; it does not add
   the individual classes inside it.
```

- [ ] **Step 4: Insert §15 between §14 and the ledger**

Insert the following **after** §14's `DL-14.6` bullet and **before** the
`## Chưa khớp thực tế` heading, with one blank line either side:

```md
## 15. Read-only data tables

Approved as a fork on 2026-08-10, for the token usage dashboard. §5 governs a
row whose key carries exactly one interactive value, and §12 governs a list the
user adds to and deletes from; a page of measured numbers is neither. A daily
usage grid has no key to name, no value to set, and nothing to add or remove —
every cell is a fact that was counted. These rules say how such a grid stays
part of this design language instead of becoming a new widget genre: it is a
**table of facts**, and the one thing it must never grow is an interaction.

- **DL-15.1** A metric table sits on the screen's own `--chrome-2` surface
  inside a 1px `--hair` container, radius 8px — the same box §13 gives a
  popover, minus the hairline emphasis, because a table is content on a
  surface rather than a surface of its own. Rows are separated by `--hair`
  hairlines and nothing else: no zebra striping, no fills, no shadow (DL-1.3,
  DL-3.3). Depth in this app is a background step, and a table is not a card.
- **DL-15.2** A metric table is **read-only and non-interactive**: no sort
  control, no column reordering, no row click target, and — the part that gets
  broken first — **no row hover treatment**. The accent bar of DL-5.1 means
  "this row does something"; a row that lights up under the pointer and then
  does nothing is a broken promise, and it is the one affordance a reader will
  try. Adding sorting or filtering is a design decision, not an implementation
  detail: propose an edit to this document first (§9.1).
- **DL-15.3** Horizontal overflow scrolls **inside the table's own container**,
  never on the page body and never by shrinking the type. The container carries
  `overflow-x: auto`; the shell around it keeps `min-height: 0` and a
  `minmax(0, 1fr)` track so the grid can actually shrink (DL-11.1). A wide
  table is then one element's problem instead of a horizontal scrollbar under
  the whole app.
- **DL-15.4** Numerals are **right-aligned** and set with
  `font-variant-numeric: tabular-nums` (DL-4.2); text columns stay
  left-aligned. This repo has **no `--mono` token** and will not gain one — the
  monospace face belongs to the terminal (DL-4.1), and a mono column here would
  read as terminal output that leaked into native UI. Tabular figures in
  `--ui-font` are what hold a column of digits in line, and right alignment is
  what makes magnitudes comparable down the column; between them they do
  everything a monospace column was wanted for.
- **DL-15.5** A column header is lowercase `--ui-font` at 10.5px in
  `--text-faint` at normal weight (DL-4.1, DL-4.3, DL-4.4) — the same treatment
  as a `cfg-group` label, because that is what it is: the name of the thing
  below it, not a heading competing with the data. No uppercase, no bold, no
  sort caret.
- **DL-15.6** A value that is unknown, unavailable or not applicable renders as
  a single em dash `—` in `--text-faint`. Never `0`, never `n/a`, never an
  empty cell. Zero is a measurement and the dash is the absence of one: a table
  that prints `0` where it means "we hold no price for this model" is stating a
  fact it does not have.
- **DL-15.7** The markup is a real `<table>` with `<thead>`, `<tbody>`,
  `<th scope="col">` on every column header and `<th scope="row">` on the cell
  that identifies the row. A grid of `<div>`s is unreadable to assistive tech,
  and this is data whose only meaning is which row and which column a number
  sits in. The table's accessible name comes from a visible heading above it
  via `aria-labelledby`, and any disclaimer under it via `aria-describedby` —
  not from `<caption>`, because a caption lives inside the DL-15.3 scroll
  container and would slide out of view with the columns.
- **DL-15.8** A table with no rows still renders its header row plus one
  spanning cell saying what is absent, in `--text-faint`. A table that vanishes
  when empty leaves the reader unable to tell "nothing has happened yet" from
  "something is broken" — a distinction the screen around it is required to
  make, and which it cannot make if the evidence disappears.
```

- [ ] **Step 5: Prove no rule number moved and no link was introduced**

Run: `grep -c "DL-11\.[1-5]" docs/DESIGN-LANGUAGE.md`
Expected: PASS — `6`. Five §11 rule lines **plus one** — DL-15.3 cross-cites
`DL-11.1` for the `min-height: 0` / `minmax(0, 1fr)` requirement, the way §13
cross-cites §5 and §12. A `5` here means the §15 cross-cite is missing.

Run: `grep -n "DL-11\.[0-9]" docs/DESIGN-LANGUAGE.md`
Expected: PASS — six lines: `DL-11.1` … `DL-11.5` in order inside §11, plus the
single `DL-11.1` cross-cite inside DL-15.3. No `DL-11.6` anywhere.

Run: `grep -n "DL-15\.[0-9]" docs/DESIGN-LANGUAGE.md`
Expected: PASS — eight lines, `DL-15.1` … `DL-15.8` in order.

Run: `grep -nE '\[[^]]*\]\([^)]+\)' docs/DESIGN-LANGUAGE.md`
Expected: PASS — exactly one hit, DL-4.1's `[toFontStack](../src/terminal/pane.ts) \`current\``. Any second hit means a markdown link crept into the new text; convert it to backticks.

Run: `grep -n "## " docs/DESIGN-LANGUAGE.md | tail -4`
Expected: PASS — `## 13.`, `## 14.`, `## 15. Read-only data tables`, `## Chưa khớp thực tế`, in that order (the ledger stays last, D7).

- [ ] **Step 6: Run the docs gates**

Run: `bash ~/.claude/scripts/docs-compliance.sh /Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Expected: PASS — `✅ … tuân thủ D5/D6/D7`.

Run: `bash ~/.claude/scripts/docs-anchors.sh /Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Expected: PASS — no output, exit 0.

- [ ] **Step 7: Check whether §10 needs a migration row**

Run: `grep -rn "<table\|<thead\|<tbody\|role=\"table\"" src marketing`
Expected: PASS — **no output**. No table exists in the app today, so nothing
stops complying when §15 lands and **no row is added to §10's migration table**.
If this grep ever prints a hit, add one row naming that file and the rule it
violates before finishing the task.

- [ ] **Step 8: Report the task complete**

Files touched: `docs/DESIGN-LANGUAGE.md`.

---

### Task C2: The view store and the display-formatting module

**Files:**

- Create: `src/ui/usage/active-usage-view-store.ts`
- Create: `src/ui/usage/active-usage-view-store.test.ts`
- Create: `src/ui/usage/usage-format.ts`
- Create: `src/ui/usage/usage-format.test.ts`

**Interfaces:**

- Consumes: `UsageAgent` from `src/lib/usage-snapshot`, `formatUsd` from `src/lib/usage-pricing`, `PRICING_SNAPSHOT_DATE` from `src/lib/usage-pricing-snapshot` (all §0.2.5).
- Produces:
  - `type UsageViewId = "overview" | "daily" | "breakdown"`, `activeUsageView: Signal<UsageViewId>`
  - `EM_DASH`, `USAGE_AGENT_ORDER`, `USAGE_AGENT_LABEL`, `ESTIMATE_NOTE`, `formatTokens(value: number): string`, `usdCell(costUsd: number | null): string | null`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/usage/active-usage-view-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeUsageView } from "./active-usage-view-store";

describe("activeUsageView", () => {
  it("defaults to overview", () => {
    expect(activeUsageView.value).toBe("overview");
  });

  it("sticks when assigned", () => {
    activeUsageView.value = "daily";
    expect(activeUsageView.value).toBe("daily");

    activeUsageView.value = "breakdown";
    expect(activeUsageView.value).toBe("breakdown");

    activeUsageView.value = "overview";
  });
});
```

Create `src/ui/usage/usage-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { formatUsd } from "../../lib/usage-pricing";
import { PRICING_SNAPSHOT_DATE } from "../../lib/usage-pricing-snapshot";
import {
  EM_DASH,
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
} from "./usage-format";

describe("USAGE_AGENT_LABEL", () => {
  it("uses the same words the agent catalog already uses", () => {
    // Two names for one tool inside one app is the bug this guards.
    for (const agent of USAGE_AGENT_ORDER) {
      const builtin = BUILTIN_AGENTS.find((entry) => entry.id === agent);
      expect(builtin?.label).toBe(USAGE_AGENT_LABEL[agent]);
    }
  });

  it("orders claude before codex, matching the scanner's source order", () => {
    expect([...USAGE_AGENT_ORDER]).toEqual(["claude", "codex"]);
  });
});

describe("formatTokens", () => {
  it("groups thousands so magnitudes are readable at a glance", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1234)).toBe("1,234");
    expect(formatTokens(1204338)).toBe("1,204,338");
  });
});

describe("usdCell", () => {
  it("returns null for an unpriced value so the table paints the dash", () => {
    // The dash itself is the table's job (DL-15.6) — this must not
    // pre-render a placeholder of its own.
    expect(usdCell(null)).toBeNull();
    expect(usdCell(null)).not.toBe(EM_DASH);
  });

  it("delegates a real number to the shared money formatter", () => {
    expect(usdCell(12.5)).toBe(formatUsd(12.5));
    // Zero is a measurement, not an absence (DL-15.6).
    expect(usdCell(0)).toBe(formatUsd(0));
  });
});

describe("ESTIMATE_NOTE", () => {
  it("names the estimate and carries the pricing snapshot date", () => {
    expect(ESTIMATE_NOTE).toContain("estimated at API prices");
    // Interpolated, never hardcoded: a pricing refresh must not fail a test.
    expect(ESTIMATE_NOTE).toContain(PRICING_SNAPSHOT_DATE);
  });

  it("never claims more than the data supports", () => {
    expect(ESTIMATE_NOTE).not.toContain("machine-wide");
    expect(ESTIMATE_NOTE).not.toContain("all-time");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/usage/active-usage-view-store.test.ts src/ui/usage/usage-format.test.ts`
Expected: FAIL — `Failed to resolve import "./active-usage-view-store"` and `Failed to resolve import "./usage-format"`.

- [ ] **Step 3: Write `src/ui/usage/active-usage-view-store.ts`**

```ts
import { signal } from "@preact/signals";

/**
 * Which view the usage rail shows. A bare module signal, the same idiom as
 * `settings/active-category-store.ts` and `chrome/events.ts`'s `settingsOpen`
 * (R5) — window-scoped, not persisted. Reopening the screen in the same
 * session returns to the last view; a relaunch always starts at "overview".
 */
export type UsageViewId = "overview" | "daily" | "breakdown";

export const activeUsageView = signal<UsageViewId>("overview");
```

- [ ] **Step 4: Write `src/ui/usage/usage-format.ts`**

```ts
/**
 * Display strings for the usage screen: what an agent is called, how a token
 * count is grouped, and the disclaimer every dollar figure carries.
 *
 * Pure — no signals, no Tauri, no DOM. It lives under `src/ui/usage/` rather
 * than `src/lib/` on purpose: everything in here is a wording choice this
 * screen makes, while the numeric side (aggregation, pricing) is already pure
 * and already lives in `src/lib/`. Keeping the two apart means a copy change
 * never touches a module with arithmetic in it.
 */

import type { UsageAgent } from "../../lib/usage-snapshot";
import { formatUsd } from "../../lib/usage-pricing";
import { PRICING_SNAPSHOT_DATE } from "../../lib/usage-pricing-snapshot";

/**
 * What a cell shows when a value is unknown, unavailable or not applicable
 * (DL-15.6). Not `0` — zero is a measurement, the dash is the absence of one.
 */
export const EM_DASH = "—";

/**
 * Fixed grouping locale. The chrome is English-only (R1), and pinning the
 * locale keeps a rendered count identical on every machine and in CI instead
 * of following whatever the host is set to.
 */
const TOKEN_LOCALE = "en-US";

/**
 * The agents the scanner covers, in the order every table lists them —
 * the same order `sources` arrives in from Rust (§0.2.2: Claude then Codex),
 * so the screen never disagrees with the payload about which came first.
 */
export const USAGE_AGENT_ORDER: readonly UsageAgent[] = ["claude", "codex"];

/**
 * Display names. Exhaustive over `UsageAgent` by type, so teaching the scanner
 * a third agent fails the typecheck here rather than rendering a raw id. The
 * words match `BUILTIN_AGENTS` in `lib/agent-catalog.ts` — the same tool must
 * not carry two names in one app.
 */
export const USAGE_AGENT_LABEL: Readonly<Record<UsageAgent, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/**
 * The sentence every dollar figure carries (spec §Decisions 1): the number is
 * an estimate at API prices, and it was priced from a snapshot taken on a
 * known date. One constant, so three tables cannot drift into three
 * disclaimers.
 */
export const ESTIMATE_NOTE = `estimated at API prices · pricing snapshot ${PRICING_SNAPSHOT_DATE}`;

/** A token count with thousands separators — `1,204,338`. */
export function formatTokens(value: number): string {
  return value.toLocaleString(TOKEN_LOCALE);
}

/**
 * A money cell's content, or `null` when the row has no price. Returning
 * `null` rather than a dash keeps DL-15.6 in exactly one place — the table —
 * so a future caller cannot invent a second placeholder.
 */
export function usdCell(costUsd: number | null): string | null {
  return costUsd === null ? null : formatUsd(costUsd);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/ui/usage/active-usage-view-store.test.ts src/ui/usage/usage-format.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Report the task complete**

Files touched: `src/ui/usage/active-usage-view-store.ts`,
`src/ui/usage/active-usage-view-store.test.ts`, `src/ui/usage/usage-format.ts`,
`src/ui/usage/usage-format.test.ts`.

---

### Task C3: `MetricTable` — the DL §15 widget

**Files:**

- Create: `src/ui/usage/metric-table.tsx`
- Create: `src/ui/usage/metric-table.test.tsx`

**Interfaces:**

- Consumes: `EM_DASH` from `./usage-format`, `useId` from `preact/hooks`.
- Produces: `interface MetricColumn { key; label; numeric? }`, `interface MetricRow { key; cells }`, `MetricTable` component.

- [ ] **Step 1: Write the failing test**

Create `src/ui/usage/metric-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MetricTable } from "./metric-table";
import type { MetricColumn, MetricRow } from "./metric-table";
import { EM_DASH } from "./usage-format";

const columns: readonly MetricColumn[] = [
  { key: "agent", label: "agent" },
  { key: "tokens", label: "tokens", numeric: true },
  { key: "usd", label: "est. usd", numeric: true },
];

const rows: readonly MetricRow[] = [
  { key: "claude", cells: ["Claude Code", "1,234", "$0.42"] },
  { key: "codex", cells: ["Codex", "9", null] },
];

describe("MetricTable", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (
    overrides: Partial<Parameters<typeof MetricTable>[0]> = {},
  ): void => {
    act(() => {
      render(
        <MetricTable
          title="per-agent totals"
          note="estimated at API prices"
          columns={columns}
          rows={rows}
          emptyLabel="no data yet"
          {...overrides}
        />,
        host,
      );
    });
  };

  it("uses real table semantics: thead, tbody, scoped headers (DL-15.7)", () => {
    mount();
    const table = host.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelector("thead")).not.toBeNull();
    expect(table?.querySelector("tbody")).not.toBeNull();

    const columnHeaders = host.querySelectorAll('thead th[scope="col"]');
    expect(columnHeaders).toHaveLength(columns.length);
    expect([...columnHeaders].map((cell) => cell.textContent)).toEqual([
      "agent",
      "tokens",
      "est. usd",
    ]);

    // The identifying cell of each row is a row header, not a plain cell.
    const rowHeaders = host.querySelectorAll('tbody th[scope="row"]');
    expect(rowHeaders).toHaveLength(rows.length);
    expect(rowHeaders[0].textContent).toBe("Claude Code");
  });

  it("names the table from the visible heading and describes it from the note", () => {
    mount();
    const table = host.querySelector("table") as HTMLTableElement;
    const heading = host.querySelector(".metric-table__title") as HTMLElement;
    const note = host.querySelector(".metric-table__note") as HTMLElement;

    // aria-labelledby, not <caption>: a caption would scroll away with the
    // columns inside the DL-15.3 container.
    expect(table.querySelector("caption")).toBeNull();
    expect(table.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(table.getAttribute("aria-describedby")).toBe(note.id);
    expect(heading.textContent).toBe("per-agent totals");
  });

  it("right-aligns numeric columns only (DL-15.4)", () => {
    mount();
    const firstRow = host.querySelectorAll("tbody tr")[0];
    const cells = firstRow.querySelectorAll("th, td");
    expect(cells[0].classList.contains("metric-table__cell--num")).toBe(false);
    expect(cells[1].classList.contains("metric-table__cell--num")).toBe(true);
    expect(cells[2].classList.contains("metric-table__cell--num")).toBe(true);

    // The header cell of a numeric column is aligned with its column.
    const headers = host.querySelectorAll("thead th");
    expect(headers[1].classList.contains("metric-table__cell--num")).toBe(true);
  });

  it("renders a single em dash for a null cell and for a short row (DL-15.6)", () => {
    mount({
      rows: [
        { key: "codex", cells: ["Codex", "9", null] },
        { key: "short", cells: ["Only one cell"] },
      ],
    });
    const bodyRows = host.querySelectorAll("tbody tr");
    expect(bodyRows[0].querySelectorAll("td")[1].textContent).toBe(EM_DASH);
    // A row shorter than the column list still fills the grid rather than
    // collapsing it — a missing cell is an unknown value, not a missing column.
    const shortCells = bodyRows[1].querySelectorAll("td");
    expect(shortCells).toHaveLength(columns.length - 1);
    expect(shortCells[0].textContent).toBe(EM_DASH);
    expect(shortCells[1].textContent).toBe(EM_DASH);
    // And never a zero.
    expect(host.textContent).not.toContain("0");
  });

  it("keeps the header and says what is absent when there are no rows (DL-15.8)", () => {
    mount({ rows: [] });
    expect(host.querySelectorAll("thead th")).toHaveLength(columns.length);
    const empty = host.querySelector(".metric-table__empty") as HTMLElement;
    expect(empty.textContent).toBe("no data yet");
    expect(empty.getAttribute("colspan")).toBe(String(columns.length));
  });

  it("contains nothing interactive and no sort affordance (DL-15.2)", () => {
    mount();
    const table = host.querySelector("table") as HTMLTableElement;
    expect(
      table.querySelectorAll(
        'button, a, input, select, [role="button"], [tabindex], [aria-sort], [onclick]',
      ),
    ).toHaveLength(0);
  });

  it("puts the scroll container around the table, not around the page (DL-15.3)", () => {
    mount();
    const scroller = host.querySelector(".metric-table__scroll");
    expect(scroller).not.toBeNull();
    expect(scroller?.querySelector("table")).not.toBeNull();
    // The heading and the note sit OUTSIDE the scroller so they stay put
    // while a wide table scrolls under them.
    expect(scroller?.querySelector(".metric-table__title")).toBeNull();
    expect(scroller?.querySelector(".metric-table__note")).toBeNull();
  });

  it("omits aria-describedby entirely when there is no note", () => {
    mount({ note: undefined });
    const table = host.querySelector("table") as HTMLTableElement;
    expect(table.hasAttribute("aria-describedby")).toBe(false);
    expect(host.querySelector(".metric-table__note")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/usage/metric-table.test.tsx`
Expected: FAIL — `Failed to resolve import "./metric-table"`.

- [ ] **Step 3: Write `src/ui/usage/metric-table.tsx`**

```tsx
import { useId } from "preact/hooks";
import { EM_DASH } from "./usage-format";

/**
 * The read-only metric table (DL §15). One component owns the markup the way
 * `ConfigRow` owns §5, so the rules live in one file instead of being
 * re-derived per view: real `<table>` semantics (DL-15.7), a lowercase prose
 * header row (DL-15.5), numerals right-aligned with tabular figures
 * (DL-15.4), one em dash for anything unknown (DL-15.6), horizontal overflow
 * scrolling inside the table's own container (DL-15.3), and a header row that
 * survives an empty result (DL-15.8).
 *
 * Nothing in here is interactive, and that is a rule rather than an omission
 * (DL-15.2): no sort control, no row click handler, no row hover treatment.
 * A row that reacts to the pointer promises a click that does not exist.
 *
 * The accessible name comes from the visible `<h3>` above the table via
 * `aria-labelledby`, not from a `<caption>` — a caption is a child of the
 * table, so it would sit inside the scroll container and slide out of view
 * with the columns.
 */

export interface MetricColumn {
  /** Stable key for the column; also the render key of every cell in it. */
  readonly key: string;
  /** Lowercase header text (DL-15.5). */
  readonly label: string;
  /** Numeric columns are right-aligned with tabular figures (DL-15.4). */
  readonly numeric?: boolean;
}

export interface MetricRow {
  readonly key: string;
  /**
   * One entry per column, in column order. `null` — and a row shorter than
   * the column list — renders the em dash (DL-15.6). Values arrive
   * pre-formatted: the table decides alignment and absence, never units.
   */
  readonly cells: readonly (string | null)[];
}

interface MetricTableProps {
  /** The visible heading that names the table (DL-15.7). */
  readonly title: string;
  /** Optional disclaimer under the table, wired up via `aria-describedby`. */
  readonly note?: string;
  readonly columns: readonly MetricColumn[];
  readonly rows: readonly MetricRow[];
  /** What the single spanning row says when there are no rows (DL-15.8). */
  readonly emptyLabel: string;
}

const cellClass = (column: MetricColumn): string =>
  column.numeric === true
    ? "metric-table__cell metric-table__cell--num"
    : "metric-table__cell";

export function MetricTable({
  title,
  note,
  columns,
  rows,
  emptyLabel,
}: MetricTableProps) {
  // One id per instance; three tables can be on one screen over a session.
  const base = useId();
  const titleId = `metric-title-${base}`;
  const noteId = `metric-note-${base}`;

  return (
    <div class="metric-table">
      <h3 class="metric-table__title" id={titleId}>
        {title}
      </h3>
      <div class="metric-table__scroll">
        <table
          class="metric-table__table"
          aria-labelledby={titleId}
          aria-describedby={note === undefined ? undefined : noteId}
        >
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" class={cellClass(column)}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  class="metric-table__cell metric-table__empty"
                  colSpan={columns.length}
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  {columns.map((column, index) =>
                    index === 0 ? (
                      <th
                        key={column.key}
                        scope="row"
                        class={cellClass(column)}
                      >
                        {row.cells[index] ?? EM_DASH}
                      </th>
                    ) : (
                      <td key={column.key} class={cellClass(column)}>
                        {row.cells[index] ?? EM_DASH}
                      </td>
                    ),
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {note !== undefined && (
        <p class="metric-table__note" id={noteId}>
          {note}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/ui/usage/metric-table.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Report the task complete**

Files touched: `src/ui/usage/metric-table.tsx`, `src/ui/usage/metric-table.test.tsx`.

---

### Task C4: `UsageStatus` — loading, missing, unreadable, skipped, stale

**Files:**

- Create: `src/ui/usage/usage-status.tsx`
- Create: `src/ui/usage/usage-status.test.tsx`

**Interfaces:**

- Consumes: `UsageSnapshot` (type) from `src/lib/usage-snapshot`; `USAGE_AGENT_LABEL`, `formatTokens` from `./usage-format`.
- Produces: `UsageStatus` component with props `{ snapshot: UsageSnapshot | null; loading: boolean; stale: boolean }`.

This component takes plain props rather than reading the store, so the five
states can be tested without touching a signal or a Tauri mock. The screen
(Task C6) reads the signals and passes them down.

Wording discipline (spec §Goal): the copy says **"this machine"** and
**"recorded history"**, and never **"machine-wide"** or **"all-time"**.
`missing` and `unreadable` produce _different sentences in different colours_ —
that separation is spec major M7 and is the whole point of this component.

- [ ] **Step 1: Write the failing test**

Create `src/ui/usage/usage-status.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  UsageSnapshot,
  UsageSource,
  UsageSourceState,
} from "../../lib/usage-snapshot";
import { UsageStatus } from "./usage-status";

const source = (
  agent: "claude" | "codex",
  state: UsageSourceState,
): UsageSource => ({ agent, state, filesScanned: 0 });

const snapshot = (patch: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  scannedAtMs: 1_754_800_000_000,
  buckets: [],
  sources: [source("claude", "ok"), source("codex", "ok")],
  skippedLines: 0,
  ...patch,
});

describe("UsageStatus", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (
    props: Partial<Parameters<typeof UsageStatus>[0]> = {},
  ): void => {
    act(() => {
      render(
        <UsageStatus
          snapshot={snapshot()}
          loading={false}
          stale={false}
          {...props}
        />,
        host,
      );
    });
  };

  const notes = (): string[] =>
    [...host.querySelectorAll(".usage-status__note")].map(
      (node) => node.textContent ?? "",
    );

  it("says nothing when both sources are fine and nothing was skipped", () => {
    mount();
    expect(notes()).toEqual([]);
  });

  it("announces the cold scan while there is no snapshot yet", () => {
    mount({ snapshot: null, loading: true });
    expect(notes()).toEqual(["reading this machine's recorded history…"]);
  });

  it("does NOT re-announce the scan once data is on screen", () => {
    // A 5 s poll must not flash a loading line over data the user is reading.
    mount({ loading: true });
    expect(notes()).toEqual([]);
  });

  it("keeps 'missing' and 'unreadable' as different states (major M7)", () => {
    mount({
      snapshot: snapshot({
        sources: [source("claude", "unreadable"), source("codex", "missing")],
      }),
    });

    const unreadable = host.querySelector(
      ".usage-status__note--error",
    ) as HTMLElement;
    const missing = host.querySelector(
      ".usage-status__note--faint",
    ) as HTMLElement;

    expect(unreadable.textContent).toBe(
      "couldn't read Claude Code history on this machine",
    );
    expect(missing.textContent).toBe("Codex: no data yet");
    // An error must never be dressed as an absence, or the reverse.
    expect(unreadable.textContent).not.toContain("no data yet");
    expect(missing.classList.contains("usage-status__note--error")).toBe(false);
  });

  it("reports skipped lines only when there are some, grouped", () => {
    mount();
    expect(notes().join(" ")).not.toContain("skipped");

    mount({ snapshot: snapshot({ skippedLines: 12345 }) });
    expect(notes()).toContain("12,345 lines skipped");
  });

  it("marks the data stale without hiding it", () => {
    mount({ stale: true });
    expect(notes()).toEqual(["stale — showing the last good read"]);
  });

  it("never overclaims what the numbers cover", () => {
    mount({
      snapshot: snapshot({
        sources: [source("claude", "unreadable"), source("codex", "missing")],
        skippedLines: 3,
      }),
      loading: true,
      stale: true,
    });
    expect(host.textContent).not.toContain("machine-wide");
    expect(host.textContent).not.toContain("all-time");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/usage/usage-status.test.tsx`
Expected: FAIL — `Failed to resolve import "./usage-status"`.

- [ ] **Step 3: Write `src/ui/usage/usage-status.tsx`**

```tsx
import type { UsageSnapshot } from "../../lib/usage-snapshot";
import { formatTokens, USAGE_AGENT_LABEL } from "./usage-format";

/**
 * The strip of things the screen has to admit: a cold scan in progress, a
 * source that is absent, a source that could not be read, lines the parser
 * skipped, and data that is no longer fresh.
 *
 * `missing` and `unreadable` deliberately produce different sentences in
 * different colours (spec major M7). "No data yet" and "we could not read it"
 * are opposite situations — one needs no action, the other is the user's
 * permissions or a broken file — and collapsing them into one grey line is
 * how a real failure gets read as an empty state and ignored.
 *
 * Copy discipline (spec §Goal): this is one OS user's history that still
 * exists on one machine. The words are "this machine" and "recorded history";
 * "machine-wide" and "all-time" are both wrong and both banned.
 *
 * Props rather than store reads: the five states are then testable without a
 * signal or a Tauri mock, and the screen stays the only place that knows
 * where the data comes from.
 */

interface UsageStatusProps {
  readonly snapshot: UsageSnapshot | null;
  readonly loading: boolean;
  readonly stale: boolean;
}

type NoteTone = "faint" | "muted" | "error";

interface StatusNote {
  readonly key: string;
  readonly text: string;
  readonly tone: NoteTone;
}

function buildNotes({
  snapshot,
  loading,
  stale,
}: UsageStatusProps): readonly StatusNote[] {
  const notes: StatusNote[] = [];

  // Only the COLD scan is announced. Once data is on screen the 5 s poll runs
  // silently — a line that appears and vanishes every five seconds is noise
  // over the numbers the user is actually reading.
  if (snapshot === null && loading) {
    notes.push({
      key: "loading",
      text: "reading this machine's recorded history…",
      tone: "muted",
    });
  }

  if (stale) {
    notes.push({
      key: "stale",
      text: "stale — showing the last good read",
      tone: "muted",
    });
  }

  for (const source of snapshot?.sources ?? []) {
    const agent = USAGE_AGENT_LABEL[source.agent];
    if (source.state === "unreadable") {
      notes.push({
        key: `source-${source.agent}`,
        text: `couldn't read ${agent} history on this machine`,
        tone: "error",
      });
    } else if (source.state === "missing") {
      notes.push({
        key: `source-${source.agent}`,
        text: `${agent}: no data yet`,
        tone: "faint",
      });
    }
  }

  const skipped = snapshot?.skippedLines ?? 0;
  if (skipped > 0) {
    notes.push({
      key: "skipped",
      text: `${formatTokens(skipped)} lines skipped`,
      tone: "faint",
    });
  }

  return notes;
}

export function UsageStatus(props: UsageStatusProps) {
  const notes = buildNotes(props);

  // The container is always in the tree so the live region exists before it
  // has anything to say; `.usage-status:empty` collapses it in CSS rather
  // than a conditional render that would keep re-creating the region.
  return (
    <div class="usage-status" role="status" aria-live="polite">
      {notes.map((note) => (
        <span
          key={note.key}
          class={`usage-status__note usage-status__note--${note.tone}`}
        >
          {note.text}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/ui/usage/usage-status.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Report the task complete**

Files touched: `src/ui/usage/usage-status.tsx`, `src/ui/usage/usage-status.test.tsx`.

---

### Task C5: The three views — overview, daily, breakdown

**Files:**

- Create: `src/ui/usage/sections/overview-section.tsx`
- Create: `src/ui/usage/sections/overview-section.test.tsx`
- Create: `src/ui/usage/sections/daily-section.tsx`
- Create: `src/ui/usage/sections/daily-section.test.tsx`
- Create: `src/ui/usage/sections/breakdown-section.tsx`
- Create: `src/ui/usage/sections/breakdown-section.test.tsx`

**Interfaces:**

- Consumes: `agentTotals`, `dailyRows`, `breakdownRows` and the three row types from `src/lib/usage-aggregate`; `totalTokens` from `src/lib/usage-snapshot`; `usageSnapshot` from `src/usage/usage-store`; `MetricTable`, `MetricColumn`, `MetricRow` from `../metric-table`; the formatting names from `../usage-format`.
- Produces: `OverviewSection`, `DailySection`, `BreakdownSection` (all prop-free, the `settings/sections/*` convention), plus `startOfLocalDay(nowMs: number): number` exported from `overview-section.tsx` for its own test.

Each section reads `usageSnapshot.value` itself rather than taking it as a
prop — the `sections/*.tsx` convention (`about-section.tsx` reads
`activeUpdateController.value` the same way), and it keeps the registry in
Task C6 free of prop-threading.

`startOfLocalDay` lives at module scope in `overview-section.tsx` and not in
`src/lib/` because this section owns no path under `src/lib/` (§0.6). It is
exported so the DST case can be tested directly. The filter it feeds
(`bucketStartMs >= startOfLocalDay(now)`) is **exact**, not approximate: local
midnight always falls on a 15-minute UTC boundary, which is why `BUCKET_MS` is
15 minutes (§0.2.4).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/usage/sections/overview-section.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section imports the usage store, whose client reaches `invoke`; stub it
// so the tree mounts under jsdom (the workspace-sidebar.test.tsx idiom).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { EMPTY_COUNTERS } from "../../../lib/usage-snapshot";
import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { PRICING_SNAPSHOT_DATE } from "../../../lib/usage-pricing-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { OverviewSection, startOfLocalDay } from "./overview-section";
import { EM_DASH } from "../usage-format";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const bucket = (patch: Partial<UsageBucket>): UsageBucket => ({
  bucketStartMs: NOW,
  agent: "claude",
  model: "claude-opus-4-20250514",
  counters: { ...EMPTY_COUNTERS, inputUncached: 100, output: 50 },
  ...patch,
});

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 3 },
    { agent: "codex", state: "ok", filesScanned: 2 },
  ],
  skippedLines: 0,
});

describe("startOfLocalDay", () => {
  it("returns local midnight, not UTC midnight", () => {
    const midnight = startOfLocalDay(NOW);
    const asDate = new Date(midnight);
    expect(asDate.getHours()).toBe(0);
    expect(asDate.getMinutes()).toBe(0);
    expect(asDate.getSeconds()).toBe(0);
    expect(asDate.getDate()).toBe(new Date(NOW).getDate());
  });

  it("lands on a 15-minute boundary for every offset, so the filter is exact", () => {
    // BUCKET_MS is 15 minutes precisely so this holds (§0.2.4).
    expect(startOfLocalDay(NOW) % (15 * 60 * 1000)).toBe(0);
  });
});

describe("OverviewSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
    vi.useRealTimers();
  });

  const mount = (): void => {
    act(() => {
      render(<OverviewSection />, host);
    });
  };

  const rowFor = (label: string): HTMLTableRowElement =>
    [...host.querySelectorAll("tbody tr")].find(
      (row) => row.querySelector("th")?.textContent === label,
    ) as HTMLTableRowElement;

  it("lists both agents even with no data, dashed rather than zeroed", () => {
    mount();
    expect(rowFor("Claude Code")).toBeDefined();
    expect(rowFor("Codex")).toBeDefined();
    // A dash is "we counted nothing"; a 0 would claim a measurement.
    const cells = rowFor("Codex").querySelectorAll("td");
    expect([...cells].map((cell) => cell.textContent)).toEqual([
      EM_DASH,
      EM_DASH,
      EM_DASH,
      EM_DASH,
    ]);
  });

  it("separates today from recorded history", () => {
    const yesterday = startOfLocalDay(NOW) - 60 * 60 * 1000;
    usageSnapshot.value = snapshot([
      bucket({ bucketStartMs: NOW }),
      bucket({ bucketStartMs: yesterday }),
    ]);
    mount();

    const cells = [...rowFor("Claude Code").querySelectorAll("td")].map(
      (cell) => cell.textContent,
    );
    // today = one bucket of 150 tokens; recorded = both, 300.
    expect(cells[0]).toBe("150");
    expect(cells[2]).toBe("300");
  });

  it("names its columns for the words the spec uses, never 'all-time'", () => {
    mount();
    const headers = [...host.querySelectorAll("thead th")].map(
      (cell) => cell.textContent,
    );
    expect(headers).toEqual([
      "agent",
      "tokens today",
      "est. usd today",
      "tokens recorded",
      "est. usd recorded",
    ]);
    expect(host.textContent).not.toContain("all-time");
    expect(host.textContent).not.toContain("machine-wide");
  });

  it("carries the estimate disclaimer and the pricing snapshot date", () => {
    mount();
    const note = host.querySelector(".metric-table__note")?.textContent ?? "";
    expect(note).toContain("estimated at API prices");
    expect(note).toContain(PRICING_SNAPSHOT_DATE);
  });
});
```

Create `src/ui/usage/sections/daily-section.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { EMPTY_COUNTERS } from "../../../lib/usage-snapshot";
import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { localDayKey } from "../../../lib/usage-aggregate";
import { usageSnapshot } from "../../../usage/usage-store";
import { DAILY_DAYS, DailySection } from "./daily-section";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: "ok", filesScanned: 1 },
  ],
  skippedLines: 0,
});

describe("DailySection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
    vi.useRealTimers();
  });

  const mount = (): void => {
    act(() => {
      render(<DailySection />, host);
    });
  };

  it("covers the window the spec names, in the title and in the empty row", () => {
    mount();
    expect(DAILY_DAYS).toBe(30);
    expect(host.querySelector(".metric-table__title")?.textContent).toBe(
      `last ${DAILY_DAYS} local days`,
    );
    // Empty is a statement, not a disappearance (DL-15.8).
    expect(host.querySelector(".metric-table__empty")?.textContent).toBe(
      `no data yet in the last ${DAILY_DAYS} local days`,
    );
    expect(host.querySelectorAll("thead th")).toHaveLength(4);
  });

  it("renders one row per local day and agent, day as the row header", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "claude-opus-4-20250514",
        counters: { ...EMPTY_COUNTERS, inputUncached: 10, output: 5 },
      },
      {
        bucketStartMs: NOW,
        agent: "codex",
        model: "gpt-5",
        counters: { ...EMPTY_COUNTERS, inputUncached: 2, output: 1 },
      },
    ]);
    mount();

    const rows = host.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    const today = localDayKey(NOW);
    for (const row of rows) {
      expect(row.querySelector('th[scope="row"]')?.textContent).toBe(today);
    }
    expect(host.textContent).toContain("Claude Code");
    expect(host.textContent).toContain("Codex");
  });
});
```

Create `src/ui/usage/sections/breakdown-section.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { BreakdownSection } from "./breakdown-section";
import { EM_DASH } from "../usage-format";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: "ok", filesScanned: 1 },
  ],
  skippedLines: 0,
});

describe("BreakdownSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    usageSnapshot.value = null;
  });

  const mount = (): void => {
    act(() => {
      render(<BreakdownSection />, host);
    });
  };

  it("keeps all six counter classes as separate columns (blocker B4)", () => {
    mount();
    expect(
      [...host.querySelectorAll("thead th")].map((cell) => cell.textContent),
    ).toEqual([
      "agent",
      "model",
      "input uncached",
      "cache read",
      "cache create 5m",
      "cache create 1h",
      "cache write",
      "output",
      "est. usd",
    ]);
  });

  it("shows the raw model string verbatim so a missing price is diagnosable", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "codex",
        model: "some-unreleased-model-2026-08",
        counters: {
          inputUncached: 7,
          cacheRead: 6,
          cacheCreate5m: 5,
          cacheCreate1h: 4,
          cacheWrite: 3,
          output: 2,
        },
      },
    ]);
    mount();

    const row = host.querySelector("tbody tr") as HTMLTableRowElement;
    const cells = [...row.querySelectorAll("th, td")].map(
      (cell) => cell.textContent,
    );
    expect(cells[0]).toBe("Codex");
    expect(cells[1]).toBe("some-unreleased-model-2026-08");
    expect(cells.slice(2, 8)).toEqual(["7", "6", "5", "4", "3", "2"]);
    // Unknown model → tokens shown, USD dashed. No guessing (spec §Pricing).
    expect(cells[8]).toBe(EM_DASH);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/usage/sections`
Expected: FAIL — `Failed to resolve import "./overview-section"` (and the two siblings).

- [ ] **Step 3: Write `src/ui/usage/sections/overview-section.tsx`**

```tsx
import type { AgentTotal } from "../../../lib/usage-aggregate";
import { agentTotals } from "../../../lib/usage-aggregate";
import type { UsageAgent } from "../../../lib/usage-snapshot";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable } from "../metric-table";
import type { MetricColumn, MetricRow } from "../metric-table";
import {
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
} from "../usage-format";

/**
 * The overview: what each agent has cost today, beside what it has cost over
 * the history that still exists on disk.
 *
 * "Recorded history" rather than "all-time" is not a stylistic choice — the
 * CLIs prune their own transcripts, so the older column is a floor, not a
 * total, and the copy must not promise otherwise (spec §Goal).
 */

/**
 * Local midnight for `nowMs`. `new Date(y, m, d)` is DST-correct by
 * construction — on a spring-forward day it still resolves to the first
 * instant of the local day rather than to a clock time that never happened.
 *
 * The comparison it feeds (`bucketStartMs >= startOfLocalDay(now)`) is exact
 * rather than approximate: every real-world UTC offset is a whole number of
 * 15-minute steps, including the :30 and :45 offsets, so local midnight always
 * lands on a bucket boundary. That is the reason `BUCKET_MS` is 15 minutes.
 *
 * It lives here rather than in `src/lib/` because this section owns no path
 * under `src/lib/`; it is exported so its own test can exercise it directly.
 */
export function startOfLocalDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const COLUMNS: readonly MetricColumn[] = [
  { key: "agent", label: "agent" },
  { key: "today-tokens", label: "tokens today", numeric: true },
  { key: "today-usd", label: "est. usd today", numeric: true },
  { key: "recorded-tokens", label: "tokens recorded", numeric: true },
  { key: "recorded-usd", label: "est. usd recorded", numeric: true },
];

const byAgent = (
  totals: readonly AgentTotal[],
): ReadonlyMap<UsageAgent, AgentTotal> =>
  new Map(totals.map((total) => [total.agent, total]));

/**
 * A dash, not a zero, when the agent contributed no bucket at all: we did not
 * measure zero tokens, we measured nothing (DL-15.6).
 */
const tokensCell = (total: AgentTotal | undefined): string | null =>
  total === undefined ? null : formatTokens(totalTokens(total.counters));

export function OverviewSection() {
  const buckets = usageSnapshot.value?.buckets ?? [];
  const today = byAgent(agentTotals(buckets, startOfLocalDay(Date.now())));
  const recorded = byAgent(agentTotals(buckets, null));

  // Every known agent gets a row even with nothing in it — a row that
  // disappears reads as "this agent is not supported" rather than "unused".
  const rows: readonly MetricRow[] = USAGE_AGENT_ORDER.map((agent) => ({
    key: agent,
    cells: [
      USAGE_AGENT_LABEL[agent],
      tokensCell(today.get(agent)),
      usdCell(today.get(agent)?.costUsd ?? null),
      tokensCell(recorded.get(agent)),
      usdCell(recorded.get(agent)?.costUsd ?? null),
    ],
  }));

  // A null total says "we could not price all of this"; naming the models is
  // what makes that diagnosable instead of mysterious (§0.3 decision 8).
  const unpriced = [
    ...new Set(
      [...today.values(), ...recorded.values()].flatMap(
        (total) => total.unpricedModels,
      ),
    ),
  ].sort();

  const note =
    unpriced.length === 0
      ? ESTIMATE_NOTE
      : `${ESTIMATE_NOTE} · no price for ${unpriced.join(", ")}`;

  return (
    <MetricTable
      title="per-agent totals"
      note={note}
      columns={COLUMNS}
      rows={rows}
      emptyLabel="no data yet"
    />
  );
}
```

- [ ] **Step 4: Write `src/ui/usage/sections/daily-section.tsx`**

```tsx
import { dailyRows } from "../../../lib/usage-aggregate";
import { totalTokens } from "../../../lib/usage-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable } from "../metric-table";
import type { MetricColumn, MetricRow } from "../metric-table";
import {
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
} from "../usage-format";

/**
 * The daily view: one row per local calendar day and agent.
 *
 * Local days, not UTC days — the boundary a user recognises is the one on
 * their own wall clock. Rust hands back 15-minute UTC buckets precisely so
 * this re-bucketing can happen here with the JS `Date`, DST included, without
 * a timezone crate in the binary (spec major M2).
 */

/** Spec §Surface: the daily view covers the last 30 local days. */
export const DAILY_DAYS = 30;

const COLUMNS: readonly MetricColumn[] = [
  { key: "day", label: "day" },
  { key: "agent", label: "agent" },
  { key: "tokens", label: "tokens", numeric: true },
  { key: "usd", label: "est. usd", numeric: true },
];

export function DailySection() {
  const rows = dailyRows(
    usageSnapshot.value?.buckets ?? [],
    DAILY_DAYS,
    Date.now(),
  );

  const unpriced = [
    ...new Set(rows.flatMap((row) => row.unpricedModels)),
  ].sort();

  const note =
    unpriced.length === 0
      ? ESTIMATE_NOTE
      : `${ESTIMATE_NOTE} · no price for ${unpriced.join(", ")}`;

  const tableRows: readonly MetricRow[] = rows.map((row) => ({
    key: `${row.day}:${row.agent}`,
    cells: [
      row.day,
      USAGE_AGENT_LABEL[row.agent],
      formatTokens(totalTokens(row.counters)),
      usdCell(row.costUsd),
    ],
  }));

  return (
    <MetricTable
      title={`last ${DAILY_DAYS} local days`}
      note={note}
      columns={COLUMNS}
      rows={tableRows}
      emptyLabel={`no data yet in the last ${DAILY_DAYS} local days`}
    />
  );
}
```

- [ ] **Step 5: Write `src/ui/usage/sections/breakdown-section.tsx`**

```tsx
import { breakdownRows } from "../../../lib/usage-aggregate";
import { usageSnapshot } from "../../../usage/usage-store";
import { MetricTable } from "../metric-table";
import type { MetricColumn, MetricRow } from "../metric-table";
import {
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
} from "../usage-format";

/**
 * The breakdown: agent × model, with all six counter classes kept apart.
 *
 * They are never merged into one "input" column (blocker B4, §0.3 decision 7):
 * each class prices differently, and Codex's cached input is a *subset* of its
 * input rather than a sibling of it, so a summed column would be wrong in two
 * different ways at once.
 *
 * The model string is printed exactly as the transcript wrote it. v1 matches
 * prices by exact model id only, so a missing price shows as a dash beside a
 * name the user can look up — the alternative, a guessed alias, produces a
 * confident number that is quietly wrong.
 */

const COLUMNS: readonly MetricColumn[] = [
  { key: "agent", label: "agent" },
  { key: "model", label: "model" },
  { key: "input-uncached", label: "input uncached", numeric: true },
  { key: "cache-read", label: "cache read", numeric: true },
  { key: "cache-create-5m", label: "cache create 5m", numeric: true },
  { key: "cache-create-1h", label: "cache create 1h", numeric: true },
  { key: "cache-write", label: "cache write", numeric: true },
  { key: "output", label: "output", numeric: true },
  { key: "usd", label: "est. usd", numeric: true },
];

export function BreakdownSection() {
  const rows: readonly MetricRow[] = breakdownRows(
    usageSnapshot.value?.buckets ?? [],
  ).map((row) => ({
    key: `${row.agent}:${row.model}`,
    cells: [
      USAGE_AGENT_LABEL[row.agent],
      row.model,
      formatTokens(row.counters.inputUncached),
      formatTokens(row.counters.cacheRead),
      formatTokens(row.counters.cacheCreate5m),
      formatTokens(row.counters.cacheCreate1h),
      formatTokens(row.counters.cacheWrite),
      formatTokens(row.counters.output),
      usdCell(row.costUsd),
    ],
  }));

  return (
    <MetricTable
      title="agent × model"
      note={ESTIMATE_NOTE}
      columns={COLUMNS}
      rows={rows}
      emptyLabel="no data yet"
    />
  );
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/ui/usage/sections`
Expected: PASS (10 tests).

- [ ] **Step 7: Report the task complete**

Files touched: `src/ui/usage/sections/overview-section.tsx`,
`src/ui/usage/sections/overview-section.test.tsx`,
`src/ui/usage/sections/daily-section.tsx`,
`src/ui/usage/sections/daily-section.test.tsx`,
`src/ui/usage/sections/breakdown-section.tsx`,
`src/ui/usage/sections/breakdown-section.test.tsx`.

---

### Task C6: The rail and the shell

**Files:**

- Create: `src/ui/usage/usage-nav-icons.tsx`
- Create: `src/ui/usage/usage-views.ts`
- Create: `src/ui/usage/usage-nav.tsx`
- Create: `src/ui/usage/usage-nav.test.tsx`
- Create: `src/ui/usage/usage-screen.tsx`
- Create: `src/ui/usage/usage-screen.test.tsx`

**Interfaces:**

- Consumes: `DeckIcon`, `RAIL_ICON` from `../controls/deck-icon`; `Gauge`, `CalendarDays`, `Table2` from `lucide-preact`; `activeUsageView`, `UsageViewId` from `./active-usage-view-store`; the three sections; `usageSnapshot`, `usageStale`, `usageLoading`, `startUsagePolling`, `stopUsagePolling` from `../../usage/usage-store`.
- Produces: `USAGE_VIEWS`, `VIEW_PANEL_ID`, `viewTabId()`, `interface UsageView`, `UsageNav`, and the section's one public export **`UsageScreen`**.

Rail icons are §0.7 default 4: `Gauge` (overview), `CalendarDays` (daily),
`Table2` (breakdown), at `RAIL_ICON` (16), wrapped as named components exactly
as `settings-nav-icons.tsx` does (DL-11.3, DL-14.1, DL-14.2).

The rail has **no foot**: there is no destructive action on this screen, and
DL-11.5 (as rewritten in C1) says the slot is not filled with something else.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/usage/usage-nav.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry imports the sections, which import the usage store; the store's
// client reaches `invoke`. Stub it so the tree mounts under jsdom.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { UsageNav } from "./usage-nav";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS } from "./usage-views";

describe("UsageNav", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    // Module-level signal shared across test files — reset it so nothing here
    // passes because an earlier file left it convenient.
    activeUsageView.value = "overview";
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    activeUsageView.value = "overview";
  });

  const mount = (): void => {
    act(() => {
      render(<UsageNav />, host);
    });
  };

  const getTabs = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll('[role="tab"]'));

  it("renders the three views in registry order, labels lowercase (DL-11.4)", () => {
    mount();
    const tabs = getTabs();
    expect(tabs).toHaveLength(USAGE_VIEWS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "overview",
      "daily",
      "breakdown",
    ]);
    for (const tab of tabs) {
      expect(tab.textContent).toBe(tab.textContent?.toLowerCase());
    }
  });

  it("clicking each tab sets activeUsageView.value to the matching id", () => {
    mount();
    const tabs = getTabs();
    USAGE_VIEWS.forEach((view, index) => {
      act(() => {
        tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(activeUsageView.value).toBe(view.id);
    });
  });

  it("marks exactly one tab active", () => {
    activeUsageView.value = "daily";
    mount();
    for (const tab of getTabs()) {
      const shouldBeActive = tab.textContent === "daily";
      expect(tab.classList.contains("is-active")).toBe(shouldBeActive);
      expect(tab.getAttribute("aria-selected")).toBe(String(shouldBeActive));
    }
  });

  it("ArrowDown from the last item wraps to the first, moving focus with it", () => {
    activeUsageView.value = "breakdown";
    mount();
    const tabs = getTabs();
    tabs[tabs.length - 1].focus();

    act(() => {
      tabs[tabs.length - 1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(activeUsageView.value).toBe("overview");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("ArrowUp from the first item wraps to the last, moving focus with it", () => {
    mount();
    const tabs = getTabs();
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(activeUsageView.value).toBe("breakdown");
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
  });

  it("has no rail foot — there is no destructive action here (DL-11.5)", () => {
    mount();
    expect(host.querySelector(".usage-nav__foot")).toBeNull();
    expect(host.querySelector(".cfg-btn--danger")).toBeNull();
  });

  it("draws every rail icon through DeckIcon at 16px (DL-11.3, DL-14.2)", () => {
    mount();
    const icons = host.querySelectorAll("svg");
    expect(icons).toHaveLength(USAGE_VIEWS.length);
    for (const icon of icons) {
      expect(icon.getAttribute("width")).toBe("16");
      expect(icon.getAttribute("height")).toBe("16");
    }
  });
});
```

Create `src/ui/usage/usage-screen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store is replaced wholesale: real signals so the sections still render
// off them, and spies for the two lifecycle calls this screen owns. Mocking
// the module also keeps `usage-client` (and therefore `invoke`) out of the
// tree entirely, so no Tauri stub is needed here.
vi.mock("../../usage/usage-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    usageSnapshot: signal(null),
    usageStale: signal(false),
    usageLoading: signal(false),
    startUsagePolling: vi.fn(),
    stopUsagePolling: vi.fn(),
  };
});

import { UsageScreen } from "./usage-screen";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS } from "./usage-views";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";

const mockedStart = vi.mocked(startUsagePolling);
const mockedStop = vi.mocked(stopUsagePolling);

describe("UsageScreen", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeUsageView.value = "overview";
    usageSnapshot.value = null;
    usageStale.value = false;
    usageLoading.value = false;
    mockedStart.mockReset();
    mockedStop.mockReset();
  });

  // Unmount so the window keydown listener goes with it — a leaked listener
  // from a prior instance would fire on the next dispatch.
  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (open: boolean, onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<UsageScreen open={open} onClose={onClose} />, host);
    });
    return onClose;
  };

  const rerender = (open: boolean, onClose: () => void): void => {
    act(() => {
      render(<UsageScreen open={open} onClose={onClose} />, host);
    });
  };

  it("moves focus onto the close pill when it opens", () => {
    mount(true);
    expect(document.activeElement).toBe(
      host.querySelector(".usage-screen__esc"),
    );
  });

  it("Escape closes the screen when focus is not in a terminal", () => {
    const onClose = mount(true);
    act(() => {
      (document.activeElement ?? window).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close the screen when a terminal owns focus (vim/fzf)", () => {
    const onClose = mount(true);

    const term = document.createElement("div");
    term.className = "xterm";
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once closed", () => {
    const onClose = mount(false);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("polls only while open — the screen never unmounts, so this is prop-keyed", () => {
    const onClose = vi.fn();
    mount(false, onClose);
    expect(mockedStart).not.toHaveBeenCalled();

    rerender(true, onClose);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(mockedStop).not.toHaveBeenCalled();

    rerender(false, onClose);
    expect(mockedStop).toHaveBeenCalledTimes(1);

    // Reopening starts a fresh poll rather than relying on the first one.
    rerender(true, onClose);
    expect(mockedStart).toHaveBeenCalledTimes(2);
  });

  it("stops polling when the tree unmounts", () => {
    mount(true);
    expect(mockedStart).toHaveBeenCalledTimes(1);
    act(() => {
      render(null, host);
    });
    expect(mockedStop).toHaveBeenCalledTimes(1);
  });

  it("mirrors the open state into the class and aria-hidden", () => {
    const onClose = vi.fn();
    mount(false, onClose);
    const screen = host.querySelector(".usage-screen") as HTMLElement;
    expect(screen.classList.contains("is-open")).toBe(false);
    expect(screen.getAttribute("aria-hidden")).toBe("true");

    rerender(true, onClose);
    expect(screen.classList.contains("is-open")).toBe(true);
    expect(screen.getAttribute("aria-hidden")).toBe("false");
  });

  it("wires the tab/panel ARIA pair so the panel is announced with its tab", () => {
    mount(true);
    const panel = host.querySelector('[role="tabpanel"]');
    const selectedTab = host.querySelector(
      '[role="tab"][aria-selected="true"]',
    );
    expect(panel).not.toBeNull();
    expect(selectedTab).not.toBeNull();
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      expect(tab.getAttribute("aria-controls")).toBe(panel?.id);
    }
    expect(panel?.getAttribute("aria-labelledby")).toBe(selectedTab?.id);
  });

  it("swaps the section when the rail changes, reaching all three views", () => {
    mount(true);
    const titles: string[] = [];
    for (const tab of host.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    )) {
      act(() => {
        tab.click();
      });
      titles.push(
        host.querySelector(".metric-table__title")?.textContent ?? "",
      );
    }
    expect(titles).toEqual([
      "per-agent totals",
      "last 30 local days",
      "agent × model",
    ]);
    expect(titles).toHaveLength(USAGE_VIEWS.length);
  });

  it("states the scope on screen and never overclaims it", () => {
    mount(true);
    expect(host.querySelector(".usage-screen__scope")?.textContent).toBe(
      "this machine, this user",
    );
    expect(host.textContent).not.toContain("machine-wide");
    expect(host.textContent).not.toContain("all-time");
  });

  it("surfaces the status strip from the store's signals", () => {
    mount(true);
    // Nothing to say yet: no snapshot, not loading, not stale.
    expect(host.querySelectorAll(".usage-status__note")).toHaveLength(0);

    act(() => {
      usageLoading.value = true;
    });
    expect(host.querySelector(".usage-status__note")?.textContent).toBe(
      "reading this machine's recorded history…",
    );

    act(() => {
      usageStale.value = true;
      usageLoading.value = false;
    });
    expect(host.querySelector(".usage-status__note")?.textContent).toBe(
      "stale — showing the last good read",
    );
  });
});
```

> **Trap, if a case here ever needs a signal write to reach an effect rather
> than a render:** `useSignalEffect` re-runs on an animation frame in
> `@preact/signals` 2.9 (`src/prompts/prompt-popover.test.tsx:52-59`), so
> `await Promise.resolve()` is not enough — use
> `await new Promise((resolve) => setTimeout(resolve, 32))`. The cases above
> assert on render output, which `act()` already flushes, so none of them
> needs it today.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/usage/usage-nav.test.tsx src/ui/usage/usage-screen.test.tsx`
Expected: FAIL — `Failed to resolve import "./usage-nav"` and `Failed to resolve import "./usage-screen"`.

- [ ] **Step 3: Write `src/ui/usage/usage-nav-icons.tsx`**

```tsx
/**
 * Rail icons for the usage screen — Lucide through `DeckIcon` at 16px
 * (`DL-11.3`, `DL-14.1`, `DL-14.2`). Named semantic components so
 * `usage-views.ts` keeps describing views rather than icon libraries:
 * changing which pictogram means "daily" is one edit here.
 *
 * Meaning over decoration (DL-14.5): a dial for a reading, a calendar for
 * days, a grid for the model-by-model table.
 */

import { CalendarDays, Gauge, Table2 } from "lucide-preact";
import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";

export function OverviewIcon() {
  return <DeckIcon icon={Gauge} size={RAIL_ICON} />;
}

export function DailyIcon() {
  return <DeckIcon icon={CalendarDays} size={RAIL_ICON} />;
}

export function BreakdownIcon() {
  return <DeckIcon icon={Table2} size={RAIL_ICON} />;
}
```

- [ ] **Step 4: Write `src/ui/usage/usage-views.ts`**

```ts
import type { ComponentType } from "preact";
import type { UsageViewId } from "./active-usage-view-store";
import { BreakdownIcon, DailyIcon, OverviewIcon } from "./usage-nav-icons";
import { OverviewSection } from "./sections/overview-section";
import { DailySection } from "./sections/daily-section";
import { BreakdownSection } from "./sections/breakdown-section";

/**
 * The one section panel the rail swaps content into. A single stable id, not
 * one per view: only one panel is ever mounted, and every tab's
 * `aria-controls` has to point at an element that exists — per-view ids would
 * leave two of the three dangling. Same reasoning as
 * `settings-categories.ts`'s `SECTION_PANEL_ID`.
 */
export const VIEW_PANEL_ID = "usage-view-panel";

/** Id of a view's rail tab — the panel points back at it via `aria-labelledby`. */
export function viewTabId(id: UsageViewId): string {
  return `usage-tab-${id}`;
}

export interface UsageView {
  readonly id: UsageViewId;
  /** Lowercase display label (DL-11.4) — distinct from `id`. */
  readonly label: string;
  readonly Icon: ComponentType;
  readonly Section: ComponentType;
}

/**
 * The three views, in display order (spec §Surface). Adding a fourth is one
 * entry here plus one file under `sections/` — no edit to `usage-screen.tsx`.
 */
export const USAGE_VIEWS: readonly UsageView[] = [
  {
    id: "overview",
    label: "overview",
    Icon: OverviewIcon,
    Section: OverviewSection,
  },
  { id: "daily", label: "daily", Icon: DailyIcon, Section: DailySection },
  {
    id: "breakdown",
    label: "breakdown",
    Icon: BreakdownIcon,
    Section: BreakdownSection,
  },
];
```

- [ ] **Step 5: Write `src/ui/usage/usage-nav.tsx`**

```tsx
import { useRef } from "preact/hooks";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS, VIEW_PANEL_ID, viewTabId } from "./usage-views";

/**
 * The usage rail: a vertical list of view tabs. Click sets
 * `activeUsageView.value` directly — a module signal, no prop callback, the
 * same idiom as `settings-nav.tsx` (R5). `↑`/`↓` wrap with the local
 * roving-list formula `(index + step + length) % length` and move DOM focus
 * together with the signal, so the visibly-active item and the focused item
 * never disagree.
 *
 * `role="tablist"` / `role="tab"` — a rail selection swaps a single content
 * panel, which is the Tabs pattern, so vertical roving and `aria-selected`
 * are the correct semantics rather than an incidental choice.
 *
 * There is no foot. `settings-nav.tsx` pins Restore Defaults below a hairline
 * because a destructive action must not sit among navigable items (DL-11.5);
 * this screen has no destructive action, and the slot is not filled with
 * something else to make the two rails look alike.
 */
export function UsageNav() {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectView = (index: number): void => {
    activeUsageView.value = USAGE_VIEWS[index].id;
    itemRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    let step: 1 | -1;
    if (event.key === "ArrowDown") {
      step = 1;
    } else if (event.key === "ArrowUp") {
      step = -1;
    } else {
      return;
    }
    event.preventDefault();
    const length = USAGE_VIEWS.length;
    const currentIndex = USAGE_VIEWS.findIndex(
      (view) => view.id === activeUsageView.value,
    );
    const from = currentIndex === -1 ? 0 : currentIndex;
    selectView((from + step + length) % length);
  };

  return (
    <nav class="usage-nav" aria-label="Token usage views">
      <div
        class="usage-nav__list"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
      >
        {USAGE_VIEWS.map((view, index) => {
          const isActive = view.id === activeUsageView.value;
          const Icon = view.Icon;
          return (
            <button
              key={view.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              id={viewTabId(view.id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={VIEW_PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              class={`usage-nav__item ${isActive ? "is-active" : ""}`}
              onClick={() => selectView(index)}
            >
              <Icon />
              <span class="usage-nav__label">{view.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 6: Write `src/ui/usage/usage-screen.tsx`**

```tsx
import { useEffect, useRef } from "preact/hooks";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { activeUsageView } from "./active-usage-view-store";
import { UsageNav } from "./usage-nav";
import { UsageStatus } from "./usage-status";
import { USAGE_VIEWS, VIEW_PANEL_ID, viewTabId } from "./usage-views";

interface UsageScreenProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The token usage screen: a full-window surface over the stage, rail left,
 * view right (DL-11.1). The view area owns all scrolling; the rail does not
 * scroll with it. Same shell as `SettingsScreen`, deliberately — the two are
 * mutually exclusive and a user who has learned one must recognise the other.
 *
 * Escape and mount-focus are carried over unchanged, `.xterm` guard included.
 * The guard is inert once the surface covers the window, but it is
 * load-bearing for a pane still holding focus at the moment of opening.
 *
 * Polling is keyed on the `open` PROP, with a cleanup, because this surface
 * never unmounts (`app.tsx` mounts it unconditionally, the way it mounts
 * Settings). A mount-keyed effect would start the 5 s poll at launch and run
 * it for the life of the process over a ~2.5 GB corpus. `useSignalEffect` is
 * the wrong tool here for a mechanical reason: it re-runs only when a signal
 * READ INSIDE IT changes, and `open` is a prop — the effect would run once,
 * closed, and never again.
 */
export function UsageScreen({ open, onClose }: UsageScreenProps) {
  const escRef = useRef<HTMLButtonElement>(null);

  // Move focus into the screen on open, so Escape reaches the handler below
  // instead of being swallowed by the terminal that had focus. preventScroll:
  // the view area scrolls, and stealing focus must not jump it.
  useEffect(() => {
    if (open) {
      escRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Scan on open, then poll while open; stop the moment it closes. The
  // cleanup also fires on unmount, so a torn-down window leaves no timer.
  useEffect(() => {
    if (!open) {
      return;
    }
    startUsagePolling();
    return () => stopUsagePolling();
  }, [open]);

  // Escape closes the screen — unless the key is headed for a terminal,
  // which owns its own Escape (vim, fzf, …).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      // A terminal owns its own Escape (vim, fzf) — leave it be. Guard the type:
      // keydown can target a non-Element (document/window) that has no closest().
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }
      // Blur first: a focused field commits its draft on blur, so closing
      // never silently drops what the user just typed. Nothing on this screen
      // is editable today; the rule is the shell's, not the content's.
      if (target instanceof HTMLElement) {
        target.blur();
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Falls back to the first view rather than rendering an empty panel: an
  // unknown id can only come from a stale signal, and a blank screen is a
  // worse answer than the default one.
  const active =
    USAGE_VIEWS.find((view) => view.id === activeUsageView.value) ??
    USAGE_VIEWS[0];
  const View = active.Section;

  return (
    <aside
      class={`usage-screen ${open ? "is-open" : ""}`}
      aria-label="Token usage"
      aria-hidden={!open}
    >
      <header class="usage-screen__head">
        <h2 class="usage-screen__path">
          <b>~</b>/deck/usage
        </h2>
        {/* The scope, stated where the numbers are: one OS user's history that
            still exists on one machine. Not "machine-wide", not "all-time" —
            the CLIs prune their own transcripts (spec §Goal). */}
        <span class="usage-screen__scope">this machine, this user</span>
        <button
          ref={escRef}
          type="button"
          class="usage-screen__esc"
          aria-label="Close token usage"
          onClick={onClose}
        >
          esc
        </button>
      </header>

      <UsageStatus
        snapshot={usageSnapshot.value}
        loading={usageLoading.value}
        stale={usageStale.value}
      />

      <div class="usage-screen__grid">
        <UsageNav />
        <section
          class="usage-screen__section"
          id={VIEW_PANEL_ID}
          role="tabpanel"
          aria-labelledby={viewTabId(active.id)}
        >
          <View />
        </section>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run src/ui/usage`
Expected: PASS — every test file under `src/ui/usage` green (~52 tests: 9 from
C2, 8 from C3, 7 from C4, 10 from C5, 7 nav + 11 screen here). The count is
indicative; the requirement is that no file is red and none is skipped.

- [ ] **Step 8: Typecheck the whole surface**

Run: `npm run build`
Expected: PASS — `tsc` clean, `vite build` writes `dist/`.

- [ ] **Step 9: Report the task complete**

Files touched: `src/ui/usage/usage-nav-icons.tsx`, `src/ui/usage/usage-views.ts`,
`src/ui/usage/usage-nav.tsx`, `src/ui/usage/usage-nav.test.tsx`,
`src/ui/usage/usage-screen.tsx`, `src/ui/usage/usage-screen.test.tsx`.

---

### Task C7: The CSS — shell, rail, status strip, metric table, reduced motion

**Files:**

- Modify: `src/styles.css` (append four blocks at the end of the file; edit the reduced-motion block in place)

**Interfaces:**

- Consumes: the DL numbers created in Task C1 and the class names emitted by C3–C6.
- Produces: no exports. This is the last code task.

**Anchor every edit by unique text, never by line number.** The working tree
is dirty and `src/styles.css` already carries another change's hunks (§0.5).
Never revert or reformat a line this task did not add.

- [ ] **Step 1: Confirm the reduced-motion block is still the five-selector one**

Run: `grep -n -A 10 "@media (prefers-reduced-motion: reduce)" src/styles.css | sed -n '20,40p'`
Expected: the block containing `.settings-screen`, `.settings-screen *`, `.tabbar *`, `.wsbar *`, `.prompt-popover *`, `.status *`. If the selector list differs, stop and report.

- [ ] **Step 2: Add the usage scope to the reduced-motion list**

Find this exact text in `src/styles.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .settings-screen,
  .settings-screen *,
  .tabbar *,
  .wsbar *,
  .prompt-popover *,
  .status * {
    transition: none;
  }
}
```

Replace it with:

```css
@media (prefers-reduced-motion: reduce) {
  /* By SCOPE, never by an allowlist of class names (DL-1.5, §9.3): a new
     full-window screen adds its own scope here, not the classes inside it —
     an allowlist silently misses the next class someone adds. */
  .settings-screen,
  .settings-screen *,
  .usage-screen,
  .usage-screen *,
  .tabbar *,
  .wsbar *,
  .prompt-popover *,
  .status * {
    transition: none;
  }
}
```

The four other surfaces stay. Dropping `.tabbar *`, `.wsbar *`,
`.prompt-popover *` or `.status *` silently removes reduced-motion support
from the tab bar, the workspace sidebar, the Prompt Board and the status bar.

- [ ] **Step 3: Append the usage screen shell block at the end of the file**

Append after the last rule in the file (`.settings-screen__section::-webkit-scrollbar-thumb`):

```css
/* ── Usage screen: full-window shell (usage-screen.tsx, DL-11.1) ───────── */

/* These are their own rules rather than extra selectors bolted onto the
   `.settings-screen` block above. The two screens share a shape, not an
   owner: Settings must stay free to re-tune its 620px measure or its rail
   without silently re-laying-out a screen it knows nothing about, and this
   one needs a section area with horizontal padding and no measure clamp,
   because a nine-column table has to be allowed to be wide (DL-15.3). */

.usage-screen {
  position: absolute;
  /* Full-bleed over the stage: the surface meets the sidebar's hairline and
     the toolbar's, so it reads as one block with the chrome. */
  inset: 0;
  background: var(--chrome-2);
  display: flex;
  flex-direction: column;
  /* The same layer as the Settings screen. Safe because the two are mutually
     exclusive — opening one closes the other — so they never stack. Above
     the Open board (30), below a modal draft (40). */
  z-index: 35;
  /* A full-window surface fades and settles; it does not slide in from an
     edge it no longer has (DL-1.2 — transform/opacity only, under 300ms). */
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  /* visibility (not just opacity) takes the closed screen's controls out of
     the tab order, matching aria-hidden. Delayed so the fade-out still plays. */
  visibility: hidden;
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease,
    visibility 0s linear 0.22s;
}

.usage-screen.is-open {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
  visibility: visible;
  transition:
    transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.22s ease,
    visibility 0s;
}

.usage-screen__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--hair);
}

.usage-screen__path {
  margin: 0;
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-primary);
}

.usage-screen__path b {
  color: var(--accent);
  font-weight: 600;
}

/* The scope of the numbers, stated beside the title: one OS user's history
   that still exists on one machine. Faint, because it is a qualifier on the
   heading rather than a second heading (DL-3.4). */
.usage-screen__scope {
  font-family: var(--ui-font);
  font-size: 10.5px;
  color: var(--text-faint);
}

.usage-screen__esc {
  margin-left: auto;
  border: 1px solid var(--hair);
  background: transparent;
  color: var(--text-faint);
  font-family: var(--ui-font);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 5px;
  cursor: pointer;
  transition:
    color 0.13s ease,
    border-color 0.13s ease;
}

.usage-screen__esc:hover {
  color: var(--text-primary);
  border-color: var(--hair-strong);
}

/* Two columns: the rail is fixed, the view area owns all scrolling
   (DL-11.1). min-height:0 on both so the grid can actually shrink, and
   minmax(0, 1fr) so an over-wide table scrolls itself instead of stretching
   the column (DL-15.3). */
.usage-screen__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
}

.usage-screen__section {
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  /* Horizontal padding here, unlike the settings section: a config row brings
     its own 14px, a table does not. No max-width clamp either — the 620px
     measure that keeps a key beside its value would strand the breakdown
     table's later columns behind a scrollbar for no reason. */
  padding: 6px 16px 16px;
}

/* Section scrollbar: thin, transparent, follows the theme — same treatment
   as the settings section. */
.usage-screen__section::-webkit-scrollbar {
  width: 6px;
}

.usage-screen__section::-webkit-scrollbar-track {
  background: transparent;
}

.usage-screen__section::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 3px;
}
```

- [ ] **Step 4: Append the usage rail block**

```css
/* ── Usage rail: view tabs, no foot (usage-nav.tsx, DL-11.2/11.5) ─────── */

.usage-nav {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--hair);
}

.usage-nav__list {
  display: flex;
  flex-direction: column;
  padding: 8px 0;
  overflow-y: auto;
}

.usage-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--text-faint);
  /* Navigation, not data — prose font (DL-4.1 / DL-11.4). */
  font-family: var(--ui-font);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.13s ease,
    border-left-color 0.13s ease,
    color 0.13s ease;
}

/* Hover and active share the 2px accent bar + 4% --fg wash `.cfg-row:hover`
   uses (DL-11.2) — no shadow, no fill (DL-1.3). */
.usage-nav__item:hover,
.usage-nav__item.is-active {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
  border-left-color: var(--accent);
  color: var(--text-primary);
}

.usage-nav__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

There is deliberately no `.usage-nav__foot` rule: no foot exists (DL-11.5).

- [ ] **Step 5: Append the status strip block**

```css
/* ── Usage status strip (usage-status.tsx) ─────────────────────────────── */

/* Always in the DOM so the live region is stable, and collapsed by :empty
   rather than by a conditional render that would recreate the region on
   every change. */
.usage-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 7px 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--hair);
}

.usage-status:empty {
  display: none;
}

.usage-status__note {
  font-family: var(--ui-font);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

/* Absence and progress: informational, the faintest step (DL-3.4). */
.usage-status__note--faint {
  color: var(--text-faint);
}

/* Stale and scanning: one step brighter, because they qualify what is on
   screen right now. Deliberately NOT --yellow — §3 assigns no role to yellow,
   and inventing one for "slightly out of date" would spend a color role on
   the mildest state this screen has. */
.usage-status__note--muted {
  color: var(--text-muted);
}

/* A source we could not read is an error, and --red means error and nothing
   else (DL-3.2). This is the line that must never be mistaken for "no data". */
.usage-status__note--error {
  color: var(--red);
}
```

- [ ] **Step 6: Append the metric table block**

```css
/* ── Read-only metric table (metric-table.tsx, DL §15) ─────────────────── */

.metric-table {
  margin: 14px 0 22px;
  min-width: 0;
}

/* The heading names the table for assistive tech via aria-labelledby, and it
   sits OUTSIDE the scroller so it stays put while wide columns move under it
   (DL-15.7). Panel-title size, normal weight — it labels data, it does not
   compete with it (DL-4.4). */
.metric-table__title {
  margin: 0 0 6px;
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 400;
  color: var(--text-primary);
}

/* DL-15.3: horizontal overflow scrolls HERE, inside the table's own
   container — never on the page body, never by shrinking the type. */
.metric-table__scroll {
  overflow-x: auto;
  max-width: 100%;
  border: 1px solid var(--hair);
  border-radius: 8px;
}

.metric-table__scroll::-webkit-scrollbar {
  height: 6px;
}

.metric-table__scroll::-webkit-scrollbar-track {
  background: transparent;
}

.metric-table__scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  border-radius: 3px;
}

/* DL-15.1: on the screen's own --chrome-2 surface, structured by hairlines.
   No zebra striping, no fill, no shadow — depth is a background step here. */
.metric-table__table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--ui-font);
  font-size: 11.5px;
  color: var(--text-primary);
}

.metric-table__cell {
  padding: 6px 12px;
  text-align: left;
  /* A wrapped number is unreadable in a column; the container scrolls
     instead (DL-15.3). */
  white-space: nowrap;
  border-bottom: 1px solid var(--hair);
}

/* DL-15.5: a column header is the name of the thing below it, treated like a
   cfg-group label — lowercase --ui-font, faint, normal weight, no caret. */
.metric-table__table thead .metric-table__cell {
  font-weight: 400;
  font-size: 10.5px;
  letter-spacing: 0.02em;
  color: var(--text-faint);
  background: color-mix(in srgb, var(--fg) 3%, transparent);
}

/* The row-identifying cell is a <th scope="row"> (DL-15.7) but reads as data,
   not as a heading. */
.metric-table__table tbody th.metric-table__cell {
  font-weight: 400;
  color: var(--text-primary);
}

.metric-table__table tbody tr:last-child .metric-table__cell {
  border-bottom: none;
}

/* DL-15.4: numerals right-aligned and tabular. There is no --mono token in
   this file, by decision (see the :root comment) — the monospace face belongs
   to the terminal (DL-4.1) — so digits are held in column by
   font-variant-numeric, which is exactly what DL-4.2 exists for. */
.metric-table__cell--num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* DL-15.8: an empty table still says what is absent, so "nothing yet" cannot
   be confused with "something broke". */
.metric-table__empty {
  color: var(--text-faint);
  font-size: 10.5px;
}

.metric-table__note {
  margin: 6px 0 0;
  font-family: var(--ui-font);
  font-size: 10.5px;
  color: var(--text-faint);
}

/* There is deliberately NO `.metric-table__table tbody tr:hover` rule. A row
   that lights up under the pointer promises a click, and there is nothing
   behind it (DL-15.2). This comment exists so the next person does not
   "improve" the table by adding one. */
```

- [ ] **Step 7: Prove the CSS did what it claims and broke nothing**

Run: `grep -c "usage-screen\|usage-nav\|usage-status\|metric-table" src/styles.css`
Expected: PASS — a count of 40 or more (every new selector plus the reduced-motion scope). An advisory sanity check that the blocks landed, not an exact count.

Run: `grep -n -A 14 "@media (prefers-reduced-motion: reduce)" src/styles.css | grep -c "tabbar \*\|wsbar \*\|prompt-popover \*\|status \*"`
Expected: PASS — `4`. The four pre-existing scopes survived.

Run: `grep -n "box-shadow" src/styles.css | grep -i "usage\|metric"`
Expected: PASS — no output. DL-1.3 holds; the new surfaces use background steps and hairlines only.

Run: `grep -n "text-transform" src/styles.css | grep -i "usage\|metric"`
Expected: PASS — no output (DL-4.3).

Run: `grep -n "tbody tr:hover" src/styles.css`
Expected: PASS — no output (DL-15.2).

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm test`
Expected: PASS — the full Vitest run green, including `scripts/icon-system.test.ts` (the em dash is not a retired glyph) and `scripts/vite-config.test.ts`.

Run: `npm run build`
Expected: PASS — `tsc` clean, `vite build` writes `dist/`.

- [ ] **Step 9: Report the task complete**

Files touched: `src/styles.css`.

---

### Task C8: Eye review — three views, two themes, real data

**Files:**

- Modify then **revert**: `src/ui/app.tsx` (a temporary mount, removed before this task ends — Section D owns this file)
- Screenshots go to the session scratchpad, never into the repo (F4/W8):
  `/private/tmp/claude-501/-Users-kyantran-Documents-Development-spacevibe-workspace-spacevibe-deck/3545acaa-5358-4f80-af87-e45e8fbf5eaa/scratchpad/`

**A passing build is NOT the completion criterion.** DL §9.6 and the repo's
`frontend-design-bar` gate both say the same thing: a green build proves
nothing about design. This task is done when six screenshots have been looked
at and checked against the rules, not when `npm run build` exits 0.

`UsageScreen` has no entry point yet — Section D adds the signal, the action,
the shortcut and the buttons. The temporary mount below exists only so the
screen can be opened for this review, and it is removed in Step 6.

- [ ] **Step 1: Add the temporary mount**

Three edits to `src/ui/app.tsx`, each marked so it cannot be forgotten.

(a) Line 3 currently reads:

```tsx
import { useSignalEffect } from "@preact/signals";
```

Change it to:

```tsx
import { signal, useSignalEffect } from "@preact/signals";
```

(b) After the existing `import { SettingsScreen } from "./settings/settings-screen";` (~line 58 — locate it by text, the file is being edited by other work), add:

```tsx
// TEMPORARY (Section C eye review) — removed before this task ends.
import { UsageScreen } from "./usage/usage-screen";
```

(c) Immediately above `export function App(` add:

```tsx
// TEMPORARY (Section C eye review) — removed before this task ends. Section D
// owns the real signal, action registry entry and entry points; this exists
// only so the screen can be opened from the WebView dev console with
// `__usageOpen(true)` / `__usageOpen(false)`.
const eyeReviewUsageOpen = signal(false);
(window as unknown as Record<string, unknown>).__usageOpen = (
  next: boolean,
): void => {
  eyeReviewUsageOpen.value = next;
};
```

(d) In the JSX, immediately after the existing
`<SettingsScreen open={settingsOpen.value} onClose={closePanel} />` (~line 779, again located by text):

```tsx
{
  /* TEMPORARY (Section C eye review) — removed before this task ends. */
}
<UsageScreen
  open={eyeReviewUsageOpen.value}
  onClose={() => {
    eyeReviewUsageOpen.value = false;
  }}
/>;
```

- [ ] **Step 2: Launch the real app against real data**

Run: `npm run tauri dev`
Expected: PASS — the app window opens. Section A's `usage_snapshot` command is
live by Wave 2, so the screen reads this machine's own Claude Code and Codex
transcripts (~2.5 GB on the dev machine).

Open the WebView dev console and run `__usageOpen(true)`.

**Watch the cold scan specifically.** It is the only chance to see the loading
state on real data. Confirm: the status strip says
`reading this machine's recorded history…`, the app stays responsive while it
runs, and the strip's line disappears once the first snapshot lands.

- [ ] **Step 3: Capture three views in a dark theme**

With the default (dark) theme, screenshot each view and save to the scratchpad:

- `usage-overview-dark.png` — rail on `overview`
- `usage-daily-dark.png` — rail on `daily`
- `usage-breakdown-dark.png` — rail on `breakdown`, **scrolled right far enough
  to show the `est. usd` column**, so the DL-15.3 container scroll is actually
  evidenced rather than assumed

- [ ] **Step 4: Capture the same three in a light theme**

`__usageOpen(false)`, open Settings (⌘,), switch to a light theme
(`appearance` → `Theme`), close Settings, `__usageOpen(true)`, and repeat:
`usage-overview-light.png`, `usage-daily-light.png`,
`usage-breakdown-light.png`.

A light theme is not a formality here: `--chrome-2`, `--hair`, `--text-faint`
and the thead wash are all `color-mix` derivations that invert with `--tone`,
and a table is mostly hairlines. This is where a too-faint header row or an
invisible row separator shows up.

- [ ] **Step 5: Check the six screenshots against the rules**

Read them back (`Read` the PNGs) and confirm, view by view:

- **DL-15.1** — hairline separators visible in both themes, no zebra striping, no fill, no shadow anywhere on the table.
- **DL-15.2** — hover the pointer over a body row: nothing changes. No sort caret, no pointer cursor over a cell.
- **DL-15.3** — the breakdown table scrolls **inside its container**; the window itself never gains a horizontal scrollbar. Narrow the window to roughly half width and confirm again.
- **DL-15.4** — the numeric columns are right-aligned and their digits line up vertically. Nothing on the screen is monospace.
- **DL-15.5** — every column header is lowercase, faint, normal weight.
- **DL-15.6** — where a price is missing, the cell holds a single em dash, not `0` and not a blank.
- **DL-15.8** — if a table is empty on this machine, it still shows its header row plus the "no data yet…" line.
- **DL-11.2** — the active rail item shows the 2px accent bar plus the wash, matching the Settings rail exactly. Put the two screens side by side.
- **DL-11.4** — rail labels lowercase; no section repeats its rail label as an in-page heading.
- **DL-11.5** — the rail has no foot and no destructive control.
- **DL-4.3** — no uppercase text anywhere on the screen.
- **Copy** — the header reads `this machine, this user`; nowhere does the screen say "machine-wide" or "all-time"; every table with a dollar column carries `estimated at API prices · pricing snapshot <date>`.
- **Reduced motion** — enable macOS `Reduce Motion`, reopen: the screen appears instantly, with no fade and no 4px settle.

Anything that fails is fixed in `src/ui/usage/**` or `src/styles.css` and
re-shot before moving on. Do not carry a known visual defect into Section D.

- [ ] **Step 6: Revert the temporary mount**

Undo all four edits from Step 1 — restore line 3 to
`import { useSignalEffect } from "@preact/signals";`, delete the
`UsageScreen` import, delete the `eyeReviewUsageOpen` block, delete the JSX
block.

Run: `grep -n "eyeReviewUsageOpen\|__usageOpen\|UsageScreen" src/ui/app.tsx`
Expected: PASS — **no output**. `src/ui/app.tsx` is Section D's file and must
leave this section unchanged.

- [ ] **Step 7: Final verification**

Run: `npm test`
Expected: PASS — the full suite green.

Run: `npm run build`
Expected: PASS — `tsc` clean, `vite build` writes `dist/`.

Run: `bash ~/.claude/scripts/docs-compliance.sh /Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck && bash ~/.claude/scripts/docs-anchors.sh /Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Expected: PASS — `✅ … tuân thủ D5/D6/D7` and no anchor output.

- [ ] **Step 8: Report the task complete**

Files touched (net): none beyond the previous tasks — `src/ui/app.tsx` was
modified and reverted within this task. Attach the six screenshot paths to
the report so the orchestrator can see what was reviewed.

---

## Findings

### (a) Spec claims checked against the code

1. **Spec §Pricing says `src/lib/usage-pricing.ts` "ships a pinned snapshot".**
   §0.3 decision 1 already splits that into `usage-pricing-snapshot.ts` (data)
   and `usage-pricing.ts` (math), which is what this section imports from.
   Noted, not an objection — the split is strictly better and the frozen
   contract already reflects it.
2. **Spec §Surface says the overview shows "per-agent totals: today and
   recorded history".** It does not say what a cell holds when an agent has no
   buckets. This section renders an em dash rather than `0`, per DL-15.6.
   Deliberate: `0` claims a measurement that was never made, and for a user
   whose Codex directory is absent it would read as "Codex costs nothing".
3. **Spec §Error handling says "the screen shows 'n lines skipped' when
   nonzero"** but does not place it. It lives in the status strip beside the
   source states, not per table — a skipped line is a property of the scan,
   not of one view.
4. **Spec §Surface's "a 5 s poll while open" is implemented by the screen, not
   the store.** `startUsagePolling()` / `stopUsagePolling()` are called from the
   `open`-keyed effect. If Section B's store starts polling at module load,
   that is a contract violation on B's side and this screen's `stop` will fight
   it — B must only poll between an explicit `start` and `stop`.

### (b) Objections to the frozen §0

**None that block.** One observation for the record: §0.2.5 lists
`src/ui/usage/**` as publishing `UsageScreen`, `UsageNav`, `USAGE_VIEWS`,
`activeUsageView`. This section also creates `MetricTable`, `UsageStatus`,
`usage-format.ts` and the three sections inside that same tree. They are
internal to `src/ui/usage/**` and Section D imports none of them, so the
ownership row is respected and no cross-section name changes. Flagged only so
nobody reads the §0.2.5 list as exhaustive of the _files_ rather than of the
_names other sections may use_.

### (c) Forks NOT decided here

1. **Where the `ChromeActions` button, the ⌘⇧U binding and the Settings ›
   agents link row live** — Section D, per §0.2.6. This section provides only
   the component.
2. **Whether the breakdown view should ever be sortable.** DL-15.2 explicitly
   forbids it and routes any change through §9.1. Not proposed, not decided.
3. **Whether the em dash needs a `title`/`aria-label` spelling out _why_ a
   value is absent** (unpriced model vs. no data). The overview and daily
   notes name unpriced models in prose instead. A per-cell explanation is a
   real accessibility improvement and a real DL question; left for whoever
   raises it.
4. **A fourth view or a date-range picker.** Not in the spec, not built.
5. **What the screen should do when both sources are `unreadable`.** Today it
   shows two red notes and three empty tables. A dedicated full-screen error
   state might be better; it is not specified, so it is not invented.

### (d) Deliberate omissions and deviations

1. **`useEffect(..., [open])` instead of `useSignalEffect` for the poll
   lifecycle — a deliberate deviation from the section brief.** Mechanism:
   `useSignalEffect(cb, options?)` takes no dependency array
   (`node_modules/@preact/signals/dist/signals.d.ts:6`) and re-runs only when a
   _signal read inside `cb`_ changes. `open` is a prop, so a `useSignalEffect`
   would run exactly once — at mount, with `open` false — and never again; the
   screen would never poll at all. The brief's actual requirement ("a
   mount-keyed effect would poll forever, because the screen never unmounts")
   is fully met by keying on `[open]` with a cleanup, which is also
   byte-for-byte what `SettingsScreen`'s own two effects do
   (`settings-screen.tsx:32-36`, `:40-63`) — and "follow `SettingsScreen`
   exactly" is the stronger instruction. The alternative that would let
   `useSignalEffect` see the prop (mirroring `open` into a `useSignal` written
   during render) has no precedent in this repo and adds a render-phase write
   for nothing. The rAF trap note is kept in Task C6 anyway, because it applies
   to any future test that writes a signal and expects an effect to have run.
2. **`src/ui/app.tsx` is edited in Task C8 and reverted inside the same task.**
   It is Section D's file. The edit never lands: Step 6 reverts it and proves
   the revert with a `grep`, and the orchestrator commits explicit paths (§0.6),
   so even an un-reverted hunk could not ride along in a Section C commit. It
   is there because a UI section whose only completion criterion is an eye
   review cannot satisfy it if the component is unreachable.
3. **`startOfLocalDay` lives at module scope in `overview-section.tsx`,** not
   in `src/lib/`. This section owns no path under `src/lib/` (§0.6), and
   creating one would collide with Section B's row. It is exported so its DST
   and bucket-boundary behaviour is tested directly.
4. **No `<caption>`.** DL-15.7 requires an accessible name; a `<caption>` is a
   child of `<table>` and therefore lives inside the DL-15.3 scroll container,
   so it would slide out of view on a wide table. The name comes from a visible
   `<h3>` via `aria-labelledby` instead — same semantics, better behaviour.
5. **No `--yellow` for the "stale" note.** §3 assigns roles to `--accent`,
   `--green` and `--red` only; introducing a fourth color role for the mildest
   state on the screen would be a DL change, and this section is authorised for
   exactly two (§11, §15). Stale uses `--text-muted`.
6. **No sticky table header.** It would need the table container to own the
   vertical scroll too, which fights DL-11.1's "the section area owns all
   scrolling". Not required by any rule; left out.
7. **No `--mono` token was added,** and DL-15.4 now says so explicitly, quoting
   the reasoning already in `src/styles.css:28-34`.
8. **No §10 migration row.** See (e) below.
9. **This plan file is >800 lines and that is not an F8/C2 violation.** The
   repo's file-guard hook warns on it. F8 governs source modules; this is one
   plan document, at the exact path the section brief mandated, in the session
   scratchpad where F4 puts it (`docs/plans/` is not this section's to write —
   the orchestrator owns the assembled plan). Splitting it would break the
   brief. Expect the same warning if the file is rewritten; ignore it.

### (e) Does the CSS reuse `.settings-*` or duplicate it?

**It duplicates.** The new `.usage-screen__*` and `.usage-nav__*` rules are
their own blocks; not one selector was grouped into an existing
`.settings-*` rule. Three reasons, in order of weight:

1. **The two screens are not actually identical, and the differences are load-bearing.**
   `.settings-screen__section` sets `padding: 6px 0 12px` and clamps its
   children to `max-width: 620px` (`src/styles.css:2801-2814`) — correct for a
   config row, wrong for a table. The usage section needs horizontal padding
   (a table brings none of its own) and must _not_ be clamped, because the
   620px measure would push the breakdown table's later columns behind a
   scrollbar for no reason. It also needs `min-width: 0` so DL-15.3's
   `overflow-x` container can shrink. Grouping the selectors would mean
   immediately un-grouping them again with three overrides.
2. **Shared selectors create an ownership trap.** Settings would no longer be
   able to re-tune its measure, rail width or head padding without silently
   re-laying-out a screen it knows nothing about. This section cannot change
   the settings markup (Section C owns no file under `src/ui/settings/`), so a
   shared rule would be shared in one direction only.
3. **`src/styles.css` is dirty at planning time** (§0.5). Appending
   self-contained blocks and making one surgical, uniquely-anchored edit to the
   reduced-motion list is the change least likely to collide with someone
   else's uncommitted hunk.

The duplication is bounded and it is the shell only — roughly 90 lines of
transition, head and grid rules. Everything with real content in it is
**shared, not copied**: `DeckIcon`/`RAIL_ICON`, the `cfg-*` control skins where
they apply, the token set, the roving-tablist idiom, and `MetricTable` itself,
which exists precisely so three views do not each hand-roll a table.

**On §10:** `grep -rn "<table\|<thead\|<tbody\|role=\"table\"" src marketing`
returns nothing — there is no existing data table anywhere in the app or the
marketing stage. Nothing that was compliant stops being compliant when §15
lands, so **no row is added to §10's migration-status table**. Task C1 Step 7
re-runs that grep at execution time in case the tree has moved.

---

# Section D — Wiring, entry points and verification

Wave 3. Runs strictly after Section C. Everything here is plumbing: the
`usageOpen` signal, the `toggle-usage` action end to end (registry → keymap →
dispatch → generated macOS menu), the three entry points, the four overlay
coordination points that live outside `src/ui/usage/`, and the final gate +
record task.

**Files this section owns** (§0.6): `src/chrome/events.ts` ·
`src/terminal/action-registry.ts` (+ `.test.ts`) · `src/terminal/keymap.test.ts` ·
`src/terminal/tab-manager.ts` (+ `.test.ts`) · `src/ui/app.tsx` (+ `app.test.tsx`) ·
`src/ui/chrome-actions.tsx` (+ `.test.tsx`) · `src/ui/tab-bar.tsx` (+ `.test.tsx`) ·
`src/ui/attention-focus-coordinator.ts` (+ `.test.ts`) ·
`src/ui/settings/sections/agents-section.tsx` (+ `.test.tsx`) ·
`src-tauri/src/menu_registry.rs` (**regenerated only**) · `AGENTS.md` ·
`docs/CONTEXT.md`.

**Files this section must NOT touch:** `src/styles.css` (Section C owns the whole
file, including the reduced-motion line this section depends on — Task D7 only
_verifies_ it) and anything under `src/ui/usage/` (Section C).

---

## Verified source facts this section builds on

Every anchor below was read at working-tree HEAD `69abe81` on 2026-08-10. The
tree is dirty (§0.5) — re-read before editing.

| Fact                                                                                                                                                                                                     | Where                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `settingsOpen` is declared at `src/chrome/events.ts:23` with a doc comment explaining why it is a module signal; `promptsOpen` at `:35` with the "deliberately NOT part of `openOverlayRanks()`" comment | `src/chrome/events.ts:15-35`                                                               |
| `OverlayTier = "pane" \| "settings" \| "board" \| "modal"`; `TIER_RANK` = pane 0, settings 20, board 30, modal 40. Its doc comment states `"settings"` has **no** action tiered at it today              | `src/terminal/action-registry.ts:8-45`                                                     |
| The `CharKeyBinding` RULE ("bind on whatever the menu accelerator binds on")                                                                                                                             | `src/terminal/action-registry.ts:481-508`                                                  |
| `toggle-prompts` registry row (`scope: "pane"`, `menu: { submenu: "View", group: "prompts" }`) sits immediately before `focus-next`                                                                      | `src/terminal/action-registry.ts:371-381`                                                  |
| `toggle-settings` row is `scope: "always"` with the "would strand Settings open" comment                                                                                                                 | `src/terminal/action-registry.ts:152-159`                                                  |
| macOS `toggle-prompts` binding is the last entry before the arrow bindings                                                                                                                               | `src/terminal/action-registry.ts:640-644`                                                  |
| Windows `toggle-prompts` binding sits after `toggle-settings`                                                                                                                                            | `src/terminal/action-registry.ts:778-779`                                                  |
| **`u` is bound nowhere.** `grep -n '"u"\|KeyU' src/terminal/action-registry.ts` returns zero hits — no `u` on either keymap at any modifier combination                                                  | verified 2026-08-10                                                                        |
| `ChartColumn` exists in the installed `lucide-preact@1.30.0` and renders class `lucide-chart-column` (`createLucideIcon("chart-column", …)`)                                                             | `node_modules/lucide-preact/dist/esm/icons/chart-column.mjs`, `createLucideIcon.mjs:14-27` |
| The id census test is `it("has exactly the 44 action ids including updater menu actions")` and enumerates 43 literals in a `Set`                                                                         | `src/terminal/action-registry.test.ts:75-107`                                              |
| `COMMAND_ACTIONS` has exactly **40** entries and its doc comment says so; the list is alphabetical                                                                                                       | `src/terminal/tab-manager.ts:106-156`                                                      |
| `TabManagerDeps.onToggleSettings` is the seam pattern to copy                                                                                                                                            | `src/terminal/tab-manager.ts:251-260`                                                      |
| `"toggle-settings": () => deps.onToggleSettings?.()` in the `commands` table                                                                                                                             | `src/terminal/tab-manager.ts:1227-1126`                                                    |
| `openOverlayRanks()` pushes `TIER_RANK.settings` / `board` / `modal`                                                                                                                                     | `src/terminal/tab-manager.ts:1169-1186`                                                    |
| `commands` closes with `} satisfies Record<(typeof COMMAND_ACTIONS)[number], () => void>` — a missing key is a compile error, an extra key is too                                                        | `src/terminal/tab-manager.ts:1168`                                                         |
| `dispatch-coverage.test.ts` asserts every keymap action is in `DISPATCHABLE_ACTIONS`, which is built from `COMMAND_ACTIONS`                                                                              | `src/terminal/dispatch-coverage.test.ts:11-22`, `tab-manager.ts:192-199`                   |
| `closeSettingsPanel` / `toggleSettingsPanel` are module-scope exports with long doc comments; opening is blocked only by `editorRequest !== null \|\| saveDialogOpen`                                    | `src/ui/app.tsx:118-167`                                                                   |
| `requestAttentionFocus` builds the `overlays` object and the two non-focusing `dismiss*` seams                                                                                                           | `src/ui/app.tsx:234-256`                                                                   |
| `restoreFocusAfterSettings` prefers the Open board over the active pane                                                                                                                                  | `src/ui/app.tsx:268-287`                                                                   |
| `overlayCoversPane()` is a **function**, read in the render body and inside a `useSignalEffect` — the comment at `:562-572` says why a captured boolean breaks the effect                                | `src/ui/app.tsx:546-577`                                                                   |
| The `menu:action` listener validates with `isShortcutAction` and calls `runAction` — **no change needed**, `isShortcutAction` derives from `ActionId`                                                    | `src/ui/app.tsx:357-381`, `src/terminal/keymap.ts:26`                                      |
| `<SettingsScreen open={settingsOpen.value} onClose={closePanel} />` is the last child of `<main class="stage">`                                                                                          | `src/ui/app.tsx:779`                                                                       |
| `ChromeActions` is rendered twice — once as `chromeActions` (titlebar) and once inside `TabBar`                                                                                                          | `src/ui/app.tsx:609-626`, `:652-677`, `src/ui/tab-bar.tsx:164-177`                         |
| `AttentionOverlaySnapshot` has four booleans; `runAttentionFocus` dismisses board then settings then focuses                                                                                             | `src/ui/attention-focus-coordinator.ts:16-25`, `:84-90`                                    |
| The `ConfigRow` + `class="cfg-btn"` + `open …` link-row precedent ("Release notes")                                                                                                                      | `src/ui/settings/sections/about-section.tsx:110-118`                                       |
| `generate-menu.ts` inserts `.separator()` whenever `item.menu?.group` differs from the previous item's group in the same submenu                                                                         | `scripts/generate-menu.ts:97-101`                                                          |
| The reduced-motion scope block currently lists `.settings-screen, .settings-screen *, .tabbar *, .wsbar *, .prompt-popover *, .status *`                                                                 | `src/styles.css:1431-1440`                                                                 |
| `chrome-actions.test.tsx` asserts `host.querySelectorAll("button")).toHaveLength(actions.length)` — a 7th button turns it red                                                                            | `src/ui/chrome-actions.test.tsx:109-115`                                                   |
| `tab-bar.test.tsx`'s `baseProps()` spreads a literal object into `<TabBar …>` — a new **required** prop is a typecheck error there                                                                       | `src/ui/tab-bar.test.tsx:63-80`                                                            |
| tab-manager test helpers: `setup({ deps, infos, paneOverrides })` → `{ tm, pty, … }`, `flush()` = `setTimeout(0)`, `mountManagerWithAgentPane(agent)`                                                    | `src/terminal/tab-manager.test.ts:220-245`, `:275-277`, `:3437-3456`                       |
| The `toggle-prompts` describe at the tail of `tab-manager.test.ts` documents the "the file leaves `settingsOpen` true" trap and resets all four overlay signals                                          | `src/terminal/tab-manager.test.ts:3643-3679`                                               |

**One verified correction to the section brief** (details in `## Findings`): the
generated `menu_registry.rs` line will **not** be a single line. A rustfmt probe
(`rustfmt --edition 2021` on a scratch file, `rustfmt` 1.x from
`~/.cargo/bin/rustfmt`, no `rustfmt.toml` anywhere in the repo so defaults apply)
wraps it exactly like `toggle_prompts`. Task D2 states the real expected output.

---

## What Sections A/B/C hand this section

Restated so an implementer reading only Section D is unblocked.

**From Section C — the only import D takes from the new feature:**

```tsx
// src/ui/usage/usage-screen.tsx
export function UsageScreen(props: {
  open: boolean;
  onClose: () => void;
}): JSX.Element;
```

Mounted exactly like `SettingsScreen`: always rendered, visibility driven by
`open`, `onClose` fired by its own Escape handler. It owns its mount-focus (the
`SettingsScreen` pattern at `src/ui/settings/settings-screen.tsx:30-35`), so no
caller focuses into it.

Section C also owns `src/styles.css`, including the `.usage-screen,
.usage-screen *` entry in the reduced-motion scope list required by §0.2.6.
Task D7 verifies it and **fails loudly** rather than adding it.

**From Section B — used only indirectly.** Section C's `UsageScreen` consumes
`usageSnapshot` / `usageStale` / `usageLoading` and `startUsagePolling()` /
`stopUsagePolling()` from `src/usage/usage-store.ts`. Section D never imports
them: the poll starts and stops inside the screen, keyed off `open`. If the
implementer finds polling wired from `app.tsx` instead, that is a Section C
divergence — stop and report it, do not re-home it here.

**From Section A — nothing.** No Rust file in this section except the
regenerated `menu_registry.rs`.

**Frozen names this section must use verbatim (§0.2.6):**

| Name                                                           | Kind                         |
| -------------------------------------------------------------- | ---------------------------- |
| `usageOpen`                                                    | signal in `chrome/events.ts` |
| `closeUsagePanel(focusActive)`                                 | module fn in `app.tsx`       |
| `toggleUsagePanel(focusActive)`                                | module fn in `app.tsx`       |
| `"toggle-usage"` / label `"Token Usage…"`                      | action id / label            |
| `scope: "always"`, `menu: { submenu: "View", group: "usage" }` | action fields                |
| `onToggleUsage?: () => void`                                   | `TabManagerDeps` seam        |
| `usage: boolean` / `dismissUsage: () => void`                  | attention coordinator        |
| `TIER_RANK.settings`                                           | the rank Usage pushes        |

---

## Task order

| Task | What                                                                      | Depends on    |
| ---- | ------------------------------------------------------------------------- | ------------- |
| D1   | `usageOpen` signal, action row, both keymaps, dispatch seam, overlay rank | —             |
| D2   | Regenerate the macOS menu                                                 | D1            |
| D3   | `app.tsx`: mutual exclusion, `overlayCoversPane`, mount `UsageScreen`     | D1, Section C |
| D4   | Attention-focus coordinator learns about Usage                            | D1            |
| D5   | `ChromeActions` button + `TabBar` forward + both prop sites               | D1, D3        |
| D6   | Settings › agents link row                                                | D1            |
| D7   | The five-place overlay checklist audit (incl. Section C's CSS)            | D1–D6         |
| D8   | Full verification and the in-flight record                                | everything    |

D1 is deliberately one task and not four. `COMMAND_ACTIONS`'s `satisfies` and the
`commands` table's exact-`Record` check fail **independently**, and
`dispatch-coverage.test.ts` goes red the instant a keymap binding exists without
a dispatch target. Splitting them leaves a red commit behind, and the
orchestrator commits per task (§0.6).

---

### Task D1: The `usageOpen` signal, the `toggle-usage` action, both keymaps, the dispatch seam and the overlay rank

**Files:**

- Modify: `src/chrome/events.ts` (append after `settingsOpen`, ~line 23)
- Modify: `src/terminal/action-registry.ts` (registry row after `toggle-prompts` ~line 380; `MACOS_KEYMAP` after the `toggle-prompts` binding ~line 644; `WINDOWS_KEYMAP` after the `toggle-prompts` binding ~line 779)
- Modify: `src/terminal/action-registry.test.ts` (new binding test; census at ~line 58)
- Modify: `src/terminal/keymap.test.ts` (macOS case ~line 333; the Windows `it.each` table ~line 379-410)
- Modify: `src/terminal/tab-manager.ts` (`COMMAND_ACTIONS` ~line 106-156, `TabManagerDeps` ~line 244-269, the `commands` table ~line 1122, `openOverlayRanks` ~line 1169-1186)
- Modify: `src/terminal/tab-manager.test.ts` (new describe at the tail)

**Interfaces:**

- Consumes: `TIER_RANK` (`action-registry.ts`), `signal` (`@preact/signals`).
- Produces:
  - `usageOpen: Signal<boolean>` (`src/chrome/events.ts`)
  - action id `"toggle-usage"`, label `"Token Usage…"`, `scope: "always"`, `menu: { submenu: "View", group: "usage" }`
  - bindings macOS `⌘⇧U`, Windows `Ctrl+Shift+U`
  - `TabManagerDeps.onToggleUsage?: () => void`

**Overlay checklist places 1 and 2 land in this task** (Steps 3 and 6). Each is a
silent failure if skipped, so each is its own numbered step.

- [ ] **Step 1: Write the failing registry and keymap tests**

In `src/terminal/action-registry.test.ts`, add immediately after the existing
`"binds toggle-prompts on both platforms without colliding"` test (which ends at
`:56`):

```ts
it("binds toggle-usage on both platforms without colliding", () => {
  const mac = MACOS_KEYMAP.filter(
    (binding) => binding.action === "toggle-usage",
  );
  const win = WINDOWS_KEYMAP.filter(
    (binding) => binding.action === "toggle-usage",
  );
  expect(mac).toEqual([
    { key: "u", meta: true, shift: true, action: "toggle-usage" },
  ]);
  expect(win).toEqual([
    { key: "u", ctrl: true, shift: true, action: "toggle-usage" },
  ]);
  // It has a menu item, so the RULE above CharKeyBinding requires `key`.
  expect(mac[0]).not.toHaveProperty("code");
});
```

**Then update the id census in the same file — this is mandatory bookkeeping, not
a test to loosen.** The census is what stops an action being added without anyone
noticing.

- Current title, verbatim: `it("has exactly the 44 action ids including updater menu actions", () => {`
- New title, verbatim: `it("has exactly the 44 action ids including updater menu actions", () => {`
- Add `"toggle-usage",` to the enumerated `Set`, immediately after `"toggle-prompts",` (line 65), so the census reads in the same order as the registry:

```ts
        "toggle-settings",
        "toggle-prompts",
        "toggle-usage",
        "new-tab",
```

In `src/terminal/keymap.test.ts`, add after the `"matches Cmd+, as toggle-settings"`
test (`:333-337`):

```ts
it("matches Cmd+Shift+U as toggle-usage", () => {
  expect(matchBinding(keyEvent("u", { metaKey: true, shiftKey: true }))).toBe(
    "toggle-usage",
  );
});

// `u` is bound nowhere else on either keymap at any modifier combination —
// the chord is free for the Token Usage screen and must not leak onto the
// bare key or the plain Cmd chord, which still reach the PTY.
it("does not match U without both modifiers", () => {
  expect(matchBinding(keyEvent("u"))).toBeNull();
  expect(matchBinding(keyEvent("u", { metaKey: true }))).toBeNull();
  expect(matchBinding(keyEvent("u", { shiftKey: true }))).toBeNull();
});
```

and add one row to the Windows `it.each` table, immediately after the
`[",", { ctrlKey: true }, "toggle-settings"],` row (`:406`):

```ts
    ["u", { ctrlKey: true, shiftKey: true }, "toggle-usage"],
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/keymap.test.ts`
Expected: FAIL — `AssertionError: expected [] to deeply equal [ { key: 'u', meta: true, … } ]` from the new binding test, `expected null to be 'toggle-usage'` from the keymap test, and `Set(43) … Set(44)` from the census. (TypeScript is not consulted by vitest, so the unknown `"toggle-usage"` literal does not stop the run — it will show up in `npm run build` until Step 4 lands.)

- [ ] **Step 3: Add the `usageOpen` signal — overlay place 1 of 5**

In `src/chrome/events.ts`, immediately after `settingsOpen` (`:23`), before the
`promptsOpen` block:

```ts
/**
 * Token usage screen open state.
 *
 * The exact inverse of `promptsOpen` below, which says of itself:
 * "Deliberately NOT part of `openOverlayRanks()` (tab-manager.ts): this is a
 * pane-level popover anchored to a chrome button, not a surface that covers
 * the terminal grid." This one IS such a surface. `UsageScreen` is full-window
 * like `SettingsScreen`, so it MUST be pushed by `openOverlayRanks()`
 * (tab-manager.ts) or every pane-scoped shortcut stays live behind it — ⌘W
 * closing a pane nobody can see is the exact failure the tier model exists to
 * stop. It is also mutually exclusive with `settingsOpen`: opening either one
 * closes the other (spec §Surface, major M4).
 */
export const usageOpen = signal(false);
```

- [ ] **Step 4: Add the registry row and both bindings**

In `src/terminal/action-registry.ts`, immediately after the `toggle-prompts`
entry (which closes at `:380`) and before `{ id: "focus-next", … }`:

```ts
  {
    id: "toggle-usage",
    label: "Token Usage…",
    // `"always"`, the same reasoning `toggle-settings` spells out above:
    // `usageOpen` makes `openOverlayRanks()` report rank 20, which blocks
    // every `"pane"`-tiered action — this one included if it were tiered.
    // Gating it would strand the screen open with no shortcut and no menu
    // item able to close it again.
    //
    // NOT `"settings"`: that rank still has no action tiered at it (see
    // TIER_RANK's own doc comment), and tiering this one there would make it
    // block itself the same way.
    scope: "always",
    // Its own group, so the generator emits a separator above it — the two
    // View items below the attention group are screens, not pane operations,
    // and the separator is what says so.
    menu: { submenu: "View", group: "usage" },
  },
```

In `MACOS_KEYMAP`, immediately after the `toggle-prompts` binding (`:644`):

```ts
  // Token usage screen. ⌘⇧U is free on both keymaps — `u` is bound nowhere at
  // any modifier combination, verified exhaustively. CharKeyBinding is
  // mandatory, not a style choice: this action has a macOS menu item, and a
  // Cocoa accelerator is declared by character (see the RULE above).
  { key: "u", meta: true, shift: true, action: "toggle-usage" },
```

In `WINDOWS_KEYMAP`, immediately after the `toggle-prompts` binding (`:779`):

```ts
  { key: "u", ctrl: true, shift: true, action: "toggle-usage" },
```

- [ ] **Step 5: Wire the dispatch seam**

In `src/terminal/tab-manager.ts`:

**(a)** `COMMAND_ACTIONS` is alphabetical — insert between `"toggle-settings"`
and `"toggle-zoom-pane"` (`:151-152`):

```ts
  "toggle-settings",
  "toggle-usage",
  "toggle-zoom-pane",
```

and correct the count in its doc comment (`:107`). Current text, verbatim:

```
 * The ids `commands` implements — 40 entries, verified against the live
 * `commands` table (`tab-manager.ts:1041-1142`), Task 4's `copy-selection`/
 * `paste` included and the Prompt Board's `toggle-prompts` alongside them.
```

Replacement:

```
 * The ids `commands` implements — 41 entries, verified against the live
 * `commands` table, Task 4's `copy-selection`/`paste` included, the Prompt
 * Board's `toggle-prompts` and the token usage screen's `toggle-usage`
 * alongside them.
```

(The `tab-manager.ts:1041-1142` line range in the old text is already stale
against this file; drop it rather than re-deriving a number that will drift
again.)

**(b)** Add the seam to `TabManagerDeps`, immediately after `onToggleSettings`
(`:260`):

```ts
  /**
   * ⌘⇧U (`toggle-usage`) and the menu's "Token Usage…" item route here rather
   * than writing `usageOpen` directly — the same reason `onToggleSettings`
   * above exists. App owns the open/close+focus-return flow AND the
   * Settings/Usage mutual exclusion (spec §Surface, major M4); writing the
   * signal from here would put half of that rule in a second place. Missing
   * = no-op, same as the other two seams.
   */
  onToggleUsage?: () => void;
```

**(c)** Add to the `commands` table, immediately after the `"toggle-settings"`
entry (`:1126`) and before the `"toggle-prompts"` block:

```ts
    // Seam style, like `toggle-settings` above and unlike `toggle-prompts`
    // below: this one opens a full-window surface that must close Settings,
    // return focus on Escape, and refuse to open under a modal draft. All
    // three live in App; splitting them would put the mutual-exclusion rule
    // in two files. Missing `onToggleUsage` = safe no-op, never a direct write.
    "toggle-usage": () => deps.onToggleUsage?.(),
```

- [ ] **Step 6: Push the overlay rank — overlay place 2 of 5**

In `src/terminal/tab-manager.ts`, `openOverlayRanks()` (`:1169-1186`). Replace the
whole function, doc comment included:

```ts
/**
 * Ranks of every overlay that is currently open (Open board, Settings, the
 * token usage screen, PresetEditor/SavePresetDialog share the "modal" rank
 * — see `TIER_RANK`'s doc comment in action-registry.ts for why). Empty
 * when nothing covers the terminal grid.
 *
 * Usage reuses `TIER_RANK.settings` rather than getting a member of its own
 * in the `OverlayTier` union. The rank is what an action is compared
 * AGAINST, and Usage covers the grid exactly the way Settings does (both
 * full-window, both above the board, both below a modal draft) — so the
 * comparison it wants already exists. Adding a fifth tier would introduce a
 * rank nothing is tiered at, next to `"settings"`, which is already a rank
 * nothing is tiered at. One such rank is a documented deliberate gap; two
 * is a pattern nobody can explain.
 */
function openOverlayRanks(): readonly number[] {
  const ranks: number[] = [];
  if (settingsOpen.value || usageOpen.value) {
    ranks.push(TIER_RANK.settings);
  }
  if (boardOpen.value) {
    ranks.push(TIER_RANK.board);
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    ranks.push(TIER_RANK.modal);
  }
  return ranks;
}
```

and extend the existing `chrome/events` import at the top of the file (`:9-14`
in the test file's mirror; in `tab-manager.ts` it is the import that already
brings in `boardOpen, editorRequest, promptsOpen, reportChromeMessage,
saveDialogOpen, settingsOpen`) with `usageOpen`, keeping it alphabetical:

```ts
import {
  boardOpen,
  editorRequest,
  promptsOpen,
  reportChromeMessage,
  saveDialogOpen,
  settingsOpen,
  usageOpen,
} from "../chrome/events";
```

- [ ] **Step 7: Write the dispatch and overlay-gating tests**

Append to `src/terminal/tab-manager.test.ts`, after the `toggle-prompts` describe
that closes the file (`:3679`). Add `usageOpen` to the existing `../chrome/events`
import (`:9-16`).

```ts
describe("toggle-usage", () => {
  beforeEach(() => {
    // Same trap the `toggle-prompts` describe above documents: the file's
    // earlier describes leave `settingsOpen` true and neither they nor the
    // file-level `beforeEach` reset it. `toggle-usage` is `scope: "always"`
    // so an open overlay cannot block IT — but the gating test below drives a
    // `"pane"`-tiered action, which every stale overlay would block for the
    // wrong reason and turn the assertion into a false pass.
    usageOpen.value = false;
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  afterEach(() => {
    usageOpen.value = false;
    settingsOpen.value = false;
  });

  it("routes through the onToggleUsage seam instead of writing the signal", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    // The seam owns the write — TabManager must never touch `usageOpen`, or
    // the Settings/Usage mutual exclusion would live in two places.
    expect(usageOpen.value).toBe(false);
    tm.dispose();
  });

  it("is a safe no-op when no seam is supplied", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    expect(() => tm.runAction("toggle-usage")).not.toThrow();
    expect(usageOpen.value).toBe(false);
    tm.dispose();
  });

  it("still runs while Settings is open — scope 'always', or the screen could strand itself", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();
    settingsOpen.value = true;

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it("blocks a pane-tiered action while the usage screen covers the grid, and unblocks once it closes", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(1);

    usageOpen.value = true;
    tm.runAction("split-row");
    await flush();
    expect(statusInfo.value.paneCount).toBe(1); // no split happened behind Usage

    usageOpen.value = false;
    tm.runAction("split-row");
    await flush();
    expect(statusInfo.value.paneCount).toBe(2); // scoped to the overlay, not broken

    tm.dispose();
  });

  it("leaves board-tiered actions alone — Usage ranks below the board, exactly like Settings", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;
    usageOpen.value = true;

    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(true);
    tm.dispose();
  });
});
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/keymap.test.ts src/terminal/tab-manager.test.ts src/terminal/dispatch-coverage.test.ts`
Expected: PASS — including `dispatch-coverage.test.ts`, which is red for exactly as long as a keymap binding exists without a `COMMAND_ACTIONS` entry.

- [ ] **Step 9: Typecheck**

Run: `npm run build`
Expected: PASS (`tsc` then `vite build`). If `commands` is missing the
`"toggle-usage"` key, `tsc` reports
`Type '{ … }' does not satisfy the expected type 'Record<"clear-buffer" | … | "toggle-usage", () => void>'` — that is the `satisfies` doing its job, not a spurious error to cast away.

> `npm run generate:menu:check` is **red from here until Task D2 runs.** That is
> expected and is the point of the check: the registry changed and the generated
> Rust has not been regenerated yet.

- [ ] **Step 10: Report the task complete**

Files touched: `src/chrome/events.ts`, `src/terminal/action-registry.ts`,
`src/terminal/action-registry.test.ts`, `src/terminal/keymap.test.ts`,
`src/terminal/tab-manager.ts`, `src/terminal/tab-manager.test.ts`.

---

### Task D2: Regenerate the macOS menu

**Files:**

- Regenerate: `src-tauri/src/menu_registry.rs` (**never hand-edited — R3**)

**Interfaces:** consumes the `toggle-usage` registry row and macOS binding from
D1; produces the View-submenu item and its Cocoa accelerator.

- [ ] **Step 1: Confirm `rustfmt` is on PATH before generating**

```bash
which rustfmt
```

Expected: a path (e.g. `/Users/…/.cargo/bin/rustfmt`). This is load-bearing, not
hygiene: `scripts/generate-menu.ts:148-158` catches a missing `rustfmt` and
**warns instead of failing**, writing the file unformatted. CI's
`generate:menu:check` reformats both sides before comparing, so an unformatted
commit passes locally and disagrees in CI. If `rustfmt` is absent, run
`rustup component add rustfmt` and re-check before continuing.

- [ ] **Step 2: Regenerate**

```bash
npm run generate:menu
```

- [ ] **Step 3: Verify the generated diff, do not edit it**

```bash
git diff --stat src-tauri/src/menu_registry.rs
git diff src-tauri/src/menu_registry.rs
```

Expected: exactly two hunks in `build_view_menu`, and nothing else in the file.

A new binding block after `toggle_prompts`:

```rust
    let toggle_usage = action_item(
        handle,
        "toggle-usage",
        "Token Usage…",
        Some("CmdOrCtrl+Shift+U"),
    )?;
```

**This is the wrapped form, and it is correct.** The single-line
`let toggle_usage = action_item(handle, "toggle-usage", "Token Usage…", Some("CmdOrCtrl+Shift+U"))?;`
is 103 columns and exceeds rustfmt's default `max_width` of 100; a probe against
the real `rustfmt` (no `rustfmt.toml` exists in this repo, so defaults apply)
produced exactly the six-line form above, identical in shape to the
`toggle_prompts` block at `menu_registry.rs:79-84`. If the working tree shows the
single-line form, `rustfmt` did not run — go back to Step 1.

And in the builder chain, a separator followed by the item:

```rust
        .item(&focus_next_attention)
        .separator()
        .item(&toggle_prompts)
        .separator()
        .item(&toggle_usage)
        .build()
```

The separator is not optional decoration: `generate-menu.ts:97-101` emits one
whenever an item's `menu.group` differs from the previous item's in the same
submenu, and `"usage"` ≠ `"prompts"`.

- [ ] **Step 4: Run the staleness guard**

Run: `npm run generate:menu:check`
Expected: PASS — silent exit 0. A failure prints
`generate-menu --check: src-tauri/src/menu_registry.rs is stale …`, which means
Step 2 did not run or the file was hand-edited.

- [ ] **Step 5: Prove the Rust still compiles**

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: tests all pass; `cargo fmt --check` silent. (`build_view_menu` is
`#[cfg(target_os = "macos")]`, so on Windows this only proves the file parses.)

- [ ] **Step 6: Report the task complete**

Files touched: `src-tauri/src/menu_registry.rs` (regenerated).

---

### Task D3: `app.tsx` — mutual exclusion, `overlayCoversPane`, and mounting `UsageScreen`

**Precondition:** Section C has landed `src/ui/usage/usage-screen.tsx` exporting
`UsageScreen` with props `{ open: boolean; onClose: () => void }`. If it has not,
stop — do not stub it here.

**Files:**

- Modify: `src/ui/app.tsx` (imports ~line 28-51; `closeSettingsPanel`/`toggleSettingsPanel` ~line 118-167; `requestAttentionFocus` ~line 234-256 — the `overlays` object and one new seam; `closePanel`/`toggleSettings` ~line 285-298; `createTabManager` deps ~line 305-308; `overlayCoversPane` ~line 556-560; the stage ~line 718)
- Modify: `src/ui/app.test.tsx`

**Interfaces:**

- Consumes: `usageOpen` (D1), `UsageScreen` (Section C).
- Produces: `closeUsagePanel(focusActive)`, `toggleUsagePanel(focusActive)`; the
  `onToggleUsage` wiring for `createTabManager`; `usage` + `dismissUsage` in the
  attention request (the coordinator's types land in D4 — see Step 5's note).

**Overlay checklist places 3 and 4 land in this task** (Steps 6 and 5).

- [ ] **Step 1: Write the failing tests**

In `src/ui/app.test.tsx`, extend the `../chrome/events` import with `usageOpen`
and the `./app` import with `closeUsagePanel` and `toggleUsagePanel`:

```ts
import {
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
  usageOpen,
} from "../chrome/events";
import {
  closeSettingsPanel,
  closeUsagePanel,
  DesktopChrome,
  livePresetOpensATab,
  toggleSettingsPanel,
  toggleUsagePanel,
} from "./app";
```

Add `usageOpen.value = false;` to the existing `toggleSettingsPanel` describe's
`beforeEach` (`:101-107`) and `afterEach` (`:109-114`) — those seven tests now
share a signal with a second surface, and the mutual-exclusion assertion below
would inherit whatever the previous file left behind.

Append these two describes at the end of the file:

```ts
// Usage and Settings are mutually exclusive (spec §Surface, major M4): both
// are full-window surfaces at the same z-layer, so two open at once is two
// screens fighting over one rectangle. The guard mirrors
// `toggleSettingsPanel` exactly — CLOSING is unconditional (or the screen
// strands itself open, the b7e6021 trap), OPENING is blocked only by a
// PresetEditor/SavePresetDialog draft at z-40.
describe("toggleUsagePanel — mirrors the Settings guard, and the two surfaces displace each other", () => {
  const focusActive = vi.fn();

  beforeEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    usageOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
    focusActive.mockClear();
  });

  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    usageOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  it("opens Usage normally when no overlay holds a draft", () => {
    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(true);
  });

  it("does NOT open Usage while a PresetEditor draft is up", () => {
    editorRequest.value = { source: "live" };

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
  });

  it("does NOT open Usage while a SavePresetDialog draft is up", () => {
    saveDialogOpen.value = true;

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
  });

  it("DOES open Usage over the Open board — it covers the board, same as Settings", () => {
    boardOpen.value = true;

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(true);
  });

  it("still CLOSES Usage when it is already open, even with a PresetEditor draft also up", () => {
    usageOpen.value = true;
    editorRequest.value = { source: "live" };

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("still CLOSES Usage when it is already open, even with the Open board also up", () => {
    usageOpen.value = true;
    boardOpen.value = true;

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("still closes Usage normally with no draft open at all", () => {
    usageOpen.value = true;

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("opening Usage closes Settings", () => {
    settingsOpen.value = true;

    toggleUsagePanel(focusActive);

    expect(usageOpen.value).toBe(true);
    expect(settingsOpen.value).toBe(false);
    // Displacing Settings is a set-state, not a close+focus-return: focus is
    // about to land inside the screen that is opening.
    expect(focusActive).not.toHaveBeenCalled();
  });

  it("opening Settings closes Usage", () => {
    usageOpen.value = true;

    toggleSettingsPanel(focusActive);

    expect(settingsOpen.value).toBe(true);
    expect(usageOpen.value).toBe(false);
    expect(focusActive).not.toHaveBeenCalled();
  });

  // §0.3 decision 4: the spec says "Escape closes and focus returns to the
  // terminal exactly as Settings does". Reopening the surface Usage displaced
  // would be a second, unspecified behavior.
  it("closing Usage does NOT reopen the Settings screen it displaced", () => {
    settingsOpen.value = true;
    toggleUsagePanel(focusActive); // displaces Settings
    expect(settingsOpen.value).toBe(false);

    toggleUsagePanel(focusActive); // Escape / the button / ⌘⇧U again

    expect(usageOpen.value).toBe(false);
    expect(settingsOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });
});

describe("closeUsagePanel", () => {
  afterEach(() => {
    usageOpen.value = false;
    editorRequest.value = null;
  });

  it("always closes and hands off focus, unconditionally", () => {
    usageOpen.value = true;
    editorRequest.value = { source: "live" };
    const focusActive = vi.fn();

    closeUsagePanel(focusActive);

    expect(usageOpen.value).toBe(false);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/app.test.tsx`
Expected: FAIL — `SyntaxError: The requested module './app' does not provide an export named 'closeUsagePanel'` (Vite reports it as an import-resolution failure for the whole file, so all describes in it fail together, the seven existing `toggleSettingsPanel` cases included).

- [ ] **Step 3: Add the module-scope helpers**

In `src/ui/app.tsx`, extend the `../chrome/events` import (`:28-35`) with
`usageOpen`, and add `import { UsageScreen } from "./usage/usage-screen";`
immediately after the `SettingsScreen` import (`:51`).

Then, immediately after `toggleSettingsPanel` (`:167`):

```ts
/**
 * Pure Usage-close: sets `usageOpen` false and hands focus back. Same shape,
 * same reason, as `closeSettingsPanel` above — extracted to module scope so it
 * is unit-testable without an `<App>`-level render harness, which this repo
 * does not have. `App()`'s `closeUsage` supplies the real
 * `restoreFocusAfterSettings` as `focusActive`.
 */
export function closeUsagePanel(focusActive: () => void): void {
  usageOpen.value = false;
  focusActive();
}

/**
 * Token-usage toggle — shared by the chrome chart button, ⌘⇧U / Ctrl+Shift+U,
 * and the menu's "Token Usage…" item (the last two through `TabManagerDeps`'
 * `onToggleUsage` seam, so all three are the literal same closure).
 *
 * CLOSING (the `if` branch) is unconditional, for the same reason
 * `toggleSettingsPanel` above spells out: a full-window surface that can
 * refuse to close strands itself.
 *
 * OPENING (the `else` branch) is blocked by exactly the same preflight
 * Settings uses — a PresetEditor/SavePresetDialog draft at z-index 40 sits
 * above this surface, so opening underneath one would be invisible and
 * unreachable while `UsageScreen`'s mount-focus effect still stole DOM focus
 * from the live draft. The Open board is deliberately NOT in that list, same
 * as Settings: this screen covers the board rather than hiding under it.
 *
 * Opening also closes Settings (spec §Surface, major M4). It is a bare
 * set-state, NOT `closeSettingsPanel` — that helper hands focus back to the
 * pane, and here focus belongs in the screen that is opening, which takes it
 * on mount. Closing Usage does not put Settings back (§0.3 decision 4):
 * restoring a surface the user displaced is a second behavior nothing
 * specified.
 */
export function toggleUsagePanel(focusActive: () => void): void {
  if (usageOpen.value) {
    closeUsagePanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  settingsOpen.value = false;
  usageOpen.value = true;
}
```

- [ ] **Step 4: Close Usage from the Settings open branch**

In `toggleSettingsPanel` (`:158-167`), replace the open branch's final line so
the exclusion holds in both directions. The whole function body becomes:

```ts
export function toggleSettingsPanel(focusActive: () => void): void {
  if (settingsOpen.value) {
    closeSettingsPanel(focusActive);
    return;
  }
  if (editorRequest.value !== null || saveDialogOpen.value) {
    return;
  }
  // Mutual exclusion with the token usage screen (spec §Surface, major M4) —
  // the mirror of the line in `toggleUsagePanel` below. A bare set-state, not
  // `closeUsagePanel`: focus is about to land in the surface that is opening.
  usageOpen.value = false;
  settingsOpen.value = true;
}
```

Append one sentence to that function's existing doc comment, after the
"Open board is deliberately NOT in that list any more" paragraph:

```
 * Opening also closes the token usage screen, and `toggleUsagePanel` below
 * closes Settings symmetrically — the two are full-window surfaces at the same
 * layer, so exactly one can be up (spec §Surface, major M4).
```

- [ ] **Step 5: Teach `requestAttentionFocus` about Usage — overlay place 4 of 5**

In `App()`, `requestAttentionFocus` (`:234-256`). Add the snapshot field and the
non-focusing seam:

```ts
      overlays: {
        board: boardOpen.value,
        settings: settingsOpen.value,
        usage: usageOpen.value,
        presetEditor: editorRequest.value !== null,
        savePresetDialog: saveDialogOpen.value,
      },
      // Non-focusing set-state — NOT `OpenBoard.onCancel` / `closePanel()`,
      // which focus the active pane and could ack the wrong pane first.
      dismissBoard: () => {
        boardOpen.value = false;
      },
      dismissSettings: () => {
        settingsOpen.value = false;
      },
      // Same rule as `dismissSettings`: ⌘⇧A means "take me to the agent that
      // needs me", so the surface in the way is dropped without anyone else
      // claiming focus first.
      dismissUsage: () => {
        usageOpen.value = false;
      },
```

> This does not typecheck until Task D4 widens `AttentionOverlaySnapshot` and
> `AttentionFocusRequest`. `tsc` will report
> `Object literal may only specify known properties, and 'usage' does not exist in type 'AttentionOverlaySnapshot'`.
> That is expected between D3 and D4 and is why Step 9 below runs `npm run build`
> **after** noting the dependency; if D4 has not run yet, run these two tasks
> back to back and typecheck once at the end of D4.

- [ ] **Step 6: Extend `overlayCoversPane` — overlay place 3 of 5**

In `App()` (`:546-560`). Replace the function, comment included:

```ts
/**
 * Every overlay that covers the terminal grid. The Prompt Board targets the
 * FOCUSED pane, so it must not open — or stay open — while one of these
 * hides it. The keyboard path is already gated by `scope: "pane"`; a button
 * onClick is a direct call and needs this guard of its own.
 *
 * One function, read in two places: the render body (for `promptsDisabled`)
 * and INSIDE the effect below. It has to be a function, not a captured
 * boolean — see the effect's own comment.
 *
 * `usageOpen` belongs here for the same reason `settingsOpen` does: the
 * usage screen is full-bleed over the stage, so the pane the popover would
 * paste into is not on screen.
 */
const overlayCoversPane = (): boolean =>
  boardOpen.value ||
  settingsOpen.value ||
  usageOpen.value ||
  editorRequest.value !== null ||
  saveDialogOpen.value;
```

Nothing else changes: the `useSignalEffect` at `:573-577` already calls
`overlayCoversPane()` **inside** its callback, so `@preact/signals` subscribes to
`usageOpen` automatically the first time the effect runs, and an already-open
Prompt Board closes the moment Usage opens. The two `promptsDisabled={…}` prop
sites also already call the function rather than a captured boolean.

- [ ] **Step 7: Add the close/toggle closures and wire the seam**

After `toggleSettings` (`:296-298`) in `App()`:

```ts
/**
 * Usage close — reuses `restoreFocusAfterSettings` verbatim rather than
 * getting a copy: "where focus belongs once a full-window surface closes"
 * has one answer for both screens (the Open board if it is up, otherwise
 * the active pane), and two copies would drift.
 */
const closeUsage = (): void => {
  closeUsagePanel(restoreFocusAfterSettings);
};

/**
 * Toggle Usage — shared by the chrome chart button (direct call below),
 * ⌘⇧U / Ctrl+Shift+U, and the menu's "Token Usage…" item, the latter two
 * through the `onToggleUsage` seam. Delegates to the module-scope
 * `toggleUsagePanel` for the open/close and mutual-exclusion decision.
 */
const toggleUsage = (): void => {
  toggleUsagePanel(restoreFocusAfterSettings);
};
```

and add the seam to `createTabManager` (`:305-308`):

```ts
const manager = createTabManager(host, undefined, {
  onRequestAttentionFocus: (tabIndex) => requestAttentionFocus(tabIndex),
  onToggleSettings: () => toggleSettings(),
  onToggleUsage: () => toggleUsage(),
});
```

The `menu:action` listener (`:357-381`) needs **no change**: it validates the
payload with `isShortcutAction`, which is `isActionId` over `ACTION_REGISTRY`, so
`"toggle-usage"` became valid the moment D1 added the row.

- [ ] **Step 8: Mount the screen**

In the `stage` prop, immediately after `<SettingsScreen … />` (`:718`):

```tsx
          <PersistErrorBar />
          <SettingsScreen open={settingsOpen.value} onClose={closePanel} />
          <UsageScreen open={usageOpen.value} onClose={closeUsage} />
```

Always mounted, visibility driven by `open` — the same contract `SettingsScreen`
uses, so the screen owns its own enter/exit transition instead of being
unmounted mid-animation.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run src/ui/app.test.tsx`
Expected: PASS (26 tests — the 4 `DesktopChrome` cases, 7 `toggleSettingsPanel`, 3 `livePresetOpensATab`, 1 `closeSettingsPanel`, 10 `toggleUsagePanel`, 1 `closeUsagePanel`; vitest reports the `it.each` block as 4 separate cases).

Run: `npm run build`
Expected: PASS **only if Task D4 has already run.** Before D4, `tsc` fails with
`error TS2353: Object literal may only specify known properties, and 'usage' does not exist in type 'AttentionOverlaySnapshot'` at `src/ui/app.tsx`. Run D4 next and typecheck there.

- [ ] **Step 10: Report the task complete**

Files touched: `src/ui/app.tsx`, `src/ui/app.test.tsx`.

---

### Task D4: The attention-focus coordinator learns about Usage

**Files:**

- Modify: `src/ui/attention-focus-coordinator.ts` (`AttentionOverlaySnapshot` ~line 16-25; `AttentionFocusRequest` ~line 28-50; the doc comment ~line 52-65; `runAttentionFocus` ~line 66-91)
- Modify: `src/ui/attention-focus-coordinator.test.ts`

**Interfaces:**

- Consumes: nothing (pure module, no Preact, no DOM).
- Produces: `AttentionOverlaySnapshot.usage: boolean`,
  `AttentionFocusRequest.dismissUsage: () => void`.

This closes overlay place 4, whose call site landed in D3 Step 5.

- [ ] **Step 1: Write the failing tests**

In `src/ui/attention-focus-coordinator.test.ts`, extend the three helpers:

```ts
function overlays(
  partial: Partial<AttentionOverlaySnapshot> = {},
): AttentionOverlaySnapshot {
  return {
    board: false,
    settings: false,
    usage: false,
    presetEditor: false,
    savePresetDialog: false,
    ...partial,
  };
}

interface Spies {
  dismissBoard: ReturnType<typeof vi.fn>;
  dismissSettings: ReturnType<typeof vi.fn>;
  dismissUsage: ReturnType<typeof vi.fn>;
  focusAttention: ReturnType<typeof vi.fn>;
  order: string[];
}

function makeSpies(): Spies {
  const order: string[] = [];
  return {
    dismissBoard: vi.fn(() => order.push("dismissBoard")),
    dismissSettings: vi.fn(() => order.push("dismissSettings")),
    dismissUsage: vi.fn(() => order.push("dismissUsage")),
    focusAttention: vi.fn(() => order.push("focusAttention")),
    order,
  };
}

function request(
  spies: Spies,
  overrides: Partial<AttentionFocusRequest> = {},
): AttentionFocusRequest {
  return {
    hasCandidate: true,
    overlays: overlays(),
    dismissBoard: spies.dismissBoard,
    dismissSettings: spies.dismissSettings,
    dismissUsage: spies.dismissUsage,
    focusAttention: spies.focusAttention,
    ...overrides,
  };
}
```

Add `overlays({ usage: true })` to the `combos` array of the
`"no candidate: calls nothing"` test (`:58-66`), and
`overlays({ presetEditor: true, usage: true })` /
`overlays({ savePresetDialog: true, usage: true })` to the two draft-blocked
`combos` arrays (`:144-149`, `:162-167`) — each of those tests already asserts
`dismissBoard`/`dismissSettings` were not called; add the matching
`expect(spies.dismissUsage).not.toHaveBeenCalled();` line to all three.

Then add three cases inside the same `describe.each`, after the
`"board + settings"` test (`:141`):

```ts
it("usage only: dismissUsage once, nothing else dismissed, then focusAttention once", () => {
  const spies = makeSpies();
  runAttentionFocus(
    request(spies, {
      tabIndex,
      hasCandidate: true,
      overlays: overlays({ usage: true }),
    }),
  );
  expect(spies.dismissUsage).toHaveBeenCalledTimes(1);
  expect(spies.dismissBoard).not.toHaveBeenCalled();
  expect(spies.dismissSettings).not.toHaveBeenCalled();
  expect(spies.focusAttention).toHaveBeenCalledTimes(1);
  expect(spies.focusAttention).toHaveBeenCalledWith(tabIndex);
  expect(spies.order).toEqual(["dismissUsage", "focusAttention"]);
});

// Usage and Settings are mutually exclusive in the app, so this pair cannot
// occur in production — asserted anyway because the coordinator is a pure
// function over a caller-supplied snapshot and must not depend on an
// invariant enforced somewhere else.
it("board + settings + usage: all three dismissed, then focusAttention once", () => {
  const spies = makeSpies();
  runAttentionFocus(
    request(spies, {
      tabIndex,
      hasCandidate: true,
      overlays: overlays({ board: true, settings: true, usage: true }),
    }),
  );
  expect(spies.dismissBoard).toHaveBeenCalledTimes(1);
  expect(spies.dismissSettings).toHaveBeenCalledTimes(1);
  expect(spies.dismissUsage).toHaveBeenCalledTimes(1);
  expect(spies.focusAttention).toHaveBeenCalledTimes(1);
  expect(spies.order.indexOf("dismissUsage")).toBeLessThan(
    spies.order.indexOf("focusAttention"),
  );
});

it("a draft outranks usage: nothing called, the usage screen stays up", () => {
  const spies = makeSpies();
  runAttentionFocus(
    request(spies, {
      tabIndex,
      hasCandidate: true,
      overlays: overlays({ usage: true, savePresetDialog: true }),
    }),
  );
  expect(spies.dismissUsage).not.toHaveBeenCalled();
  expect(spies.focusAttention).not.toHaveBeenCalled();
});
```

Finally, the closing test `"only calls the 3 injected spies…"` (`:198-222`) must
become four. Replace it whole:

```ts
it("only calls the 4 injected spies — never anything resembling a focusing cancel/close", () => {
  const spies = makeSpies();
  const onCancel = vi.fn();
  const closePanel = vi.fn();
  const req: AttentionFocusRequest & {
    onCancel?: () => void;
    closePanel?: () => void;
  } = {
    ...request(spies, {
      tabIndex,
      hasCandidate: true,
      overlays: overlays({ board: true, settings: true, usage: true }),
    }),
  };
  runAttentionFocus(req);
  expect(onCancel).not.toHaveBeenCalled();
  expect(closePanel).not.toHaveBeenCalled();
  // The coordinator's request shape only exposes these 4 closures — assert
  // exactly those are the ones invoked, in this order.
  expect(spies.order).toEqual([
    "dismissBoard",
    "dismissSettings",
    "dismissUsage",
    "focusAttention",
  ]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/attention-focus-coordinator.test.ts`
Expected: FAIL — `AssertionError: expected "spy" to be called 1 times, but got 0 times` on `dismissUsage` (the coordinator ignores the field), and `expected [ 'dismissBoard', 'dismissSettings', 'focusAttention' ] to deeply equal [ 'dismissBoard', 'dismissSettings', 'dismissUsage', 'focusAttention' ]` on the closing test.

- [ ] **Step 3: Widen the snapshot and the request**

In `src/ui/attention-focus-coordinator.ts`:

```ts
/** Snapshot of every overlay that can shadow the terminal grid. */
export interface AttentionOverlaySnapshot {
  /** Open board open. */
  board: boolean;
  /** Settings panel open. */
  settings: boolean;
  /**
   * Token usage screen open. A full-window surface like Settings, so ⌘⇧A must
   * drop it before focusing a pane — otherwise the shortcut acknowledges an
   * attention badge on a pane the user cannot see.
   */
  usage: boolean;
  /** PresetEditor open (holds a draft). */
  presetEditor: boolean;
  /** SavePresetDialog open (holds a draft). */
  savePresetDialog: boolean;
}
```

and, after `dismissSettings` in `AttentionFocusRequest`:

```ts
  /**
   * NON-focusing set-state (e.g. `usageOpen.value = false`) — NOT
   * `closeUsagePanel()`.
   */
  dismissUsage: () => void;
```

- [ ] **Step 4: Dismiss it**

Update the function's doc comment, rule 3:

```
 * 3. Otherwise: dismiss `board`/`settings`/`usage` (only the ones that are
 *    open), then call `focusAttention`.
```

and the body:

```ts
export function runAttentionFocus(req: AttentionFocusRequest): void {
  const {
    tabIndex,
    hasCandidate,
    overlays,
    dismissBoard,
    dismissSettings,
    dismissUsage,
    focusAttention,
  } = req;

  if (!hasCandidate) {
    return; // nothing to focus — leave every overlay exactly as-is
  }

  if (overlays.presetEditor || overlays.savePresetDialog) {
    return; // draft in flight — blocked, no dismissal, no focus
  }

  if (overlays.board) {
    dismissBoard();
  }
  if (overlays.settings) {
    dismissSettings();
  }
  if (overlays.usage) {
    dismissUsage();
  }
  focusAttention(tabIndex);
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/ui/attention-focus-coordinator.test.ts src/ui/app.test.tsx`
Expected: PASS (24 coordinator tests — the file has 9 `it`s per `describe.each` branch today, this task adds 3 and replaces 1, so 12 per branch × 2 branches — plus the 26 app tests).

Run: `npm run build`
Expected: PASS. This is the first clean typecheck since D3 Step 5; the `usage`
field in `app.tsx`'s `overlays` object now resolves.

- [ ] **Step 6: Report the task complete**

Files touched: `src/ui/attention-focus-coordinator.ts`,
`src/ui/attention-focus-coordinator.test.ts`.

---

### Task D5: The chrome button, in both layouts

**Files:**

- Modify: `src/ui/chrome-actions.tsx` (imports ~line 2-9; `ChromeActionsProps` ~line 13-29; the label block ~line 33-38; the button, between `{props.updateAction}` and the gear ~line 94-104)
- Modify: `src/ui/chrome-actions.test.tsx`
- Modify: `src/ui/tab-bar.tsx` (`TabBarProps` ~line 19-40; the `<ChromeActions …>` forward ~line 164-177)
- Modify: `src/ui/tab-bar.test.tsx` (`baseProps()` ~line 63-80)
- Modify: `src/ui/app.tsx` (the `chromeActions` element ~line 609-626; the `<TabBar …>` prop site ~line 652-677)

**Interfaces:**

- Consumes: `toggleUsage` and `usageOpen.value` from D3; `shortcutLabel("toggle-usage")`, which derives `⌘⇧U` / `Ctrl+Shift+U` from the keymaps added in D1 — no string is written twice.
- Produces: `ChromeActionsProps.usageOpen` / `.onToggleUsage`, `TabBarProps.usageOpen` / `.onToggleUsage`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/chrome-actions.test.tsx`, add the handler and the default prop:

```ts
const handlers = () => ({
  onSplitRow: vi.fn(),
  onSplitColumn: vi.fn(),
  onClosePane: vi.fn(),
  onToggleExpand: vi.fn(),
  onTogglePrompts: vi.fn(),
  onToggleUsage: vi.fn(),
  onToggleSettings: vi.fn(),
});
```

```tsx
<ChromeActions
  settingsOpen={false}
  expandActive={false}
  promptsOpen={false}
  promptsDisabled={false}
  usageOpen={false}
  {...on}
  {...overrides}
/>
```

add the row to `actions`, between the prompt board and the gear so the table
matches DOM order:

```ts
    {
      name: "Open the prompt board",
      icon: "lucide-message-square-text",
      fires: "onTogglePrompts",
    },
    {
      name: "Open token usage",
      icon: "lucide-chart-column",
      fires: "onToggleUsage",
    },
    {
      name: "Open settings",
      icon: "lucide-settings",
      fires: "onToggleSettings",
    },
```

and extend the toggle-state test (`:117-127`):

```ts
it("carries the toggle state of expand, prompts, usage and settings", () => {
  mount({
    expandActive: true,
    promptsOpen: true,
    usageOpen: true,
    settingsOpen: true,
  });

  expect(button("Toggle focus expand").getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(button("Open the prompt board").getAttribute("aria-expanded")).toBe(
    "true",
  );
  // A screen, not a popover: pressed, never expanded — same as the gear.
  expect(button("Open token usage").getAttribute("aria-pressed")).toBe("true");
  expect(button("Open token usage").getAttribute("aria-expanded")).toBeNull();
  expect(button("Open settings").getAttribute("aria-pressed")).toBe("true");
});
```

`"keeps every action reachable by name and none named by its glyph"` needs no
edit — it counts `actions.length`, which is now 7.

In `src/ui/tab-bar.test.tsx`, add to `baseProps()` (`:63-80`), after
`onTogglePrompts`:

```ts
    usageOpen: false,
    onToggleUsage: vi.fn(),
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/chrome-actions.test.tsx`
Expected: FAIL — `Error: no button named Open token usage` from the new `actions` row, and `expected 6 to be 7` from the button-count test.

- [ ] **Step 3: Add the button**

In `src/ui/chrome-actions.tsx`, extend the lucide import (alphabetical):

```tsx
import {
  ChartColumn,
  Columns2,
  Maximize2,
  MessageSquareText,
  Rows2,
  Settings,
  SquareX,
} from "lucide-preact";
```

Add to `ChromeActionsProps`, after `promptPopover`:

```ts
/** Whether the token usage screen is up (drives `aria-pressed`). */
usageOpen: boolean;
```

and to the handler list, before `onToggleSettings`:

```ts
  onToggleUsage(): void;
```

Add the label beside the others (`:33-38`):

```ts
const usage = shortcutLabel("toggle-usage");
```

Add the button between `{props.updateAction}` and the gear:

```tsx
      <span class="tabbar__sep" aria-hidden="true" />
      {props.updateAction}
      {/* App-level, like the gear beside it — that is why it sits AFTER the
          separator rather than next to Prompts, which is pane-scoped. It is
          still "between Prompts and Settings" as the spec requires.
          `aria-pressed`, not `aria-expanded`: this opens a screen, not a
          popover, so it matches the gear's contract, not the Prompt Board's. */}
      <button
        type="button"
        class={`iconbtn ${props.usageOpen ? "is-active" : ""}`}
        title={`Token usage (${usage})`}
        aria-label="Open token usage"
        aria-pressed={props.usageOpen}
        onClick={props.onToggleUsage}
      >
        <DeckIcon icon={ChartColumn} size={CHROME_ICON} />
      </button>
      <button
        type="button"
        class={`iconbtn iconbtn--gear ${props.settingsOpen ? "is-active" : ""}`}
        …
```

There is **no** `disabled` prop: unlike the Prompt Board, this screen targets no
pane, so nothing about the overlay stack can make it inapplicable.

- [ ] **Step 4: Forward through `TabBar`**

In `src/ui/tab-bar.tsx`, add to `TabBarProps` after `onTogglePrompts` (`:35`):

```ts
  /** Whether the token usage screen is up — forwarded to ChromeActions. */
  usageOpen: boolean;
  onToggleUsage(): void;
```

and to the `<ChromeActions …>` forward (`:164-177`), after `onTogglePrompts`:

```tsx
        usageOpen={props.usageOpen}
        onToggleUsage={props.onToggleUsage}
```

- [ ] **Step 5: Fill both prop sites in `app.tsx`**

In the `chromeActions` element (`:609-626`), after `onTogglePrompts`:

```tsx
      onTogglePrompts={togglePrompts}
      usageOpen={usageOpen.value}
      onToggleUsage={toggleUsage}
      onToggleSettings={toggleSettings}
```

and in the `<TabBar …>` element (`:652-677`), after `onTogglePrompts`:

```tsx
          onTogglePrompts={togglePrompts}
          usageOpen={usageOpen.value}
          onToggleUsage={toggleUsage}
          onToggleSettings={toggleSettings}
```

Both sites are mandatory: `ChromeActions` renders once in the titlebar layout and
once inside `TabBar`, and missing one leaves the button absent in exactly one of
the two tab-bar positions — a bug nobody sees until they flip
`tabBarPosition`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/ui/chrome-actions.test.tsx src/ui/tab-bar.test.tsx`
Expected: PASS (chrome-actions 10 tests — 7 per-action + 3 others; tab-bar unchanged in count).

Run: `npm run build`
Expected: PASS. Before Step 5 it fails with
`error TS2741: Property 'usageOpen' is missing in type … but required in type 'ChromeActionsProps'` at both `app.tsx` prop sites.

- [ ] **Step 7: Report the task complete**

Files touched: `src/ui/chrome-actions.tsx`, `src/ui/chrome-actions.test.tsx`,
`src/ui/tab-bar.tsx`, `src/ui/tab-bar.test.tsx`, `src/ui/app.tsx`.

---

### Task D6: The Settings › agents link row

**Files:**

- Modify: `src/ui/settings/sections/agents-section.tsx` (imports ~line 13-16; a new handler beside `commitDraft` ~line 113-134; a new `ConfigRow` after the "Add agent" row ~line 280-297)
- Modify: `src/ui/settings/sections/agents-section.test.tsx`

**Interfaces:**

- Consumes: `settingsOpen`, `usageOpen` (`src/chrome/events.ts`), `ConfigRow`.
- Produces: nothing exported.

The row is an ordinary `ConfigRow` with a `cfg-btn` reading `open …` — the exact
shape `about-section.tsx`'s "Release notes" row already uses
(`about-section.tsx:110-118`). **No new DL value kind is invented**: DL §6 is a
closed set, and §0.7 decision 5 already made this call.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/settings/sections/agents-section.test.tsx` (the file already
has the jsdom pragma and a mount harness — reuse whatever it names its render
helper; the block below assumes the file's existing `host` and `act(() =>
render(<AgentsSection />, host))` pattern, and imports `settingsOpen` /
`usageOpen` from `../../../chrome/events`):

```tsx
describe("the token usage link row", () => {
  afterEach(() => {
    settingsOpen.value = false;
    usageOpen.value = false;
  });

  const usageButton = (): HTMLButtonElement => {
    const found = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".cfg-btn"),
    ).find((candidate) => candidate.textContent?.trim() === "open …");
    if (found === undefined) {
      throw new Error("no token usage link row");
    }
    return found;
  };

  it("swaps Settings for the usage screen in one click", () => {
    settingsOpen.value = true;
    usageOpen.value = false;
    act(() => render(<AgentsSection />, host));

    usageButton().click();

    expect(settingsOpen.value).toBe(false);
    expect(usageOpen.value).toBe(true);
  });

  it("reads as a link row, not a value pill — the about-section pattern", () => {
    act(() => render(<AgentsSection />, host));

    const button = usageButton();
    expect(button.classList.contains("cfg-btn")).toBe(true);
    // No new DL value kind: same class, same copy as "Release notes".
    expect(button.classList.contains("cfg-btn--disabled")).toBe(false);
    expect(button.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/settings/sections/agents-section.test.tsx`
Expected: FAIL — `Error: no token usage link row`.

- [ ] **Step 3: Add the handler and the row**

In `src/ui/settings/sections/agents-section.tsx`, add the import:

```ts
import { settingsOpen, usageOpen } from "../../../chrome/events";
```

Add the handler inside `AgentsSection()`, after `commitDraft` (`:134`):

```ts
/**
 * Settings → Token Usage, in one click. Writes the two signals directly
 * instead of calling `closeSettingsPanel` (app.tsx): that helper hands focus
 * back to the active pane, and here focus must land inside the screen that
 * is opening — `UsageScreen` takes it on mount, exactly as `SettingsScreen`
 * does. Same mutual-exclusion rule `toggleUsagePanel` enforces (spec
 * §Surface, major M4).
 *
 * No draft preflight is needed here, unlike `toggleUsagePanel`: a
 * PresetEditor/SavePresetDialog scrim sits at z-40 over Settings' z-35, so
 * this button is physically unclickable while a draft is up.
 */
const openUsage = (): void => {
  settingsOpen.value = false;
  usageOpen.value = true;
};
```

and the row, immediately after the closing `</ConfigRow>` of "Add agent"
(`:297`), before the closing fragment:

```tsx
<ConfigRow
  label="Token usage"
  desc="tokens and estimated cost for Claude Code and Codex"
>
  <button type="button" class="cfg-btn" onClick={openUsage}>
    open …
  </button>
</ConfigRow>
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/settings/sections/agents-section.test.tsx`
Expected: PASS.

The existing count assertions in that file are unaffected: `:124` counts
`.cfg-btn--disabled` (the built-in agents' locked pills — the new button carries
no such class), and `:127` counts `.cfg-row__remove`, which the new row has none
of. Confirm both stayed green rather than assuming it.

- [ ] **Step 5: Report the task complete**

Files touched: `src/ui/settings/sections/agents-section.tsx`,
`src/ui/settings/sections/agents-section.test.tsx`.

---

### Task D7: The five-place overlay audit

A new grid-covering overlay is wired in five places and **every one of them is a
silent failure**: the app builds, the tests pass, and the defect only shows up
as a shortcut firing behind a screen or an animation ignoring the user's
reduced-motion setting. This task checks all five with commands, and checks
Section C's CSS line that Section D is forbidden from writing itself.

**Files:** none modified. This task only reads and reports.

- [ ] **Step 1: Place 1 — the signal exists and says what it is**

```bash
grep -n -B 14 "export const usageOpen" src/chrome/events.ts
```

Expected: the declaration plus a doc comment that explicitly contrasts itself
with `promptsOpen` and states it IS a grid-covering overlay. A bare
`export const usageOpen = signal(false);` with no comment fails this step — the
next person to add an overlay reads these comments to learn the rule.

- [ ] **Step 2: Place 2 — `openOverlayRanks()` pushes the rank**

```bash
grep -n -A 6 "function openOverlayRanks" src/terminal/tab-manager.ts
grep -c "OverlayTier = \"pane\" | \"settings\" | \"board\" | \"modal\"" src/terminal/action-registry.ts
```

Expected: the first shows `if (settingsOpen.value || usageOpen.value) { ranks.push(TIER_RANK.settings); }`. The second prints `1` — the `OverlayTier` union is **unchanged** (§0.2.6: no new member). A `0` means someone widened the union; that is a fork, not a fix.

Behavioral proof already exists from D1 Step 7: `"blocks a pane-tiered action while the usage screen covers the grid"`. Re-run it here so this audit is self-contained.

Run: `npx vitest run src/terminal/tab-manager.test.ts -t "usage screen covers the grid"`
Expected: PASS (1 test).

- [ ] **Step 3: Place 3 — `overlayCoversPane()` includes it, read inside the effect**

```bash
grep -n -A 8 "const overlayCoversPane" src/ui/app.tsx
grep -n -A 5 "useSignalEffect(() => {" src/ui/app.tsx | grep -n "overlayCoversPane()"
```

Expected: `|| usageOpen.value` in the function, and the effect still **calling**
`overlayCoversPane()` rather than reading a boolean captured in the render body.
A captured boolean makes the effect depend on `promptsOpen` alone, so opening
Usage would re-render App and never re-run it — the popover would keep painting
at z-100 above the usage screen. The comment at `app.tsx:562-572` states this;
if the call has become a variable, stop and restore it.

- [ ] **Step 4: Place 4 — the attention coordinator dismisses it**

```bash
grep -n "usage: boolean" src/ui/attention-focus-coordinator.ts
grep -n -A 2 "if (overlays.usage)" src/ui/attention-focus-coordinator.ts
grep -n "dismissUsage" src/ui/app.tsx
```

Expected: one hit each — the snapshot field, the dismissal branch calling
`dismissUsage()`, and the non-focusing seam in `app.tsx`'s
`requestAttentionFocus`. If `app.tsx` has `dismissUsage: closeUsage` instead of
the bare set-state, that is wrong: the focusing variant can acknowledge the wrong
pane before the real candidate is chosen (`attention-focus-coordinator.ts:5-9`).

- [ ] **Step 5: Place 5 — Section C's reduced-motion scope**

Section D **must not edit `src/styles.css`** (§0.6 gives the whole file to C).
This step verifies C did its part.

```bash
grep -n -A 12 "prefers-reduced-motion" src/styles.css | grep "usage-screen"
```

Expected: two lines, `.usage-screen,` and `.usage-screen *,`, inside the same
`@media (prefers-reduced-motion: reduce)` block that already lists
`.settings-screen` (currently `src/styles.css:1431-1440`).

**If this returns nothing, STOP.** Do not add the line. Report to the
orchestrator: _"Section C did not add `.usage-screen, .usage-screen *` to the
reduced-motion scope list in `src/styles.css:1431`. §0.2.6 requires it and DL-1.5
requires scoping by surface rather than by allowlist. Section C owns that file;
this needs a Section C fix, not a Section D edit."_ A missing entry means every
transition on the new screen ignores the OS setting, which is an accessibility
regression no test in this repo catches.

- [ ] **Step 6: Report the audit result**

Report each of the five places as verified or failed, with the command output.
Files touched: none.

---

### Task D8: Full verification and the in-flight record

**Files:**

- Modify: `docs/CONTEXT.md` (D9 — a completed plan updates it)
- Modify: `AGENTS.md` (the "In flight" list — the token usage dashboard entry)

- [ ] **Step 1: Run every gate in §0.1 and paste the output**

```bash
npm test
npm run build
npm run generate:menu:check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

Expected: all green. No "done" claim before this output exists (L5/W4).

Record the exact `npm test` line (`Tests  N passed (N)` / `Test Files  M passed
(M)`) and the exact `cargo test` count — Step 3 needs the real numbers, and the
baseline to compare against is the Prompt Board entry's "1093 passing across 96
files, cargo test 151 passing" (`docs/CONTEXT.md:369-371`), which was the
recorded state before the icon migration.

- [ ] **Step 2: Capture the bundle delta**

`npm run build` prints per-asset gzip sizes. Record the JS and CSS gzip figures
and diff them against the numbers in `docs/CONTEXT.md`'s previous entry (the icon
migration recorded "CSS shrank 9.02 → 8.97 KiB"). The pinned LiteLLM pricing
snapshot ships in the bundle by design (spec §5, approved bundle fork), so the JS
figure is expected to grow — the point is to record by how much, not to be
surprised later.

- [ ] **Step 3: Eye-review the screen (DL §11, §15)**

Run `npm run tauri dev`, press ⌘⇧U, and screenshot all three views (overview,
daily, breakdown) against real local data. Check against DL §11 (full-window
screen shell) and the new §15 (read-only data table): `--chrome-2` surface, inset
hairline, lowercase rail labels, no uppercase, no monospace outside the numeric
columns, the table scrolling inside its own container rather than the page. A
green build proves nothing about design (W10 / `frontend_gate`).

If Section C has already run and recorded its own eye review, cite it here rather
than repeating it — but the **entry points** (button, shortcut, menu item,
Settings link) are Section D's surface and are seen for the first time in this
step.

- [ ] **Step 4: Manual acceptance**

| Case                                                                                                                                                                                                                  | Expected                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold open on the real ~2.5 GB corpus (`~/.claude/projects` + `~/.codex/sessions`), with `usage-cache.json` deleted from the app data dir first (`find ~/Library/Application\ Support -name usage-cache.json -delete`) | The loading state shows immediately; the window stays responsive (the scan is on a blocking worker); real totals replace it when the scan finishes. No beachball, no blank screen.                                                                                                                                                  |
| Second open, nothing changed on disk                                                                                                                                                                                  | Totals appear with no visible loading state — the cache short-circuits.                                                                                                                                                                                                                                                             |
| An unchanged poll cycle does no re-reads                                                                                                                                                                              | Leave the screen open 30 s with no agent running. Observe with `sudo fs_usage -w -f filesys $(pgrep -f 'SpaceVibe Deck' \| head -1) \| grep -E '\.jsonl'` — expect zero `.jsonl` reads across the poll cycles, only the small cache/stat traffic. (`fs_usage` needs sudo; if unavailable, use Instruments' File Activity template.) |
| Escape while Usage is focused                                                                                                                                                                                         | Screen closes; focus returns to the active pane (or to the Open board if it is up). Settings does **not** reappear.                                                                                                                                                                                                                 |
| The chrome chart button                                                                                                                                                                                               | Opens; the button shows `is-active` and `aria-pressed="true"`; clicking again closes.                                                                                                                                                                                                                                               |
| ⌘⇧U (macOS) / Ctrl+Shift+U (Windows)                                                                                                                                                                                  | Same open/close as the button, from anywhere including over the Open board.                                                                                                                                                                                                                                                         |
| View → "Token Usage…"                                                                                                                                                                                                 | Same, and the item shows `⌘⇧U` with a separator above it.                                                                                                                                                                                                                                                                           |
| Open Settings while Usage is up                                                                                                                                                                                       | Usage closes, Settings opens. One surface on screen.                                                                                                                                                                                                                                                                                |
| Open Usage while Settings is up                                                                                                                                                                                       | Settings closes, Usage opens.                                                                                                                                                                                                                                                                                                       |
| Settings › agents → "Token usage" → `open …`                                                                                                                                                                          | Settings closes, Usage opens, focus lands in the screen.                                                                                                                                                                                                                                                                            |
| ⌘⇧U while a PresetEditor or SavePresetDialog draft is up                                                                                                                                                              | Nothing happens; the draft is untouched.                                                                                                                                                                                                                                                                                            |
| ⌘⇧A (attention) while Usage is up, with a pane needing attention                                                                                                                                                      | Usage closes and the pane takes focus. With a draft also up, nothing happens at all.                                                                                                                                                                                                                                                |
| The Prompt Board button while Usage is open                                                                                                                                                                           | Disabled (greyed). An already-open popover closes the instant Usage opens.                                                                                                                                                                                                                                                          |
| ⌘W / ⌘K while Usage is open                                                                                                                                                                                           | No-op — the pane behind the screen is not closed and its scrollback is not wiped.                                                                                                                                                                                                                                                   |
| No data yet: move `~/.claude` and `~/.codex` aside                                                                                                                                                                    | "no data yet", **not** an error. Both sources report `missing`.                                                                                                                                                                                                                                                                     |
| Unreadable: `chmod 000` one project directory under `~/.claude/projects`                                                                                                                                              | An explicit error state for that source, visibly distinct from "no data yet" (spec major M7). Restore the mode afterwards.                                                                                                                                                                                                          |
| Skipped lines: append one line of `{"broken` to a copy of a transcript                                                                                                                                                | The "n lines skipped" note appears with a nonzero count; every other line still counts.                                                                                                                                                                                                                                             |
| Stale after a failed poll: keep the screen open and make the command fail (e.g. revoke read on the app-data dir mid-session)                                                                                          | The last good numbers stay on screen with a "stale" note — the view never blanks.                                                                                                                                                                                                                                                   |

- [ ] **Step 5: Update `docs/CONTEXT.md` (D9)**

Insert a new section immediately **before** the trailing `## Chưa khớp thực tế`
heading (currently `docs/CONTEXT.md:442`) — after the `## Unified icon system —
2026-08-09` section. House format: one prose paragraph, then decision bullets
with relative markdown links plus backticked intent labels, then a verification
paragraph with **real numbers taken from Step 1's output**.

Every `NN` below is a placeholder to substitute from the actual gate output.
**Do not invent them at plan time.**

```markdown
## Token usage dashboard — 2026-08-10

A full-window screen showing how many tokens the Claude Code and Codex CLIs
have used on this machine, and what that would cost. Machine-wide totals only:
per-pane attribution was rejected up front, which deletes the pane→session
mapping problem entirely. Opened by ⌘⇧U / Ctrl+Shift+U, View → Token Usage…,
the chart button beside the gear in both tab-bar layouts, or the link row in
Settings › agents. Zero new dependencies, cargo or npm.

- A Rust scanner streams both CLIs' JSONL transcripts on a blocking worker and
  returns raw counters bucketed by 15-minute UTC bucket × agent × model through
  one command; USD is computed in the frontend from a pinned LiteLLM snapshot
  shipped in the bundle ([scanner](../src-tauri/src/usage.rs) `current`,
  [pricing](../src/lib/usage-pricing.ts) `current`,
  [snapshot](../src/lib/usage-pricing-snapshot.ts) `current`).
- Codex is ingested as per-event **deltas**, not last-snapshot: real sessions
  carry hundreds of cumulative `token_count` events, span UTC days and switch
  models mid-session, so a last-snapshot read misattributes all of it. The real
  path is `payload.info.total_token_usage`, one level deeper than the spec said
  ([spec errata](plans/2026-08-10-token-usage-dashboard.md) `current`).
- Claude is deduped by `message.id` + `requestId` with a **contribution map**,
  last-write-wins — a seen-set cannot express last-wins across an offset resume,
  and summing the growing stream snapshots overcounts roughly 2×. The scan glob
  includes `subagents/*.jsonl`, which is ~47% of this machine's Claude history
  by size.
- Six counter classes stay separate everywhere (input, cache read, 5m and 1h
  cache creation, cache write, output): each prices differently, and Codex's
  `cached_input_tokens` is a subset of its input, not an addition to it.
- Bucket width is 15 minutes UTC, not one hour: :30 and :45 zone offsets
  (India, Nepal, Chatham) put boundary-hour usage on the wrong local day with
  hourly buckets.
- `usageOpen` is a grid-covering overlay, wired in all four code places a new
  one needs — `openOverlayRanks()` (reusing `TIER_RANK.settings`, no new tier),
  `overlayCoversPane()`, the attention preflight, and the reduced-motion scope
  list ([signal](../src/chrome/events.ts) `current`,
  [ranks](../src/terminal/tab-manager.ts) `current`,
  [preflight](../src/ui/attention-focus-coordinator.ts) `current`).
- Usage and Settings are mutually exclusive: opening one closes the other, and
  closing Usage does not put Settings back — restoring a displaced surface is a
  second behavior nothing asked for
  ([toggle](../src/ui/app.tsx) `current`).
- `toggle-usage` is `scope: "always"` for the same reason `toggle-settings` is:
  the screen's own overlay rank would otherwise block the only action that can
  close it ([registry](../src/terminal/action-registry.ts) `current`).
- The read-only data table is a new DESIGN-LANGUAGE § — non-sortable,
  non-interactive, horizontal overflow scrolling inside the table's own
  container; §11 generalized from "the settings shell" to full-window screens
  with no rule renumbered ([rules](DESIGN-LANGUAGE.md) `current`).

Verified 2026-08-10: `npm test` NN passing across NN files (NN before this
feature), `npm run build` (tsc + vite) green, `npm run generate:menu:check`
green, `cargo test --locked` NN passing (NN before), `cargo fmt --check` clean.
Bundle gzip moved NN → NN KiB for JS and NN → NN KiB for CSS; the pricing
snapshot is the growth. The screen was eye-reviewed on screenshots of all three
views against DL §11 and the new §.

Known-open, deliberately: <fill from the acceptance table — list every row of
Task D8 Step 4 that was NOT run, and say so plainly rather than implying it
passed>. Windows path layout is still assumed rather than verified: the feature
degrades to "no data yet" if `%USERPROFILE%\.claude` / `.codex` are absent.
`agy`, `gemini` and `opencode` usage is invisible — v1 is Claude + Codex, and
the per-agent adapter split is the only seam left for more.
```

Do **not** add a row to that file's `## Chưa khớp thực tế` ledger for anything
labelled `decided` or `building`: per the docs convention those are backlog, not
drift. A row belongs there only if a `current` claim above turns out to be
contradicted by the code.

- [ ] **Step 6: Update the `AGENTS.md` in-flight entry**

Rewrite the token usage dashboard bullet in the "In flight" list. Current text
begins: _"The token usage dashboard is decided at spec level (2026-08-10), [spec]
… **Not implemented — no code written, plan not started, spec pending user
review.**"_ Replace that bullet with a shipped record that keeps every decision
already written down (the four blockers, the two DL forks, the rejected per-pane
attribution) and adds what the plan resolved, each with a one-line reason:

- The dashboard **shipped 2026-08-10** — ⌘⇧U / Ctrl+Shift+U, View → Token
  Usage…, a chart button in both tab-bar layouts, and a Settings › agents link
  row.
- `toggle-usage` is `scope: "always"` and pushes `TIER_RANK.settings` rather
  than taking a fifth `OverlayTier` member — the rank it needs already exists
  and a second unoccupied tier is a pattern nobody could explain.
- Usage and Settings are mutually exclusive both directions; closing Usage does
  not reopen Settings, because restoring a displaced surface was never
  specified.
- Two spec errata found against real files and fixed in the implementation:
  Codex totals live at `payload.info.total_token_usage`, one level deeper than
  the spec's text, and Claude's `message.usage.iterations` array must **not** be
  summed.
- What was **not** verified: every unticked row of the acceptance table, and
  Windows path layout.

Per the same list's own rule ("This list is a QUEUE, not an archive"), the
detailed record now lives in `docs/CONTEXT.md`; the `AGENTS.md` bullet stays
short and points there.

- [ ] **Step 7: Ask the user before committing any doc (D14)**

**This is its own step and it is not optional.** `docs/CONTEXT.md`, `AGENTS.md`,
`docs/DESIGN-LANGUAGE.md` (Section C) and the plan file itself are documentation:
show the user the diff and get an explicit approval before any of them is
committed. This applies even though the code commits may already have landed —
explicit-path commits (§0.6) are exactly what keeps docs out of them.

- [ ] **Step 8: Hand the orchestrator a commit order**

Section D runs no git command (§0.6). Suggested order for the orchestrator, one
conventional commit per task, explicit paths, never `git add -A`:

1. `feat(usage): register the toggle-usage action, shortcut and overlay rank` — `src/chrome/events.ts src/terminal/action-registry.ts src/terminal/action-registry.test.ts src/terminal/keymap.test.ts src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts src-tauri/src/menu_registry.rs` (D1 + D2 together — the generated menu is stale between them, so they are one commit)
2. `feat(usage): open the usage screen from app chrome with Settings exclusion` — `src/ui/app.tsx src/ui/app.test.tsx src/ui/attention-focus-coordinator.ts src/ui/attention-focus-coordinator.test.ts` (D3 + D4 — `app.tsx` does not typecheck between them)
3. `feat(usage): add the chrome usage button in both layouts` — `src/ui/chrome-actions.tsx src/ui/chrome-actions.test.tsx src/ui/tab-bar.tsx src/ui/tab-bar.test.tsx src/ui/app.tsx`
4. `feat(usage): link to token usage from Settings agents` — `src/ui/settings/sections/agents-section.tsx src/ui/settings/sections/agents-section.test.tsx`
5. **After user approval only:** `docs(context): record the token usage dashboard landing` — `docs/CONTEXT.md AGENTS.md`

- [ ] **Step 9: Report the task complete**

Files touched: `docs/CONTEXT.md`, `AGENTS.md`.

---

## Findings

### (a) Spec claims wrong against the code

1. **None found in the spec's §Surface** — every claim checks out. "a `usageOpen`
   signal beside `settingsOpen`", "the same preflight that keeps Settings from
   opening under a modal draft", "tier decisions follow `toggle-settings` as the
   template", "generated menu output is never hand-edited (R3)" and "a
   `ChromeActions` icon button (both layouts…) between Prompts and Settings" all
   match the real files.
2. **"between Prompts and Settings" is under-determined.** In the real DOM there
   are two things between them: `<span class="tabbar__sep">` and
   `{props.updateAction}` (`chrome-actions.tsx:93-94`). I placed the button
   **after** both, immediately before the gear, because the separator divides
   pane-scoped actions (splits, close, expand, Prompts) from app-scoped ones
   (update, Settings) and Usage is app-scoped. Both placements satisfy the
   spec's words; this one is a judgement call, is commented in the code, and is a
   one-line move if the user disagrees.

### (b) Objections to the frozen §0 / the section brief

1. **The brief's expected `menu_registry.rs` line is wrong** (brief, "Action,
   keymap, menu"). It says the file gains
   `let toggle_usage = action_item(handle, "toggle-usage", "Token Usage…", Some("CmdOrCtrl+Shift+U"))?;`
   on one line. It will not: that is 103 columns, past rustfmt's default
   `max_width` of 100, and the repo has no `rustfmt.toml` (checked
   `src-tauri/`, repo root, and `find -maxdepth 2 -name '*rustfmt*'` — nothing).
   I ran the real `rustfmt --edition 2021` (from `~/.cargo/bin`) over a scratch
   file containing exactly that line; it produced the six-line wrapped form, the
   same shape as `toggle_prompts` at `menu_registry.rs:79-84`. Task D2 states the
   wrapped form as the expectation. The `.separator()` half of the brief's claim
   **is** correct.
   This is an objection to the brief, not to §0 — §0.2.6 says nothing about
   formatting.
2. **§0.2.6 is silent on the ChromeActions accessible name and on `aria-pressed`
   vs `aria-expanded`.** I chose `aria-label="Open token usage"` and
   `aria-pressed`, matching the gear (a screen) rather than the Prompt Board (a
   popover), as the brief instructs. Recorded because the exact string is now
   asserted in `chrome-actions.test.tsx` and changing it later is a two-file
   change.
3. **No objection to §0.2.6's names.** `usageOpen`, `closeUsagePanel`,
   `toggleUsagePanel`, `toggle-usage`/`Token Usage…`, `scope: "always"`,
   `group: "usage"`, `onToggleUsage`, `TIER_RANK.settings`, `usage`/`dismissUsage`
   are all used verbatim. `ChartColumn` (§0.7 decision 3) exists in the installed
   `lucide-preact@1.30.0` and renders `lucide-chart-column` — verified, not
   assumed.

### (c) Forks I did NOT decide

1. **The chrome button's position relative to `tabbar__sep`** — see (a)(2).
   Placed after the separator; flagged rather than silently chosen. Not an R2
   fork (no DL rule governs cluster order), so it needs no approval, but the user
   may still want it moved.
2. **Whether the Settings › agents link row deserves its own `ConfigGroup`
   heading.** I put a bare `ConfigRow` at the end of the agents section,
   following `about-section.tsx`. A `<ConfigGroup label="usage" />` above it
   would set it apart from the agent list. Cheap either way; left as the simpler
   option.
3. **Whether Usage should be a Settings category instead of a screen.** Rejected
   by the spec (`§Surface`: "a dedicated full-window `UsageScreen`"), so not
   reopened — noted only because a reviewer will ask.
4. **`TIER_RANK` now has one rank (`settings`, 20) serving two distinct
   surfaces.** `TIER_RANK`'s own doc comment says `"settings"` has no action
   tiered at it and explains why the rank still must exist. That comment stays
   accurate. But the rank's _name_ now understates what it covers. Renaming it
   (`"screen"`?) touches the `OverlayTier` union, which §0.2.6 freezes — so I did
   not. Worth a future cleanup task.

### (d) Deliberate omissions

1. **No `src/styles.css` edit anywhere in this section**, including the
   reduced-motion line §0.2.6 assigns to the overlay checklist. §0.6 gives the
   entire file to Section C precisely so it has one owner; D7 Step 5 verifies and
   refuses to patch.
2. **No `<App>`-level render test.** The repo has no `<App>` harness
   (`app.tsx:120-124` says so explicitly and gives the reason), so the mutual
   exclusion, the mount, and the `overlayCoversPane` extension are covered by
   module-scope unit tests plus the manual acceptance table. Building a harness
   for this feature would be disproportionate and out of scope (W3).
3. **No test drives the real macOS menu item.** `menu_registry.rs` is generated
   and `build_view_menu` is `#[cfg(target_os = "macos")]`; the guarantee is
   `generate:menu:check` plus the manual acceptance row. This matches how
   `toggle-prompts` was verified.
4. **No `usage` field added to `openOverlayRanks`'s return shape or any new
   accessor on `TabManager`.** R4 lists the coordinator paths as load-bearing
   seams; one boolean in an existing `if` is the smallest possible change and
   needs no new API.
5. **No polling lifecycle in `app.tsx`.** Start/stop belongs to Section C's
   screen, keyed off `open`. If it turns out C wired it from App, that is a
   contract break to report, not to absorb.
6. **`shortcut-label.test.ts` is not extended.** It samples a handful of actions
   to prove the formatter, not every action; `toggle-usage`'s label is already
   asserted end-to-end through the `title` attribute path in D5's tests and
   through `keymap.test.ts`. Adding a row there would be redundant.

### (e) Every existing test/gate I expect to go red, and why

| Gate                                                                        | When                                                                          | Why                                                                                                                     | Fix                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `action-registry.test.ts:75` id census                                      | D1 Step 4 (vitest)                                                            | Enumerates 44 ids in a literal `Set`; a 45th row makes the sets unequal                                                 | D1 Step 1 — retitle `44` → `45`, add `"toggle-usage"` beside `"toggle-prompts"` |
| `dispatch-coverage.test.ts`                                                 | D1, between the keymap binding and `COMMAND_ACTIONS`                          | A keymap action with no entry in `DISPATCHABLE_ACTIONS` is an orphan                                                    | Same task, same step group — never split                                        |
| `npm run build` — `commands` `satisfies`                                    | D1, if `COMMAND_ACTIONS` gains the id without the table entry (or vice versa) | Two independent exactness checks over one list                                                                          | D1 Step 5 does both at once                                                     |
| `npm run generate:menu:check`                                               | D1 Step 9 → D2 Step 4                                                         | The registry changed; the generated Rust has not                                                                        | D2                                                                              |
| `npm run build` — `app.tsx` `overlays` object                               | D3 Step 5 → D4 Step 5                                                         | `TS2353: 'usage' does not exist in type 'AttentionOverlaySnapshot'`                                                     | D4 widens the type; run D3 and D4 back to back                                  |
| `attention-focus-coordinator.test.ts` — `overlays()` / `request()` helpers  | D4 Step 3 (**typecheck**, not vitest)                                         | Both helpers build a full snapshot/request literal; new required members make every one of the 32 cases a compile error | D4 Step 1 defaults `usage: false` / `dismissUsage` in the helpers               |
| `attention-focus-coordinator.test.ts:198` "only calls the 3 injected spies" | D4 (vitest)                                                                   | The order array grows to four entries once `usage: true` is in the snapshot                                             | D4 Step 1 replaces the test and retitles it to 4                                |
| `chrome-actions.test.tsx:111` `toHaveLength(actions.length)`                | D5 Step 3 (vitest)                                                            | A 7th button in the DOM against a 6-row table                                                                           | D5 Step 1 adds the row — the count then matches again                           |
| `chrome-actions.test.tsx` `mount()`                                         | D5 Step 3 (**typecheck**)                                                     | `usageOpen` / `onToggleUsage` become required `ChromeActionsProps`                                                      | D5 Step 1 adds both to the harness                                              |
| `tab-bar.test.tsx` `baseProps()`                                            | D5 Step 4 (**typecheck**)                                                     | Same, for `TabBarProps`                                                                                                 | D5 Step 1 adds both                                                             |
| `npm run build` — `app.tsx`'s two `ChromeActions`/`TabBar` prop sites       | D5 Step 3-4 → Step 5                                                          | `TS2741: Property 'usageOpen' is missing`                                                                               | D5 Step 5 fills **both** sites                                                  |
| `app.test.tsx` — the whole file                                             | D3 Step 1 (vitest)                                                            | An import of a not-yet-existing export fails module resolution, taking every describe in the file with it               | D3 Step 3                                                                       |

Two of these are **typecheck** reds that vitest stays green through
(`attention-focus-coordinator.test.ts`'s helpers, `chrome-actions.test.tsx`'s
`mount()`, `tab-bar.test.tsx`'s `baseProps()`). The Prompt Board plan's own
self-review recorded exactly this class of miss — `tsconfig.json` includes
`src`, so a test-file type error is a red `npm run build` while `npx vitest run`
passes. Do not treat a green vitest run as a completed step.

No test outside this table should change. If one does, stop and report it rather
than editing it — an unexpected red here means a coupling nobody planned for.

---

## Self-review

Run by the orchestrating session after assembling the four sections, against
the spec with fresh eyes.

### Spec coverage

| Spec section | Tasks |
| --- | --- |
| Goal — Claude Code + Codex, this machine, this user | A3, A4, A6, A7 |
| Non-goals — no per-pane attribution, no third agent, no network pricing refresh, Windows unverified | Enforced by omission; recorded in §0.5 and each section's Findings (d) |
| Wording discipline — never "machine-wide" / "all-time" | C4, C5 (copy), C8 (eye review) |
| Decision 1 — raw counts AND estimated USD, every figure labelled with the snapshot date | B3, C3, C5 |
| Decision 2 — aggregate for the whole user, not per pane | A7 (no PTY linkage anywhere), spec non-goal |
| Decision 3 — dedicated `UsageScreen`; three entry points | C6 (screen), D1/D2 (action + shortcut + menu), D5 (chrome button), D6 (Settings › agents row) |
| Decision 4 — breakdown by agent × model | B4 (`breakdownRows`), C5 |
| Decision 5 — Rust scanner + one command; USD in the frontend from a bundled snapshot | A8, B2, B3 |
| Decision 6 — reuse the community-converged rules, build no dependency on them | A3 (ccusage dedupe), A4 (delta semantics), B2 (LiteLLM data) |
| Decision 7 — DL forks: §11 generalizes, new read-only data-table § | C1 |
| Data sources › Claude Code — paths incl. `subagents/*.jsonl`, the six counters, last-wins dedupe | A3, A6 |
| Data sources › Codex — paths incl. `archived_sessions`, delta ingestion, cached-as-subset, fail-soft parser | A4, A6 |
| Aggregate schema — 15-min UTC × agent × model, six separate counters, tier-split fallback, source status, skipped count | A2, A7, B1 |
| Incremental scan and cache — atomic write, cacheVersion, contribution maps, the six scan rules, single-flight, spawn_blocking, line cap | A5, A7, A8 |
| Pricing — checked-in LiteLLM snapshot, per-counter rates, unknown model → "—", exact match only | B2, B3, B7 |
| Surface — three views, overlay coordination, `toggle-usage`, refresh-on-open + 5 s poll, stale note | C2–C7, D1, D3, D4 |
| Error handling and privacy — fail-soft per line, missing ≠ unreadable, counters-only contract, cache permissions | A3, A4, A7 (privacy docblock), C4 |
| Testing — the full Rust list, the TS list, the extended existing suites, eye review, performance sanity | Every task's test steps; C8 (eye review); D8 (gates + manual acceptance) |
| Assumptions and open items — bound the contribution map, Windows, experimental format, narrow window, OpenCode seam | §0.3 decision 2 (compaction), §0.5, A Findings (d), C Findings (d) |

**Gaps: none.** Every spec section maps to at least one task.

### Placeholder scan

`grep -nE "\bTBD\b|\bTODO\b|implement later|fill in details|Similar to Task|add appropriate error handling|handle edge cases"` over all four sections returns nothing.

### Type consistency

Every cross-section name was grepped across all four sections. The frozen
§0.2.3 / §0.2.5 identifiers — `UsageSnapshot`, `UsageBucket`, `UsageCounters`,
`UsageSource`, `UsageAgent`, `UsageSourceState`, `EMPTY_USAGE_SNAPSHOT`,
`addCounters`, `totalTokens`, `estimateCostUsd`, `formatUsd`, `isPricedModel`,
`PRICING_SNAPSHOT`, `PRICING_SNAPSHOT_DATE`, `localDayKey`, `agentTotals`,
`dailyRows`, `breakdownRows`, `AgentTotal`, `DailyRow`, `BreakdownRow`,
`unpricedModels`, `UsageClient`, `defaultUsageClient`, `usageSnapshot`,
`usageStale`, `usageLoading`, `startUsagePolling`, `stopUsagePolling`,
`UsageScreen`, `usageOpen`, `toggleUsagePanel`, `closeUsagePanel`,
`onToggleUsage`, `toggle-usage` — appear with identical spelling everywhere
they appear. No section renamed a contract name.

Three deliberate asymmetries, all correct:

1. Section C never calls `estimateCostUsd` directly; it consumes `costUsd` off
   the three row types, which is where B applies it. Only B tests the math.
2. Section C never imports `defaultUsageClient`; the store owns the client.
3. Section A knows none of the TS names, by construction — the serialization
   contract test in A2 is the only thing joining the two halves, which is
   exactly why it is mandatory.

### Deliberate deviations from the spec

1. **`usage-pricing.ts` is split in two** (§0.3 decision 1) — data and math in separate modules so the refresh script can rewrite a whole file.
2. **`src-tauri/src/usage.rs` is a directory module** (§0.3 decision 10) — the single file would have been ~1 500 lines against an 800-line ceiling.
3. **`estimateCostUsd` returns `0` for all-zero counters** (§0.3 decision 11) — without it `<synthetic>` blanks the Claude dollar column forever.
4. **Two rate fallbacks the spec does not name** (§0.3 decision 12).
5. **The contribution map is bounded by mtime age, not scan count** (§0.3 decision 2) — the spec required the plan to pick a bound and named scan count as one option; with a 5 s poll that option compacts a merely-paused session in seconds.
6. **Codex is parsed at `payload.info.total_token_usage`** (§0.4 erratum 1) — the spec's path does not exist in the real files.
7. **Section C keys the poll on `useEffect(..., [open])`, not `useSignalEffect`** — `useSignalEffect` takes no dependency array and would never see a prop change. The requirement it protects ("the screen never unmounts, so a mount-keyed effect polls forever") is satisfied by the `[open]` key with a cleanup, which is byte-for-byte what `SettingsScreen`'s own effects do.

### Execution note

Sections A and B are independent and run in parallel (Wave 1); C depends on B's
types (Wave 2); D depends on C's component (Wave 3). §0.6 fixes file ownership
and forbids section subagents from running git at all. §0.5's first bullet is
the one to read before starting: another session is committing to this checkout
concurrently, and its files overlap Section D's.
