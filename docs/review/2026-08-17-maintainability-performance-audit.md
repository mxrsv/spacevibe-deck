# Review — maintainability and performance audit of the Electron host

Run 2026-08-17, 00:10–01:15 local, against **HEAD `878fce3` plus the uncommitted working
tree** (147 modified files, ~40 untracked). The working tree is the subject: the 2026-08-16
large-file decomposition and the surfaces shipped over the preceding ten days live there and
not in any commit.

Five specialist agents ran in parallel over partitioned surfaces — architecture map, renderer
and bundle performance, main-process performance, TypeScript maintainability, silent-failure
hunt. Findings marked **[verified here]** were re-read against the file by the orchestrator
before being written down. Findings that survived only as hypotheses say so, and one reported
finding was **demoted** after re-reading (see the note at the end of Part 4).

> **The checkout is shared.** `AGENTS.md` was rewritten by another session at 00:23, mid-run,
> and `dist/` was rebuilt at 00:16. Every measurement carries the time it was taken; re-measure
> before acting on a number.

## Baselines

| Gate                                | Result                                               |
| ----------------------------------- | ---------------------------------------------------- |
| `npx tsc --noEmit`                  | clean (exit 0), 00:10                                |
| `npx tsc -p tsconfig.electron.json` | clean (exit 0), 00:11                                |
| `npm run generate:menu:check` (R3)  | clean (exit 0), 00:24                                |
| `npm test`                          | **RED — 40 files / 279 tests failed of 2877**, 00:13 |

**Benchmark conditions** for every main-process figure in Part 2: Node scripts replaying the
exact code paths against the owner's real data (`~/.claude` 2.4 GB / 2017 `.jsonl`; `~/.codex`
3.4 GB / 946 `.jsonl`; the real `usage-cache.json`, 3.65 MB / 2277 records), 12 cores, **load
average 28.68** — a machine already running many agent CLIs, i.e. the target workload.

---

# Part 1 — the four things worth stopping for

## P0-1 — the test suite is red, and one line of config explains 271 of the 279 failures

**[verified here — reproduced and fixed under a probe config]**

`npm test` at 00:13:21: `Test Files 40 failed | 209 passed (249)`,
`Tests 279 failed | 2598 passed (2877)`. 271 of those failures are the same error:

```
InvalidCharacterError: "[object Object]" did not match the QName production
```

**Root cause.** `@phosphor-icons/react@2.1.10` exports icons as React `forwardRef` **objects**.
Vitest externalizes `node_modules` dependencies, so `@preact/preset-vite`'s
`react → preact/compat` alias — which the Vite _build_ does apply — never reaches that package
under test. The icon arrives at Preact's `h()` as an object and jsdom is asked for
`document.createElement("[object Object]")`.

The same swap dragged React itself into the tree: `npm ls react` reports `react@19.2.8` and
`react-dom@19.2.8` installed purely as `@phosphor-icons/react`'s peers.

**Fix, verified.** Give Vitest its own config — or a `test` block in `vite.config.ts`:

```ts
test: {
  server: {
    deps: {
      inline: ["@phosphor-icons/react"];
    }
  }
}
```

Measured with exactly that at 00:17: **`Tests 8 failed | 2869 passed (2877)`**, 119 s.

**Why it matters beyond the number.** The icon swap landed 2026-08-16 with the suite already
red. Every claim since then that reads "verified by suite/build" is void, because the suite
could not have been green. Nothing else in this report can be regression-tested until this is
fixed, so it goes first.

## P0-2 — the renderer can no longer run on Tauri, and Tauri is still what a tag ships

**[verified here]**

- `src/host/bridge.ts:18-25` — the renderer's only door reads `globalThis.__deckHost` and
  **throws** `"Deck host bridge is unavailable"` when it is absent.
- `grep -rn "__deckHost" src electron src-tauri scripts index.html` — the sole injector is
  `electron/preload.ts:17`. `src-tauri/src/lib.rs` installs no `initialization_script`.
- `src-tauri/tauri.conf.json:9-10` — `beforeBuildCommand: "npm run build"`,
  `frontendDist: "../dist"`. The Tauri bundle ships this same renderer.
- `.github/workflows/release.yml:273-287` — the release job is still `tauri-apps/tauri-action@v1`.

**Consequence.** Tagging a release today produces a macOS/Windows app whose first host call
throws. Not "a parity gap" — a dead app on the only path that currently ships.

**Second-order.** `src/updater/tauri-updater-adapter.ts:21` returns `null` unconditionally —
`checkForUpdate` is a stub because Gate A has no Apple identity. So the shipping path is an app
that cannot talk to its host _and_ whose "Check for Updates" is wired to find nothing, against
`AGENTS.md`'s own "auto-update is a core requirement".

**Third-order.** No shipping module imports `@tauri-apps/*` any more. The nine `@tauri-apps/*`
entries in `dependencies` are dead weight, and every "renderer-only, so it reaches BOTH hosts"
claim in `AGENTS.md` and `docs/CONTEXT.md` is false wherever it appears.

**This is a fork.** Either declare the cutover and point the release workflow at Electron, or
restore a Tauri-side `__deckHost` shim so the frozen host keeps working until cutover. The
drift table needs a row saying the Tauri build is broken, not merely "unchanged".

## P0-3 — a corrupt or unreadable store file is silently replaced with defaults

**[verified here]**

`electron/store.ts:52-68` cannot tell "file does not exist" from "file is corrupt or
unreadable":

```ts
    } catch {
      this.data = {};
    }
```

The comment three lines above promises the opposite — _"Treat it as empty here but keep the
file — overwriting it would destroy whatever a user might still recover by hand."_ Two files
over, `electron/ipc/register-store.ts:75-79` seeds defaults into the now-empty map, and
`store.set` → `scheduleSave()` → with `autoSaveMs` of 0, `saveInBackground()` **immediately**
(`store.ts:117-121`).

**Failure scenario.** `settings.json` is truncated by a power loss, hand-edited to invalid
JSON, or briefly unreadable (EACCES on a mounted volume, EIO). Next launch: `load()` swallows
it, the defaults are seeded, and the file is overwritten within milliseconds of boot. Recovery
window per file — `settings.json` effectively zero, `session.json` ~1 s, `presets.json` and
`workspaces.json` until the user's next mutation.

The renderer's own guards never fire: `initPresets`'s `try/catch` and its
`console.warn("Failed to load presets, starting empty")` are unreachable, because the error was
already swallowed inside `JsonStore.load` and `store.get` simply resolves `undefined`. No
console line, no `store:write-failed` event, no `PersistErrorBar`. **Zero signal at every
layer.**

Note the contrast: the _write_ path is genuinely well built — atomic temp+rename, failure
reported through `onError` → `store:write-failed`, a documented reason for settling the write
chain on rejection. Only the _read_ path is blind.

**Fix.** Branch on the error in `JsonStore.load`: `ENOENT` is a fresh install; anything else
sets a `corrupt` flag that either refuses writes and emits `store:write-failed`, or renames the
file aside to `<name>.corrupt-<ts>` before the first write. Not an R4 seam.

## P0-4 — the quit-time journal flush is dead code, and an unrelated inverted default is all that stops it costing sessions

**[verified here — both halves]** Two findings from two different agents that only make sense
together. **Do not fix either one alone.**

### Half one — the flush provably never writes

`src/ui/app.tsx:571-579`, under a comment stating the opposite intent (_"Quitting persists the
journal so the next launch restores it"_):

```ts
        flush: async () => {
          suspendSessionJournal();
          await Promise.all([flushSettingsSave(), flushSessionJournal()]);
        },
```

`suspendSessionJournal()` sets `suspended = true` **and clears the armed timer**
(`session-journal.ts:294-300`). `flushSessionJournal()` then reads (`:307-316`):

```ts
if (timer !== null) {
  clearTimeout(timer);
  timer = null;
}
if (suspended || activeDeps === null) {
  return;
}
await writeNow(activeDeps);
```

It returns before writing, every time. `src/terminal/session-journal.test.ts:243`
("flushSessionJournal still respects suspension — no write while suspended") pins exactly the
behaviour that makes the quit flush dead, so the suite is green on it. The M1a reasoning in the
comment is sound — a pane-exit signal must not re-arm the debounce and clobber the flushed
record mid-teardown — the implementation just made the flush unreachable in the process.

### Half two — `autoSave: false` means "write on every set", which masks it

`src/host/store-host.ts:23` maps `autoSave: false` → `0`:

```ts
autoSave: typeof options?.autoSave === "number" ? options.autoSave : 0,
```

and main treats `0` as _immediate_, not _off_ (`store.ts:117-121`), against its own JSDoc at
`store.ts:20` (_"0 disables autosave"_) and the facade's (_"false for explicit saves only"_).
**All eight renderer stores pass `autoSave: false`.** So every `store_set` is write-through:
`session.json` is already current on disk by the time quit runs, and `stores.saveAll()`
re-writes an identical file.

### What this actually costs today, and the trap

The real loss window is bounded to the debounce: a tab opened, closed or switched **within 1 s
of ⌘Q** never reaches `writeNow`, so no `store.set` happened, so nothing was written — suspend
cancels the timer and flush refuses. Up to one second of tab changes, silently.

The trap is the interaction: **if `autoSave: 0` is "corrected" to mean explicit-saves-only
without fixing the flush ordering first, session-journal data starts being lost on every
quit.** Fix the renderer ordering first, or fix both in one change.

**Fix.** A `force` path on `flushSessionJournal` that calls `writeNow` regardless of
`suspended`, keeping the suspend-first ordering; then make `autoSaveMs: 0` genuinely mean
explicit-saves-only with write-through as an opt-in. **R4 seam (close/quit coordination) —
owner approval.**

---

# Part 2 — main-process stalls (measured)

Two failure classes, kept separate, because they read very differently:

- **Event-loop stalls** — the main process is genuinely frozen and no PTY byte reaches any
  renderer for the duration.
- **Child-process pressure** — the loop is _not_ blocked; the cost is fork pressure, latency
  and staleness. Calling these a freeze would be wrong.

## M-1 (stall) — the usage poll does ~78 ms of unyielded synchronous work every 5 s, plus a synchronous 3.65 MB write

`electron/usage/scan.ts:292` opens with two fully synchronous directory walks that never yield.
`discoverClaude` (`electron/usage/discover.ts:197`) calls `pushTranscripts` (`:140`) then
`childDirs` (`:167`) on the same directory, so each project is `readdirSync`'d **twice** and
every `.jsonl` is `lstat`'d twice per poll — **≈3,800 `lstatSync` + 370 `readdirSync` per
poll**, ~50 ms warm and ~480 ms cold, in one uninterrupted block.

Then the change detector serialises the whole parsed corpus (`scan.ts:238`):

```ts
function recordsEqual(left, right) {
  return (
    JSON.stringify({ ...left, entries: [...left.entries] }) ===
    JSON.stringify({ ...right, entries: [...right.entries] })
  );
}
```

Against the real cache: `cloneRecord ×2277` 3.1 ms, `filesEqual` (stringify every record
**twice**) 14.1 ms, `aggregateBuckets` 10.7 ms, `writeCache` serialize 10.4 ms → 3.65 MB.

**Cost.** Per 5 s tick while the usage panel is open: ~78 ms of contiguous frozen main process,
plus a synchronous `writeFileSync` of 3.65 MB whenever anything grew — which is every poll
while an agent is writing. ~1.6 % duty cycle of hard freeze at rest, in blocks long enough to
read as terminal stutter across every pane in every window. Cold, the discovery block alone is
~480 ms.

(The known `subagents/` gap surfaces here as 1537 files discovered against 2017 on disk —
**~24 % of the corpus invisible**. Quantified, not re-reported as new.)

**Fix — three independent one-file changes, none touching an R4 seam.**
`readdirSync(dir, { withFileTypes: true })` and merge the two passes (`Dirent.isFile()` derives
from `d_type`, which does not follow symlinks — identical semantics, minus ~3,800 syscalls);
replace `filesEqual` with a boolean accumulated inside `scanInto`, which already knows whether
a record came off the warm path; make `writeCache` async (atomicity comes from the rename, not
from the write being synchronous).

## M-2 (stall) — boot `resume_lookup` blocks the main process ~510 ms, at the worst possible moment

`electron/ipc/register-services.ts:39` handles it fully synchronously inside `ipcMain.handle`.
Measured: claude `list 100.2 ms + read/parse 300 heads 216.5 ms` (16.8 MB, 5507 `JSON.parse`);
codex `walk 55.1 ms + 141.3 ms` (16.7 MB, 7768 parses); agy 17.2 ms. A restore covering Claude
and Codex panes is **~513 ms of frozen main process**, during boot restore, concurrently with
PTY spawns and first paint.

The `agy` path is the sharper edge: `MAX_FILES = 300` × `HEAD_BYTES = 512 KB`, and
`agy.ts:83` turns every head into a latin1 JS string retained in the candidate array —
**up to 150 MB read and 150 MB of live strings at the cap**. This machine has 31 `.pb` files
(11.3 MB), so it is a latent cliff, not a current one. `headBytes` also `Buffer.alloc`s the
full 512 KB even for a 40 KB file.

**Fix.** Make the handler async and `await setImmediate` every N files inside each scanner —
the batching pattern `scanInto` already uses. For agy, cut `HEAD_BYTES` (the cwd write lives
near the start of the protobuf) or run containment with `Buffer.includes` instead of
materialising a string; `Buffer.allocUnsafe` + `subarray(0, read)`. Not an R4 seam.

## M-3 (fork pressure) — `detect_agents` spawns an interactive login shell, takes 2.3–3.7 s, is uncached, and silently truncates at its own timeout

`electron/agents.ts:169` runs `$SHELL -ilc "command -v …"` with `DETECT_TIMEOUT_MS = 3000`.
Four consecutive real runs: **3107 ms → 0 lines, 3695 ms → 1 line, 3013 ms → 2 lines,
2269 ms → 6 lines.** Three of four hit the timeout and returned a **partial** list, and
`detectAgentsSafely` cannot tell that apart from "these are the agents you have" — `execFile`'s
timeout kills the child and the parser reads whatever stdout arrived.

Three renderer call sites invoke it independently with no main-side cache and no single-flight:
`src/ui/app.tsx:723`, `src/terminal/tab-manager.ts:864`, `src/open-board/open-board.tsx:112`.
`AGENTS.md` records that the open path deliberately **awaits** this probe.

**Cost.** Boot forks up to three concurrent interactive login shells (each sourcing `.zshrc`,
p10k, nvm…), and the open board waits ~3 s. Under load the timeout produces silent
under-detection — the exact "picker collapses to Shell only" failure the `-ilc` choice exists
to prevent. This is the same defect as **S-5** in Part 4, seen from the main side.

**Fix.** Memoise in `electron/agents.ts`: one in-flight promise shared by all callers, cached
for the process or a long TTL invalidated on window focus. Separately, when the child was
killed by timeout, return a discriminated result so the renderer can retry rather than persist
a truncated list. Smallest diff in this report for its size of win. Not an R4 seam.

## M-4 (fork pressure) — the process-table poll is per-window, dedup'd only while in flight, and never pauses

`electron/pty/info.ts:124` deduplicates only while a read is _in flight_; once it settles the
next caller forks again, and each `pty_info` additionally schedules an `lsof`
(`platform/macos.ts:185`). The renderer poller starts in `TabManager.init`
(`tab-manager.ts:1890`) and stops only in `dispose()` (`:1951`) — **not gated on window
visibility, focus, or app foreground state**.

One `ps -A -o pid=,pgid=,tpgid=,tty=,args=` through `execFile`, 8 samples at load avg 28.68:
**median 796.6 ms, max 2250.5 ms** (676 rows, 153 KB stdout). `lsof` 44–89 ms.

**Cost.** Two child processes per window per 2 s, forever, including minimised and background
windows. The loop is not blocked — but a single `ps` frequently **exceeds the 2 s poll
interval**, so classification runs permanently stale and the coalescing loop drains
continuously. The in-repo comment cites 69 ms for 717 rows; that is an idle-machine figure and
does not hold under the workload Deck exists for.

**Fix.** A short TTL cache (~500–800 ms) inside `createPtyInfoReader` so concurrent windows
share one reading, plus stopping the poller when the window is hidden or blurred.
**Decide this first:** `censusOrDeny` (`electron/main.ts:300`) reads through the same entry
point and its answer decides whether panes are killed on close/quit — keep the TTL well under
2 s, or have the census bypass the cache. `killAll` calls `readProcessTable` directly and is
unaffected. **Close/quit coordination — owner approval.**

## M-5 — on quit, the store flush is serialised behind a `ps` fork, and every pane is SIGKILLed before anything is persisted

`electron/main.ts:358-366`:

```ts
void pty
  .killAll()
  .then(() => stores.saveAll())
  .finally(() => app.exit(0));
```

`killAll()` awaits `readProcessTable()` before it signals anything — the same fork measured at
0.2–2.25 s above. So ⌘Q makes the user wait out a `ps` fork, and `settings.json` /
`session.json` / `workspaces.json` are flushed only _after_ every shell has been SIGKILLed. The
two are independent; `saveAll` does not need the PTYs dead. And `.then()` on a rejected chain is
skipped while `.finally()` still runs, so a rejecting `killAll` exits with `saveAll()` never
called — `PtyManager.terminate` wraps only `session.pty.kill()` in a try, leaving
`foregroundProcess(…)` and `terminateProcessGroups(…)` unguarded (`pty/manager.ts:120-135`).
The no-answerable-window path (`main.ts:501`, ⌘Q from the dock with all windows closed) has no
flush at all.

**Also here:** `confirmCloseWindow` (`main.ts:378-381`) calls `pty.terminate(paneId)` per pane
with no `rows` argument, so `foregroundProcess([], …)` returns null and the foreground group is
never SIGHUPed — only the shell's own group is SIGKILLed. That is the documented degradation at
`manager.ts:110-116`, but it means **window-close is strictly weaker than quit at killing
TUIs**. One `await readProcessTable()` for the batch restores parity at the cost of one fork.

**Fix.** `Promise.allSettled([pty.killAll(), stores.saveAll()])` then `app.exit(0)`.
**R4 (close/quit coordination) — owner approval.**

## M-6 (stall) — `stat_files` does 1,024 synchronous `realpathSync` calls on window focus

This is the direct answer to "does the bounded-realpath fix hold on every path?" — **it holds in
`listDir` and nowhere else.**

```ts
return Promise.all(paths.map(async (target) => {
  const resolved = resolveInsideRoot(root, target);   // read.ts:223 — SYNC, before any await
```

`resolveInsideRoot` performs **two** `realpathSync` calls (`path-guard.ts:108` and `:128`), and
because each map callback runs synchronously up to its first `await`, all of them execute
back-to-back before the loop turns. At `MAX_STAT_PATHS = 512` that is 1,024 blocking `realpath`
syscalls. Measured: `realpathSync(root)` 37.6 µs, `realpathSync(deep file)` 71.7 µs, `statSync`
3.1 µs → **the sync guard portion of `statFiles(512)` is 22.7 ms**.

**Cost.** ~23 ms of frozen main process on every window focus and every tab activation (the
spec §5 reconcile path), warm; worse cold or on a network volume.

**Fix.** Resolve the root **once** per call and pass it down — exactly what `listDir` already
does at `read.ts:148` — and move per-target resolution to `fs.promises.realpath` behind the same
`mapWithConcurrencyLimit` helper. Removes 512 of the 1,024 calls outright and yields on the
rest. Not an R4 seam.

## M-7 (hypothesis) — `fs:changed` has no storm control

The 40 ms debounce at `electron/fs/watch.ts:200` is **per target path, not per window**. Each
flush does two sync `realpathSync` + `statSync` + one `webContents.send`, and `onEvent` (`:211`)
admits any entry of a watched directory — so N files changing in one expanded directory produces
N timers, N × ~150 µs of synchronous guard work, and N separate IPC messages.

A `git checkout` or a build touching 5,000 files inside an expanded directory would be roughly
0.75 s of synchronous guard work sprayed across 40 ms windows plus 5,000 IPC messages. **The
per-call cost is measured; the event volume is not.** The check that settles it: `watch_paths` a
directory, touch 10,000 files, count `fs:changed` messages and main-process frame time — not run,
because it writes into the repo tree.

Related: `MAX_WATCH_DIRECTORIES = 256` / `MAX_WATCH_FILES = 2048` (`watch.ts:39-40`) bound the
two _input_ lists, but `replace` opens a watcher per distinct parent, so the derived fd count can
reach 256 + 2048 for one window. Worth a cap on `wanted.size` before the `io.watch` loop.

## M-8 — smaller main-process items

- **`foregroundProcess` runs twice per pane per reading** (`pty/info.ts:186` and `:70`), each
  opening with a fresh `rows.filter` over ~676 rows (`macos.ts:148`), plus a `rows.find` per
  pane. At 20 panes: ~27k comparisons and 40 array allocations per poll instead of 13k and 20.
  Sub-millisecond, but free to remove with one `Map<tty, PsRow[]>` and one `Map<pid, PsRow>`.
- **The shell-integration parser re-encodes every byte the PTY already decoded**
  (`shell-integration.ts:43`): raw bytes → `TextDecoder` → string → `Buffer.from(string, "utf8")`
  → bytes → OSC scan. Measured at 22 µs vs 11 µs per 64 KB batch — roughly half the per-batch
  CPU on the hottest path in the app, but only **89 ms of CPU for 250 MB of output**. A
  micro-optimisation, not a hot spot. **R4 (PTY ownership) — recommendation is to leave it
  unless the seam is being opened for another reason.**
- **`browser_set_bounds` fires once per `ResizeObserver` callback, unthrottled**
  (`browser-panel.tsx:97`) — one IPC round-trip plus one native `setBounds` per frame during a
  window or panel drag. Coalesce into one `requestAnimationFrame` and skip unchanged rectangles.
- **Native menu rebuilt on every window focus** (`main.ts:192-198` → `menu-state.ts:83`),
  including app-switching back to Deck; only the move-pane submenu depends on focus order.
- **`resolve_paths` is fully sync per hovered terminal line** — `MAX_PATHS = 64` ×
  (`realpathSync` + `statSync`) ≈ 5 ms sync per hover (`links.ts:104`, `:82`).
- **`loadCache` parses 3.65 MB synchronously on first snapshot** — 14.9 ms, once per process.
- **Worst single-file cold ingest is bounded**: the largest transcript on disk is a 90 MB Codex
  rollout, and a full `readLines` + `JSON.parse` pass over it measures **94 ms** (2,920 lines).
  Checked specifically to avoid overstating the cold-scan risk.

---

# Part 3 — packaging and renderer cost

## R-1 — the packaged app carries ~134 MB of `node_modules` it never loads

**[verified here — measured twice, independently]** on `dist-electron-app/mac-arm64/Deck
Electron.app` (packaged 2026-08-16 23:40):

| Thing                                 | Size                                         |
| ------------------------------------- | -------------------------------------------- |
| app bundle                            | 419 MB                                       |
| `Contents/Resources`                  | 144 MB                                       |
| `app.asar`                            | **148 MB** (141 MB of entries by header sum) |
| what Vite actually produces (`dist/`) | 4.1 MB                                       |

Parsing the asar header and summing per-package bytes gives **8696 entries, 8544 of them under
`node_modules`**: `monaco-editor` 92.6 MB, `@phosphor-icons/react` 15.9 MB, `three` 14.5 MB,
`@xterm/xterm` 5.6 MB, **`dist` 3.9 MB — the actual renderer**, `node-pty` 2.3 MB, `preact`
1.2 MB, `marked` 0.9 MB, **`dist-electron` 0.8 MB — the actual main process**, `dompurify`
0.6 MB, `@tauri-apps/api` 0.4 MB, `ogl` 0.3 MB.

`electron-builder.yml:31-36` names only `dist/**`, `dist-electron/**` and `package.json`, but
electron-builder collects production `dependencies`' `node_modules` implicitly regardless.
Proof that none of it is needed — every bare `require()` in the compiled main process:

```
electron, node-pty, node:child_process, node:fs, node:fs/promises,
node:http, node:os, node:path
```

`node-pty` is the only `node_modules` entry the runtime touches. The renderer reaches
monaco/xterm/phosphor/preact **only through Vite's already-bundled `dist/`**; `three`, `ogl`,
`marked`, `dompurify` and every `@tauri-apps/*` package are not reachable from `src/` at all.

**Fix — two options, both forks.** Moving renderer-only packages to `devDependencies` is the
robust one (electron-builder never packs devDeps), keeping `node-pty` in `dependencies` because
`asarUnpack` needs it there. A `files:` exclusion (`!node_modules/**` plus
`node_modules/node-pty/**`) is the smaller diff but depends on electron-builder honouring the
negation for implicitly-collected deps — verify by repacking and re-measuring.
**`AGENTS.md` lists bundle and dependency configuration as a stop-and-ask fork.**

## R-2 — a 2-second full-app re-render heartbeat at complete idle

**[verified here]** — the largest runtime finding on the renderer side.

`src/terminal/pane-info-poller.ts:4` sets `DEFAULT_INTERVAL_MS = 2000`. Its `onUpdate` ends with
an unconditional call (`src/terminal/tab-manager.ts:1164-1181`):

```ts
for (const info of infos) {
  /* tracker.noteProcess … */
}
syncViews(); // <- always, even when nothing changed
```

`syncViews()` (`tab-manager.ts:225-305`) then replaces two signals with **fresh object
identities every time**: `tabViews.value = tabs.map(…)` at `:226` and
`statusInfo.value = { … }` at `:295`. Signals dedupe by identity, so both notify
unconditionally. (`activeTabIndex.value = active` is a primitive and does dedupe — those two are
the problem.) Subscribers that therefore re-render every 2 s, forever, with no user activity and
no terminal output:

- `AgentRail` (`agent-rail.tsx:369, 382-392`) — and its render body calls `buildAgentRail(…)`
  from scratch: repository grouping, `sortByOpenOrder` + `sortClusters`, per-pane projection,
  plus fresh `new Set(Object.keys(sessionArchive.value))` and `workspacesData.value.recents.map(…)`.
- `TabStrip` (`tab-strip.tsx:100-128`) — `activeRepositoryTabIndexes` + `mergeStripOrder` re-run.
- `App` itself — `promptsUnavailable()` (`app.tsx:1022`) reads `tabViews.value` and is called at
  `:1086` and `:1118` in the render body, so App re-renders its whole 1425-line tree.
- The session-journal effect re-arms; 1 s later `writeNow` runs `captureSession()` plus a
  `JSON.stringify` fingerprint. The fingerprint early-return means **no disk write** — but the
  capture and stringify run every cycle.

**Fix.** Make `onUpdate` change-detecting, and independently guard the two assignments in
`syncViews` with a shallow structural compare so a no-op sync cannot notify. **R4 seam (tab
materialization) — needs a plan.**

## R-3 — dragging a panel edge re-renders the entire App tree on every pointermove

**[verified here]** Both live-drag signals are read **in App's render body** —
`sidebarPaintWidth()` at `app.tsx:858-862` and `dockWidth()` at `:1007-1008` — and used as props
at `:1137`, `:1249` and `:1329`.

The fix already exists nine lines away: `applySidebarShell` (`app.tsx:867-876`) writes the width
to `:root` inside a `useSignalEffect` **precisely to avoid this**, per the documented
`DesktopChrome`-root-props defect. The prop path defeats it — the signal is still read during
render, so every pointermove re-renders `App` → `AgentRail` (full `buildAgentRail` recompute) →
`TabStrip` → `DeckToolbar` → `DockPanel`. A 60 Hz drag becomes 60 full-tree re-renders per
second. Cost magnitude is inferred; nobody frame-profiled a live drag.

**Fix.** Route `--dock-w` through the same `:root` effect, and read the persisted setting for the
prop while the CSS var carries the live value. Renderer-only, no R4 seam.

## R-4 — first paint waits on roughly five sequential IPC round trips

`src/main.tsx:19-45` is strictly serial before `render()`: `desktop_environment` →
`windowBootMode()` → `initSettings()` (itself `store_load` + `store_get`) →
`listenStoreWriteFailures()` → then a `Promise.all` batch that is two hops deep per store. Every
`Store` method is its own `invoke` (`store-host.ts:19-41`).

`listenStoreWriteFailures()` is a pure listener install with no reason to be in the serial chain,
and `windowBootMode()` and `initSettings()` are independent. Related: `readWindowRecords`
(`session-journal.ts:108-122`) issues one **serial** `store.get` per registered window label.

Deliberate and correctly excluded: the awaited `loadCustomThemes()` (avoids a fallback-theme
flash) and the `detect_agents` await on the open-board path — the latter is not on this critical
path, it fires from a `useSignalEffect` when the picker opens. Note that the main process itself
is lean: `app.whenReady()` awaits exactly one thing, `settings.json`, before the first window.

## R-5 — there is no memoization layer anywhere in the renderer

**[verified here — grep]** `computed(` appears **0 times** in `src/` outside tests and gallery.
`useMemo` appears **once**, at `src/ui/controls/font-row.tsx:51`.

Every derived projection is recomputed in a render body: `buildAgentRail`
(`agent-rail.tsx:382`), `mergeStripOrder` + `activeRepositoryTabIndexes` (`tab-strip.tsx:103-128`),
`quickPickerDestinations()` (`app.tsx:749`), `stripSlots()` (`tab-manager.ts:1191`). This is the
structural reason R-2 and R-3 cost what they cost: a single signal write is always a full
recompute of everything downstream.

**Fix.** Start with the two hottest. `buildAgentRail`'s input assembly can be a module-level
`computed()`; what makes it uncacheable today is the `now: Date.now()` argument, so give it a
coarser clock signal that ticks on the minute. Memoize `mergeStripOrder` on the open-order key.

## R-6 — smaller renderer items

- **`SettingsScreen` is fully mounted and re-rendering while closed** (`app.tsx:1416`). It only
  toggles a class; the closed state is `opacity: 0; visibility: hidden`. The default category is
  `appearance`, so `ThemeGallery` keeps one `ThemeCardPreview` per installed theme in the DOM,
  re-rendering on every `settings.value` write, for a screen nobody opened. Keep the `<aside>`
  shell so the 220 ms fade survives, render `<Section />` only after a sticky `hasOpened` flag.
- **Every tab switch calls `fit()` on every pane, and the ResizeObserver fires again behind it**
  (`terminal-manager.ts:627-634`, `pane.ts:278-306`) — eight synchronous layout measurements plus
  up to eight debounced repeats when switching between two 4-pane tabs; on hide the observer
  fires at size 0 and `fitAddon.fit()` throws into an empty catch. **R4 (layout/PTY resize).**
- **Per-PTY-chunk overhead.** `agent-attention.ts:277` compares by `JSON.stringify`-ing both
  sides even when `candidate` _is_ `prev` by reference — **480 ns vs 1.82 ns** for a reference
  check, on the most common path. `tab-manager.ts:1764` calls
  `tabs.find(t => t.manager.paneIds().includes(id))` and `paneIds()` allocates fresh arrays via a
  recursive spread (**214 ns** on a 4-pane tree). The 3200 ms resync timer is re-armed on every
  chunk. Honest sizing: low single-digit microseconds per chunk — the real amplifier is that any
  tracker change routes into `syncViews()` (R-2). **R4 (PTY data path).**
- **`writeNow` costs 4–5 IPC round trips per journal write** because `registerLabel`
  (`session-journal.ts:88-94`) re-reads the label registry on every write, forever, for a label
  that never changes.
- **`getBoundingClientRect()` on every mousemove, per pane** (`pane.ts:264-270`).
- **Popover transitions animate `left`, `top`, `width`, `height`** (`styles/08-popovers.css:109`)
  — the only layout-triggering transition in all 16 style partials.
- **`activityResync` timers are not cleared when a pane closes** (`tab-manager.ts:1808-1833`) —
  bounded at 3.2 s and not a leak, but each closed pane costs one wasted full re-render.
  **R4 (close coordination).**
- **`scrollback: 10_000` per pane, retained for every hidden tab** (`settings-schema.ts:146`).
  Hypothesis only — xterm allocates buffer lines lazily. The settling check is a heap snapshot
  under `electron:dev` with several panes filled, which nobody ran (headed `electron:dev` writes
  the owner's real `workspaces.json` unless a wrapper sets `userData` first).

---

# Part 4 — silent failures

P0-3 and P0-4 came from this pass. These are the rest, in order of user harm.

**S-1 — the quit guard confirms quit after a failed flush, console-only.**
`src/lib/quit-guard.ts:106-111` catches, `console.warn`s, and calls `deps.confirm(…)` anyway.
`reportPersistError` fires inside the journal's own catch but the app is exiting, so
`PersistErrorBar` never paints. Disk full or a read-only volume loses the last settings change
with no word to the user. **R4-adjacent.**

**S-2 — a failed ⌘S is reported only to the devtools console.**
`src/files/file-surface-controller.ts:457-463` — `console.error`, then the file stays dirty
(deliberately, so the guard keeps asking). The concrete harm in this app is not total loss — the
dirty dot and the quit census still guard that — it is that **the agent in the next pane reads
the stale file on disk** while the user believes the save landed. Two lines: `reportPersistError`
already exists and `session-journal.ts:246` already uses this exact pattern.

**S-3 — one rejected `resume_lookup` or `dirs_exist` aborts the whole boot restore.**
`src/terminal/session-restore.ts:249-259` awaits both unguarded; a rejection lands in the outer
catch at `:379-381`, `materializeAll` never runs, and the user boots into an empty Deck with
every tab gone and only a console line to explain it. The correct degrade is already half-built:
`paneCommandsFor` handles a `null` ref by returning the bare agent command, so an all-null refs
map would still restore the tabs, just without resume. Note this is the same handler M-2 measures
at ~513 ms of synchronous work — a slow path and an unguarded one. Related in the same file:
`checkLiveness` does `alive[index] ?? false`, so a `dirsExist` reply shorter than the request
silently marks the tail dead and **drops those tabs**. **R4 (tab materialization).**

**S-4 — agent detection failing is indistinguishable from "no agents installed".**
`electron/agents.ts:166-176` discards the error object entirely, covering both spawn failure and
the 3 s timeout, and logs nothing in main. The board's catch degrades to `[]`, and
`resolveAgentChoice` (`src/lib/workspace-recents.ts:163-174`) turns an empty list into `null` → a
bare Shell. **This is not the documented decision** — `AGENTS.md` and `open-board.tsx:154-161`
describe _binary-left-$PATH → first detected agent_; this is _probe failed → no agent at all_,
and the comment at `open-board.tsx:93-101` claims awaiting the probe fixed exactly this case.
Awaiting a probe that **resolves** to empty produces the identical outcome. M-3 measures how
often that happens: three runs in four, on a loaded machine.

**S-5 — a transient `stat` failure tells the user their file was deleted.**
`electron/fs/read.ts:235-237` turns any errno — EACCES, EIO, EMFILE — into `{ exists: false }`,
which `reconcile()` feeds straight into `applyChange({ kind: "deleted" })` → the "file deleted"
banner, or a "Save again / Close" prompt on a dirty buffer. Pairs badly with S-6: hit the
descriptor ceiling, alt-tab back, and the editor announces that files sitting right there on disk
are gone.

**S-6 — a watcher that fails to open is dropped silently.** `electron/fs/watch.ts:271-281`
catches with a comment naming one cause ("a directory that vanished between the listing and this
call") and handles all of them. `fs.watch` also throws `EMFILE`/`ENOSPC`, which are systemic:
past the ceiling **every** subsequent watch throws, `replace()` returns normally, and the
explorer simply stops noticing that the agent changed anything.

**S-7 — the dev-mode "IPC fails soft" convention leaks into the packaged app.**
`src/host/sessions-host.ts:24` returns `null` on any throw; its own header says `null` means
"this host does not have session history", so a real failure makes the session-history tab
silently disappear from the dock — reading as "this build doesn't have that feature". Same shape
at `src/browser/browser-store.ts:231`: `deactivateBrowserSurface` flips
`browserSurfaceActive.value = false` **before** the IPC and swallows a rejected `setVisible(false)`
into a `console.warn` — and the `WebContentsView` paints above every DOM layer, so a failed hide
leaves a web page covering the terminal grid while the renderer believes the browser is
off-stage. `src/host/worktree-host.ts` already shows the right pattern: check bridge presence
directly, and let a genuine rejection from a present host propagate.

### Demoted after re-reading — a documented decision, not a discovery

The resume matcher's null-cwd wildcard (`electron/resume/resolve.ts:74-82`) was reported as a
bug: a candidate session with `cwd: null` matches _every_ pane, so a project-B transcript with an
unreadable cwd and a closer mtime can outrank project-A's own and get typed into the pane as
`claude --resume <project-B-id>`. The failure mode is real. But `resolve.ts:64-72` documents the
wildcard explicitly and gives its reason — claude/codex/opencode transcripts genuinely carry null
cwds, and `agy` is routed to a stricter matcher precisely because its nulls mean something
different. **Treat this as a decision to re-examine (rank exact-cwd matches strictly above
wildcards rather than by mtime distance), not as an undiscovered defect.**

---

# Part 5 — the architecture map

`electron/` is in materially better shape than `src/`. Nothing in it has fan-out above 22, and
everything is wired through explicit deps objects rather than module singletons.

**One emission point.** A grep for `\.send\(` across `electron/` returns exactly one production
hit: `main.ts:99`. Every main→renderer event funnels through `emitTo`, injected as a dependency
into `BrowserPanels`, `menu-state`, `settings-ipc` and `register-store`. The single exception is
the grab side-channel.

**Two preloads, deliberately distinct.** `electron/preload.ts` exposes `__deckHost` with exactly
three members. `electron/browser-preload.ts` — which runs beside pages Deck did not write —
**exposes nothing**: no `contextBridge`, no global, just a grab forwarder behind a 3 s
trusted-gesture window and a 250 ms rate floor, with a second rate gate behind it at
`browser/view.ts:43` and a bounded parser at `browser/inject.ts:275-301`. This is the
best-defended boundary in the codebase.

**58 IPC channels**, every one with a renderer caller except `scan_workspace_favicon`.

### What the contract tests actually guard

`scripts/electron-ipc-contract.test.ts` (R6) asserts that every **destructured** payload key in a
handler is sent by the caller, that every invoked channel has some handler, and pins two
fixtures. Its gaps, read directly from the regexes:

1. **Handlers that take the payload whole are skipped entirely for key checking** — including
   `open_pane_window`, **the exact channel whose flat-vs-wrapped mismatch shipped on Tauri and
   motivated this test**. `main.ts:423-425` even comments that it reads keys off the object "so
   the contract test does not read them as required." The test's founding bug class is now
   outside its own key check.
2. Non-literal channel names on either side are invisible — a call through a constant vanishes.
3. Non-object-literal payloads are unparsed (`browser_set_bounds`, `dialog_open`,
   `notification_send`); spread keys are filtered out, so `dialog_ask`'s `{ message, ...options }`
   reads as `{message}` only.
4. Nested braces break key parsing.
5. **No dead-channel assertion** — which is why `scan_workspace_favicon` survives green.
6. Extra keys sent but not destructured are not flagged. No types are checked at all.
7. **Events are entirely outside it.** `electron/wire-contract.test.ts` covers 4 event shapes plus
   3 security greps; **13+ event payloads are unguarded**, including all three `pty:*`,
   `transfer:settled`, `quit-requested`, `window:close-requested`, `settings:merged`, `fs:changed`
   and all three `browser:*`.
8. `src/gallery/**` is not excluded from call-site collection, so gallery stubs participate in the
   contract.

Two wire strings are also defined twice, outside `CHANNELS`: `"deck:browser-grab"`
(`browser-preload.ts:26` and `browser/inject.ts:28`) and `"transfer:settled"`
(`coordinator.ts:44` vs `channels.ts:105`). `"store:write-failed"` is hand-typed on both sides.

### Coupling

| Highest fan-in                   |     | Highest fan-out                    |     |
| -------------------------------- | --- | ---------------------------------- | --- |
| `src/ui/controls/deck-icon.tsx`  | 35  | `src/ui/app.tsx`                   | 81  |
| `src/settings/settings-store.ts` | 27  | `src/terminal/tab-manager.ts`      | 43  |
| `src/lib/process-info.ts`        | 27  | `src/terminal/terminal-manager.ts` | 19  |
| `src/chrome/events.ts`           | 23  | `src/terminal/pane.ts`             | 18  |
| `src/host/bridge.ts`             | 20  | `src/ui/agent-rail.tsx`            | 17  |

`app.tsx` at 81 imports and 1425 lines is the worst coupling point in the tree — it is
simultaneously the composition root, the overlay-policy owner, the surface mutual-exclusion
arbiter and the JSX tree. `deck-icon.tsx`'s 35 is benign. `settings-store` and `chrome/events` at
27 and 23 are ambient-singleton coupling: any module can flip a global signal, and `chrome/events`
in particular is written from 23 places with no ownership rule.

### R4 seam health

The inner terminal seam is **not** leaking: `pane.ts`, `pane-lifecycle.ts`, `layout-engine.ts` and
`close-coordinator.ts` have **zero** importers outside `src/terminal/`. The `SurfaceStrip` seam
holds — `tab-manager.ts` imports nothing from `src/files/`, and the textual assertion at
`file-surface-store.test.ts:49-77` was correctly widened to all four split files.

Three hazards worth naming:

- **A live TDZ hazard.** `syncViews` (defined `tab-manager.ts:225`) references `poller`, a `const`
  declared at `:1159`; `callbacks.onLayoutChange` (`:376`) does the same; the default `notifier`
  (`:167-173`) closes over `windowFocused`, declared at `:197`. These work only because nothing
  calls them before `init()`. Any reordering fails at **runtime** with a `ReferenceError`,
  invisible to `tsc`.
- `src/files/gate-m-main.tsx:24` imports `createTerminalManager` directly, bypassing `TabManager`
  — a second production entry into the pane layer (documented, but real).
- `src/terminal/session-restore.ts:31` imports `FileSurfaceController` from `src/files/`. Legal,
  but it sits inside `src/terminal/` and is outside the four-file scope of the seam test, so
  nothing guards it from widening.

---

# Part 6 — decomposition leftovers and drift

**Files still over the 800-line F8 ceiling** (`src/` + `electron/`, gallery excluded):

| File                               | Measured 00:20 | Plan §9 recorded |
| ---------------------------------- | -------------- | ---------------- |
| `src/terminal/tab-manager.ts`      | **1966**       | 1902             |
| `src/ui/app.tsx`                   | **1425**       | 1407             |
| `src/terminal/terminal-manager.ts` | **834**        | 764              |

The first two were excluded from the split on purpose as R4 seams. The third **regressed back
over the ceiling after the split**, on a checkout shared by concurrent sessions. No test file
remains over 800; `src/styles/` partials max at 651.

**No orphans and no runtime import cycles.** All 34 new files have importers, all three re-export
shims are type-only or one-way, and the one real value-cycle the plan predicted (`file-status`
re-exported from `file-surface-store`) is confirmed gone.

**But the `surface-strip.ts` extraction is half-realized.** Its stated highest-value justification
was that `file-surface-controller.ts` and `stage-surface-strip.ts` import `SurfaceStrip` _from
tab-manager_. They still do — `file-surface-controller.ts:12` and `stage-surface-strip.ts:22`.
Type-only, so zero runtime cost, but the R4 seam contract is still nominally owned by the
1966-line file.

**Dead and near-dead code.**

- `scan_workspace_favicon` — registered (`register-services.ts:77`), implemented
  (`electron/images.ts:73`), covered by four tests, called by nothing but the gallery stub.
- `src/ui/repository-rail.tsx` (435 lines) is shipping-dead, kept compiling only because
  `src/gallery/chrome-fixtures.tsx:2` imports it. That is the documented parked revert target and
  gallery→app is the legal direction under R7 — but it is 435 lines of unreachable product code
  held up by a dev-only surface.
- `electron/git.ts` (27 lines) sits beside `electron/git/` (a directory). Resolution is
  unambiguous today only because there is no `git/index.ts` — the collision is one file away from
  silently rerouting an import.

**Stale comments that assert the opposite of current behaviour** (D8 drift):

- Three separate "there is no session restore" comments, written before 2026-08-15:
  `tab-manager.ts:1888-1889`, `tab-manager.ts:1574-1587` (where it is the _justification_ for a
  load-bearing guard), and `file-surface-store.ts:14-17` (_"persisting file tabs would make them
  the only restored UI state"_ — file tabs are restored).
- `electron/ipc/channels.ts:58-61` — the explorer channels have "No renderer calls them yet". All
  six are called from `file-client.ts:75-90`; the explorer shipped 2026-08-14.
- `src/lib/strip-order.ts:15` anchors `SurfaceStrip.orderKey` to `../terminal/tab-manager.ts`; it
  lives in `surface-strip.ts` now.
- `settings-store.ts:119` cites `tab-manager.ts:1074-1084` — line numbers rotted by the split.
- `electron/store.ts:20` and `src/host/store-host.ts:12` both document `autoSave: false` /
  `autoSaveMs: 0` as "explicit saves only"; it means write-through (P0-4).
- Tauri-named modules under the Electron host: `createTauriSettingsSync` (`settings-store.ts:62`),
  `src/updater/tauri-updater-adapter.ts`, and `TabManagerDeps`' "the real Tauri transfer client"
  comments.

**Raw NUL bytes make three source files invisible to `grep -r`.** `LC_ALL=C grep -naP` finds the
byte embedded literally as a key separator at `electron/resume/head.ts:95`,
`electron/usage/scan.ts:387/415/419`, and `src/browser/grab-format.test.ts:35/65`. `grep`
classifies such a file as binary and returns **nothing**, with no warning — so every code search
over this repo, by a person or an agent, has a silent blind spot over the token-usage scanner's
hot path. This bit during the audit itself: one agent's greps over `electron/usage/` came back
empty and it had to fall back to `sed -n`. Writing the two-character escape sequence instead is
behaviour-identical.

---

# Part 7 — the eight real test failures, triaged

Measured with the P0-1 fix applied, so these are the residue rather than icon noise. Both
timeouts were re-run in isolation to separate genuine regressions from suite-load flakes.

| #   | Test                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/ui/settings/sections/agents-section.test.tsx:208`            | **Product bug.** Editing a custom agent's label does not persist — expected `"Aider fast"`, got `"Aider"`. `renameAgent` (`agents-section.tsx:95-109`) and `labelProblem` both read correctly, so the break is in the `CommitInput` blur→commit path. Needs a root-cause pass.                                                                                                                     |
| 2   | `src/ui/agent-rail-model.test.ts:420`                             | **Contract drift.** An unrecognised-agent row reports `state: "idle"`; the test expects `"resting"`. One of the two vocabularies is stale.                                                                                                                                                                                                                                                         |
| 3   | `src/terminal/tab-manager.tab-lifecycle.test.ts`                  | **Contract drift.** The pane projection gained an undeclared `hasRun: true` — a field added to an R4-seam projection without updating its contract test.                                                                                                                                                                                                                                           |
| 4   | `scripts/refresh-usage-pricing.test.ts`                           | **Broken gate.** The generator emits one-line objects; the checked-in `src/lib/usage-pricing-snapshot.ts` is Prettier-formatted, so the regeneration check can never pass and a pricing refresh cannot be verified. Run the generator's output through the same formatter.                                                                                                                         |
| 5   | `src/prompts/prompt-popover.test.tsx:342`                         | **Needs diagnosis.** `.cfg-custom--error` exists (`prompt-popover.tsx:428, :462`) and `CommitTextarea.commit` has no empty-string guard, so the validation path _should_ fire. Either the error renders outside the editing branch or the blur closes the editor first.                                                                                                                            |
| 6   | `src/open-board/open-board.views.test.tsx:258`                    | **Probably a test flake, not the bug it looks like.** The component does set the notice on a failed open (`open-board.tsx:187-192`) and `role="status"` is present (`open-board-home.tsx:215`). `openWorkspace` awaits the `detect_agents` probe before `onOpen`, so one `act()` flush is likely not enough — and M-3 shows that probe takes 2.3–3.7 s in reality. **Do not "fix" the component.** |
| 7   | `src/files/ui/file-tree-view.test.tsx:360` (10,000-row windowing) | **Slow test, not a regression.** Times out at 5000 ms under suite parallelism; passes in isolation in **2137 ms** — within 2.4× of the timeout, so it will keep flaking.                                                                                                                                                                                                                           |
| 8   | `src/terminal/search-bar.test.ts:299`                             | **Same shape.** Times out in the suite; passes in isolation in **999 ms**.                                                                                                                                                                                                                                                                                                                         |

Items 7 and 8 deserve their own note: the suite's slowest assertions sit close enough to
`testTimeout` that CI failures will not reproduce locally. Raise the timeout for those two files
or make the fixtures cheaper — not globally.

---

# Part 8 — verified good, so nobody re-audits it

**Main process.**

- **PTY batching, backpressure and exit ordering** (`electron/pty/stream.ts`,
  `electron/pty/manager.ts:174`). 64 KB batch cap, 512 KB queue ceiling with real
  `pty.pause()`/`resume()`, microtask coalescing, streaming `TextDecoder` across chunk boundaries,
  and flush-before-`pty:exit`-before-`unregister`. No `JSON.stringify` per chunk, no unbatched
  send, no scrollback retained in main, no listener left behind on pane close. The code most
  exposed to load, and it is right.
- **No broadcast of PTY output** — `WindowCoordinator.deliver` drops an unrouted event rather
  than fanning out (`coordinator.ts:199`).
- **Mass kill takes one process-table reading for the whole batch** (`pty/manager.ts:117`, `:147`)
  — the "eight panes, eight `ps` forks" bug is genuinely fixed.
- **Watcher lifecycle is leak-free** — `forgetWindow` closes watchers _and_ clears pending timers,
  wired to `window.on("closed")` (`main.ts:263`); `replace` diffs against the existing set, so a
  tree expand/collapse does not churn watchers.
- **`listDir`'s realpath pool holds its bound** — `MAX_REALPATH_CONCURRENCY = 32`, index-aligned
  results, root resolved once per call (`fs/read.ts:148`).
- **The usage stat pass is properly chunked** — `SCAN_BATCH_FILES = 8` with `setImmediate` between
  batches (`usage/scan.ts:193`) turns 241 ms of `statSync` into ~285 slices of <1 ms. The right
  pattern; it simply is not applied to `discoverClaude` or the resume scanners.
- **Usage polling is gated to the panel being open** with generation-guarded replies — it does not
  run at rest. (Contrast the pane-info poller, M-4, which does.)
- **Atomic writes everywhere** — one implementation (`fs/write.ts:52`), `O_CREAT|O_EXCL` temp with
  a unique name, mode preserved on the handle. No torn `session.json` or `usage-cache.json`.
- **react-grab injection is cached** — 386 KB is not re-read per navigation.
- **`validateCwdCandidates` is genuinely async and capped** at 8 probes per batch — the documented
  47 ms-per-batch freeze is closed.
- **Boot is lean** — `app.whenReady()` awaits exactly one thing, `settings.json`, before the first
  window. No theme scan, agent detection, usage warm or git scan before first paint.
- **`electron/quit-flow.ts`** is pure, allocation-light and correct; the quit problem is ordering
  in `main.ts`, not this file.

**Renderer and bundle.**

- **Monaco is fully lazy.** `src/files/editor-host.ts:228-266` is entirely dynamic; Vite honours it
  — `editor.api-*.js` is a separate 2,659,248-byte chunk (674 KB gzip) plus a 272 KB worker and 27
  per-language chunks, none in the main chunk, and `editor-host.test.ts:58` guards the specifier.
- **`three` and `ogl` never reach the shipping renderer** — their only import sites are
  `marketing/landing-prototype/src/{beams,aurora}.js`, built by a separate config.
- **`@tauri-apps/*` is not imported by the renderer at all** — zero static and zero dynamic
  imports; the matches under `src/host/` are doc comments.
- **`vite.config.ts` is sound.** No `manualChunks` needed; `minify: "terser"` carries a real,
  specific rationale (esbuild 0.25 mis-minifies xterm 6's `InputHandler.requestMode` enum, breaking
  OpenCode behind a blank pane); **no sourcemaps in the production build**.
- **Main renderer chunk: 863,502 B raw / 242,197 B gzip; CSS 87,769 B / 15,008 B gzip; `dist/`
  4.1 MB across 62 files.** Over `file://` there is no gzip, so 863 KB raw is what gets parsed at
  startup.
- **`@phosphor-icons/react` tree-shakes** — 32 source files import named icons and the built chunk
  carries no namespace marker.
- **CSS is in good shape.** `backdrop-filter` appears exactly once, at the sanctioned modal-scrim
  exception. No `transition: all` anywhere. The three infinite animations animate only
  `transform`/`opacity` and all sit behind `prefers-reduced-motion` guards.
- **The journal never serializes a terminal.** `captureSession` returns metadata only;
  `serializeScrollback` has exactly one production caller, on the detach path. A hypothesis going
  in, disproved.
- **The pane-info poller itself is well built** — one batched `ptyInfo(ids)` per cycle for all
  panes, overlapping polls coalesced, `git_branch` skipped on an unchanged cwd. Its only problems
  are what it calls at the end (R-2) and that it never pauses (M-4).
- **`pane.dispose()` (`pane.ts:388-401`) disposes everything it should.** No listener leak on pane
  close.
- **`tabs-store` has exactly one production writer** (`tab-manager.ts:226, 291, 295`), and tab
  ordering is genuinely clean: one window-wide clock (`lib/open-sequence.ts`), one pure merge
  (`lib/strip-order.ts`), both consumers walking the same merge.
- **The store write path** is atomic, serialises on settlement so one transient failure cannot
  poison the rest of the run, and reports failures through `store:write-failed`.

---

# Suggested order

1. **P0-1** — the vitest config line. Nothing else can be verified until the suite is usable.
2. **M-1** — the biggest repeated stall, three independent one-file fixes, no seam. Start with
   `withFileTypes` in `discover.ts` and deleting `filesEqual`.
3. **M-3 / S-4** — cache and single-flight in `electron/agents.ts`. Smallest diff in the report;
   removes ~3 s from the open path and closes a real silent-truncation correctness bug.
4. **P0-3** — the corrupt-store read path. No seam, bounded diff, prevents total config loss.
5. **M-2** and **M-6** — batch the resume scanners; hoist the root realpath in `statFiles`.
6. **P0-4 (both halves together)** — quit ordering and store semantics are coupled; fixing either
   alone is risky. **R4, owner approval.**
7. **P0-2** — the release-path decision. A fork; needs the owner, not a patch.
8. **R-1** — the packaging fix. Biggest single win, zero runtime risk, but a fork.
9. **R-2** — the idle heartbeat. Biggest renderer win; needs an R4 plan.
10. **M-4** and **M-5** — need the census/TTL question answered first. R4.
11. **R-4**, **S-2**, then **R-3**, **R-5**, and the rest of Parts 3 and 4.
12. **M-7** — run the 10k-file check before spending effort.

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention. This is a frozen milestone document; the
table records what this run could not settle.)_

| Claim                                                                                           | Intent     | Status     | Evidence                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| The packaging fix drops the asar as predicted                                                   | `decided`  | unverified | Not repacked in this run; 148 MB / 144 MB / 419 MB are measured, the post-fix size is not                        |
| Test failures 1, 5 and 6 are correctly attributed                                               | `building` | partial    | Each was read to a hypothesis, not to a root cause                                                               |
| R-2 and R-3's cost in frames                                                                    | `building` | unverified | Confirmed by reading code; no profiler was run and no live drag was frame-timed                                  |
| `scrollback: 10_000` memory cost                                                                | `building` | unverified | Hypothesis only — the settling check is a heap snapshot under `electron:dev`, which was not run                  |
| M-7 (`fs:changed` storm) volume                                                                 | `building` | unverified | Per-call guard cost is measured; the event volume is not. The 10k-file touch test writes into the repo tree      |
| Duplicated logic across the new surfaces; dead settings keys; type-safety erosion at boundaries | `building` | unverified | The maintainability agent had not reported when this document was written — **that surface is not covered here** |
| `electron/pty/{spawn,stream,session-store}.ts` internals                                        | `building` | partial    | Behaviour verified through `manager.ts`'s call sites and the healthy-list checks; the files were not read whole  |
| Windows behaviour of every finding above                                                        | `building` | unverified | macOS only (Gate C). `electron/platform/windows.ts` was not exercised                                            |
