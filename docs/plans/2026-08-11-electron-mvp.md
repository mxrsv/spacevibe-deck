# Electron MVP — Implementation Plan

**Status:** `building` — started and largely implemented 2026-08-11 on branch `electron-migration`. Phases 1-4 are done and verified; T18/T19 (manual pass, packaging) remain.

**Goal:** A working Electron build of Deck that runs the real app: multiple
panes with real PTYs, tabs, splits, presets, workspaces, settings, agent
detection, attention state, prompt board, links, shell integration, native
menu, and a clean quit with a busy-pane guard.

**Source spec:** [electron migration design](../specs/2026-08-11-electron-migration-design.md)
`decided` — approved 2026-08-11.

**Prep plan:** [electron migration prep](2026-08-11-electron-migration-prep.md) `current`.

## 0. Standing conditions

**0.1 The gate ordering is overridden.** The spec and the prep plan both say
this plan may only be authored after gates A, B and C conclude. The owner
directed otherwise on 2026-08-11. Gate A (no Apple identity) and Gate C (no
Windows machine) are still open, so **a Gate C abort can still make this whole
branch sunk cost**. Recorded in [`AGENTS.md`](../../AGENTS.md) In flight.

**0.2 Windows is a stub, not a port.** No Windows machine exists.
[`process_snapshot.rs`](../../src-tauri/src/platform/windows/process_snapshot.rs)
(682 LOC) and [`job_object.rs`](../../src-tauri/src/platform/windows/job_object.rs)
(428 LOC) are **not** ported. The Electron host ships a Windows platform module
that throws a named "Gate C unresolved" error. Porting untestable code would
manufacture confidence, and the abort criterion exists precisely for this.

**0.3 The renderer is not rewritten.** 19,654 lines of Preact are kept as-is.
The only renderer change permitted is swapping `@tauri-apps/*` imports for
`src/host/*` facades. Any behavioural change to a component is out of scope
and must be raised, not absorbed.

**0.4 Isolation.** All work happens in the `electron-migration` worktree at
`~/Documents/Development/spacevibe-deck-worktrees/electron-migration`. The
primary checkout stays ready for Tauri hotfixes and is never touched by this
plan except for docs.

**0.5 `pty_info` uses `ps`, not `node-pty`.** Evidence and reasoning are in
[`AGENTS.md`](../../AGENTS.md) In flight. `.process` returned `"2.1.227"` for a
real `claude` pane. One `ps -A` per poll tick, joined by tty → `tpgid` → `pgid`,
measured at 69 ms for 717 rows against a 2 s interval.

**0.6 Verification.** `npm test` and `npm run build` for the renderer;
`npm run test:main` for the host; a manual pass for anything crossing IPC. The
prep plan is explicit that a green suite proves little here, because the suite
mocks the host — the IPC contract test and the manual pass are what count.

## 1. Architecture

```
electron/
├─ main.ts              # app lifecycle, window creation, boot
├─ ipc/
│  ├─ registry.ts       #   one table of channel → handler, the contract source
│  └─ channels.ts       #   shared channel + event name constants
├─ pty/
│  ├─ session-store.ts  #   id → session, the PtyState equivalent
│  ├─ spawn.ts          #   spawn_shell: env, login shell, cwd resolve
│  └─ stream.ts         #   reader → batcher → emitter, backpressure
├─ platform/
│  ├─ index.ts          #   dispatch by process.platform
│  ├─ macos.ts          #   ps/argv0 inspection, killpg termination
│  └─ windows.ts        #   Gate C stub — throws by name
├─ shell-integration.ts  # OSC 133 / OSC 9;9 parser, ported 1:1
├─ coordinator.ts        # pane ownership, transfer transaction
├─ window-lifecycle.ts   # labels, MRU, boot mode, adoption
├─ quit-flow.ts          # quit census, single-flight
├─ links.ts              # path resolve + open editor
├─ prompt-assets.ts      # prompt board scanner
├─ images.ts             # data URL, 1 MB cap
├─ settings-merge.ts     # cross-window patch merge
├─ store.ts              # app-data JSON, the plugin-store equivalent
├─ menu.ts               # Menu.buildFromTemplate from the action registry
└─ preload.ts            # contextBridge — the only renderer surface

src/host/                # renderer-side facades (replaces @tauri-apps/*)
├─ invoke.ts            #   invoke + listen shims
├─ store-host.ts        #   Store class shim
├─ dialog-host.ts       #   ask / message / open
├─ window-host.ts       #   getCurrentWindow surface
├─ shell-host.ts        #   openUrl, clipboard, notification, relaunch
└─ updater-host.ts      #   check/download/install
```

The IPC channel names and event names are **unchanged** from the Tauri build
(`spawn_shell`, `pty:output`, `transfer:settled`, …). Keeping them means the
renderer's listeners and every existing test stay honest, and the contract test
can check both hosts with one parser.

## 2. Task list

Each task ends with its own verification. A task is not done until its command
output is pasted.

### Phase 1 — Host foundation

- [x] **T1. Scaffold.** `electron/` tree, TypeScript config for the main
      process, build wiring (`tsc` for main, existing Vite for renderer),
      `npm run electron:dev`. Dependencies added: `electron`, `node-pty`,
      `electron-builder`. Verify: app boots to a blank window.
- [x] **T2. Shell integration parser.** Port `shell_integration.rs` 1:1
      including the 128 KB pending cap, the incomplete-escape carry, and
      `has_rejected_root` / `retain_valid_cwd`. Translate its Rust tests.
      Verify: `npm run test:main`.
- [x] **T3. PTY spawn + stream.** `spawn_shell` with the exact env block
      (`TERM`, `COLORTERM`, `TERM_PROGRAM=SpaceVibeDeck`, `TERM_PROGRAM_VERSION`,
      `ConEmuANSI=ON` on macOS), login shell via the platform module, cwd
      resolve with `$HOME` fallback. Reader → batcher with the 64 KB batch cap
      and bounded queue. UTF-8 boundary holdback (`take_valid_utf8`).
      `pty:output` / `pty:exit` / `pty:prompt-ready`. Verify: unit tests for the
      batcher and the UTF-8 holdback.
- [x] **T4. write/resize/kill + termination.** Owner validation on all three.
      macOS termination mirrors `terminate_process_groups`: SIGHUP to the
      foreground group, SIGKILL after the grace window, SIGKILL to the shell
      group. Verify: unit tests + a real pane killed by hand.
- [x] **T5. `pty_info` via `ps`.** One `ps -A` per tick, tty → tpgid → pgid
      join, `argv0Name` mirroring `macos.rs` including the `-zsh` dash strip,
      classification table ported from `info.rs` (agent ids, shell list,
      Busy/Unknown). Verify: unit tests over captured `ps` output + a live
      check that a `claude` pane classifies as Agent.

### Phase 2 — Host services

- [x] **T6. Store.** App-data JSON with the same six file names
      (`settings.json`, `workspaces.json`, `presets.json`, `logo.json`,
      `workspace-logos.json`, `update-attempt.json`), atomic writes, autosave
      debounce. Verify: unit tests.
- [x] **T7. Settings merge + cross-window broadcast.** Port
      `settings_merge.rs`, emit `settings:merged`. Verify: unit tests.
- [x] **T8. Agent detect + dirs exist.** `$SHELL -ilc "command -v …"` with the
      3 s timeout and the same output parsing (control-sequence stripping,
      alias/function rejection). Verify: unit tests + live detection of all
      five built-ins.
- [x] **T9. Links + editor open.** Port `links.rs` resolve rules including the
      rejected-root guard. Verify: translated unit tests.
- [x] **T10. Prompt assets + images.** Port `prompt_assets.rs` scanning and
      `images.rs` with its 1 MB cap. Verify: translated unit tests.

### Phase 3 — Windows, menu, lifecycle

- [x] **T11. Menu.** `Menu.buildFromTemplate` generated from
      [`action-registry.ts`](../../src/terminal/action-registry.ts), emitting
      `menu:action`. Keeps R3 intact: the registry stays the source.
      Verify: menu items present and firing.
- [x] **T12. Window lifecycle.** `deck-<n>` labels, focus MRU, boot mode,
      `open_pane_window` with **flat** arguments (the frozen contract — see the
      `open_pane_window` bug), per-window close. Verify: unit tests + manual.
- [x] **T13. Quit flow + census.** Census computed in the main process so a
      wedged renderer cannot make quit unanswerable; single-flight;
      `quit-requested` / `window:close-requested`. Verify: unit tests + manual
      quit with a busy pane.
- [x] **T14. Coordinator + transfer.** Pane ownership, the five transfer
      commands, `transfer:offer` / `transfer:settled`, the 10 s / 4 MB bounds,
      the window-death table, kill-not-leak when both owners are gone.
      Verify: translated unit tests + a real ⌘⇧M detach.

### Phase 4 — Renderer swap

- [x] **T15. Host facades.** `src/host/*` implementing the exact surface the
      renderer uses today. Verify: `npm run build`.
- [x] **T16. Swap 44 files.** Mechanical import replacement only. Verify:
      `npm test`, `npm run build`, plus zero remaining `@tauri-apps` imports.
- [x] **T17. IPC contract test.** The Electron equivalent of
      [`scripts/ipc-contract.test.ts`](../../scripts/ipc-contract.test.ts):
      parse `ipcMain.handle` registrations and every `invoke` call site, fail on
      any mismatch. This is the gate that would have caught `open_pane_window`.
      Verify: the test fails when a key is deliberately removed.

### Phase 5 — Proof

- [ ] **T18. Manual pass.** Open pane, split, new tab, switch preset, open a
      workspace, settings round-trip, prompt board paste, agent chip appears,
      attention state changes, find, links, ⌘⇧M detach, quit with a busy pane.
- [ ] **T19. Package.** `electron-builder` with `asarUnpack` for `node-pty`,
      `x64ArchFiles` for the prebuilds, and the `spawn-helper` chmod step.
      Verify: the packaged universal `.app` runs the manual pass.
      **Also include `dist-electron/electron/vendor/**` (added 2026-08-12).**
      The browser panel reads the vendored react-grab bundle from disk at
      runtime, `__dirname`-relative, so a `files` glob that only matches `.cjs`
      drops it and Inspect dies silently in the packaged app while every gate
      stays green — the same class of failure that bit this MVP twice already
      (absolute Vite asset paths under `file://`, the CJS/ESM mismatch). The
      dev build is not evidence here: it reads the file straight out of the
      build directory.

## 2.1 Outcome (2026-08-11)

**Implemented: ~4,100 lines of host TypeScript plus 163 host tests, replacing
10,504 lines of Rust.** The renderer facades are 277 lines. Commits `5b9305f`
and `187af3f` on `electron-migration`.

**Verified, with output:**

- `npm test` — **1383/1383** across 119 files (163 of them host tests, in 14
  modules; every host module has tests).
- `npm run build` and `npm run electron:build` — both clean.
- **A headed smoke run against the real app** (`npm run electron:smoke`,
  **10/10**): a window exists, the preload bridge is exposed,
  `contextIsolation` holds (no `window.require`, no `window.process`), the
  renderer mounted, **a terminal actually paints — 34 xterm rows after opening
  a workspace**, agent detection found all five built-ins over IPC,
  `spawn_shell` returned a pane, a real PTY echoed a marker back through
  `pty:output`, `pty_info` classified the pane as `idle-shell`/`zsh`, and
  `kill_pty` succeeded for the owner. This is the part `npm test` cannot
  prove, because the suite mocks the host.

**Four bugs the gates caught, worth recording because each is a class:**

1. **`offer_transfer` sent `targetLabel`, the host destructured `label`.**
   Found by `scripts/electron-ipc-contract.test.ts` on its first run — exactly
   the mismatch that shipped `open_pane_window` on Tauri with four green gates.
2. **The host is CommonJS in an ESM repo.** A `.js` file was loaded as an ES
   module and died on `exports`. Emitting `.cjs` was the fix; moving the main
   process to ESM would have forced interop on every CommonJS dependency,
   `node-pty` included.
3. **Vite emitted absolute asset paths.** Under `file://` they resolve to the
   filesystem root, 404, and produce a blank window with nothing on stderr.
   `base: "./"` fixes it.

4. **A failed background store write was swallowed** — `void this.save()`,
   which is exactly the failure `settings_merge.rs` warns about: "how a full
   disk used to look like a successful write". Writes now report through an
   `onError` hook wired to a `store:write-failed` event. The test was checked
   by reverting the fix and watching it go red.

**One behavioural change, deliberate:** `kill_pty` no longer unregisters the
route. The exit path owns teardown, so the `pty:exit` that follows a kill still
reaches its owner instead of being dropped as "no route for pane".

**Worth knowing about the smoke test.** Proving "a pane paints" took three
wrong attempts, and all three were the TEST being wrong rather than the app:
the board's first button removes a recent rather than opening one, a fresh
Electron profile has no recents at all, and a single click only selects a row
(opening is `onDblClick`). Each failure looked exactly like a broken renderer.
That is the argument for the check existing — and the reason to read a smoke
failure carefully before believing it.

## 3. Out of scope

- Auto-update (Gate A blocked — no Apple identity).
- Windows anything (Gate C blocked — no machine).
- Cross-window drag (Phase B, gated on Windows pointer-capture evidence).
- Deleting [`src-tauri`](../../src-tauri).
- README / landing copy.
- Channel cutover.

## 4. Risks

- **Gate C can still abort everything here.** Named in §0.1.
- **The renderer swap is mechanically large** (44 files) and the test suite
  cannot prove it, because it mocks the host. T17 and T18 are the real gates.
- **`ps` polling is a behavioural change in kind**, not just in code: Rust read
  the foreground pgid from the master fd via `tcgetpgrp`, while Node infers it
  from `ps`. A pane whose tty is missing from `ps` output degrades to `Unknown`
  rather than guessing.
