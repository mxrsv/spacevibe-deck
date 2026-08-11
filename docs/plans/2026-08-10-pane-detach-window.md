# Pane Detach Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move one pane out of its window into a new or existing Deck window without killing its PTY, losing a byte of output, or corrupting state shared between windows.

**Architecture:** Ownership of a pane moves through a four-phase transaction in Rust — `prepare` quiesces the output stream into a buffer, `stage` carries the source's serialized scrollback, `claim` hands it to the destination, `commit` flips the route and flushes the buffer in read order, all under one lock. The frontend never arbitrates delivery; it drains, serializes, and adopts. Every window is a peer: it guards and kills only its own panes, and the last one to close exits the process.

**Tech Stack:** Tauri 2.11.5 + Rust (`coordinator.rs`, `pty.rs`, `menu.rs`, `lib.rs`), Preact 10 signals, xterm.js with `@xterm/addon-serialize`, TypeScript, Vitest, `cargo test`.

**Source spec:** [`docs/specs/2026-08-10-pane-detach-window-design.md`](../specs/2026-08-10-pane-detach-window-design.md) `decided`. Where this plan departs from the spec, §0.3 says so explicitly and why.

---

## 0.1 Global Constraints

Every task's requirements implicitly include this section.

- **R1 — English only** for every string, comment, test name, commit message and doc line in this repo. No Vietnamese.
- **R2 —** changes to the numbered rules in `docs/DESIGN-LANGUAGE.md` are a fork. No task here proposes one; if implementation finds one is needed, STOP and ask.
- **R3 —** menu code is generated. Edit `src/terminal/action-registry.ts` (the registry), run `npm run generate:menu`, and `npm run generate:menu:check` must pass. `src-tauri/src/menu.rs` is hand-written and may be edited directly; `src-tauri/src/menu_registry.rs` is generated output and may not.
- **R4 —** `coordinator.rs`, `pty.rs`, the tab materialize path, the layout engine and the close coordinator are load-bearing seams. The spec accepts touching all of them. `pty.rs` gets owner validation on three commands and one function extraction — the read loop is **not** restructured.
- **R5 —** state is Preact signals and module stores are window-scoped. Each Deck window is its own webview and therefore its own JS realm, so every `signal(...)` is already per-window by construction. What is NOT per-window is any store backed by shared disk — see §0.5.
- **This repo uses `npm`, not `pnpm`.**
- **Verification commands** (L5/W4 — no pasted output, no "done"):
  - `npm test` — Vitest
  - `npm run build` — this is `tsc && vite build`, so it covers typecheck
  - `cargo test --locked --manifest-path src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
  - `npm run generate:menu:check`
  - There is no separate `lint` script in this repo.
- **New DOM/component tests carry `// @vitest-environment jsdom` on the FIRST line.** There is no `vitest.config.ts` and the default environment is `node`.
- **No new dependency beyond `@xterm/addon-serialize`**, which spec §2 pre-approved. Adding any other npm package or Rust crate is a fork — STOP and ask. In particular there is deliberately **no `uuid` crate**: transfer tokens are `xfer-<n>` from a process-monotonic counter, on the same never-reuse argument §9.1 makes for `deck-<n>` window labels.
- **Working tree hazard, live.** HEAD is `289a12a`. Another session is actively working in this repo; at the time of writing its dirty set is `.github/workflows/release.yml`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `marketing/landing-prototype/src/directions/a.js`, `scripts/release-workflow.test.ts`, plus untracked `scripts/generate-release-notes.{mjs,test.ts}`. **Re-check `git status` at execution time — do not trust this list.** Any task touching a dirty file uses targeted edits, never a whole-file rewrite, and never reverts an unrelated hunk.
- **Line anchors drift.** Every `file.ts:123` in this plan was verified against `289a12a` or later. Re-read the region before editing; if it moved, edit the right code and note it.

## 0.2 Frozen cross-section contract

Four sections were planned in parallel against this contract. It is the single authority for every name that crosses a section boundary. Changing anything here means changing at least two sections.

**Rust commands**

```
prepare_transfer(window, paneId: String)                  -> Result<String, String>   // token "xfer-<n>"
stage_transfer(window, token: String, payload: AdoptionPayload) -> Result<(), String>
claim_transfer(window, token: String)                     -> Result<AdoptionPayload, String>
commit_transfer(window, token: String)                    -> Result<(), String>       // caller MUST be the destination
abort_transfer(window, token: String)                     -> Result<(), String>
offer_transfer(window, token: String, targetLabel: String) -> Result<(), String>
open_pane_window(window, { token, screenX?, screenY? })   -> Result<String, String>   // CSS pixels in; the new window's label out
window_boot_mode()                                        -> { kind: "normal" } | { kind: "adopt", token: String }
focus_order()                                             -> Vec<String>              // most recent first, read-only

apply_settings_patch(patch: Value)                        -> Result<Value, String>    // merged object out; also broadcast as `settings:merged`
begin_update_check()                                      -> bool                     // true when this window won the single-flight
end_update_check()                                        -> Result<(), String>

confirm_quit(requestId: u64)                              -> Result<(), String>
cancel_quit(requestId: u64)                               -> Result<(), String>
confirm_close_window(requestId: u64)                      -> Result<(), String>
cancel_close_window(requestId: u64)                       -> Result<(), String>
```

`requestId` is a **`u64`**, not a string. `quit-requested` and `window:close-requested` both carry `{ requestId, busyProcesses, busyPanes, fullyNamed }` — the census result travels with the request so the dialog does not have to ask a second time.

`open_pane_window` returns the created window's label. A caller may ignore it, but it must not be typed `void` on the TypeScript side.

`prepare_transfer` takes `paneId` as a **String** parsed to `u32` in Rust. Every other PTY command keeps a numeric id — this one is deliberately different and must not be "fixed". Tauri camelCases argument keys, so the invoke keys are `paneId`, `token`, `payload`, `targetLabel`.

**`AdoptionPayload` — wire field names, frozen**

```
paneId, cwd, agentId, scrollback, cols, rows, tabName, dotColor, workspacePath
```

On the TypeScript side `dotColor` is typed as this repo's `TabDotColor` union, not a free string.

**Events**

| Event                      | Direction                       | Payload                                                 |
| -------------------------- | ------------------------------- | ------------------------------------------------------- |
| `transfer:offer`           | Rust → one window label         | `{ token }`                                             |
| `transfer:settled`         | Rust → **both** `from` and `to` | `{ token, outcome: "committed" \| "aborted", reason? }` |
| `menu:move-pane-to-window` | Rust → the focused window       | `{ targetLabel }`                                       |
| `window:close-requested`   | Rust → one window               | `{ requestId }`                                         |
| `settings:merged`          | Rust → every window             | the merged settings object                              |

`transfer:settled` is emitted by the §7.5 bounds too, not only by an explicit commit or abort. That is what lets the frontend `await` it with no timer of its own: every path that ends a transfer announces itself.

`menu:move-pane-to-window` exists because the "Move Pane to Window ▸" submenu cannot start the transfer in Rust. `prepare_transfer` takes the owning `tauri::Window`, Rust cannot see which pane inside a window has focus, and §7.4 requires the source to serialize its buffer between `prepare` and `claim`. So the menu click hands the job back to the source window:

```
menu click → Rust emits `menu:move-pane-to-window` { targetLabel } to the focused window
          → frontend resolves the focused pane
          → prepare_transfer → stage_transfer → offer_transfer(token, targetLabel)
          → destination hears `transfer:offer` → claim → replay → commit
          → both windows hear `transfer:settled`
```

This arrives on a different channel from `menu:action`, so `isActionId` does not cover it and the frontend validates the payload itself. The submenu items carry a `window-target:` prefix in hand-written `menu.rs` precisely so they never reach that guard.

**Coordinator public methods** (owned by section A, called by section B)

```
begin_transfer(&self, sink: &dyn EventSink, from: &str, pane_id: u32, now: Instant) -> Result<String, String>
reserve_destination(token: &str, label: &str) -> Result<(), String>
on_window_destroyed(app: &AppHandle, label: &str)
abort_transfers_involving(app: &AppHandle, label: &str)
all_panes() -> Vec<u32>          // Owned AND Transferring
panes_for_window(label) -> Vec<u32>   // Owned only — this one is for killing
```

`begin_transfer` and `abort_transfers_involving` carry more arguments than an early draft of this contract showed. Both are load-bearing rather than incidental: the `sink` and the injected `now` are what make the transaction testable at all (`AppHandle` cannot be constructed in a unit test, and a wall-clock read would make the §7.5 timeout untestable), and `abort_transfers_involving` needs the handle because aborting emits `transfer:settled` to windows that are still alive. **Section B must call these signatures, not the shorter ones.**

`all_panes` and `panes_for_window` are deliberately different. The quit census must count a pane that is mid-move, or ⌘Q during a detach can silently kill a busy agent. The close path must NOT kill a mid-move pane, because it no longer belongs to the window that is dying.

`begin_transfer` is the inherent method behind the `prepare_transfer` command, following the existing `move_pane_ownership` → `move_ownership` idiom in `coordinator.rs`. It exists because `tauri::Window` cannot be constructed in a unit test, so any test that drives a real transfer through the coordinator has to enter below the command layer — the same reason section A introduced an `EventSink` trait once it found `AppHandle` unconstructible.

**Frontend module surface**

```
adoptIntoActiveTab({ token, targetPaneId, edge })   // drag path — the gesture names a position
adoptIntoNewTab({ token })                          // menu path — preserves tab name and dot color
```

## 0.3 Departures from the spec, and why

Each of these was found by reading the code, not by preference. They are listed here so a reviewer can accept or reject them as a set.

1. **A fifth command, `stage_transfer`.** Spec §7.3 lists four, but §7.4 requires the source to serialize its scrollback _after_ `prepare_transfer` has quiesced the stream — which leaves the payload no route to `claim_transfer`. Staging closes the gap.
2. **A new event, `transfer:settled`.** Spec §13 says a failed commit leaves the pane with the source and surfaces the error bar. After `stage_transfer` the source receives no further signal, so that behaviour is unimplementable as written. Rust owns the route, so Rust announces the outcome to both windows.
3. **`token: Uuid` → `token: String`.** `uuid` is not a dependency of `src-tauri/Cargo.toml` and adding one is a fork. `xfer-<n>` from a monotonic counter satisfies the same never-reuse property.
4. **`buffered: Vec<String>` → a typed event buffer.** A `String` cannot carry §7.6's "PTY exits mid-transfer → delivered on commit": the exit is a different event name with a different payload shape.
5. **`move_pane_ownership` is deleted.** Its only reference anywhere in `src/`, `src-tauri/src/` and `scripts/` is its own registration in `lib.rs`. It flips ownership without buffering, which is precisely the race §7.1 identifies as a bug, so leaving it registered leaves a live path around the transaction.
6. **`kill_pty` on an unrouted pane returns `Ok(())`, not `Err`.** §8 says "anything else → `Err`", but `kill_pty` already returns `Ok` for a session absent from the map, and `TerminalManager.dispose() → killAll()` hits already-exited panes on every window close. Spec-literal would turn a routine no-op into a surfaced error.
7. **The "Move Pane to Window ▸" submenu is built in Rust, not registered as actions.** A dynamic action id such as `move-pane-to-window:deck-2` is rejected by `isActionId` (`src/terminal/action-registry.ts:459-471`), which is the validation guard on the untrusted IPC payload, and the generated registry cannot express a submenu whose items depend on live windows. Only the static `move-pane-to-new-window` action is registered.
8. **`harden_webview` is called through `run_on_main_thread` with an mpsc handshake, from an async command.** Spec §9.1's "on the main event-loop thread at creation" is right, but the naive reading collides with `WebviewWindowBuilder`'s documented Windows deadlock when a _synchronous_ command creates a window. The handshake also converts §9.1's own "enqueued but never ran, still returns Ok" failure into a returned error.
9. **The busy census cannot run inline on the event loop.** §9.4 says it reads `PtyState::session_snapshots`; that is necessary but not sufficient, because a snapshot carries no process classification — busy/idle comes from `info::classify_process`, and on Windows from a WMI query already deliberately run on `spawn_blocking`.

## 0.4 Spec errata — found while planning, not yet fixed in the spec

The spec is the user's document and is currently untracked. This plan does not edit it. These are the discrepancies a reader will hit:

| Spec claim                                            | Reality                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §5 anchors `app.tsx:206`, `:300`, `:336`, `:366`      | File is `src/ui/app.tsx`, not `src/app.tsx`. Real positions: manager `:305`, board `:324`, updater `:321`, quit guard `:334-355`, `menu:action` `:357-383`.                    |
| §11.3 and §12 cite `file-drop.ts:15`                  | Path is `src/terminal/file-drop.ts`. Line 15 documents the trap as a **known limitation of a cache that is still there**, not as a solved pattern.                             |
| §7.3's command table                                  | Missing `stage_transfer` (§0.3 item 1).                                                                                                                                        |
| §6 is cited for "two measured samples"                | The raw `(screenX, clientX)` pairs are not published in the document — only the formula, one window origin and one `pointerup` value.                                          |
| §5 "In-window pane drag uses `setPointerCapture`"     | True, but capture is taken on the tab container, not on `document`. A cross-window drop that empties the source window is a new way for that element to disappear mid-gesture. |
| §5 "None of the files cited have uncommitted changes" | True when written against `e62fe61`; HEAD is now `289a12a` and the dirty set is different (§0.1).                                                                              |

**One real bug the spec would have shipped, unrelated to the errata above:** `lib.rs:85-93` prevents every unconfirmed exit. That is safe today only because the single window can never actually close. Peer windows make "last window closes" reachable, and unchanged it leaves a windowless, unquittable process. Task B8's `exit_policy` and Task B15 close it.

## 0.5 Accepted residual risks

- **`presets`, `workspaces` and the logo stores stay last-write-wins**, per spec §4's non-goals. Only `settings.json` gets the Rust patch-merge. Two windows editing presets in the same second loses one edit; `workspaces`/recents is the most likely to actually collide, because every Open in any window writes it.
- **Settings disk ownership is split.** Writes go through the Rust merge command, but `initSettings` still reads and `flushSettingsSave` still flushes the plugin-store file, so both sides touch the same file. Spec §9.5 does not say which owns disk. Moving load/flush is out of scope here — flagged, not fixed.
- **`closed-tabs.ts` is in-memory**, so ⌘⇧T reopens only tabs closed in the same window. Correct under the peers model, but a behaviour change nobody stated.
- **A fully occluded destination draws a drop overlay the user cannot see.** Spec §11.2 forbids raising the destination mid-drag because `setFocus` steals focus and risks breaking pointer capture. Stated limitation, not a defect.
- **`src/terminal/file-drop.ts` still caches `scaleFactor` at install** and its own comment says the value can drift. Adjacent defect, out of scope (W3), recorded here so it is not rediscovered as new.

## 0.6 Wave order

Sections were planned in parallel; they do **not** execute in parallel wherever they share a file.

| Wave | Runs                                                                                                     | Why                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Section A** (coordinator, pty validation, lib.rs) ∥ **Section C's frontend-only tasks** ∥ **Task D7b** | C tests against a fake PTY client and a fake window bridge using §0.2's contract, so it needs no Rust code to exist. D7b is pure tree code — see the note below. |
| 2    | **Section B** (window lifecycle)                                                                         | Calls A's coordinator methods and shares the `lib.rs` `invoke_handler` block and `pty.rs`'s three commands with A. **Must be serialized behind A.**              |
| 3    | **Section C's integration tasks**                                                                        | Bind to B's events and commands.                                                                                                                                 |
| 4    | Manual verification under `npm run tauri dev`                                                            | Nothing below is unit-testable: real window creation, focus, occlusion, mixed DPI, and the lock-across-emit stall named below.                                   |

**A wave-4 obligation no unit test can discharge.** Today `emit_to_owner` releases the route lock before emitting (`src-tauri/src/coordinator.rs:67-71`). This plan moves emission inside the lock, deliberately — it is what makes the ordering guarantee structural rather than timed. The cost is that the PTY emitter thread now holds the route lock across `app.emit_to`, while a command thread can be blocked in `sweep_and_reap`. No unit test can observe a stall there. **Wave 4 must include: run several panes producing continuous output, then detach one and close a window while they are still writing, and watch for a hang rather than for a wrong result.**
| B | **Section D** (cross-window drag) | **Gated on D1.** See §0.7. |

**Task D7b is in wave 1, not Phase B, and that is deliberate.** It adds `dockNewPane` to `src/lib/split-tree.ts` — pure tree code, no pointer behaviour, no window API, nothing the §0.7 gate touches. It is numbered inside Section D only because that section discovered the gap. Section C's `adoptIntoActiveTab` cannot be written without it, so leaving it behind the gate would block a wave-1 task on hardware nobody has. **Do not reach for `splitLeaf` while D7b is outstanding** — implement C7 minus `adoptIntoActiveTab` and come back, because `splitLeaf` is the wrong tool and using it produces a bug that looks like it works.

**Known shared files — serialize, do not parallelize:**

- `src-tauri/src/lib.rs` `invoke_handler` — A adds 5 entries, B adds 9 and removes 1.
- `src-tauri/src/pty.rs` — A adds owner validation to `write_pty`/`resize_pty`/`kill_pty`; B extracts `terminate_pane` out of `kill_pty`.
- `src/terminal/terminal-manager.ts:482-492` — C and D both extend the same options object. Additive on both sides.

**A silent-green warning that applies to the whole of wave 2:** `npm test` and `tsc` stay green through B15 even with a frontend/Rust mismatch. No gate catches it; only runtime does. That is why wave 3 exists and why wave 4 is not optional.

## 0.7 The Phase B gate — read before scheduling

Spec §11.4 requires the §6 pointer-capture measurement to be re-run on Windows before cross-window drag is built. The available evidence is macOS-only, one display, `scaleFactor = 2`.

**There is currently no machine that can run it.** The `windows-latest` CI jobs are non-interactive and cannot produce a single row of the measurement table — it needs a human moving a mouse across a window edge. The only job producing a runnable Windows artifact, `windows-engineering-bundle`, is `workflow_dispatch`-only and throws unless the repository is private; `mxrsv/spacevibe-deck` is public, so it cannot run at all.

**A second, smaller gate reaches back into Phase A.** Spec §11.3's mixed-DPI measurement was written to gate the drag hit-test, but it also gates `open_pane_window`'s placement: the CSS→physical conversion is anchored on §6's single display at `scaleFactor = 2`, and the monitor lookup rests on macOS `CGDisplayBounds` being in points (verified in tao 0.35.3). Until a second display at a different scale factor is measured, a detached window's position on a mixed-DPI setup is unverified. This does not block Phase A — it blocks calling the placement correct.

**Consequence:** Phase B stalls at D1 until a real interactive Windows machine is scheduled — the maintainer's own, a VM, a cloud desktop, or a private mirror to unlock the artifact job. This is a prerequisite to arrange, not a step to run. **If the measurement fails, STOP and return the fork to the user**; spec §11.4 names three options (native `SetCapture` in Rust, dropping drag from v1, macOS-only drag with menu-command parity on Windows) and deliberately does not rank them. Do not implement drag on the macOS spike evidence alone.

## 0.8 Open questions returned to the user

The plan proceeds on these defaults; each is cheap to reverse and none blocks Phase A.

1. **Spec §15 Q2 — the detached window's size and position.** Default taken: inherit `tauri.conf.json`'s window config, so a detached window gets the configured default size at the OS's default position. The alternative — same size as the source, offset from it — is a small change to Task B4.
2. **Spec §15 Q3 — `deck-*` windows in the macOS Window menu, and their title.** Untouched, which means every window is titled "SpaceVibe Deck". Very likely wrong once there are three.
3. **Cross-window swap** is not implemented. The in-window drag supports Cmd-drag swap; across windows it would be two transfers in opposite directions and spec §11 does not mention it.
4. **A drop onto a non-Deck application** (Finder, a browser, the Dock) creates a new window, per a literal reading of §11.1's "outside every Deck window". Whether it should instead cancel is a product call.
5. **A distinct cross-window drop overlay.** The relayed overlay is the same `.drop-overlay` as the in-window one, so nothing tells the user the pane will change windows. Making it distinct is an R2 change to `docs/DESIGN-LANGUAGE.md`.
6. **⌘⇧T after a move.** A tab emptied by a move is removed without a reopen snapshot, because nothing was closed. Whether reopen should be able to "bring the pane back" is unasked.

---

## Section A — The transfer transaction (Rust)

_Owns spec §7 and §8: route state, the five transfer commands, bounds, the window-death transition table, the orphan rule, and owner validation on the three PTY commands._

# Section A — The Rust transfer transaction

**Scope:** spec §7 (transfer transaction), §7.5 (bounds), §7.6 (window death +
orphan rule) and §8 (owner validation), plus registering the new commands in
`lib.rs`. Frontend, window creation and drag are other sections.

**Architecture:** `WindowCoordinator` stops holding `pane → label` and holds a
`PaneRoute` per pane. Every routing decision — deliver, buffer, flush, settle —
happens inside **one** mutex acquisition, and emission happens **while that lock
is held**, through an `EventSink` trait. That is what makes "no chunk delivered
twice, none dropped, none reordered" structural rather than timed: a chunk read
after a commit cannot overtake the flush, because the flush and the route change
are the same critical section.

`EventSink` also makes the whole state machine unit-testable. `AppHandle` and
`WebviewWindow` cannot be constructed in a unit test, so:

- **Every §14 Rust assertion lands on the pure layer** — `WindowCoordinator`'s
  methods driven by a `RecordingSink`, and `WindowCoordinator::access`.
- **`#[tauri::command]` bodies stay thin** — parse the id, build an `AppSink`,
  sweep, delegate. They carry no logic worth a test, and none is promised here.

Time is injected the same way: every method that can expire a transfer takes
`now: Instant`, and the command wrappers pass `Instant::now()`. There is no
timer thread; expiry is swept at the head of `deliver`, all five transfer
commands and all three PTY commands, so every interaction self-heals. The PTY
commands also reap: a transfer that expires back to a window which has since
been destroyed leaves a pane nothing else would kill.

### What these tests do NOT cover

Stated here, not only in Findings, because an implementer reading a green suite
should know where the guarantee stops.

- **The kill half of the orphan rule is untested.** `AppHandle` cannot be
  constructed in a unit test, so `sweep_and_reap`, `on_window_destroyed` and
  `abort_transfers_involving` have no test at all. The guarantee as tested ends
  at `take_pending_orphans()` returning the right ids — **not** at a pane
  actually dying. Verify by hand: detach a pane, force-close the destination
  window, confirm the PTY process is gone.
- **`pty:prompt-ready` is never observed buffered.** `RecordingSink::delivered()`
  filters `pty:output`, and mixed event types in one buffer are covered by a
  single `pty:exit` case. `emit_to_owner` is generic over the payload and the
  buffer stores `(event, Value)` pairs, so nothing special-cases prompt-ready —
  but nothing proves it either. `pty.rs:246` is the emitter.
- **A stall under the route lock is invisible here.** Emission now happens
  inside the lock, so the PTY emitter thread holds it across `app.emit_to` while
  a command thread may block in `sweep_and_reap`. No unit test can see that.
  The manual pass must include continuous output (`yes`, a large `cat`) during
  a detach.

**Verification (repo commands, from `.github/workflows/ci.yml`):**

- `cargo test --locked --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run `cargo fmt` before every commit in this section; CI checks it.

## Frozen contract used by this section

```
prepare_transfer(window, pane_id: String) -> Result<String, String>
stage_transfer(window, token: String, payload: AdoptionPayload) -> Result<(), String>
claim_transfer(window, token: String) -> Result<AdoptionPayload, String>
commit_transfer(window, token: String) -> Result<(), String>
abort_transfer(window, token: String) -> Result<(), String>
```

`pane_id` crosses as a **string** and is parsed to `u32` inside the wrapper; the
coordinator map stays keyed on `u32` because that is the PTY id `spawn_shell`
returns. The frontend must send the id as a string. Tauri camelCases command
arguments, so the invoke keys are `paneId`, `token` and `payload`.

`commit_transfer` is called by the **destination** — the window that claimed. No
other window can commit; the source's last act is `stage_transfer`.

## Frozen contracts this section owns

**These are the single authority for the whole plan.** Sections B–D code against
exactly what is below.

**`AdoptionPayload` over the wire** — nine keys, no others:

```
paneId, cwd, agentId, scrollback, cols, rows, tabName, dotColor, workspacePath
```

**`transfer:settled`** — the event that tells both windows how a transfer ended.
Emitted to the `from` label AND the `to` label (or, when nobody claimed, the
`reserved_to` label), inside the same lock section that finalises the route and
immediately after the buffered flush:

```
transfer:settled {
  token: string,
  outcome: "committed" | "aborted",
  reason?: "requested" | "timedOut" | "bufferFull" | "windowGone"
}
```

`reason` is absent on `"committed"` and always present on `"aborted"`. It exists
so a caller can tell "the destination refused" (`requested`) from "nobody ever
answered" (`timedOut`) — §13 requires the source to distinguish them, and after
`stage_transfer` the source has no other signal.

**Four public entry points for the window-lifecycle section**, names frozen:

```rust
WindowCoordinator::reserve_destination(&self, token: &str, label: &str) -> Result<(), String>
WindowCoordinator::all_panes(&self) -> Vec<u32>
coordinator::on_window_destroyed(app: &AppHandle, label: &str)
coordinator::abort_transfers_involving(app: &AppHandle, label: &str)
```

The last two are free functions in `coordinator`, because both must kill panes
and so need an `AppHandle`. `on_window_destroyed` is the whole
`WindowEvent::Destroyed` handler; `abort_transfers_involving` runs on
`CloseRequested`, before the busy guard.

### Inherent methods vs commands

**Every `#[tauri::command]` in this section is a thin wrapper over an inherent
method. None is command-only.** `tauri::Window` cannot be constructed in a unit
test, so anything a test must drive has to be reachable below the command layer
— the same reason `EventSink` exists one level down, applied to the entry
points. This follows the file's own existing `move_pane_ownership` →
`move_ownership` idiom.

| Command            | Inherent method it delegates to                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| `prepare_transfer` | `begin_transfer(&self, sink, from: &str, pane_id: u32, now) -> Result<String, String>` |
| `stage_transfer`   | `stage_payload(&self, sink, token, caller, payload, now) -> Result<(), String>`        |
| `claim_transfer`   | `claim(&self, sink, token, caller, now) -> Result<AdoptionPayload, String>`            |
| `commit_transfer`  | `commit(&self, sink, token, caller, now) -> Result<(), String>`                        |
| `abort_transfer`   | `abort(&self, sink, token, now) -> Result<(), String>`                                 |
| `write_pty` etc.   | `access(&self, pane_id, caller) -> Result<(), PaneAccessError>`                        |

Plus the ones with no command at all, callable directly:
`reserve_destination`, `all_panes`, `panes_for_window`, `owner`, `sweep`,
`abort_involving`, `handle_window_destroyed`, `take_pending_orphans`, `deliver`.

**One deviation from the signature the lead pinned, and the reason.** The
request was `begin_transfer(&self, from: &str, pane_id: u32)`. The `from,
pane_id` order is adopted exactly; `sink` and `now` stay, because dropping them
would defeat the very testability the change is for:

- `now` stamps `Transfer.started`. With an internal `Instant::now()` the §7.5
  test cannot assert the timeout boundary — the elapsed time between the test's
  own `Instant::now()` and the method's would be microseconds, so
  `start + TRANSFER_TIMEOUT` would land just _under_ the bound and the
  "expires" and "one tick before, nothing changed" assertions would both be
  wrong, intermittently.
- `sink` carries the entry sweep. `begin_transfer` must expire a stale transfer
  before it reads the route, or a pane whose previous transfer timed out can
  never start a new one — and expiring emits a flush plus `transfer:settled`.

Callers that do not care pass `&AppSink(app)` and `Instant::now()`, which is
exactly what `prepare_transfer` does in one line.

---

### Task A1: Replace the owner map with `PaneRoute` and route under one lock

**Files:**

- Modify: `src-tauri/src/coordinator.rs:1-126` (whole file)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: nothing from this section.
- Produces:
  - `pub trait EventSink { fn emit(&self, label: &str, event: &str, payload: &serde_json::Value); }`
  - `pub struct AppSink<'a>(pub &'a tauri::AppHandle);` implementing `EventSink`
  - `pub struct BufferedEvent { pub event: String, pub payload: serde_json::Value }`
  - `WindowCoordinator::deliver(&self, sink: &dyn EventSink, pane_id: u32, event: &str, payload: serde_json::Value, now: Instant)`
  - `WindowCoordinator::register(&self, pane_id: u32, window_label: String)` — unchanged signature
  - `WindowCoordinator::unregister(&self, pane_id: u32)` — unchanged signature
  - `WindowCoordinator::owner(&self, pane_id: u32) -> Option<String>` — now `None` for a transferring pane
  - `WindowCoordinator::panes_for_window(&self, label: &str) -> Vec<u32>` — `Owned` routes only
  - `emit_to_owner(...)` — unchanged signature, now a wrapper over `deliver`
  - `crate::coordinator::test_support::RecordingSink` — `#[cfg(test)] pub(crate)`, the **shared** test double. The window-lifecycle section's tests import it by this exact path, so the visibility is load-bearing and must not be narrowed.

- [ ] **Step 1: Write the failing test**

Replace the whole `#[cfg(test)] mod tests` block at `coordinator.rs:87-126`
with:

```rust
/// Test double shared across the crate.
///
/// **This is `pub(crate)` on purpose — do not "clean up" an apparently unused
/// visibility.** The window-lifecycle tests live in other modules and drive the
/// coordinator through `&dyn EventSink` as well (their census test passes one
/// to `begin_transfer`), so a private double here would force a duplicate over
/// there. The path other modules import is
/// `crate::coordinator::test_support::RecordingSink`.
#[cfg(test)]
pub(crate) mod test_support {
    use super::EventSink;
    use std::sync::Mutex;

    /// Records what the coordinator emitted, in emission order. Stands in for
    /// `AppSink`, which needs an `AppHandle` no unit test can build.
    #[derive(Default)]
    pub(crate) struct RecordingSink {
        emitted: Mutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl EventSink for RecordingSink {
        fn emit(&self, label: &str, event: &str, payload: &serde_json::Value) {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .push((label.to_string(), event.to_string(), payload.clone()));
        }
    }

    impl RecordingSink {
        /// `(label, data)` for PTY output only, in order. Filtered on purpose:
        /// `transfer:settled` shares this stream from Task A3 onward, and an
        /// unfiltered view would make every ordering assertion here depend on
        /// a payload shape it is not testing.
        pub(crate) fn delivered(&self) -> Vec<(String, String)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .filter(|(_, event, _)| event == "pty:output")
                .map(|(label, _, payload)| {
                    (
                        label.clone(),
                        payload["data"].as_str().unwrap_or_default().to_string(),
                    )
                })
                .collect()
        }

        /// `(label, event)` for every emission, in order — the unfiltered view.
        pub(crate) fn events(&self) -> Vec<(String, String)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .map(|(label, event, _)| (label.clone(), event.clone()))
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::RecordingSink;
    use super::WindowCoordinator;
    use std::time::Instant;

    /// Local to this module: the shared double is `RecordingSink`, not the
    /// payload builders. Another module testing its own concern builds its own.
    fn output(data: &str) -> serde_json::Value {
        serde_json::json!({ "id": 1, "data": data })
    }

    #[test]
    fn owned_route_delivers_to_the_owning_window_only() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        coordinator.register(1, "main".into());
        coordinator.register(2, "deck-1".into());

        coordinator.deliver(&sink, 1, "pty:output", output("hello"), Instant::now());

        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "hello".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn an_unrouted_pane_drops_the_chunk_instead_of_broadcasting() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();

        coordinator.deliver(&sink, 7, "pty:output", output("secret"), Instant::now());

        assert!(
            sink.delivered().is_empty(),
            "output for an unrouted pane must be dropped, never broadcast"
        );
    }

    #[test]
    fn unregister_clears_an_owned_route() {
        let coordinator = WindowCoordinator::default();
        coordinator.register(1, "main".into());
        coordinator.unregister(1);
        assert_eq!(coordinator.owner(1), None);
    }

    #[test]
    fn panes_for_window_filters() {
        let coordinator = WindowCoordinator::default();
        coordinator.register(1, "a".into());
        coordinator.register(2, "b".into());
        coordinator.register(3, "a".into());
        let mut panes = coordinator.panes_for_window("a");
        panes.sort();
        assert_eq!(panes, vec![1, 3]);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0432]: unresolved import `super::EventSink``
and `error[E0599]: no method named `deliver` found for struct
`WindowCoordinator``.

- [ ] **Step 3: Replace the route state and the delivery path**

Replace `coordinator.rs:1-72` (everything above `move_pane_ownership`) with:

```rust
use std::{
    collections::HashMap,
    sync::Mutex,
    time::Instant,
};
// `State` and `WebviewWindow` come back in A6 with the commands; importing
// them now would be an unused_imports warning across A1-A5.
use tauri::{AppHandle, Emitter};

/// One PTY event held back while its pane is mid-transfer.
#[derive(Clone, Debug, PartialEq)]
pub struct BufferedEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Where a pane's output goes right now.
enum PaneRoute {
    /// Steady state — delivered to this window label.
    Owned(String),
    /// A transfer is open; output is buffered, not delivered (§7.2).
    Transferring(Transfer),
}

/// An open transfer. The spec sketches this as inline enum fields; a named
/// struct keeps every lookup helper returning `&mut Transfer` instead of
/// re-destructuring the variant at each call site.
struct Transfer {
    /// Window the pane is leaving.
    from: String,
    /// Window that claimed it. `None` until `claim_transfer`.
    to: Option<String>,
    /// Window a pending adoption was registered for, before it claims. Lets a
    /// destination that dies before `claim` still abort the transfer (§7.6).
    reserved_to: Option<String>,
    token: String,
    buffered: Vec<BufferedEvent>,
    buffered_bytes: usize,
    /// The PTY exited mid-transfer. The route entry must outlive that so the
    /// buffered exit event still reaches the destination (§7.6).
    exited: bool,
    started: Instant,
}

/// Where the coordinator emits. Production is `AppSink`; tests record, which is
/// the only way to assert delivery order — `AppHandle` cannot be constructed in
/// a unit test.
pub trait EventSink {
    fn emit(&self, label: &str, event: &str, payload: &serde_json::Value);
}

pub struct AppSink<'a>(pub &'a AppHandle);

impl EventSink for AppSink<'_> {
    fn emit(&self, label: &str, event: &str, payload: &serde_json::Value) {
        let _ = self.0.emit_to(label.to_string(), event, payload);
    }
}

/// Everything the coordinator guards, behind ONE mutex. Routes and settled
/// tokens must move together: a commit changes both, and a reader that saw one
/// without the other would answer wrongly.
#[derive(Default)]
struct CoordinatorState {
    routes: HashMap<u32, PaneRoute>,
}

/// App-level pane → window routing. Routes PTY output/exit to the owning
/// webview only, and holds output still across a pane transfer (§7).
#[derive(Default)]
pub struct WindowCoordinator {
    state: Mutex<CoordinatorState>,
}

impl WindowCoordinator {
    pub fn register(&self, pane_id: u32, window_label: String) {
        if let Ok(mut state) = self.state.lock() {
            state.routes.insert(pane_id, PaneRoute::Owned(window_label));
        }
    }

    pub fn unregister(&self, pane_id: u32) {
        if let Ok(mut state) = self.state.lock() {
            state.routes.remove(&pane_id);
        }
    }

    /// The owning window, or `None` while a transfer is open — a transferring
    /// pane has no owner, and saying otherwise would let a caller act on it.
    #[allow(dead_code)] // window lifecycle census (§9.4)
    pub fn owner(&self, pane_id: u32) -> Option<String> {
        let state = self.state.lock().ok()?;
        match state.routes.get(&pane_id) {
            Some(PaneRoute::Owned(label)) => Some(label.clone()),
            Some(PaneRoute::Transferring(_)) | None => None,
        }
    }

    /// Pane ids still owned by this window (for close-window dispose).
    #[allow(dead_code)] // used when multi-window close lands
    pub fn panes_for_window(&self, window_label: &str) -> Vec<u32> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        state
            .routes
            .iter()
            .filter_map(|(id, route)| match route {
                PaneRoute::Owned(label) if label == window_label => Some(*id),
                _ => None,
            })
            .collect()
    }

    /// Route one PTY event under a SINGLE lock (§7.2). Emission happens while
    /// the lock is held, so a chunk read during a commit cannot overtake the
    /// flush that commit performs.
    pub fn deliver(
        &self,
        sink: &dyn EventSink,
        pane_id: u32,
        event: &str,
        payload: serde_json::Value,
        _now: Instant,
    ) {
        let Ok(mut state) = self.state.lock() else {
            eprintln!("Deck: route lock poisoned, dropping {event} for pane {pane_id}");
            return;
        };
        match state.routes.get_mut(&pane_id) {
            Some(PaneRoute::Owned(label)) => sink.emit(label, event, &payload),
            Some(PaneRoute::Transferring(transfer)) => {
                transfer.buffered.push(BufferedEvent {
                    event: event.to_string(),
                    payload,
                });
            }
            // No broadcast fallback: sending one window's terminal output to
            // every window is a data leak, not a safety net (§7.2).
            None => eprintln!("Deck: no route for pane {pane_id}, dropping {event}"),
        }
    }
}

/// Emit a PTY event to the pane's current route.
pub fn emit_to_owner<S: serde::Serialize + Clone>(
    app: &AppHandle,
    coordinator: &WindowCoordinator,
    pane_id: u32,
    event: &str,
    payload: S,
) {
    let value = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Deck: cannot serialize {event} for pane {pane_id}: {error}");
            return;
        }
    };
    coordinator.deliver(&AppSink(app), pane_id, event, value, Instant::now());
}
```

Two warnings are expected and transient in this task: `PaneRoute::Transferring`
is never constructed until A2 builds one, and `Transfer`'s fields are never read
until A2/A3. Do not "fix" them by trimming the struct — every field is used by
the end of A4.

Three deletions belong to this step, because `PaneRoute` leaves them
uncompilable and there is no half-state worth keeping:

- the `move_ownership` method (`coordinator.rs:32-42`),
- the `move_pane_ownership` command (`coordinator.rs:74-85`) — see Findings (d),
- its registration, the line `coordinator::move_pane_ownership,` at
  `lib.rs:71`. Delete the line; A6 puts the five transfer commands in its place.

The `move_ownership_updates_label` test goes with them; the replacement test
block in Step 1 already omits it.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: PASS, 4 tests, and `cargo test` compiles the whole crate — which is
what proves `lib.rs` no longer references the deleted command.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs src-tauri/src/lib.rs
git commit -m "refactor(coordinator): route panes through PaneRoute under one lock"
```

---

### Task A2: `AdoptionPayload`, and the prepare → stage → claim half of the transaction

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (add to `impl WindowCoordinator`)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `EventSink`, `RecordingSink`, `WindowCoordinator::deliver` (A1).
- Produces:

```rust
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionPayload {
    pub pane_id: u32,             // wire: paneId
    pub cwd: Option<String>,      // wire: cwd
    pub agent_id: Option<String>, // wire: agentId
    pub scrollback: String,       // wire: scrollback
    pub cols: u16,                // wire: cols
    pub rows: u16,                // wire: rows
    pub tab_name: Option<String>, // wire: tabName
    pub dot_color: Option<String>,      // wire: dotColor
    pub workspace_path: Option<String>, // wire: workspacePath
}
```

- `WindowCoordinator::begin_transfer(&self, sink: &dyn EventSink, from: &str, pane_id: u32, now: Instant) -> Result<String, String>` — **public seam**, callable below the command layer
- `WindowCoordinator::stage_payload(&self, sink: &dyn EventSink, token: &str, caller: &str, payload: AdoptionPayload, now: Instant) -> Result<(), String>`
- `WindowCoordinator::claim(&self, sink: &dyn EventSink, token: &str, caller: &str, now: Instant) -> Result<AdoptionPayload, String>`
- `WindowCoordinator::reserve_destination(&self, token: &str, label: &str) -> Result<(), String>` — **public seam for the window-lifecycle section**: call it when a window is created to receive `token`, so §7.6 row 1 (destination dies before `claim`) can abort.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    use super::AdoptionPayload;

    fn payload(pane_id: u32) -> AdoptionPayload {
        AdoptionPayload {
            pane_id,
            cwd: Some("/tmp".into()),
            agent_id: Some("claude".into()),
            scrollback: "scrollback".into(),
            cols: 80,
            rows: 24,
            tab_name: Some("agent".into()),
            dot_color: Some("--cyan".into()),
            workspace_path: Some("/tmp/work".into()),
        }
    }

    #[test]
    fn prepare_buffers_output_and_only_the_owner_may_start_it() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());

        assert_eq!(
            coordinator.begin_transfer(&sink, "deck-1", 1, now),
            Err("Pane #1 is owned by window main".into())
        );
        assert_eq!(
            coordinator.begin_transfer(&sink, "main", 9, now),
            Err("Pane #9 is not registered".into())
        );

        let token = coordinator
            .begin_transfer(&sink, "main", 1, now)
            .expect("owner may start a transfer");
        coordinator.deliver(&sink, 1, "pty:output", output("held"), now);

        assert!(
            sink.delivered().is_empty(),
            "output must buffer once a transfer is open"
        );
        assert_eq!(coordinator.owner(1), None);
        assert!(token.starts_with("xfer-"));
    }

    #[test]
    fn a_second_prepare_for_the_same_pane_is_rejected() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.begin_transfer(&sink, "main", 1, now),
            Err("Pane #1 is already being transferred".into())
        );
    }

    #[test]
    fn staging_requires_the_source_window_and_happens_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.stage_payload(&sink, &token, "deck-1", payload(1), now),
            Err(format!("Transfer {token} can only be staged by window main"))
        );
        assert_eq!(
            coordinator.stage_payload(&sink, "xfer-999", "main", payload(1), now),
            Err("Transfer xfer-999 is not open".into())
        );
        assert_eq!(
            coordinator.stage_payload(&sink, &token, "main", payload(1), now),
            Ok(())
        );
        assert_eq!(
            coordinator.stage_payload(&sink, &token, "main", payload(1), now),
            Err(format!("Transfer {token} already carries a payload"))
        );
    }

    #[test]
    fn claim_needs_a_staged_payload_and_succeeds_only_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", now),
            Err(format!("Transfer {token} has no staged payload"))
        );
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", now),
            Ok(payload(1))
        );
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-2", now),
            Err(format!("Transfer {token} was already claimed"))
        );
        assert_eq!(
            coordinator.claim(&sink, "xfer-999", "deck-1", now),
            Err("Transfer xfer-999 is not open".into())
        );
    }

    #[test]
    fn adoption_payload_serializes_camel_case() {
        let json = serde_json::to_value(payload(4)).expect("serialize");
        assert_eq!(json["paneId"], 4);
        assert_eq!(json["agentId"], "claude");
        assert_eq!(json["tabName"], "agent");
        assert_eq!(json["dotColor"], "--cyan");
        assert_eq!(json["workspacePath"], "/tmp/work");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0432]: unresolved import
`super::AdoptionPayload`` and `error[E0599]: no method named `begin_transfer`
found for struct `WindowCoordinator``.

- [ ] **Step 3: Add the payload, the token counter and the three methods**

Add to the imports at the top of `coordinator.rs`:

```rust
use std::sync::atomic::{AtomicU64, Ordering};
```

Add this field to `Transfer`, directly below its `token: String` line:

```rust
    /// Adoption payload put up by the source between `prepare` and `claim`.
    staged: Option<AdoptionPayload>,
```

Add the payload type itself above `PaneRoute`:

```rust
/// What moves with a pane (§10.2). Serialized to the destination window;
/// deserialized from the source when it stages. camelCase over the wire, as in
/// `links.rs` and `prompt_assets.rs`.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionPayload {
    pub pane_id: u32,
    pub cwd: Option<String>,
    pub agent_id: Option<String>,
    pub scrollback: String,
    pub cols: u16,
    pub rows: u16,
    pub tab_name: Option<String>,
    pub dot_color: Option<String>,
    pub workspace_path: Option<String>,
}
```

Add the counter to `WindowCoordinator`:

```rust
#[derive(Default)]
pub struct WindowCoordinator {
    state: Mutex<CoordinatorState>,
    /// Monotonic within a process run; a token is never reused, which is what
    /// makes `commit`/`abort` idempotent (§7.6).
    next_token: AtomicU64,
}
```

Add the lookup helper as a free function below `CoordinatorState`:

```rust
/// The open transfer carrying `token`, with the pane it belongs to.
fn transfer_mut<'a>(
    routes: &'a mut HashMap<u32, PaneRoute>,
    token: &str,
) -> Option<(u32, &'a mut Transfer)> {
    routes.iter_mut().find_map(|(id, route)| match route {
        PaneRoute::Transferring(transfer) if transfer.token == token => Some((*id, transfer)),
        _ => None,
    })
}
```

Add to `impl WindowCoordinator`:

```rust
    /// Open a transfer for a pane this window owns (§7.3 `prepare_transfer`).
    /// Output starts buffering the moment this returns.
    pub fn begin_transfer(
        &self,
        _sink: &dyn EventSink,
        from: &str,
        pane_id: u32,
        now: Instant,
    ) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        match state.routes.get(&pane_id) {
            Some(PaneRoute::Owned(label)) if label == from => {}
            Some(PaneRoute::Owned(label)) => {
                return Err(format!("Pane #{pane_id} is owned by window {label}"))
            }
            Some(PaneRoute::Transferring(_)) => {
                return Err(format!("Pane #{pane_id} is already being transferred"))
            }
            None => return Err(format!("Pane #{pane_id} is not registered")),
        }
        let token = format!("xfer-{}", self.next_token.fetch_add(1, Ordering::Relaxed) + 1);
        state.routes.insert(
            pane_id,
            PaneRoute::Transferring(Transfer {
                from: from.to_string(),
                to: None,
                reserved_to: None,
                token: token.clone(),
                staged: None,
                buffered: Vec::new(),
                buffered_bytes: 0,
                exited: false,
                started: now,
            }),
        );
        Ok(token)
    }

    /// The source puts up the adoption payload it serialized after `prepare`
    /// quiesced the stream (§7.4). Separate from `prepare` because the payload
    /// does not exist yet when `prepare` returns.
    pub fn stage_payload(
        &self,
        _sink: &dyn EventSink,
        token: &str,
        caller: &str,
        payload: AdoptionPayload,
        _now: Instant,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.from != caller {
            return Err(format!(
                "Transfer {token} can only be staged by window {}",
                transfer.from
            ));
        }
        if transfer.staged.is_some() {
            return Err(format!("Transfer {token} already carries a payload"));
        }
        transfer.staged = Some(payload);
        Ok(())
    }

    /// The destination takes the payload and records itself as the receiver.
    pub fn claim(
        &self,
        _sink: &dyn EventSink,
        token: &str,
        caller: &str,
        _now: Instant,
    ) -> Result<AdoptionPayload, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.to.is_some() {
            return Err(format!("Transfer {token} was already claimed"));
        }
        let Some(payload) = transfer.staged.clone() else {
            return Err(format!("Transfer {token} has no staged payload"));
        };
        transfer.to = Some(caller.to_string());
        Ok(payload)
    }

    /// Name the window a pending adoption was opened for, before it claims.
    /// The window-lifecycle section calls this from `open_pane_window` so that
    /// a destination dying before `claim` still aborts the transfer (§7.6).
    #[allow(dead_code)] // wired by the window lifecycle section
    pub fn reserve_destination(&self, token: &str, label: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        transfer.reserved_to = Some(label.to_string());
        Ok(())
    }
```

The `_sink` and `_now` parameters are unused until Task A4 adds the expiry
sweep; keeping them in the signature now means A4 changes bodies, not call
sites.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs
git commit -m "feat(coordinator): open a pane transfer with prepare, stage and claim"
```

---

### Task A3: Commit and abort — ordered flush, token idempotency, deferred unregister

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (add to `CoordinatorState` and `impl WindowCoordinator`)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `begin_transfer`, `stage_payload`, `claim` (A2); `deliver` (A1).
- Produces:
  - `WindowCoordinator::commit(&self, sink: &dyn EventSink, token: &str, caller: &str, now: Instant) -> Result<(), String>` — callable **only by the window that claimed**
  - `WindowCoordinator::abort(&self, sink: &dyn EventSink, token: &str, now: Instant) -> Result<(), String>`
  - `pub const EVENT_TRANSFER_SETTLED: &str = "transfer:settled"` and `pub enum AbortReason { Requested, TimedOut, BufferFull, WindowGone }`
  - The `transfer:settled` event itself — payload frozen at the top of this document. Emitted to `from` and to `to`/`reserved_to`, once per transfer, after the flush and inside the settling lock.
  - Changed behaviour: `unregister` on a transferring pane defers, it does not remove.

- [ ] **Step 1: Write the failing test**

First add one more view to `RecordingSink`, in `test_support` beside `events` —
it is only needed from this task on, which is why A1 did not declare it:

```rust
        /// `(label, payload)` for every `transfer:settled`, in order.
        pub(crate) fn settled(&self) -> Vec<(String, serde_json::Value)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .filter(|(_, event, _)| event == "transfer:settled")
                .map(|(label, _, payload)| (label.clone(), payload.clone()))
                .collect()
        }
```

Then append inside `mod tests`:

```rust
    #[test]
    fn commit_flushes_in_read_order_and_delivers_each_chunk_exactly_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.deliver(&sink, 1, "pty:output", output("before"), now);

        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.deliver(&sink, 1, "pty:output", output("b"), now);
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("c"), now);
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("after"), now);

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "before".to_string()),
                ("deck-1".to_string(), "a".to_string()),
                ("deck-1".to_string(), "b".to_string()),
                ("deck-1".to_string(), "c".to_string()),
                ("deck-1".to_string(), "after".to_string()),
            ]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("deck-1"));
    }

    #[test]
    fn only_the_claiming_window_may_commit() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();

        assert_eq!(
            coordinator.commit(&sink, &token, "deck-1", now),
            Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ))
        );
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        assert_eq!(
            coordinator.commit(&sink, &token, "deck-2", now),
            Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ))
        );
    }

    #[test]
    fn abort_returns_the_pane_and_its_buffer_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.deliver(&sink, 1, "pty:output", output("b"), now);

        coordinator.abort(&sink, &token, now).unwrap();

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "a".to_string()),
                ("main".to_string(), "b".to_string()),
            ]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn a_retried_command_is_idempotent_through_its_token() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        // A committed token replies success, not a second commit — no second
        // flush of the same chunk.
        assert_eq!(coordinator.commit(&sink, &token, "deck-1", now), Ok(()));
        assert_eq!(
            sink.delivered(),
            vec![("deck-1".to_string(), "a".to_string())]
        );
        assert_eq!(
            coordinator.abort(&sink, &token, now),
            Err(format!("Transfer {token} was already committed"))
        );

        let second = coordinator.begin_transfer(&sink, "deck-1", 1, now).unwrap();
        coordinator.abort(&sink, &second, now).unwrap();
        assert_eq!(coordinator.abort(&sink, &second, now), Ok(()));
        assert_eq!(
            coordinator.commit(&sink, &second, "deck-1", now),
            Err(format!("Transfer {second} was aborted"))
        );
    }

    /// The one test that exercises the claim the whole design rests on. Every
    /// other test here is single-threaded, so it proves the state machine but
    /// says nothing about whether the mutex actually orders a real PTY emitter
    /// thread against a commit — which is the exact race §7.1 exists to close.
    ///
    /// The assertions hold for EVERY interleaving, so this is deterministic
    /// despite the thread: the chunk sequence is dense and strictly increasing
    /// (nothing lost, duplicated or reordered), and not one chunk reaches the
    /// source. What it cannot do is force the worst interleaving; it makes the
    /// race reachable, it does not prove it was reached. Run it under
    /// `--test-threads=1` on a loaded machine if it ever needs to bite harder.
    #[test]
    fn a_concurrent_reader_cannot_overtake_or_straddle_a_commit() {
        use std::sync::atomic::{AtomicBool, AtomicU32, Ordering as AtomicOrdering};
        use std::sync::Arc;

        let coordinator = Arc::new(WindowCoordinator::default());
        let sink = Arc::new(RecordingSink::default());
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&*sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&*sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&*sink, &token, "deck-1", now).unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let sent = Arc::new(AtomicU32::new(0));
        let reader = {
            let (coordinator, sink, stop, sent) = (
                Arc::clone(&coordinator),
                Arc::clone(&sink),
                Arc::clone(&stop),
                Arc::clone(&sent),
            );
            std::thread::spawn(move || {
                // Stands in for the PTY emitter thread in `spawn_shell`.
                while !stop.load(AtomicOrdering::Relaxed) {
                    let n = sent.load(AtomicOrdering::Relaxed);
                    coordinator.deliver(
                        &*sink,
                        1,
                        "pty:output",
                        output(&n.to_string()),
                        Instant::now(),
                    );
                    sent.store(n + 1, AtomicOrdering::Release);
                }
            })
        };

        // Let the reader get well ahead, so the commit lands mid-stream rather
        // than before the first chunk.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while sent.load(AtomicOrdering::Acquire) < 200 {
            assert!(
                std::time::Instant::now() < deadline,
                "the reader thread never ran"
            );
            std::thread::yield_now();
        }
        coordinator.commit(&*sink, &token, "deck-1", now).unwrap();
        // Keep it running past the commit so post-commit delivery interleaves
        // with the flush that just happened.
        let after_commit = sent.load(AtomicOrdering::Acquire) + 200;
        while sent.load(AtomicOrdering::Acquire) < after_commit {
            assert!(
                std::time::Instant::now() < deadline,
                "the reader thread stalled after the commit"
            );
            std::thread::yield_now();
        }
        stop.store(true, AtomicOrdering::Relaxed);
        reader.join().expect("reader thread");

        let delivered = sink.delivered();
        let expected: Vec<String> = (0..delivered.len() as u32).map(|n| n.to_string()).collect();
        let seen: Vec<String> = delivered.iter().map(|(_, data)| data.clone()).collect();
        // Dense and strictly increasing: nothing dropped, nothing delivered
        // twice, nothing reordered across the commit.
        assert_eq!(seen, expected);
        assert!(delivered.len() >= 400, "the race window was never opened");
        // After the commit no chunk reaches the source — and the ones buffered
        // before it were flushed to the destination, so `main` sees none at all.
        assert!(
            delivered.iter().all(|(label, _)| label == "deck-1"),
            "a chunk reached a window that does not own the pane"
        );
    }

    #[test]
    fn both_ends_are_told_exactly_once_how_the_transfer_ended() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert_eq!(
            sink.settled(),
            vec![
                (
                    "main".to_string(),
                    serde_json::json!({ "token": token, "outcome": "committed" })
                ),
                (
                    "deck-1".to_string(),
                    serde_json::json!({ "token": token, "outcome": "committed" })
                ),
            ]
        );
        // The idempotent replay must not announce a second time.
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();
        assert_eq!(sink.settled().len(), 2);
    }

    #[test]
    fn an_abort_names_a_reason_and_reaches_a_window_that_never_claimed() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        // A boot-adopt window exists but has not claimed yet. §13 needs it told
        // too, or it waits out the whole timeout for nothing.
        coordinator.reserve_destination(&token, "deck-1").unwrap();

        coordinator.abort(&sink, &token, now).unwrap();

        let expected = serde_json::json!({
            "token": token,
            "outcome": "aborted",
            "reason": "requested",
        });
        assert_eq!(
            sink.settled(),
            vec![
                ("main".to_string(), expected.clone()),
                ("deck-1".to_string(), expected),
            ]
        );
    }

    #[test]
    fn a_transfer_that_never_left_its_window_is_announced_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        coordinator.abort(&sink, &token, now).unwrap();

        // Nobody claimed and nothing was reserved, so `from` is the only end
        // there is — it must not be told twice.
        assert_eq!(sink.settled().len(), 1);
        assert_eq!(sink.settled()[0].0, "main");
    }

    #[test]
    fn a_pty_exit_mid_transfer_is_buffered_and_delivered_on_commit() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();

        // Exactly what the emitter thread does on EOF: emit the exit, then
        // unregister. The route entry must survive both.
        coordinator.deliver(&sink, 1, "pty:output", output("bye"), now);
        coordinator.deliver(&sink, 1, "pty:exit", serde_json::json!({ "id": 1 }), now);
        coordinator.unregister(1);

        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert_eq!(
            sink.events(),
            vec![
                ("deck-1".to_string(), "pty:output".to_string()),
                ("deck-1".to_string(), "pty:exit".to_string()),
                // Both ends learn the transfer landed, after the flush.
                ("main".to_string(), "transfer:settled".to_string()),
                ("deck-1".to_string(), "transfer:settled".to_string()),
            ]
        );
        // The pane is gone, so no dead route may be left behind.
        assert_eq!(coordinator.owner(1), None);
        assert!(coordinator.panes_for_window("deck-1").is_empty());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0599]: no method named `commit`found for
struct`WindowCoordinator``.

- [ ] **Step 3: Implement settling, idempotency and the deferred unregister**

Add to the imports:

```rust
use std::collections::VecDeque;
```

Add the constants and the settled-token bookkeeping:

```rust
pub const EVENT_TRANSFER_SETTLED: &str = "transfer:settled";

/// How many finished tokens stay answerable. A retry arrives within one
/// transfer window, so a small ring is enough — and it stops a long session
/// from accumulating one entry per move forever.
const SETTLED_TOKENS_MAX: usize = 64;

/// Why a transfer ended anywhere other than a commit. Rides `transfer:settled`
/// so a caller can tell a destination that refused from one that never
/// answered — §13 makes the source act differently on each, and after
/// `stage_transfer` it has no other signal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbortReason {
    /// A window called `abort_transfer` — the destination refused the pane, or
    /// the source changed its mind.
    Requested,
    /// No commit within `TRANSFER_TIMEOUT` (§7.5).
    TimedOut,
    /// The held-back output passed `BUFFER_MAX_BYTES` (§7.5).
    BufferFull,
    /// A window the transfer depends on was destroyed or is closing (§7.6).
    WindowGone,
}

impl AbortReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::TimedOut => "timedOut",
            Self::BufferFull => "bufferFull",
            Self::WindowGone => "windowGone",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Settled {
    Committed,
    Aborted(AbortReason),
}

#[derive(Default)]
struct CoordinatorState {
    routes: HashMap<u32, PaneRoute>,
    settled: HashMap<String, Settled>,
    settled_order: VecDeque<String>,
}
```

Add the two free functions below `transfer_mut`:

```rust
/// Close a transfer under the lock: flush every buffered event to `label` in
/// append order, then hand the route over. Emission happens INSIDE the caller's
/// lock, so a chunk read after the flush cannot overtake it (§7.3).
fn settle(
    state: &mut CoordinatorState,
    sink: &dyn EventSink,
    pane_id: u32,
    label: &str,
    outcome: Settled,
) {
    let Some(PaneRoute::Transferring(transfer)) = state.routes.remove(&pane_id) else {
        return;
    };
    for buffered in &transfer.buffered {
        sink.emit(label, &buffered.event, &buffered.payload);
    }
    announce_settled(sink, &transfer, outcome);
    // A PTY that exited mid-transfer deferred its unregister so the buffered
    // exit above could still be delivered. Now honour it, rather than writing
    // an owned route for a pane that no longer exists.
    if !transfer.exited {
        state
            .routes
            .insert(pane_id, PaneRoute::Owned(label.to_string()));
    }
    remember_settled(state, transfer.token, outcome);
}

/// Tell both ends how the transfer ended. Emitted after the flush, so a
/// destination has every buffered byte before it learns the pane is its own,
/// and inside the caller's lock, so nothing can settle twice.
///
/// A label whose window is already gone still gets the emit: `AppSink` throws
/// the result away, exactly as it does for any other event aimed at a dead
/// window. Filtering here would mean tracking window liveness for no gain.
fn announce_settled(sink: &dyn EventSink, transfer: &Transfer, outcome: Settled) {
    let payload = match outcome {
        Settled::Committed => serde_json::json!({
            "token": transfer.token,
            "outcome": "committed",
        }),
        Settled::Aborted(reason) => serde_json::json!({
            "token": transfer.token,
            "outcome": "aborted",
            "reason": reason.as_str(),
        }),
    };
    sink.emit(&transfer.from, EVENT_TRANSFER_SETTLED, &payload);
    // Whoever claimed, or — when nobody did — whoever a window was opened for.
    // A boot-adopt window that died before claiming is the case §13 cares
    // about: it must learn the transfer is over rather than wait out the
    // timeout.
    let other = transfer.to.as_deref().or(transfer.reserved_to.as_deref());
    if let Some(label) = other.filter(|label| *label != transfer.from) {
        sink.emit(label, EVENT_TRANSFER_SETTLED, &payload);
    }
}

fn remember_settled(state: &mut CoordinatorState, token: String, outcome: Settled) {
    if state.settled.insert(token.clone(), outcome).is_none() {
        state.settled_order.push_back(token);
    }
    while state.settled_order.len() > SETTLED_TOKENS_MAX {
        if let Some(oldest) = state.settled_order.pop_front() {
            state.settled.remove(&oldest);
        }
    }
}
```

Add to `impl WindowCoordinator`:

```rust
    /// Hand the pane to the window that claimed it, flushing what buffered.
    pub fn commit(
        &self,
        sink: &dyn EventSink,
        token: &str,
        caller: &str,
        _now: Instant,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if let Some(settled) = state.settled.get(token).copied() {
            return match settled {
                Settled::Committed => Ok(()),
                Settled::Aborted(_) => Err(format!("Transfer {token} was aborted")),
            };
        }
        let Some((pane_id, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.to.as_deref() != Some(caller) {
            return Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ));
        }
        let destination = caller.to_string();
        settle(&mut state, sink, pane_id, &destination, Settled::Committed);
        Ok(())
    }

    /// Return the pane to its source, flushing what buffered. Any caller may
    /// abort: abort never moves a pane anywhere it was not already, so there is
    /// nothing to guard, and a destination that failed before it claimed still
    /// needs to release the pane.
    pub fn abort(
        &self,
        sink: &dyn EventSink,
        token: &str,
        _now: Instant,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        if let Some(settled) = state.settled.get(token).copied() {
            return match settled {
                Settled::Aborted(_) => Ok(()),
                Settled::Committed => Err(format!("Transfer {token} was already committed")),
            };
        }
        let Some((pane_id, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        let source = transfer.from.clone();
        settle(
            &mut state,
            sink,
            pane_id,
            &source,
            Settled::Aborted(AbortReason::Requested),
        );
        Ok(())
    }
```

Replace `unregister` with the deferring version:

```rust
    pub fn unregister(&self, pane_id: u32) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        match state.routes.get_mut(&pane_id) {
            // Mid-transfer the entry must outlive the PTY: it holds the exit
            // event the destination is owed on commit (§7.6). `settle` drops
            // the route instead of re-owning it.
            Some(PaneRoute::Transferring(transfer)) => transfer.exited = true,
            Some(PaneRoute::Owned(_)) | None => {
                state.routes.remove(&pane_id);
            }
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs
git commit -m "feat(coordinator): commit and abort a transfer with an ordered flush"
```

---

### Task A4: Bounds — the 10 s timeout and the 4 MB buffer cap

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (constants, `deliver`, all five transfer methods)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `settle`, `Settled` (A3).
- Produces:
  - `pub const TRANSFER_TIMEOUT: Duration` (10 s), `pub const BUFFER_MAX_BYTES: usize` (4 MB)
  - `WindowCoordinator::sweep(&self, sink: &dyn EventSink, now: Instant)` — **public seam**: the PTY commands call it so a frozen pane self-heals even when no output flows.
  - `begin_transfer` / `stage_payload` / `claim` / `commit` / `abort` / `deliver` now use their `sink` and `now` parameters.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    use super::{BUFFER_MAX_BYTES, TRANSFER_TIMEOUT};

    #[test]
    fn an_uncommitted_transfer_expires_back_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let start = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, start).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), start);

        // One tick before the bound, nothing has changed.
        coordinator.sweep(&sink, start + TRANSFER_TIMEOUT - std::time::Duration::from_millis(1));
        assert!(sink.delivered().is_empty());

        coordinator.sweep(&sink, start + TRANSFER_TIMEOUT);

        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "held".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", start + TRANSFER_TIMEOUT),
            Err(format!("Transfer {token} is not open"))
        );
    }

    #[test]
    fn an_expired_transfer_is_swept_by_the_next_delivery() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let start = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.begin_transfer(&sink, "main", 1, start).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), start);

        coordinator.deliver(
            &sink,
            1,
            "pty:output",
            output("later"),
            start + TRANSFER_TIMEOUT,
        );

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "held".to_string()),
                ("main".to_string(), "later".to_string()),
            ]
        );
    }

    #[test]
    fn a_buffer_past_the_cap_aborts_back_to_the_source_keeping_every_chunk() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        let chunk = "x".repeat(BUFFER_MAX_BYTES / 2);
        coordinator.deliver(&sink, 1, "pty:output", output(&chunk), now);
        assert!(sink.delivered().is_empty(), "half the cap still buffers");
        coordinator.deliver(&sink, 1, "pty:output", output(&chunk), now);

        let delivered = sink.delivered();
        assert_eq!(delivered.len(), 2, "the overflowing chunk is flushed too");
        assert!(delivered.iter().all(|(label, _)| label == "main"));
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
        assert_eq!(
            coordinator.commit(&sink, &token, "deck-1", now),
            Err(format!("Transfer {token} was aborted"))
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0432]: unresolved imports
`super::BUFFER_MAX_BYTES`, `super::TRANSFER_TIMEOUT`` and `error[E0599]: no
method named `sweep``.

- [ ] **Step 3: Add the bounds and wire the sweep into every entry point**

Add `Duration` to the `std::time` import, then the constants and the byte
estimate:

```rust
/// A transfer that has not committed by this point is abandoned back to its
/// source (§7.5). Enforced lazily on every coordinator entry point rather than
/// by a timer thread, so there is no wakeup to schedule and no thread to leak.
pub const TRANSFER_TIMEOUT: Duration = Duration::from_secs(10);

/// Ceiling on what one transfer may hold back (§7.5). Past it, the move is
/// abandoned and everything buffered goes to the source — losing the move is
/// recoverable, losing output is not.
pub const BUFFER_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Serialized size of one buffered event. Only ever called while a transfer is
/// open, i.e. for tens of milliseconds per move.
fn estimate_bytes(payload: &serde_json::Value) -> usize {
    serde_json::to_vec(payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}
```

Add the sweep as a free function beside `settle`:

```rust
/// Abandon every transfer that outlived `TRANSFER_TIMEOUT`, returning each
/// pane to its source. Runs inside the caller's lock.
fn sweep_locked(state: &mut CoordinatorState, sink: &dyn EventSink, now: Instant) {
    let expired: Vec<(u32, String)> = state
        .routes
        .iter()
        .filter_map(|(id, route)| match route {
            PaneRoute::Transferring(transfer)
                if now.saturating_duration_since(transfer.started) >= TRANSFER_TIMEOUT =>
            {
                Some((*id, transfer.from.clone()))
            }
            _ => None,
        })
        .collect();
    for (pane_id, source) in expired {
        eprintln!("Deck: transfer for pane {pane_id} timed out, returning it to window {source}");
        settle(
            state,
            sink,
            pane_id,
            &source,
            Settled::Aborted(AbortReason::TimedOut),
        );
    }
}
```

Add the public entry point to `impl WindowCoordinator`:

```rust
    /// Enforce the transfer timeout. Called by the PTY commands as well as the
    /// transfer commands: mid-transfer `write_pty` is rejected, so a pane whose
    /// destination died produces no output and would otherwise never be swept.
    pub fn sweep(&self, sink: &dyn EventSink, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        sweep_locked(&mut state, sink, now);
    }
```

In `deliver`, drop the `_` from `_now`, call `sweep_locked(&mut state, sink,
now);` immediately after taking the lock, and replace the `Transferring` arm and
what follows the match:

```rust
        let mut overflowed: Option<(u32, String)> = None;
        match state.routes.get_mut(&pane_id) {
            Some(PaneRoute::Owned(label)) => sink.emit(label, event, &payload),
            Some(PaneRoute::Transferring(transfer)) => {
                transfer.buffered_bytes = transfer
                    .buffered_bytes
                    .saturating_add(estimate_bytes(&payload));
                transfer.buffered.push(BufferedEvent {
                    event: event.to_string(),
                    payload,
                });
                if transfer.buffered_bytes > BUFFER_MAX_BYTES {
                    overflowed = Some((pane_id, transfer.from.clone()));
                }
            }
            None => eprintln!("Deck: no route for pane {pane_id}, dropping {event}"),
        }
        // Settled after the match, not inside it: the arm holds a mutable
        // borrow of `state.routes`. The overflowing chunk was already pushed,
        // so the flush carries it too.
        if let Some((pane_id, source)) = overflowed {
            eprintln!(
                "Deck: transfer buffer for pane {pane_id} passed {BUFFER_MAX_BYTES} bytes, returning it to window {source}"
            );
            settle(
                &mut state,
                sink,
                pane_id,
                &source,
                Settled::Aborted(AbortReason::BufferFull),
            );
        }
```

In `begin_transfer`, `stage_payload`, `claim`, `commit` and `abort`, drop the
leading underscore from `_sink` / `_now` and insert directly after the lock:

```rust
        sweep_locked(&mut state, sink, now);
```

For `begin_transfer` this must run **before** the route match, so a pane whose
previous transfer expired can start a new one.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs
git commit -m "feat(coordinator): bound a transfer by timeout and buffer size"
```

---

### Task A5: Window death transitions and the orphan rule

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (add to `CoordinatorState`, `impl WindowCoordinator`, plus one free function)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `settle`, `sweep_locked` (A3, A4).
- Produces:
  - `WindowCoordinator::handle_window_destroyed(&self, sink: &dyn EventSink, label: &str, now: Instant) -> Vec<u32>` — pure; applies the §7.6 table and returns the orphaned pane ids.
  - `WindowCoordinator::abort_involving(&self, sink: &dyn EventSink, label: &str, now: Instant)` — pure; aborts every transfer where `label` is `from`, `to` or `reserved_to`.
  - `WindowCoordinator::all_panes(&self) -> Vec<u32>` — **public seam for the §9.4 quit census.** Counts `Owned` **and** `Transferring` panes.
  - Task A7 wraps the first two in `pub fn on_window_destroyed(app, label)` and `pub fn abort_transfers_involving(app, label)` — the two names the lifecycle section calls. They live in A7 because killing a pane needs `pty::terminate_pane`, which A7 creates.

**Why `all_panes` and `panes_for_window` must disagree.** `panes_for_window` is
for **killing** a closing window's panes, and a pane mid-transfer must not be
killed — it may be about to belong to someone else. `all_panes` is for the
**quit census**, and a pane mid-transfer must be counted — otherwise ⌘Q during a
detach reports no busy agents and silently kills one. Same state, opposite
answers, on purpose.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    #[test]
    fn a_destination_dying_before_claim_aborts_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .reserve_destination(&token, "deck-1")
            .expect("the new window registers its pending adoption");
        coordinator.deliver(&sink, 1, "pty:output", output("held"), now);

        let orphans = coordinator.handle_window_destroyed(&sink, "deck-1", now);

        assert!(orphans.is_empty(), "the pane never left main");
        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "held".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn a_destination_dying_after_claim_aborts_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), now);

        let orphans = coordinator.handle_window_destroyed(&sink, "deck-1", now);

        assert!(orphans.is_empty());
        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "held".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn a_source_dying_after_prepare_leaves_the_transfer_open() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), now);

        let orphans = coordinator.handle_window_destroyed(&sink, "main", now);

        // The pane outlives the window it came from, so it must NOT be killed
        // and the buffer must NOT be flushed to a dead window.
        assert!(orphans.is_empty());
        assert!(sink.delivered().is_empty());
        assert_eq!(coordinator.claim(&sink, &token, "deck-1", now), Ok(payload(1)));
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();
        assert_eq!(
            sink.delivered(),
            vec![("deck-1".to_string(), "held".to_string())]
        );
    }

    #[test]
    fn a_destroyed_window_orphans_the_panes_it_still_owns() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "deck-1".into());
        coordinator.register(2, "deck-1".into());
        coordinator.register(3, "main".into());

        let mut orphans = coordinator.handle_window_destroyed(&sink, "deck-1", now);
        orphans.sort();

        assert_eq!(orphans, vec![1, 2]);
        assert_eq!(coordinator.owner(1), None);
        assert_eq!(coordinator.owner(3).as_deref(), Some("main"));
        // Killed once, not once per event.
        assert!(coordinator
            .handle_window_destroyed(&sink, "deck-1", now)
            .is_empty());
    }

    #[test]
    fn a_transfer_whose_source_already_died_orphans_the_pane_when_it_aborts() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.handle_window_destroyed(&sink, "main", now);

        // Aborting now would hand the pane back to a window that is gone. It
        // has to be killed instead, or it leaks for the rest of the run.
        let orphans = coordinator.handle_window_destroyed(&sink, "deck-1", now);

        assert_eq!(orphans, vec![1]);
        assert_eq!(coordinator.owner(1), None);
    }

    #[test]
    fn the_quit_census_counts_a_pane_mid_move_and_the_kill_list_does_not() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.register(2, "main".into());
        coordinator.begin_transfer(&sink, "main", 2, now).unwrap();

        // Killing a pane that is mid-transfer would destroy a session another
        // window is about to adopt, so it stays out of the kill list...
        assert_eq!(coordinator.panes_for_window("main"), vec![1]);
        // ...but ⌘Q must still see it, or a busy agent dies without a prompt.
        let mut census = coordinator.all_panes();
        census.sort();
        assert_eq!(census, vec![1, 2]);
    }

    #[test]
    fn closing_a_window_aborts_every_transfer_it_takes_part_in() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.register(2, "deck-1".into());
        coordinator.register(3, "deck-2".into());

        // main is the source of one transfer and the destination of another.
        let outgoing = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        let incoming = coordinator.begin_transfer(&sink, "deck-1", 2, now).unwrap();
        coordinator
            .stage_payload(&sink, &incoming, "deck-1", payload(2), now)
            .unwrap();
        coordinator.claim(&sink, &incoming, "main", now).unwrap();
        // A third transfer main has nothing to do with must survive untouched.
        let unrelated = coordinator.begin_transfer(&sink, "deck-2", 3, now).unwrap();

        coordinator.abort_involving(&sink, "main", now);

        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
        assert_eq!(coordinator.owner(2).as_deref(), Some("deck-1"));
        assert_eq!(coordinator.owner(3), None, "the unrelated transfer is open");
        let reasons: Vec<&str> = sink
            .settled()
            .iter()
            .map(|(_, payload)| payload["reason"].as_str().unwrap_or_default())
            .collect();
        assert!(reasons.iter().all(|reason| *reason == "windowGone"));
        assert_eq!(
            coordinator.abort(&sink, &outgoing, now),
            Ok(()),
            "already aborted, so the retry is idempotent"
        );
        assert_eq!(coordinator.abort(&sink, &incoming, now), Ok(()));
        assert_eq!(
            coordinator.commit(&sink, &unrelated, "deck-2", now),
            Err(format!(
                "Transfer {unrelated} can only be committed by the window that claimed it"
            )),
            "untouched, not settled"
        );
    }

    #[test]
    fn a_transfer_expiring_back_to_a_dead_source_orphans_the_pane() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let start = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.begin_transfer(&sink, "main", 1, start).unwrap();
        // §7.6 row 3: the source dying does NOT abort. Nothing was staged, so
        // no destination can ever claim, and the timeout is what closes this.
        coordinator.handle_window_destroyed(&sink, "main", start);

        coordinator.sweep(&sink, start + TRANSFER_TIMEOUT);

        // Aborting to a window that no longer exists must not leave the pane
        // owned by a dead label, emitting into nothing for the rest of the run.
        assert_eq!(coordinator.owner(1), None);
        assert_eq!(coordinator.take_pending_orphans(), vec![1]);
        assert!(coordinator.take_pending_orphans().is_empty(), "drained once");
    }

    #[test]
    fn a_window_destroyed_after_commit_no_longer_affects_the_transfer() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert!(coordinator
            .handle_window_destroyed(&sink, "main", now)
            .is_empty());
        assert_eq!(coordinator.owner(1).as_deref(), Some("deck-1"));

        assert_eq!(
            coordinator.handle_window_destroyed(&sink, "deck-1", now),
            vec![1]
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0599]: no method named
`handle_window_destroyed`found for struct`WindowCoordinator``, plus the
same error for `all_panes`, `abort_involving` and `take_pending_orphans`.

- [ ] **Step 3: Implement the transition table and the orphan rule**

Add `HashSet` to the collections import, and the field:

```rust
#[derive(Default)]
struct CoordinatorState {
    routes: HashMap<u32, PaneRoute>,
    settled: HashMap<String, Settled>,
    settled_order: VecDeque<String>,
    /// Labels of windows already destroyed. Never reused within a process run
    /// (§9.1), so this cannot grow beyond the number of windows opened, and it
    /// is what catches a pane aborted back to a source that is already gone.
    dead: HashSet<String>,
    /// Panes a settle handed back to a window that no longer exists. Drained
    /// and killed by whoever holds an `AppHandle`.
    pending_orphans: Vec<u32>,
}
```

Amend `settle` (Task A3) so it cannot re-own a pane to a dead window. Replace
its `if !transfer.exited { … }` block with:

```rust
    // A pane may only be handed to a window that still exists. Aborting to a
    // source destroyed after `prepare` (§7.6 row 3) is exactly that case: the
    // route would name a dead label and every later chunk would be dropped and
    // logged for the rest of the process run. Queue it for the kill instead.
    if transfer.exited {
        // The PTY already exited; the deferred unregister lands here.
    } else if state.dead.contains(label) {
        state.pending_orphans.push(pane_id);
    } else {
        state
            .routes
            .insert(pane_id, PaneRoute::Owned(label.to_string()));
    }
```

Add to `impl WindowCoordinator`:

```rust
    /// Every live pane, transferring ones included. This is the §9.4 quit
    /// census, and it deliberately disagrees with `panes_for_window`: that one
    /// answers "what do I kill when this window closes", where a mid-transfer
    /// pane must be left alone; this one answers "is anything busy", where
    /// missing a mid-transfer pane kills a running agent without a prompt.
    #[allow(dead_code)] // wired by the window lifecycle section
    pub fn all_panes(&self) -> Vec<u32> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        state.routes.keys().copied().collect()
    }

    /// Abort every transfer this window takes part in, in either role. Called
    /// on `CloseRequested`, before the busy guard: a transfer left open across
    /// a close would hold the pane frozen until the timeout, and the guard
    /// would then run against a route nobody owns.
    #[allow(dead_code)] // gains its caller in A7
    pub fn abort_involving(&self, sink: &dyn EventSink, label: &str, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        sweep_locked(&mut state, sink, now);
        let involved: Vec<(u32, String)> = state
            .routes
            .iter()
            .filter_map(|(id, route)| match route {
                PaneRoute::Transferring(transfer)
                    if transfer.from == label
                        || transfer.to.as_deref() == Some(label)
                        || transfer.reserved_to.as_deref() == Some(label) =>
                {
                    Some((*id, transfer.from.clone()))
                }
                _ => None,
            })
            .collect();
        for (pane_id, source) in involved {
            settle(
                &mut state,
                sink,
                pane_id,
                &source,
                Settled::Aborted(AbortReason::WindowGone),
            );
        }
    }

    /// Take the panes that settled onto a dead window. The caller kills them —
    /// `sweep` and `abort` can strand a pane this way, and unlike
    /// `handle_window_destroyed` they have no orphan pass of their own.
    pub fn take_pending_orphans(&self) -> Vec<u32> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        std::mem::take(&mut state.pending_orphans)
    }
```

and:

```rust
    /// Apply the §7.6 transition table for a destroyed window and return the
    /// panes nothing will otherwise kill. Order matters and the rules are not
    /// symmetric: a dead DESTINATION aborts the transfer, a dead SOURCE does
    /// not — the destination can still claim and commit.
    pub fn handle_window_destroyed(
        &self,
        sink: &dyn EventSink,
        label: &str,
        now: Instant,
    ) -> Vec<u32> {
        let Ok(mut state) = self.state.lock() else {
            return Vec::new();
        };
        sweep_locked(&mut state, sink, now);
        state.dead.insert(label.to_string());

        // Transfers this window was going to receive — claimed, or merely
        // reserved by a window that died before it could claim.
        let aborting: Vec<(u32, String)> = state
            .routes
            .iter()
            .filter_map(|(id, route)| match route {
                PaneRoute::Transferring(transfer)
                    if transfer.to.as_deref() == Some(label)
                        || transfer.reserved_to.as_deref() == Some(label) =>
                {
                    Some((*id, transfer.from.clone()))
                }
                _ => None,
            })
            .collect();
        for (pane_id, source) in aborting {
            settle(
                &mut state,
                sink,
                pane_id,
                &source,
                Settled::Aborted(AbortReason::WindowGone),
            );
        }

        // Orphans: panes owned by a window that no longer exists. This is the
        // crash path — no CloseRequested fired and no busy guard ran, so
        // nothing else will ever kill them. A pane just aborted back to a
        // source that died earlier is caught here by the same rule.
        let mut orphans: Vec<u32> = state
            .routes
            .iter()
            .filter_map(|(id, route)| match route {
                PaneRoute::Owned(owner) if state.dead.contains(owner) => Some(*id),
                _ => None,
            })
            .collect();
        for pane_id in &orphans {
            state.routes.remove(pane_id);
        }
        // Anything an earlier sweep or abort stranded on a dead window, plus
        // whatever the aborts above just stranded — they never entered `routes`,
        // so the pass over `routes` cannot see them.
        orphans.append(&mut state.pending_orphans);
        orphans
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: PASS, 30 tests. Nothing calls `handle_window_destroyed` outside the
tests yet, so add `#[allow(dead_code)] // WindowEvent::Destroyed wiring (A7)`
above it to keep the build warning-free; A7 removes that attribute when
`on_window_destroyed` starts calling it.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs
git commit -m "feat(coordinator): apply window-death rules and kill orphaned panes"
```

---

### Task A6: The five transfer commands, and their registration

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (five commands, in the gap A1 left where `move_pane_ownership` stood at `:74-85`)
- Modify: `src-tauri/src/lib.rs:65-82`
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `begin_transfer`, `stage_payload`, `claim`, `commit`, `abort`, `AdoptionPayload`, `AppSink`.
- Produces the frozen contract, verbatim:
  - `prepare_transfer(window: WebviewWindow, coordinator: State<'_, WindowCoordinator>, pane_id: String) -> Result<String, String>`
  - `stage_transfer(window, coordinator, token: String, payload: AdoptionPayload) -> Result<(), String>`
  - `claim_transfer(window, coordinator, token: String) -> Result<AdoptionPayload, String>`
  - `commit_transfer(window, coordinator, token: String) -> Result<(), String>`
  - `abort_transfer(window, coordinator, token: String) -> Result<(), String>`
  - `parse_pane_id(pane_id: &str) -> Result<u32, String>`

The command bodies carry no logic beyond parse → sink → delegate, and
`WebviewWindow` cannot be constructed in a unit test, so only `parse_pane_id`
gets a test here. Everything else is already covered on the pure layer.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    #[test]
    fn pane_id_crosses_as_a_string_and_must_parse() {
        assert_eq!(super::parse_pane_id("12"), Ok(12));
        assert_eq!(
            super::parse_pane_id("pane-12"),
            Err("Pane id pane-12 is not a number".into())
        );
        assert_eq!(
            super::parse_pane_id(""),
            Err("Pane id  is not a number".into())
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml pane_id_crosses`

Expected: FAIL to compile — `error[E0425]: cannot find function `parse_pane_id`in module`super``.

- [ ] **Step 3: Add the five commands**

A1 already deleted `move_pane_ownership`. Put these where it stood, between
`emit_to_owner` and `#[cfg(test)] mod tests`:

```rust
/// The frontend addresses panes as strings; the coordinator keys them on the
/// `u32` `spawn_shell` returned.
fn parse_pane_id(pane_id: &str) -> Result<u32, String> {
    pane_id
        .parse::<u32>()
        .map_err(|_| format!("Pane id {pane_id} is not a number"))
}

/// Open a transfer and start buffering the pane's output (§7.3).
#[tauri::command]
pub fn prepare_transfer(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    pane_id: String,
) -> Result<String, String> {
    let sink = AppSink(window.app_handle());
    coordinator.begin_transfer(
        &sink,
        window.label(),
        parse_pane_id(&pane_id)?,
        Instant::now(),
    )
}

/// The source puts up the payload it serialized once the stream quiesced (§7.4).
#[tauri::command]
pub fn stage_transfer(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    token: String,
    payload: AdoptionPayload,
) -> Result<(), String> {
    let sink = AppSink(window.app_handle());
    coordinator.stage_payload(&sink, &token, window.label(), payload, Instant::now())
}

/// The destination takes the payload and becomes the pane's receiver.
#[tauri::command]
pub fn claim_transfer(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    token: String,
) -> Result<AdoptionPayload, String> {
    let sink = AppSink(window.app_handle());
    coordinator.claim(&sink, &token, window.label(), Instant::now())
}

/// Hand the pane over and flush what buffered, in read order.
#[tauri::command]
pub fn commit_transfer(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    token: String,
) -> Result<(), String> {
    let sink = AppSink(window.app_handle());
    coordinator.commit(&sink, &token, window.label(), Instant::now())
}

/// Give the pane back to its source and flush what buffered.
#[tauri::command]
pub fn abort_transfer(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    token: String,
) -> Result<(), String> {
    let sink = AppSink(window.app_handle());
    coordinator.abort(&sink, &token, Instant::now())
}
```

Widen the tauri import — this is where the three names A1 deliberately left out
come back, and all three now have a user:
`use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};`
(`State` and `WebviewWindow` for the command parameters, `Manager` for
`window.app_handle()`). A7 needs no further import change.

In the `invoke_handler` list in `lib.rs` (`:65-82` before A1 removed one line
from it), add the five commands where `coordinator::move_pane_ownership,` used
to sit — after `platform::desktop_environment,` and before `info::pty_info,`:

```rust
            coordinator::prepare_transfer,
            coordinator::stage_transfer,
            coordinator::claim_transfer,
            coordinator::commit_transfer,
            coordinator::abort_transfer,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: PASS, 31 coordinator tests plus the existing suites. No warning about
an unused `move_ownership`, because A1 deleted the method with it.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/coordinator.rs src-tauri/src/lib.rs
git commit -m "feat(coordinator): register the five pane transfer commands"
```

---

### Task A7: Owner validation on `write_pty`, `resize_pty` and `kill_pty`

**Files:**

- Modify: `src-tauri/src/coordinator.rs` (add `PaneAccessError`, `access` and `on_window_destroyed`)
- Modify: `src-tauri/src/pty.rs:440-500` (three commands + `terminate_pane` extraction)
- Test: `src-tauri/src/coordinator.rs` (`mod tests`)

**Interfaces:**

- Consumes: `PaneRoute` (A1), `sweep` (A4), `handle_window_destroyed` (A5).
- Produces:
  - `pub enum PaneAccessError { NotRouted(u32), Transferring(u32), OwnedByOther { pane_id: u32, owner: String } }` with `Display`
  - `WindowCoordinator::access(&self, pane_id: u32, caller: &str) -> Result<(), PaneAccessError>`
  - `pty::terminate_pane(state: &PtyState, id: u32) -> Result<(), String>` — kills without consulting the coordinator; used by `coordinator::on_window_destroyed`.
  - `pub fn coordinator::on_window_destroyed(app: &AppHandle, label: &str)` — **public seam: the only thing the `WindowEvent::Destroyed` handler should call.** The window-lifecycle section wires the event to it.
  - `write_pty` and `resize_pty` gain **both** `window: WebviewWindow` and `coordinator: State<'_, WindowCoordinator>`. `kill_pty` gains **only** `window` — it already takes `coordinator` (`pty.rs:473`) and already calls `coordinator.unregister(id)` (`:498`). Their `id`/`data`/`cols`/`rows` arguments are unchanged, so the frontend keeps sending the same payload.

The three command bodies are again untestable (`WebviewWindow`), so the
assertions live on `access`.

- [ ] **Step 1: Write the failing test**

Append inside `mod tests`:

```rust
    use super::PaneAccessError;

    #[test]
    fn only_the_owning_window_may_reach_a_pane() {
        let coordinator = WindowCoordinator::default();
        coordinator.register(1, "main".into());

        assert_eq!(coordinator.access(1, "main"), Ok(()));
        assert_eq!(
            coordinator.access(1, "deck-1"),
            Err(PaneAccessError::OwnedByOther {
                pane_id: 1,
                owner: "main".into()
            })
        );
        assert_eq!(
            coordinator.access(9, "main"),
            Err(PaneAccessError::NotRouted(9))
        );
    }

    #[test]
    fn a_transferring_pane_is_frozen_for_every_caller() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        // Not just for the destination — the SOURCE is refused too, which is
        // what stops TerminalManager.dispose() -> killAll() from killing a PTY
        // that has already been handed over.
        assert_eq!(
            coordinator.access(1, "main"),
            Err(PaneAccessError::Transferring(1))
        );
        assert_eq!(
            coordinator.access(1, "deck-1"),
            Err(PaneAccessError::Transferring(1))
        );

        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert_eq!(coordinator.access(1, "deck-1"), Ok(()));
        assert_eq!(
            coordinator.access(1, "main"),
            Err(PaneAccessError::OwnedByOther {
                pane_id: 1,
                owner: "deck-1".into()
            })
        );
    }

    #[test]
    fn access_errors_read_as_sentences() {
        assert_eq!(
            PaneAccessError::NotRouted(3).to_string(),
            "Pane #3 is not registered"
        );
        assert_eq!(
            PaneAccessError::Transferring(3).to_string(),
            "Pane #3 is being moved to another window"
        );
        assert_eq!(
            PaneAccessError::OwnedByOther {
                pane_id: 3,
                owner: "deck-1".into()
            }
            .to_string(),
            "Pane #3 belongs to window deck-1"
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml coordinator`

Expected: FAIL to compile — `error[E0432]: unresolved import
`super::PaneAccessError`` and `error[E0599]: no method named `access``.

- [ ] **Step 3: Add `access`, then validate the three PTY commands**

In `coordinator.rs`, above `impl WindowCoordinator`:

```rust
/// Why a window may not act on a pane (§8).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PaneAccessError {
    /// No route at all — the PTY already exited, or never registered.
    NotRouted(u32),
    /// Frozen for the duration of a handoff, for every caller.
    Transferring(u32),
    OwnedByOther { pane_id: u32, owner: String },
}

impl std::fmt::Display for PaneAccessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRouted(pane_id) => write!(formatter, "Pane #{pane_id} is not registered"),
            Self::Transferring(pane_id) => {
                write!(formatter, "Pane #{pane_id} is being moved to another window")
            }
            Self::OwnedByOther { pane_id, owner } => {
                write!(formatter, "Pane #{pane_id} belongs to window {owner}")
            }
        }
    }
}
```

Add to `impl WindowCoordinator`:

```rust
    /// May `caller` act on this pane? Mid-transfer the answer is no for
    /// everyone, including the source (§8).
    pub fn access(&self, pane_id: u32, caller: &str) -> Result<(), PaneAccessError> {
        let Ok(state) = self.state.lock() else {
            return Err(PaneAccessError::NotRouted(pane_id));
        };
        match state.routes.get(&pane_id) {
            Some(PaneRoute::Owned(label)) if label == caller => Ok(()),
            Some(PaneRoute::Owned(label)) => Err(PaneAccessError::OwnedByOther {
                pane_id,
                owner: label.clone(),
            }),
            Some(PaneRoute::Transferring(_)) => Err(PaneAccessError::Transferring(pane_id)),
            None => Err(PaneAccessError::NotRouted(pane_id)),
        }
    }
```

Add the reaping helper to `coordinator.rs`, above `emit_to_owner`:

```rust
/// Enforce the transfer timeout and kill whatever it stranded. Every PTY
/// command calls this: mid-transfer they are all rejected, so nothing else
/// would notice a transfer whose destination died, and a pane settled back onto
/// a window that is already gone has no owner left to kill it.
pub fn sweep_and_reap(app: &AppHandle, coordinator: &WindowCoordinator) {
    coordinator.sweep(&AppSink(app), Instant::now());
    let orphans = coordinator.take_pending_orphans();
    if orphans.is_empty() {
        return;
    }
    let pty_state = app.state::<crate::pty::PtyState>();
    for pane_id in orphans {
        if let Err(error) = crate::pty::terminate_pane(&pty_state, pane_id) {
            eprintln!("Deck: stranded pane {pane_id} was not killed: {error}");
        }
    }
}
```

In `pty.rs`, extend the coordinator import:

```rust
use crate::coordinator::{emit_to_owner, sweep_and_reap, PaneAccessError, WindowCoordinator};
```

`sweep_and_reap` owns the clock, so `pty.rs` needs no new `std::time` import.

Replace `write_pty` (`pty.rs:440-451`):

```rust
#[tauri::command]
pub fn write_pty(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    state: State<'_, PtyState>,
    id: u32,
    data: String,
) -> Result<(), String> {
    sweep_and_reap(window.app_handle(), &coordinator);
    coordinator
        .access(id, window.label())
        .map_err(|error| error.to_string())?;
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal session #{id} not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}
```

Replace `resize_pty` (`pty.rs:453-468`):

```rust
#[tauri::command]
pub fn resize_pty(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    state: State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sweep_and_reap(window.app_handle(), &coordinator);
    coordinator
        .access(id, window.label())
        .map_err(|error| error.to_string())?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal session #{id} not found"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
```

Replace `kill_pty` (`pty.rs:470-500`) with an extraction plus a validating
command. The body of `terminate_pane` is `kill_pty`'s current body verbatim,
including its comment — this is a move, not a rewrite of the kill path:

```rust
/// Kill a session without consulting the coordinator. `kill_pty` validates the
/// calling window first; `coordinator::on_window_destroyed` cannot, because the
/// window it would validate against is the one that just died.
///
/// `terminate_session` stays under the lock so a failure leaves the session in
/// the map, retryable. The removed `Session` must not be *dropped* here,
/// though: it owns the last handle to the PTY master, so dropping it closes the
/// pseudoconsole — and on Windows that blocks until conhost flushes its output
/// pipe, while the only thread draining that pipe takes this very lock in
/// `consume_shell_integration`. Hand the value out of the scope and let it drop
/// once the guard is gone.
pub fn terminate_pane(state: &PtyState, id: u32) -> Result<(), String> {
    let removed = {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        match sessions.get_mut(&id) {
            Some(session) => {
                platform::terminate_session(
                    &session.platform,
                    platform::foreground_process_group(session.master.as_ref()),
                    session.killer.as_mut(),
                )?;
                sessions.remove(&id)
            }
            None => None,
        }
    };
    drop(removed);
    Ok(())
}

#[tauri::command]
pub fn kill_pty(
    window: WebviewWindow,
    coordinator: State<'_, WindowCoordinator>,
    state: State<'_, PtyState>,
    id: u32,
) -> Result<(), String> {
    sweep_and_reap(window.app_handle(), &coordinator);
    match coordinator.access(id, window.label()) {
        Ok(()) => {}
        // A pane whose PTY already exited has no route, and today's kill_pty
        // returns Ok for a session that is no longer in the map.
        // TerminalManager.dispose() -> killAll() hits exactly that case on
        // every window close, so keep it a no-op rather than a surfaced error.
        Err(PaneAccessError::NotRouted(_)) => return Ok(()),
        Err(error) => return Err(error.to_string()),
    }
    terminate_pane(&state, id)?;
    coordinator.unregister(id);
    Ok(())
}
```

Last, in `coordinator.rs`, drop the `#[allow(dead_code)]` A5 put on
`handle_window_destroyed` and add its caller at the end of the file, above
`#[cfg(test)]`:

```rust
/// Entry point for `WindowEvent::Destroyed`. Applies the §7.6 rules, then kills
/// the panes no live window owns. Killing goes through `pty::terminate_pane`
/// rather than the `kill_pty` command: there is no live window left to validate
/// the caller against.
pub fn on_window_destroyed(app: &AppHandle, label: &str) {
    let coordinator = app.state::<WindowCoordinator>();
    let orphans = coordinator.handle_window_destroyed(&AppSink(app), label, Instant::now());
    let pty_state = app.state::<crate::pty::PtyState>();
    for pane_id in orphans {
        if let Err(error) = crate::pty::terminate_pane(&pty_state, pane_id) {
            eprintln!("Deck: orphaned pane {pane_id} of window {label} was not killed: {error}");
        }
    }
}
```

and, beside it, the `CloseRequested` counterpart:

```rust
/// Entry point for `WindowEvent::CloseRequested`, to run BEFORE the busy guard.
/// Aborts every transfer this window takes part in, then kills whatever those
/// aborts stranded on a window that is already gone.
pub fn abort_transfers_involving(app: &AppHandle, label: &str) {
    let coordinator = app.state::<WindowCoordinator>();
    coordinator.abort_involving(&AppSink(app), label, Instant::now());
    let pty_state = app.state::<crate::pty::PtyState>();
    for pane_id in coordinator.take_pending_orphans() {
        if let Err(error) = crate::pty::terminate_pane(&pty_state, pane_id) {
            eprintln!("Deck: stranded pane {pane_id} was not killed: {error}");
        }
    }
}
```

`Manager` is already in the tauri import from A6 (`window.app_handle()` needs
it), so no import change is required here.

Nothing calls `on_window_destroyed` or `abort_transfers_involving` until the
window-lifecycle section wires `WindowEvent::Destroyed` and `CloseRequested`, so
both need `#[allow(dead_code)] // wired by the window lifecycle section` until
then — the same marker `panes_for_window` has carried since the coordinator was
written. Drop the marker A5 put on `handle_window_destroyed` and A5's marker on
`abort_involving` in the same pass: both now have a caller in this file.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: PASS — 34 coordinator tests and every existing `pty` test unchanged.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git add src-tauri/src/coordinator.rs src-tauri/src/pty.rs
git commit -m "feat(pty): reject PTY commands from a window that does not own the pane"
```

---

## Findings

### (a) Spec claims checked against the code

- **Every `§5` line reference in this section's scope is accurate.**
  `coordinator.rs:7-10` (owner map), `:60-72` (`emit_to_owner`), `:70` (the
  broadcast fallback), `:44-55` (`panes_for_window`), `:74-85`
  (`move_pane_ownership`), `lib.rs:65-82` (`invoke_handler`), `pty.rs:441`
  (`write_pty`), `:454` (`resize_pty`), `:471` (`kill_pty`) all land where the
  spec says. Nothing stale to report.
- **The spec was verified against `e62fe61`; HEAD is now `289a12a`.** The three
  files this section touches are clean in the working tree and unchanged by the
  intervening commits, which are Windows test fixes.
- **`uuid` is NOT a dependency of `src-tauri/Cargo.toml`** (checked in full).
  §7.2 sketches `token: Uuid`. Adding a crate is a fork I am not deciding, so
  the plan uses a process-monotonic counter rendered as `xfer-<n>`, matching the
  frozen contract's `String` token and the same never-reuse argument §9.1 makes
  for `deck-<n>` window labels. **If the lead wants a real UUID, that is a
  dependency fork to raise.**
- **serde convention found: `camelCase`** — `links.rs:140`, `prompt_assets.rs:39`,
  `platform/mod.rs:43`. `AdoptionPayload` follows it; the single-word payload
  structs in `pty.rs` carry no `rename_all` because they need none.

### (b) Deviations from §7.2 as written, all deliberate

1. `token: Uuid` → `token: String` (above).
2. `buffered: Vec<String>` → `Vec<BufferedEvent { event, payload }>`. A `String`
   cannot carry the §7.6 row "PTY exits mid-transfer → delivered on commit",
   because the exit is a different event name with a different payload shape.
3. Three fields added to `Transferring`: `staged` (the fifth command's payload),
   `reserved_to` (§7.6 row 1 — see (c)), `exited` (see (e)). Plus
   `buffered_bytes` for the §7.5 cap.
4. `Transferring` holds a named `Transfer` struct rather than inline enum
   fields. Same state; it lets one helper return `&mut Transfer`.
5. **Emission happens inside the route lock, for the normal path too**, via an
   `EventSink` trait. §7.2 already requires this for the flush; extending it to
   `deliver` is what makes the ordering invariant structural instead of
   probabilistic, and it is the only way the §14 tests can run at all —
   `AppHandle` is unconstructible in a unit test.

### (b2) Added during merge reconciliation, 2026-08-10

- **`transfer:settled` is new**, at the frontend section's request: after
  `stage_transfer` the source has no signal at all, so §13's "a failed commit
  leaves the pane with the source" was unimplementable. Emitted to both ends
  inside the settling lock, once per transfer, after the flush. It also serves
  as the drag section's adopt ack, so no second ack should be invented.
- **`all_panes()` and `abort_transfers_involving` added** for the lifecycle
  section; `all_panes` closes what was finding (f) below.
- `on_window_destroyed` keeps its name; the lifecycle section renames its
  `orphan_window` to match.

### (c) Contracts the other sections must honour

- **Window lifecycle section — two seams, both public and both required:**
  - `WindowCoordinator::reserve_destination(token, label)` must be called from
    `open_pane_window` when a window is created to receive a transfer.
    Without it, §7.6 row 1 (destination destroyed before `claim`) degrades from
    an immediate abort to a 10 s timeout. It is not optional.
  - `coordinator::on_window_destroyed(app, label)` is the **only** thing the
    `WindowEvent::Destroyed` handler should call. It applies the transition
    table and kills the orphans; calling `kill_pty` alongside it would fail
    validation against a dead window.
- **Frontend section:** `prepare_transfer` takes `pane_id` as a **String**
  (frozen contract), parsed to `u32` inside. Every other id in the PTY commands
  stays a number. `AdoptionPayload` field names over the wire are exactly
  `paneId, cwd, agentId, scrollback, cols, rows, tabName, dotColor,
workspacePath`. Tauri camelCases command arguments too, so the invoke keys are
  `paneId`, `token` and `payload` — not `pane_id`.
- **Frontend section:** `write_pty`, `resize_pty` and `kill_pty` now reject
  **every** caller while a transfer is open, including the source. §7.4 already
  says the write chain must await the transfer rather than drop input; that
  awaiting is the frontend's to build, and without it a Prompt Board injection
  mid-detach surfaces `Pane #n is being moved to another window`.
- **Drag section:** nothing in this section is drag-aware. A drop resolves to
  the same five commands, and `transfer:settled` is the adopt ack — do not
  invent a second one.
- **Not mine, do not duplicate:** the lifecycle section owns the `lib.rs:85-93`
  `ExitRequested` bug (every unconfirmed exit is prevented, safe today only
  because the single window cannot close). Nothing in Section A touches it.

### (d) Two calls I made that the lead can veto

- **`move_pane_ownership` is deleted.** Grep across `src/`, `src-tauri/src/` and
  `scripts/` shows its only reference is its own registration in `lib.rs:71` —
  **no frontend caller exists**. It flips ownership without buffering, which is
  precisely the race §7.1 calls a bug, so leaving it registered would leave a
  live path around the transaction.
- **`kill_pty` on an unrouted pane returns `Ok(())`, not `Err`.** §8 says
  "anything else → `Err`". Today `kill_pty` returns `Ok` for a session that is
  not in the map, and `TerminalManager.dispose() → killAll()`
  (`terminal-manager.ts:696`, `life.killAll()` at `:699`) hits already-exited
  panes on every window close.
  Spec-literal would convert a routine no-op into a surfaced error.

### (e) Two gaps in §7.6 this plan closes

**The spec does not say what `unregister` does mid-transfer, and the obvious
answer breaks the table.** `pty.rs:417-429`: on EOF the emitter thread emits the
exit event and then calls `coordinator.unregister(id)`. If `unregister` removed
a `Transferring` route, it would delete the buffer holding the exit event it
just emitted, and `commit_transfer` would then fail with "not open" — directly
contradicting the row "PTY exits mid-transfer → delivered on commit". The rule
added here: `unregister` on a `Transferring` route sets `exited = true` and
keeps the entry; `settle` flushes, then drops the route instead of writing
`Owned(...)`, so no route for a dead pane is left behind. Task A3 carries the
test.

**§7.6 row 3 has no exit if nothing was staged.** "Source destroyed after
`prepare` → do not abort" is right, but trace it with a source that died between
`prepare` and `stage`: nothing was staged, so no destination can ever `claim`,
so the only way out is the §7.5 timeout — which aborts back to `from`, a window
that no longer exists. A literal reading leaves the pane `Owned("main")` with
`main` destroyed: its PTY keeps running and every chunk it produces is dropped
and logged for the rest of the process run. The rule added here: `settle` refuses
to hand a pane to a label in `dead` and queues it instead, and
`take_pending_orphans` + `sweep_and_reap` kill it on the next PTY command. Task
A5 carries the test. The same trap catches an abort whose source died earlier —
that path is tested too.

### (f) Forks I hit and did NOT decide

- **Adding `uuid`** — see (a). Flagged, not taken.
- **Whether the destroyed-window path should ask the busy guard first.** §9.5
  gives `CloseRequested` a guard; §7.6's orphan rule is the crash path and kills
  unconditionally. This section implements the orphan rule as specified. If the
  lifecycle section wants `Destroyed` to consult anything, that is its call and
  it changes `on_window_destroyed`.
- ~~What `panes_for_window` should report during a transfer.~~ **Closed by the
  lead, 2026-08-10:** `all_panes()` is the second accessor, counting `Owned` and
  `Transferring`; `panes_for_window` keeps filtering `Owned` only. Killing and
  counting are different questions and now have different answers.

---

## Section B — Window lifecycle (Rust)

_Owns spec §9: window creation and hardening, capability scope, boot mode, menu routing, the quit census, per-window close, the settings patch merge and the updater single-flight._

# Plan section B — Rust window lifecycle (spec §9)

**Scope:** the Rust side of spec §9 only — window creation, boot mode, menu
routing, quit census, window close, settings patch merge, updater single-flight,
and the `Destroyed` wiring into the coordinator's orphan rule. No `.ts`/`.tsx`
implementation. `coordinator.rs` internals belong to the transfer section; this
section only calls into it.

**Verification commands** (from `.github/workflows/ci.yml`):

- `cargo test --locked --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `npm test` and `npm run build` (this repo uses npm), plus
  `npm run generate:menu:check` because Task B6 touches `menu.rs`.

**No new Rust dependency is introduced by this section.** Tokens cross this
boundary as opaque `String`s; if the transfer section wants `uuid`, that is its
fork to raise, not this one's.

**Anchors re-verified at HEAD `289a12a`** (the spec was written against
`e62fe61`; the unified icon system has since landed as commits). Every
`src-tauri` line reference in this draft was re-checked and is unchanged. One
frontend anchor moved: the updater check is now **`src/ui/app.tsx:321`**, not
`:334` as the spec's §5 table implies. The working tree also carries another
session's release-notes work (`.github/workflows/release.yml`,
`scripts/release-workflow.test.ts`, untracked `scripts/generate-release-notes.*`,
plus doc edits) — this section touches none of those files, and no task here
may stage them.

## Frozen contract consumed from `coordinator.rs`

Owned by the transfer section, used verbatim here:

```rust
prepare_transfer(window, pane_id: String) -> Result<String, String>   // token
stage_transfer(window, token: String, payload: AdoptionPayload) -> Result<(), String>
claim_transfer(window, token: String) -> Result<AdoptionPayload, String>
commit_transfer(window, token: String) -> Result<(), String>
abort_transfer(window, token: String) -> Result<(), String>
```

Five further coordinator entry points are **defined by the transfer section** and
called here. Names and signatures pinned by the merge lead — do not rename, and
note that two of them were **corrected on 2026-08-10** after a reviewer caught
that §0.2 had shown short forms: `begin_transfer` gained `sink` and `now`, and
`abort_transfers_involving` gained the app handle. Both extra arguments are
load-bearing.

- `abort_transfers_involving(app: &AppHandle, label: &str)` — aborts every route
  whose `from` or `to` is `label`, flushing each buffer per §7.6. Used by Task
  B11 (`CloseRequested`). **Takes the app handle** because aborting emits
  `transfer:settled` to the windows that are still alive — precisely the case
  the close path hits. Written here as a free function in the `coordinator`
  module, matching §0.2's amended signature and the existing
  `coordinator::emit_to_owner` idiom (`coordinator.rs:60-72`). If it is in fact
  a method taking `&self`, the single call site becomes
  `app.state::<WindowCoordinator>().abort_transfers_involving(app, &label)` —
  a one-line change, and a compile error either way.
- `WindowCoordinator::on_window_destroyed(&self, app: &tauri::AppHandle, label: &str)`
  — the §7.6 orphan rule: kill every pane still `Owned(label)`, and do **not**
  abort a transfer whose `from` is that label (a source may die after `prepare`;
  the destination still commits). Used by Task B12. **It is the only call in the
  `Destroyed` handler.** Do not call `kill_pty` or `terminate_pane` beside it:
  owner validation (§8) is evaluated against a window that no longer exists, so
  a second teardown path would fail and, worse, could race the one inside the
  coordinator.
- `WindowCoordinator::all_panes(&self) -> Vec<u32>` — every pane the coordinator
  knows, **`Owned` and `Transferring` alike**. Used by Task B10's quit census so
  a pane mid-move is still counted. This is deliberately _not_ the same set as
  `panes_for_window`, which returns owned panes only and is what Task B11 kills.
  The two disagree exactly while a transfer is open, and Task B10 has a test for
  that state.
- `WindowCoordinator::reserve_destination(&self, token: &str, label: &str)` —
  records, at window-creation time, which label a token is destined for.
  Called by Task B4. **Not optional:** without the reservation, §7.6 row 1
  (destination destroyed before `claim`) cannot be detected as an abort and
  degrades into the 10-second `prepare` timeout of §7.5.

- `WindowCoordinator::begin_transfer(&self, sink: &dyn EventSink, from: &str, pane_id: u32, now: Instant) -> Result<String, String>`
  — the inherent method behind the `prepare_transfer` command. Used **only** by
  Task B10's census test, which needs a route genuinely in `Transferring` and
  cannot construct the `tauri::Window` the command takes. The `sink` and the
  injected `now` are what make that method callable from a unit test at all:
  `AppHandle` cannot be built in one, and reading a wall clock inside would make
  §7.5's 10-second bound untestable.

**One thing this section needs from the transfer section's test surface** —
raised, not decided: a `pub(crate)` implementor of `EventSink` that records
instead of emitting. Task B10's test must pass _something_ as `&dyn EventSink`,
and inventing a second one here would duplicate the double the transfer
section's own tests already need. This plan writes it as
`coordinator::test_support::RecordingSink`; if that section names it differently
or keeps it private to its `#[cfg(test)] mod tests`, either rename this one call
or widen its visibility. If no such double exists, this single test cannot be
written and the lead should hear so before merge — the rest of the census work
is unaffected.

If any of these is absent when its task runs, `cargo build` fails with
`no method named <name> found for struct WindowCoordinator` or an arity/type
mismatch at the call. That compile error **is** the loud failure. Do not stub
any of them locally in this section; stop and reconcile with the transfer
section instead. Return types are the transfer section's to pin — this plan
calls `reserve_destination` as `-> Result<(), String>` and `all_panes` as
`-> Vec<u32>`; a mismatch is again a compile error, not something to paper over.

`AdoptionPayload` is referenced by type name only. This section never reads or
writes its fields.

## Verified source facts this section builds on

Every line reference below was read in the working tree, and re-verified at
HEAD `289a12a`.

| Fact                                                                                                                    | Where                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `QuitState` + `confirm_quit` (no arguments) exist today                                                                 | `src-tauri/src/lib.rs:17-26`                            |
| `.manage(...)` chain (PtyState, WindowCoordinator, QuitState)                                                           | `src-tauri/src/lib.rs:46-49`                            |
| `setup()` hardens only the windows that exist at startup, with a comment saying a second window needs the same call     | `src-tauri/src/lib.rs:50-64`                            |
| `invoke_handler` list — **shared file, see the collision note below**                                                   | `src-tauri/src/lib.rs:65-82`                            |
| `RunEvent::ExitRequested` handler prevents exit and broadcasts `quit-requested`                                         | `src-tauri/src/lib.rs:85-93`                            |
| No `on_window_event` handler is registered anywhere in `src-tauri`                                                      | `src-tauri/src/lib.rs` (absent), grep over `src-tauri/` |
| Menu events broadcast: `handle.emit("quit-requested")` / `handle.emit("menu:action")`                                   | `src-tauri/src/menu.rs:143-150`                         |
| `QUIT_MENU_ID` and `ACTION_PREFIX` are `#[cfg(target_os = "macos")]`                                                    | `src-tauri/src/menu.rs:12-18`                           |
| `menu.rs`'s test module is **not** macOS-gated (CI runs `cargo test` on ubuntu)                                         | `src-tauri/src/menu.rs:159-216`                         |
| `harden_webview` must run on the main event-loop thread; off-thread it returns `Ok` for "enqueued", not "ran"           | `src-tauri/src/platform/windows/webview.rs:19-32`       |
| `harden_webview` is a no-op returning `Ok(())` off Windows                                                              | `src-tauri/src/platform/mod.rs:28-32`                   |
| Capability is scoped to one label                                                                                       | `src-tauri/capabilities/default.json:5`                 |
| `panes_for_window` exists and carries `#[allow(dead_code)]`                                                             | `src-tauri/src/coordinator.rs:44-55`                    |
| `PtyState::session_snapshots(&self, ids) -> Vec<PtySessionSnapshot>` is `pub` and non-blocking                          | `src-tauri/src/pty.rs:789-840`                          |
| Process classification into `IdleShell`/`Agent`/`Busy`/`Unknown` **already lives in Rust**                              | `src-tauri/src/info.rs:12-67`                           |
| `pty_info` owns the platform split, including `spawn_blocking` for the slow Windows WMI path                            | `src-tauri/src/info.rs:186-205`                         |
| Frontend busy predicate is `kind === "agent" \|\| kind === "busy"`                                                      | `src/terminal/close-guard.ts:7-9`                       |
| Frontend dialog copy needs (names, busy pane count, "fully named") — exactly what Rust can compute                      | `src/terminal/close-guard.ts:69-121`                    |
| Frontend installs its own `onCloseRequested` guard today                                                                | `src/lib/quit-guard.ts:48-51`                           |
| `updateSettings` does a local read-modify-write of the whole object                                                     | `src/settings/settings-store.ts:66-70`                  |
| Settings live in store file `settings.json` under key `settings`                                                        | `src/settings/settings-store.ts:11-12`                  |
| Updater check fires once per `App` mount, unconditionally                                                               | `src/ui/app.tsx:321` (`void updater.start()`)           |
| Tauri auto-prevents a close when the window has a JS `tauri://close-requested` listener                                 | `tauri-2.11.5/src/manager/window.rs:170-175`            |
| `RunEvent::ExitRequested.code` is `None` for user-driven exit, `Some(_)` for `app.exit()` / `restart()`                 | `tauri-2.11.5/src/app.rs:225-232`, `:76-95`             |
| `run_on_main_thread` executes **inline** when already on the main thread, and enqueues otherwise                        | `tauri-runtime-wry-2.11.4/src/lib.rs:235-255`, `:1982`  |
| `WebviewWindowBuilder::from_config` exists and its docs prescribe async commands to avoid the Windows creation deadlock | `tauri-2.11.5/src/webview/webview_window.rs:110-130`    |
| Capability `windows` is `array<string>` and the schema documents glob patterns                                          | `src-tauri/gen/schemas/desktop-schema.json` (see B5)    |
| `StoreExt::store(path)` returns the already-loaded instance if the JS side loaded it                                    | `tauri-plugin-store-2.4.3/src/lib.rs:243-260`           |

## File-ownership collisions

Serialize these against the other sections when merging:

- **`src-tauri/src/lib.rs`** — this section adds module declarations (after
  line 12), managed state (after `lib.rs:48`), an `.on_window_event(...)` clause
  between `.invoke_handler(...)` and `.build(...)`, **eleven** entries in
  `generate_handler!` (`lib.rs:65-82`), and rewrites the `RunEvent` closure
  (`lib.rs:85-93`). It also **deletes** `QuitState` and the current
  `confirm_quit` (`lib.rs:17-26`, `lib.rs:49`, `lib.rs:81`, and the `AtomicBool`
  import at `lib.rs:14`) — **all four sites in Task B10**, because leaving any of
  them makes every `cargo test` between B10 and B15 fail. The transfer section
  adds its own five commands to the same `generate_handler!` block. Land one
  section's `invoke_handler` edit at a time.
- **`src-tauri/src/coordinator.rs`** — this section never edits it, only calls
  it. `move_pane_ownership` (`coordinator.rs:74-85`) is not used by this
  section.
- **`src-tauri/src/info.rs`** — only this section edits it (Task B9 extraction).
- **`src/lib/quit-guard.ts`, `src/ui/app.tsx`, `src/settings/settings-store.ts`**
  — read here to pin wire contracts; edited only by the frontend section.

## Wire contracts this section produces

The frontend section consumes exactly these and nothing else:

| Surface                              | Direction    | Shape                                                                                                |
| ------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------- |
| `window_boot_mode()`                 | command      | `{"kind":"normal"}` or `{"kind":"adopt","token":"<opaque string>"}`                                  |
| `open_pane_window(args)`             | command      | args `{ token, screenX?, screenY? }` (**CSS px**) → `Result<String, String>`, the new window's label |
| `offer_transfer(token, targetLabel)` | command      | `Result<(), String>` — `Err` when `targetLabel` is not a live window                                 |
| `transfer:offer`                     | Rust → 1 win | `{"token":"<opaque string>"}` — live-adopt handoff into a running window                             |
| `focus_order()`                      | command      | `string[]` — live window labels, most recently focused first                                         |
| `menu:action`                        | Rust → 1 win | `string` (unchanged payload, no longer broadcast)                                                    |
| `menu:move-pane-to-window`           | Rust → 1 win | `{"targetLabel":"<label>"}` — the dynamic submenu's click                                            |
| `quit-requested`                     | Rust → 1 win | `{"requestId":<u64>,"busyProcesses":[…],"busyPanes":<n>,"fullyNamed":<bool>}`                        |
| `confirm_quit(requestId)`            | command      | `Result<(), String>`                                                                                 |
| `cancel_quit(requestId)`             | command      | `Result<(), String>`                                                                                 |
| `window:close-requested`             | Rust → 1 win | `{"requestId":<u64>,"busyProcesses":[…],"busyPanes":<n>,"fullyNamed":<bool>}`                        |
| `confirm_close_window(requestId)`    | command      | `Result<(), String>`                                                                                 |
| `cancel_close_window(requestId)`     | command      | `Result<(), String>`                                                                                 |
| `apply_settings_patch(patch)`        | command      | `Result<Value, String>` — the merged settings object                                                 |
| `settings:merged`                    | Rust → all   | the merged settings object (broadcast is correct here, and only here)                                |
| `begin_update_check()`               | command      | `bool` — `true` when this window won the single-flight                                               |
| `end_update_check()`                 | command      | `Result<(), String>`                                                                                 |

---

### Task B1: Allocate window labels that never repeat

**Files:**

- Create: `src-tauri/src/window_lifecycle.rs`
- Modify: `src-tauri/src/lib.rs:12` (module declaration only)
- Test: `src-tauri/src/window_lifecycle.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**

- Consumes: nothing.
- Produces: `pub struct WindowLabels`, `WindowLabels::allocate(&self) -> String`,
  `pub const DECK_LABEL_PREFIX: &str = "deck-"`.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/window_lifecycle.rs
#[cfg(test)]
mod tests {
    use super::{WindowLabels, DECK_LABEL_PREFIX};
    use std::collections::HashSet;

    #[test]
    fn allocates_prefixed_labels_in_order() {
        let labels = WindowLabels::default();
        assert_eq!(labels.allocate(), "deck-1");
        assert_eq!(labels.allocate(), "deck-2");
        assert_eq!(labels.allocate(), "deck-3");
        assert!("deck-1".starts_with(DECK_LABEL_PREFIX));
    }

    #[test]
    fn never_reuses_a_label_and_never_collides_with_main() {
        let labels = WindowLabels::default();
        let mut seen = HashSet::new();
        for _ in 0..1000 {
            let label = labels.allocate();
            assert_ne!(label, "main");
            assert!(seen.insert(label), "a label was handed out twice");
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: FAIL — `error[E0433]: failed to resolve: use of undeclared crate or module 'window_lifecycle'` from `lib.rs`, or once the module is declared,
`cannot find struct 'WindowLabels' in this scope`.

- [ ] **Step 3: Declare the module**

In `src-tauri/src/lib.rs`, insert after `mod shell_integration;` (`lib.rs:12`),
keeping the list alphabetical:

```rust
mod window_lifecycle;
```

- [ ] **Step 4: Implement the allocator**

At the top of `src-tauri/src/window_lifecycle.rs`:

```rust
//! Per-window state that is keyed by window label and must outlive any single
//! webview: label allocation, most-recently-focused order, and the pending
//! adoption a freshly created window reads at boot (spec §9.1, §9.2).

use std::sync::atomic::{AtomicU32, Ordering};

/// Every window this app creates after the configured `main` window carries
/// this prefix, so a generated label can never shadow the configured one.
pub const DECK_LABEL_PREFIX: &str = "deck-";

/// Monotonic label source. A label is never reused inside a process run:
/// reuse would let a stale `emit_to` from a dead window's route land in a live
/// one that happens to have taken the same name.
pub struct WindowLabels {
    next: AtomicU32,
}

impl Default for WindowLabels {
    fn default() -> Self {
        Self {
            next: AtomicU32::new(1),
        }
    }
}

impl WindowLabels {
    pub fn allocate(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        format!("{DECK_LABEL_PREFIX}{n}")
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs src-tauri/src/lib.rs
git commit -m "feat(window): allocate non-reusable deck window labels"
```

---

### Task B2: Track the most recently focused window

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs`
- Test: `src-tauri/src/window_lifecycle.rs`

**Interfaces:**

- Consumes: nothing.
- Produces: `pub struct FocusRegistry` with `record(&self, label: &str)`,
  `forget(&self, label: &str)`, `most_recent_among(&self, existing: &[String]) -> Option<String>`,
  `rank(&self, existing: &[String]) -> Vec<String>`;
  `pub fn menu_target<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String>`;
  `#[tauri::command] pub fn focus_order(app: tauri::AppHandle) -> Vec<String>`.

macOS can fire a menu event with no window focused (spec §9.3). This registry is
the fallback, and it is deliberately filtered by the caller's live-window list
so a destroyed window can never be returned even if `forget` was missed.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/window_lifecycle.rs`:

```rust
    use super::FocusRegistry;

    fn labels(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn returns_the_most_recently_focused_live_window() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.record("main");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("main".to_string())
        );
    }

    #[test]
    fn skips_a_window_that_no_longer_exists() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(
            registry.most_recent_among(&labels(&["main"])),
            Some("main".to_string())
        );
        assert_eq!(registry.most_recent_among(&[]), None);
    }

    #[test]
    fn forget_drops_a_destroyed_window() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.forget("deck-1");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("main".to_string())
        );
    }

    #[test]
    fn re_focusing_moves_a_window_to_the_front_without_duplicating_it() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.record("main");
        registry.forget("main");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("deck-1".to_string())
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: FAIL — `cannot find type 'FocusRegistry' in this scope`.

- [ ] **Step 3: Implement the registry**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
use std::sync::Mutex;

/// Window labels in most-recently-focused order, newest first.
///
/// A poisoned lock degrades to "no fallback" rather than to a panic: losing the
/// menu fallback drops one keystroke, panicking on the event loop takes the app
/// down.
#[derive(Default)]
pub struct FocusRegistry {
    order: Mutex<Vec<String>>,
}

impl FocusRegistry {
    pub fn record(&self, label: &str) {
        let Ok(mut order) = self.order.lock() else {
            return;
        };
        order.retain(|existing| existing != label);
        order.insert(0, label.to_string());
    }

    pub fn forget(&self, label: &str) {
        let Ok(mut order) = self.order.lock() else {
            return;
        };
        order.retain(|existing| existing != label);
    }

    pub fn most_recent_among(&self, existing: &[String]) -> Option<String> {
        let order = self.order.lock().ok()?;
        order
            .iter()
            .find(|label| existing.iter().any(|live| live == *label))
            .cloned()
    }
}
```

- [ ] **Step 4: Add the app-handle adapter the menu and the quit census both use**

Still in `src-tauri/src/window_lifecycle.rs`. It lives here rather than in
`menu.rs` because it is the adapter over `FocusRegistry`, and because Task B10's
quit census needs it too — `menu.rs` is macOS-only (`menu.rs:154-157`) and
cannot host a function the census depends on:

```rust
use tauri::Manager;

/// The window a menu event or a quit prompt belongs to: the focused one, else
/// the most recently focused one that still exists (spec §9.3). `None` means
/// every Deck window is gone or none has ever been focused.
pub fn menu_target<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    if let Some(label) = windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
    {
        return Some(label);
    }
    let live: Vec<String> = windows.keys().cloned().collect();
    app.state::<FocusRegistry>().most_recent_among(&live)
}
```

`menu_target` itself is not unit-tested: it needs live windows to ask
`is_focused()`. Its decision logic is `most_recent_among`, which the four tests
above cover; the focus-first branch is covered by the manual step in Task B6.

- [ ] **Step 5: Expose the focus order as a command**

The drag section (spec §11) needs this to break a same-frame tie when two
windows both accept a drop, and found no other owner for the data. Still in
`src-tauri/src/window_lifecycle.rs`:

```rust
impl FocusRegistry {
    /// `existing`, sorted most-recently-focused first. A window that has never
    /// been focused still exists and still accepts a drop, so it goes to the
    /// back rather than disappearing from the list.
    pub fn rank(&self, existing: &[String]) -> Vec<String> {
        let Ok(order) = self.order.lock() else {
            return existing.to_vec();
        };
        let mut ranked: Vec<String> = order
            .iter()
            .filter(|label| existing.iter().any(|window| window == *label))
            .cloned()
            .collect();
        for label in existing {
            if !ranked.iter().any(|known| known == label) {
                ranked.push(label.clone());
            }
        }
        ranked
    }
}

/// Live window labels, most recently focused first.
///
/// Read-only on purpose. It does not focus, raise or reorder anything: spec
/// §11.2 forbids raising a window mid-drag because `setFocus` steals focus and
/// risks breaking pointer capture, and this must not become a back door to it.
#[tauri::command]
pub fn focus_order(app: tauri::AppHandle) -> Vec<String> {
    let live: Vec<String> = app.webview_windows().keys().cloned().collect();
    app.state::<FocusRegistry>().rank(&live)
}
```

- [ ] **Step 6: Test the ranking**

Append to `mod tests`:

```rust
    #[test]
    fn rank_orders_by_recency_and_keeps_never_focused_windows_last() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(
            registry.rank(&labels(&["main", "deck-1", "deck-2"])),
            labels(&["deck-1", "main", "deck-2"])
        );
    }

    #[test]
    fn rank_drops_windows_that_no_longer_exist() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(registry.rank(&labels(&["main"])), labels(&["main"]));
    }
```

- [ ] **Step 7: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: 8 passed.

- [ ] **Step 8: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs
git commit -m "feat(window): track most recently focused window for menu routing"
```

---

### Task B3: Boot mode — pending adoptions and the `window_boot_mode` command

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs`
- Test: `src-tauri/src/window_lifecycle.rs`

**Interfaces:**

- Consumes: nothing (the token is an opaque `String` minted by
  `prepare_transfer`).
- Produces:
  - `pub struct PendingAdoptions` with `register(&self, label: String, token: String)`,
    `take(&self, label: &str) -> Option<String>`, `forget(&self, label: &str)`.
  - `pub enum BootMode { Normal, Adopt { token: String } }`, serialized as
    `{"kind":"normal"}` / `{"kind":"adopt","token":"…"}`.
  - `#[tauri::command] pub fn window_boot_mode(window: tauri::Window, pending: State<'_, PendingAdoptions>) -> BootMode`.

`take` consumes the entry. A second read — a reload, or a retry after a failed
`claim` — returns `Normal`, which is the safe answer: an already-claimed token
must not be handed out twice.

- [ ] **Step 1: Write the failing test**

Append to `mod tests`:

```rust
    use super::{BootMode, PendingAdoptions};

    #[test]
    fn boot_mode_is_normal_without_a_pending_adoption() {
        let pending = PendingAdoptions::default();
        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn a_registered_adoption_is_handed_out_exactly_once() {
        let pending = PendingAdoptions::default();
        pending.register("deck-1".into(), "token-abc".into());

        assert_eq!(pending.take("deck-1"), Some("token-abc".to_string()));
        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn forget_drops_an_adoption_whose_window_never_loaded() {
        let pending = PendingAdoptions::default();
        pending.register("deck-1".into(), "token-abc".into());
        pending.forget("deck-1");

        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn boot_mode_serializes_the_shape_the_frontend_reads() {
        assert_eq!(
            serde_json::to_value(BootMode::Normal).unwrap(),
            serde_json::json!({ "kind": "normal" })
        );
        assert_eq!(
            serde_json::to_value(BootMode::Adopt {
                token: "token-abc".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "adopt", "token": "token-abc" })
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: FAIL — `cannot find type 'PendingAdoptions' in this scope` and
`cannot find type 'BootMode' in this scope`.

- [ ] **Step 3: Implement the registry and the boot mode**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
use std::collections::HashMap;
use tauri::State;

/// Adoption tokens keyed by the label of the window that has not booted yet.
///
/// Registered before `build()` so the entry is in place no matter how fast the
/// webview loads, and consumed by the first `window_boot_mode` call.
#[derive(Default)]
pub struct PendingAdoptions {
    tokens: Mutex<HashMap<String, String>>,
}

impl PendingAdoptions {
    pub fn register(&self, label: String, token: String) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(label, token);
        }
    }

    pub fn take(&self, label: &str) -> Option<String> {
        self.tokens.lock().ok()?.remove(label)
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(label);
        }
    }
}

/// What a window should build at startup (spec §9.2). `adopt` skips the Open
/// Board and builds one tab around the transferred pane.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BootMode {
    Normal,
    Adopt { token: String },
}

#[tauri::command]
pub fn window_boot_mode(window: tauri::Window, pending: State<'_, PendingAdoptions>) -> BootMode {
    match pending.take(window.label()) {
        Some(token) => BootMode::Adopt { token },
        None => BootMode::Normal,
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs
git commit -m "feat(window): add boot mode and the pending adoption registry"
```

---

### Task B4: `open_pane_window` — create, harden on the main thread, register the adoption

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs`
- Test: `src-tauri/src/window_lifecycle.rs` (the pure part only — see the
  manual step, which is not optional)

**Interfaces:**

- Consumes: `platform::harden_webview(&WebviewWindow) -> Result<(), String>`
  (`src-tauri/src/platform/mod.rs:28-32`, `src-tauri/src/platform/windows/webview.rs:32`);
  the caller's `token` from `prepare_transfer`;
  `WindowCoordinator::reserve_destination(&self, token: &str, label: &str) -> Result<(), String>`
  (**transfer section — not optional, see below**).
- Produces:
  `#[tauri::command] pub async fn open_pane_window(app, labels, pending, coordinator, args: OpenPaneWindowArgs) -> Result<String, String>`
  returning the new window's label;
  `pub struct OpenPaneWindowArgs { token: String, screen_x: Option<f64>, screen_y: Option<f64> }`
  deserialized camelCase;
  `pub fn relabel_window_config(source: &WindowConfig, label: &str) -> WindowConfig`;
  `pub fn physical_from_css(css: f64, scale_factor: f64) -> f64`.

**The argument shape is frozen** (merge lead, 2026-08-10):
`{ token, screenX?, screenY? }`, and **`screenX`/`screenY` are CSS pixels** —
the drag section passes the drop point in the same units the browser reports in
`screenX`. Rust converts to physical. Getting this unit wrong does not fail
loudly; it puts the window on the wrong monitor. When the coordinates are
absent (the menu-command path) the window takes the OS's default placement.

Five decisions, each with its reason:

1. **The command is `async`.** `WebviewWindowBuilder`'s own docs
   (`tauri-2.11.5/src/webview/webview_window.rs:110-116`) say a synchronous
   command deadlocks on Windows during window creation and prescribe async.
2. **`harden_webview` runs through `run_on_main_thread` with an mpsc
   handshake.** Spec §9.1 requires the main-thread call; the async command is
   by definition not on that thread. `run_on_main_thread` executes inline when
   already on the main thread and enqueues otherwise
   (`tauri-runtime-wry-2.11.4/src/lib.rs:239-254`), and the channel turns the
   "enqueued but never ran" case — the exact silent failure
   `platform/windows/webview.rs:19-31` warns about — into a returned `Err`
   instead of a window with live browser accelerators.
3. **A reported hardening failure destroys the window — but the guard is
   partial, and that must not be overstated.** `harden_webview` returns `Err`
   only when `with_webview` fails to dispatch. Every _substantive_ failure
   inside the closure — no `CoreWebView2`, no `Settings`, no
   `ICoreWebView2Settings3`, or `SetAreBrowserAcceleratorKeysEnabled` returning
   an error — is `eprintln!`d and swallowed, returning `()`
   (`platform/windows/webview.rs:44-59`). So a `deck-*` window with F5 still
   live **can** survive this check. Destroying on `Err` is still right (failing
   the move is a smaller loss than a window that discards every pane on one
   keystroke), but the only real detection for the swallowed cases is B4 Step
   7's manual F5 press and the stderr line. Widening those to `Err` would change
   shipped behaviour on the startup path too and is out of this section's scope
   — flag it, do not fix it here.
4. **`reserve_destination` is called before `build()`.** Without it, §7.6 row 1
   — destination window destroyed before it ever `claim`s — is undetectable:
   the coordinator has no idea which label the token was heading for, so the
   route sits in `Transferring` until the §7.5 ten-second timeout fires. The
   user watches a frozen pane for ten seconds instead of seeing an immediate
   abort back to the source.
5. **Position is set after `build()`, as a `PhysicalPosition`.**
   `WebviewWindowBuilder::position` takes **logical** pixels
   (`tauri-2.11.5/src/webview/webview_window.rs:797-802`), and a global logical
   coordinate is ambiguous across monitors with different scale factors.
   `set_position` accepts an explicit `Position::Physical`
   (`webview_window.rs:2255`), which is not.

The window is built from `tauri.conf.json`'s own window config with the label
swapped, rather than from constants retyped here: it inherits title, size,
minimum size and background color with nothing to drift (C9).

**The coordinate conversion, and exactly how far it is verified.** The §6 spike
measured `clientX = screenX − innerPosition.x / scaleFactor` with residual 0 at
two positions, where `innerPosition` is physical and `screenX` is CSS. Rearranged,
a screen coordinate converts as `physical = css × scaleFactor`. The scale factor
comes from the monitor under the point: on macOS
`Manager::monitor_from_point(x, y)` resolves through tao's
`platform_impl/macos/monitor.rs:163-173`, which tests the point against
`CGDisplayBounds` — a **points** rectangle, i.e. the same CSS units the drag
section sends, so the argument needs no pre-conversion. **Mixed-DPI is
unverified**: §6's evidence is one display at `scaleFactor = 2`, and §11.3 gates
a second-display measurement before the per-pane hit-test ships. Do not treat
this task as closing that gate.

- [ ] **Step 1: Write the failing test**

The command itself needs a live event loop and cannot be unit-tested. Three
smaller pieces can be, and each one is a place a silent wrong answer would ship.

Note what the first test does **not** do: it builds its own `WindowConfig`
literal, so it cannot detect a change to `tauri.conf.json` — nothing reads that
file here. What it pins is that `relabel_window_config` swaps the label and
carries every other field through untouched, which is the actual failure mode
(a derivation that resets a field to `Default` would give the new window a
0×0 frame). Drift against `tauri.conf.json` is caught by B4 Step 7's manual
"same title, size and background as the first window" check, not by this test.
Append to `mod tests`:

```rust
    #[test]
    fn window_config_takes_its_geometry_from_the_configured_window() {
        let source = tauri::utils::config::WindowConfig {
            label: "main".into(),
            title: "SpaceVibe Deck".into(),
            width: 1100.0,
            height: 720.0,
            ..Default::default()
        };

        let derived = super::relabel_window_config(&source, "deck-1");

        assert_eq!(derived.label, "deck-1");
        assert_eq!(derived.title, "SpaceVibe Deck");
        assert_eq!(derived.width, 1100.0);
        assert_eq!(derived.height, 720.0);
    }

    #[test]
    fn css_screen_coordinates_convert_to_physical_by_multiplying_the_scale() {
        // Anchored on the §6 spike: innerPosition was physical (820, 226) at
        // scaleFactor 2, which is CSS (410, 113). Dividing instead of
        // multiplying — or converting before picking the monitor — silently
        // places the window on the wrong display.
        assert_eq!(super::physical_from_css(410.0, 2.0), 820.0);
        assert_eq!(super::physical_from_css(113.0, 2.0), 226.0);
        assert_eq!(super::physical_from_css(410.0, 1.0), 410.0);
        assert_eq!(super::physical_from_css(-227.0, 2.0), -454.0);
    }

    #[test]
    fn open_pane_window_args_deserialize_camel_case_with_optional_coordinates() {
        let with_point: super::OpenPaneWindowArgs =
            serde_json::from_value(serde_json::json!({
                "token": "token-abc",
                "screenX": 410.0,
                "screenY": 113.0
            }))
            .unwrap();
        assert_eq!(with_point.token, "token-abc");
        assert_eq!(with_point.screen_x, Some(410.0));
        assert_eq!(with_point.screen_y, Some(113.0));

        // The menu-command path sends no point and must still parse.
        let without_point: super::OpenPaneWindowArgs =
            serde_json::from_value(serde_json::json!({ "token": "token-abc" })).unwrap();
        assert_eq!(without_point.screen_x, None);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: FAIL — `cannot find function 'relabel_window_config' in module 'super'`,
`cannot find function 'physical_from_css' in module 'super'`, and
`cannot find type 'OpenPaneWindowArgs' in module 'super'`.

- [ ] **Step 3: Implement the config derivation, the argument shape and the
      unit conversion**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
use tauri::utils::config::WindowConfig;

/// The configured window, with the label swapped. Reusing the config is what
/// keeps a detached window's title, size, minimum size and background color in
/// one place — `tauri.conf.json` — instead of retyped as Rust constants.
pub fn relabel_window_config(source: &WindowConfig, label: &str) -> WindowConfig {
    let mut config = source.clone();
    config.label = label.to_string();
    config
}

/// `open_pane_window`'s frozen argument shape.
///
/// `screen_x`/`screen_y` are **CSS pixels** — the units the browser's
/// `screenX`/`screenY` report and the units the drag section relays. They are
/// absent on the menu-command path, which takes the OS's default placement.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPaneWindowArgs {
    pub token: String,
    pub screen_x: Option<f64>,
    pub screen_y: Option<f64>,
}

/// One screen axis, CSS pixels → physical pixels.
///
/// Derived from the §6 spike, where `clientX = screenX − innerPosition.x /
/// scaleFactor` had residual exactly 0 at two positions with `innerPosition`
/// physical and `screenX` in CSS. Multiply, never divide.
pub fn physical_from_css(css: f64, scale_factor: f64) -> f64 {
    css * scale_factor
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_lifecycle`

Expected: 15 passed (the three new ones included).

- [ ] **Step 5: Implement the command**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
use crate::coordinator::WindowCoordinator;
use crate::platform;
use std::sync::mpsc;
use std::time::Duration;
// `Manager` is already imported by Task B2's `menu_target`; extend that line
// rather than adding a second `use tauri::…`.
use tauri::{PhysicalPosition, WebviewWindowBuilder};

/// Upper bound on waiting for the main event loop to run the hardening
/// closure. The loop runs it inline or within one turn; five seconds means
/// "the loop is gone", not "the loop is busy".
const HARDEN_TIMEOUT: Duration = Duration::from_secs(5);

/// Create a Deck window that boots straight into adopting `args.token`'s pane.
///
/// Async on purpose: `WebviewWindowBuilder` deadlocks on Windows when a
/// synchronous command creates a window.
#[tauri::command]
pub async fn open_pane_window(
    app: tauri::AppHandle,
    labels: State<'_, WindowLabels>,
    pending: State<'_, PendingAdoptions>,
    coordinator: State<'_, WindowCoordinator>,
    args: OpenPaneWindowArgs,
) -> Result<String, String> {
    let label = labels.allocate();
    let source = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "No window is configured in tauri.conf.json".to_string())?;
    let config = relabel_window_config(&source, &label);

    // Before `build()`, and before anything can fail afterwards: without the
    // reservation the coordinator cannot tell that a window destroyed before
    // it claims was THIS transfer's destination, so §7.6 row 1 degrades from
    // an immediate abort into the §7.5 ten-second timeout.
    coordinator.reserve_destination(&args.token, &label)?;

    // Registered before `build()` too: the webview can call `window_boot_mode`
    // as soon as it loads, and losing that race would boot the Open Board
    // into a window that exists only to receive a pane.
    pending.register(label.clone(), args.token);

    let window = match WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|builder| builder.build())
    {
        Ok(window) => window,
        Err(error) => {
            pending.forget(&label);
            return Err(error.to_string());
        }
    };

    // Placement, when the drag section supplied a drop point. Physical rather
    // than the builder's logical position: a global logical coordinate is
    // ambiguous once two monitors have different scale factors. A failure here
    // is not fatal — a window in the wrong place still holds the pane — so it
    // is reported and the move continues.
    if let (Some(screen_x), Some(screen_y)) = (args.screen_x, args.screen_y) {
        let scale = app
            .monitor_from_point(screen_x, screen_y)
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .or_else(|| {
                app.primary_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| monitor.scale_factor())
            })
            .unwrap_or(1.0);
        let position = PhysicalPosition::new(
            physical_from_css(screen_x, scale).round() as i32,
            physical_from_css(screen_y, scale).round() as i32,
        );
        if let Err(error) = window.set_position(position) {
            eprintln!("Deck: could not place {label} at the drop point: {error}");
        }
    }

    // Spec §9.1: this must run ON the main event-loop thread. Off it,
    // `with_webview` returns Ok for "enqueued" and the closure may never run,
    // leaving browser accelerator keys live — one F5 discarding every pane in
    // the new window. The channel is what turns that silence into an error.
    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let target = window.clone();
    let dispatched = app.run_on_main_thread(move || {
        let _ = sender.send(platform::harden_webview(&target));
    });
    let hardened = match dispatched {
        Ok(()) => receiver
            .recv_timeout(HARDEN_TIMEOUT)
            .map_err(|_| "Webview hardening never ran on the main event loop".to_string())
            .and_then(|result| result),
        Err(error) => Err(error.to_string()),
    };
    if let Err(error) = hardened {
        let _ = window.destroy();
        pending.forget(&label);
        return Err(format!("Could not harden the new window: {error}"));
    }

    Ok(label)
}
```

`reserve_destination` returning `Err` aborts before any window exists, which is
why it runs first: there is nothing to clean up on that path.

- [ ] **Step 6: Run to verify it compiles and the suite is green**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: the whole suite passes; `open_pane_window` is compiled but not
exercised. It is registered in `generate_handler!` in Task B15.

- [ ] **Step 7: MANUAL verification — not automatable here, and not runnable
      until Task B15**

There is no unit test for real window creation: it needs a live event loop and
a real webview, and `tauri-driver` has no macOS support (spec §14). The command
is not reachable from the frontend until Task B15 registers it, so run this
check then — not at the end of this task. Run `npm run tauri dev` and check,
with your eyes:

- A second window opens with the same title, size and background as the first —
  not a white flash and not a differently sized frame.
- Its label is `deck-1` (visible in the devtools console via
  `window.__TAURI__.window.getCurrentWindow().label`).
- **On Windows only:** press F5 in the new window. Nothing must happen. If the
  session reloads, hardening did not run and this task is not done.
- Open a third window: its label is `deck-2`. Close `deck-1`, open another: the
  label is `deck-3`, never `deck-1` again.
- Pass a drop point: the window's top-left lands where the cursor was released,
  not at half or double that distance from the screen origin. Halving means the
  conversion divided; doubling means it multiplied twice.
- Destroy the new window before it adopts (kill its webview process). The source
  pane must come back **immediately**, not after ten seconds — that is
  `reserve_destination` working, and a ten-second wait means it did not run.

- [ ] **Step 8: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs
git commit -m "feat(window): open a hardened deck window for an adopted pane"
```

---

### Task B5: Widen the capability to `deck-*`

**Files:**

- Modify: `src-tauri/capabilities/default.json:4-5`
- Test: `src-tauri/src/window_lifecycle.rs` (a check that the shipped capability
  file actually covers generated labels)

**Interfaces:**

- Consumes: `DECK_LABEL_PREFIX` from Task B1.
- Produces: nothing new at runtime; the new windows gain the same permission set
  as `main`.

**Glob support — verified, not assumed.** `src-tauri/gen/schemas/desktop-schema.json`
types `windows` as `{"type":"array","items":{"type":"string"}}` with the
description _"List of windows that are affected by this capability. Can be a
glob pattern."_, and the `Capability` description names the exact form:
_"Windows can be added to a capability by exact name (e.g. `main-window`) or
glob patterns like `*` or `admin-*`."_ So `"deck-*"` is valid against the
generated schema in this repo, and it is matched by glob, not by prefix
comparison.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/window_lifecycle.rs`:

```rust
    #[test]
    fn the_shipped_capability_covers_generated_window_labels() {
        let raw = include_str!("../capabilities/default.json");
        let capability: serde_json::Value = serde_json::from_str(raw).unwrap();
        let windows = capability["windows"].as_array().unwrap();
        let patterns: Vec<&str> = windows.iter().map(|w| w.as_str().unwrap()).collect();

        assert!(patterns.contains(&"main"), "the configured window lost its capability");
        assert!(
            patterns.contains(&"deck-*"),
            "detached windows would boot with no IPC access at all"
        );
        assert_eq!(format!("{DECK_LABEL_PREFIX}1"), "deck-1");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml the_shipped_capability`

Expected: FAIL — `detached windows would boot with no IPC access at all`.

- [ ] **Step 3: Widen the capability**

In `src-tauri/capabilities/default.json`, replace lines 4-5:

```json
  "description": "Capability for the configured window and every detached pane window",
  "windows": ["main", "deck-*"],
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml the_shipped_capability`

Expected: 1 passed.

- [ ] **Step 5: MANUAL verification**

A capability that fails to match is silent — the window loads and every
`invoke` rejects. Under `npm run tauri dev`, open a detached window and confirm
its devtools console shows no `not allowed` / `Unknown permission` errors, and
that the terminal in it actually receives output.

- [ ] **Step 6: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/capabilities/default.json src-tauri/src/window_lifecycle.rs
git commit -m "feat(window): extend the default capability to deck-* windows"
```

---

### Task B6: Route menu events to one window instead of broadcasting

**Files:**

- Modify: `src-tauri/src/menu.rs:12-18` (un-gate the two id constants),
  `src-tauri/src/menu.rs:143-150` (the handler)
- Test: `src-tauri/src/menu.rs` (the existing non-gated `mod tests`)

**Interfaces:**

- Consumes: `window_lifecycle::menu_target` (Task B2);
  `quit_flow::request_quit` (Task B10). Both land before this task.
- Produces: `pub enum MenuRoute { Quit, Action { window: String, action: String }, Dropped }`,
  `pub fn route_menu_event(id: &str, target: Option<&str>) -> MenuRoute`.

**R3 compliance — checked before planning this.** The generated file is
`src-tauri/src/menu_registry.rs` (header: _"AUTO-GENERATED by `npm run
generate:menu` … do not hand-edit"_), produced by `scripts/generate-menu.ts`
from the registry `src/terminal/action-registry.ts`. `menu.rs` itself is
hand-written — it only _reads_ the generated tables (`menu.rs:69-72`, `:95-98`,
`:126-129`) and owns `install()` and `on_menu_event`. Changing the routing
therefore touches no generated code. **No new menu item is added here**: the
"Move Pane to New Window" item of spec §15 Q1 belongs in `action-registry.ts`
plus `npm run generate:menu`, and is the frontend section's task, not this one.

- [ ] **Step 1: Write the failing test**

Append to the existing `mod tests` at `src-tauri/src/menu.rs:178`:

```rust
    use crate::menu::{route_menu_event, MenuRoute};

    #[test]
    fn an_action_goes_to_the_target_window_only() {
        assert_eq!(
            route_menu_event("action:new-tab", Some("deck-2")),
            MenuRoute::Action {
                window: "deck-2".into(),
                action: "new-tab".into()
            }
        );
    }

    #[test]
    fn a_pane_scoped_action_is_dropped_when_no_window_can_receive_it() {
        // macOS fires menu events with no window focused; a pane action with
        // nowhere to land must be dropped, never broadcast.
        assert_eq!(route_menu_event("action:close-pane", None), MenuRoute::Dropped);
    }

    #[test]
    fn quit_is_routed_through_the_census_regardless_of_focus() {
        assert_eq!(route_menu_event("quit-confirm", None), MenuRoute::Quit);
        assert_eq!(route_menu_event("quit-confirm", Some("main")), MenuRoute::Quit);
    }

    #[test]
    fn an_unknown_menu_id_is_dropped() {
        assert_eq!(route_menu_event("about", Some("main")), MenuRoute::Dropped);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml menu::tests`

Expected: FAIL — `cannot find function 'route_menu_event' in module 'crate::menu'`.

- [ ] **Step 3: Un-gate the ids and add the pure router**

In `src-tauri/src/menu.rs`, remove the `#[cfg(target_os = "macos")]` above
`QUIT_MENU_ID` (line 12) and above `ACTION_PREFIX` (line 17) so the router and
its tests compile on the ubuntu CI runner, and add below them:

```rust
/// Where a menu event goes now that menu events are no longer broadcast
/// (spec §9.3).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MenuRoute {
    /// Quit never needs a focused window: the census owns it (spec §9.4).
    Quit,
    Action { window: String, action: String },
    Dropped,
}

/// Pure routing decision. `target` is the focused window, or the most recently
/// focused one that still exists, or `None` when neither exists.
pub fn route_menu_event(id: &str, target: Option<&str>) -> MenuRoute {
    if id == QUIT_MENU_ID {
        return MenuRoute::Quit;
    }
    match (id.strip_prefix(ACTION_PREFIX), target) {
        (Some(action), Some(window)) => MenuRoute::Action {
            window: window.to_string(),
            action: action.to_string(),
        },
        _ => MenuRoute::Dropped,
    }
}
```

- [ ] **Step 4: Replace the broadcast**

Replace `src-tauri/src/menu.rs:143-150` with:

```rust
    app.on_menu_event(|handle, event| {
        // Broadcast is gone: with peer windows it delivered every accelerator
        // to every window, so one Cmd+T opened a tab in each (spec §9.3).
        let target = crate::window_lifecycle::menu_target(handle);
        match route_menu_event(event.id().0.as_str(), target.as_deref()) {
            MenuRoute::Quit => crate::quit_flow::request_quit(handle),
            MenuRoute::Action { window, action } => {
                let _ = handle.emit_to(window, "menu:action", action);
            }
            MenuRoute::Dropped => {}
        }
    });
```

`crate::window_lifecycle::menu_target` was implemented in Task B2 and
`crate::quit_flow::request_quit` in Task B10; the task order below runs both
before this one, so this arm is written once.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml menu`

Expected: the four new tests pass alongside the three existing registry
tripwires (`app_menu_items_match_expected_ids_in_order`,
`edit_menu_items_matches_expected_ids_in_order`, `window_menu_items_is_empty`).

- [ ] **Step 6: Prove no generated code drifted**

Run: `npm run generate:menu:check`

Expected: exits 0 — `menu_registry.rs` is untouched by this task.

- [ ] **Step 7: MANUAL verification (macOS only — the menu is macOS-only,
      `menu.rs:154-157`)**

Under `npm run tauri dev` with two windows open: focus window B, press ⌘T. One
new tab appears, in B only. Then click the desktop so no Deck window is focused
and pick File ▸ New Tab from the menu bar: the tab lands in the last window you
used, not in both.

- [ ] **Step 8: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/menu.rs
git commit -m "feat(menu): route menu actions to the focused window"
```

---

### Task B7: The busy census, in Rust

**Files:**

- Create: `src-tauri/src/pane_census.rs`
- Modify: `src-tauri/src/info.rs:186-205` (extract the platform split so both
  `pty_info` and the census can use it)
- Modify: `src-tauri/src/lib.rs` (module declaration)
- Test: `src-tauri/src/pane_census.rs`

**Interfaces:**

- Consumes: `crate::info::{PtyInfo, PaneProcessKind}` (`src-tauri/src/info.rs:12-40`),
  `crate::pty::PtyState::session_snapshots` (`src-tauri/src/pty.rs:789`).
- Produces:
  - `pub async fn inspect_snapshots(snapshots: Vec<PtySessionSnapshot>) -> Vec<PtyInfo>` in `info.rs`.
  - `pub struct BusyCensus { pub request_id: u64, pub busy_processes: Vec<String>, pub busy_panes: usize, pub fully_named: bool }`,
    serialized camelCase.
  - `pub fn census_for(request_id: u64, infos: &[PtyInfo]) -> BusyCensus`,
    `pub fn all_idle(infos: &[PtyInfo]) -> bool`.

This mirrors `src/terminal/close-guard.ts:7-24` and `:110-116` exactly — busy is
`Agent | Busy`, names are deduplicated in pane order, and "fully named" means
every pane is either an idle shell or a busy pane with a known process name.
Rust can compute all of it because `classify_process` already lives here
(`info.rs:42-67`), so the guard no longer depends on a responsive webview
(spec §9.4).

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/pane_census.rs
#[cfg(test)]
mod tests {
    use super::{all_idle, census_for};
    use crate::info::{PaneAgent, PaneProcessKind, PtyInfo};

    fn info(id: u32, kind: PaneProcessKind, process: Option<&str>) -> PtyInfo {
        PtyInfo {
            id,
            cwd: None,
            process: process.map(str::to_string),
            kind,
            agent: match kind {
                PaneProcessKind::Agent => Some(PaneAgent::Claude),
                _ => None,
            },
        }
    }

    #[test]
    fn all_idle_shells_need_no_dialog() {
        let infos = [
            info(1, PaneProcessKind::IdleShell, Some("zsh")),
            info(2, PaneProcessKind::IdleShell, Some("bash")),
        ];
        assert!(all_idle(&infos));
        assert_eq!(census_for(7, &infos).busy_panes, 0);
    }

    #[test]
    fn busy_names_are_deduplicated_but_panes_are_counted() {
        let infos = [
            info(1, PaneProcessKind::Agent, Some("claude")),
            info(2, PaneProcessKind::Agent, Some("claude")),
            info(3, PaneProcessKind::Busy, Some("cargo")),
            info(4, PaneProcessKind::IdleShell, Some("zsh")),
        ];
        let census = census_for(7, &infos);

        assert!(!all_idle(&infos));
        assert_eq!(census.request_id, 7);
        assert_eq!(census.busy_processes, vec!["claude", "cargo"]);
        assert_eq!(census.busy_panes, 3);
        assert!(census.fully_named);
    }

    #[test]
    fn an_unknown_pane_makes_the_census_not_fully_named() {
        let infos = [
            info(1, PaneProcessKind::IdleShell, Some("zsh")),
            info(2, PaneProcessKind::Unknown, None),
        ];
        let census = census_for(7, &infos);

        assert!(!all_idle(&infos));
        assert!(!census.fully_named);
        assert!(census.busy_processes.is_empty());
    }

    #[test]
    fn a_busy_pane_with_no_process_name_is_not_fully_named() {
        let infos = [info(1, PaneProcessKind::Busy, None)];
        let census = census_for(7, &infos);

        assert!(!census.fully_named);
        assert_eq!(census.busy_panes, 1);
    }

    #[test]
    fn census_serializes_camel_case_for_the_dialog() {
        let infos = [info(1, PaneProcessKind::Agent, Some("claude"))];
        assert_eq!(
            serde_json::to_value(census_for(7, &infos)).unwrap(),
            serde_json::json!({
                "requestId": 7,
                "busyProcesses": ["claude"],
                "busyPanes": 1,
                "fullyNamed": true
            })
        );
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml pane_census`

Expected: FAIL — `failed to resolve: use of undeclared crate or module 'pane_census'`
until the module is declared, then `cannot find function 'census_for'`.

- [ ] **Step 3: Declare the module and implement the census**

In `src-tauri/src/lib.rs`, add `mod pane_census;` after `mod migrate;`.

```rust
// src-tauri/src/pane_census.rs
//! The busy guard's evidence, computed in Rust (spec §9.4).
//!
//! The frontend used to gather this itself, so a wedged webview meant an
//! unanswerable quit prompt. `info::classify_process` already runs here, so the
//! same classification the pane header shows can be produced without asking any
//! window anything. The mirror on the TypeScript side is
//! `src/terminal/close-guard.ts` — `isBusy`, `busyProcesses` and the
//! `fullyNamed` test in `confirmClose` — and the two must agree.

use crate::info::{PaneProcessKind, PtyInfo};

fn is_busy(info: &PtyInfo) -> bool {
    matches!(info.kind, PaneProcessKind::Agent | PaneProcessKind::Busy)
}

/// True when every pane is explicitly an idle shell — the one case that skips
/// the dialog entirely.
pub fn all_idle(infos: &[PtyInfo]) -> bool {
    infos
        .iter()
        .all(|info| matches!(info.kind, PaneProcessKind::IdleShell))
}

/// Everything one confirm dialog needs, and nothing the frontend has to
/// recompute.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusyCensus {
    pub request_id: u64,
    /// Deduplicated busy process names, in pane order.
    pub busy_processes: Vec<String>,
    /// Panes, not names: three panes running `claude` are one name and three
    /// panes, and the dialog must say three.
    pub busy_panes: usize,
    /// False when any pane could not be classified — the dialog then uses the
    /// generic "could not verify" copy.
    pub fully_named: bool,
}

pub fn census_for(request_id: u64, infos: &[PtyInfo]) -> BusyCensus {
    let mut busy_processes: Vec<String> = Vec::new();
    for info in infos.iter().filter(|info| is_busy(info)) {
        if let Some(process) = info.process.as_deref() {
            if !busy_processes.iter().any(|name| name == process) {
                busy_processes.push(process.to_string());
            }
        }
    }
    let fully_named = infos.iter().all(|info| match info.kind {
        PaneProcessKind::IdleShell => true,
        PaneProcessKind::Agent | PaneProcessKind::Busy => info.process.is_some(),
        PaneProcessKind::Unknown => false,
    });
    BusyCensus {
        request_id,
        busy_processes,
        busy_panes: infos.iter().filter(|info| is_busy(info)).count(),
        fully_named,
    }
}
```

- [ ] **Step 4: Extract the platform split out of `pty_info`**

Replace `src-tauri/src/info.rs:186-205` with:

```rust
/// Explicit process truth and cwd for each snapshot. Inspection failures become
/// per-pane `unknown` entries so callers stay usable.
///
/// Split out of `pty_info` so the quit and close censuses (spec §9.4, §9.5) get
/// the same classification without a second copy of the platform branch — and
/// so the slow Windows WMI path stays off the caller's thread there too.
pub(crate) async fn inspect_snapshots(snapshots: Vec<PtySessionSnapshot>) -> Vec<PtyInfo> {
    #[cfg(target_os = "windows")]
    {
        let fallback = snapshots.clone();
        let task = tauri::async_runtime::spawn_blocking(move || inspect_windows(&snapshots));
        return task
            .await
            .unwrap_or_else(|_| fallback.iter().map(unknown_info).collect());
    }

    #[cfg(not(target_os = "windows"))]
    {
        inspect_current_platform(&snapshots)
    }
}

#[tauri::command]
pub async fn pty_info(state: State<'_, PtyState>, ids: Vec<u32>) -> Result<Vec<PtyInfo>, String> {
    let snapshots = state.session_snapshots(&ids);
    Ok(inspect_snapshots(snapshots).await)
}
```

Also add `#[derive(Clone, Copy, Debug, Eq, PartialEq)]` is already on
`PaneProcessKind` (`info.rs:12`); no change needed there. `PtyInfo`
(`info.rs:33-40`) needs no new derive for these tests — the test constructs it
directly and asserts on fields.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: the five `pane_census` tests pass and every pre-existing `info` test
still passes.

- [ ] **Step 6: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/pane_census.rs src-tauri/src/info.rs src-tauri/src/lib.rs
git commit -m "feat(window): compute the busy census in Rust"
```

---

### Task B8: The quit single-flight lock and the exit policy

**Files:**

- Create: `src-tauri/src/quit_flow.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration)
- Test: `src-tauri/src/quit_flow.rs`

**Interfaces:**

- Consumes: nothing yet (the census is wired in Task B10).
- Produces: `pub struct QuitFlight` with
  `try_begin(&self, window: &str) -> Option<u64>`,
  `finish(&self, request_id: u64) -> bool`,
  `holder(&self) -> Option<String>`,
  `forget_window(&self, label: &str) -> bool`;
  `pub enum ExitPolicy { Allow, PromptAndPrevent }`;
  `pub fn exit_policy(code: Option<i32>, open_windows: usize) -> ExitPolicy`.

`forget_window` is the crash-safety half: the window holding the quit dialog can
die (peers means any window can die first), and without releasing the lock ⌘Q
would be dead for the rest of the session.

`exit_policy` closes a hole this feature creates. Today `lib.rs:85-93` prevents
every unconfirmed exit — which was safe only because the single window's JS
guard stopped it from ever closing. With peer windows the last window really can
go away, and preventing exit then leaves a process with no window and no way to
show a dialog.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/quit_flow.rs
#[cfg(test)]
mod tests {
    use super::{exit_policy, ExitPolicy, QuitFlight};

    #[test]
    fn a_second_quit_cannot_open_a_second_dialog() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").expect("first quit begins");

        assert_eq!(flight.try_begin("deck-1"), None);
        assert_eq!(flight.holder().as_deref(), Some("main"));
        assert!(flight.finish(first));
    }

    #[test]
    fn finishing_with_a_stale_request_id_changes_nothing() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").unwrap();

        assert!(!flight.finish(first + 999));
        assert_eq!(flight.holder().as_deref(), Some("main"));
        assert!(flight.finish(first));
        assert!(flight.try_begin("deck-1").is_some());
    }

    #[test]
    fn request_ids_are_not_reused_after_a_cancel() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").unwrap();
        flight.finish(first);
        let second = flight.try_begin("main").unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn losing_the_dialog_window_releases_the_lock() {
        let flight = QuitFlight::default();
        flight.try_begin("deck-1").unwrap();

        assert!(flight.forget_window("deck-1"));
        assert!(
            flight.try_begin("main").is_some(),
            "a dead window must not brick quit for the session"
        );
    }

    #[test]
    fn losing_an_unrelated_window_keeps_the_lock() {
        let flight = QuitFlight::default();
        flight.try_begin("main").unwrap();

        assert!(!flight.forget_window("deck-1"));
        assert_eq!(flight.holder().as_deref(), Some("main"));
    }

    #[test]
    fn a_programmatic_exit_is_never_prevented() {
        assert_eq!(exit_policy(Some(0), 2), ExitPolicy::Allow);
        assert_eq!(exit_policy(Some(i32::MAX), 1), ExitPolicy::Allow);
    }

    #[test]
    fn a_user_exit_prompts_while_a_window_remains() {
        assert_eq!(exit_policy(None, 1), ExitPolicy::PromptAndPrevent);
        assert_eq!(exit_policy(None, 3), ExitPolicy::PromptAndPrevent);
    }

    #[test]
    fn a_user_exit_with_no_windows_left_must_be_allowed() {
        // Otherwise the last window closing leaves a process with nothing to
        // show a dialog in and no way to quit.
        assert_eq!(exit_policy(None, 0), ExitPolicy::Allow);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml quit_flow`

Expected: FAIL — `failed to resolve: use of undeclared crate or module 'quit_flow'`,
then `cannot find type 'QuitFlight' in this scope`.

- [ ] **Step 3: Declare the module and implement the lock**

In `src-tauri/src/lib.rs`, add `mod quit_flow;` after `mod pty;`.

```rust
// src-tauri/src/quit_flow.rs
//! Quit, owned by Rust (spec §9.4).
//!
//! With peer windows, ⌘Q used to be broadcast: every window ran its own guard
//! and every window opened its own dialog. Here exactly one window is asked,
//! behind a global in-flight lock, and the census that dialog shows is computed
//! from `PtyState` rather than from whichever webview happens to answer.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

struct InFlight {
    request_id: u64,
    window: String,
}

/// At most one quit prompt exists at a time, app-wide.
#[derive(Default)]
pub struct QuitFlight {
    current: Mutex<Option<InFlight>>,
    next_id: AtomicU64,
}

impl QuitFlight {
    /// Claim the prompt for `window`. `None` means another window already has
    /// it — a second ⌘Q must not open a second dialog.
    pub fn try_begin(&self, window: &str) -> Option<u64> {
        let mut current = self.current.lock().ok()?;
        if current.is_some() {
            return None;
        }
        let request_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        *current = Some(InFlight {
            request_id,
            window: window.to_string(),
        });
        Some(request_id)
    }

    /// Release the prompt. False for a stale or unknown id, so a late reply
    /// from a previous quit cannot cancel the current one.
    pub fn finish(&self, request_id: u64) -> bool {
        let Ok(mut current) = self.current.lock() else {
            return false;
        };
        match current.as_ref() {
            Some(flight) if flight.request_id == request_id => {
                *current = None;
                true
            }
            _ => false,
        }
    }

    pub fn holder(&self) -> Option<String> {
        self.current
            .lock()
            .ok()?
            .as_ref()
            .map(|flight| flight.window.clone())
    }

    /// Release the prompt if `label` was holding it. Peers means the window
    /// showing the dialog can die first; without this, quit stays locked for
    /// the rest of the process.
    pub fn forget_window(&self, label: &str) -> bool {
        let Ok(mut current) = self.current.lock() else {
            return false;
        };
        match current.as_ref() {
            Some(flight) if flight.window == label => {
                *current = None;
                true
            }
            _ => false,
        }
    }
}

/// What to do with `RunEvent::ExitRequested`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExitPolicy {
    Allow,
    PromptAndPrevent,
}

/// `code` is `Some` only for a programmatic exit — `confirm_quit`'s `app.exit`
/// and the updater's `restart` — which has already passed its own guard and
/// must not be blocked. `open_windows == 0` is the peer-window case: nobody is
/// left to answer a prompt, so preventing exit would hang the process invisibly.
pub fn exit_policy(code: Option<i32>, open_windows: usize) -> ExitPolicy {
    if code.is_some() || open_windows == 0 {
        return ExitPolicy::Allow;
    }
    ExitPolicy::PromptAndPrevent
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml quit_flow`

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/quit_flow.rs src-tauri/src/lib.rs
git commit -m "feat(window): add the quit single-flight lock and exit policy"
```

---

### Task B9: The per-window close lock

**Files:**

- Create: `src-tauri/src/window_close.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration)
- Test: `src-tauri/src/window_close.rs`

**Interfaces:**

- Consumes: nothing yet.
- Produces: `pub struct CloseFlight` with
  `try_begin(&self, label: &str) -> Option<u64>`,
  `take(&self, label: &str, request_id: u64) -> bool`,
  `forget(&self, label: &str)`.

Unlike quit, close is **per window**: two windows may each have a close prompt
open at the same time, and neither blocks the other. What must not happen is one
window opening two.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/window_close.rs
#[cfg(test)]
mod tests {
    use super::CloseFlight;

    #[test]
    fn one_window_cannot_open_two_close_prompts() {
        let flight = CloseFlight::default();
        let first = flight.try_begin("deck-1").expect("first close begins");

        assert_eq!(flight.try_begin("deck-1"), None);
        assert!(flight.take("deck-1", first));
    }

    #[test]
    fn two_windows_prompt_independently() {
        let flight = CloseFlight::default();
        let a = flight.try_begin("main").expect("main begins");
        let b = flight.try_begin("deck-1").expect("deck-1 begins");

        assert_ne!(a, b);
        assert!(flight.take("main", a));
        assert!(flight.take("deck-1", b));
    }

    #[test]
    fn a_stale_reply_cannot_close_a_window() {
        let flight = CloseFlight::default();
        let first = flight.try_begin("deck-1").unwrap();
        assert!(flight.take("deck-1", first));
        let second = flight.try_begin("deck-1").unwrap();

        assert!(!flight.take("deck-1", first));
        assert!(flight.take("deck-1", second));
    }

    #[test]
    fn forget_releases_a_window_that_died_mid_prompt() {
        let flight = CloseFlight::default();
        flight.try_begin("deck-1").unwrap();
        flight.forget("deck-1");

        assert!(flight.try_begin("deck-1").is_some());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_close`

Expected: FAIL — `failed to resolve: use of undeclared crate or module 'window_close'`,
then `cannot find type 'CloseFlight' in this scope`.

- [ ] **Step 3: Declare the module and implement the lock**

In `src-tauri/src/lib.rs`, add `mod window_close;` after `mod window_lifecycle;`.

```rust
// src-tauri/src/window_close.rs
//! Closing one window without touching its peers (spec §9.5).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// One outstanding close prompt per window. Per window, not global: closing two
/// windows at once is ordinary, and each guards only its own panes.
#[derive(Default)]
pub struct CloseFlight {
    pending: Mutex<HashMap<String, u64>>,
    next_id: AtomicU64,
}

impl CloseFlight {
    pub fn try_begin(&self, label: &str) -> Option<u64> {
        let mut pending = self.pending.lock().ok()?;
        if pending.contains_key(label) {
            return None;
        }
        let request_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        pending.insert(label.to_string(), request_id);
        Some(request_id)
    }

    /// Consume the prompt. False for a stale id, so a reply belonging to an
    /// earlier close attempt cannot destroy a window the user kept.
    pub fn take(&self, label: &str, request_id: u64) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        match pending.get(label) {
            Some(&current) if current == request_id => {
                pending.remove(label);
                true
            }
            _ => false,
        }
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(label);
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml window_close`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_close.rs src-tauri/src/lib.rs
git commit -m "feat(window): add the per-window close prompt lock"
```

---

### Task B10: Ask exactly one window to confirm the quit

**Files:**

- Modify: `src-tauri/src/quit_flow.rs`
- Modify: `src-tauri/src/lib.rs:17-26` (delete `QuitState` and the old
  `confirm_quit`)
- Test: `src-tauri/src/quit_flow.rs`

**Interfaces:**

- Consumes: `window_lifecycle::menu_target` (B2), `pane_census::{census_for, all_idle}` (B7),
  `info::inspect_snapshots` (B7), `coordinator::WindowCoordinator` for the pane
  list, `PtyState::session_snapshots`.
- Produces: `pub fn request_quit<R: Runtime>(app: &tauri::AppHandle<R>)`;
  `#[tauri::command] pub fn confirm_quit(app, flight, request_id: u64) -> Result<(), String>`;
  `#[tauri::command] pub fn cancel_quit(flight, request_id: u64) -> Result<(), String>`;
  event `quit-requested` with a `BusyCensus` payload, emitted to **one** window.

**The census reads `all_panes()`, never `panes_for_window`.** `all_panes`
returns `Owned` **and** `Transferring` panes; `panes_for_window` returns owned
panes only. The two disagree exactly while a transfer is open, and quit must use
the wider set: a pane mid-move is a running agent, and asking "quit anyway?"
without counting it is the failure the census exists to prevent. Task B11 uses
the narrower set for the opposite reason — a window may only kill what it still
owns.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/quit_flow.rs`:

```rust
    use crate::info::{PaneProcessKind, PtyInfo};
    use crate::pane_census::{all_idle, census_for};

    fn idle(id: u32) -> PtyInfo {
        PtyInfo {
            id,
            cwd: None,
            process: Some("zsh".into()),
            kind: PaneProcessKind::IdleShell,
            agent: None,
        }
    }

    #[test]
    fn an_all_idle_app_still_carries_the_request_id_so_the_window_can_flush() {
        // Nothing to warn about, but the frontend must still flush settings and
        // call confirm_quit — so the request is issued either way, with an
        // empty census.
        let infos = [idle(1), idle(2)];
        let census = census_for(11, &infos);

        assert!(all_idle(&infos));
        assert_eq!(census.request_id, 11);
        assert_eq!(census.busy_panes, 0);
    }

    #[test]
    fn the_census_counts_a_pane_that_is_mid_transfer() {
        // `all_panes` (Owned + Transferring) and `panes_for_window` (Owned
        // only) disagree exactly here, and quit must read the wider one: an
        // agent that happens to be moving between windows is still running.
        //
        // `begin_transfer` is the inherent method behind the `prepare_transfer`
        // command; the command takes a `tauri::Window`, which no unit test can
        // construct. The recording sink and the injected `now` are what make it
        // callable here at all — see §0.2.
        use crate::coordinator::{test_support::RecordingSink, WindowCoordinator};
        use std::time::Instant;

        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        coordinator.register(1, "main".into());
        coordinator.register(2, "main".into());
        coordinator
            .begin_transfer(&sink, "main", 2, Instant::now())
            .expect("pane 2 enters the Transferring state");

        assert_eq!(coordinator.panes_for_window("main"), vec![1]);
        let mut all = coordinator.all_panes();
        all.sort();
        assert_eq!(all, vec![1, 2]);
    }

    #[test]
    fn confirming_an_unknown_request_is_an_error_not_an_exit() {
        let flight = QuitFlight::default();
        let request_id = flight.try_begin("main").unwrap();

        assert!(!flight.finish(request_id + 1));
        assert_eq!(flight.holder().as_deref(), Some("main"));
    }
```

- [ ] **Step 2: Run to verify it fails — and be honest about which test is red**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml quit_flow`

Expected: FAIL to **compile**, with
`no method named begin_transfer found for struct WindowCoordinator` and
`no method named all_panes found for struct WindowCoordinator` from
`the_census_counts_a_pane_that_is_mid_transfer` (plus the unresolved
`coordinator::test_support::RecordingSink`).

Stated plainly because it would otherwise be misread: **only that one test has a
real red phase.** The other two exercise `census_for`, `all_idle` and
`QuitFlight`, all of which landed in B7 and B8, so they pass the moment they are
written. They are regression cover for this task's wiring, not a red phase —
their value is that they pin the request-id contract the frontend binds to. The
earlier draft claimed `unresolved import 'crate::pane_census'` and a missing
`PtyInfo` path; both were wrong — B7 is already landed by this point in the
order, and `crate::info::PtyInfo` is the correct path (`info.rs:33-40`).

- [ ] **Step 3: Implement the request and the two commands**

Add to `src-tauri/src/quit_flow.rs`:

```rust
use crate::coordinator::WindowCoordinator;
use crate::pane_census::census_for;
use crate::pty::PtyState;
use tauri::{Emitter, Manager, Runtime, State};

/// Ask one window — the focused one, else the most recently focused — to show
/// the quit dialog.
///
/// The census is gathered off the event loop: on Windows classification is a
/// WMI query, and blocking the loop here would freeze every window while the
/// user waits to be asked a question.
pub fn request_quit<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(target) = crate::window_lifecycle::menu_target(app) else {
        // No window can answer. Exit rather than prevent: see `exit_policy`.
        app.exit(0);
        return;
    };
    let flight = app.state::<QuitFlight>();
    let Some(request_id) = flight.try_begin(&target) else {
        // A dialog is already open somewhere. A second Cmd+Q is a no-op.
        return;
    };

    let pane_ids = app.state::<WindowCoordinator>().all_panes();
    let snapshots = app.state::<PtyState>().session_snapshots(&pane_ids);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let infos = crate::info::inspect_snapshots(snapshots).await;
        let census = census_for(request_id, &infos);
        if handle.emit_to(target, "quit-requested", census).is_err() {
            // The chosen window went away between the census and the emit;
            // release the lock so the next Cmd+Q is not swallowed.
            handle.state::<QuitFlight>().finish(request_id);
        }
    });
}

/// The user said yes. Exiting with a code is what makes `exit_policy` allow it.
#[tauri::command]
pub fn confirm_quit(
    app: tauri::AppHandle,
    flight: State<'_, QuitFlight>,
    request_id: u64,
) -> Result<(), String> {
    if !flight.finish(request_id) {
        return Err(format!("Quit request #{request_id} is no longer current"));
    }
    app.exit(0);
    Ok(())
}

/// The user said no, or the dialog failed to open.
#[tauri::command]
pub fn cancel_quit(flight: State<'_, QuitFlight>, request_id: u64) -> Result<(), String> {
    if !flight.finish(request_id) {
        return Err(format!("Quit request #{request_id} is no longer current"));
    }
    Ok(())
}
```

- [ ] **Step 4: Delete the superseded quit state — all four sites, in one edit**

`QuitState` has four references in `lib.rs` and removing only the declaration
leaves the tree uncompilable for every task between here and B15. Delete all of
them now:

1. `lib.rs:17-26` — the `QuitState` struct and the old zero-argument
   `confirm_quit`. `exit_policy`'s `code.is_some()` branch now carries what the
   `confirmed` flag carried, without a flag that can be left set.
2. `lib.rs:14` — `use std::sync::atomic::{AtomicBool, Ordering};`, which nothing
   else in the file uses once the struct is gone.
3. `lib.rs:49` — `.manage(QuitState::default())` in the builder chain. Replace
   it in the same edit with `.manage(quit_flow::QuitFlight::default())`; B15
   Step 1 adds the remaining managed state and expects this one already present.
4. `lib.rs:81` — the bare `confirm_quit` entry in `generate_handler!`. Replace it
   with `quit_flow::confirm_quit` and `quit_flow::cancel_quit` here rather than
   waiting for B15, for the same reason.

The `RunEvent` closure at `lib.rs:85-93` still reads `QuitState`, so also swap
its body to the `exit_policy` form now — the final version is in B15 Step 4 and
is identical; writing it here is what keeps the tree green, not a second
version to reconcile.

**Why this is not deferred to B15:** the task order runs B6, B16, B17, B11, B12
and B14 between this task and B15, and each of them ends with
`cargo test --locked`. Leaving any of the four sites behind makes all six of
those verification steps fail with `cannot find struct QuitState` /
`cannot find function confirm_quit` — failures that look like the designed
coordinator compile errors but are not.

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: green, **once** `WindowCoordinator::all_panes()` exists. If it does
not, the failure is `no method named all_panes found for struct WindowCoordinator`
— that is the coordination point named in Findings (b), not something to patch
around locally.

- [ ] **Step 6: MANUAL verification — run this after Task B15, not here**

Nothing calls `request_quit` yet: `menu.rs` still broadcasts (Task B6) and the
`RunEvent::ExitRequested` closure is untouched (Task B15), so ⌘Q does not reach
this code at the end of this task. Once B15 has landed, under `npm run tauri
dev` with two windows and a busy agent running in the **non-focused** one: press
⌘Q. Exactly one dialog appears, in the focused window, and it names the agent
running in the other window. Press ⌘Q again while that dialog is open: no second
dialog. Cancel, then ⌘Q again: the dialog comes back.

- [ ] **Step 7: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/quit_flow.rs src-tauri/src/lib.rs
git commit -m "feat(window): ask one window to confirm quit from a Rust census"
```

---

### Task B11: Handle `CloseRequested` per window

**Files:**

- Modify: `src-tauri/src/window_close.rs`
- Modify: `src-tauri/src/pty.rs` (extract `terminate_pane` out of `kill_pty`)
- Test: none — `CloseFlight`'s tests landed in Task B9, and everything this task
  adds needs a live `tauri::Window`. See the note below the Interfaces block.

**Interfaces:**

- Consumes: `coordinator::abort_transfers_involving(app: &AppHandle, label: &str)`
  (**transfer section**; takes the handle because aborting emits
  `transfer:settled` to windows that are still alive — exactly this path),
  `WindowCoordinator::panes_for_window(&str) -> Vec<u32>`
  (`coordinator.rs:44-55`, drop its `#[allow(dead_code)]`),
  `pty::kill_pty`-equivalent teardown, `pane_census::census_for`,
  `info::inspect_snapshots`, `CloseFlight` (B9).
- Produces: `pub fn on_close_requested(window: &tauri::Window) -> bool`
  (returns whether the close was prevented; **not** generic over `Runtime`,
  because `abort_transfers_involving` takes a concrete `&AppHandle` and the sole
  caller is `lib.rs`'s `.on_window_event`, which is already `Wry`);
  `#[tauri::command] pub fn confirm_close_window(window, ...) -> Result<(), String>`;
  `#[tauri::command] pub fn cancel_close_window(window, ...) -> Result<(), String>`;
  event `window:close-requested` with a `BusyCensus` payload.

Order is the spec's (§9.5) and the order matters: **abort transfers first**, so
a pane mid-handoff has resolved to an owner before the census reads owners, and
so a pane that was on its way out of this window is back where it can be counted
and killed.

`destroy()`, not `close()`: `close()` re-fires `CloseRequested` and would loop
through this same guard.

**The teardown order has no unit test, and this plan will not fake one.** An
earlier draft encoded the order as a `teardown_order() -> [TeardownStep; 4]`
constant and asserted it — a tautology: the assertion compared the
implementation's own literal against itself, nothing consumed the value, and
reordering the real handler left the test green. Both halves of the sequence are
also unreachable from a unit test (`on_close_requested` takes a `tauri::Window`;
`confirm_close_window` is a command taking the same), and the sequence spans two
entry points, so no single iteration could drive it either. The order is
therefore enforced by a doc comment plus **Step 4's manual check**, which
observes the effect that actually matters. What _is_ unit-tested here is
`CloseFlight` (Task B9): the one piece with real state and no window.

- [ ] **Step 1: Implement the handler and the two commands**

Add to `src-tauri/src/window_close.rs`:

```rust
use crate::coordinator::{self, WindowCoordinator};
use crate::pane_census::census_for;
use crate::pty::PtyState;
use tauri::{Emitter, Manager, State};

/// Returns true when the close was prevented and a prompt was dispatched.
///
/// # Teardown order (spec §9.5) — this sequence is load-bearing
///
/// 1. abort transfers involving this window (here)
/// 2. census this window's OWN panes (here, spawned)
/// 3. kill those panes (`confirm_close_window`)
/// 4. destroy the window (`confirm_close_window`)
///
/// Steps 3 and 4 run in the other entry point because the user answers a dialog
/// between 2 and 3. **Do not reorder 1 and 2**: a pane mid-handoff has no owner
/// to count and no PTY this window may kill, so an abort after the census would
/// either miss the pane or count it in the wrong window. There is no unit test
/// holding this — see the note above the steps — so this comment and the manual
/// check in Step 4 are the guard.
///
/// Runs on the event loop, so it does nothing slow: the abort is a lock and a
/// flush, and the census is spawned.
///
/// Not generic over `Runtime`: `abort_transfers_involving` takes a concrete
/// `&AppHandle`, and the only caller is `lib.rs`'s `.on_window_event`, which is
/// already `Wry`.
pub fn on_close_requested(window: &tauri::Window) -> bool {
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    // Order step 1. Before the census, so a pane that was mid handoff is back
    // with an owner and gets counted exactly once. Takes the handle because the
    // abort emits `transfer:settled` to the peer window that is still alive.
    coordinator::abort_transfers_involving(&app, &label);

    let Some(request_id) = app.state::<CloseFlight>().try_begin(&label) else {
        // A prompt for this window is already open; keep it open.
        return true;
    };

    // Order step 2, off the event loop.
    let pane_ids = app.state::<WindowCoordinator>().panes_for_window(&label);
    let snapshots = app.state::<PtyState>().session_snapshots(&pane_ids);
    let handle = app.clone();
    let target = label.clone();
    tauri::async_runtime::spawn(async move {
        let infos = crate::info::inspect_snapshots(snapshots).await;
        let census = census_for(request_id, &infos);
        if handle
            .emit_to(target.clone(), "window:close-requested", census)
            .is_err()
        {
            handle.state::<CloseFlight>().forget(&target);
        }
    });
    true
}

/// Steps 3 and 4: kill this window's panes, then destroy it.
#[tauri::command]
pub fn confirm_close_window(
    window: tauri::Window,
    flight: State<'_, CloseFlight>,
    coordinator: State<'_, WindowCoordinator>,
    pty: State<'_, PtyState>,
    request_id: u64,
) -> Result<(), String> {
    let label = window.label().to_string();
    if !flight.take(&label, request_id) {
        return Err(format!("Close request #{request_id} is no longer current"));
    }
    for pane_id in coordinator.panes_for_window(&label) {
        // A failed kill must not strand the window open: the PTY is reported
        // and the teardown continues, because the alternative is a window the
        // user cannot close.
        if let Err(error) = crate::pty::terminate_pane(&pty, &coordinator, pane_id) {
            eprintln!("Deck: could not terminate pane #{pane_id} while closing {label}: {error}");
        }
    }
    // destroy(), not close(): close() re-fires CloseRequested and would run
    // this guard again.
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cancel_close_window(
    window: tauri::Window,
    flight: State<'_, CloseFlight>,
    request_id: u64,
) -> Result<(), String> {
    if !flight.take(window.label(), request_id) {
        return Err(format!("Close request #{request_id} is no longer current"));
    }
    Ok(())
}
```

`crate::pty::terminate_pane` does not exist yet. `kill_pty` (`pty.rs:471-500`)
is a `#[tauri::command]` whose whole body is reusable: extract its body into
`pub(crate) fn terminate_pane(state: &PtyState, coordinator: &WindowCoordinator, id: u32) -> Result<(), String>`
and make `kill_pty` a one-line adapter. **This is the one edit this section makes
to `pty.rs`, and the transfer section also edits `pty.rs` for owner validation
(spec §8) — serialize the two.**

- [ ] **Step 2: Run to verify the suite is green**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: green once `abort_transfers_involving` exists. Missing it fails with
`cannot find function 'abort_transfers_involving' in module 'crate::coordinator'`;
if the transfer section made it a method instead, the failure is
`expected function, found method` at the same line and the fix is the one-line
form in the §0.2 note. Either way the compile error is by design — do not stub
it here. `CloseFlight`'s four tests from Task B9 keep passing; this task adds no
unit test, for the reason stated above the steps.

- [ ] **Step 3: MANUAL verification — one window's close leaves its peers alone**

Under `npm run tauri dev`: with two windows and an agent running in window B,
click B's close button. One dialog, naming that agent, in B. Cancel — B stays
and its pane keeps running. Close again and confirm — B goes away, A keeps every
one of its panes, and no pane in A dies. Then close A: the app quits.

- [ ] **Step 4: MANUAL verification — the abort really precedes the census**

This is the check that replaces the tautological unit test. Start a pane moving
from B to a new window, and while it is mid-transfer close B. Expected: the
dialog B shows counts that pane **once** (it is back with B after the abort),
and confirming kills it once. If the abort were running after the census, the
pane would be missing from the dialog and would survive the close as an orphan —
visible as an agent process still in `ps` after B is gone.

Mid-transfer is tens of milliseconds, so make the window wide enough to hit:
temporarily raise §7.5's 10 s bound is **not** needed — instead detach a pane
with a large scrollback, which lengthens the serialize step, and close B while
the new window is still blank.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_close.rs src-tauri/src/pty.rs src-tauri/src/coordinator.rs
git commit -m "feat(window): guard and close one window without its peers"
```

---

### Task B12: Wire `Destroyed` to the orphan rule and prune every label-keyed slot

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs` (add `forget_window`)
- Modify: `src-tauri/src/lib.rs` (the `.on_window_event` clause)
- Test: `src-tauri/src/window_lifecycle.rs`

**Interfaces:**

- Consumes: `WindowCoordinator::on_window_destroyed(&self, app: &tauri::AppHandle, window_label: &str)`
  (**assumed — transfer section**, see the frozen-contract note). This wiring
  task fails at compile time if the method is absent; do not stub it.
- Produces: `pub fn forget_window<R: Runtime>(app: &tauri::AppHandle<R>, label: &str)`.

Every slot keyed by a window label must be released here, or a window that dies
while holding one bricks that feature for the rest of the process: the quit
lock (⌘Q stops working), the close lock (that label can never prompt again — it
matters because labels are per-process and a crashed window's label is gone, but
the map entry is not), the pending adoption (a leak), the updater flight (no
window ever checks for updates again), and the focus registry (the menu keeps
routing to a dead label until the `existing` filter drops it).

The orphan rule and the pruning are **not** symmetric with `CloseRequested`:
`Destroyed` is the crash path, so it kills panes still owned by the window but
must **not** blanket-abort transfers — a source window may die after `prepare`
and the destination is still entitled to claim and commit (§7.6). That asymmetry
lives inside `on_window_destroyed`, which this task only calls.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/window_lifecycle.rs`:

```rust
    use crate::quit_flow::QuitFlight;
    use crate::update_flight::UpdateFlight;
    use crate::window_close::CloseFlight;

    #[test]
    fn destroying_a_window_releases_every_slot_it_held() {
        let focus = FocusRegistry::default();
        let pending = PendingAdoptions::default();
        let quit = QuitFlight::default();
        let close = CloseFlight::default();
        let update = UpdateFlight::default();

        focus.record("deck-1");
        pending.register("deck-1".into(), "token-abc".into());
        quit.try_begin("deck-1").unwrap();
        close.try_begin("deck-1").unwrap();
        assert!(update.try_begin("deck-1"));

        super::release_window_slots(&focus, &pending, &quit, &close, &update, "deck-1");

        assert_eq!(focus.most_recent_among(&labels(&["deck-1"])), None);
        assert_eq!(pending.take("deck-1"), None);
        assert!(
            quit.try_begin("main").is_some(),
            "a dead window must not brick quit"
        );
        assert!(close.try_begin("deck-1").is_some());
        assert!(
            update.try_begin("main"),
            "a dead window must not brick update checks"
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml destroying_a_window_releases`

Expected: FAIL — `cannot find function 'release_window_slots' in module 'super'`.
Land B13 (`UpdateFlight`) before this task, or the failure is the unresolved
import instead.

- [ ] **Step 3: Implement the pure pruning**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
use crate::quit_flow::QuitFlight;
use crate::update_flight::UpdateFlight;
use crate::window_close::CloseFlight;

/// Release every slot keyed by `label`.
///
/// Split from `forget_window` so it is testable without an app handle: this is
/// the crash-safety rule, and "peers" means any window can be the one that dies
/// while holding the quit dialog or the updater flight.
pub fn release_window_slots(
    focus: &FocusRegistry,
    pending: &PendingAdoptions,
    quit: &QuitFlight,
    close: &CloseFlight,
    update: &UpdateFlight,
    label: &str,
) {
    focus.forget(label);
    pending.forget(label);
    quit.forget_window(label);
    close.forget(label);
    update.forget(label);
}

/// The app-handle adapter over `release_window_slots`.
pub fn forget_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    release_window_slots(
        &app.state::<FocusRegistry>(),
        &app.state::<PendingAdoptions>(),
        &app.state::<QuitFlight>(),
        &app.state::<CloseFlight>(),
        &app.state::<UpdateFlight>(),
        label,
    );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml destroying_a_window_releases`

Expected: 1 passed.

- [ ] **Step 5: Wire the window events**

In `src-tauri/src/lib.rs`, insert between `.invoke_handler(...)` (ends at
`lib.rs:82`) and `.build(...)` (`lib.rs:83`):

```rust
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                window
                    .state::<window_lifecycle::FocusRegistry>()
                    .record(window.label());
                // The submenu is ordered most-recently-focused first (B17), so
                // focus changing changes its contents.
                let _ = menu::rebuild_move_pane_submenu(window.app_handle());
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window_close::on_close_requested(window) {
                    api.prevent_close();
                }
            }
            tauri::WindowEvent::Destroyed => {
                let app = window.app_handle();
                let label = window.label().to_string();
                // Crash path: no CloseRequested fired and no busy guard ran, so
                // the panes this window still owned would otherwise outlive it
                // with nobody reading their output (spec §7.6).
                app.state::<coordinator::WindowCoordinator>()
                    .on_window_destroyed(app, &label);
                window_lifecycle::forget_window(app, &label);
                // After forget_window, so the dead label is already out of the
                // focus registry and cannot be listed as a drop target.
                let _ = menu::rebuild_move_pane_submenu(app);
            }
            _ => {}
        })
```

The two `rebuild_move_pane_submenu` calls belong to Task B17's feature but are
written **here**, because this is the task that creates the `.on_window_event`
clause. B17 Step 9 says so explicitly and provides the non-macOS no-op that makes
these two lines compile on every target.

- [ ] **Step 6: Run to verify it compiles and the suite is green**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml`

Expected: green. A missing `on_window_destroyed` fails as
`no method named on_window_destroyed found for struct WindowCoordinator` — that is the
loud failure this task is written to produce.

- [ ] **Step 7: MANUAL verification — the crash path has no unit test**

Under `npm run tauri dev` with two windows: find the detached window's webview
process and kill it from Activity Monitor / Task Manager so `Destroyed` fires
without `CloseRequested`. The agent processes that window owned must be gone
(check `ps` for the agent binary), the other window must keep every pane, and
⌘Q must still open a dialog afterwards.

- [ ] **Step 8: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs src-tauri/src/lib.rs
git commit -m "feat(window): orphan panes and release slots when a window dies"
```

---

### Task B13: Updater single-flight

**Files:**

- Create: `src-tauri/src/update_flight.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration)
- Test: `src-tauri/src/update_flight.rs`

**Interfaces:**

- Consumes: nothing.
- Produces: `pub struct UpdateFlight` with `try_begin(&self, label: &str) -> bool`,
  `finish(&self, label: &str) -> bool`, `forget(&self, label: &str)`;
  `#[tauri::command] pub fn begin_update_check(window, flight) -> bool`;
  `#[tauri::command] pub fn end_update_check(window, flight) -> Result<(), String>`.

Spec §9.4/§9.5 rules out "the first window is primary" for the right reason: the
first window can die first. Instead this is a lock any window may take, and it
is released by `Destroyed` (Task B12) when its holder dies — otherwise a crash
during a check means no window ever checks again.

`src/ui/app.tsx:321` calls `updater.start()` unconditionally on mount, which is
what makes this necessary: two windows would otherwise both download and both
prompt.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/update_flight.rs
#[cfg(test)]
mod tests {
    use super::UpdateFlight;

    #[test]
    fn only_one_window_checks_at_a_time() {
        let flight = UpdateFlight::default();

        assert!(flight.try_begin("main"));
        assert!(!flight.try_begin("deck-1"));
    }

    #[test]
    fn the_holder_releases_and_the_next_window_may_check() {
        let flight = UpdateFlight::default();
        flight.try_begin("main");

        assert!(!flight.finish("deck-1"), "a non-holder cannot release");
        assert!(flight.finish("main"));
        assert!(flight.try_begin("deck-1"));
    }

    #[test]
    fn a_dead_holder_does_not_block_every_later_check() {
        let flight = UpdateFlight::default();
        flight.try_begin("deck-1");
        flight.forget("deck-1");

        assert!(flight.try_begin("main"));
    }

    #[test]
    fn forgetting_a_window_that_is_not_the_holder_changes_nothing() {
        let flight = UpdateFlight::default();
        flight.try_begin("main");
        flight.forget("deck-1");

        assert!(!flight.try_begin("deck-1"));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml update_flight`

Expected: FAIL — `failed to resolve: use of undeclared crate or module 'update_flight'`,
then `cannot find type 'UpdateFlight' in this scope`.

- [ ] **Step 3: Declare the module and implement the flight**

In `src-tauri/src/lib.rs`, add `mod update_flight;` after `mod shell_integration;`.

```rust
// src-tauri/src/update_flight.rs
//! One update check at a time across peer windows (spec §9.5).
//!
//! Not "the first window is primary": with peers the first window can be the
//! first to die. Any window may hold the flight, and `Destroyed` releases it.

use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct UpdateFlight {
    holder: Mutex<Option<String>>,
}

impl UpdateFlight {
    /// True when this window won the check. False means another window is
    /// already checking and this one must do nothing.
    pub fn try_begin(&self, label: &str) -> bool {
        let Ok(mut holder) = self.holder.lock() else {
            return false;
        };
        if holder.is_some() {
            return false;
        }
        *holder = Some(label.to_string());
        true
    }

    /// Release the flight. False when `label` is not the holder, so a stale
    /// end from a previous check cannot free a live one.
    pub fn finish(&self, label: &str) -> bool {
        let Ok(mut holder) = self.holder.lock() else {
            return false;
        };
        match holder.as_deref() {
            Some(current) if current == label => {
                *holder = None;
                true
            }
            _ => false,
        }
    }

    pub fn forget(&self, label: &str) {
        self.finish(label);
    }
}

#[tauri::command]
pub fn begin_update_check(window: tauri::Window, flight: State<'_, UpdateFlight>) -> bool {
    flight.try_begin(window.label())
}

#[tauri::command]
pub fn end_update_check(
    window: tauri::Window,
    flight: State<'_, UpdateFlight>,
) -> Result<(), String> {
    if !flight.finish(window.label()) {
        return Err(format!(
            "Window {} does not hold the update check",
            window.label()
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml update_flight`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/update_flight.rs src-tauri/src/lib.rs
git commit -m "feat(window): single-flight the updater check across windows"
```

---

### Task B14: Merge settings patches under a lock

**Files:**

- Create: `src-tauri/src/settings_merge.rs`
- Modify: `src-tauri/src/lib.rs` (module declaration)
- Test: `src-tauri/src/settings_merge.rs`

**Interfaces:**

- Consumes: `tauri_plugin_store::StoreExt` (already a dependency,
  `src-tauri/Cargo.toml:23`; registered at `lib.rs:32`). Store file
  `settings.json`, key `settings` — both read from
  `src/settings/settings-store.ts:11-12`.
- Produces: `pub fn merge_settings(current: &Value, patch: &Value) -> Value`;
  `pub struct SettingsWriteLock`;
  `#[tauri::command] pub fn apply_settings_patch(app, lock, patch: Value) -> Result<Value, String>`;
  broadcast event `settings:merged` carrying the merged object.

**Scope, exactly as §9.5 states it.** The merge is **shallow**: a patch's
top-level keys replace whole values, which is what `updateSettings`
(`settings-store.ts:66-70`) already does with `{ ...settings.value, ...patch }`.
`presets`, `workspaces` and the logo stores keep last-write-wins and are **not**
routed through this command — §9.5 accepted that residual risk deliberately.
`onKeyChange` was considered and rejected; do not reintroduce it.

The broadcast here is correct and is the only correct broadcast in this section:
every window must converge on the merged value.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/settings_merge.rs
#[cfg(test)]
mod tests {
    use super::merge_settings;
    use serde_json::json;

    #[test]
    fn a_patch_replaces_only_the_keys_it_names() {
        let current = json!({ "fontSize": 13, "theme": "night", "colorOverrides": { "red": "#f00" } });
        let patch = json!({ "fontSize": 15 });

        assert_eq!(
            merge_settings(&current, &patch),
            json!({ "fontSize": 15, "theme": "night", "colorOverrides": { "red": "#f00" } })
        );
    }

    #[test]
    fn two_patches_touching_different_keys_both_survive() {
        // The whole point: window A changing the font must not undo window B
        // changing the theme.
        let current = json!({ "fontSize": 13, "theme": "night" });
        let after_a = merge_settings(&current, &json!({ "fontSize": 15 }));
        let after_b = merge_settings(&after_a, &json!({ "theme": "dawn" }));

        assert_eq!(after_b, json!({ "fontSize": 15, "theme": "dawn" }));
    }

    #[test]
    fn a_nested_object_is_replaced_wholesale_not_deep_merged() {
        // Shallow on purpose: it mirrors `updateSettings`'s spread, so a caller
        // that clears one color override still clears it.
        let current = json!({ "colorOverrides": { "red": "#f00", "blue": "#00f" } });
        let patch = json!({ "colorOverrides": { "red": "#a00" } });

        assert_eq!(
            merge_settings(&current, &patch),
            json!({ "colorOverrides": { "red": "#a00" } })
        );
    }

    #[test]
    fn a_null_value_is_stored_not_treated_as_a_deletion() {
        let current = json!({ "logo": "deck" });
        assert_eq!(
            merge_settings(&current, &json!({ "logo": null })),
            json!({ "logo": null })
        );
    }

    #[test]
    fn a_non_object_current_starts_from_an_empty_object() {
        assert_eq!(
            merge_settings(&json!(null), &json!({ "fontSize": 15 })),
            json!({ "fontSize": 15 })
        );
    }

    #[test]
    fn a_non_object_patch_leaves_the_settings_untouched() {
        let current = json!({ "fontSize": 13 });
        assert_eq!(merge_settings(&current, &json!("nonsense")), current);
        assert_eq!(merge_settings(&current, &json!([1, 2])), current);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml settings_merge`

Expected: FAIL — `failed to resolve: use of undeclared crate or module 'settings_merge'`,
then `cannot find function 'merge_settings'`.

- [ ] **Step 3: Declare the module and implement the merge**

In `src-tauri/src/lib.rs`, add `mod settings_merge;` after `mod pty;`.

```rust
// src-tauri/src/settings_merge.rs
//! Settings writes that survive two windows editing at once (spec §9.5).
//!
//! `updateSettings` read the whole object from its own signal, changed one key
//! and wrote the whole object back. With peer windows that is a lost update:
//! whoever writes second overwrites the other's change with a value it read
//! before that change existed. The fix is to send the change, not the result —
//! Rust holds the only lock and every window learns the merged value.
//!
//! `onKeyChange` was considered and rejected: it announces that a write
//! happened, which does not stop two read-modify-write cycles from racing.

use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::{Emitter, State};
use tauri_plugin_store::StoreExt;

/// Mirrors `src/settings/settings-store.ts` — same file, same key.
const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

/// Serializes read-modify-write. The store's own lock covers a single `get` or
/// `set`, not the sequence, which is exactly the window that loses an update.
#[derive(Default)]
pub struct SettingsWriteLock(Mutex<()>);

/// Shallow merge: a patch's top-level keys replace their values outright,
/// matching `{ ...settings.value, ...patch }` on the TypeScript side. A patch
/// that is not an object is ignored rather than allowed to replace everything.
pub fn merge_settings(current: &Value, patch: &Value) -> Value {
    let Some(patch) = patch.as_object() else {
        return current.clone();
    };
    let mut merged: Map<String, Value> = current
        .as_object()
        .cloned()
        .unwrap_or_else(Map::new);
    for (key, value) in patch {
        merged.insert(key.clone(), value.clone());
    }
    Value::Object(merged)
}

/// Merge `patch` into the stored settings and tell every window the result.
#[tauri::command]
pub fn apply_settings_patch(
    app: tauri::AppHandle,
    lock: State<'_, SettingsWriteLock>,
    patch: Value,
) -> Result<Value, String> {
    let guard = lock
        .0
        .lock()
        .map_err(|_| "The settings lock is poisoned".to_string())?;

    let store = app.store(STORE_FILE).map_err(|error| error.to_string())?;
    let current = store.get(STORE_KEY).unwrap_or(Value::Null);
    let merged = merge_settings(&current, &patch);
    store.set(STORE_KEY, merged.clone());
    // Explicit save, not the autosave timer: the plugin discards the timer's
    // error, which is how a full disk used to look like a successful write.
    store.save().map_err(|error| error.to_string())?;
    drop(guard);

    // The one correct broadcast in this module: every window holds a copy of
    // settings and every copy must converge.
    let _ = app.emit("settings:merged", merged.clone());
    Ok(merged)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml settings_merge`

Expected: 6 passed.

- [ ] **Step 5: MANUAL verification — the store round trip has no unit test**

`apply_settings_patch` needs a real app handle and a real store file. Under
`npm run tauri dev` with two windows: change the font size in window A and the
theme in window B in quick succession. Both changes must be visible in both
windows, and after quitting and relaunching, both must still be there. Changing
one setting must never revert the other.

- [ ] **Step 6: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/settings_merge.rs src-tauri/src/lib.rs
git commit -m "feat(settings): merge settings patches under a Rust lock"
```

---

### Task B16: `offer_transfer` — hand a token to an already-running window

**Files:**

- Modify: `src-tauri/src/window_lifecycle.rs`
- Test: `src-tauri/src/window_lifecycle.rs`

**Interfaces:**

- Consumes: nothing from the coordinator — the token is opaque here.
- Produces:
  `#[tauri::command] pub fn offer_transfer(app: tauri::AppHandle, token: String, target_label: String) -> Result<(), String>`;
  event `transfer:offer` with payload `{"token":"<opaque string>"}`, emitted to
  `target_label` only;
  `pub fn live_window_labels<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String>`.

**Why this exists.** `open_pane_window` covers only the new-window path. Spec
§10.1's **live-adopt** — inserting the pane into an already running window's
active tab — has no way to deliver a token today: the destination window is not
booting, so `window_boot_mode` never runs for it. `transfer:offer` is that
delivery. The event name is fixed by the merge lead (2026-08-10); the frontend
section has already modelled its consumer against it.

**An unknown label must be an `Err`, not a silent drop.** `emit_to` returns `Ok`
for a label nobody is listening on, so without the liveness check a transfer
offered to a window that just closed would look successful and the pane would
sit in `Transferring` until the §7.5 timeout.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/window_lifecycle.rs`:

```rust
    #[test]
    fn an_offer_to_a_live_window_is_accepted() {
        assert_eq!(
            super::validate_offer_target(&labels(&["main", "deck-1"]), "deck-1"),
            Ok(())
        );
    }

    #[test]
    fn an_offer_to_an_unknown_window_is_rejected_not_dropped() {
        // emit_to succeeds for a label nobody listens on, so without this the
        // pane would hang in Transferring until the 10 s bound in §7.5.
        assert_eq!(
            super::validate_offer_target(&labels(&["main"]), "deck-9"),
            Err("Window deck-9 is not open".to_string())
        );
        assert_eq!(
            super::validate_offer_target(&[], "main"),
            Err("Window main is not open".to_string())
        );
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml an_offer_to`

Expected: FAIL — `cannot find function 'validate_offer_target' in module 'super'`.

- [ ] **Step 3: Implement the validation and the command**

Add to `src-tauri/src/window_lifecycle.rs`:

```rust
/// Payload of `transfer:offer`. A struct rather than a bare string so the event
/// can grow a field without breaking the frontend's parse.
#[derive(Clone, Debug, serde::Serialize)]
pub struct TransferOffer {
    pub token: String,
}

pub fn live_window_labels<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
    app.webview_windows().keys().cloned().collect()
}

pub fn validate_offer_target(live: &[String], target_label: &str) -> Result<(), String> {
    if live.iter().any(|label| label == target_label) {
        return Ok(());
    }
    Err(format!("Window {target_label} is not open"))
}

/// Hand a prepared transfer to a window that is already running (spec §10.1
/// live-adopt). The new-window path goes through `open_pane_window` instead.
#[tauri::command]
pub fn offer_transfer(
    app: tauri::AppHandle,
    token: String,
    target_label: String,
) -> Result<(), String> {
    validate_offer_target(&live_window_labels(&app), &target_label)?;
    app.emit_to(target_label, "transfer:offer", TransferOffer { token })
        .map_err(|error| error.to_string())
}
```

This needs `use tauri::Emitter;` alongside the existing `use tauri::Manager;` in
this module.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml an_offer_to`

Expected: 2 passed.

- [ ] **Step 5: MANUAL verification — after Task B15 and the frontend section**

Under `npm run tauri dev` with two windows: use File ▸ Move Pane to Window ▸ to
send a pane from A into B. It appears in B's active tab with its scrollback, and
A loses it without killing the PTY. Then close B and immediately repeat: the
offer fails with a visible error rather than leaving the pane frozen.

- [ ] **Step 6: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/window_lifecycle.rs
git commit -m "feat(window): offer a prepared transfer to a running window"
```

---

### Task B17: The dynamic "Move Pane to Window ▸" submenu

**Files:**

- Modify: `src-tauri/src/menu.rs`
- Test: `src-tauri/src/menu.rs`

**Interfaces:**

- Consumes: `window_lifecycle::{menu_target, live_window_labels}` (B2, B16),
  `FocusRegistry::rank` (B2).
- Produces: `pub const WINDOW_TARGET_PREFIX: &str = "window-target:"`;
  `MenuRoute::MovePaneToWindow { window: String, target_label: String }`;
  `pub fn rebuild_move_pane_submenu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()>`;
  event `menu:move-pane-to-window` with payload `{"targetLabel":"<label>"}`.

**Why this is built in Rust, and why it is R3-safe.** The frontend section
proved the alternative is a dead end: a dynamic action id such as
`move-pane-to-window:deck-2` is rejected by `isActionId`
(`src/terminal/action-registry.ts:459-471`), which is the validation guard on an
untrusted IPC payload, and the generated registry cannot express a submenu whose
items depend on live windows. `menu.rs` is hand-written — only `menu_registry.rs`
is generated — so building the submenu here touches no generated code (R3). The
frontend keeps only the static `move-pane-to-new-window` action.

**Item ids use their own prefix, never `action:`.** `window-target:<label>` can
therefore never reach `isActionId`, because `route_menu_event` dispatches it down
a different arm entirely.

**The click cannot call `offer_transfer` directly, and here is why.**
`offer_transfer` needs a token, and only the source window can produce one:
`prepare_transfer` takes the owning `tauri::Window` and the pane id, and Rust
does not know which pane inside a window has focus. Spec §7.4 also requires the
source to `flush()` and serialize its xterm buffer between `prepare` and
`claim` — a frontend act by construction. So the menu click routes to the
focused window carrying the target label, and that window runs
prepare → stage → `offer_transfer`. This is the same "drives `offer_transfer`"
the lead specified, with the one hop that the frozen contract forces.

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `src-tauri/src/menu.rs`:

```rust
    #[test]
    fn a_window_target_click_routes_to_the_focused_window_with_its_target() {
        assert_eq!(
            route_menu_event("window-target:deck-2", Some("main")),
            MenuRoute::MovePaneToWindow {
                window: "main".into(),
                target_label: "deck-2".into()
            }
        );
    }

    #[test]
    fn a_window_target_click_with_no_focused_window_is_dropped() {
        assert_eq!(route_menu_event("window-target:deck-2", None), MenuRoute::Dropped);
    }

    #[test]
    fn a_window_target_id_never_looks_like_a_keymap_action() {
        // `action:` is what the frontend validates with isActionId. A dynamic
        // id must not travel that path — action-registry.ts would reject it.
        assert!(!"window-target:deck-2".starts_with(super::ACTION_PREFIX));
    }

    #[test]
    fn the_submenu_lists_every_other_window_most_recent_first() {
        assert_eq!(
            super::move_pane_targets(&["deck-1".into(), "main".into(), "deck-2".into()], "deck-1"),
            vec!["main".to_string(), "deck-2".to_string()]
        );
    }

    #[test]
    fn the_submenu_is_empty_when_there_is_nowhere_to_move_a_pane() {
        assert!(super::move_pane_targets(&["main".into()], "main").is_empty());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml menu::tests`

Expected: FAIL — `no variant named 'MovePaneToWindow' found for enum MenuRoute`
and `cannot find function 'move_pane_targets' in module 'super'`.

- [ ] **Step 3: Extend the router, and add the imports it needs**

`menu.rs` today imports `tauri::{menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder}, App, Emitter, Runtime}` under `#[cfg(target_os = "macos")]`
(`menu.rs:3-7`). Three names are missing for this task and must be added to that
same macOS-gated `use`, not to a second one:

- `tauri::Manager` — Step 6 calls `app.state::<FocusRegistry>()`.
- `tauri::menu::Submenu` — Step 7's `build_menu` / `install_menu_with_move_pane`
  signatures name the type.
- `tauri::menu::Menu` — `build_menu`'s return type.

Then add beside `ACTION_PREFIX`:

```rust
/// Prefix marking a menu item built at runtime from the live window list. It is
/// deliberately NOT `action:`: these ids never reach the frontend keymap, so
/// they must never look like one to `isActionId`.
pub const WINDOW_TARGET_PREFIX: &str = "window-target:";
```

Add the variant to `MenuRoute`:

```rust
    /// A click in the dynamic Move Pane to Window submenu. `window` is the
    /// source (the focused window that owns the pane); `target_label` is where
    /// the pane should land.
    MovePaneToWindow {
        window: String,
        target_label: String,
    },
```

and extend `route_menu_event`, before the `ACTION_PREFIX` arm:

```rust
    if let Some(target_label) = id.strip_prefix(WINDOW_TARGET_PREFIX) {
        return match target {
            Some(window) => MenuRoute::MovePaneToWindow {
                window: window.to_string(),
                target_label: target_label.to_string(),
            },
            None => MenuRoute::Dropped,
        };
    }
```

- [ ] **Step 4: Implement the target list**

Add to `src-tauri/src/menu.rs`:

```rust
/// Windows a pane can move to: every live window except the one it is in,
/// in the order handed in (the caller passes `FocusRegistry::rank`'s output, so
/// the most recently used destination is first).
pub fn move_pane_targets(ranked: &[String], source: &str) -> Vec<String> {
    ranked
        .iter()
        .filter(|label| label.as_str() != source)
        .cloned()
        .collect()
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml menu::tests`

Expected: 5 new tests pass alongside the earlier menu tests.

- [ ] **Step 6: Build and rebuild the submenu**

Still in `src-tauri/src/menu.rs`, inside the `#[cfg(target_os = "macos")]`
region — the menu is macOS-only (`menu.rs:154-157`):

```rust
#[cfg(target_os = "macos")]
const MOVE_PANE_SUBMENU_TITLE: &str = "Move Pane to Window";

/// Rebuild the dynamic submenu from the live window list.
///
/// Called whenever the window set or the focus order changes — window created,
/// `Focused`, `Destroyed` — because a submenu built once at startup would list
/// windows that no longer exist and omit every window opened since.
#[cfg(target_os = "macos")]
pub fn rebuild_move_pane_submenu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    use tauri::menu::SubmenuBuilder;

    let live = crate::window_lifecycle::live_window_labels(app);
    let ranked = app
        .state::<crate::window_lifecycle::FocusRegistry>()
        .rank(&live);
    let source = crate::window_lifecycle::menu_target(app).unwrap_or_default();

    let mut builder = SubmenuBuilder::new(app, MOVE_PANE_SUBMENU_TITLE);
    let targets = move_pane_targets(&ranked, &source);
    if targets.is_empty() {
        // One window open: an empty submenu reads as broken, a disabled item
        // reads as "nowhere to send it yet".
        let placeholder = MenuItem::with_id(
            app,
            "window-target-none",
            "No Other Window",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&placeholder);
    } else {
        for label in &targets {
            let item = MenuItem::with_id(
                app,
                format!("{WINDOW_TARGET_PREFIX}{label}"),
                label,
                true,
                None::<&str>,
            )?;
            builder = builder.item(&item);
        }
    }
    let submenu = builder.build()?;
    install_menu_with_move_pane(app, submenu)
}
```

- [ ] **Step 7: Append the submenu to the File menu, then install once**

`menu_registry::build_file_menu` (`menu_registry.rs:9-44`) is **generated**: it
builds the entire File submenu and calls `.build()`, returning a finished
`Submenu<R>`. It offers no seam for an extra child, and R3 forbids editing it.
So the dynamic submenu is appended to the returned value **before the menu is
installed**:

```rust
#[cfg(target_os = "macos")]
fn build_menu<R: Runtime>(
    handle: &tauri::AppHandle<R>,
    move_pane: &tauri::menu::Submenu<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    // …app_menu / edit_menu / view_menu / window_menu exactly as install()
    // builds them today (menu.rs:53-138), then:
    let file_menu = menu_registry::build_file_menu(handle)?;
    // Appended to a submenu that is built but NOT yet installed. The
    // half-updated-menu objection applies to mutating a LIVE menu; here nothing
    // is on screen yet and the only visible transition is the single
    // `set_menu` below.
    file_menu.append(move_pane)?;
    MenuBuilder::new(handle)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}

#[cfg(target_os = "macos")]
fn install_menu_with_move_pane<R: Runtime>(
    app: &tauri::AppHandle<R>,
    move_pane: tauri::menu::Submenu<R>,
) -> tauri::Result<()> {
    let menu = build_menu(app, &move_pane)?;
    app.set_menu(menu)?;
    Ok(())
}
```

Refactor `install()` (`menu.rs:50-152`) to build a fresh submenu and delegate:
its body from the `app_menu` build through `MenuBuilder` moves into
`build_menu`, and `install()` becomes `rebuild_move_pane_submenu(app.handle())`
followed by the existing `app.on_menu_event(...)` registration. `set_menu` on
`AppHandle` is the same call `App::set_menu` makes, so the startup path and the
rebuild path are one path.

Replacing the whole menu on each rebuild — rather than removing and re-adding
items in place — is deliberate: it is one atomic `set_menu`, and there is no
window in which the File menu is missing its dynamic child. The item labels come
only from window labels this process generated, so nothing user-supplied reaches
the menu.

**Placement, and one ordering dependency.** `append` puts the submenu at the
**bottom** of the File menu, which satisfies Step 11's "File ▸ Move Pane to
Window ▸". The static `move-pane-to-new-window` action does **not** exist yet —
the frontend section registers it in `action-registry.ts`, and once it does,
`build_file_menu` will emit it in whatever position the registry declares.
Pairing the two visually ("new window" directly above "existing window")
therefore depends on the frontend section putting that action last in the File
menu. If it lands elsewhere, swap this `append` for
`file_menu.insert(move_pane, <index after move-pane-to-new-window>)`
(`tauri-2.11.5/src/menu/submenu.rs:285`) — a one-line change, and a cosmetic
issue rather than a functional one.

- [ ] **Step 8: Route the click**

Extend the `on_menu_event` match written in Task B6:

```rust
            MenuRoute::MovePaneToWindow {
                window,
                target_label,
            } => {
                // The source window runs prepare → stage → offer_transfer: only
                // it knows which pane has focus, and §7.4 makes it serialize the
                // xterm buffer before the destination may claim.
                let _ = handle.emit_to(
                    window,
                    "menu:move-pane-to-window",
                    serde_json::json!({ "targetLabel": target_label }),
                );
            }
```

- [ ] **Step 9: Provide the non-macOS no-op and the creation-time rebuild**

The menu is macOS-only (`menu.rs:154-157`), so every caller needs something to
call on the other targets:

```rust
#[cfg(not(target_os = "macos"))]
pub fn rebuild_move_pane_submenu<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}
```

Then add one line at the end of `window_lifecycle::open_pane_window` (Task B4),
just before `Ok(label)`, so a window that was just created appears in the other
windows' submenus without waiting for a focus change:

```rust
    let _ = crate::menu::rebuild_move_pane_submenu(&app);
```

**The `Focused(true)` and `Destroyed` rebuilds are wired in Task B12 Step 5**,
whose code block contains them — this task does not edit `.on_window_event`,
because that clause does not exist until B12. Task B12 runs after this one; if
B12's code block does not contain the two `rebuild_move_pane_submenu` calls, the
submenu will list dead windows and miss new ones, and this task is not done.

- [ ] **Step 10: Prove no generated code drifted**

Run: `npm run generate:menu:check`

Expected: exits 0. The dynamic submenu is hand-written in `menu.rs`; nothing in
`menu_registry.rs` changes.

- [ ] **Step 11: MANUAL verification (macOS only)**

Under `npm run tauri dev`: with one window, File ▸ Move Pane to Window ▸ shows a
single disabled "No Other Window". Open a second window: the submenu now lists
it by label. Close it: the entry disappears. Use the entry with a pane focused:
the pane arrives in the other window.

- [ ] **Step 12: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/menu.rs src-tauri/src/lib.rs
git commit -m "feat(menu): build the Move Pane to Window submenu from live windows"
```

---

### Task B15: Assemble `lib.rs` and close the exit hole

**Files:**

- Modify: `src-tauri/src/lib.rs:1-14` (module declarations, unused import),
  `:17-26` (already deleted in B10), `:46-49` (managed state), `:65-82`
  (`invoke_handler`), `:85-93` (the `RunEvent` closure)
- Test: covered by the modules above; this task adds no new unit test and says
  so deliberately — everything here is wiring that only a running app exercises.

**Interfaces:**

- Consumes: every command produced by B3, B4, B10, B11, B13, B14.
- Produces: the assembled app.

**This is the `invoke_handler` collision point.** The transfer section adds five
entries to the same `generate_handler!` list at `lib.rs:65-82`. Land whichever
section is ready first and rebase the other onto it; do not both edit the block
in parallel.

- [ ] **Step 1: Register the remaining managed state**

B10 Step 4 already replaced `.manage(QuitState::default())` with
`.manage(quit_flow::QuitFlight::default())`, so the chain at
`src-tauri/src/lib.rs:46-49` is compiling before this task starts. Add the six
that are still missing (`WindowLabels`, `FocusRegistry`, `PendingAdoptions`,
`CloseFlight`, `UpdateFlight`, `SettingsWriteLock`) so the whole chain reads:

```rust
    builder
        .manage(pty::PtyState::default())
        .manage(coordinator::WindowCoordinator::default())
        .manage(window_lifecycle::WindowLabels::default())
        .manage(window_lifecycle::FocusRegistry::default())
        .manage(window_lifecycle::PendingAdoptions::default())
        .manage(quit_flow::QuitFlight::default())
        .manage(window_close::CloseFlight::default())
        .manage(update_flight::UpdateFlight::default())
        .manage(settings_merge::SettingsWriteLock::default())
```

- [ ] **Step 2: Record the configured window's first focus**

The `main` window is created before `on_window_event` sees any focus change if
it starts focused, so seed the registry in `setup()`. Extend the existing loop
at `lib.rs:60-62`, which already hardens each startup window:

```rust
            for (label, window) in app.webview_windows() {
                platform::harden_webview(&window)?;
                if window.is_focused().unwrap_or(false) {
                    app.state::<window_lifecycle::FocusRegistry>().record(&label);
                }
            }
```

- [ ] **Step 3: Register the remaining commands**

B10 Step 4 already replaced the bare `confirm_quit` entry at `lib.rs:81` with
`quit_flow::confirm_quit` and `quit_flow::cancel_quit`. Add the nine that are
still missing, so `generate_handler!` gains **eleven** entries in total across
B10 and this task:

```rust
            window_lifecycle::window_boot_mode,
            window_lifecycle::open_pane_window,
            window_lifecycle::offer_transfer,
            window_lifecycle::focus_order,
            window_close::confirm_close_window,
            window_close::cancel_close_window,
            update_flight::begin_update_check,
            update_flight::end_update_check,
            settings_merge::apply_settings_patch,
```

- [ ] **Step 4: Confirm the exit hole is closed**

B10 Step 4 already replaced the `.run(...)` closure at `src-tauri/src/lib.rs:85-93`,
because leaving it reading `QuitState` would not compile. Verify it reads
exactly this and change nothing if it does:

```rust
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // `code` is Some only for a programmatic exit that already
                // passed its own guard. `webview_windows().is_empty()` is the
                // peer-window case this feature creates: with the last window
                // gone there is nobody to show a dialog, and preventing the
                // exit would leave a process running with no way out.
                if quit_flow::exit_policy(code, app_handle.webview_windows().len())
                    == quit_flow::ExitPolicy::PromptAndPrevent
                {
                    api.prevent_exit();
                    quit_flow::request_quit(app_handle);
                }
            }
        });
```

- [ ] **Step 5: Run the full Rust gate**

Run:

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all tests pass; formatting check exits 0.

- [ ] **Step 6: Run the frontend gate and the generated-code check**

Run:

```bash
npm test
npm run build
npm run generate:menu:check
```

Expected: **all three exit 0, and a green result here does not mean the app
works.** Carry this warning verbatim into any status report on this section:

> `npm test` and `tsc` stay green through B15 despite a frontend mismatch, and
> only runtime catches it.

`npm run build` is `tsc && vite build`, so it covers typecheck — but neither
`tsc` nor Vitest knows anything about Rust command signatures, and the frontend
suites mock the pty client rather than crossing the IPC boundary. So the
frontend still calling the old zero-argument `confirm_quit()`, still listening
for a payload-less `quit-requested`, and still owning its own
`onCloseRequested` guard produces **no** red gate at all: it surfaces only at
runtime, in Step 7. This is exactly why the merged plan sequences this section
after the transfer section and runs the frontend integration tasks alongside.
Do not patch `src/` here to chase it — that work belongs to the frontend section
(see Findings (b) for its exact list).

- [ ] **Step 7: MANUAL verification — the whole §9 surface**

Under `npm run tauri dev`, in this order:

1. Detach a pane. A second window opens, adopts the pane, and its scrollback is
   there.
2. ⌘T in the detached window opens a tab there and **not** in the first.
3. ⌘Q with an agent busy in the non-focused window: one dialog, naming that
   agent. Cancel; ⌘Q again; the dialog returns.
4. Close the detached window: only its panes die.
5. Close the last window: the process exits — check with `ps` that no
   `spacevibe-deck` process is left behind. This is the case the old
   `prevent_exit` would have hung.
6. Change a setting in each window in turn; both changes stick.
7. On Windows only: F5 in the detached window does nothing.

Steps 1–7 depend on the frontend section having landed; until it has, run the
deferred manual checks from Tasks B4 (window creation and labels), B5
(capability errors in the devtools console) and B14 (settings convergence),
which need only the Rust side plus the commands invoked by hand from the
devtools console.

- [ ] **Step 8: Commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/lib.rs
git commit -m "feat(window): wire multi-window lifecycle into the app builder"
```

---

## Task order

B1 → B2 → B3 → B4 → B5 → B7 → B8 → B9 → B13 → B10 → B6 → B16 → B17 → B11 →
B12 → B14 → B15.

B7 (census) precedes B10 (quit request) which precedes B6 (menu routing) so the
`MenuRoute::Quit` arm is written once against a real `request_quit`. B16
(`offer_transfer`, and `live_window_labels` with it) precedes B17, which builds
the submenu that drives it. B17 precedes B12 because B12's `Destroyed` handler
gains the submenu rebuild. B13 (`UpdateFlight`) precedes B12 because B12's
pruning test names it. B4, B10, B11 and B12 each depend on a coordinator method
the transfer section owns, so **the transfer section lands first** — the merged
plan sequences it that way.

**This whole section is downstream of the transfer section.** Five of its tasks
(B4, B10, B11, B12, and B10's census test) call coordinator methods defined
there. Starting section B before those methods exist means five compile failures
that are by design but block progress, not one.

---

## Findings

### (a) Spec claims that are wrong, or incomplete, against the code

1. **§9.1's `harden_webview` instruction is right but under-specified, and the
   naive reading is unsafe.** Calling it "on the main event-loop thread at
   creation" collides with `WebviewWindowBuilder`'s own documented Windows
   deadlock when a **synchronous** command creates a window
   (`tauri-2.11.5/src/webview/webview_window.rs:110-116`). The plan resolves it
   by building from an async command and calling `harden_webview` through
   `run_on_main_thread` with an mpsc handshake, which additionally converts the
   "enqueued but never ran" silent failure into a returned error — something the
   spec's wording does not get you.
2. **§9.4 says quit reads `PtyState::session_snapshots`; that is necessary but
   not sufficient.** A snapshot has no process classification — it carries
   `identity`, `cwd` and `foreground_pid` only (`pty.rs:45-52`). Busy/idle comes
   from `info::classify_process` (`info.rs:42-67`), and on Windows from a WMI
   query that `pty_info` deliberately runs on `spawn_blocking`
   (`info.rs:192-199`). So the census cannot be computed inline on the event
   loop, and this section extracts `info::inspect_snapshots` for it. The spec
   does not mention this cost.
3. **§9.5 describes `CloseRequested` handling as if Rust already receives it. It
   does not, and the frontend currently swallows it.** `src/lib/quit-guard.ts:48-51`
   registers `getCurrentWindow().onCloseRequested` and calls `preventDefault()`;
   Tauri auto-prevents any close for a window that has such a JS listener
   (`tauri-2.11.5/src/manager/window.rs:170-175`). Until the frontend section
   removes that listener, the Rust handler runs but the frontend's own quit flow
   also runs, and the user sees two prompts.
4. **§9.4/§9.5 do not mention that `RunEvent::ExitRequested` currently prevents
   every unconfirmed exit** (`lib.rs:85-93`). That is safe today only because the
   one window can never actually close. Peer windows make "last window closes"
   reachable, and unchanged that code leaves a windowless, unquittable process.
   Task B8's `exit_policy` and Task B15 close it. This is a real bug the spec
   would have shipped.
5. **§5's table says `move_pane_ownership` is "already registered", implying it
   stays.** Nothing in §9 uses it, and §7.2 replaces the map it writes to. Not
   this section's call, but worth stating: after the transfer transaction lands,
   `move_pane_ownership` (`coordinator.rs:74-85`) has no caller.
6. **§9.1's "the generated schema in this repo accepts glob window labels" is
   correct** — verified below, not taken on faith.
7. **§10.1's live-adopt has no delivery mechanism in §9.** §9.2's
   `window_boot_mode` only reaches a window that is _booting_, so a token can
   never reach an already-running `TabManager` — yet §10.1 calls live-adopt
   mandatory for cross-window drag. Task B16's `offer_transfer` +
   `transfer:offer` closes that gap; it is an addition to the spec's §9 surface,
   pinned by the merge lead.
8. **§15 Q1's menu item cannot be expressed through the generated registry.**
   A per-window item needs a dynamic id, and `isActionId`
   (`src/terminal/action-registry.ts:459-471`) rejects anything not in
   `ACTION_IDS` — correctly, since it guards an untrusted IPC payload. Hence
   Task B17 builds the submenu in hand-written `menu.rs` under its own
   `window-target:` prefix, which never touches that validation path.

### (b) Expected conflicts with the other sections

- **`src-tauri/src/lib.rs` `invoke_handler` (`lib.rs:65-82`)** — this section
  adds eleven entries and removes one; the transfer section adds five. Same
  block, must be serialized.
- **`src-tauri/src/pty.rs`** — this section extracts `terminate_pane` out of
  `kill_pty` (`pty.rs:471-500`) for Task B11; the transfer section adds owner
  validation to `write_pty`/`resize_pty`/`kill_pty` per §8. Same three functions.
- **Five coordinator entry points this section calls but does not define**
  (signatures per §0.2 as amended 2026-08-10):
  `WindowCoordinator::reserve_destination(&self, token: &str, label: &str)` (B4),
  `WindowCoordinator::all_panes(&self) -> Vec<u32>` (B10),
  `WindowCoordinator::begin_transfer(&self, sink: &dyn EventSink, from: &str, pane_id: u32, now: Instant) -> Result<String, String>`
  (B10's disagreement test only; §0.2 pins its full signature),
  `coordinator::abort_transfers_involving(app: &AppHandle, label: &str)` (B11),
  and `WindowCoordinator::on_window_destroyed(&self, app: &AppHandle, label: &str)`
  (B12). None is stubbed here; every one fails as a compile error. Two knock-on
  points for the merge: `abort_transfers_involving` is written as a **free
  function** (that is how §0.2 shows it, and it matches the existing
  `coordinator::emit_to_owner` idiom) — if it is really a method, one call site
  changes; and taking a concrete `&AppHandle` forced
  `window_close::on_close_requested` to drop its `<R: Runtime>` parameter, which
  is harmless since its only caller is already `Wry`.
- **One test double this section needs from the transfer section:** a
  `pub(crate)` recording implementor of `EventSink`, referenced here as
  `coordinator::test_support::RecordingSink`. B10's mid-transfer census test has
  to pass something as `&dyn EventSink`, and writing a second double here would
  duplicate the one that section's own tests already require. If it is private
  to their `#[cfg(test)] mod tests`, it needs widening — or that single test is
  dropped, which costs the `all_panes`/`panes_for_window` coverage and nothing
  else.
- **`panes_for_window`'s `#[allow(dead_code)]` (`coordinator.rs:45`)** should be
  removed by whichever section lands first — Task B11 uses it for real.
- **Frontend section:** must delete `getCurrentWindow().onCloseRequested` from
  `src/lib/quit-guard.ts:48-51` (see finding a.3), change its `confirm_quit()`
  call to pass a request id, listen for `window:close-requested`, gate
  `updater.start()` (`src/ui/app.tsx:321`) behind `begin_update_check`, turn
  `updateSettings` (`src/settings/settings-store.ts:66-70`) into an
  `apply_settings_patch` sender that listens for `settings:merged`, handle
  `transfer:offer` for live-adopt, and handle `menu:move-pane-to-window` by
  running prepare → stage → `offer_transfer` for its focused pane. It also owns
  the static `move-pane-to-new-window` action in `action-registry.ts`; the
  dynamic submenu beside it is Task B17 here.
- **Drag section (Phase B):** `focus_order()` (Task B2) is the tie-breaker it
  asked for, and it is read-only — `FocusRegistry` deliberately does not raise or
  focus any window, per §11.2. `open_pane_window`'s `screenX`/`screenY` are CSS
  pixels and Rust multiplies by the monitor's scale factor; **mixed-DPI remains
  unverified** and §11.3's second-display measurement still gates it. If the drag
  work needs live window bounds, that is a separate structure; do not extend
  `FocusRegistry`.

### (c) Forks hit and NOT decided

1. **Spec §15 Q2 — the detached window's size and position.** This plan builds
   from `tauri.conf.json`'s window config with the label swapped, so a detached
   window gets the configured default **size**; its **position** is the drop
   point when the drag section supplies one and the OS default otherwise. That
   is the low-risk reading, not a decision that the source window's size should
   be ignored. Merge lead is surfacing it to the user as a proposed default they
   can veto; if they want "same size as the source", it is a small change to
   Task B4.
2. **Spec §15 Q3 — whether `deck-*` windows appear in the macOS Window menu and
   under what title.** Untouched here. Inheriting the config means every window
   is titled "SpaceVibe Deck", which is very likely wrong once there are three —
   and Task B17's submenu makes it visible, because it lists windows by their
   `deck-N` **label**, not by a title the user would recognise. Also surfaced to
   the user by the merge lead.
3. **A hardening failure destroys the new window and fails the move.** Written
   that way in Task B4 because a `deck-*` window with live browser accelerators
   is the exact bug §9.1 exists to prevent, but the spec does not say it. Cheap
   to reverse.
4. **Adding a Rust dependency is a fork and this section does not need one** —
   tokens cross this boundary as opaque `String`s. If the transfer section wants
   `uuid` for §7.2's `token: Uuid`, that is its fork to raise.
5. **`presets`, `workspaces` and the logo stores stay on last-write-wins**, per
   §9.5's explicit non-goal (§4). Not widened here. Flagging only that the
   machinery in Task B14 would extend to them trivially, which will make it
   tempting.
6. **Mixed-DPI coordinate conversion is unverified and this section does not
   close it.** `physical_from_css` is tested against §6's single-display,
   `scaleFactor = 2` measurement, and the monitor lookup relies on macOS
   `CGDisplayBounds` being in points. §11.3 already requires a second-display
   measurement before the per-pane hit-test ships; Task B4's window placement
   rides the same assumption and should be re-checked in that same measurement.
7. **The menu click reaches `offer_transfer` through the source window, not
   directly.** Task B17 explains why this is forced rather than chosen:
   `prepare_transfer` takes the owning `tauri::Window`, Rust cannot see which
   pane inside a window has focus, and §7.4 requires the source to serialize its
   xterm buffer between `prepare` and `claim`. If the lead intended Rust to mint
   the token itself, that contradicts the frozen contract and needs resolving
   before Task B17 runs.

### (d) What was learned about the capabilities glob and the menu registry

**Capabilities glob — verified, supported.** In
`src-tauri/gen/schemas/desktop-schema.json`, `Capability.windows` is typed
`{"type":"array","items":{"type":"string"}}` — no pattern restriction — and its
own description says _"List of windows that are affected by this capability. Can
be a glob pattern."_ The `Capability` description is more specific still:
_"Windows can be added to a capability by exact name (e.g. `main-window`) or glob
patterns like `*` or `admin-*`."_ So `["main", "deck-*"]` validates and matches
by glob. Two caveats worth carrying: matching is glob, not prefix, so a label
containing a `/` or `*` would behave oddly (the allocator only emits
`deck-<digits>`, so this cannot happen); and a capability that fails to match is
**silent** — the window loads and every `invoke` is rejected at runtime — hence
the manual step in Task B5 and the file-content assertion in its unit test.

**Menu registry — the routing change is R3-safe.** The generated file is
`src-tauri/src/menu_registry.rs` (header: _"AUTO-GENERATED by `npm run
generate:menu` … do not hand-edit"_), produced by `scripts/generate-menu.ts` from
`src/terminal/action-registry.ts`, and checked in CI by `npm run
generate:menu:check` (`.github/workflows/ci.yml`, before `npm test`).
`src-tauri/src/menu.rs` is hand-written: it only reads the generated tables
(`menu.rs:69-72`, `:95-98`, `:126-129`) and owns `install()` and the
`on_menu_event` handler this section rewrites. So **no generated code is touched
by the routing change**, and `generate:menu:check` is still run in Task B6 as
proof. Two further facts: `menu.rs`'s test module is deliberately **not**
macOS-gated (`menu.rs:159-177` explains why — CI runs `cargo test` on ubuntu),
which is why `route_menu_event` and its two id constants are un-gated so they are
tested on CI; and `menu_registry::WINDOW_MENU_ITEMS` is currently empty with a
tripwire test asserting it (`menu.rs:210-215`), so a "Move Pane to Window ▸"
item added to the Window submenu would go red there — a signal for the frontend
section, which owns spec §15 Q1, not this one.

---

## Section C — Detach and adopt (frontend)

_Owns spec §10, §13, the frontend rows of §12 and the TypeScript half of §14. **Numbering is historical; document order is normative** — C13 deliberately precedes C8._

# Pane Detach — Section C: Frontend (TypeScript)

> **Scope of this section.** Spec §10 (state contract for the move), the
> frontend rows of §12, §13 (error handling), the TypeScript half of §14, and
> spec §15 open question 1 (keyboard shortcut + menu label), which this plan
> closes by evidence. The Rust transfer state machine, the Rust window
> lifecycle and cross-window drag (§11, Phase B) belong to other sections and
> are consumed here, never redesigned.
>
> Spec: [`docs/specs/2026-08-10-pane-detach-window-design.md`](../docs/specs/2026-08-10-pane-detach-window-design.md).

**Goal:** Move one pane out of its window into a new window (or an existing
Deck window) without killing its PTY and without losing a byte of output —
the frontend half: drain, flush, serialize, stage, adopt, replay, commit,
release; the boot-adopt path; last-tab-closes-this-window; the menu command
and its binding; and `updateSettings` as a patch sender.

**Architecture:** Two orchestrators, one on each side of the move
(`pane-detach.ts`, `pane-adopt.ts`), both pure of Tauri: they take a
`TransferClient` seam (the pty-client precedent) so the exact ordering and
every failure transition are unit-testable against a fake. `pane-lifecycle`
grows the two primitives they need — a write-chain drain and a write gate —
plus `adoptPane`/`releasePane`, which are `spawnPane`/`discardPane` with the
PTY calls removed. `TerminalManager` owns the layout-tree consequences,
`TabManager` owns the tab and window consequences. No Rust in this section.

**Tech Stack:** Preact 10 + `@preact/signals`, xterm 6 (`@xterm/xterm@6.0.0`)
with a new `@xterm/addon-serialize@0.14.0`, TypeScript 5.6, Vitest 3 (node by
default, jsdom via the per-file pragma), Tauri 2 IPC. **npm, not pnpm.**

---

## Frozen Rust contract — consume, do not redesign

`invoke` names used verbatim (owned by the Rust transfer and window-lifecycle
sections). **Frozen at merge reconciliation 2026-08-10 — do not "fix" any of
it.** Tauri camelCases argument keys, so the invoke keys are exactly as
written:

```
prepare_transfer({ paneId: string })              -> token: string
stage_transfer({ token, payload })                -> void
claim_transfer({ token })                         -> AdoptionPayload
commit_transfer({ token })                        -> void
abort_transfer({ token })                         -> void
offer_transfer({ token, targetLabel })            -> void   // Err "Window <label> is not open"
open_pane_window({ token, screenX?, screenY? })   -> label: string
window_boot_mode()                                -> { kind: "normal" } | { kind: "adopt", token }
apply_settings_patch({ patch })                   -> merged settings object
begin_update_check()                              -> boolean  (true = this window won)
end_update_check()                                -> void
confirm_quit({ requestId: number })               -> void
cancel_quit({ requestId: number })                -> void
confirm_close_window({ requestId: number })       -> void
cancel_close_window({ requestId: number })        -> void
```

Events consumed:

```
transfer:settled        { token, outcome: "committed" | "aborted", reason?: string }
transfer:offer          { token }
menu:move-pane-to-window { targetLabel }
settings:merged         <merged Settings object>
quit-requested          { requestId, busyProcesses, busyPanes, fullyNamed }
window:close-requested  { requestId, busyProcesses, busyPanes, fullyNamed }
```

**`prepare_transfer` takes `paneId` as a String**, parsed to `u32` in Rust.
Every other PTY command keeps a numeric id, so this one is deliberately
different — the client must not normalize it.

**`requestId` is a `u64`, i.e. a `number` on the TS side** — not a string.

**`open_pane_window` returns the new window's label.** This section ignores
the value, but it must **not** be typed `void`: the drag section needs it.

**`open_pane_window`'s coordinates are CSS pixels**; Rust converts to
physical. Frozen because the drag section passes a drop point through it.

**`offer_transfer` returns `Err("Window <label> is not open")`** rather than
dropping silently — `emit_to` returns `Ok` for a label nobody listens on, so
a silent drop would hang the pane until the 10 s bound. Task C5's
`offer-failed` branch is what surfaces it.

**`transfer:settled` is emitted to BOTH the `from` and `to` labels**, and by
the §7.5 bounds too — not only by an explicit commit or abort. Every path
that ends a transfer announces itself, which is what lets `awaitOutcome`
carry no timer of its own.

**The busy census travels WITH the request.** `quit-requested` and
`window:close-requested` both carry `{ requestId, busyProcesses, busyPanes,
fullyNamed }`, computed in Rust. The frontend renders the dialog from that
payload and answers with `confirm_*`/`cancel_*` — it does **not** run
`confirmClose`'s own `freshPaneInfo` census for these two paths (Task C13).

Ordering guarantees this section respects:

- `prepare_transfer` quiesces the output stream, so **serialization happens
  after prepare** (spec §7.4).
- `stage_transfer` is what carries the serialized payload to Rust so
  `claim_transfer` can return it.
- During `Transferring`, Rust rejects `write_pty` / `resize_pty` / `kill_pty`
  **from every caller** (spec §8). The frontend write chain therefore _awaits_
  the transfer instead of dropping input — Task C3.
- `commit_transfer`'s precondition is `caller == to` (spec §7.3), i.e. **the
  destination commits, not the source.** The brief's phrasing "prepare →
  stage → commit, then release" for the source side is inconsistent with the
  spec; the spec wins, because the Rust side enforces the precondition at
  runtime. See Findings (b).

### Two gaps this section raised — both now closed

The first draft of this plan flagged two holes in the contract as originally
handed over. Both were accepted at merge reconciliation and are now real:

1. **`transfer:settled`.** Spec §13 requires a failed `commit` to leave the
   pane **with the source** and show the persist-error bar, which is only
   possible if the source has not yet released it — so the source must learn
   the outcome. Nothing in the original command list carried that signal.
   The transfer section now emits `transfer:settled` to both labels;
   `reason` is what separates "the destination refused" from "the transfer
   timed out" on the error bar.
2. **`offer_transfer` / `transfer:offer`.** `open_pane_window` covers the
   new-window path only; §10.1's live-adopt into an already-running window
   had no transport. Now owned by the window-lifecycle section, consumer
   model unchanged from this plan's draft.

`AdoptionPayload`'s field names are **frozen** (see below) and declared in
**exactly one place** — `src/terminal/transfer-client.ts`.

---

## Approved design contract

- **R1: English only** in every string, comment, test name and doc line in
  this repo.
- **R2:** this section adds no new chrome surface. The non-drag path is a
  macOS menu item plus a keyboard chord; the user-visible text is one line
  written into a terminal buffer, two `reportChromeMessage` strings, and one
  new `ConfirmCopy` constant (`WINDOW_CLOSE_COPY`, Task C13) rendered by the
  **native OS dialog** through `@tauri-apps/plugin-dialog`, exactly like the
  three copies already in `close-guard.ts`. Nothing is drawn by Deck, so no
  `docs/DESIGN-LANGUAGE.md` rule is added or changed. If implementation
  discovers a surface that needs one, **stop and raise the fork**; do not
  decide it.
- **R3:** menu code is generated. Edit `src/terminal/action-registry.ts`, then
  `npm run generate:menu`; `npm run generate:menu:check` must pass. Never
  hand-edit `src-tauri/src/menu_registry.rs`.
- **R5:** state is Preact signals; module stores are window-scoped. Each Deck
  window is its own webview and therefore its own JS realm, so every
  `signal(...)` in `src/` is already per-window. The stores that break under
  multiple windows are the ones backed by **shared disk**, not by shared
  memory — see Findings (e).
- **Ordering is the contract.** The source runs
  `drain → hold → flush → prepare → serialize → stage → open/offer → await
outcome → release`. Drain comes **before** hold on purpose: the hold is
  awaited _inside_ the write chain, so holding first and then awaiting the
  chain tail deadlocks. The window between drain resolving and the hold being
  installed is one microtask in which a keystroke can still reach a PTY whose
  route is still `Owned` — correct, not a leak.
- **Geometry.** The adopted pane is constructed at the payload's `cols`/`rows`
  and only `fit()`s **after** `commit_transfer`. Fitting earlier calls
  `resize_pty` while the route is `Transferring`, Rust rejects it, and
  `paneEvents.onResize` swallows the rejection
  ([`pane-lifecycle.ts:123-125`](../src/terminal/pane-lifecycle.ts)) — the PTY
  would be silently stranded at the wrong dimensions.
- **Replay before mount.** `@xterm/addon-serialize`'s own typings state the
  restore should run before `Terminal.open`. `pane-adopt` writes the
  scrollback into the unopened terminal and awaits `flush()` before placing it.
- **Detach never goes through `closePane`**, which respawns a shell when the
  last pane of a tab goes away
  ([`terminal-manager.ts:305-312`](../src/terminal/terminal-manager.ts)), and
  never through `disposeTab`, which snapshots the tab into the reopen stack
  ([`tab-manager.ts:936-960`](../src/terminal/tab-manager.ts)). Both bypasses
  mean the pruning those paths normally do must be written out explicitly:
  `clearPaneCwd`, `closeSearchBarForPane`, and the
  launcher/activity/tracker/notifier/poller prunes
  ([`tab-manager.ts:975-981`](../src/terminal/tab-manager.ts)).
- **Constants, never literals (C9).** `SERIALIZE_SCROLLBACK_LINES = 10_000`
  and `SERIALIZE_MAX_BYTES = 8 * 1024 * 1024` (spec §7.5) live in
  `pane-detach.ts`; the truncation keeps the **newest** bytes.
- **Module size.** Every new module stays inside the 200–400 line norm.
  `transfer-client.ts` is split out of the two orchestrators precisely so
  neither carries an IPC adapter plus a memory fake on top of its own logic.
- **jsdom pragma.** Verified still true on 2026-08-10: there is no
  `vitest.config.ts` (only `vite.config.ts`), the default environment is
  `node`, and every DOM test in this repo carries
  `// @vitest-environment jsdom` on its **first** line
  (e.g. `src/ui/app.test.tsx:1`).
- **Dirty working tree.** The icon-system hazard list from the original brief
  is stale — that migration has landed. Verified 2026-08-10 at `289a12a`, the
  uncommitted set is **another session's release-notes work**:
  `.github/workflows/release.yml`, `AGENTS.md`, `docs/ARCHITECTURE.md`,
  `docs/CONTEXT.md`, `marketing/landing-prototype/src/directions/a.js`,
  `scripts/release-workflow.test.ts`, plus untracked
  `scripts/generate-release-notes.{mjs,test.ts}`. No source file this section
  touches is dirty; the three docs files ARE, and Task C12 edits exactly
  those — targeted edits only, never a whole-file rewrite, never revert an
  unrelated hunk.
  **That session is still active in this repo, so this list is a snapshot,
  not a guarantee. Run `git status` at execution time and re-check before
  touching any shared file — do not trust the list above.**

## Wave placement (merged plan §0.6)

This section splits across two waves, and the split is not cosmetic — the
wave-1 tasks test entirely against fakes built from §0.2's contract, so they
need no Rust code to exist yet.

| Wave                        | Tasks                         | Why                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (parallel with Section A) | **D7b, then C1–C7, C11, C14** | Pure frontend: orchestrators, lifecycle primitives, layout-tree consequences, settings sync and the updater claim all run against `createMemoryTransferClient` / `createMemorySettingsSync` / an injected `claim`. **D7b (`dockNewPane`) is promoted into this wave** — pure tree code, no drag dependency — and C7 needs it. |
| 3 (after Section B)         | **C13, C8, C9, C10**          | Bind to Section B's real events and commands (`transfer:offer`, `menu:move-pane-to-window`, `window_boot_mode`, `window:close-requested`) and share `menu.rs` with it. **Listed in required order** — C13 before C8.                                                                                                          |
| 4                           | **C12**                       | Full gates, then manual verification — nothing below it is unit-testable.                                                                                                                                                                                                                                                     |

**Document order IS execution order.** C13 is placed before C8 on purpose:
both touch the close path, and until C13 deletes the frontend
`onCloseRequested` listener, Tauri auto-prevents the very close C8's
`closeWindow()` requests. Numbering is historical (C13 and C14 were added at
merge reconciliation); position is normative. Work top to bottom.

**The silent-green warning from §0.6 applies here in full:** `npm test` and
`tsc` stay green through every wave-1 task even if the Rust side never
matches §0.2. Nothing in this section can catch a contract mismatch; only
wave 3 and the manual pass in C12 can.

**Task D7b (`dockNewPane`) is in wave 1, ahead of C7** — decided 2026-08-10.
It carries a `D` number only because the drag section is where the gap was
found, not because it is Phase B work: `dockNewPane` is pure tree code in
`src/lib/split-tree.ts` with no pointer behaviour and no window API, so
nothing the §0.7 Windows gate measures bears on it. Leaving it behind that
gate would have blocked a wave-1 task on hardware nobody has — an artefact of
numbering, not a real dependency.

**If D7b has not landed when C7 starts, implement C7 minus
`adoptIntoActiveTab` and its two edge tests.** Do not reach for `splitLeaf`
to get moving — see C7 Step 5 for why that is a wrong-side bug rather than a
shortcut.

## Gates

- Focused `npx vitest run <paths>` after every task.
- `npm test` and `npm run build` (this is `tsc && vite build`, so it covers
  typecheck) at the end. No `lint` script exists in this repo.
- `npm run generate:menu:check` after Task C10.
- Record the `dist/assets/index-*.js` gzip size before Task C1 and after
  Task C12. `@xterm/addon-serialize` is the one bundle-affecting change; the
  spec pre-approved the dependency but not an unbounded size.
- **Not automatable here (stated as such):** real window creation, mixed-DPI
  coordinates, occlusion. `npm run tauri dev` manual verification is Task C12.

---

### Task C1: Pane transfer primitives and the serialize addon

**Files:**

- Modify: `package.json`, `package-lock.json`
- Modify: `src/terminal/pane.ts:41-79` (interface), `:124-165` (construction),
  `:287-289` (`write`), `:339-392` (dispose + returned object)
- Modify: `src/terminal/pane-lifecycle.ts:17-22` (`CreatePaneFn`)
- Modify: `src/terminal/pane-lifecycle.test.ts:9-43`,
  `src/terminal/terminal-manager.test.ts:22-58`,
  `src/terminal/tab-manager.test.ts:111-166` (the three `Pane` fakes)
- Test: `src/terminal/pane.test.ts` (new)

**Interfaces:**

- Consumes: `Terminal.write(data, callback?)` (xterm 6 typings,
  `node_modules/@xterm/xterm/typings/xterm.d.ts:1253`),
  `SerializeAddon.serialize({ scrollback })`.
- Produces: `Pane.flush(): Promise<void>`,
  `Pane.serializeScrollback(lines: number): string`,
  `CreatePaneFn` gains a 4th optional `geometry?: { cols: number; rows: number }`.

- [ ] **Step 1: Record the bundle baseline**

Run `npm test` and `npm run build`; write the reported
`dist/assets/index-*.js` gzip size into this file's Findings before touching
anything.

- [ ] **Step 2: Write the failing test**

Create `src/terminal/pane.test.ts`. **The `ResizeObserver` stub is not
optional and must come before the `createPane` import runs**: `createPane`
constructs one unconditionally (`pane.ts:251`), jsdom does not implement it,
and this repo has no vitest setup file (`vite.config.ts` carries no `test`
block). Without the stub every case dies with
`ReferenceError: ResizeObserver is not defined` — the red phase would fail
for the wrong reason and Step 9 could never go green. Verified empirically
on 2026-08-10: `typeof globalThis.ResizeObserver === "undefined"` under the
jsdom environment.

```ts
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings-schema";
import { createPane } from "./pane";
import type { PaneEvents } from "./pane";

beforeAll(() => {
  // Never fires: nothing in this file resizes anything, and `fit()` is
  // already try/caught in pane.ts for the zero-sized case. This exists only
  // so the constructor at pane.ts:251 does not throw.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

const silentEvents: PaneEvents = {
  onData: () => Promise.resolve(true),
  onResize: () => {},
  onFocus: () => {},
};

describe("Pane transfer primitives", () => {
  it("flush() resolves after xterm has parsed everything already written", async () => {
    const pane = createPane(1, DEFAULT_SETTINGS as Settings, silentEvents);
    pane.write("hello");
    await pane.flush();
    expect(pane.serializeScrollback(100)).toContain("hello");
    pane.dispose();
  });

  it("flush() resolves on an idle terminal with nothing queued", async () => {
    const pane = createPane(2, DEFAULT_SETTINGS as Settings, silentEvents);
    await expect(pane.flush()).resolves.toBeUndefined();
    pane.dispose();
  });

  it("serializeScrollback keeps the newest lines when the buffer is longer", async () => {
    const pane = createPane(3, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 20,
      rows: 4,
    });
    for (let i = 0; i < 40; i += 1) {
      pane.write(`line-${i}\r\n`);
    }
    await pane.flush();
    const serialized = pane.serializeScrollback(5);
    expect(serialized).toContain("line-39");
    expect(serialized).not.toContain("line-0\r");
    pane.dispose();
  });

  it("constructs at the requested geometry so an adopted pane starts at capture size", () => {
    const pane = createPane(4, DEFAULT_SETTINGS as Settings, silentEvents, {
      cols: 133,
      rows: 41,
    });
    expect(pane.cols).toBe(133);
    expect(pane.rows).toBe(41);
    pane.dispose();
  });
});
```

**Not covered by a test, stated as such:** that `cols`/`rows` stay _live_
rather than frozen at construction. Nothing on the public `Pane` surface
resizes a terminal — `fit()` needs real layout, which jsdom does not provide,
and xterm's DECSLPP window-manipulation sequence is a no-op unless
`windowOptions` is enabled (verified empirically on 2026-08-10:
`\x1b[8;12;60t` left a 100×30 terminal unchanged, while `term.resize(80, 24)`
worked). So Step 6 implements them as getters and this note is the guard
against someone "simplifying" them into captured values.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/terminal/pane.test.ts`
Expected: FAIL — TypeScript/runtime error `pane.flush is not a function`
(and `createPane` rejecting a 4th argument under `tsc`). The geometry test is
the discriminator that a 4th parameter is genuinely wired, not ignored.

- [ ] **Step 4: Install the addon**

```bash
npm install @xterm/addon-serialize@0.14.0 --save-exact
```

Exact, not caret. `0.14.0` was published 2025-12-22T13:50:43Z, in the same
batch as `@xterm/xterm@6.0.0` (13:50:12Z), `@xterm/addon-fit@0.11.0`
(13:50:25Z) and `@xterm/addon-search@0.16.0` (13:50:39Z) — the xterm addons
declare **no** `peerDependencies`, so co-publication is the only compatibility
evidence available, and pinning is what keeps a floating minor from changing
what ships.

- [ ] **Step 5: Extend the `Pane` interface**

In `src/terminal/pane.ts`, add to `interface Pane` (after `write`, line 48):

```ts
  /**
   * Resolves once xterm's parser has consumed everything written so far.
   * Built on xterm's own `write(data, callback)` drain callback — a pane
   * transfer serializes the buffer only after this settles, otherwise the
   * snapshot can miss bytes that were received but not yet parsed
   * (spec §7.4).
   */
  flush(): Promise<void>;
  /**
   * The buffer as a re-writable escape-sequence string, newest `lines` rows
   * of scrollback plus the viewport. Empty string when serialization fails —
   * losing history is never worth losing the session (spec §13).
   */
  serializeScrollback(lines: number): string;
  /**
   * Current terminal geometry in cells — travels with the pane across a move
   * (spec §10.2) and is what the destination constructs its terminal at, so
   * nothing has to resize while the route is `Transferring`.
   */
  readonly cols: number;
  readonly rows: number;
```

- [ ] **Step 6: Implement in `createPane`**

Add the import beside the other addons (after line 4):

```ts
import { SerializeAddon } from "@xterm/addon-serialize";
```

Widen the factory signature (line 89):

```ts
export function createPane(
  id: number,
  initial: Settings,
  events: PaneEvents,
  geometry?: { readonly cols: number; readonly rows: number },
): Pane {
```

In the `new Terminal({...})` options object, add the two lines (a pane built
for an adoption starts at the source's capture geometry so no resize is
needed before the transaction commits):

```ts
    ...(geometry ? { cols: geometry.cols, rows: geometry.rows } : {}),
```

Register the addon beside `fitAddon`/`searchAddon` (after line 165):

```ts
const serializeAddon = new SerializeAddon();
term.loadAddon(serializeAddon);
```

Add the two functions next to `write` (line 287):

```ts
function flush(): Promise<void> {
  // The empty write is deliberate: xterm queues the callback behind
  // everything already in the parser queue, so this resolves on the next
  // drain even when nothing is pending. Verified empirically on 2026-08-10
  // against @xterm/xterm@6.0.0 under jsdom — `write("", cb)` fires on an
  // idle terminal, and after a pending `write("abc", cb)` it fires SECOND.
  return new Promise((resolve) => {
    term.write("", () => resolve());
  });
}

function serializeScrollback(lines: number): string {
  try {
    return serializeAddon.serialize({ scrollback: lines });
  } catch (err) {
    console.warn("Failed to serialize pane scrollback:", err);
    return "";
  }
}
```

Dispose it (inside `dispose`, before `term.dispose()` at line 349):

```ts
serializeAddon.dispose();
```

And expose all four on the returned object (after `write,` at line 358).
`cols`/`rows` are **getters**, never captured values: a pane that resized
after construction must report what the user last saw, not what it was born
with.

```ts
    flush,
    serializeScrollback,
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
```

- [ ] **Step 7: Widen `CreatePaneFn`**

`src/terminal/pane-lifecycle.ts:18-22`:

```ts
export type CreatePaneFn = (
  id: number,
  initial: Settings,
  events: PaneEvents,
  geometry?: { readonly cols: number; readonly rows: number },
) => Pane;
```

- [ ] **Step 8: Update the three `Pane` fakes**

Adding four members to `Pane` turns every fake into a type error. Add to each
of `pane-lifecycle.test.ts:9`, `terminal-manager.test.ts:22` and
`tab-manager.test.ts:111`, beside their existing `write() {}`:

```ts
    cols: 80,
    rows: 24,
    flush() {
      return Promise.resolve();
    },
    serializeScrollback() {
      return "";
    },
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/terminal/pane.test.ts src/terminal/pane-lifecycle.test.ts src/terminal/terminal-manager.test.ts src/terminal/tab-manager.test.ts`
Expected: PASS. jsdom logs `HTMLCanvasElement's getContext()` warnings from
xterm's renderer — verified harmless, the buffer paths under test do not need
a canvas.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/terminal/pane.ts src/terminal/pane.test.ts src/terminal/pane-lifecycle.ts src/terminal/pane-lifecycle.test.ts src/terminal/terminal-manager.test.ts src/terminal/tab-manager.test.ts
git commit -m "feat(terminal): add pane flush and scrollback serialization"
```

---

### Task C2: The transfer IPC seam

**Files:**

- Create: `src/terminal/transfer-client.ts`
- Test: `src/terminal/transfer-client.test.ts`

**Interfaces:**

- Consumes: `invoke` / `listen` from `@tauri-apps/api`.
- Produces: `AdoptionPayload`, `TransferOutcome`, `BootMode`,
  `TransferClient`, `createTauriTransferClient()`,
  `createMemoryTransferClient()`, `bootModeOrNormal(raw: unknown): BootMode`,
  `defaultTransferClient`.

> **This task ships an INCOMPLETE seam, on purpose.** Three more members —
> `listenMoveToWindow`, the memory client's `moveToWindow`, and the pure
> `moveToWindowTarget` validator — are added in **Task C8 Step 5**, where
> their only consumer lives and where they can be tested end to end. Do not
> treat their absence here as an omission, and do not try to guess them into
> this task; C8 gives the exact code. Everything C3–C7 needs IS here.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/transfer-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bootModeOrNormal,
  createMemoryTransferClient,
  type AdoptionPayload,
} from "./transfer-client";

const payload: AdoptionPayload = {
  paneId: 7,
  cwd: "/repo",
  agentId: "claude",
  scrollback: "hello",
  cols: 120,
  rows: 40,
  tabName: "deck",
  dotColor: "cyan",
  workspacePath: "/repo",
};

describe("bootModeOrNormal", () => {
  it("accepts a well-formed adopt payload", () => {
    expect(bootModeOrNormal({ kind: "adopt", token: "t-1" })).toEqual({
      kind: "adopt",
      token: "t-1",
    });
  });

  it("falls back to normal for anything unrecognized", () => {
    expect(bootModeOrNormal({ kind: "adopt" })).toEqual({ kind: "normal" });
    expect(bootModeOrNormal({ kind: "adopt", token: 42 })).toEqual({
      kind: "normal",
    });
    expect(bootModeOrNormal(null)).toEqual({ kind: "normal" });
    expect(bootModeOrNormal("adopt")).toEqual({ kind: "normal" });
  });
});

describe("createMemoryTransferClient", () => {
  it("records every call in order and hands the staged payload to claim", async () => {
    const client = createMemoryTransferClient();
    const token = await client.prepareTransfer(7);
    await client.stageTransfer(token, payload);
    const claimed = await client.claimTransfer(token);
    await client.commitTransfer(token);
    client.settle(token, { kind: "committed" });

    expect(claimed).toEqual(payload);
    expect(client.calls).toEqual([
      "prepare:7",
      `stage:${token}`,
      `claim:${token}`,
      `commit:${token}`,
    ]);
  });

  it("resolves awaitOutcome with whatever settle reports, even after the fact", async () => {
    const client = createMemoryTransferClient();
    const token = await client.prepareTransfer(1);
    client.settle(token, { kind: "aborted", reason: "destination-gone" });
    await expect(client.awaitOutcome(token)).resolves.toEqual({
      kind: "aborted",
      reason: "destination-gone",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/transfer-client.test.ts`
Expected: FAIL — `Failed to resolve import "./transfer-client"`.

- [ ] **Step 3: Implement the module**

Create `src/terminal/transfer-client.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TabDotColor } from "../lib/tab-colors";

/**
 * Everything that moves with a pane (spec §10.2), serialized across the
 * transfer transaction.
 *
 * WIRE NAMES ARE FROZEN (merge reconciliation 2026-08-10) and match the Rust
 * `AdoptionPayload` struct exactly: `agentId` not `agent`, `tabName` not
 * `nameOverride`, `scrollback` not `serialized`. This is the ONLY place they
 * are written down — never re-spell one at a call site.
 *
 * `dotColor` is typed as this repo's `TabDotColor` union rather than a free
 * string: the destination feeds it straight into a `TabOverride`.
 */
export interface AdoptionPayload {
  readonly paneId: number;
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly scrollback: string;
  readonly cols: number;
  readonly rows: number;
  readonly tabName: string | null;
  readonly dotColor: TabDotColor | null;
  readonly workspacePath: string | null;
}

export type TransferOutcome =
  | { readonly kind: "committed" }
  | { readonly kind: "aborted"; readonly reason: string };

export type BootMode =
  | { readonly kind: "normal" }
  | { readonly kind: "adopt"; readonly token: string };

const SETTLED_EVENT = "transfer:settled";
const OFFER_EVENT = "transfer:offer";

interface SettledPayload {
  token: string;
  outcome: "committed" | "aborted";
  reason?: string;
}

export interface TransferClient {
  prepareTransfer(paneId: number): Promise<string>;
  stageTransfer(token: string, payload: AdoptionPayload): Promise<void>;
  claimTransfer(token: string): Promise<AdoptionPayload>;
  commitTransfer(token: string): Promise<void>;
  abortTransfer(token: string): Promise<void>;
  /**
   * Resolves when the route leaves `Transferring`, over the `transfer:settled`
   * event Rust emits to BOTH labels inside the lock section that finalises
   * the route. The source needs this: spec §13 requires a failed commit to
   * leave the pane WITH THE SOURCE, which is only possible while the source
   * still holds it. `reason` is what separates "the destination refused"
   * from "the transfer timed out" on the error bar.
   */
  awaitOutcome(token: string): Promise<TransferOutcome>;
  /**
   * Boot-adopt: create a `deck-<n>` window already bound to this token.
   * `screen` is a CSS-pixel drop point — Rust converts to physical. The menu
   * path omits it and lets Rust place the window; the drag section passes
   * the point the pane was dropped at.
   */
  openPaneWindow(
    token: string,
    screen?: { readonly x: number; readonly y: number },
  ): Promise<string>;
  /** Live-adopt: hand the token to an ALREADY RUNNING window. */
  offerTransfer(token: string, targetLabel: string): Promise<void>;
  listenTransferOffer(handler: (token: string) => void): Promise<UnlistenFn>;
  windowBootMode(): Promise<BootMode>;
}

/**
 * Validate the boot-mode payload rather than cast it: it crosses the IPC
 * boundary as untrusted data (C7/C8), and getting it wrong means a window
 * that renders nothing at all. Anything unrecognized boots normally, which
 * is always a usable app.
 */
export function bootModeOrNormal(raw: unknown): BootMode {
  if (typeof raw !== "object" || raw === null) {
    return { kind: "normal" };
  }
  const value = raw as { kind?: unknown; token?: unknown };
  if (value.kind === "adopt" && typeof value.token === "string") {
    return { kind: "adopt", token: value.token };
  }
  return { kind: "normal" };
}

/** Production adapter — Tauri IPC. */
export function createTauriTransferClient(): TransferClient {
  return {
    prepareTransfer(paneId) {
      // `paneId` crosses as a STRING and is parsed to u32 in Rust. Every
      // other PTY command keeps a numeric id; this one is deliberately
      // different (frozen 2026-08-10) — do not "normalize" it back.
      return invoke<string>("prepare_transfer", { paneId: String(paneId) });
    },
    stageTransfer(token, payload) {
      return invoke("stage_transfer", { token, payload });
    },
    claimTransfer(token) {
      return invoke<AdoptionPayload>("claim_transfer", { token });
    },
    commitTransfer(token) {
      return invoke("commit_transfer", { token });
    },
    abortTransfer(token) {
      return invoke("abort_transfer", { token });
    },
    async awaitOutcome(token) {
      // The listener is per-transfer and MUST be torn down: a window runs
      // many moves in a session, and `listen` resolves asynchronously, so
      // `unlisten` may not exist yet when the event arrives. `settled`
      // covers that race — whichever side wins, the handler is removed once.
      let unlisten: UnlistenFn | null = null;
      let settled = false;
      const stop = (): void => {
        settled = true;
        unlisten?.();
        unlisten = null;
      };
      const outcome = new Promise<TransferOutcome>((resolve) => {
        void listen<SettledPayload>(SETTLED_EVENT, (event) => {
          if (event.payload.token !== token) {
            return;
          }
          stop();
          resolve(
            event.payload.outcome === "committed"
              ? { kind: "committed" }
              : { kind: "aborted", reason: event.payload.reason ?? "aborted" },
          );
        }).then((fn) => {
          if (settled) {
            fn();
            return;
          }
          unlisten = fn;
        });
      });
      return outcome;
    },
    openPaneWindow(token, screen) {
      // CSS pixels — Rust converts to physical. Omitted keys mean "you pick".
      // Returns the created window's label. This section ignores it — the
      // destination announces itself by claiming — but it must NOT be typed
      // `void`: the drag section needs the label (merged §0.2).
      return invoke<string>("open_pane_window", {
        token,
        ...(screen ? { screenX: screen.x, screenY: screen.y } : {}),
      });
    },
    offerTransfer(token, targetLabel) {
      return invoke("offer_transfer", { token, targetLabel });
    },
    listenTransferOffer(handler) {
      return listen<{ token: string }>(OFFER_EVENT, (event) => {
        handler(event.payload.token);
      });
    },
    async windowBootMode() {
      try {
        return bootModeOrNormal(await invoke<unknown>("window_boot_mode"));
      } catch (err) {
        console.warn("window_boot_mode failed; booting normally:", err);
        return { kind: "normal" };
      }
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryTransferClient(
  options: { readonly bootMode?: BootMode } = {},
): TransferClient & {
  readonly calls: string[];
  /** Resolve a pending (or future) `awaitOutcome` for this token. */
  settle(token: string, outcome: TransferOutcome): void;
  /** Deliver a live-adopt offer to the registered handler. */
  offer(token: string): void;
  failNext(command: keyof TransferClient, message: string): void;
} {
  const calls: string[] = [];
  const staged = new Map<string, AdoptionPayload>();
  const settled = new Map<string, TransferOutcome>();
  const waiting = new Map<string, (outcome: TransferOutcome) => void>();
  const failures = new Map<string, string>();
  const offerHandlers = new Set<(token: string) => void>();
  let nextToken = 1;

  function guard(command: string): void {
    const message = failures.get(command);
    if (message !== undefined) {
      failures.delete(command);
      throw new Error(message);
    }
  }

  return {
    calls,
    failNext(command, message) {
      failures.set(command, message);
    },
    settle(token, outcome) {
      settled.set(token, outcome);
      waiting.get(token)?.(outcome);
      waiting.delete(token);
    },
    offer(token) {
      for (const handler of offerHandlers) {
        handler(token);
      }
    },
    async prepareTransfer(paneId) {
      calls.push(`prepare:${paneId}`);
      guard("prepareTransfer");
      const token = `xfer-${nextToken}`;
      nextToken += 1;
      return token;
    },
    async stageTransfer(token, payload) {
      calls.push(`stage:${token}`);
      guard("stageTransfer");
      staged.set(token, payload);
    },
    async claimTransfer(token) {
      calls.push(`claim:${token}`);
      guard("claimTransfer");
      const payload = staged.get(token);
      if (payload === undefined) {
        throw new Error(`unknown token ${token}`);
      }
      return payload;
    },
    async commitTransfer(token) {
      calls.push(`commit:${token}`);
      guard("commitTransfer");
    },
    async abortTransfer(token) {
      calls.push(`abort:${token}`);
    },
    awaitOutcome(token) {
      calls.push(`await:${token}`);
      const already = settled.get(token);
      if (already !== undefined) {
        return Promise.resolve(already);
      }
      return new Promise((resolve) => waiting.set(token, resolve));
    },
    async openPaneWindow(token, screen) {
      // The coordinate suffix is what lets the drag section assert the drop
      // point survived the round trip; the menu path records no suffix.
      calls.push(
        screen === undefined
          ? `open-window:${token}`
          : `open-window:${token}:${screen.x},${screen.y}`,
      );
      guard("openPaneWindow");
      return "deck-1";
    },
    async offerTransfer(token, targetLabel) {
      calls.push(`offer:${token}:${targetLabel}`);
      guard("offerTransfer");
    },
    async listenTransferOffer(handler) {
      offerHandlers.add(handler);
      return () => {
        offerHandlers.delete(handler);
      };
    },
    async windowBootMode() {
      return options.bootMode ?? { kind: "normal" };
    },
  };
}

/** Shared production client — factories accept an override for tests. */
export const defaultTransferClient: TransferClient =
  createTauriTransferClient();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/transfer-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/transfer-client.ts src/terminal/transfer-client.test.ts
git commit -m "feat(terminal): add the pane transfer IPC seam"
```

---

### Task C3: Drain and hold the per-pane write chain

**Files:**

- Modify: `src/terminal/pane-lifecycle.ts:42-49` (interface),
  `:69-113` (the write chain), `:228-241` (returned object)
- Test: `src/terminal/pane-lifecycle.test.ts`

**Interfaces:**

- Consumes: the existing `writeChains` map (`pane-lifecycle.ts:76`).
- Produces: `PaneLifecycle.drainWrites(id: number): Promise<void>`,
  `PaneLifecycle.holdWrites(id: number): () => void`.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/pane-lifecycle.test.ts`:

```ts
describe("createPaneLifecycle write gate", () => {
  function lifecycleWithFakePane() {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane: (id, _settings, events) => fakePane(id, events),
    });
    return { pty, life };
  }

  it("drainWrites resolves only after every queued write has reached the PTY", async () => {
    const { pty, life } = lifecycleWithFakePane();
    const pane = await life.spawnPane();
    void life.enqueueWrite(pane.id, "a");
    void life.enqueueWrite(pane.id, "b");

    await life.drainWrites(pane.id);

    expect(pty.writes.map((w) => w.data)).toEqual(["a", "b"]);
  });

  it("holdWrites parks a write instead of sending it, and the release lets it through in order", async () => {
    const { pty, life } = lifecycleWithFakePane();
    const pane = await life.spawnPane();
    const release = life.holdWrites(pane.id);

    void life.enqueueWrite(pane.id, "held");
    await Promise.resolve();
    await Promise.resolve();
    expect(pty.writes).toEqual([]);

    release();
    await life.drainWrites(pane.id);
    expect(pty.writes.map((w) => w.data)).toEqual(["held"]);
  });

  it("a write parked behind a hold is dropped when the pane is released meanwhile", async () => {
    const { pty, life } = lifecycleWithFakePane();
    const pane = await life.spawnPane();
    const release = life.holdWrites(pane.id);
    const parked = life.enqueueWrite(pane.id, "gone");

    life.panes.delete(pane.id);
    release();

    await expect(parked).resolves.toBe(false);
    expect(pty.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts`
Expected: FAIL — `life.drainWrites is not a function` on the first case and
`life.holdWrites is not a function` on the other two.

- [ ] **Step 3: Add the gate to the write chain**

In `src/terminal/pane-lifecycle.ts`, beside `writeChains` (after line 76):

```ts
/**
 * Per-pane write gate. During a transfer Rust rejects `write_pty` from
 * every caller (spec §8), so input queued in that window must WAIT, not
 * fail — a rejected write would otherwise surface as "the session may have
 * ended" for a pane that is merely mid-handoff. Awaited inside the chain,
 * which is what keeps FIFO order across the pause.
 */
const writeHolds = new Map<number, Promise<void>>();
```

Inside `enqueueWrite`'s chained callback (currently lines 84-99), insert the
await immediately after the existing re-check:

```ts
    const result = tail.then(async () => {
      // Re-checked at drain time, not only at enqueue time: the pane may have
      // exited or closed while this write waited its turn.
      if (exited.has(id) || !panes.has(id)) {
        return false;
      }
      await writeHolds.get(id);
      // Re-checked again after the gate: a transfer can outlive this pane in
      // THIS window — the source releases it the moment the move commits.
      if (exited.has(id) || !panes.has(id)) {
        return false;
      }
      try {
```

- [ ] **Step 4: Implement `drainWrites` and `holdWrites`**

Add next to `enqueueWrite` (after line 113):

```ts
/**
 * Resolves once everything already queued for this pane has settled.
 * Deliberately snapshots the tail rather than looping: a detach drains
 * BEFORE it installs a hold, because a hold is awaited inside the chain and
 * draining a held chain would never resolve.
 */
function drainWrites(id: number): Promise<void> {
  return writeChains.get(id) ?? Promise.resolve();
}

function holdWrites(id: number): () => void {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  writeHolds.set(id, gate);
  return () => {
    if (writeHolds.get(id) === gate) {
      writeHolds.delete(id);
    }
    open();
  };
}
```

Declare both on the interface (after `enqueueWrite`, line 48):

```ts
  /** Await everything already queued for this pane; see the implementation. */
  drainWrites(id: number): Promise<void>;
  /** Park new PTY writes for this pane; the returned function releases them. */
  holdWrites(id: number): () => void;
```

And export them in the returned object (after `enqueueWrite,` line 239):

```ts
    drainWrites,
    holdWrites,
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/pane-lifecycle.ts src/terminal/pane-lifecycle.test.ts
git commit -m "feat(terminal): drain and gate the per-pane write chain"
```

---

### Task C4: Adopt and release a pane without touching the PTY

**Files:**

- Modify: `src/terminal/pane-lifecycle.ts:24-49` (interface), `:135-170`
  (beside `spawnPane`/`discardPane`), `:228-241` (returned object)
- Test: `src/terminal/pane-lifecycle.test.ts`

**Interfaces:**

- Consumes: `AdoptionPayload` (Task C2), `CreatePaneFn` with geometry (C1).
- Produces: `PaneLifecycle.adoptPane(payload: AdoptionPayload): Pane`,
  `PaneLifecycle.releasePane(id: number): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/pane-lifecycle.test.ts`:

```ts
describe("createPaneLifecycle adopt and release", () => {
  const payload = {
    paneId: 42,
    cwd: "/repo",
    agentId: "claude",
    scrollback: "restored",
    cols: 120,
    rows: 40,
    tabName: null,
    dotColor: null,
    workspacePath: "/repo",
  } as const;

  it("adoptPane registers the pane under the payload's pty id without spawning", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const geometries: Array<{ cols: number; rows: number } | undefined> = [];
    const life = createPaneLifecycle({
      pty,
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane: (id, _settings, events, geometry) => {
        geometries.push(geometry);
        return fakePane(id, events);
      },
    });

    const pane = life.adoptPane(payload);

    expect(pane.id).toBe(42);
    expect(life.panes.get(42)).toBe(pane);
    expect(pty.sessions.size).toBe(0);
    expect(geometries).toEqual([{ cols: 120, rows: 40 }]);
    expect(paneCwd(42)).toBe("/repo");
  });

  it("releasePane forgets and disposes the pane but never kills the PTY", async () => {
    const pty = createMemoryPtyClient({ nextId: 5 });
    const killed: number[] = [];
    const disposed: number[] = [];
    const life = createPaneLifecycle({
      pty: { ...pty, killPty: async (id) => void killed.push(id) },
      getSettings: () => DEFAULT_SETTINGS as Settings,
      onWriteWhileExited() {},
      onFocus() {},
      createPane: (id, _settings, events) => {
        const pane = fakePane(id, events);
        return { ...pane, dispose: () => void disposed.push(id) };
      },
    });
    const pane = await life.spawnPane();

    life.releasePane(pane.id);

    expect(killed).toEqual([]);
    expect(disposed).toEqual([pane.id]);
    expect(life.panes.has(pane.id)).toBe(false);
    expect(paneCwd(pane.id)).toBeNull();
  });
});
```

Add `import { paneCwd } from "./pane-cwd";` to the test file's imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts -t "adopt and release"`
Expected: FAIL — `life.adoptPane is not a function`, then
`life.releasePane is not a function`.

- [ ] **Step 3: Implement both**

In `src/terminal/pane-lifecycle.ts`, add the import:

```ts
import type { AdoptionPayload } from "./transfer-client";
```

Add after `discardPane` (line 156):

```ts
/**
 * Build a pane around a PTY that ALREADY EXISTS, handed over from another
 * window. `spawnPane` without the spawn: no `spawn_shell`, and the pane is
 * constructed at the source's capture geometry so nothing has to resize
 * before the transfer commits (Rust rejects `resize_pty` while the route is
 * `Transferring` — spec §8).
 */
function adoptPane(payload: AdoptionPayload): Pane {
  const pane = makePane(payload.paneId, deps.getSettings(), paneEvents, {
    cols: payload.cols,
    rows: payload.rows,
  });
  panes.set(payload.paneId, pane);
  // Same reason as spawnPane: the link provider resolves relative paths
  // against this before the first pty_info poll lands, 2s later.
  setPaneCwd(payload.paneId, payload.cwd);
  return pane;
}

/**
 * Forget a pane WITHOUT killing its PTY — the process now belongs to
 * another window (spec §10.3). `discardPane`'s twin minus `killPty`; the
 * difference is the whole point, so do not "simplify" the two together.
 */
function releasePane(id: number): void {
  const pane = panes.get(id);
  if (!pane) {
    return;
  }
  panes.delete(id);
  exited.delete(id);
  clearPaneCwd(id);
  pane.dispose();
}
```

Declare on the interface (after `discardPane`, line 29):

```ts
  adoptPane(payload: AdoptionPayload): Pane;
  /** Forget a pane without killing its PTY — the move's source side. */
  releasePane(id: number): void;
```

Export in the returned object (after `discardPane,` line 232):

```ts
    adoptPane,
    releasePane,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/pane-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane-lifecycle.ts src/terminal/pane-lifecycle.test.ts
git commit -m "feat(terminal): adopt and release panes without killing the pty"
```

---

### Task C5: The source-side orchestrator

**Files:**

- Create: `src/terminal/pane-detach.ts`
- Test: `src/terminal/pane-detach.test.ts`

**Interfaces:**

- Consumes: `TransferClient`, `Pane`, `PaneLifecycle.drainWrites`/`holdWrites`.
- Produces: `detachPane(id, target, deps): Promise<DetachResult>`,
  `DetachTarget`, `DetachResult`, `DetachDeps`, `PaneIdentity`,
  `SERIALIZE_SCROLLBACK_LINES`, `SERIALIZE_MAX_BYTES`.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/pane-detach.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMemoryTransferClient } from "./transfer-client";
import { detachPane, type DetachDeps, type PaneIdentity } from "./pane-detach";
import type { Pane } from "./pane";

const identity: PaneIdentity = {
  cwd: "/repo",
  agentId: "claude",
  tabName: "deck",
  dotColor: "cyan",
  workspacePath: "/repo",
};

function harness(
  overrides: Partial<{
    serializeScrollback: Pane["serializeScrollback"];
    flush: Pane["flush"];
  }> = {},
) {
  const order: string[] = [];
  const transfer = createMemoryTransferClient();
  const pane = {
    id: 7,
    cols: 120,
    rows: 40,
    flush:
      overrides.flush ??
      (() => {
        order.push("flush");
        return Promise.resolve();
      }),
    serializeScrollback:
      overrides.serializeScrollback ??
      (() => {
        order.push("serialize");
        return "SCROLLBACK";
      }),
  };
  const released: number[] = [];
  const messages: string[] = [];
  let held = 0;
  const deps: DetachDeps = {
    transfer,
    drainWrites: async () => {
      order.push("drain");
    },
    holdWrites: () => {
      order.push("hold");
      held += 1;
      return () => {
        order.push("release-hold");
        held -= 1;
      };
    },
    pane: () => pane as unknown as Pane & { cols: number; rows: number },
    geometry: () => ({ cols: pane.cols, rows: pane.rows }),
    identity: () => identity,
    release: (id) => {
      order.push("release");
      released.push(id);
    },
    report: (message) => void messages.push(message),
  };
  return { order, transfer, deps, released, messages, heldNow: () => held };
}

describe("detachPane happy path", () => {
  it("runs drain, hold, flush, prepare, serialize, stage, open, await, release in that order", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
    expect(h.order).toEqual([
      "drain",
      "hold",
      "flush",
      "serialize",
      "release",
      "release-hold",
    ]);
    expect(h.transfer.calls).toEqual([
      "prepare:7",
      "stage:xfer-1",
      "open-window:xfer-1",
      "await:xfer-1",
    ]);
    expect(h.heldNow()).toBe(0);
  });

  it("stages the identity, the geometry and the serialized scrollback", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    const staged = await createStagedProbe(h.transfer);
    expect(staged).toMatchObject({
      paneId: 7,
      cwd: "/repo",
      agentId: "claude",
      scrollback: "SCROLLBACK",
      cols: 120,
      rows: 40,
      tabName: "deck",
      dotColor: "cyan",
      workspacePath: "/repo",
    });
  });

  it("offers the token to a named window instead of opening one", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "window", label: "deck-2" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(h.transfer.calls).toContain("offer:xfer-1:deck-2");
    expect(h.transfer.calls).not.toContain("open-window:xfer-1");
  });
});

/** Reads back what `stage_transfer` received, through claim. */
async function createStagedProbe(
  transfer: ReturnType<typeof createMemoryTransferClient>,
) {
  return transfer.claimTransfer("xfer-1");
}

describe("detachPane failure injection", () => {
  it("leaves the pane in place when the pane is already gone", async () => {
    const h = harness();
    h.deps.pane = () => undefined;
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "unknown-pane",
    });
    expect(h.transfer.calls).toEqual([]);
  });

  it("releases the hold and keeps the pane when prepare fails", async () => {
    const h = harness();
    h.transfer.failNext("prepareTransfer", "already transferring");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "prepare-failed",
    });
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
    expect(h.messages).toHaveLength(1);
  });

  it("aborts, keeps the pane and reports when stage fails", async () => {
    const h = harness();
    h.transfer.failNext("stageTransfer", "payload too large");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "stage-failed",
    });
    expect(h.transfer.calls).toContain("abort:xfer-1");
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
  });

  it("aborts and keeps the pane when the window cannot be opened", async () => {
    const h = harness();
    h.transfer.failNext("openPaneWindow", "window creation failed");
    await expect(
      detachPane(7, { kind: "new-window" }, h.deps),
    ).resolves.toEqual({
      kind: "kept",
      reason: "open-window-failed",
    });
    expect(h.transfer.calls).toContain("abort:xfer-1");
    expect(h.released).toEqual([]);
  });

  it("keeps the pane and reports when the transaction aborts after staging", async () => {
    const h = harness();
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });

    await expect(promise).resolves.toEqual({
      kind: "kept",
      reason: "claim-failed",
    });
    expect(h.released).toEqual([]);
    expect(h.heldNow()).toBe(0);
    expect(h.messages[0]).toContain("stayed here");
  });

  it("moves with empty scrollback rather than failing when serialization throws", async () => {
    const h = harness({
      serializeScrollback: () => {
        throw new Error("buffer unreadable");
      },
    });
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
    const staged = await h.transfer.claimTransfer("xfer-1");
    expect(staged.scrollback).toBe("");
  });

  it("proceeds when flush rejects — a stalled parser must not strand the pane", async () => {
    const h = harness({
      flush: () => Promise.reject(new Error("parser dead")),
    });
    const promise = detachPane(7, { kind: "new-window" }, h.deps);
    await vi.waitFor(() => expect(h.transfer.calls).toContain("await:xfer-1"));
    h.transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/pane-detach.test.ts`
Expected: FAIL — `Failed to resolve import "./pane-detach"`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/terminal/pane-detach.ts`:

```ts
import type { Pane } from "./pane";
import type { TabDotColor } from "../lib/tab-colors";
import type { AdoptionPayload, TransferClient } from "./transfer-client";

/** Serialized scrollback bound (spec §7.5) — never fail a move over history. */
export const SERIALIZE_SCROLLBACK_LINES = 10_000;
export const SERIALIZE_MAX_BYTES = 8 * 1024 * 1024;

/** The tab-level identity a pane carries with it (spec §10.2). */
export interface PaneIdentity {
  readonly cwd: string | null;
  readonly agentId: string | null;
  readonly tabName: string | null;
  readonly dotColor: TabDotColor | null;
  readonly workspacePath: string | null;
}

export type DetachTarget =
  | { readonly kind: "new-window" }
  | { readonly kind: "window"; readonly label: string };

export type DetachResult =
  | { readonly kind: "moved" }
  | { readonly kind: "kept"; readonly reason: string };

export interface DetachDeps {
  readonly transfer: TransferClient;
  /** Await everything already queued for this pane's PTY. */
  drainWrites(id: number): Promise<void>;
  /** Park further PTY writes; the returned function releases them. */
  holdWrites(id: number): () => void;
  pane(id: number): Pane | undefined;
  geometry(id: number): { readonly cols: number; readonly rows: number };
  identity(id: number): PaneIdentity;
  /** Remove the pane locally — WITHOUT `kill_pty` (spec §10.3). */
  release(id: number): void;
  report(message: string): void;
}

/** Newest bytes win: the top is what gets dropped (spec §7.5). */
function withinByteBound(serialized: string): string {
  if (serialized.length <= SERIALIZE_MAX_BYTES) {
    return serialized;
  }
  return serialized.slice(serialized.length - SERIALIZE_MAX_BYTES);
}

/**
 * Move one pane out of this window (spec §7, §10.3).
 *
 * Ordering is the contract, and it is asymmetric on purpose:
 * `drain → hold → flush → prepare → serialize → stage → open/offer → await`.
 * Drain runs BEFORE the hold because the hold is awaited inside the write
 * chain — holding first and then draining that chain would deadlock.
 * Serialization runs AFTER `prepare_transfer`, which quiesces the output
 * stream, so the snapshot is taken over a buffer that has stopped moving
 * (spec §7.4).
 *
 * Never throws: every failure resolves as `kept`, and the pane is still
 * usable in this window afterwards.
 */
export async function detachPane(
  id: number,
  target: DetachTarget,
  deps: DetachDeps,
): Promise<DetachResult> {
  const pane = deps.pane(id);
  if (pane === undefined) {
    return { kind: "kept", reason: "unknown-pane" };
  }

  await deps.drainWrites(id);
  const releaseHold = deps.holdWrites(id);

  try {
    await pane.flush();
  } catch (err) {
    // A stalled parser is not a reason to strand the pane where it is: the
    // worst case is a scrollback snapshot missing the last few bytes, which
    // the destination shows anyway once the PTY writes again.
    console.warn("Pane flush failed before transfer; continuing:", err);
  }

  let token: string;
  try {
    token = await deps.transfer.prepareTransfer(id);
  } catch (err) {
    releaseHold();
    console.warn("prepare_transfer failed:", err);
    deps.report("Couldn't move the pane — it stayed here.");
    return { kind: "kept", reason: "prepare-failed" };
  }

  let scrollback = "";
  try {
    scrollback = withinByteBound(
      pane.serializeScrollback(SERIALIZE_SCROLLBACK_LINES),
    );
  } catch (err) {
    // Spec §13: losing history is not worth losing the session.
    console.warn("Scrollback serialization failed; moving without it:", err);
  }

  const identity = deps.identity(id);
  const geometry = deps.geometry(id);
  const payload: AdoptionPayload = {
    paneId: id,
    cwd: identity.cwd,
    agentId: identity.agentId,
    scrollback,
    cols: geometry.cols,
    rows: geometry.rows,
    tabName: identity.tabName,
    dotColor: identity.dotColor,
    workspacePath: identity.workspacePath,
  };

  const failed = async (
    reason: string,
    err: unknown,
  ): Promise<DetachResult> => {
    console.warn(`Pane transfer ${reason}:`, err);
    await deps.transfer.abortTransfer(token).catch(() => {
      // Rust aborts on its own bounds (spec §7.5) — a failed abort is noise.
    });
    releaseHold();
    deps.report("Couldn't move the pane — it stayed here.");
    return { kind: "kept", reason };
  };

  try {
    await deps.transfer.stageTransfer(token, payload);
  } catch (err) {
    return failed("stage-failed", err);
  }

  try {
    if (target.kind === "new-window") {
      await deps.transfer.openPaneWindow(token);
    } else {
      await deps.transfer.offerTransfer(token, target.label);
    }
  } catch (err) {
    return failed(
      target.kind === "new-window" ? "open-window-failed" : "offer-failed",
      err,
    );
  }

  // The DESTINATION commits (spec §7.3: `caller == to`), so the source waits
  // for the outcome instead of committing. It has to wait rather than release
  // optimistically: spec §13 requires a failed commit to leave the pane here.
  const outcome = await deps.transfer.awaitOutcome(token);
  if (outcome.kind === "aborted") {
    releaseHold();
    deps.report("The pane couldn't be moved — it stayed here.");
    return { kind: "kept", reason: outcome.reason };
  }

  deps.release(id);
  releaseHold();
  return { kind: "moved" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/pane-detach.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane-detach.ts src/terminal/pane-detach.test.ts
git commit -m "feat(terminal): orchestrate the source side of a pane move"
```

---

### Task C6: The destination-side orchestrator

**Files:**

- Create: `src/terminal/pane-adopt.ts`
- Test: `src/terminal/pane-adopt.test.ts`

**Interfaces:**

- Consumes: `TransferClient`, `PaneLifecycle.adoptPane`/`releasePane`/`holdWrites`.
- Produces: `adoptTransfer(token, deps): Promise<AdoptResult>`, `AdoptDeps`,
  `AdoptResult`.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/pane-adopt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createMemoryTransferClient,
  type AdoptionPayload,
} from "./transfer-client";
import { adoptTransfer, type AdoptDeps } from "./pane-adopt";
import type { Pane } from "./pane";

const payload: AdoptionPayload = {
  paneId: 7,
  cwd: "/repo",
  agentId: "claude",
  scrollback: "SCROLLBACK",
  cols: 120,
  rows: 40,
  tabName: "deck",
  dotColor: "cyan",
  workspacePath: "/repo",
};

function harness() {
  const order: string[] = [];
  const written: string[] = [];
  const transfer = createMemoryTransferClient();
  const messages: string[] = [];
  const pane = {
    id: 7,
    write: (data: string) => {
      order.push("replay");
      written.push(data);
    },
    writeln: (line: string) => void written.push(line),
    flush: () => {
      order.push("flush");
      return Promise.resolve();
    },
    fit: () => order.push("fit"),
  } as unknown as Pane;
  const discarded: number[] = [];
  const deps: AdoptDeps = {
    transfer,
    holdWrites: () => {
      order.push("hold");
      return () => order.push("release-hold");
    },
    adopt: (received) => {
      order.push(`adopt:${received.cols}x${received.rows}`);
      return pane;
    },
    place: () => order.push("place"),
    discard: (id) => {
      order.push("discard");
      discarded.push(id);
    },
    report: (message) => void messages.push(message),
  };
  return { order, written, transfer, deps, discarded, messages };
}

async function stage(transfer: ReturnType<typeof createMemoryTransferClient>) {
  const token = await transfer.prepareTransfer(7);
  await transfer.stageTransfer(token, payload);
  transfer.calls.length = 0;
  return token;
}

describe("adoptTransfer happy path", () => {
  it("claims, builds at capture geometry, replays before placing, then commits and fits", async () => {
    const h = harness();
    const token = await stage(h.transfer);

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: "adopted",
      paneId: 7,
      payload,
    });

    expect(h.order).toEqual([
      "hold",
      "adopt:120x40",
      "replay",
      "flush",
      "place",
      "release-hold",
      "fit",
    ]);
    expect(h.written).toEqual(["SCROLLBACK"]);
    expect(h.transfer.calls).toEqual([`claim:${token}`, `commit:${token}`]);
  });

  it("skips the replay write entirely when the payload carries no scrollback", async () => {
    const h = harness();
    const token = await h.transfer.prepareTransfer(7);
    await h.transfer.stageTransfer(token, { ...payload, scrollback: "" });

    await adoptTransfer(token, h.deps);

    expect(h.order).not.toContain("replay");
    expect(h.written[0]).toContain("Scrollback could not be restored");
  });
});

describe("adoptTransfer failure injection", () => {
  it("fails without building anything when claim is rejected", async () => {
    const h = harness();
    h.transfer.failNext("claimTransfer", "unknown token");

    await expect(adoptTransfer("token-x", h.deps)).resolves.toEqual({
      kind: "failed",
      reason: "claim-failed",
    });
    expect(h.order).toEqual([]);
    expect(h.discarded).toEqual([]);
  });

  it("aborts and discards the half-built pane when commit is rejected", async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.transfer.failNext("commitTransfer", "token expired");

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: "failed",
      reason: "commit-failed",
    });
    expect(h.discarded).toEqual([7]);
    expect(h.transfer.calls).toContain(`abort:${token}`);
    expect(h.messages[0]).toContain("did not arrive");
    expect(h.order).toContain("release-hold");
  });

  it("aborts when the pane cannot be built at all", async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.deps.adopt = () => {
      throw new Error("out of memory");
    };

    await expect(adoptTransfer(token, h.deps)).resolves.toEqual({
      kind: "failed",
      reason: "adopt-failed",
    });
    expect(h.transfer.calls).toContain(`abort:${token}`);
  });

  it("still commits when the replay write throws — history is not worth the session", async () => {
    const h = harness();
    const token = await stage(h.transfer);
    h.deps.adopt = () =>
      ({
        id: 7,
        write: () => {
          throw new Error("parser rejected the frame");
        },
        writeln: () => {},
        flush: () => Promise.resolve(),
        fit: () => {},
      }) as unknown as Pane;

    await expect(adoptTransfer(token, h.deps)).resolves.toMatchObject({
      kind: "adopted",
      paneId: 7,
    });
    expect(h.transfer.calls).toContain(`commit:${token}`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/pane-adopt.test.ts`
Expected: FAIL — `Failed to resolve import "./pane-adopt"`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/terminal/pane-adopt.ts`:

```ts
import type { Pane } from "./pane";
import type { AdoptionPayload, TransferClient } from "./transfer-client";

/** Written into the pane when history did not survive (spec §13). */
const NO_SCROLLBACK_NOTICE =
  "\x1b[2m[Scrollback could not be restored for this move]\x1b[0m";

export type AdoptResult =
  | {
      readonly kind: "adopted";
      readonly paneId: number;
      readonly payload: AdoptionPayload;
    }
  | { readonly kind: "failed"; readonly reason: string };

export interface AdoptDeps {
  readonly transfer: TransferClient;
  /** Park PTY writes until the transaction commits (spec §8). */
  holdWrites(id: number): () => void;
  /** Build a pane bound to the payload's existing PTY — never a spawn. */
  adopt(payload: AdoptionPayload): Pane;
  /** Put the pane into this window's layout and mount it. */
  place(pane: Pane, payload: AdoptionPayload): void;
  /** Drop a half-built pane when the transaction fails after `adopt`. */
  discard(id: number): void;
  report(message: string): void;
}

/**
 * Take ownership of a pane another window prepared (spec §10.1). Shared by
 * both adoption paths: boot-adopt (a fresh window building its first tab) and
 * live-adopt (a running window inserting the pane into its active tab). The
 * two differ only in what `place` does.
 *
 * Ordering matters twice over. The pane is built at the payload's capture
 * geometry and only `fit()`s AFTER the commit, because `resize_pty` is
 * rejected while the route is `Transferring` and `paneEvents.onResize`
 * swallows that rejection — an early fit strands the PTY at stale
 * dimensions. And the scrollback is replayed BEFORE the pane is placed,
 * which is what the serialize addon's own documentation asks for.
 *
 * Never throws: every failure resolves as `failed` and leaves nothing
 * half-built behind.
 */
export async function adoptTransfer(
  token: string,
  deps: AdoptDeps,
): Promise<AdoptResult> {
  let payload: AdoptionPayload;
  try {
    payload = await deps.transfer.claimTransfer(token);
  } catch (err) {
    // Deliberately no `abort_transfer` here: the claim failed, so either the
    // token was never valid or another window already holds it — aborting a
    // token this window does not own could cancel someone else's move. Rust's
    // 10 s bound (spec §7.5) returns the pane to the source on its own. Spec
    // §13's "closes that window and aborts" is satisfied by the caller: the
    // boot path closes the window (Task C9) and Rust's timeout does the abort.
    console.warn("claim_transfer failed:", err);
    return { kind: "failed", reason: "claim-failed" };
  }

  const abort = async (reason: string, err: unknown): Promise<AdoptResult> => {
    console.warn(`Pane adoption ${reason}:`, err);
    await deps.transfer.abortTransfer(token).catch(() => {
      // Rust aborts on its own bounds anyway — a failed abort is noise.
    });
    return { kind: "failed", reason };
  };

  let releaseHold: (() => void) | null = null;
  let pane: Pane;
  try {
    releaseHold = deps.holdWrites(payload.paneId);
    pane = deps.adopt(payload);
  } catch (err) {
    releaseHold?.();
    return abort("adopt-failed", err);
  }

  try {
    if (payload.scrollback === "") {
      pane.writeln(NO_SCROLLBACK_NOTICE);
    } else {
      pane.write(payload.scrollback);
    }
    await pane.flush();
  } catch (err) {
    // Spec §13 again, mirrored: an unreplayable buffer costs history, never
    // the session.
    console.warn("Scrollback replay failed; continuing:", err);
  }

  deps.place(pane, payload);

  try {
    await deps.transfer.commitTransfer(token);
  } catch (err) {
    releaseHold();
    deps.discard(payload.paneId);
    deps.report("The pane did not arrive — it stayed in its original window.");
    return abort("commit-failed", err);
  }

  releaseHold();
  // Only now is `resize_pty` accepted again: the route is `Owned` by this
  // window, so the pane can leave the source's capture geometry behind.
  pane.fit();
  return { kind: "adopted", paneId: payload.paneId, payload };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/pane-adopt.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane-adopt.ts src/terminal/pane-adopt.test.ts
git commit -m "feat(terminal): orchestrate the destination side of a pane move"
```

---

### Task C7: Layout-tree consequences in TerminalManager

**Files:**

- Modify: `src/terminal/terminal-manager.ts:37-56` (deps),
  `:59-155` (interface), `:157-208` (construction), `:293-336`
  (beside `closePane`), `:529-708` (returned object)
- Test: `src/terminal/terminal-manager.test.ts`

**Interfaces:**

- Consumes: `detachPane`, `adoptTransfer`, `PaneLifecycle.adoptPane`/
  `releasePane`/`drainWrites`/`holdWrites`, `removeLeaf`, `leaf`, and
  **`dockNewPane(node, targetId, newId, edge)` from Task D7b**, which is
  scheduled in **wave 1 ahead of this task** (decided 2026-08-10 — it is pure
  tree code in `split-tree.ts`, so it carries a `D` number without being
  Phase B work). If it has not landed yet, implement this task minus
  `adoptIntoActiveTab` and its two edge tests. **`splitLeaf` is not a
  substitute** — see Step 5 for why it is a wrong-side bug, not a shortcut.
- Produces: `TerminalManager.detachPaneById(id, target): Promise<DetachOutcome>`,
  `TerminalManager.adoptIntoActiveTab({ token, targetPaneId?, edge? }): Promise<AdoptResult>`,
  `TerminalManager.initFromAdoption(token): Promise<AdoptResult>`,
  `TerminalManagerDeps.transfer?: TransferClient`,
  `TerminalManagerDeps.identity?: (id: number) => PaneIdentity`.
  `DetachOutcome = { kind: "moved"; tabEmpty: boolean } | { kind: "kept"; reason: string }`.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/terminal-manager.test.ts`:

```ts
describe("TerminalManager pane detach", () => {
  it("removes the pane from the tree, disposes it and never kills the PTY", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const killed: number[] = [];
    const transfer = createMemoryTransferClient();
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      { ...pty, killPty: async (id) => void killed.push(id) },
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );
    await manager.initFresh();
    await manager.splitActive("row");
    const [first, second] = manager.paneIds();

    const promise = manager.detachPaneById(first, { kind: "new-window" });
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved", tabEmpty: false });
    expect(manager.paneIds()).toEqual([second]);
    expect(killed).toEqual([]);
  });

  it("reports the tab as empty instead of respawning a shell for the last pane", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      pty,
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );
    await manager.initFresh();
    const [only] = manager.paneIds();

    const promise = manager.detachPaneById(only, { kind: "new-window" });
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });

    await expect(promise).resolves.toEqual({ kind: "moved", tabEmpty: true });
    expect(manager.paneIds()).toEqual([]);
    // closePane would have spawned a replacement here (terminal-manager.ts:305-312).
    expect(pty.sessions.size).toBe(1);
  });

  it("leaves the tree untouched when the transfer aborts", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      pty,
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );
    await manager.initFresh();
    const before = manager.paneIds();

    const promise = manager.detachPaneById(before[0], { kind: "new-window" });
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });

    await expect(promise).resolves.toEqual({
      kind: "kept",
      reason: "claim-failed",
    });
    expect(manager.paneIds()).toEqual(before);
  });

  it("initFromAdoption builds a single-pane tree around the adopted pty", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const token = await transfer.prepareTransfer(77);
    await transfer.stageTransfer(token, {
      paneId: 77,
      cwd: "/repo",
      agentId: null,
      scrollback: "",
      cols: 100,
      rows: 30,
      tabName: null,
      dotColor: null,
      workspacePath: "/repo",
    });
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      pty,
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );

    await expect(manager.initFromAdoption(token)).resolves.toMatchObject({
      kind: "adopted",
      paneId: 77,
    });
    expect(manager.paneIds()).toEqual([77]);
    expect(pty.sessions.size).toBe(0);
  });

  // WHOLE TREE SHAPE, not membership. `leafIds(next).includes(99)` would pass
  // under the wrong-side bug — the pane DID arrive, just docked on the wrong
  // side of the wrong axis. The discriminator is that a left dock must not
  // equal what `splitLeaf` produces, because `splitLeaf` always puts the new
  // pane in slot `b` (split-tree.ts:38).
  it("docks a left-adopted pane into slot a on the row axis, unlike splitLeaf", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      pty,
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );
    await manager.initFresh();
    const [anchor] = manager.paneIds();
    const token = await transfer.prepareTransfer(99);
    await transfer.stageTransfer(token, {
      paneId: 99,
      cwd: null,
      agentId: null,
      scrollback: "",
      cols: 100,
      rows: 30,
      tabName: null,
      dotColor: null,
      workspacePath: null,
    });

    await manager.adoptIntoActiveTab({
      token,
      targetPaneId: anchor,
      edge: "left",
    });

    const shape = manager.serializeLayout();
    // `serializeLayout` drops pane ids, so it pins the STRUCTURE: a row split
    // with two leaves. The id-level side assertion follows it.
    expect(shape).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: { type: "leaf" },
      second: { type: "leaf" },
    });
    // Left edge => adopted pane FIRST. paneIds() walks the tree left to right
    // (leafIds), so order is the side.
    expect(manager.paneIds()).toEqual([99, anchor]);
  });

  it("docks a right-adopted pane second, so the two edges are not the same tree", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTerminalManager(
      document.createElement("div"),
      { onLayoutChange() {} },
      pty,
      { createPane: (id, _s, events) => fakePane(id, events), transfer },
    );
    await manager.initFresh();
    const [anchor] = manager.paneIds();
    const token = await transfer.prepareTransfer(99);
    await transfer.stageTransfer(token, {
      paneId: 99,
      cwd: null,
      agentId: null,
      scrollback: "",
      cols: 100,
      rows: 30,
      tabName: null,
      dotColor: null,
      workspacePath: null,
    });

    await manager.adoptIntoActiveTab({
      token,
      targetPaneId: anchor,
      edge: "top",
    });

    // "top" is the column axis AND source-first — a different tree from the
    // "left" case above in both respects.
    expect(manager.serializeLayout()).toMatchObject({
      type: "split",
      direction: "column",
    });
    expect(manager.paneIds()).toEqual([99, anchor]);
  });
});
```

The two edge tests are the reason this task lists `dockNewPane` as a blocking
dependency: they fail against `splitLeaf` on both counts — wrong axis
(`splitLeaf` would be handed `"column"` for `"left"` under the inverted
mapping an earlier draft carried) and wrong side (adopted pane in slot `b`,
so `paneIds()` returns `[anchor, 99]`).

Add `import { createMemoryTransferClient } from "./transfer-client";` to the
file's imports. **Do not add `vi`** — `terminal-manager.test.ts:2` already
imports it (`beforeEach, describe, expect, it, vi`), and a second binding is
a compile error.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/terminal-manager.test.ts -t "pane detach"`
Expected: FAIL — `manager.detachPaneById is not a function`, then
`manager.initFromAdoption is not a function`, then
`manager.adoptIntoActiveTab is not a function` for the two edge cases.

The two edge tests are the ones worth watching, because they are the only
thing standing between this task and a wrong-side dock. Once
`adoptIntoActiveTab` exists but is wired to `splitLeaf`, they fail with a
**value** mismatch rather than a missing function — `direction: "column"`
where `"row"` was expected, and `paneIds()` returning `[anchor, 99]` instead
of `[99, anchor]`. If they ever pass while `dockNewPane` is absent, the
implementation is wrong, not the test.

- [ ] **Step 3: Widen the deps and add the seams**

In `src/terminal/terminal-manager.ts`, extend `TerminalManagerDeps`
(lines 52-56):

```ts
export interface TerminalManagerDeps {
  /** Test seam — defaults to real createPane (xterm). */
  createPane?: CreatePaneFn;
  /** Test seam — defaults to the real Tauri transfer client. */
  transfer?: TransferClient;
  /**
   * Tab-level identity for a pane (name override, dot color, workspace).
   * TabManager owns those, so it supplies this; the default carries only
   * what a manager knows on its own.
   */
  identity?: (id: number) => Partial<PaneIdentity>;
}
```

and declare `DetachOutcome` beside it, at module scope — it is the return
type of a public `TerminalManager` method, so it cannot live only in prose:

```ts
/**
 * What a detach did to THIS window. `tabEmpty` is what tells TabManager the
 * tab has no panes left, so it can remove it WITHOUT the reopen snapshot
 * `disposeTab` takes — nothing was closed, the session is alive elsewhere.
 */
export type DetachOutcome =
  | { readonly kind: "moved"; readonly tabEmpty: boolean }
  | { readonly kind: "kept"; readonly reason: string };
```

Add the imports:

```ts
import {
  detachPane,
  type DetachTarget,
  type PaneIdentity,
} from "./pane-detach";
import { adoptTransfer, type AdoptResult } from "./pane-adopt";
import {
  defaultTransferClient,
  type AdoptionPayload,
  type TransferClient,
} from "./transfer-client";
import { paneCwd } from "./pane-cwd";
```

`paneCwd` is a new import here; `removeLeaf`, `leafIds`, `leaf`, `splitLeaf`,
`Edge` and `closeSearchBarForPane` are already imported by this module
(`terminal-manager.ts:3-35`) — do not add a second import for any of them, a
duplicate binding is a compile error.

- [ ] **Step 4: Implement the source aftermath**

Add after `closePane` (line 323):

```ts
const transfer = deps.transfer ?? defaultTransferClient;

/**
 * Remove a pane from this window because it MOVED, not because it closed.
 * Deliberately not `closePane`: that one kills the PTY and respawns a
 * shell when the tab's last pane goes away (spec §10.3). The pruning
 * `closePane`/`disposeTab` normally do has to be spelled out here for the
 * same reason.
 */
function releaseMovedPane(id: number): void {
  closeSearchBarForPane(id);
  life.releasePane(id);
  if (!tree) {
    return;
  }
  const rest = removeLeaf(tree, id);
  if (rest === null) {
    tree = null;
    activeId = null;
    return;
  }
  tree = rest;
  if (activeId === id) {
    activeId = leafIds(tree)[0] ?? null;
  }
  render();
  if (activeId !== null) {
    life.panes.get(activeId)?.focus();
  }
}

async function detachPaneById(
  id: number,
  target: DetachTarget,
): Promise<DetachOutcome> {
  const result = await detachPane(id, target, {
    transfer,
    drainWrites: (paneId) => life.drainWrites(paneId),
    holdWrites: (paneId) => life.holdWrites(paneId),
    pane: (paneId) => life.panes.get(paneId),
    geometry: paneGeometry,
    identity: (paneId) => ({
      cwd: paneCwd(paneId),
      agentId: null,
      tabName: null,
      dotColor: null,
      workspacePath: null,
      ...deps.identity?.(paneId),
    }),
    release: releaseMovedPane,
    report: reportPersistError,
  });
  if (result.kind === "kept") {
    return result;
  }
  const tabEmpty = tree === null;
  callbacks.onLayoutChange();
  return { kind: "moved", tabEmpty };
}
```

The `geometry` dep above reads the LIVE xterm, not the layout tree — the tree
stores ratios, the destination needs cells. Define it next to
`detachPaneById`:

```ts
/**
 * Capture-time geometry for a moving pane (spec §10.2). Falls back to the
 * spawn placeholder for a pane that vanished mid-call; the destination
 * re-fits after commit anyway, so this is a starting point, not a
 * constraint.
 */
function paneGeometry(id: number): { cols: number; rows: number } {
  const pane = life.panes.get(id);
  return {
    cols: pane?.cols ?? TRANSFER_FALLBACK_COLS,
    rows: pane?.rows ?? TRANSFER_FALLBACK_ROWS,
  };
}
```

with `const TRANSFER_FALLBACK_COLS = 80;` /
`const TRANSFER_FALLBACK_ROWS = 24;` at module scope, matching the spawn
placeholder at `pane-lifecycle.ts:14-15`.

This depends on the two readonly members `Pane` gains in **Task C1 Step 5** —
add them there, in the same edit as `flush`/`serializeScrollback`:

```ts
  /** Current terminal geometry — travels with the pane across a move. */
  readonly cols: number;
  readonly rows: number;
```

implemented in `createPane` (Task C1 Step 6) as live reads on the returned
object, never captured values:

```ts
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
```

and the three `Pane` fakes updated in Task C1 Step 8 gain `cols: 80,
rows: 24` alongside `flush`/`serializeScrollback`. Task C1's fourth test
("constructs at the requested geometry") already asserts `pane.cols` /
`pane.rows` directly — nothing to change there.

- [ ] **Step 5: Implement the destination side**

Add after `detachPaneById`:

````ts
function adoptDeps(place: (pane: Pane, payload: AdoptionPayload) => void) {
  return {
    transfer,
    holdWrites: (paneId: number) => life.holdWrites(paneId),
    adopt: (payload: AdoptionPayload) => life.adoptPane(payload),
    place,
    discard: (paneId: number) => life.releasePane(paneId),
    report: reportPersistError,
  };
}

/** Boot-adopt (spec §10.1): this manager's FIRST tab is the moved pane. */
function initFromAdoption(token: string): Promise<AdoptResult> {
  return adoptTransfer(
    token,
    adoptDeps((pane) => {
      tree = leaf(pane.id);
      activeId = pane.id;
      render();
      pane.focus();
    }),
  );
}

**`AdoptIntoActiveTabRequest` goes at MODULE scope**, beside
`TerminalManagerDeps` (`terminal-manager.ts:52-56`) — not with the function
below it. Everything else in this step lands inside `createTerminalManager`
(`terminal-manager.ts:157-709`), and an `export interface` inside a function
body is a syntax error:

```ts
/**
 * Live-adopt (spec §10.1): insert into the running tab's layout tree at a
 * NAMED position. The single-object signature is frozen at merge
 * reconciliation 2026-08-10 — the drag section calls it with the pane the
 * cursor was over and the edge it was dropped on, which is why the target is
 * explicit rather than "wherever the active pane happens to be".
 */
export interface AdoptIntoActiveTabRequest {
  readonly token: string;
  /** Pane to split; falls back to the active pane, then to an empty tree. */
  readonly targetPaneId?: number;
  readonly edge?: Edge;
}
```

And inside the factory, beside `initFromAdoption`:

```ts
function adoptIntoActiveTab(
  request: AdoptIntoActiveTabRequest,
): Promise<AdoptResult> {
  const edge = request.edge ?? "right";
  return adoptTransfer(
    request.token,
    adoptDeps((pane) => {
      const anchor = request.targetPaneId ?? activeId;
      tree =
        tree === null || anchor === null
          ? leaf(pane.id)
          : dockNewPane(tree, anchor, pane.id, edge);
      activeId = pane.id;
      render();
      pane.focus();
      callbacks.onLayoutChange();
    }),
  );
}
```

**`dockNewPane`, NOT `splitLeaf` — and this is a trap, not a preference.**
Verified against `src/lib/split-tree.ts` on 2026-08-10:

- `splitLeaf` (`:31-46`) hard-codes the new pane into slot **`b`**
  (`b: leaf(newId)` at `:38`) and takes a `Direction`, not an `Edge`. It is
  the ⌘D split action, where "new pane goes second" is exactly right. It is
  not broken; it is the wrong tool, and it is the one that looks like it
  fits. Docking `edge: "left"` through it puts the pane on the **right**.
- `movePane` (`:56-77`) gets edges right — `sourceFirst = edge === "left" ||
  edge === "top"` (`:75`) feeding the private `dockIntoLeaf` (`:80-104`) —
  but it **cannot be used here at all**: it calls `leafIds(node)` and returns
  the tree **by reference** when the source is not already in it (`:65-68`).
  An adopted pane never is, so it would be a silent no-op that looks like a
  successful adopt.

An earlier draft of this task did use `splitLeaf`, with
`edge === "left" || edge === "right" ? "column" : "row"` — **two** bugs, not
one: the new pane on the wrong side, and the axis inverted against
`movePane`'s own mapping, which is `? "row" : "column"` (`:74`). Both vanish
by taking an `Edge` end to end and letting one function own the meaning.

**Dependency: `dockNewPane(node, targetId, newId, edge)` comes from Task
D7b**, which sits in `split-tree.ts` directly below `movePane` and reuses the
same private `dockIntoLeaf`, so the adopted and in-window paths cannot drift
on what an edge means. D7b is scheduled in **wave 1, ahead of this task**
(decided 2026-08-10) — it carries a `D` number because the drag section found
the gap, not because it is Phase B work. Import it from `../lib/split-tree`
alongside the existing `leaf`/`removeLeaf`/`splitLeaf` imports; `splitLeaf`
stays imported for `splitActive`'s ⌘D path, which is genuinely its job.

**If D7b has not landed yet, implement this task minus `adoptIntoActiveTab`
and its two edge tests — do not substitute `splitLeaf` to get moving.**

**Nothing in this section ever calls `adoptIntoActiveTab`.** The menu path
uses `adoptIntoNewTab` — decision 8 at merge reconciliation: a drag gesture
names a position, a menu command does not, so the menu creates a new tab and
preserves the tab name and dot color. `adoptIntoActiveTab` is built here only
because §10.1 makes both adoption paths share `pane-adopt.ts`; its sole
caller is the drag section.

That matters for a specific reason, so it is stated rather than left implied:
**this function is never exercised by Section C's own tests beyond the shape
test in Step 1**, so nobody should later "simplify" it onto `splitLeaf` on
the assumption it is dead code. It is not dead — it is the drag path's
entire placement mechanism, and `splitLeaf` would silently dock every pane on
the wrong side.

Declare all three on the `TerminalManager` interface (after `closePaneById`,
line 82) and export them in the returned object (after `closePaneById`,
line 550).

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/terminal/terminal-manager.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/terminal/terminal-manager.ts src/terminal/terminal-manager.test.ts src/terminal/pane.ts src/terminal/pane.test.ts src/terminal/pane-lifecycle.test.ts src/terminal/tab-manager.test.ts
git commit -m "feat(terminal): move panes in and out of a tab's layout tree"
```

---

### Task C13: Hand window close back to Rust

> **Deliberately placed before Task C8, despite the higher number.** They are
> two halves of the same double-prompt: C8's `closeWindow()` cannot actually
> close a window while the listener this task deletes is still installed.
> Numbering is historical (this task was added at merge reconciliation);
> position in the document is what to follow.

**Files:**

- Modify: `src/lib/quit-guard.ts` (rewritten), `src/terminal/close-guard.ts`
  (one new copy constant), `src/terminal/pty-client.ts` (four commands)
- Modify: `src/ui/app.tsx:334-355` (the quit-guard effect)
- Test: `src/lib/quit-guard.test.ts`

**Interfaces:**

- Consumes: events `quit-requested` / `window:close-requested`, both
  `{ requestId: number, busyProcesses: string[], busyPanes: number,
fullyNamed: boolean }`; commands `confirm_quit`, `cancel_quit`,
  `confirm_close_window`, `cancel_close_window`, each `{ requestId }`.
- Produces: `installQuitGuard` loses its `onCloseRequested` registration;
  `QuitFlowDeps` is rebuilt around the Rust census; new pure
  `closeRequestOrNull(raw: unknown): CloseRequest | null` in `quit-guard.ts`.

**Why this is load-bearing, not cleanup.** Tauri auto-prevents close for any
window that carries a JS close listener. `src/lib/quit-guard.ts:48-51`
registers exactly that and calls `event.preventDefault()`. Leave it in and
BOTH the Rust `CloseRequested` handler and the frontend quit flow run for
every close — the user sees two dialogs, and `closeWindow()` (Task C8) is
silently vetoed by the frontend's own listener.

**The census moves to Rust, and that is the bigger half of this task.**
Both events now carry `{ busyProcesses, busyPanes, fullyNamed }` computed in
Rust (merged §0.2), so the frontend no longer calls `confirmClose`, which
runs its own `freshPaneInfo` sweep (`close-guard.ts:96-110`). Rust owns the
census because it can see every window's panes and a mid-move pane; a
per-window `allPaneIds()` cannot. `close-guard.ts`'s **copy and message
builders stay** — `confirmMessage(names, action, busyPanes)` and its
unknown-inspection fallback map one-to-one onto the payload's three fields,
so this task reuses them rather than writing second copies.

`confirmClose` itself is NOT deleted: the pane/tab close paths
(`CloseCoordinator`) still use it, and so does the updater's
`confirmInstall`. Only the quit and window-close paths stop calling it.

**Note while editing this file:** `quit-guard.ts:43` carries a Vietnamese
doc comment, which violates R1. Rewriting that one comment is in scope
because this task rewrites the function it documents; a sweep of the rest of
the file is not (W3).

- [ ] **Step 1: Write the failing test**

Replace the `createQuitFlow` block in `src/lib/quit-guard.test.ts` and add
the boundary tests. The census now arrives as data, so the flow is testable
without mocking `freshPaneInfo` at all:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeRequestOrNull,
  createQuitFlow,
  installQuitGuard,
  type CloseRequest,
  type QuitFlowDeps,
} from "./quit-guard";

const busyRequest: CloseRequest = {
  requestId: 7,
  busyProcesses: ["claude"],
  busyPanes: 2,
  fullyNamed: true,
};

const idleRequest: CloseRequest = {
  requestId: 8,
  busyProcesses: [],
  busyPanes: 0,
  fullyNamed: true,
};

function makeDeps(overrides: Partial<QuitFlowDeps> = {}): QuitFlowDeps & {
  ask: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  return {
    ask: vi.fn().mockResolvedValue(true),
    flush: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

describe("closeRequestOrNull", () => {
  it("accepts a well-formed census payload", () => {
    expect(closeRequestOrNull(busyRequest)).toEqual(busyRequest);
  });

  it("rejects every malformed shape rather than guessing a request id", () => {
    expect(closeRequestOrNull({})).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, requestId: "7" })).toBeNull();
    expect(
      closeRequestOrNull({ ...busyRequest, busyProcesses: "claude" }),
    ).toBeNull();
    expect(closeRequestOrNull({ ...busyRequest, busyPanes: null })).toBeNull();
    expect(closeRequestOrNull(null)).toBeNull();
    expect(closeRequestOrNull(42)).toBeNull();
  });
});

describe("createQuitFlow", () => {
  it("never prompts when Rust reports nothing busy, and confirms straight away", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)(idleRequest);
    expect(deps.ask).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledWith(8);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("prompts with the Rust census and confirms on accept", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)(busyRequest);
    // Two panes, one name — the message must say "2 panes", not "claude".
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("2 panes are still running"),
    );
    expect(deps.confirm).toHaveBeenCalledWith(7);
  });

  it("cancels the request when the user declines — never leaves it dangling", async () => {
    const deps = makeDeps({ ask: vi.fn().mockResolvedValue(false) });
    await createQuitFlow(deps)(busyRequest);
    expect(deps.cancel).toHaveBeenCalledWith(7);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.flush).not.toHaveBeenCalled();
  });

  it("cancels the request when the dialog itself fails", async () => {
    const deps = makeDeps({
      ask: vi.fn().mockRejectedValue(new Error("no dialog")),
    });
    await createQuitFlow(deps)(busyRequest);
    expect(deps.cancel).toHaveBeenCalledWith(7);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("uses the unknown-inspection copy when Rust could not name everything", async () => {
    const deps = makeDeps();
    await createQuitFlow(deps)({ ...busyRequest, fullyNamed: false });
    expect(deps.ask).toHaveBeenCalledWith(
      expect.stringContaining("could not verify"),
    );
  });

  it("still confirms when the flush fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = makeDeps({
        flush: vi.fn().mockRejectedValue(new Error("disk full")),
      });
      await createQuitFlow(deps)(idleRequest);
      expect(deps.confirm).toHaveBeenCalledWith(8);
    } finally {
      warn.mockRestore();
    }
  });

  it("cancels a second request instead of dropping it while a prompt is open", async () => {
    let release!: (ok: boolean) => void;
    const deps = makeDeps({
      ask: vi.fn(() => new Promise<boolean>((r) => (release = r))),
    });
    const flow = createQuitFlow(deps);
    const first = flow(busyRequest);
    await flow({ ...busyRequest, requestId: 9 });

    // The old flow silently dropped the re-entrant call. Rust is now waiting
    // on an answer for every request it sends, so a drop hangs that close.
    expect(deps.cancel).toHaveBeenCalledWith(9);
    release(true);
    await first;
    expect(deps.confirm).toHaveBeenCalledWith(7);
  });
});
```

And the listener registration, with the mocks the file already needs:

```ts
const listenMock = vi.hoisted(() => vi.fn(async () => () => {}));
const onCloseRequestedMock = vi.hoisted(() => vi.fn(async () => () => {}));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: onCloseRequestedMock }),
}));

describe("installQuitGuard", () => {
  beforeEach(() => {
    listenMock.mockClear();
    onCloseRequestedMock.mockClear();
  });

  it("never registers a JS close listener — Tauri would auto-prevent the close", async () => {
    await installQuitGuard({ quit: makeDeps(), close: makeDeps() });
    expect(onCloseRequestedMock).not.toHaveBeenCalled();
  });

  it("listens for exactly the two Rust-driven events", async () => {
    await installQuitGuard({ quit: makeDeps(), close: makeDeps() });
    expect(listenMock.mock.calls.map((call) => call[0]).sort()).toEqual([
      "quit-requested",
      "window:close-requested",
    ]);
  });

  it("drops a malformed payload without answering Rust with a guessed id", async () => {
    const quit = makeDeps();
    await installQuitGuard({ quit, close: makeDeps() });
    const handler = listenMock.mock.calls.find(
      (call) => call[0] === "quit-requested",
    )?.[1] as (event: { payload: unknown }) => void;

    handler({ payload: { requestId: "not-a-number" } });
    await Promise.resolve();

    expect(quit.confirm).not.toHaveBeenCalled();
    expect(quit.cancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/quit-guard.test.ts`
Expected: FAIL — `closeRequestOrNull is not exported`, `installQuitGuard`
called with the wrong argument shape, and the `onCloseRequested` assertion
failing because `quit-guard.ts:48` still registers one.

- [ ] **Step 3: Rebuild the flow around the Rust census**

Replace `src/lib/quit-guard.ts` wholesale — this file is small, entirely
owned by this task, and every export changes shape:

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  confirmMessage,
  QUIT_COPY,
  WINDOW_CLOSE_COPY,
  type ConfirmCopy,
} from "../terminal/close-guard";

/**
 * A close or quit request from Rust, census included.
 *
 * Rust owns the census (merged §0.2): it can see every window's panes and a
 * pane that is mid-transfer, which a per-window `allPaneIds()` cannot. The
 * result travels with the request so the dialog never has to ask twice.
 */
export interface CloseRequest {
  readonly requestId: number;
  /** Distinct process names, already deduplicated by Rust. */
  readonly busyProcesses: readonly string[];
  /** Count of busy PANES, which may exceed the number of names. */
  readonly busyPanes: number;
  /** False when inspection could not name every busy process. */
  readonly fullyNamed: boolean;
}

/** Seams the quit/close flow composes over — injected so `lib/` stays import-light. */
export interface QuitFlowDeps {
  /** Show the dialog; resolves true when the user accepts. */
  ask(message: string): Promise<boolean>;
  /** Persist pending debounced state — the process or window goes right after. */
  flush(): Promise<void>;
  confirm(requestId: number): Promise<void>;
  cancel(requestId: number): Promise<void>;
}

function unknownMessage(action: string): string {
  return `Deck could not verify whether terminal processes are still running. ${action} anyway?`;
}

/**
 * Validate the request rather than cast it: it crosses the IPC boundary as
 * untrusted data (C7/C8), and a guessed `requestId` would answer a request
 * Rust never asked while leaving the real one hanging forever.
 */
export function closeRequestOrNull(raw: unknown): CloseRequest | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const names = value.busyProcesses;
  if (
    typeof value.requestId !== "number" ||
    typeof value.busyPanes !== "number" ||
    typeof value.fullyNamed !== "boolean" ||
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string")
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    busyProcesses: names as string[],
    busyPanes: value.busyPanes,
    fullyNamed: value.fullyNamed,
  };
}

/**
 * One quit/close attempt: prompt only when Rust reported something busy,
 * then answer the request either way.
 *
 * EVERY path answers. The old flow dropped a re-entrant call silently, which
 * was safe when nothing was waiting for a reply; Rust now blocks the close
 * on an answer, so a dropped request is a window that never closes and never
 * says why.
 */
export function createQuitFlow(
  deps: QuitFlowDeps,
  copy: ConfirmCopy = QUIT_COPY,
): (request: CloseRequest) => Promise<void> {
  let prompting = false;
  return async (request) => {
    if (request.busyPanes === 0) {
      await finish(true);
      return;
    }
    if (prompting) {
      await deps.cancel(request.requestId);
      return;
    }
    prompting = true;
    let accepted = false;
    try {
      const message =
        (request.fullyNamed
          ? confirmMessage(
              request.busyProcesses,
              copy.action,
              request.busyPanes,
            )
          : unknownMessage(copy.action)) +
        (copy.detail === undefined ? "" : `\n\n${copy.detail}`);
      accepted = await deps.ask(message);
    } catch (err: unknown) {
      console.error("Close prompt failed:", err);
      accepted = false;
    } finally {
      prompting = false;
    }
    await finish(accepted);

    async function finish(ok: boolean): Promise<void> {
      if (!ok) {
        await deps.cancel(request.requestId);
        return;
      }
      try {
        await deps.flush();
      } catch (err: unknown) {
        console.warn("Flush before quit failed:", err);
      }
      await deps.confirm(request.requestId);
    }
  };
}

/**
 * Install the quit and window-close guards. Returns a function that removes
 * both listeners.
 *
 * There is deliberately NO `getCurrentWindow().onCloseRequested` here. Tauri
 * auto-prevents close for any window carrying a JS close listener, so
 * registering one made the frontend the veto authority over every window
 * close — which, with peer windows (spec §9.5), means the Rust
 * `CloseRequested` handler and this flow both run and the user confirms
 * twice. Rust now owns the decision and asks this window to prompt.
 */
export async function installQuitGuard(deps: {
  readonly quit: QuitFlowDeps;
  readonly close: QuitFlowDeps;
}): Promise<UnlistenFn> {
  const promptQuit = createQuitFlow(deps.quit, QUIT_COPY);
  const promptClose = createQuitFlow(deps.close, WINDOW_CLOSE_COPY);
  const route =
    (flow: (request: CloseRequest) => Promise<void>) =>
    (event: { payload: unknown }): void => {
      const request = closeRequestOrNull(event.payload);
      if (request === null) {
        // No id means no safe answer: replying with a guessed one would
        // resolve a request Rust never asked.
        console.warn("Ignoring malformed close/quit request payload");
        return;
      }
      void flow(request);
    };
  const unlistenQuit = await listen("quit-requested", route(promptQuit));
  const unlistenClose = await listen(
    "window:close-requested",
    route(promptClose),
  );
  return () => {
    unlistenQuit();
    unlistenClose();
  };
}
```

**Do not import `ask` from `@tauri-apps/plugin-dialog` here.** The dialog
arrives through the `QuitFlowDeps.ask` seam that `app.tsx` supplies (Step 5),
so a direct import would be unused — and `tsconfig.json:20` sets
`noUnusedLocals: true`, which fails `npm run build`. Keeping the dialog
injected is also what makes every case in Step 1 testable without mocking a
Tauri plugin.

- [ ] **Step 4: Add the window-close copy**

`close-guard.ts` has `CLOSE_COPY` (pane/tab), `QUIT_COPY` and `UPDATE_COPY`
(`close-guard.ts:40-62`) but nothing for closing one window of several. Add
beside them:

```ts
export const WINDOW_CLOSE_COPY: ConfirmCopy = {
  title: "Close Window",
  okLabel: "Close Window",
  // Not "Quit": with peer windows this kills only THIS window's panes, and
  // the app keeps running unless it was the last one.
  action: "Close this window",
};
```

- [ ] **Step 5: Rewire the one caller**

`src/ui/app.tsx:334-355` currently builds `confirmQuit`/`flush`/`quit` inside
an effect that keeps the unlisten handle and cleans it up. **Keep that
structure** — the `.then`/`.catch`/return-cleanup at `app.tsx:348-354` is not
incidental: without it the listeners survive an unmount and a second `App`
would answer the same request twice. Replace only the dependency object:

```ts
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    // One builder per flow: the dialog title and OK label differ, so a
    // single shared `ask` closure would title a window-close dialog
    // "Quit Deck".
    const answering = (copy: ConfirmCopy) => ({
      ask: (message: string) =>
        ask(message, {
          title: copy.title,
          kind: "warning" as const,
          okLabel: copy.okLabel,
          cancelLabel: "Cancel",
        }),
      flush: flushSettingsSave,
    });
    installQuitGuard({
      quit: {
        ...answering(QUIT_COPY),
        confirm: (requestId) => defaultPtyClient.confirmQuit(requestId),
        cancel: (requestId) => defaultPtyClient.cancelQuit(requestId),
      },
      close: {
        ...answering(WINDOW_CLOSE_COPY),
        confirm: (requestId) =>
          defaultPtyClient.confirmCloseWindow(requestId),
        cancel: (requestId) => defaultPtyClient.cancelCloseWindow(requestId),
      },
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err: unknown) => {
        console.error("Failed to install quit guard:", err);
      });
    return () => unlisten?.();
  }, []);
```

New imports for `app.tsx`: `ask` from `@tauri-apps/plugin-dialog` (the file
already imports `message` from it — extend that import, do not add a second),
and `WINDOW_CLOSE_COPY` + `type ConfirmCopy` from
`../terminal/close-guard` (which already supplies `confirmClose`, `QUIT_COPY`
and `UPDATE_COPY` at `app.tsx:8` — extend it).

and `PtyClient` (`src/terminal/pty-client.ts`) gains the four commands,
replacing today's no-argument `confirmQuit()`:

```ts
  /** Answer a `quit-requested` — `requestId` echoes the one Rust sent. */
  confirmQuit(requestId: number): Promise<void>;
  cancelQuit(requestId: number): Promise<void>;
  /** Answer a `window:close-requested` for THIS window only. */
  confirmCloseWindow(requestId: number): Promise<void>;
  cancelCloseWindow(requestId: number): Promise<void>;
```

Tauri adapter: `invoke("confirm_quit", { requestId })` and so on for the
other three. Memory adapter: four `async () => {}` stubs. Every existing
`confirmQuit()` call site must pass an id — `tab-manager.ts`'s old last-tab
quit is already gone in Task C8, so `app.tsx` is the only one left, and
`npm run build` finds any that were missed.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/lib/quit-guard.test.ts src/terminal/close-guard.test.ts src/terminal/pty-client.test.ts src/terminal/tab-manager.test.ts src/ui/app.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quit-guard.ts src/lib/quit-guard.test.ts src/terminal/close-guard.ts src/terminal/pty-client.ts src/ui/app.tsx
git commit -m "feat(ui): let Rust own the close census and quit arbitration"
```

---

### Task C8: Tab and window consequences in TabManager

**Files:**

- Modify: `src/terminal/tab-manager.ts:104-156` (`COMMAND_ACTIONS`),
  `:240-268` (`TabManagerDeps`), `:272-357` (interface),
  `:604-640` (`addTab`), `:936-995` (`disposeTab`), `:1041-1180` (`commands`)
- Test: `src/terminal/tab-manager.test.ts`

**Interfaces:**

- Consumes: `TerminalManager.detachPaneById`/`initFromAdoption`/
  `adoptIntoActiveTab`, `TransferClient.listenTransferOffer`.
- Produces: `TabManager.movePaneToNewWindow(): Promise<void>`,
  `TabManager.adoptIntoNewTab(token): Promise<boolean>`,
  `TabManagerDeps.closeWindow?: () => Promise<void>`,
  `TabManagerDeps.transfer?: TransferClient`.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/tab-manager.test.ts`:

```ts
describe("TabManager window lifecycle", () => {
  it("closes this window instead of quitting the app when its last tab goes", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const quit = vi.spyOn(pty, "confirmQuit");
    const closeWindow = vi.fn(async () => {});
    const manager = createTabManager(host, pty, {
      createPane: (id, _s, events) => fakePane(id, events),
      closeWindow,
    });
    await manager.init();
    await manager.openFromPreset({ type: "leaf" }, [null]);

    await manager.closeTab(0);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("removes the emptied tab after a pane moves out, without pushing it onto the reopen stack", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTabManager(host, pty, {
      createPane: (id, _s, events) => fakePane(id, events),
      transfer,
      closeWindow: async () => {},
    });
    await manager.init();
    await manager.openFromPreset({ type: "leaf" }, [null]);

    const promise = manager.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(tabViews.value).toHaveLength(0);
    await manager.reopenTab();
    expect(tabViews.value).toHaveLength(0);
  });

  it("stages the tab identity the pane carried, not nulls", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTabManager(host, pty, {
      createPane: (id, _s, events) => fakePane(id, events),
      transfer,
      closeWindow: async () => {},
    });
    await manager.init();
    await manager.openFromPreset({ type: "leaf" }, ["/work"], {
      workspacePath: "/work",
      agent: null,
    });
    manager.renameTab(0, "billing");
    manager.setTabDotColor(0, "cyan");

    const promise = manager.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    // Spec §10.2: name override, dot color and workspace move WITH the pane.
    // Without the `identity` wiring in Step 3 these are all null and every
    // other test in this file still passes — which is why this one exists.
    await expect(transfer.claimTransfer("xfer-1")).resolves.toMatchObject({
      tabName: "billing",
      dotColor: "cyan",
      workspacePath: "/work",
    });
  });

  it("keeps the tab when the move aborts", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const manager = createTabManager(host, pty, {
      createPane: (id, _s, events) => fakePane(id, events),
      transfer,
      closeWindow: async () => {},
    });
    await manager.init();
    await manager.openFromPreset({ type: "leaf" }, [null]);

    const promise = manager.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });
    await promise;

    expect(tabViews.value).toHaveLength(1);
  });

  it("adopts an offered pane into a new tab of a running window", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const transfer = createMemoryTransferClient();
    const token = await transfer.prepareTransfer(99);
    await transfer.stageTransfer(token, {
      paneId: 99,
      cwd: "/repo",
      agentId: null,
      scrollback: "",
      cols: 100,
      rows: 30,
      tabName: "moved",
      dotColor: null,
      workspacePath: "/repo",
    });
    const manager = createTabManager(host, pty, {
      createPane: (id, _s, events) => fakePane(id, events),
      transfer,
      closeWindow: async () => {},
    });
    await manager.init();

    await expect(manager.adoptIntoNewTab(token)).resolves.toBe(true);
    expect(tabViews.value).toHaveLength(1);
    expect(manager.allPaneIds()).toContain(99);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/tab-manager.test.ts -t "window lifecycle"`
Expected: FAIL — the first case fails on `expect(closeWindow).toHaveBeenCalled`
receiving 0 calls while `confirmQuit` was called instead
(`tab-manager.ts:980-989` still quits); the rest fail on
`manager.movePaneToNewWindow is not a function`.

- [ ] **Step 3: Replace last-tab-quits with last-tab-closes-this-window**

At `src/terminal/tab-manager.ts:980-989`, replace the quit block:

```ts
if (tabs.length === 0) {
  // Every window is a peer (spec §2, §9.5): the last tab closes THIS
  // window, and Rust decides whether that was also the last window and
  // the process should exit.
  //
  // WHO STANDS DOWN: the FRONTEND has already run the busy guard here
  // (CloseCoordinator, just above), so the guard on the Rust
  // `CloseRequested` path must NOT run again for a close that arrives
  // through `closeWindow()` — otherwise the user confirms twice for one
  // ⌘⇧W. The mechanism (a "guard already satisfied" marker on the window)
  // is the lifecycle section's; this is the call site that depends on it.
  // Task C13 removes the OTHER half of the same double-prompt: the
  // frontend `onCloseRequested` listener that currently makes Tauri
  // auto-prevent every window close.
  active = -1;
  try {
    await flushSettingsSave();
  } catch (err: unknown) {
    console.warn("Flush before window close failed:", err);
  }
  await closeWindow();
  return;
}
```

**Task C13 comes immediately before this one in the document and must be
done first.** Until it deletes the frontend `onCloseRequested` listener,
Tauri auto-prevents the close that `closeWindow()` requests here — so this
task's first test would pass while the real app hangs on a window that never
closes.

Add to `TabManagerDeps` (after `onAgentLaunchTimeout`, line 267):

```ts
  /**
   * Close THIS window. Defaults to `getCurrentWindow().close()`; Rust owns
   * "was that the last window" (spec §9.5). Test seam.
   */
  closeWindow?: () => Promise<void>;
  /** Test seam — defaults to the real Tauri transfer client. */
  transfer?: TransferClient;
```

and near the top of `createTabManager`:

```ts
const transfer = deps.transfer ?? defaultTransferClient;
const closeWindow = deps.closeWindow ?? (() => getCurrentWindow().close());
```

New imports for `tab-manager.ts`: `defaultTransferClient` and
`type TransferClient` from `./transfer-client`, and `type DetachTarget` from
`./pane-detach` (used by `movePane` below). `getCurrentWindow` is already
imported at `tab-manager.ts:1` — do not add it twice.

New import for `tab-manager.test.ts`: `createMemoryTransferClient` from
`./transfer-client`. `createMemoryPtyClient` (`:6`), `vi` and `tabViews` are
already there.

**Wire `identity` at every `createTerminalManager` call site.** `deps` already
flows through (`tab-manager.ts:613`, and the new `adoptIntoNewTab` below), but
`TerminalManagerDeps.identity` is optional and nothing supplies it — a
TerminalManager cannot know a tab's name override, dot color or workspace,
because TabManager owns `overrides` and `entry.workspacePath`. Left unwired,
every staged payload carries `tabName: null, dotColor: null,
workspacePath: null, agentId: null` and spec §10.2's "keeps the tab identity it
carried" fails **silently**. Extract one helper and pass it at each site:

```ts
/**
 * The identity a pane carries out of this window (spec §10.2). Lives here
 * rather than in TerminalManager because the name override, dot color and
 * workspace are TAB-level state, which only this closure holds.
 */
function managerDeps(tabKey: number, workspacePath: string | null) {
  return {
    ...deps,
    transfer,
    identity: (paneId: number) => {
      const override = overrides.get(tabKey);
      return {
        agentId: poller.infoFor(paneId)?.agent ?? null,
        tabName: override?.name ?? null,
        dotColor: override?.dotColor ?? null,
        workspacePath,
      };
    },
  };
}
```

`addTab` pushes its entry _after_ `createTerminalManager` runs, so pass
`nextKey` (the key that entry will get) and the already-normalized
`workspacePath` — both are in scope at `tab-manager.ts:609-633`. Replace the
call at `:613` with
`createTerminalManager(container, callbacks, paneIo, managerDeps(nextKey, workspacePath))`.
Verify `poller.infoFor`'s return shape at implementation time (it is the same
call `copyPaneCwd` uses at `tab-manager.ts:1056`); if `agent` is not a field
on it, use `explicitAgent(poller.infoFor(paneId))` — that helper is already
in this module at `:203-215`.

- [ ] **Step 4: Add the move and adopt entry points**

Add beside `newTab` (line 729):

```ts
/**
 * Move the focused pane into a brand-new window (spec §10.3). The emptied
 * tab is removed WITHOUT the reopen snapshot `disposeTab` takes: nothing
 * was closed, so there is nothing to reopen — the session is alive in
 * another window.
 */
async function movePaneToNewWindow(): Promise<void> {
  await movePane({ kind: "new-window" });
}

async function movePane(target: DetachTarget): Promise<void> {
  const index = active;
  const entry = tabs[index];
  const paneId = entry?.manager.activePaneId() ?? null;
  if (!entry || paneId === null) {
    reportChromeMessage("No pane to move.");
    return;
  }
  const outcome = await entry.manager.detachPaneById(paneId, target);
  if (outcome.kind === "kept") {
    return;
  }
  pruneMovedPane(paneId);
  if (outcome.tabEmpty) {
    removeEmptyTab(entry);
  }
  syncViews();
}

/**
 * The per-pane trackers `disposeTab` normally prunes (tab-manager.ts:975-981).
 * A moved pane skips that path entirely, so this is not redundant.
 */
function pruneMovedPane(paneId: number): void {
  const live = allPaneIds().filter((id) => id !== paneId);
  launcher.prune(live);
  activity.prune(live);
  tracker.prune(live);
  notifier.prune(live);
  pruneNotifiedKinds(live);
  poller.prune(live);
}

/** Remove a tab whose last pane MOVED — no busy guard, no reopen snapshot. */
function removeEmptyTab(entry: TabEntry): void {
  const removeAt = tabs.indexOf(entry);
  if (removeAt === -1) {
    return;
  }
  const closingActive = removeAt === active;
  const countBefore = tabs.length;
  entry.manager.dispose();
  tabs.splice(removeAt, 1);
  overrides.delete(entry.key);
  unread.delete(entry.key);
  if (tabs.length === 0) {
    active = -1;
    void closeWindow();
    return;
  }
  active = activeAfterClose(removeAt, active, countBefore);
  if (closingActive) {
    tabs[active].manager.show();
  }
}

/** Live-adopt into a NEW tab of this already-running window (spec §10.1). */
async function adoptIntoNewTab(token: string): Promise<boolean> {
  const container = document.createElement("div");
  container.className = "tab-stage";
  container.style.display = "none";
  host.appendChild(container);
  const manager = createTerminalManager(container, callbacks, paneIo, deps);
  const result = await manager.initFromAdoption(token);
  if (result.kind === "failed") {
    manager.dispose();
    return false;
  }
  tabs.push({
    key: nextKey,
    manager,
    workspacePath:
      result.payload.workspacePath === null
        ? null
        : normalizeWorkspacePath(result.payload.workspacePath),
  });
  if (result.payload.tabName !== null || result.payload.dotColor !== null) {
    overrides.set(nextKey, {
      ...(result.payload.tabName !== null
        ? { name: result.payload.tabName }
        : {}),
      ...(result.payload.dotColor !== null
        ? { dotColor: result.payload.dotColor }
        : {}),
    });
  }
  nextKey += 1;
  selectTab(tabs.length - 1);
  void poller.poll();
  syncViews();
  return true;
}
```

`nextKey` and `paneIo` already exist in this closure; verify their exact
identifiers at implementation time and match them, do not introduce new ones.

- [ ] **Step 5: Wire both cross-window listeners**

Inside `init()` (line 1371), alongside the other listeners:

```ts
// Destination side: another window prepared a pane for us.
unlisteners.push(
  await transfer.listenTransferOffer((token) => {
    void adoptIntoNewTab(token);
  }),
);
// SOURCE side: the "Move Pane to Window ▸" submenu. Rust cannot start
// this transfer itself — `prepare_transfer` takes the owning window, Rust
// cannot see which pane inside a window has focus, and §7.4 requires the
// SOURCE to serialize its buffer between prepare and claim. So the menu
// click comes back here and this window runs the move.
//
// This arrives on a DIFFERENT channel from `menu:action`, so `isActionId`
// never sees it and the payload is validated here (C7/C8) rather than
// trusted. The submenu ids carry a `window-target:` prefix in
// hand-written `menu.rs` precisely so they never reach that guard.
unlisteners.push(
  await transfer.listenMoveToWindow((targetLabel) => {
    void movePane({ kind: "window", label: targetLabel });
  }),
);
```

`listenMoveToWindow` is a new `TransferClient` member — add it in Task C2
beside `listenTransferOffer`, with the same shape:

```ts
  /**
   * "Move Pane to Window ▸" clicked. Rust emits `menu:move-pane-to-window`
   * to the FOCUSED window with the chosen destination label; this window is
   * then the source of the transfer.
   */
  listenMoveToWindow(
    handler: (targetLabel: string) => void,
  ): Promise<UnlistenFn>;
```

The validation is a **pure exported function**, not an inline check inside
the listener. Same reason `bootModeOrNormal` is one: a guard buried in a
Tauri adapter is a guard no unit test can reach, and this one decides
whether an untrusted string becomes the destination of a live PTY. Add to
Task C2, beside `bootModeOrNormal`:

```ts
/**
 * The destination label from a `menu:move-pane-to-window` payload, or null
 * when there isn't a usable one.
 *
 * This event arrives on a DIFFERENT channel from `menu:action`, so
 * `isActionId` (action-registry.ts:459-471) never sees it — the submenu ids
 * carry a `window-target:` prefix in hand-written `menu.rs` precisely to
 * keep them away from that guard. So this is the whole boundary check for a
 * value that decides where a running agent's pane ends up (C7/C8).
 */
export function moveToWindowTarget(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const label = (raw as { targetLabel?: unknown }).targetLabel;
  return typeof label === "string" && label !== "" ? label : null;
}
```

Tauri adapter, now a thin wrapper over it:

```ts
    listenMoveToWindow(handler) {
      return listen<unknown>(MOVE_TO_WINDOW_EVENT, (event) => {
        const label = moveToWindowTarget(event.payload);
        if (label === null) {
          console.warn("Ignoring malformed menu:move-pane-to-window payload");
          return;
        }
        handler(label);
      });
    },
```

with `const MOVE_TO_WINDOW_EVENT = "menu:move-pane-to-window";` and a
memory-client twin `moveToWindow(label)` mirroring `offer(token)`.

Add to Task C2's test file — the rejection cases are the point, so they are
enumerated rather than sampled:

```ts
describe("moveToWindowTarget", () => {
  it("accepts a well-formed target label", () => {
    expect(moveToWindowTarget({ targetLabel: "deck-2" })).toBe("deck-2");
  });

  it("rejects every malformed shape without producing a label", () => {
    expect(moveToWindowTarget({})).toBeNull();
    expect(moveToWindowTarget({ targetLabel: "" })).toBeNull();
    expect(moveToWindowTarget({ targetLabel: 42 })).toBeNull();
    expect(moveToWindowTarget({ targetLabel: null })).toBeNull();
    expect(moveToWindowTarget({ label: "deck-2" })).toBeNull();
    expect(moveToWindowTarget(null)).toBeNull();
    expect(moveToWindowTarget("deck-2")).toBeNull();
    expect(moveToWindowTarget(undefined)).toBeNull();
  });
});

it("delivers a well-formed move-to-window offer to the handler", async () => {
  const client = createMemoryTransferClient();
  const seen: string[] = [];
  await client.listenMoveToWindow((label) => void seen.push(label));
  client.moveToWindow("deck-2");
  expect(seen).toEqual(["deck-2"]);
});
```

And the end-to-end half of the same guard, in **Task C8**'s suite — proving a
malformed payload starts no transfer, not merely that a helper returned null:

```ts
it("starts no transfer when the move-to-window payload has no usable label", async () => {
  const pty = createMemoryPtyClient({ nextId: 1 });
  const transfer = createMemoryTransferClient();
  const manager = createTabManager(host, pty, {
    createPane: (id, _s, events) => fakePane(id, events),
    transfer,
    closeWindow: async () => {},
  });
  await manager.init();
  await manager.openFromPreset({ type: "leaf" }, [null]);

  // What the listener would receive for a malformed emit: no label at all.
  transfer.moveToWindow("");

  expect(transfer.calls).toEqual([]);
  expect(tabViews.value).toHaveLength(1);
});
```

For this to be a real test, the memory client's `moveToWindow` must run the
same `moveToWindowTarget` guard the Tauri adapter does — otherwise the fake
is more permissive than production and the test proves nothing. Write it as:

```ts
    moveToWindow(label) {
      const valid = moveToWindowTarget({ targetLabel: label });
      if (valid === null) {
        return;
      }
      for (const handler of moveHandlers) {
        handler(valid);
      }
    },
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/terminal/tab-manager.test.ts`
Expected: PASS. Any pre-existing test asserting `confirmQuit` on the last-tab
path must be rewritten to assert `closeWindow` — that behavior change is the
point of this task, not a regression.

- [ ] **Step 7: Commit**

```bash
git add src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts
git commit -m "feat(terminal): close the window, not the app, on the last tab"
```

---

### Task C9: Boot mode

**Files:**

- Modify: `src/main.tsx:11-27`
- Modify: `src/ui/app.tsx:194-332`
- Test: `src/ui/app.test.tsx`

**Interfaces:**

- Consumes: `defaultTransferClient.windowBootMode()`, `bootModeOrNormal`.
- Produces: `App({ boot }: { boot?: BootMode })`,
  `bootOpensTheBoard(boot: BootMode): boolean` (module scope, unit-testable).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/app.test.tsx`:

```ts
describe("bootOpensTheBoard", () => {
  it("opens the board on a normal boot", () => {
    expect(bootOpensTheBoard({ kind: "normal" })).toBe(true);
  });

  it("skips the board when the window boots to adopt a pane", () => {
    expect(bootOpensTheBoard({ kind: "adopt", token: "t-1" })).toBe(false);
  });
});
```

and add `bootOpensTheBoard` to the existing `from "./app"` import.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/app.test.tsx -t bootOpensTheBoard`
Expected: FAIL — `bootOpensTheBoard is not a function`
(`SyntaxError: The requested module './app' does not provide an export named
'bootOpensTheBoard'`).

- [ ] **Step 3: Add the predicate and the prop**

In `src/ui/app.tsx`, at module scope beside `livePresetOpensATab` (line 190):

```ts
/**
 * A window that booted to adopt a pane already has its content: showing the
 * Open board would cover a live terminal with a "pick a folder" screen
 * (spec §9.2). Extracted to module scope for the same reason as
 * `livePresetOpensATab` above — this repo has no `<App>` render harness.
 */
export function bootOpensTheBoard(boot: BootMode): boolean {
  return boot.kind === "normal";
}
```

Change the signature (line 194):

```ts
export function App({ boot = { kind: "normal" } }: { boot?: BootMode } = {}) {
```

Inside the mount effect, replace lines 323-328 with exactly this — one
block, no earlier variant:

```ts
    // Session restore is gone: a normal window always opens on the board
    // (Intent §Constraint). An adopt window opens on the pane it was created
    // for and never shows the board at all (spec §9.2).
    //
    // `init()` runs FIRST in both modes — it installs the PTY output and
    // exit listeners, and an adopted pane is dead without them.
    void manager
      .init()
      .then(() => {
        if (bootOpensTheBoard(boot)) {
          boardOpen.value = true;
          return undefined;
        }
        return manager
          .adoptIntoNewTab(boot.kind === "adopt" ? boot.token : "")
          .then((ok) => {
            if (!ok) {
              // Spec §13: a failed claim in a freshly booted window closes
              // that window — there is nothing else for it to show.
              void getCurrentWindow().close();
            }
          });
      })
      .catch((err: unknown) => {
        // Preserved from app.tsx:325-328. Without it an init failure is an
        // unhandled rejection AND the board never opens, so the window is
        // simply blank with no way forward.
        console.error("Failed to initialize terminals:", err);
        if (bootOpensTheBoard(boot)) {
          boardOpen.value = true;
          return;
        }
        void getCurrentWindow().close();
      });
```

The `.catch` covers both modes on purpose: a normal window falls back to the
board exactly as today, and an adopt window closes, because a window whose
only reason to exist failed to arrive has nothing to fall back to.

Add `import type { BootMode } from "../terminal/transfer-client";`.

- [ ] **Step 4: Read the boot mode before rendering**

In `src/main.tsx`, inside `main()` after
`initializeDesktopEnvironmentFromBackend()`:

```ts
// Read before anything renders (spec §9.2): deciding inside App's mount
// effect would paint the Open board for one frame in a window whose whole
// job is to show an adopted pane.
const boot = await defaultTransferClient.windowBootMode();
```

and change the render call:

```ts
  render(<App boot={boot} />, root);
```

with `import { defaultTransferClient } from "./terminal/transfer-client";`.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/ui/app.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/ui/app.tsx src/ui/app.test.tsx
git commit -m "feat(ui): boot a window straight into an adopted pane"
```

---

### Task C10: The action, its binding and the generated menu

**Files:**

- Modify: `src/terminal/action-registry.ts:360-380` (registry rows),
  `:543-684` (`MACOS_KEYMAP`), `:715-784` (`WINDOWS_KEYMAP`)
- Modify: `src/terminal/tab-manager.ts:104-156` (`COMMAND_ACTIONS`),
  `:1041-1180` (`commands`)
- Modify: `src-tauri/src/menu_registry.rs` — **generated, never hand-edited**
- Modify: `src-tauri/src/menu.rs:210-215` — the `window_menu_items_is_empty`
  tripwire (hand-written test, not generated)
- Test: `src/terminal/action-registry.test.ts`,
  `src/terminal/dispatch-coverage.test.ts` (no edit; it must stay green)

**Interfaces:**

- Produces: action id `move-pane-to-new-window`, label
  `"Move Pane to New Window"`, `menu: { submenu: "Window" }`, `scope: "pane"`,
  macOS `⌘⇧M`, Windows `Ctrl+Shift+M`.

**Binding evidence (closes spec §15 open question 1).** `m` is unbound in
both keymaps. Enumerated on 2026-08-10 against
`src/terminal/action-registry.ts` — `MACOS_KEYMAP` (declared at `:543`,
inspected in full) and `WINDOWS_KEYMAP` (`:715`) contain no binding whose
`key` is `"m"` or whose `code` is `"KeyM"`. On the menu side,
`src-tauri/src/menu_registry.rs` declares six `CmdOrCtrl+Shift+…`
accelerators — `T`(`:18`), `N`(`:24`), `S`(`:30`), `W`(`:33`), `D`(`:56`),
`Enter`(`:62`), `A`(`:77`), `P`(`:83`), `G`(`:111`), `C`(`:116`) — none of
them `M`. macOS's own `⌘M` (Minimize) is a Cocoa builtin added by
`SubmenuBuilder::minimize()` (`src-tauri/src/menu.rs`, Window submenu);
`⇧⌘M` is not claimed by it. `CharKeyBinding` is mandatory, not a style
choice: this action carries a macOS menu item and a Cocoa accelerator is
declared by character — the RULE above `CharKeyBinding` at
`action-registry.ts:481-497`.

- [ ] **Step 1: Write the failing test**

In `src/terminal/action-registry.test.ts`, add after the `toggle-prompts`
binding test (line 56):

```ts
it("binds move-pane-to-new-window on both platforms without colliding", () => {
  const mac = MACOS_KEYMAP.filter(
    (binding) => binding.action === "move-pane-to-new-window",
  );
  const win = WINDOWS_KEYMAP.filter(
    (binding) => binding.action === "move-pane-to-new-window",
  );
  expect(mac).toEqual([
    { key: "m", meta: true, shift: true, action: "move-pane-to-new-window" },
  ]);
  expect(win).toEqual([
    { key: "m", ctrl: true, shift: true, action: "move-pane-to-new-window" },
  ]);
  // It has a menu item, so the RULE above CharKeyBinding requires `key`.
  expect(mac[0]).not.toHaveProperty("code");
});
```

and update the id census at line 58: rename the test to
`"has exactly the 44 action ids including updater menu actions"` and add
`"move-pane-to-new-window",` to the expected set.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/action-registry.test.ts`
Expected: FAIL twice — the binding test gets `[]` for both keymaps, and the
census test reports the set is missing `move-pane-to-new-window`.

- [ ] **Step 3: Add the registry row**

In `src/terminal/action-registry.ts`, after the `toggle-prompts` row
(line 380):

```ts
  {
    id: "move-pane-to-new-window",
    label: "Move Pane to New Window",
    // Tier "pane": it acts on the FOCUSED pane, which every overlay hides —
    // same reasoning as toggle-prompts above.
    scope: "pane",
    // The Window submenu is native window management, and moving a pane into
    // its own window is exactly that. `menu.rs` already loops over
    // `WINDOW_MENU_ITEMS` for this case and says so in its own comment, so
    // this needs no hand-written menu code.
    menu: { submenu: "Window", group: "move-pane" },
  },
```

Not marked `destructive`: nothing is killed and nothing is lost — a failed
move leaves the pane exactly where it was.

- [ ] **Step 4: Add the bindings**

In `MACOS_KEYMAP`, after the `toggle-prompts` binding (line 644):

```ts
  // Move the focused pane into its own window. ⌘⇧M is free on both keymaps
  // (no `m`/`KeyM` binding existed on either) and `m` is the "move" mnemonic;
  // macOS's ⌘M Minimize is a Cocoa builtin and does not claim the Shift
  // variant. CharKeyBinding is mandatory, not a style choice: this action has
  // a macOS menu item, and a Cocoa accelerator is declared by character (see
  // the RULE above).
  { key: "m", meta: true, shift: true, action: "move-pane-to-new-window" },
```

In `WINDOWS_KEYMAP`, after the `toggle-prompts` binding (line 779):

```ts
  { key: "m", ctrl: true, shift: true, action: "move-pane-to-new-window" },
```

- [ ] **Step 5: Add the dispatch target**

In `src/terminal/tab-manager.ts`, add `"move-pane-to-new-window",` to
`COMMAND_ACTIONS` (`tab-manager.ts:104-156`), keeping that list's
alphabetical order — it goes after `"focus-up"` and before `"new-preset"`.

**Update that list's own doc comment in the same edit:** it opens "The ids
`commands` implements — 40 entries" (`tab-manager.ts:107`), which becomes 41.
That number is hand-maintained prose, not derived, so nothing fails if it
drifts — which is exactly why it has to be corrected deliberately.

Then add to the `commands` table beside `"toggle-prompts"`:

```ts
    "move-pane-to-new-window": () => void movePaneToNewWindow(),
```

`DISPATCHABLE_ACTIONS` is derived from `COMMAND_ACTIONS`, so
`dispatch-coverage.test.ts` picks this up with no edit — and would fail if the
binding were added without the dispatch entry, which is exactly the H1/A4
defect it exists to catch.

- [ ] **Step 6: Regenerate the menu**

```bash
npm run generate:menu
```

Expected diff in `src-tauri/src/menu_registry.rs`: `WINDOW_MENU_ITEMS` stops
being empty and gains
`("move-pane-to-new-window", "Move Pane to New Window", Some("CmdOrCtrl+Shift+M")),`.
Do not hand-edit that file (R3).

- [ ] **Step 7: Update the Rust tripwire that asserts the Window menu is empty**

`src-tauri/src/menu.rs:210-215` carries a deliberate tripwire that goes red
the moment the registry puts a Window action back — which is exactly what
Step 3 does. It is not a mystery failure and it is not to be deleted; the
whole point of the tripwire is that a human states why the list changed.
Replace it with:

```rust
    #[test]
    fn window_menu_items_holds_only_move_pane_to_new_window() {
        // Was `is_empty()` until the pane-detach work: Window is no longer
        // 100% Cocoa builtins. Moving a pane into its own window IS window
        // management, so it belongs here (spec §15.1 / the ⌘⇧M binding).
        // Still a deliberate tripwire — update it by hand, with a reason,
        // whenever action-registry.ts adds another Window action.
        let ids: Vec<&str> = WINDOW_MENU_ITEMS.iter().map(|(id, _, _)| *id).collect();
        assert_eq!(ids, ["move-pane-to-new-window"]);
    }
```

Match the surrounding tests' style for extracting `ids` — the Edit-menu
tripwire just above it already does exactly this, so copy its shape rather
than inventing one.

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/dispatch-coverage.test.ts src/terminal/keymap.test.ts src/terminal/tab-manager.test.ts && npm run generate:menu:check && (cd src-tauri && cargo test menu)`
Expected: PASS on all four suites, `generate:menu:check` exits 0, and the
Rust menu tests pass with the rewritten tripwire.

- [ ] **Step 8: Commit**

```bash
git add src/terminal/action-registry.ts src/terminal/action-registry.test.ts src/terminal/tab-manager.ts src-tauri/src/menu_registry.rs src-tauri/src/menu.rs
git commit -m "feat(terminal): add the Move Pane to New Window command"
```

---

### Task C11: `updateSettings` becomes a patch sender

**Files:**

- Create: `src/settings/settings-sync.ts`
- Modify: `src/settings/settings-store.ts:20-33` (`initSettings`), `:66-70`
  (`updateSettings`)
- Test: `src/settings/settings-store.test.ts`,
  `src/settings/settings-sync.test.ts` (new)

**Interfaces:**

- Consumes: a Rust command that merges a settings patch under a lock and
  broadcasts the merged object (spec §9.5).
- Produces: `SettingsSyncClient` (`sendPatch`, `listenMerged`),
  `createTauriSettingsSync()`, `createMemorySettingsSync()`,
  `configureSettingsSync(client)`.

**Decision, stated because it changes observable behaviour:** the local signal
is set **optimistically and synchronously**, then the patch goes to Rust and
the merged broadcast overwrites it. Every existing caller reads
`settings.value` immediately after `updateSettings` — the focus-expand toggle
at `tab-manager.ts:1074-1075` and the font-size ones at `:1080-1084` both do —
and every settings test assumes a synchronous signal write. Making the signal
wait for a round trip would break all of them and make the UI feel laggy for
no correctness gain: the merge is what prevents cross-window clobbering, and
the broadcast is what reconciles.

- [ ] **Step 1: Write the failing test**

Create `src/settings/settings-sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemorySettingsSync } from "./settings-sync";

describe("createMemorySettingsSync", () => {
  it("records every patch in order", async () => {
    const sync = createMemorySettingsSync();
    await sync.sendPatch({ fontSize: 15 });
    await sync.sendPatch({ scrollback: 5000 });
    expect(sync.patches).toEqual([{ fontSize: 15 }, { scrollback: 5000 }]);
  });

  it("delivers a merged broadcast to the registered listener", async () => {
    const sync = createMemorySettingsSync();
    const seen: unknown[] = [];
    await sync.listenMerged((merged) => void seen.push(merged));
    sync.broadcast({ fontSize: 21 });
    expect(seen).toEqual([{ fontSize: 21 }]);
  });
});
```

And in `src/settings/settings-store.test.ts`, append the block below. Its
imports need extending first: the file today imports only
`flushSettingsSave, initSettings, updateSettings` from `./settings-store`
(`:15-19`), so add `configureSettingsSync` and `settings` there, plus
`createMemorySettingsSync` from `./settings-sync` and `DEFAULT_SETTINGS`
from `./settings-schema`.

```ts
describe("settings patch sync", () => {
  it("sends only the patch, not the whole object, and updates the signal at once", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    updateSettings({ fontSize: 17 });

    expect(settings.value.fontSize).toBe(17);
    expect(sync.patches).toEqual([{ fontSize: 17 }]);
  });

  it("adopts a merged broadcast from another window", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    sync.broadcast({ ...settings.value, fontSize: 19 });

    expect(settings.value.fontSize).toBe(19);
  });

  // Both halves of the boundary rule. They are NOT the same case, and the
  // difference is the whole point: a structurally broken message is a bug in
  // the sender and must change nothing, while a well-shaped message with one
  // junk field goes through this repo's existing coercion.
  it("ignores a structurally invalid broadcast and keeps live settings untouched", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();
    updateSettings({ fontSize: 17 });
    const before = settings.value;

    sync.broadcast(null);
    sync.broadcast("not settings");
    sync.broadcast(42);

    // Not merely "still 17" — the exact object, proving nothing was rebuilt
    // from DEFAULT_SETTINGS, which is what validateSettings would have
    // returned for any of these three (settings-schema.ts:199-201).
    expect(settings.value).toBe(before);
    expect(settings.value.fontSize).toBe(17);
  });

  it("coerces a single bad field in an otherwise well-formed broadcast", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    sync.broadcast({ ...DEFAULT_SETTINGS, fontSize: "huge" });

    // Coercion, not rejection: the message was understandable, so the rest
    // of it applies and this one field falls back.
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/settings/settings-sync.test.ts src/settings/settings-store.test.ts`
Expected: FAIL — `Failed to resolve import "./settings-sync"`, then
`configureSettingsSync is not a function`.

- [ ] **Step 3: Implement the sync seam**

Create `src/settings/settings-sync.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, type Settings } from "./settings-schema";

const MERGED_EVENT = "settings:merged";

/**
 * Cross-window settings sync (spec §9.5).
 *
 * `onKeyChange` was considered and rejected: it announces that a write
 * happened but does not stop two windows' read-modify-write cycles from
 * clobbering each other. A patch merged under a Rust lock does.
 *
 * Command and event names are FROZEN (merge reconciliation 2026-08-10):
 * `apply_settings_patch` and `settings:merged`, both owned by the
 * window-lifecycle section.
 */
export interface SettingsSyncClient {
  /**
   * Resolves with the MERGED settings Rust produced.
   *
   * Typed faithfully because the Rust command really returns it, but callers
   * in this repo deliberately do NOT apply it: `settings:merged` is the one
   * authoritative path to state (see `updateSettings`). The resolved value is
   * here so a future caller that genuinely needs a causally-ordered read has
   * it, and so the type does not lie about the command.
   */
  sendPatch(patch: Partial<Settings>): Promise<unknown>;
  listenMerged(handler: (merged: unknown) => void): Promise<UnlistenFn>;
}

export function createTauriSettingsSync(): SettingsSyncClient {
  return {
    sendPatch(patch) {
      return invoke<unknown>("apply_settings_patch", { patch });
    },
    listenMerged(handler) {
      return listen<unknown>(MERGED_EVENT, (event) => handler(event.payload));
    },
  };
}

export function createMemorySettingsSync(): SettingsSyncClient & {
  readonly patches: Partial<Settings>[];
  broadcast(merged: unknown): void;
} {
  const patches: Partial<Settings>[] = [];
  const handlers = new Set<(merged: unknown) => void>();
  // Stands in for Rust's authoritative copy; seeded from the defaults so a
  // reply always validates.
  let merged: Settings = DEFAULT_SETTINGS;
  return {
    patches,
    broadcast(next) {
      for (const handler of handlers) {
        handler(next);
      }
    },
    async sendPatch(patch) {
      patches.push(patch);
      // Mirrors the real command: the merge happens in Rust and the merged
      // object comes back. Production ignores this value — `settings:merged`
      // is authoritative — but the fake must still return it, or a future
      // caller that DOES read it would be written against a fake that never
      // produced one.
      merged = { ...merged, ...patch };
      return merged;
    },
    async listenMerged(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
```

- [ ] **Step 4: Rewrite `updateSettings` as a patch sender**

In `src/settings/settings-store.ts`, add:

```ts
import {
  createTauriSettingsSync,
  type SettingsSyncClient,
} from "./settings-sync";

let sync: SettingsSyncClient | null = null;

/** Test seam; production installs the Tauri client from `initSettings`. */
export function configureSettingsSync(client: SettingsSyncClient): void {
  sync = client;
}
```

At the end of `initSettings`'s `try` block:

```ts
if (sync === null) {
  sync = createTauriSettingsSync();
}
await sync.listenMerged((merged) => {
  // Shape guard at the boundary, NOT a try/catch: `validateSettings` never
  // throws — it coerces, and for a non-object it returns DEFAULT_SETTINGS
  // wholesale (settings-schema.ts:199-201). So handing it a structurally
  // malformed broadcast would silently reset this window's live settings to
  // defaults, which is the worst possible response to "I cannot understand
  // this message". Ignore it instead and keep what we have.
  //
  // Per-field junk is deliberately NOT treated the same way: that already
  // has defined coercion semantics used everywhere else in this repo, and
  // changing them is out of scope.
  if (typeof merged !== "object" || merged === null) {
    console.warn("Ignoring a structurally invalid settings broadcast");
    return;
  }
  settings.value = validateSettings(merged);
});
```

**`validateSettings` coerces and never throws** — verified against
`src/settings/settings-schema.ts:199-201`. Do not wrap it in a `try/catch`
(dead code) and do not change it.

And replace `updateSettings` (lines 66-70):

```ts
export function updateSettings(patch: Partial<Settings>): void {
  // Optimistic and synchronous on purpose: every caller reads
  // `settings.value` on the next line (tab-manager.ts:1074-1075, :1080-1084), and
  // a round trip would make the UI wait on IPC for a font-size bump. The
  // Rust merge is what stops two windows clobbering each other; the merged
  // broadcast reconciles this window a moment later.
  const next = { ...settings.value, ...patch };
  settings.value = next;
  persist(next);
  // `apply_settings_patch` ALSO returns the merged object, and this
  // deliberately ignores it. There must be exactly one authoritative path to
  // state, and it is the `settings:merged` BROADCAST — one ordered stream
  // Rust emits to every window, so all windows converge on the same
  // sequence. The per-caller reply is not equivalent: when two windows patch
  // concurrently, this window's reply can be older than a broadcast it has
  // already applied, and adopting it afterwards would regress the value the
  // user is looking at. Applying both is what produces a flicker.
  //
  // So the reply is used for ONE thing: knowing the write failed.
  void sync?.sendPatch(patch).catch((err: unknown) => {
    console.warn("Settings patch merge failed:", err);
    reportPersistError(
      "Couldn't sync settings across windows — other windows may be stale.",
    );
  });
}
```

`persist` stays: the plugin-store file is still what `initSettings` reads at
launch and what `flushSettingsSave` flushes on quit. Whether disk ownership
should move to Rust as well is out of this section's scope — Findings (b).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/settings/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/settings/settings-sync.ts src/settings/settings-sync.test.ts src/settings/settings-store.ts src/settings/settings-store.test.ts
git commit -m "feat(settings): send settings changes as a merged patch"
```

---


### Task C14: Single-flight the updater check

**Files:**

- Modify: `src/ui/app.tsx:310-322` (the updater start block)
- Modify: `src/updater/update-controller.ts` — the `start()` entry only
- Test: `src/updater/update-controller.test.ts`

**Interfaces:**

- Consumes: `begin_update_check()` → `boolean` (Rust single-flight; true for
  the one window that wins).
- Produces: `UpdateController.start()` gains a `claim?: () => Promise<boolean>`
  dependency, defaulting to the Tauri command.

**Why:** `activeUpdateController` is a per-window module signal
(`src/updater/active-update-controller.ts`), so with peer windows every
window runs its own check, downloads its own copy and can race another
window's install. Spec §9.5 puts the single-flight in Rust precisely because
"the first window is primary" fails when the first window dies first.

- [ ] **Step 1: Write the failing test**

Append to `src/updater/update-controller.test.ts`:

```ts
describe("update check single-flight", () => {
  it("does not auto-check when another window already claimed the check", async () => {
    const { controller, deps } = setup(null, { claim: async () => false });

    await controller.start();

    expect(deps.check).not.toHaveBeenCalled();
  });

  it("auto-checks when this window wins the claim", async () => {
    const { controller, deps } = setup(null, { claim: async () => true });

    await controller.start();

    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("auto-checks when the claim command fails — a broken single-flight must not disable updates", async () => {
    const { controller, deps } = setup(null, {
      claim: async () => {
        throw new Error("command not found");
      },
    });

    await controller.start();

    expect(deps.check).toHaveBeenCalledOnce();
  });

  it("never gates an explicit Check for Updates…", async () => {
    const { controller, deps } = setup(null, { claim: async () => false });

    await controller.checkNow();

    expect(deps.check).toHaveBeenCalledOnce();
  });
});
```

This reuses the file's existing `setup(update, overrides)` helper
(`update-controller.test.ts:19-33`), which already spreads
`Partial<UpdateControllerDependencies>` over a full default set and returns
`{ controller, deps, update }` — do not add a second harness.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/updater/update-controller.test.ts`
Expected: FAIL — `claim` is not a property of
`UpdateControllerDependencies` (a `tsc` error under `npm run build`; at
runtime the first case's `deps.check` is called once instead of never).

- [ ] **Step 3: Gate the automatic check only**

Add to `UpdateControllerDependencies` (`update-controller.ts:31-45`):

```ts
  /**
   * Claim the right to run the automatic startup check. Rust holds a
   * process-wide single-flight (spec §9.5) so peer windows do not each
   * download the same update — "the first window is primary" fails when the
   * first window dies first. Defaults to the real command.
   *
   * Fail-OPEN on error: a broken single-flight must degrade to "every window
   * checks", never to "nobody checks". A duplicated download is an
   * annoyance; a silently disabled updater is a security problem.
   */
  claim?: () => Promise<boolean>;
```

and inside `start()` (`update-controller.ts:133-138`), after the `started`
guard so a claim is spent at most once per window:

```ts
const start = async (): Promise<void> => {
  if (started) {
    return;
  }
  started = true;
  const claim = deps.claim ?? (() => invoke<boolean>("begin_update_check"));
  const release = deps.releaseClaim ?? (() => invoke("end_update_check"));
  let mine = true;
  try {
    mine = await claim();
  } catch (err: unknown) {
    console.warn("begin_update_check failed; checking anyway:", err);
  }
  if (!mine) {
    return;
  }
  try {
    await checkForAvailableUpdate();
  } finally {
    // ALWAYS released, including when the check throws. The single-flight is
    // process-wide: a claim leaked by a failed check means no window ever
    // auto-checks again for the life of the process.
    await release().catch((err: unknown) => {
      console.warn("end_update_check failed:", err);
    });
  }
};
```

with `import { invoke } from "@tauri-apps/api/core";`, and the matching
dependency beside `claim`:

```ts
  /** Release the single-flight claim. Defaults to `end_update_check`. */
  releaseClaim?: () => Promise<void>;
```

**The claim must be released or the feature dies quietly** — `end_update_check`
exists in the frozen contract for exactly this, and a plan that took the
claim without returning it would have shipped an updater that checks once
per process launch and never again. Add the test that locks it:

```ts
it("releases the single-flight claim even when the check throws", async () => {
  const releaseClaim = vi.fn().mockResolvedValue(undefined);
  const { controller } = setup(null, {
    check: vi.fn().mockRejectedValue(new Error("network down")),
    claim: async () => true,
    releaseClaim,
  });

  await controller.start();

  expect(releaseClaim).toHaveBeenCalledOnce();
});
```

Check whether `checkForAvailableUpdate` already swallows its own errors
(it returns an `UpdateCheckResult` including `"failed"`, so it probably
does) — if it never rejects, keep the `finally` anyway and drive the test's
rejection through `claim` resolving true plus a `check` that throws, which
is the path above.

**`checkNow` is deliberately NOT gated.** It is the menu's "Check for
Updates…" — an explicit user request, which must always do something
visible. Only the silent startup check needs the single-flight, so
`app.tsx:321`'s `void updater.start()` needs no change and the menu path is
untouched.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/updater/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/update-controller.ts src/updater/update-controller.test.ts
git commit -m "feat(updater): single-flight the update check across windows"
```

---

### Task C12: Full gates, manual verification and docs

**Files:**

- Modify: `AGENTS.md` (In-flight list), `docs/CONTEXT.md`,
  `docs/ARCHITECTURE.md` (drift ledger)

**⚠️ All three files carry uncommitted unrelated changes right now** (verified
2026-08-10 at `289a12a`). Targeted edits only — never a whole-file rewrite,
never revert an unrelated hunk.

- [ ] **Step 1: Run the full suite**

```bash
npm test
npm run build
npm run generate:menu:check
```

Expected: all green. Record the `dist/assets/index-*.js` gzip figure and
compare with the Task C1 baseline; the only new dependency is
`@xterm/addon-serialize@0.14.0`.

- [ ] **Step 2: Manual verification (spec §14)**

```bash
npm run tauri dev
```

Walk: ⌘⇧M on a pane with a running agent → the pane appears in a new window
with its scrollback intact and the agent still responding; type in the new
window and confirm input reaches the same process; close the source window,
then the destination, in both orders; quit with a busy agent in a
non-focused window. **A green build is not verification of any of this.**

- [ ] **Step 3: Write the outcome down**

In `AGENTS.md`'s "In flight" list, record what shipped and what did not, with
the two contract gaps named (`awaitOutcome`, `offerTransfer`) and the
⌘⇧M / Ctrl+Shift+M binding with its evidence. In `docs/CONTEXT.md`, record
what was verified manually and what was not. In `docs/ARCHITECTURE.md`, carry
any unverified claim in the drift ledger as `building`.

- [ ] **Step 4: Ask before committing docs**

D14: never commit documentation before the user has approved its content.

```bash
git add AGENTS.md docs/CONTEXT.md docs/ARCHITECTURE.md
git commit -m "docs(terminal): record the pane detach frontend landing"
```

---

## Findings

### (a) Spec claims that are wrong against the code

1. **§5's `app.tsx` anchors have drifted.** The spec cites
   `app.tsx:206` for the `TabManager` construction, `:300` Board open,
   `:336` updater check, `:366` quit guard / `menu:action`. The real file is
   `src/ui/app.tsx` (not `src/app.tsx`), and the true positions are: manager
   construction `:305`, `boardOpen.value = true` `:324`, updater
   `void updater.start()` `:321`, quit guard `:334-355`, `menu:action`
   listener `:357-383`. Every other §5 anchor checked out
   (`pane.ts:287-289`, `pane-lifecycle.ts:69-95`, `terminal-manager.ts:698`
   and `:305-311`, `tab-manager.ts:980-989`, `settings-store.ts:66-70`).
2. **§5 says "None of the files cited here have uncommitted changes."** True
   again today, but for a different reason than when written: the
   icon-system migration has since landed. Current dirty set at `289a12a`:
   `.github/workflows/release.yml`, `AGENTS.md`, `docs/ARCHITECTURE.md`,
   `docs/CONTEXT.md`, `marketing/landing-prototype/src/directions/a.js`,
   `scripts/release-workflow.test.ts`, plus untracked
   `scripts/generate-release-notes.{mjs,test.ts}`. The section brief's hazard
   list naming `src/ui/chrome-actions.tsx` and `src/styles.css` was stale —
   both are committed. Corrected across all four sections at merge
   reconciliation, and the replacement list is itself a snapshot: the session
   that owns those files is still active, so re-check `git status` at
   execution time (merged §0.1).
3. **§12's module table is incomplete for the frontend.** It lists
   `pane-detach.ts` and `pane-adopt.ts` but no IPC seam, so as written both
   orchestrators would have to `invoke` directly and could not be tested.
   This plan adds `src/terminal/transfer-client.ts` (the `pty-client.ts`
   precedent) and `src/settings/settings-sync.ts`.

### (b) Cross-section items — all six resolved at merge reconciliation

Kept as a record of what changed and why, not as open questions. Every one is
now settled in the merged plan's §0.2 / §0.3.

1. **Who calls `commit_transfer` — resolved, spec wins.** This section
   followed spec §7.3's `caller == to` over the section brief's
   "source commits". The brief was wrong; `pane-adopt.ts` commits. No code
   change.
2. **`transfer:settled` — resolved, adopted.** Spec §13 is unimplementable
   without a completion signal to the source. Now emitted by Rust to **both**
   labels, and (merged §0.2) by the §7.5 bounds too — which is what lets
   `awaitOutcome` have no timer of its own.
3. **`offer_transfer` / `transfer:offer` — resolved, adopted**, owned by the
   window-lifecycle section. Consumer model unchanged.
4. **"Move Pane to Window ▸" — resolved this section's way.** A dynamic id
   like `move-pane-to-window:deck-2` is rejected by `isActionId`
   (`action-registry.ts:459-471`), the guard on the untrusted IPC payload,
   and the generated registry cannot express a submenu built from live
   windows. Only the static `move-pane-to-new-window` is registered. **This
   handed work back to this section:** the submenu cannot start the transfer
   in Rust either (§7.4 needs the SOURCE to serialize between prepare and
   claim), so Rust emits `menu:move-pane-to-window { targetLabel }` to the
   focused window and the frontend runs the move — Task C8 Step 5, with its
   own payload validation because that channel bypasses `isActionId`.
5. **`AdoptionPayload` — resolved, frozen.** `paneId, cwd, agentId,
scrollback, cols, rows, tabName, dotColor, workspacePath`. This section's
   draft guessed `agent`; the wire name is `agentId` and every site in this
   plan now uses it. `dotColor` stays typed as `TabDotColor` on the TS side.
6. **Last-tab double-prompt — resolved, and it grew a second half.** The
   frontend stands down: the busy guard runs once, here, and Rust must not
   re-run it for a close arriving through `closeWindow()`. The half this
   section had NOT seen is that
   `getCurrentWindow().onCloseRequested` in `quit-guard.ts:48-51` makes Tauri
   auto-prevent **every** window close — so `closeWindow()` would have been
   vetoed by our own listener. Now **Task C13**.

**Still open and deliberately unfixed — carried into the merged plan's risk
list:** settings disk ownership is split. Writes go through
`apply_settings_patch`, but `initSettings` still reads and
`flushSettingsSave` still flushes the plugin-store file, so both sides touch
`settings.json`. Spec §9.5 does not say which owns disk; moving load/flush is
out of scope.

**Resolved:** `apply_settings_patch` and `begin_update_check` were missing
from the merged plan's §0.2 when this section first flagged them; they are
present now (header lines 54-55), along with `end_update_check` and the four
quit/close commands. This section follows the header.

### (c) Forks — one decided at reconciliation, three still open

1. **Where a moved pane lands on live-adopt — DECIDED.** The menu path
   creates a new tab (`adoptIntoNewTab`, preserving tab name and dot color);
   the drag path uses `adoptIntoActiveTab({ token, targetPaneId, edge })`
   with the dropped edge. The reason is that a drag gesture names a position
   and a menu command does not.
2. **Spec §15 questions 2 and 3** (whether the detached window reuses the
   source's size/position; whether `deck-*` windows appear in the macOS
   Window menu and under what title) are **not** closed here. They belong to
   the window-lifecycle section — which has since taken defaults for both and
   returned them to the user as merged §0.8 items 1 and 2. This section
   closes question 1 only.
3. **R2:** this section adds no chrome surface, so no
   `docs/DESIGN-LANGUAGE.md` rule is proposed. If implementation finds one is
   needed, that is a fork to raise, not to decide.
4. **`reopen-tab` after a move.** A tab emptied by a move is removed without
   a reopen snapshot — nothing was closed. Whether ⌘⇧T should instead be able
   to "bring the pane back" is unasked; now merged §0.8 item 6.
5. **R1 violation adjacent to Task C13.** `src/lib/quit-guard.ts:43` carries
   a Vietnamese doc comment on the very function C13 rewrites. Rewriting that
   one comment is in scope; a sweep of the file is not (W3). Flagged rather
   than silently fixed.

### (d) Keybinding evidence — closes spec §15.1

**Chosen: macOS `⌘⇧M`, Windows `Ctrl+Shift+M`**, action id
`move-pane-to-new-window`, label `"Move Pane to New Window"`, menu
`Window ▸`.

- `MACOS_KEYMAP` — declared `src/terminal/action-registry.ts:543-684`,
  enumerated in full on 2026-08-10: **no binding with `key: "m"` or
  `code: "KeyM"`.** Its `⌘⇧` chords are `d`(`:545`), `w`(`:548`),
  `BracketRight`/`BracketLeft`(`:596-597`), `+`(`:607`), `enter`(`:611`),
  `g`(`:617`), `c`(`:623`), `t`(`:624`), `r`(`:628`), `n`(`:631`),
  `s`(`:633`), `a`(`:637`), `p`(`:644`), and the four `⌘⌥⇧` arrows
  (`:655-670`).
- `WINDOWS_KEYMAP` — declared `src/terminal/action-registry.ts:715-784`,
  enumerated in full: **no `m` / `KeyM`.** Its `Ctrl+Shift` chords are
  `c`(`:716`), `v`(`:718`), `d`(`:721`), `w`(`:723`), `e`(`:747`),
  `enter`(`:748`), `t`(`:749`), `tab`(`:759`), `+`(`:763`), `f`(`:766`),
  `k`(`:769`), `a`(`:772-777`), `p`(`:779`).
- Menu accelerators — `src-tauri/src/menu_registry.rs` declares
  `CmdOrCtrl+Shift+` `T`(`:18`), `N`(`:24`), `S`(`:30`), `W`(`:33`),
  `D`(`:56`), `Enter`(`:62`), `A`(`:77`), `P`(`:83`), `G`(`:111`),
  `C`(`:116`). **No `M`.**
- macOS builtins — `⌘M` (Minimize) comes from
  `SubmenuBuilder::new(handle, "Window").minimize()` in
  `src-tauri/src/menu.rs`; the Shift variant is unclaimed.
- `CharKeyBinding` is mandatory, not stylistic: the action carries a macOS
  menu item and a Cocoa accelerator is declared by character — the RULE at
  `src/terminal/action-registry.ts:481-497`.
- The `Window` submenu needs **no hand-written Rust**:
  `menu_registry::WINDOW_MENU_ITEMS` is empty today and `menu.rs`'s loop over
  it is already wired, with a comment saying it exists precisely so a
  registry row can come back and be picked up by `npm run generate:menu`.

### (e) Window-scoped stores that break under multiple windows

Each Deck window is its own webview, hence its own JS realm, so **every
`signal(...)` in `src/` is already per-window** — R5's "module stores are
window-scoped" holds by construction. What breaks is the stores backed by
**shared disk**, where two windows read-modify-write the same file:

| Store                                                        | File               | Status                                                                                                                               |
| ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `settings-store.ts`                                          | `settings.json`    | **Fixed in Task C11** — patch merged in Rust, merged object broadcast.                                                               |
| `presets-store.ts`                                           | presets            | **Last-write-wins, accepted** (spec §4 non-goals). Two windows editing presets in the same second loses one edit.                    |
| `open-board/workspaces-store.ts`                             | workspaces/recents | **Last-write-wins, accepted.** Every Open in any window writes recents, so this is the most likely of the three to actually collide. |
| `settings/logo-store.ts`, `settings/workspace-logo-store.ts` | logo               | **Last-write-wins, accepted.**                                                                                                       |

Two more that are per-window by design and now behave differently, worth
knowing rather than fixing:

- `closed-tabs.ts` is in-memory, so **⌘⇧T only reopens tabs closed in the
  same window.** Correct under the peers model, but a behaviour change nobody
  has stated.
- `updater/active-update-controller.ts` is per-window, so every window would
  run its own update check. Spec §9.5 already calls for a Rust-side
  single-flight — **that is the window-lifecycle section's, not this one's**,
  and until it lands two windows will both check.

Finally, `src/terminal/pane-cwd.ts` and `src/terminal/search-bar.ts` keep
module-level per-pane maps. Both are correctly per-window, and both are
explicitly cleaned on the move path (`life.releasePane` clears the cwd,
`releaseMovedPane` closes the search bar) — the source aftermath bypasses
`closePane`/`disposeTab`, which is where that cleanup normally lives.

### (f) Not written here on purpose

Spec §14's **coordinate-conversion test against the two measured samples**
belongs to the cross-window drag section (§11, Phase B) — `window-drag.ts` /
`window-registry.ts` are not this section's modules. It is not in any task
above.
````

---

## Section D — Cross-window drag (Phase B, gated)

_Owns spec §11. **Do not start D6 or later until D1 has passed** (§0.7). Two exceptions run in wave 1 and are not gated: D3–D5 (pure geometry) and **D7b** (`dockNewPane`, pure tree code, a wave-1 prerequisite for Section C)._

# Plan section D — Cross-window pane drag (Phase B, spec §11)

> **Section owner:** cross-window drag only. The Rust transfer transaction (§7),
> `pane-detach.ts` and `pane-adopt.ts` are owned by other sections and are
> **consumed, not redesigned** here.

**Goal:** Drag a pane out of its window and drop it into another Deck window at a
chosen edge, or onto empty screen space to create a new window — using the same
pointer capture, the same pure hit-test (`dropTargetAt` / `edgeFor`) and the same
`.drop-overlay` the in-window drag already uses.

**Architecture:** Capture never leaves the source window (spec §6). The source
relays _screen_ coordinates on a global Tauri event, throttled to ~60 Hz. Every
window converts those coordinates with **its own** `scaleFactor` and **its own**
live `innerPosition`, hit-tests its own active-tab slot rects, draws the overlay
locally, and replies to the source with the target it accepted. At `pointerup`
the source runs the §7 transfer against the last accepted reply. Each drag
carries an id and each relay frame a sequence number, so a late reply from a
previous drag or an out-of-order frame can never win.

**Tech stack:** TypeScript, Preact signals, `@tauri-apps/api` 2.11.1
(`event.emit` / `event.emitTo` / `event.listen`,
`window.getCurrentWindow()`, `webviewWindow.getAllWebviewWindows()`), Vitest
(`vitest run`, default environment `node`; jsdom via the first-line pragma).
**npm, not pnpm.**

## Blocking order

```
WAVE 1 — no gate:   D3 → D4 → D5
                    D7b            (independent of all three)

GATED:              D1 (Windows) ────┐
                                     ├──> D6 → D9 ──┐
                    D3–D5 ───────────┘              ├──> D8 → D10
                    D2 (multi-monitor) ──> D7 ──────┘
```

**D7b is wave 1** — outside the §0.7 gate entirely, and it does not even wait on
D3–D5. It is pure tree code in `src/lib/split-tree.ts`: no pointer behaviour, no
window API, nothing the Windows measurement can decide either way. It carries a
`D` number only because this section found the gap. The frontend section's
`adoptIntoActiveTab` is wave-1 work that cannot be written without it, so gating
it would block wave 1 on hardware nobody has — an artefact of numbering, not a
real dependency.

Read it as two gates and one pure track. D3–D5 need no gate. D6 and D9 touch
pointer behaviour, so they need **D1**. D7 and everything after it draw a
per-pane hit-test on a real screen, so they need **D1 and D2**. D3 Step 6
additionally consumes D1's and D2's recorded numbers.

- **D3, D4 and D5 are pure/unit-testable and may be written before D1 returns**,
  because they are geometry and arbitration with no pointer behaviour in them.
  **D6 onwards must not start until D1 has PASSED.** If D1 fails, the plan stops
  at that line and the fork goes back to the user.
- **D7 onwards must not start until D2 has PASSED**, because D7 is the first
  task where a per-pane hit-test result is drawn on a real second screen.
- Each code task below repeats its blocking line. Do not silently reorder them.

> **Deviation from the section brief — ACCEPTED by the lead.** The brief said
> the Windows measurement must land "before ANY drag implementation task
> starts". D3–D5 may be written while D1 waits on hardware, because those three
> tasks are pure geometry and arbitration needed under **every** branch of the
> §11.4 fork — including the native `SetCapture` branch — and Findings (e) shows
> the Windows machine is the most likely thing to stall Phase B for days.
> Nothing that touches a pointer, an overlay or a transfer runs before D1.

## Contract this section consumes (frozen — do not redesign)

Rust commands, owned by the transfer section:

```ts
prepare_transfer(paneId: string): Promise<string>            // token
stage_transfer(token: string, payload: AdoptionPayload): Promise<void>
claim_transfer(token: string): Promise<AdoptionPayload>
commit_transfer(token: string): Promise<void>
abort_transfer(token: string): Promise<void>
open_pane_window(args: {
  token: string;
  screenX?: number;        // CSS px, where the pane was dropped
  screenY?: number;        // Rust converts to physical. Pinned both sides.
}): Promise<string>        // resolves to the NEW WINDOW'S LABEL, not void

focus_order(): Promise<string[]>   // MRU roster, most recent first. READ-ONLY:
                                   // it never focuses or raises a window.
```

The transfer section also emits, to **both** the `from` and `to` window labels,
inside the lock section that finalises the route:

```ts
"transfer:settled" -> {
  token: string;
  outcome: "committed" | "aborted";
  reason?: string;       // distinguishes a refusal from a §7.5 timeout
}
```

Frontend modules, owned by other sections:

```ts
// src/terminal/pane-detach.ts  — source side
detachPaneForTransfer(paneId: number): Promise<{ token: string }>;
releaseDetachedPane(paneId: number): void;   // remove from layout, no kill_pty
abortDetach(token: string): Promise<void>;

// src/terminal/pane-adopt.ts  — destination side
adoptIntoActiveTab(args: {
  token: string;
  targetPaneId: number;    // pane already in this window, from the hit-test
  edge: Edge;              // from `edgeFor`
}): Promise<void>;         // live-adopt: claim → build → replay → commit
```

**Two quoting corrections** (a frozen block that misquotes the contract is worse
than no block): `prepare_transfer` takes a **String** pane id — that is §0.2's
shape and this section does not "fix" it; and `open_pane_window` resolves to the
**new window's label**, never `void`. This section calls `open_pane_window`
directly and now types it `Promise<string>`; it does not call `prepare_transfer`
directly, because `pane-detach.ts` wraps it and owns the number → string
conversion at the Rust boundary. My `DragTarget.paneId` stays `number` because
it comes from `PaneRect.id` (`src/lib/pane-geometry.ts:12`), which is a number.

`adoptIntoActiveTab` is the live-adopt entry point named in spec §10.1. The name
is the frontend section's and is now pinned; this section never calls it
directly — it sends `deck:drag-adopt` to the destination window, which calls it,
and then waits for Rust's `transfer:settled` rather than for a webview ack.

**Delta noticed:** the frozen contract has `stage_transfer(token, payload)`,
which spec §7.3's command table does not list. This section never calls it —
`pane-detach.ts` does — but the spec table should gain the row.

## Facts verified in the tree before writing this plan

| Fact                                                                                                         | Where                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `dropTargetAt` and `edgeFor` are pure: no DOM, no closure state, no module state                             | `src/terminal/pane-drag.ts:35-79`                                             |
| Overlay geometry is imperative inside the controller closure and not reusable yet                            | `src/terminal/pane-drag.ts:177-206`                                           |
| A drag cannot even start when the window holds one pane                                                      | `src/terminal/pane-drag.ts:118-120`                                           |
| Capture is taken on the tab container, not on `document`                                                     | `src/terminal/pane-drag.ts:142`                                               |
| `.drop-overlay` is `position: fixed`, `z-index: 999`, `pointer-events: none`                                 | `src/styles.css:1610-1622`                                                    |
| `.drop-overlay.is-swap` is the swap variant — cross-window drag never uses it                                | `src/styles.css:1626-1630`                                                    |
| Slot rects come from `getBoundingClientRect()` — CSS px, per window                                          | `src/terminal/layout-engine.ts:183-200`                                       |
| Drag controller is constructed once per `TerminalManager` with live callbacks                                | `src/terminal/terminal-manager.ts:482-492`                                    |
| Pane ids are allocated by Rust (`spawnShell` returns the id), so they are **process-global**, not per-window | `src/terminal/pty-client.ts:12-16`                                            |
| The cached-`scaleFactor` trap is already documented — and the file still caches                              | `src/terminal/file-drop.ts:15-18`                                             |
| `innerPosition()`, `innerSize()`, `scaleFactor()`, `onMoved`, `onResized`, `onScaleChanged` all exist        | `node_modules/@tauri-apps/api/window.d.ts:336,359,325,1232,1214,1321`         |
| `emit`, `emitTo`, `listen` are all exported                                                                  | `node_modules/@tauri-apps/api/event.d.ts:147`                                 |
| `getAllWebviewWindows()` exists                                                                              | `node_modules/@tauri-apps/api/webviewWindow.d.ts:17`                          |
| There is no `vitest.config.ts` and `vite.config.ts` declares no `test` block — default environment is `node` | `vite.config.ts` (whole file)                                                 |
| `windows-latest` CI jobs exist but are non-interactive                                                       | `.github/workflows/ci.yml:66,114`                                             |
| The one Windows artifact path refuses to run on a public repo, and `mxrsv/spacevibe-deck` **is public**      | `.github/workflows/ci.yml:118-125`; `gh repo view --json isPrivate` → `false` |

## Rules this section works under

- **R1 — English only** in every string, comment, test name and doc line.
- **R2** — no `docs/DESIGN-LANGUAGE.md` rule is changed here. The cross-window
  overlay reuses `.drop-overlay` exactly as authored. If a distinct
  cross-window affordance is wanted, that is a fork to raise, not to decide.
- **R5** — module stores are window-scoped. Each webview is its own JS realm, so
  `window-registry.ts` and `window-drag.ts` each get one instance per window and
  that is correct. What breaks under multi-window is any code that assumes the
  _only_ window is this one; see Findings (c).
- **Dirty working tree — RE-CHECK BEFORE YOU START.** HEAD is `289a12a`. The
  icon-system migration that used to dirty `src/styles.css` has **landed as
  commits**; that warning is dead. As of this writing the dirty set is another
  session's release-notes work, still in progress:
  `.github/workflows/release.yml`, `AGENTS.md`, `docs/ARCHITECTURE.md`,
  `docs/CONTEXT.md`, `marketing/landing-prototype/src/directions/a.js`,
  `scripts/release-workflow.test.ts`, plus untracked
  `scripts/generate-release-notes.{mjs,test.ts}`. None of those overlap this
  section's files, but that session is live, so run `git status` at execution
  time rather than trusting this list. Every step below that touches an existing
  file uses a targeted edit regardless. Never rewrite a whole file, never revert
  an unrelated hunk.
- No new dependency is added by this section. Adding one is a fork.
- `src/terminal/window-drag.ts` and `src/terminal/window-registry.ts` each stay
  inside the 200–400 line norm; the pure geometry lives in `window-registry.ts`
  from the start, exactly as spec §12 provides for.

---

### Task D1: GATE — re-run the §6 pointer-capture measurement on Windows

> **This is a MEASUREMENT, not code. It produces numbers, not a diff.**
> **Nothing in D6–D10 may be written until this returns PASS.**
> The plan does **not** pre-decide the outcome. Spec §11.4 is explicit that a
> failure is a fork for the user, not a problem for the implementer to route
> around.

**Why it is blocking:** every measurement in spec §6 was taken on macOS, on one
display, at `scaleFactor = 2`. Microsoft's WebView2 documentation indicates a
host may need native `SetCapture` to keep tracking the mouse outside the window.
If WebView2 severs the pointer stream at the window edge, the whole relay
protocol in D5–D8 has no input.

**Files:** none in the repo. The spike harness is throwaway and lives in the
session scratchpad (F4) — it is **never** committed.

#### Instrumentation to run

Reproduce the §6 harness inside a Windows build of this app and log to a file
that survives the drag (a `console` panel that loses focus is not evidence).

- [ ] **Step 1: Build a Windows binary that a human can drag.**
      The only artifact job is `windows-engineering-bundle`
      (`.github/workflows/ci.yml:111`), which is `workflow_dispatch` **and** throws
      when `github.event.repository.private != "true"`. `mxrsv/spacevibe-deck` is
      public today, so **this job cannot run as things stand.** Pick one, and record
      which:
      (a) run `npm run tauri dev` on a Windows machine directly;
      (b) run `npm run tauri build -- --no-bundle --ci` on a Windows machine and run
      the produced `.exe`;
      (c) temporarily use a private fork or mirror to let the artifact job run.
      A `windows-latest` GitHub runner **cannot** produce this measurement: it is
      non-interactive and has no human to move a mouse across a window edge.

- [ ] **Step 2: Add the probe to a scratch copy of `src/main.tsx`.**
      Verbatim, in a throwaway worktree — English comments, no repo edit:

```ts
// THROWAWAY spike probe — spec §11.4 Windows gate. Never commit this.
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ProbeRow {
  readonly t: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly inside: boolean;
  readonly type: string;
}

async function installCaptureProbe(): Promise<void> {
  const win = getCurrentWindow();
  const rows: ProbeRow[] = [];
  const surface = document.body;
  let capturing = false;
  let startedAt = 0;

  function record(event: PointerEvent): void {
    rows.push({
      t: performance.now() - startedAt,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      inside:
        event.clientX >= 0 &&
        event.clientY >= 0 &&
        event.clientX <= window.innerWidth &&
        event.clientY <= window.innerHeight,
      type: event.type,
    });
  }

  surface.addEventListener("pointerdown", (event) => {
    surface.setPointerCapture(event.pointerId);
    capturing = true;
    startedAt = performance.now();
    rows.length = 0;
    record(event);
  });
  surface.addEventListener("pointermove", (event) => {
    if (capturing) {
      record(event);
    }
  });
  surface.addEventListener("pointercancel", record);
  surface.addEventListener("lostpointercapture", (event) => {
    record(event as PointerEvent);
  });
  surface.addEventListener("pointerup", async (event) => {
    capturing = false;
    record(event);
    const outside = rows.filter((row) => !row.inside);
    const gaps = outside.slice(1).map((row, index) => row.t - outside[index].t);
    const scaleFactor = await win.scaleFactor();
    const innerPosition = await win.innerPosition();
    const outerPosition = await win.outerPosition();
    const innerSize = await win.innerSize();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          outsideMoves: outside.filter((row) => row.type === "pointermove")
            .length,
          msOutside:
            outside.length === 0
              ? 0
              : outside[outside.length - 1].t - outside[0].t,
          farthestOutsidePx: Math.max(
            0,
            ...outside.map((row) =>
              Math.max(
                -row.clientX,
                -row.clientY,
                row.clientX - window.innerWidth,
                row.clientY - window.innerHeight,
              ),
            ),
          ),
          longestGapMs: gaps.length === 0 ? 0 : Math.max(...gaps),
          pointerupOutside:
            rows[rows.length - 1] !== undefined &&
            !rows[rows.length - 1].inside,
          pointerupClientX: rows[rows.length - 1]?.clientX,
          pointercancelCount: rows.filter((row) => row.type === "pointercancel")
            .length,
          lostCaptureAtPointerup:
            rows.filter((row) => row.type === "lostpointercapture").length > 0,
          scaleFactor,
          innerPosition: { x: innerPosition.x, y: innerPosition.y },
          outerPosition: { x: outerPosition.x, y: outerPosition.y },
          innerSize: { width: innerSize.width, height: innerSize.height },
          userAgent: navigator.userAgent,
          probeSamples: rows
            .filter((row) => row.type === "pointermove")
            .filter((_row, index) => index % 40 === 0)
            .slice(0, 4),
        },
        null,
        2,
      ),
    );
  });
}

void installCaptureProbe();
```

- [ ] **Step 3: Run the drag, twice, and record every number.**
      Run 1: a short excursion just past the window edge (the §6 "Run 1" shape).
      Run 2: press inside the window, drag across another application's window,
      keep moving there for **at least 5 seconds**, travel at least 800 px outside,
      then release **while still outside**.

- [ ] **Step 4: Fill in this table.** Same columns as spec §6, plus the four
      rows the macOS spike did not need:

| Measurement                                                         | Run 1 | Run 2 |
| ------------------------------------------------------------------- | ----- | ----- |
| `pointermove` delivered outside the window                          |       |       |
| Time spent outside (ms)                                             |       |       |
| Farthest distance outside (px)                                      |       |       |
| Longest gap between outside moves (ms)                              |       |       |
| `pointerup` delivered while outside (yes/no, `clientX`)             |       |       |
| `pointercancel` count                                               |       |       |
| `lostpointercapture` fired at the same timestamp as `pointerup`     |       |       |
| `scaleFactor`                                                       |       |       |
| `innerPosition` (physical px)                                       |       |       |
| `outerPosition` (physical px)                                       |       |       |
| `innerSize` (physical px)                                           |       |       |
| Windows build (`winver`)                                            |       |       |
| WebView2 runtime version (Apps → _Microsoft Edge WebView2 Runtime_) |       |       |

`innerPosition` and `outerPosition` are recorded **separately** here on
purpose. Spec §6 notes they are identical on macOS because Deck draws its own
titlebar; that observation does not transfer, and if Windows reports different
values then `innerPosition` — the one the D3 formula uses — is the correct one
and this measurement is what proves it.

- [ ] **Step 5: Coordinate residual check at two positions.**
      With the window at two clearly different screen positions (move it at least
      600 px between probes), take one `probeSamples` row from each and compute:

```
residual = clientX − (screenX − innerPosition.x / scaleFactor)
```

Record both residuals. Record the value the wrong formula
`(screenX − innerPosition.x) / scaleFactor` produces at the same two points,
so the numbers show that the two formulas genuinely differ on this machine.

#### Pass criterion — all seven must hold in Run 2

1. `pointermove` continues to be delivered while the cursor is outside the
   window, over an excursion of **at least 5 000 ms**.
2. Farthest distance outside is **at least 800 px**.
3. **Zero** `pointercancel` events.
4. `pointerup` is delivered while the cursor is outside, and its `clientX` or
   `clientY` is outside the window box.
5. Longest gap between consecutive outside `pointermove` events is
   **≤ 150 ms** (spec §6 measured 96 ms on macOS; anything in that band is
   ordinary mouse cadence, not a severed stream).
6. `lostpointercapture` fires at `pointerup`, not before it.
7. Both coordinate residuals are **0** (integer equality; not "close").

#### On FAILURE — stop

Do not implement a workaround. Do not start D6. Write down which of the seven
criteria failed with its number, then return the fork to the user with the three
options spec §11.4 names, verbatim and undecided:

- native `SetCapture` in Rust;
- dropping cross-window drag from v1;
- macOS-only drag with menu-command parity on Windows, which would match Deck's
  existing platform asymmetry.

**Record the outcome in `AGENTS.md`'s "In flight" list in the same task**, pass
or fail, with the numbers. An unrecorded gate result is the same as no gate.

---

### Task D2: GATE — multi-monitor and mixed-DPI coordinate measurement

> **A MEASUREMENT, not code. Blocks D7 and everything after it.**
> Spec §11.3 states this is unverified and requires a measurement step on a
> second display at a different scale factor _before the per-pane hit-test
> ships_. D7 is that hit-test.

**Why it is blocking separately from D1:** D1 asks whether pointer events keep
arriving. D2 asks whether the coordinate formula still lands on the right pixel
when two windows live on displays with different scale factors, and whether
`onScaleChanged` actually fires when a window is dragged between them. These are
independent, and D2 can be run on macOS while D1 waits for a Windows machine.

**Hardware required:** two displays with **different** scale factors — for
example a Retina panel at `scaleFactor = 2` plus an external 1080p panel at
`scaleFactor = 1`. Two panels at the same scale factor do **not** satisfy this
gate; the whole point is the mixed case.

**Files:** none in the repo. Reuse the D1 scratch probe with the addition below.

- [ ] **Step 1: Extend the D1 scratch probe with a live bounds log.** Verbatim:

```ts
// THROWAWAY spike probe — spec §11.3 multi-monitor gate. Never commit this.
import { getCurrentWindow } from "@tauri-apps/api/window";

async function installBoundsProbe(): Promise<void> {
  const win = getCurrentWindow();

  async function snapshot(reason: string): Promise<void> {
    const scaleFactor = await win.scaleFactor();
    const innerPosition = await win.innerPosition();
    const innerSize = await win.innerSize();
    // eslint-disable-next-line no-console
    console.log(
      `[bounds] ${reason} label=${win.label} scale=${scaleFactor} ` +
        `inner=(${innerPosition.x},${innerPosition.y}) ` +
        `size=(${innerSize.width}x${innerSize.height})`,
    );
  }

  await snapshot("initial");
  await win.onMoved(() => void snapshot("moved"));
  await win.onResized(() => void snapshot("resized"));
  await win.onScaleChanged((event) => {
    void snapshot(`scaleChanged=${event.payload.scaleFactor}`);
  });
}

void installBoundsProbe();
```

- [ ] **Step 2: Open one Deck window on each display.** Note each window's
      label, `scaleFactor`, `innerPosition` and `innerSize`.

- [ ] **Step 3: Probe the conversion on the low-DPI display.** Press and drag
      inside the window on the second display and take two `probeSamples` rows at
      positions at least 400 px apart. Compute the residual with the D1 Step 5
      formula. Record both.
      **Keep the raw rows** — D3 Step 6 rebuilds its test fixture from them, and
      a residual alone is not enough to do that. Log the full
      `(screenX, screenY, clientX, clientY)` tuple for each probe together with
      that window's `innerPosition`, `innerSize` and `scaleFactor`.

- [ ] **Step 4: Cross the boundary while dragging.** Start a drag in the window
      on display A, move the cursor onto display B, and record whether the `screenX`
      values continue increasing monotonically across the seam or jump — and whether
      `screenX` is expressed in the **source** window's CSS pixels or the
      destination display's.

- [ ] **Step 5: Drag a whole window between displays** and record whether
      `onScaleChanged` fired, with which value, and whether `onMoved` fired as well.

- [ ] **Step 6: Fill in this table.**

| Measurement                                                            | Display A | Display B |
| ---------------------------------------------------------------------- | --------- | --------- |
| `scaleFactor`                                                          |           |           |
| Window `innerPosition` (physical px)                                   |           |           |
| Window `innerSize` (physical px)                                       |           |           |
| Residual at probe position 1                                           |           |           |
| Residual at probe position 2                                           |           |           |
| `screenX` continuous across the display seam (yes/no)                  | —         |           |
| `onScaleChanged` fired on window move between displays (yes/no, value) | —         |           |
| `onMoved` fired on the same move (yes/no)                              | —         |           |

#### Pass criterion — all four must hold

1. Residual is **0** at both probe positions on the **second** display, using
   that window's own `scaleFactor` — not the first window's.
2. `screenX` / `screenY` are continuous across the display seam: no jump larger
   than ordinary mouse travel between two consecutive `pointermove` events.
3. `onScaleChanged` fires when a window moves to a display with a different
   scale factor, and reports the new value.
4. `onMoved` fires on the same move, so the registry can refresh its origin.

#### On FAILURE

- Criterion 1 fails → the formula is display-dependent. **Stop**; the conversion
  is not solved and D3's function is wrong. Fork to the user.
- Criterion 2 fails → the relay cannot use a single screen coordinate space.
  **Stop**; fork to the user.
- Criterion 3 or 4 fails → the registry cannot be event-driven. Fall back to
  re-reading bounds at `pointerdown` **and** on every relay frame that finds no
  containing window — record the extra IPC cost, and note it as a stated
  limitation rather than a silent workaround.

Record the outcome in `AGENTS.md`'s "In flight" list in the same task.

---

### Task D3: The pure screen → client coordinate conversion

> **Blocked on:** nothing. Safe to write before D1 returns — it is arithmetic.
> Its correctness on a second display is what D2 criterion 1 confirms.

**Files:**

- Create: `src/terminal/window-registry.ts`
- Test: `src/terminal/window-registry.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface ScreenPoint { readonly screenX: number; readonly screenY: number }`
  - `interface ClientPoint { readonly clientX: number; readonly clientY: number }`
  - `interface WindowBounds { readonly label: string; readonly innerX: number; readonly innerY: number; readonly innerWidth: number; readonly innerHeight: number; readonly scaleFactor: number }`
  - `toClientPoint(point: ScreenPoint, bounds: WindowOrigin): ClientPoint`
  - `containsScreenPoint(bounds: WindowBounds, point: ScreenPoint): boolean`

- [ ] **Step 1: Write the failing test**

`src/terminal/window-registry.test.ts` — no jsdom pragma; this file is pure and
runs in the default `node` environment.

```ts
import { describe, expect, it } from "vitest";
import {
  containsScreenPoint,
  toClientPoint,
  type WindowBounds,
} from "./window-registry";

/**
 * Spec §6 recorded the source window at innerPosition (820, 226) with
 * scaleFactor 2, and a pointerup delivered outside at clientX = -227.
 * The screen coordinate below is RECONSTRUCTED from those two published
 * numbers — §6 does not print the raw sample pairs. It is still a valid
 * regression anchor and a genuine discriminator between the two formulas.
 */
const SPIKE: WindowBounds = {
  label: "main",
  innerX: 820,
  innerY: 226,
  innerWidth: 2400,
  innerHeight: 1500,
  scaleFactor: 2,
};

describe("toClientPoint", () => {
  it("divides the inner position before subtracting it", () => {
    expect(toClientPoint({ screenX: 183, screenY: 300 }, SPIKE)).toEqual({
      clientX: -227,
      clientY: 187,
    });
  });

  it("does not match the formula that subtracts before dividing", () => {
    // (screenX - innerX) / scale = (183 - 820) / 2 = -318.5, and
    // (screenY - innerY) / scale = (300 - 226) / 2 = 37.
    // If either of these ever equals the result, the wrong formula shipped.
    const wrong = {
      clientX: (183 - SPIKE.innerX) / SPIKE.scaleFactor,
      clientY: (300 - SPIKE.innerY) / SPIKE.scaleFactor,
    };
    expect(wrong).toEqual({ clientX: -318.5, clientY: 37 });
    expect(toClientPoint({ screenX: 183, screenY: 300 }, SPIKE)).not.toEqual(
      wrong,
    );
  });

  it("uses a fractional scale factor without rounding", () => {
    // Algebraic case at the common Windows 125% factor. Confirmed against real
    // hardware by gate D2, not by this test.
    const bounds: WindowBounds = {
      label: "deck-1",
      innerX: 100,
      innerY: 250,
      innerWidth: 1600,
      innerHeight: 1000,
      scaleFactor: 1.25,
    };
    expect(toClientPoint({ screenX: 500, screenY: 400 }, bounds)).toEqual({
      clientX: 420,
      clientY: 200,
    });
    // The wrong formula would give (500 - 100) / 1.25 = 320, not 420.
  });

  it("is degenerate at scaleFactor 1, which is why a 1x-only test is worthless", () => {
    const bounds: WindowBounds = {
      label: "deck-2",
      innerX: 300,
      innerY: 300,
      innerWidth: 800,
      innerHeight: 600,
      scaleFactor: 1,
    };
    const correct = toClientPoint({ screenX: 500, screenY: 500 }, bounds);
    const wrong = {
      clientX: (500 - bounds.innerX) / bounds.scaleFactor,
      clientY: (500 - bounds.innerY) / bounds.scaleFactor,
    };
    expect(correct).toEqual(wrong);
  });
});

describe("containsScreenPoint", () => {
  it("accepts a point inside the window box in CSS pixels", () => {
    // CSS box is 1200 x 750 starting at CSS origin (410, 113).
    expect(containsScreenPoint(SPIKE, { screenX: 500, screenY: 400 })).toBe(
      true,
    );
  });

  it("rejects a point left of the window", () => {
    expect(containsScreenPoint(SPIKE, { screenX: 183, screenY: 400 })).toBe(
      false,
    );
  });

  it("rejects a point past the right edge measured in CSS pixels", () => {
    // Right edge = 410 + 2400 / 2 = 1610.
    expect(containsScreenPoint(SPIKE, { screenX: 1611, screenY: 400 })).toBe(
      false,
    );
    expect(containsScreenPoint(SPIKE, { screenX: 1610, screenY: 400 })).toBe(
      true,
    );
  });

  it("rejects a point below the bottom edge measured in CSS pixels", () => {
    // Bottom edge = 113 + 1500 / 2 = 863.
    expect(containsScreenPoint(SPIKE, { screenX: 500, screenY: 864 })).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-registry.test.ts`

Expected: FAIL — `Failed to resolve import "./window-registry"` (the module does
not exist yet). Every test in the file errors at collection, which is the right
red phase for a brand-new module.

- [ ] **Step 3: Implement the pure conversion**

`src/terminal/window-registry.ts`:

```ts
/**
 * Deck windows and their live bounds, plus the pure screen -> client
 * coordinate conversion cross-window drag depends on (spec §11.1, §11.3).
 *
 * Bounds are NEVER cached across a drag. `src/terminal/file-drop.ts:15`
 * documents the same trap from the other side: it caches `scaleFactor` once
 * and its own comment records that the value drifts when the window moves to a
 * monitor with a different scale factor. This module refreshes instead.
 */

/** A point in screen space. CSS pixels — the unit `PointerEvent.screenX` uses. */
export interface ScreenPoint {
  readonly screenX: number;
  readonly screenY: number;
}

/** A point in one window's viewport. CSS pixels — same origin as `clientX`. */
export interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/** The part of a window's bounds the conversion needs. */
export interface WindowOrigin {
  /** `innerPosition().x` — PHYSICAL pixels. */
  readonly innerX: number;
  /** `innerPosition().y` — PHYSICAL pixels. */
  readonly innerY: number;
  readonly scaleFactor: number;
}

/** One Deck window's live geometry. */
export interface WindowBounds extends WindowOrigin {
  readonly label: string;
  /** `innerSize().width` — PHYSICAL pixels. */
  readonly innerWidth: number;
  /** `innerSize().height` — PHYSICAL pixels. */
  readonly innerHeight: number;
}

/**
 * Screen (CSS px) -> client (CSS px) for one window. Pure.
 *
 * Measured in the spec §6 spike with residual exactly 0 at two positions:
 *
 *     clientX = screenX - innerPosition.x / scaleFactor
 *
 * The division binds tighter than the subtraction and that is not a
 * simplification: `innerPosition()` reports PHYSICAL pixels while `screenX` is
 * already CSS pixels, so only the origin is converted. Writing
 * `(screenX - innerX) / scaleFactor` converts a quantity that was never
 * physical and produces a different number at every scale factor except 1.
 */
export function toClientPoint(
  point: ScreenPoint,
  bounds: WindowOrigin,
): ClientPoint {
  return {
    clientX: point.screenX - bounds.innerX / bounds.scaleFactor,
    clientY: point.screenY - bounds.innerY / bounds.scaleFactor,
  };
}

/** Whether a screen point falls inside a window's viewport box. Pure. */
export function containsScreenPoint(
  bounds: WindowBounds,
  point: ScreenPoint,
): boolean {
  const { clientX, clientY } = toClientPoint(point, bounds);
  return (
    clientX >= 0 &&
    clientY >= 0 &&
    clientX <= bounds.innerWidth / bounds.scaleFactor &&
    clientY <= bounds.innerHeight / bounds.scaleFactor
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/window-registry.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/window-registry.ts src/terminal/window-registry.test.ts
git commit -m "feat(terminal): add pure screen-to-client window coordinate conversion"
```

- [ ] **Step 6: Replace the reconstructed sample with measured data (after D2)**

The `SPIKE` fixture above is **reconstructed** from §6's published window origin
and its one recorded `pointerup` value, because §6 does not print the two raw
`(screenX, clientX)` pairs. Checking a formula against numbers derived from that
same formula proves only that the arithmetic is self-consistent — which is the
defect this step closes with data.

D1 Step 5 and D2 Step 3 each probe two positions. When they run, take the raw
`probeSamples` rows they log and:

1. Replace `SPIKE` with the **measured** window origin, scale factor and inner
   size from D2's Display A.
2. Replace the two `screenX`/`clientX` pairs in _"divides the inner position
   before subtracting it"_ with two measured rows at least 400 px apart, and
   take the expected `clientX` / `clientY` from the **recorded** values, not
   from the formula.
3. Add one measured case from **Display B** at its own scale factor, beside the
   algebraic `1.25` case (or replacing it, if B happens to be at 1.25).
4. Update the comment block so it reads _measured on `<date>`, Display A/B_ and
   no longer says _reconstructed_.
5. Re-run `npx vitest run src/terminal/window-registry.test.ts`. If a measured
   pair does **not** produce a residual of 0, that is D2 criterion 1 failing —
   stop and fork. Do not adjust the expected values to match.

Until this step runs, the D3 tests are a regression lock and a formula
discriminator, not evidence.

---

### Task D4: The live window registry — refreshed, never cached

> **Blocked on:** D3. Not on D1 — this task reads bounds, it does not drag.
> **D2 criteria 3 and 4** decide whether the event-driven refresh below is
> sufficient or whether the Step 3 fallback note applies.

**Files:**

- Modify: `src/terminal/window-registry.ts` (append below the pure section)
- Modify: `src/terminal/window-registry.test.ts` (append a new `describe`)

**Interfaces:**

- Consumes:
  - `getCurrentWindow(): Window` from `@tauri-apps/api/window`
  - `Window.scaleFactor(): Promise<number>`, `.innerPosition(): Promise<PhysicalPosition>`, `.innerSize(): Promise<PhysicalSize>`, `.onMoved(cb)`, `.onResized(cb)`, `.onScaleChanged(cb)`
- Produces:
  - `interface WindowBoundsSource { scaleFactor(): Promise<number>; innerPosition(): Promise<{ x: number; y: number }>; innerSize(): Promise<{ width: number; height: number }>; onMoved(cb: () => void): Promise<() => void>; onResized(cb: () => void): Promise<() => void>; onScaleChanged(cb: () => void): Promise<() => void>; readonly label: string }`
  - `interface LocalWindowRegistry { bounds(): WindowBounds | null; refresh(): Promise<WindowBounds>; dispose(): void }`
  - `createLocalWindowRegistry(source: WindowBoundsSource): Promise<LocalWindowRegistry>`

The registry is deliberately **local**: it tracks _this_ window's bounds only.
Cross-window hit-testing is decided by each window replying about itself
(D7), not by one window holding a map of everyone else's geometry — a map is
exactly the cached-bounds trap this module exists to avoid.

- [ ] **Step 1: Write the failing test**

Extend `src/terminal/window-registry.test.ts`. A second `import` statement from
the same module is legal — only a duplicate *binding* is an error, and appending
`import { describe, expect, it, vi } from "vitest"` under the existing
`import { describe, expect, it } from "vitest"` would redeclare `describe`,
`expect` and `it`. Avoid that by editing the two existing import statements in
place rather than adding new ones:

```ts
// existing line 1 — add `vi`
import { describe, expect, it, vi } from "vitest";
// existing import — add the two new names
import {
  containsScreenPoint,
  createLocalWindowRegistry,
  toClientPoint,
  type WindowBounds,
  type WindowBoundsSource,
} from "./window-registry";
```

Then append the rest at the end of the file:

```ts
interface FakeSource extends WindowBoundsSource {
  fireMoved(): void;
  fireResized(): void;
  fireScaleChanged(): void;
  reads: number;
  next: {
    scaleFactor: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

function createFakeSource(): FakeSource {
  const listeners: Record<string, Array<() => void>> = {
    moved: [],
    resized: [],
    scaleChanged: [],
  };
  const fake: FakeSource = {
    label: "deck-1",
    reads: 0,
    next: { scaleFactor: 2, x: 820, y: 226, width: 2400, height: 1500 },
    async scaleFactor() {
      fake.reads += 1;
      return fake.next.scaleFactor;
    },
    async innerPosition() {
      return { x: fake.next.x, y: fake.next.y };
    },
    async innerSize() {
      return { width: fake.next.width, height: fake.next.height };
    },
    async onMoved(cb) {
      listeners.moved.push(cb);
      return () => {
        listeners.moved = listeners.moved.filter((entry) => entry !== cb);
      };
    },
    async onResized(cb) {
      listeners.resized.push(cb);
      return () => {
        listeners.resized = listeners.resized.filter((entry) => entry !== cb);
      };
    },
    async onScaleChanged(cb) {
      listeners.scaleChanged.push(cb);
      return () => {
        listeners.scaleChanged = listeners.scaleChanged.filter(
          (entry) => entry !== cb,
        );
      };
    },
    fireMoved() {
      for (const cb of listeners.moved) {
        cb();
      }
    },
    fireResized() {
      for (const cb of listeners.resized) {
        cb();
      }
    },
    fireScaleChanged() {
      for (const cb of listeners.scaleChanged) {
        cb();
      }
    },
  };
  return fake;
}

/** Let the registry's own promise chain settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createLocalWindowRegistry", () => {
  it("reads bounds once at construction", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    expect(registry.bounds()).toEqual({
      label: "deck-1",
      innerX: 820,
      innerY: 226,
      innerWidth: 2400,
      innerHeight: 1500,
      scaleFactor: 2,
    });
    registry.dispose();
  });

  it("refreshes after the window moves — it does not serve the old origin", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    source.next = { scaleFactor: 2, x: 40, y: 60, width: 2400, height: 1500 };
    source.fireMoved();
    await settle();
    expect(registry.bounds()?.innerX).toBe(40);
    registry.dispose();
  });

  it("refreshes after a scale-factor change — the file-drop.ts:15 trap", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    source.next = { scaleFactor: 1, x: 820, y: 226, width: 1200, height: 750 };
    source.fireScaleChanged();
    await settle();
    expect(registry.bounds()?.scaleFactor).toBe(1);
    registry.dispose();
  });

  it("refreshes after a resize", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    source.next = { scaleFactor: 2, x: 820, y: 226, width: 800, height: 600 };
    source.fireResized();
    await settle();
    expect(registry.bounds()?.innerWidth).toBe(800);
    registry.dispose();
  });

  it("stops listening after dispose", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    const before = source.reads;
    registry.dispose();
    source.fireMoved();
    await settle();
    expect(source.reads).toBe(before);
  });

  it("keeps the last good bounds when a refresh throws", async () => {
    const source = createFakeSource();
    const registry = await createLocalWindowRegistry(source);
    const failing = vi
      .spyOn(source, "scaleFactor")
      .mockRejectedValueOnce(new Error("ipc closed"));
    source.fireMoved();
    await settle();
    expect(registry.bounds()?.innerX).toBe(820);
    failing.mockRestore();
    registry.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-registry.test.ts`
Expected: FAIL — `createLocalWindowRegistry is not a function` (the D3 module
exports only the pure helpers), reported for all six new tests while the eight
D3 tests still pass.

- [ ] **Step 3: Implement the registry**

Append to `src/terminal/window-registry.ts`:

```ts
/** The `@tauri-apps/api` window surface this registry needs. Injectable for tests. */
export interface WindowBoundsSource {
  readonly label: string;
  scaleFactor(): Promise<number>;
  innerPosition(): Promise<{ x: number; y: number }>;
  innerSize(): Promise<{ width: number; height: number }>;
  onMoved(handler: () => void): Promise<() => void>;
  onResized(handler: () => void): Promise<() => void>;
  onScaleChanged(handler: () => void): Promise<() => void>;
}

export interface LocalWindowRegistry {
  /** Last read bounds, or null before the first read completed. */
  bounds(): WindowBounds | null;
  /** Force a read. Returns the fresh bounds. */
  refresh(): Promise<WindowBounds>;
  dispose(): void;
}

/**
 * Track THIS window's bounds, refreshed on move, resize and scale-factor
 * change (spec §11.3). Never cached across those events: a drag started on a
 * 2x display and finished on a 1x one converts with the wrong origin
 * otherwise, which is the drift `file-drop.ts:15` already documents.
 */
export async function createLocalWindowRegistry(
  source: WindowBoundsSource,
): Promise<LocalWindowRegistry> {
  let current: WindowBounds | null = null;
  let disposed = false;
  const unlisteners: Array<() => void> = [];

  async function read(): Promise<WindowBounds> {
    const [scaleFactor, position, size] = await Promise.all([
      source.scaleFactor(),
      source.innerPosition(),
      source.innerSize(),
    ]);
    const next: WindowBounds = {
      label: source.label,
      innerX: position.x,
      innerY: position.y,
      innerWidth: size.width,
      innerHeight: size.height,
      scaleFactor,
    };
    current = next;
    return next;
  }

  function scheduleRefresh(): void {
    if (disposed) {
      return;
    }
    // A failed read must not clear the last good bounds: a drag in flight is
    // better served by a slightly stale origin than by no origin at all.
    void read().catch((error: unknown) => {
      console.warn("window-registry: bounds refresh failed", error);
    });
  }

  await read();
  unlisteners.push(
    await source.onMoved(scheduleRefresh),
    await source.onResized(scheduleRefresh),
    await source.onScaleChanged(scheduleRefresh),
  );

  return {
    bounds: () => current,
    refresh: read,
    dispose(): void {
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
      unlisteners.length = 0;
    },
  };
}
```

The `console.warn` is the one place this section logs. The repo's TypeScript
style bans `console.log` in production code; a swallowed bounds failure would be
a silent wrong-pixel bug, so it is surfaced (C5). If the reviewer prefers the
existing error-bar surface, that is a one-line change, not a redesign.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/window-registry.test.ts`
Expected: 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/window-registry.ts src/terminal/window-registry.test.ts
git commit -m "feat(terminal): track live window bounds without caching them"
```

---

### Task D5: Drag session — id, frame throttle and reply arbitration

> **Blocked on:** D3. Pure logic; may be written before D1 returns.

**Files:**

- Create: `src/terminal/window-drag.ts`
- Test: `src/terminal/window-drag.test.ts`

**Interfaces:**

- Consumes: `Edge` from `src/lib/split-tree.ts`
- Produces:
  - `interface DragFrame { readonly dragId: string; readonly seq: number; readonly sourceLabel: string; readonly screenX: number; readonly screenY: number }`
  - `interface DragEndFrame { readonly dragId: string; readonly sourceLabel: string }`
  - `interface DragTarget { readonly label: string; readonly paneId: number; readonly edge: Edge }`
  - `interface DragReply { readonly dragId: string; readonly seq: number; readonly target: DragTarget | null }`
  - `interface DropArbiter { begin(dragId: string): void; accept(reply: DragReply): boolean; current(): DragTarget | null; clear(): void }`
  - `createDropArbiter(focusOrder: () => readonly string[]): DropArbiter`
  - `createFrameThrottle(intervalMs: number, now: () => number): () => boolean`
  - `const RELAY_INTERVAL_MS = 16`

**Arbitration rule, decided in this plan (spec §11.1 does not state one):** when
two windows both accept the same frame — overlapping windows, or a window
straddling another — the **most recently focused** window wins. Rationale: it is
the window the user last interacted with, so it is the one they are most likely
to be looking at, and §11.2 forbids raising the destination to disambiguate
visually. Listed in Findings (c) as a gap closed here.

- [ ] **Step 1: Write the failing test**

`src/terminal/window-drag.test.ts` — pure, no jsdom pragma.

```ts
import { describe, expect, it } from "vitest";
import {
  createDropArbiter,
  createFrameThrottle,
  RELAY_INTERVAL_MS,
  type DragReply,
} from "./window-drag";

function reply(
  dragId: string,
  seq: number,
  label: string | null,
  paneId = 7,
): DragReply {
  return {
    dragId,
    seq,
    target: label === null ? null : { label, paneId, edge: "left" },
  };
}

describe("createFrameThrottle", () => {
  it("relays at roughly 60 Hz", () => {
    expect(RELAY_INTERVAL_MS).toBe(16);
  });

  it("passes the first call and blocks one inside the interval", () => {
    let clock = 1000;
    const gate = createFrameThrottle(RELAY_INTERVAL_MS, () => clock);
    expect(gate()).toBe(true);
    clock = 1010;
    expect(gate()).toBe(false);
    clock = 1016;
    expect(gate()).toBe(true);
  });

  it("does not drift: the interval is measured from the last pass", () => {
    let clock = 0;
    const gate = createFrameThrottle(RELAY_INTERVAL_MS, () => clock);
    expect(gate()).toBe(true);
    clock = 100;
    expect(gate()).toBe(true);
    clock = 110;
    expect(gate()).toBe(false);
  });
});

describe("createDropArbiter", () => {
  it("has no target before any reply", () => {
    const arbiter = createDropArbiter(() => ["main"]);
    arbiter.begin("drag-1");
    expect(arbiter.current()).toBeNull();
  });

  it("accepts a reply for the active drag", () => {
    const arbiter = createDropArbiter(() => ["main"]);
    arbiter.begin("drag-1");
    expect(arbiter.accept(reply("drag-1", 1, "deck-1"))).toBe(true);
    expect(arbiter.current()).toEqual({
      label: "deck-1",
      paneId: 7,
      edge: "left",
    });
  });

  it("rejects a late reply carrying a previous drag id", () => {
    const arbiter = createDropArbiter(() => ["main"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 1, "deck-1"));
    arbiter.begin("drag-2");
    expect(arbiter.accept(reply("drag-1", 99, "deck-9"))).toBe(false);
    expect(arbiter.current()).toBeNull();
  });

  it("rejects an out-of-order frame from the same drag", () => {
    const arbiter = createDropArbiter(() => ["main"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 5, "deck-1"));
    expect(arbiter.accept(reply("drag-1", 4, "deck-2"))).toBe(false);
    expect(arbiter.current()?.label).toBe("deck-1");
  });

  it("lets a newer frame clear the target when no window accepts it", () => {
    const arbiter = createDropArbiter(() => ["main"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 1, "deck-1"));
    expect(arbiter.accept(reply("drag-1", 2, null))).toBe(true);
    expect(arbiter.current()).toBeNull();
  });

  it("prefers a real target over a null one within the same frame", () => {
    const arbiter = createDropArbiter(() => ["main", "deck-1"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 3, null));
    expect(arbiter.accept(reply("drag-1", 3, "deck-1"))).toBe(true);
    expect(arbiter.current()?.label).toBe("deck-1");
  });

  it("breaks a same-frame tie by most recently focused window", () => {
    // Focus order is most-recent-first.
    const arbiter = createDropArbiter(() => ["deck-2", "deck-1"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 3, "deck-1"));
    expect(arbiter.accept(reply("drag-1", 3, "deck-2"))).toBe(true);
    expect(arbiter.current()?.label).toBe("deck-2");
  });

  it("keeps the incumbent when the challenger is focused further back", () => {
    const arbiter = createDropArbiter(() => ["deck-1", "deck-2"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 3, "deck-1"));
    expect(arbiter.accept(reply("drag-1", 3, "deck-2"))).toBe(false);
    expect(arbiter.current()?.label).toBe("deck-1");
  });

  it("ranks an unknown label last rather than crashing", () => {
    const arbiter = createDropArbiter(() => ["deck-1"]);
    arbiter.begin("drag-1");
    arbiter.accept(reply("drag-1", 3, "deck-1"));
    expect(arbiter.accept(reply("drag-1", 3, "deck-unknown"))).toBe(false);
    expect(arbiter.current()?.label).toBe("deck-1");
  });

  it("drops every reply after clear", () => {
    const arbiter = createDropArbiter(() => ["deck-1"]);
    arbiter.begin("drag-1");
    arbiter.clear();
    expect(arbiter.accept(reply("drag-1", 1, "deck-1"))).toBe(false);
    expect(arbiter.current()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-drag.test.ts`
Expected: FAIL — `Failed to resolve import "./window-drag"`, all tests erroring
at collection.

- [ ] **Step 3: Implement the session core**

`src/terminal/window-drag.ts`:

```ts
import type { Edge } from "../lib/split-tree";

/**
 * Cross-window pane drag (spec §11). Pointer capture never leaves the source
 * window, so the source relays screen coordinates and every window replies
 * about its own geometry. This file owns the relay protocol types, the
 * throttle and the reply arbitration; the pure coordinate maths lives in
 * `window-registry.ts`.
 */

/** ~60 Hz. The spike measured about 46 pointermove events per second. */
export const RELAY_INTERVAL_MS = 16;

/** One relayed cursor position, broadcast to every Deck window. */
export interface DragFrame {
  readonly dragId: string;
  /** Monotonic within one drag. Orders replies without a clock. */
  readonly seq: number;
  readonly sourceLabel: string;
  /** Screen space, CSS pixels — `PointerEvent.screenX`. */
  readonly screenX: number;
  readonly screenY: number;
}

/**
 * Sent once when a drag stops, for ANY reason — dropped, cancelled with
 * Escape, pointer cancelled, or the cursor returning to the source window.
 * Without it a destination that drew an overlay never hears that the drag is
 * over and leaves it on screen forever.
 */
export interface DragEndFrame {
  readonly dragId: string;
  readonly sourceLabel: string;
}

/** A pane in some window that accepted a frame, and the edge to dock on. */
export interface DragTarget {
  readonly label: string;
  /** Pane ids are allocated by Rust, so they are unique across windows. */
  readonly paneId: number;
  readonly edge: Edge;
}

/** One window's answer to one frame. `null` means "not over me". */
export interface DragReply {
  readonly dragId: string;
  readonly seq: number;
  readonly target: DragTarget | null;
}

export interface DropArbiter {
  begin(dragId: string): void;
  /** True when the reply became the accepted target. */
  accept(reply: DragReply): boolean;
  current(): DragTarget | null;
  clear(): void;
}

/**
 * Decide which reply wins. Guarantees:
 * - a reply from a previous drag can never win at `pointerup`;
 * - an out-of-order frame can never overwrite a newer one;
 * - within one frame a real target beats "not over me", and when two windows
 *   both accept, the most recently focused one wins (§11.2 forbids raising the
 *   destination, so there is no visual tiebreak to fall back on).
 */
export function createDropArbiter(
  focusOrder: () => readonly string[],
): DropArbiter {
  let dragId: string | null = null;
  let acceptedSeq = -1;
  let accepted: DragTarget | null = null;

  function rank(label: string): number {
    const index = focusOrder().indexOf(label);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  return {
    begin(id: string): void {
      dragId = id;
      acceptedSeq = -1;
      accepted = null;
    },
    accept(reply: DragReply): boolean {
      if (dragId === null || reply.dragId !== dragId) {
        return false;
      }
      if (reply.seq < acceptedSeq) {
        return false;
      }
      if (reply.seq > acceptedSeq) {
        acceptedSeq = reply.seq;
        accepted = reply.target;
        return true;
      }
      if (reply.target === null) {
        return false;
      }
      if (accepted === null) {
        accepted = reply.target;
        return true;
      }
      if (rank(reply.target.label) < rank(accepted.label)) {
        accepted = reply.target;
        return true;
      }
      return false;
    },
    current: () => accepted,
    clear(): void {
      dragId = null;
      acceptedSeq = -1;
      accepted = null;
    },
  };
}

/**
 * Rate gate for the relay. Returns true when a frame may be emitted. The
 * interval is measured from the last pass, so a burst of moves cannot
 * accumulate credit.
 */
export function createFrameThrottle(
  intervalMs: number,
  now: () => number,
): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return function shouldEmit(): boolean {
    const time = now();
    if (time - last < intervalMs) {
      return false;
    }
    last = time;
    return true;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/window-drag.test.ts`
Expected: 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/window-drag.ts src/terminal/window-drag.test.ts
git commit -m "feat(terminal): add cross-window drag relay protocol and arbitration"
```

---

### Task D6: Source side — detect leaving the window and relay screen coordinates

> **BLOCKED ON D1 PASSING. Do not start this task until the Windows gate has
> returned PASS and the result is written into `AGENTS.md`.**

**Files:**

- Modify: `src/terminal/pane-drag.ts:9-20` (options interface), `:118-120`
  (deferred to D9 — leave it alone here), `:214-232` (`onPointerMove`),
  `:234-249` (`onPointerUp`), `:252-257` (`onPointerCancel`), `:259-266`
  (`onKeyDown`, the Escape branch)
- Modify: `src/terminal/window-drag.ts` (append the relay emitter)
- Modify: `src/terminal/pane-drag.test.ts` (append a new `describe`)
- Modify: `src/terminal/window-drag.test.ts` (append a new `describe`)

**Interfaces:**

- Consumes: `DragFrame`, `createFrameThrottle`, `RELAY_INTERVAL_MS` from D5;
  `emit` from `@tauri-apps/api/event`
- Produces:
  - three new optional members on `PaneDragOptions`:
    `onDragPoint?(screenX: number, screenY: number, insideWindow: boolean): void`,
    `onDragEnd?(sourceId: number): boolean`, and
    `onDragCancel?(): void`
  - `createRelayEmitter(deps: { sourceLabel: string; emit(frame: DragFrame): void; now(): number }): { begin(dragId: string): void; send(screenX: number, screenY: number): boolean; end(): void }`

`onDragEnd` returns `true` when the cross-window path claimed the drop, so the
in-window `onMove` / `onSwap` must not also run. This is the minimum seam that
keeps `pane-drag.ts` in charge of pointer mechanics and `window-drag.ts` in
charge of cross-window policy.

`onDragCancel` exists because **Escape and `pointercancel` end a drag without
ever reaching `onPointerUp`**: the Escape branch at `pane-drag.ts:259-264` calls
`cleanup()` and returns, so today the cross-window controller would never learn
the drag was over — and every destination that drew an overlay would keep it on
screen. It is a separate hook rather than a flag on `onDragEnd`, because
`onDragEnd` returns a claim decision and a cancelled drag claims nothing.

- [ ] **Step 1: Write the failing tests**

Append to `src/terminal/window-drag.test.ts`:

```ts
import { createRelayEmitter, type DragFrame } from "./window-drag";

describe("createRelayEmitter", () => {
  function harness() {
    const frames: DragFrame[] = [];
    let clock = 0;
    const emitter = createRelayEmitter({
      sourceLabel: "main",
      emit: (frame) => frames.push(frame),
      now: () => clock,
    });
    return {
      frames,
      emitter,
      tick(ms: number): void {
        clock += ms;
      },
    };
  }

  it("emits nothing before begin", () => {
    const { emitter, frames } = harness();
    expect(emitter.send(10, 20)).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("numbers frames monotonically from zero within one drag", () => {
    const { emitter, frames, tick } = harness();
    emitter.begin("drag-1");
    emitter.send(10, 20);
    tick(20);
    emitter.send(30, 40);
    tick(20);
    emitter.send(50, 60);
    expect(frames.map((frame) => frame.seq)).toEqual([0, 1, 2]);
  });

  it("stamps every frame with the drag id and the source label", () => {
    const { emitter, frames } = harness();
    emitter.begin("drag-7");
    emitter.send(10, 20);
    expect(frames[0]).toEqual({
      dragId: "drag-7",
      seq: 0,
      sourceLabel: "main",
      screenX: 10,
      screenY: 20,
    });
  });

  it("throttles to the relay interval", () => {
    const { emitter, frames, tick } = harness();
    emitter.begin("drag-1");
    emitter.send(1, 1);
    tick(5);
    expect(emitter.send(2, 2)).toBe(false);
    tick(11);
    expect(emitter.send(3, 3)).toBe(true);
    expect(frames).toHaveLength(2);
  });

  it("restarts numbering for a second drag", () => {
    const { emitter, frames, tick } = harness();
    emitter.begin("drag-1");
    emitter.send(1, 1);
    emitter.end();
    tick(100);
    emitter.begin("drag-2");
    emitter.send(2, 2);
    expect(frames.map((frame) => [frame.dragId, frame.seq])).toEqual([
      ["drag-1", 0],
      ["drag-2", 0],
    ]);
  });

  it("emits nothing after end", () => {
    const { emitter, frames, tick } = harness();
    emitter.begin("drag-1");
    emitter.send(1, 1);
    emitter.end();
    tick(100);
    expect(emitter.send(2, 2)).toBe(false);
    expect(frames).toHaveLength(1);
  });
});
```

Append to `src/terminal/pane-drag.test.ts`. This block needs the DOM, and
`pane-drag.test.ts` has no jsdom pragma today, so the new assertions go in a
**new file** `src/terminal/pane-drag.cross-window.test.ts` whose first line is
the pragma:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaneDragController } from "./pane-drag";

function pointer(
  type: string,
  init: {
    clientX: number;
    clientY: number;
    screenX?: number;
    screenY?: number;
  },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: init.clientX,
    clientY: init.clientY,
    screenX: init.screenX ?? init.clientX,
    screenY: init.screenY ?? init.clientY,
    button: 0,
  }) as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

// Module scope on purpose: Task D9 appends a second describe block to this
// file and reuses these helpers.
let container: HTMLElement;
let bar: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  bar = document.createElement("div");
  bar.className = "pane__bar";
  container.append(bar);
  document.body.append(container);
  Object.defineProperty(window, "innerWidth", {
    value: 1000,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: 800,
    configurable: true,
  });
});

/**
 * TWO slot rects, and `paneIdForElement` returns 1. The source pane is 1, so
 * only a hover over pane 2 can produce an in-window drop target — with a
 * single rect, `dropTargetAt` returns null for the source itself
 * (`pane-drag.ts:72-74`) and `onMove` would be unreachable in every test.
 */
function build(
  overrides: Partial<Parameters<typeof createPaneDragController>[1]>,
) {
  return createPaneDragController(container, {
    paneCount: () => 2,
    paneIdForElement: () => 1,
    slotRects: () => [
      { id: 1, left: 0, top: 0, right: 500, bottom: 800 },
      { id: 2, left: 500, top: 0, right: 1000, bottom: 800 },
    ],
    ghostLabel: () => "pane",
    onMove: () => undefined,
    onSwap: () => undefined,
    ...overrides,
  });
}

describe("pane drag — cross-window relay hooks", () => {
  it("reports screen coordinates and inside=true while over the window", () => {
    const onDragPoint = vi.fn();
    const controller = build({ onDragPoint });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", {
        clientX: 200,
        clientY: 150,
        screenX: 610,
        screenY: 263,
      }),
    );
    expect(onDragPoint).toHaveBeenCalledWith(610, 263, true);
    controller.dispose();
  });

  it("reports inside=false once the cursor leaves the window box", () => {
    const onDragPoint = vi.fn();
    const controller = build({ onDragPoint });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", {
        clientX: -227,
        clientY: 150,
        screenX: 183,
        screenY: 263,
      }),
    );
    expect(onDragPoint).toHaveBeenLastCalledWith(183, 263, false);
    controller.dispose();
  });

  it("clears an armed local drop target once the cursor leaves the window", () => {
    const onMove = vi.fn();
    const controller = build({ onMove });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    // Over pane 2 — a real in-window target is armed here.
    window.dispatchEvent(
      pointer("pointermove", { clientX: 600, clientY: 400 }),
    );
    // Now outside the window entirely.
    window.dispatchEvent(
      pointer("pointermove", { clientX: -50, clientY: 400 }),
    );
    window.dispatchEvent(pointer("pointerup", { clientX: -50, clientY: 400 }));
    expect(onMove).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("lets onDragEnd claim the drop and suppress the in-window move", () => {
    const onMove = vi.fn();
    const onDragEnd = vi.fn(() => true);
    const controller = build({ onMove, onDragEnd });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    // 600 is inside pane 2, near its left edge — a real in-window target.
    window.dispatchEvent(
      pointer("pointermove", { clientX: 600, clientY: 400 }),
    );
    window.dispatchEvent(pointer("pointerup", { clientX: 600, clientY: 400 }));
    expect(onDragEnd).toHaveBeenCalledWith(1);
    expect(onMove).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("still runs the in-window move when onDragEnd declines", () => {
    const onMove = vi.fn();
    const onDragEnd = vi.fn(() => false);
    const controller = build({ onMove, onDragEnd });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", { clientX: 600, clientY: 400 }),
    );
    window.dispatchEvent(pointer("pointerup", { clientX: 600, clientY: 400 }));
    expect(onMove).toHaveBeenCalledWith(1, 2, "left");
    controller.dispose();
  });

  it("does not call onDragEnd when the drag never passed the threshold", () => {
    const onDragEnd = vi.fn(() => true);
    const controller = build({ onDragEnd });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", { clientX: 102, clientY: 101 }),
    );
    window.dispatchEvent(pointer("pointerup", { clientX: 102, clientY: 101 }));
    expect(onDragEnd).not.toHaveBeenCalled();
    controller.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-drag.test.ts src/terminal/pane-drag.cross-window.test.ts`

Expected: FAIL for two distinct reasons, both correct:

- `window-drag.test.ts`: `createRelayEmitter is not a function` — six tests.
- `pane-drag.cross-window.test.ts`: **five of the ten tests fail**, all with
  `AssertionError: expected "spy" to be called ...`, because `onDragPoint`,
  `onDragEnd` and `onDragCancel` are not options yet and are never invoked:
  (1) _"reports screen coordinates and inside=true while over the window"_;
  (2) _"reports inside=false once the cursor leaves the window box"_;
  (3) _"lets onDragEnd claim the drop and suppress the in-window move"_;
  (4) _"calls onDragCancel when Escape aborts the drag"_;
  (5) _"calls onDragCancel when the pointer is cancelled"_.

  The other **five pass before the change** and are pins, not reds — say so out
  loud, because a plan that miscounts its own red phase is not executable.
  _"clears an armed local drop target"_ passes because `dropTargetAt` already
  returns null outside every rect (`pane-drag.ts:78`); the `inside` guard added
  in Step 4 exists to compute the third `onDragPoint` argument, not to fix a
  hit-test bug. _"still runs the in-window move when onDragEnd declines"_ pins
  the untouched in-window path via `onMove(1, 2, "left")`. The three negative
  assertions — `onDragEnd` below threshold, `onDragCancel` on a normal drop,
  `onDragCancel` before threshold — pass vacuously today and stop being vacuous
  after Step 4, which is exactly their job.

- [ ] **Step 3: Add the relay emitter**

Append to `src/terminal/window-drag.ts`:

```ts
export interface RelayEmitterDeps {
  readonly sourceLabel: string;
  emit(frame: DragFrame): void;
  now(): number;
}

export interface RelayEmitter {
  begin(dragId: string): void;
  /** True when a frame was actually emitted (false when throttled or idle). */
  send(screenX: number, screenY: number): boolean;
  end(): void;
}

/** Stamp, throttle and number the frames one drag relays. */
export function createRelayEmitter(deps: RelayEmitterDeps): RelayEmitter {
  let dragId: string | null = null;
  let seq = 0;
  let gate = createFrameThrottle(RELAY_INTERVAL_MS, deps.now);

  return {
    begin(id: string): void {
      dragId = id;
      seq = 0;
      gate = createFrameThrottle(RELAY_INTERVAL_MS, deps.now);
    },
    send(screenX: number, screenY: number): boolean {
      if (dragId === null || !gate()) {
        return false;
      }
      deps.emit({
        dragId,
        seq,
        sourceLabel: deps.sourceLabel,
        screenX,
        screenY,
      });
      seq += 1;
      return true;
    },
    end(): void {
      dragId = null;
    },
  };
}
```

- [ ] **Step 4: Add the two hooks to `pane-drag.ts`**

Three targeted edits. Do **not** rewrite the file.

Edit 1 — extend `PaneDragOptions`, after the `onSwap` member at `:19`:

```ts
  /**
   * Cross-window drag (spec §11.1): every pointermove while dragging, in
   * SCREEN coordinates, plus whether the cursor is still over this window.
   * Optional so the in-window drag keeps working with no relay installed.
   */
  onDragPoint?(screenX: number, screenY: number, insideWindow: boolean): void;
  /**
   * Cross-window drop claim, called at pointerup before the in-window
   * handlers. Return true when another window (or a new one) took the pane;
   * the local move/swap is then skipped.
   */
  onDragEnd?(sourceId: number): boolean;
  /**
   * The drag ended WITHOUT a drop — Escape or `pointercancel`. Neither path
   * reaches `onPointerUp`, so without this hook a destination window that drew
   * an overlay never hears the drag is over.
   */
  onDragCancel?(): void;
```

Edit 2 — add the leave test and the relay call inside `onPointerMove`, replacing
the tail of the function at `:227-231`:

```ts
mode = dragModeForEvent(event);
lastX = event.clientX;
lastY = event.clientY;
moveGhost(event.clientX, event.clientY);
// The window box in CSS px is the leave test — no IPC, no cached bounds.
const inside =
  event.clientX >= 0 &&
  event.clientY >= 0 &&
  event.clientX <= window.innerWidth &&
  event.clientY <= window.innerHeight;
if (inside) {
  hitTest(event.clientX, event.clientY);
} else {
  target = null;
  hideOverlay();
}
opts.onDragPoint?.(event.screenX, event.screenY, inside);
```

Edit 3 — let the cross-window path claim the drop, replacing `:241-249`:

```ts
cleanup();
if (!wasDragging || src === null) {
  return;
}
if (opts.onDragEnd?.(src) === true) {
  return; // another window took the pane
}
if (dropTarget) {
  // The overlay the user saw decides the action: "full" = swap.
  if (dropTarget.edge === "full") {
    opts.onSwap(src, dropTarget.id);
  } else {
    opts.onMove(src, dropTarget.id, dropTarget.edge);
  }
}
```

Edit 4 — tell the cross-window path about the two no-drop endings. In the
Escape branch of `onKeyDown` (`:259-264`) and in `onPointerCancel`
(`:252-257`), fire the hook **before** `cleanup()` resets `dragging`, and only
when a drag was actually in progress:

```ts
  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (dragging) {
      opts.onDragCancel?.();
    }
    cleanup();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && dragging) {
      event.preventDefault();
      opts.onDragCancel?.();
      cleanup();
      return;
    }
    syncMode(event);
  }
```

The `dragging` guard is what keeps the two "before the threshold" tests honest:
a pointerdown that never moved far enough is not a drag and must not announce
an end.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/terminal/window-drag.test.ts src/terminal/pane-drag.test.ts src/terminal/pane-drag.cross-window.test.ts`
Expected: pass, including the pre-existing `pane-drag.test.ts` suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/window-drag.ts src/terminal/window-drag.test.ts \
        src/terminal/pane-drag.ts src/terminal/pane-drag.cross-window.test.ts
git commit -m "feat(terminal): relay drag screen coordinates and drag-end to other windows"
```

---

### Task D7: Destination side — convert, hit-test, draw the overlay, reply

> **BLOCKED ON D1 AND D2 PASSING.** D2 exists precisely so that this task — the
> first per-pane hit-test on a foreign display — does not ship unmeasured.

**Files:**

- Modify: `src/terminal/pane-drag.ts:177-206` (extract the overlay rect maths)
- Modify: `src/terminal/pane-drag.test.ts` (append `overlayRectFor` cases)
- Modify: `src/terminal/window-drag.ts` (append the receiver)
- Test: `src/terminal/window-drag.receiver.test.ts` (new, jsdom)

**Interfaces:**

- Consumes: `dropTargetAt` (`pane-drag.ts:59`), `toClientPoint` /
  `containsScreenPoint` / `WindowBounds` (D3), `LocalWindowRegistry` (D4),
  `PaneRect` (`src/lib/pane-geometry.ts:11`)
- Produces:
  - `overlayRectFor(rect: PaneRect, edge: Edge | "full"): { left: number; top: number; width: number; height: number }` exported from `pane-drag.ts`
  - `createDragReceiver(deps: DragReceiverDeps): { onFrame(frame: DragFrame): void; onEnd(frame: DragEndFrame): void; dispose(): void }`
  - `interface DragReceiverDeps { readonly label: string; bounds(): WindowBounds | null; slotRects(): readonly PaneRect[]; reply(sourceLabel: string, reply: DragReply): void; showOverlay(rect: { left: number; top: number; width: number; height: number }): void; hideOverlay(): void }`

- [ ] **Step 1: Write the failing test**

`src/terminal/window-drag.receiver.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { PaneRect } from "../lib/pane-geometry";
import {
  createDragReceiver,
  type DragFrame,
  type DragReply,
} from "./window-drag";
import type { WindowBounds } from "./window-registry";

// CSS origin (410, 113), CSS box 1200 x 750 → CSS right edge 1610, bottom 863.
const BOUNDS: WindowBounds = {
  label: "deck-1",
  innerX: 820,
  innerY: 226,
  innerWidth: 2400,
  innerHeight: 1500,
  scaleFactor: 2,
};

const RECTS: readonly PaneRect[] = [
  { id: 11, left: 0, top: 0, right: 600, bottom: 750 },
  { id: 12, left: 600, top: 0, right: 1200, bottom: 750 },
];

function harness(
  overrides: Partial<Parameters<typeof createDragReceiver>[0]> = {},
) {
  const replies: Array<{ to: string; reply: DragReply }> = [];
  const showOverlay = vi.fn();
  const hideOverlay = vi.fn();
  const receiver = createDragReceiver({
    label: "deck-1",
    bounds: () => BOUNDS,
    slotRects: () => RECTS,
    reply: (to, reply) => replies.push({ to, reply }),
    showOverlay,
    hideOverlay,
    ...overrides,
  });
  return { receiver, replies, showOverlay, hideOverlay };
}

function frame(screenX: number, screenY: number, seq = 0): DragFrame {
  return { dragId: "drag-1", seq, sourceLabel: "main", screenX, screenY };
}

describe("createDragReceiver", () => {
  it("ignores frames this window emitted itself", () => {
    const { receiver, replies, showOverlay } = harness();
    receiver.onFrame({ ...frame(500, 300), sourceLabel: "deck-1" });
    expect(replies).toHaveLength(0);
    expect(showOverlay).not.toHaveBeenCalled();
  });

  it("replies with a null target when the point is outside this window", () => {
    const { receiver, replies, hideOverlay } = harness();
    // clientX = 100 - 410 = -310.
    receiver.onFrame(frame(100, 300));
    expect(replies).toEqual([
      { to: "main", reply: { dragId: "drag-1", seq: 0, target: null } },
    ]);
    expect(hideOverlay).toHaveBeenCalled();
  });

  it("converts with its own scale factor and replies with the hit pane", () => {
    const { receiver, replies } = harness();
    // clientX = 500 - 410 = 90, clientY = 400 - 113 = 287 → pane 11, left edge.
    receiver.onFrame(frame(500, 400));
    expect(replies[0].reply.target).toEqual({
      label: "deck-1",
      paneId: 11,
      edge: "left",
    });
  });

  it("picks the second pane and its nearest edge", () => {
    const { receiver, replies } = harness();
    // clientX = 1600 - 410 = 1190 → pane 12, close to its right edge.
    receiver.onFrame(frame(1600, 400));
    expect(replies[0].reply.target).toEqual({
      label: "deck-1",
      paneId: 12,
      edge: "right",
    });
  });

  it("would hit the wrong pane under the subtract-then-divide formula", () => {
    const { receiver, replies } = harness();
    // Correct: 500 - 820/2 = 90 → pane 11.
    // Wrong:  (500 - 820)/2 = -160 → outside, null target.
    receiver.onFrame(frame(500, 400));
    expect(replies[0].reply.target).not.toBeNull();
  });

  it("draws the overlay over the hit half of the target pane", () => {
    const { receiver, showOverlay } = harness();
    receiver.onFrame(frame(500, 400));
    expect(showOverlay).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      width: 300,
      height: 750,
    });
  });

  it("replies null and hides the overlay when this window has no panes", () => {
    const { receiver, replies, hideOverlay } = harness({ slotRects: () => [] });
    receiver.onFrame(frame(500, 400));
    expect(replies[0].reply.target).toBeNull();
    expect(hideOverlay).toHaveBeenCalled();
  });

  it("replies null when bounds are not available yet", () => {
    const { receiver, replies } = harness({ bounds: () => null });
    receiver.onFrame(frame(500, 400));
    expect(replies[0].reply.target).toBeNull();
  });

  it("carries the frame sequence number back unchanged", () => {
    const { receiver, replies } = harness();
    receiver.onFrame(frame(500, 400, 42));
    expect(replies[0].reply.seq).toBe(42);
  });

  it("hides the overlay on dispose", () => {
    const { receiver, hideOverlay } = harness();
    receiver.onFrame(frame(500, 400));
    receiver.dispose();
    expect(hideOverlay).toHaveBeenCalled();
  });

  it("hides the overlay when the drag ends", () => {
    const { receiver, showOverlay, hideOverlay } = harness();
    receiver.onFrame(frame(500, 400));
    expect(showOverlay).toHaveBeenCalled();
    hideOverlay.mockClear();
    receiver.onEnd({ dragId: "drag-1", sourceLabel: "main" });
    expect(hideOverlay).toHaveBeenCalledTimes(1);
  });

  it("hides on drag-end even though the last frame drew a target", () => {
    // The orphan case: the last frame this window saw was a HIT, so no
    // null-target frame will ever arrive to clear it.
    const { receiver, replies, hideOverlay } = harness();
    receiver.onFrame(frame(500, 400));
    expect(replies[0].reply.target).not.toBeNull();
    hideOverlay.mockClear();
    receiver.onEnd({ dragId: "drag-1", sourceLabel: "main" });
    expect(hideOverlay).toHaveBeenCalledTimes(1);
  });

  it("ignores a drag-end this window emitted itself", () => {
    const { receiver, hideOverlay } = harness();
    receiver.onEnd({ dragId: "drag-1", sourceLabel: "deck-1" });
    expect(hideOverlay).not.toHaveBeenCalled();
  });

  it("does not reply to a drag-end", () => {
    const { receiver, replies } = harness();
    receiver.onEnd({ dragId: "drag-1", sourceLabel: "main" });
    expect(replies).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-drag.receiver.test.ts`
Expected: FAIL — `createDragReceiver is not a function`, all fifteen tests.

- [ ] **Step 3: Extract the overlay geometry from `pane-drag.ts`**

Replace the body of `showOverlay` at `:177-206` with a call to a new exported
pure function placed just below `dropTargetAt` at `:79`:

```ts
/**
 * The overlay box for a drop: half the target pane on the docked edge, the
 * whole pane for a swap. Pure — the cross-window receiver reuses it so the
 * two paths cannot drift apart visually.
 */
export function overlayRectFor(
  rect: PaneRect,
  edge: Edge | "full",
): { left: number; top: number; width: number; height: number } {
  const fullWidth = rect.right - rect.left;
  const fullHeight = rect.bottom - rect.top;
  if (edge === "full") {
    return {
      left: rect.left,
      top: rect.top,
      width: fullWidth,
      height: fullHeight,
    };
  }
  if (edge === "left") {
    return {
      left: rect.left,
      top: rect.top,
      width: fullWidth / 2,
      height: fullHeight,
    };
  }
  if (edge === "right") {
    return {
      left: rect.left + fullWidth / 2,
      top: rect.top,
      width: fullWidth / 2,
      height: fullHeight,
    };
  }
  if (edge === "top") {
    return {
      left: rect.left,
      top: rect.top,
      width: fullWidth,
      height: fullHeight / 2,
    };
  }
  return {
    left: rect.left,
    top: rect.top + fullHeight / 2,
    width: fullWidth,
    height: fullHeight / 2,
  };
}
```

and the closure method becomes:

```ts
function showOverlay(rect: PaneRect, edge: DropEdge): void {
  if (!overlay) {
    return;
  }
  const box = overlayRectFor(rect, edge);
  overlay.classList.toggle("is-swap", edge === "full");
  overlay.style.display = "block";
  overlay.style.left = `${box.left}px`;
  overlay.style.top = `${box.top}px`;
  overlay.style.width = `${box.width}px`;
  overlay.style.height = `${box.height}px`;
}
```

Add to `src/terminal/pane-drag.test.ts` (existing node-environment file — the
function is pure). Its import from `./pane-drag` currently reads
`import { dragModeForEvent, dropTargetAt, edgeFor } from "./pane-drag";` — edit
that line in place to add the new binding rather than adding a second statement:

```ts
import {
  dragModeForEvent,
  dropTargetAt,
  edgeFor,
  overlayRectFor,
} from "./pane-drag";
```

`PaneRect` is already imported at the top of that file, so it needs no change.
Then append:

```ts
describe("overlayRectFor", () => {
  const rect: PaneRect = { id: 3, left: 100, top: 50, right: 500, bottom: 450 };

  it("covers the left half for a left dock", () => {
    expect(overlayRectFor(rect, "left")).toEqual({
      left: 100,
      top: 50,
      width: 200,
      height: 400,
    });
  });

  it("covers the right half for a right dock", () => {
    expect(overlayRectFor(rect, "right")).toEqual({
      left: 300,
      top: 50,
      width: 200,
      height: 400,
    });
  });

  it("covers the bottom half for a bottom dock", () => {
    expect(overlayRectFor(rect, "bottom")).toEqual({
      left: 100,
      top: 250,
      width: 400,
      height: 200,
    });
  });

  it("covers the whole pane for a swap", () => {
    expect(overlayRectFor(rect, "full")).toEqual({
      left: 100,
      top: 50,
      width: 400,
      height: 400,
    });
  });
});
```

- [ ] **Step 4: Implement the receiver**

Add these three imports at the **top** of `src/terminal/window-drag.ts`, beside
the existing `Edge` import, and append the rest of the code at the end of the
file. There is no import cycle: `pane-drag.ts` does not import `window-drag.ts`.

```ts
import type { PaneRect } from "../lib/pane-geometry";
import { dropTargetAt, overlayRectFor } from "./pane-drag";
import {
  containsScreenPoint,
  toClientPoint,
  type WindowBounds,
} from "./window-registry";

export interface OverlayBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DragReceiverDeps {
  readonly label: string;
  /** THIS window's live bounds. Null until the first read completes. */
  bounds(): WindowBounds | null;
  /** Active tab's slot rects, in this window's client coordinates. */
  slotRects(): readonly PaneRect[];
  reply(sourceLabel: string, reply: DragReply): void;
  showOverlay(box: OverlayBox): void;
  hideOverlay(): void;
}

export interface DragReceiver {
  onFrame(frame: DragFrame): void;
  /** The source says the drag is over, for ANY reason. Clear the overlay. */
  onEnd(frame: DragEndFrame): void;
  dispose(): void;
}

/**
 * One window's answer to the relay. Converts with its OWN bounds — never the
 * source's — hit-tests with the same pure functions the in-window drag uses,
 * draws the same `.drop-overlay`, and replies. Cross-window drops always dock;
 * the swap gesture stays inside one window.
 *
 * The destination is deliberately NOT raised (spec §11.2): calling `setFocus`
 * mid-drag steals focus and risks breaking the source's pointer capture.
 * Accepted limitation: a fully occluded window still draws an overlay the user
 * cannot see, and can still receive the drop.
 */
export function createDragReceiver(deps: DragReceiverDeps): DragReceiver {
  function answer(frame: DragFrame, target: DragTarget | null): void {
    if (target === null) {
      deps.hideOverlay();
    }
    deps.reply(frame.sourceLabel, {
      dragId: frame.dragId,
      seq: frame.seq,
      target,
    });
  }

  return {
    onFrame(frame: DragFrame): void {
      if (frame.sourceLabel === deps.label) {
        return; // the source draws its own overlay through pane-drag.ts
      }
      const bounds = deps.bounds();
      if (bounds === null || !containsScreenPoint(bounds, frame)) {
        answer(frame, null);
        return;
      }
      const { clientX, clientY } = toClientPoint(frame, bounds);
      const hit = dropTargetAt(deps.slotRects(), clientX, clientY, null);
      if (hit === null) {
        answer(frame, null);
        return;
      }
      deps.showOverlay(overlayRectFor(hit.rect, hit.edge));
      answer(frame, {
        label: deps.label,
        paneId: hit.id,
        edge: hit.edge,
      });
    },
    onEnd(frame: DragEndFrame): void {
      if (frame.sourceLabel === deps.label) {
        return;
      }
      // No reply: the drag is already over, and a reply for a finished drag
      // could only arrive after the arbiter cleared. Just clear the overlay —
      // the last frame this window saw may well have been a hit, in which case
      // nothing else will ever clear it.
      deps.hideOverlay();
    },
    dispose(): void {
      deps.hideOverlay();
    },
  };
}
```

`sourceId` is `null` in the `dropTargetAt` call because the dragged pane lives
in another window, so it can never be one of this window's rects — the
"hovering the source itself" branch at `pane-drag.ts:72` cannot fire here.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/terminal/window-drag.receiver.test.ts src/terminal/pane-drag.test.ts src/terminal/window-drag.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/window-drag.ts src/terminal/window-drag.receiver.test.ts \
        src/terminal/pane-drag.ts src/terminal/pane-drag.test.ts
git commit -m "feat(terminal): hit-test and preview cross-window drops per window"
```

---

### Task D7b: Dock an adopted pane on the side the overlay promised

> **WAVE 1 — NOT GATED. Blocked on nothing.** Outside the §0.7 gate: this is
> pure tree code in `src/lib/split-tree.ts` with no pointer behaviour and no
> window API, so neither the Windows measurement (D1) nor the multi-monitor one
> (D2) has any bearing on it, and it does not depend on D3–D5 either. It sits
> at this position in the file only because D8 passes `edge` into the adopt
> path and must not do so before a placement function honours it — **the
> numbering is not the schedule.**
>
> The frontend section's `adoptIntoActiveTab` is wave-1 work that cannot be
> written without `dockNewPane`. Start this whenever; do not wait for hardware.

**The finding, corrected against the file.** The report was that `splitLeaf`
always places the new pane in slot `b` (`src/lib/split-tree.ts:31-39`), so a
left or top drop would silently dock on the wrong side. Half right, and the
half that is wrong changes the fix:

- `splitLeaf` **is** hard-coded to slot `b` (`:34`), but it takes a `Direction`
  and no `Edge` — it is the Cmd+D "split pane" action
  (`terminal-manager.ts:352`), where "new pane goes second" is the intended
  behaviour, not a defect.
- **In-window drag does not have this bug.** `movePane` derives
  `sourceFirst = edge === "left" || edge === "top"` (`:75`) and `dockIntoLeaf`
  puts the source in branch `a` when it is set (`:96-97`).
  `src/lib/split-tree.test.ts:69-110` already pins all four edges by full tree
  shape. So: copy `movePane`, do not copy `splitLeaf`.
- **The real trap is that `movePane` cannot be used here at all.** It calls
  `leafIds(node)` and returns the tree **by reference** when `sourceId` is not
  already in the tree (`:65-68`). An adopted pane is by definition not yet in
  the destination tree, so `movePane` is a silent no-op — and `splitLeaf` is
  then the only exported function that looks like it fits, which is exactly how
  a left drop ends up on the right.

So neither exported function is correct for "dock a pane that is **not yet in
this tree** onto an edge of a pane that is". That function does not exist. This
task adds it. **`adoptIntoActiveTab` (frontend section) must call it** — see
Findings (b).

**Files:**

- Modify: `src/lib/split-tree.ts` (add `dockNewPane` directly below `movePane`, `:77`)
- Test: `src/lib/split-tree.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `Edge`, `Direction`, `TreeNode`, `leafIds`, and the existing private `dockIntoLeaf` (`:80-105`)
- Produces: `dockNewPane(node: TreeNode, targetId: number, newId: number, edge: Edge): TreeNode`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/split-tree.test.ts`. Its import block already pulls
`leaf`, `leafIds`, `movePane` and `splitLeaf` from `./split-tree` — edit that
existing statement to add `dockNewPane` rather than adding a second one.

Every case asserts the **whole tree shape**. An assertion that the pane merely
arrived — `leafIds(next).includes(9)` — passes under the wrong side and is
worthless here.

**This is not hypothetical.** Checking its own draft against `split-tree.ts`,
the frontend section found `adoptIntoActiveTab` carried **two** independent
bugs, not one: it used `splitLeaf` (wrong slot), *and* its direction mapping was
inverted — `edge === "left" || edge === "right" ? "column" : "row"`, the
opposite of `movePane` (`split-tree.ts:74`). A left dock would have landed on
the wrong side of the wrong axis, and a `leafIds` membership assertion would
have reported success for both. Shape assertions are what make a compound
placement bug catchable at all, so `dir` is pinned in every case below
alongside `a` and `b` — not as belt-and-braces, but because that is the field
that was actually wrong:

```ts
describe("dockNewPane", () => {
  it("puts the new pane in branch a for a left dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "left")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(9),
      b: leaf(1),
    });
  });

  it("puts the new pane in branch b for a right dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "right")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(9),
    });
  });

  it("puts the new pane in branch a for a top dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "top")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(9),
      b: leaf(1),
    });
  });

  it("puts the new pane in branch b for a bottom dock", () => {
    expect(dockNewPane(leaf(1), 1, 9, "bottom")).toEqual({
      kind: "split",
      dir: "column",
      ratio: 0.5,
      a: leaf(1),
      b: leaf(9),
    });
  });

  it("differs from splitLeaf on the two edges that invert", () => {
    // The discriminator. splitLeaf always appends to branch b, so it agrees
    // on right/bottom and is WRONG on left/top — which is why a drop path
    // that reaches for it produces an overlay that lies.
    const viaSplit = splitLeaf(leaf(1), 1, 9, "row");
    expect(dockNewPane(leaf(1), 1, 9, "right")).toEqual(viaSplit);
    expect(dockNewPane(leaf(1), 1, 9, "left")).not.toEqual(viaSplit);
  });

  it("docks onto the correct leaf inside a nested tree", () => {
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    // tree: row(a: 1, b: column(a: 2, b: 3))
    expect(dockNewPane(tree, 3, 9, "top")).toEqual({
      kind: "split",
      dir: "row",
      ratio: 0.5,
      a: leaf(1),
      b: {
        kind: "split",
        dir: "column",
        ratio: 0.5,
        a: leaf(2),
        b: {
          kind: "split",
          dir: "column",
          ratio: 0.5,
          a: leaf(9),
          b: leaf(3),
        },
      },
    });
  });

  it("returns the tree BY REFERENCE when the target is not in it", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    // Same convention as movePane: identity means "nothing happened", and the
    // caller must treat it as a failed adopt rather than a completed one.
    expect(dockNewPane(tree, 99, 9, "left")).toBe(tree);
  });

  it("does not mutate the input tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    const before = JSON.stringify(tree);
    dockNewPane(tree, 2, 9, "left");
    expect(JSON.stringify(tree)).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/split-tree.test.ts`

Expected: FAIL at collection — `SyntaxError: The requested module './split-tree'
does not provide an export named 'dockNewPane'`. All eight new cases error; the
existing suite is unaffected once the export lands.

- [ ] **Step 3: Add `dockNewPane`**

Insert directly below `movePane` (`src/lib/split-tree.ts:77`). It reuses the
existing private `dockIntoLeaf`, so the adopted pane and the in-window drag
cannot drift apart on which side an edge means:

```ts
/**
 * Dock a pane that is NOT YET in this tree onto an `edge` of leaf `targetId`.
 * Returns a new tree; returns the old tree BY REFERENCE when `targetId` is not
 * present.
 *
 * `movePane` cannot serve this case: it requires the source leaf to already be
 * in the tree and returns the tree unchanged otherwise. `splitLeaf` cannot
 * either: it takes a direction rather than an edge and always appends the new
 * pane to branch `b`, so `left` and `top` would land on the wrong side.
 */
export function dockNewPane(
  node: TreeNode,
  targetId: number,
  newId: number,
  edge: Edge,
): TreeNode {
  if (!leafIds(node).includes(targetId)) {
    return node;
  }
  const dir: Direction = edge === "left" || edge === "right" ? "row" : "column";
  const newFirst = edge === "left" || edge === "top";
  return dockIntoLeaf(node, targetId, newId, dir, newFirst);
}
```

`movePane` is **not** refactored. It already produces the right answer and is
covered by `split-tree.test.ts:69-110`; rewriting it here would put a
load-bearing in-window path at risk for no gain.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: pass — the existing suite plus 8 new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/split-tree.ts src/lib/split-tree.test.ts
git commit -m "feat(lib): dock a not-yet-present pane onto a chosen edge"
```

---

### Task D8: Wire the drag — install the relay, run the transfer at pointerup

> **BLOCKED ON D1 AND D2 PASSING.**

**Files:**

- Modify: `src/terminal/window-drag.ts` (append the controller and `createDropOverlay`)
- Modify: `src/terminal/terminal-manager.ts:482-492` (three new drag options) and its `dispose()`
- Modify: `src/terminal/window-drag.receiver.test.ts` (add the `createDropOverlay` cases)
- Test: `src/terminal/window-drag.controller.test.ts` (new, jsdom)

**Interfaces:**

- Consumes:
  - `detachPaneForTransfer(paneId): Promise<{ token: string }>`, `releaseDetachedPane(paneId): void`, `abortDetach(token): Promise<void>` — `src/terminal/pane-detach.ts`, owned by the frontend section
  - `adoptIntoActiveTab({ token, targetPaneId, edge }): Promise<void>` — `src/terminal/pane-adopt.ts`, owned by the frontend section (destination side; this section only sends it a message). **It must place the pane with `dockNewPane` from Task D7b**, not `splitLeaf` — see Findings (b) item 5.
  - `open_pane_window({ token, screenX?, screenY? })` — Rust, owned by the lifecycle section. **Coordinates are CSS pixels; Rust converts to physical.** Pinned on both sides.
  - `focus_order() -> Vec<String>` — Rust command, owned by the lifecycle section. Most-recent-first MRU roster. **Read-only: it never focuses or raises a window**, which is what keeps it clear of spec §11.2.
  - `transfer:settled { token, outcome: "committed" | "aborted", reason?: string }` — emitted by the transfer section to **both** the `from` and `to` labels, inside the lock section that finalises the route
  - `emit`, `emitTo`, `listen` from `@tauri-apps/api/event`
- Produces:
  - `createWindowDragController(deps: WindowDragDeps): Promise<{ onDragPoint(screenX, screenY, inside): void; onReply(reply): void; onDragEnd(sourceId: number): boolean; onDragCancel(): void; dispose(): void }>`
  - `createDropOverlay(): DropOverlayHandle` — the destination window's `.drop-overlay`
  - event names `deck:drag-move`, `deck:drag-end`, `deck:drag-reply` and `deck:drag-adopt`. **None is a contract change** — none appears in §0.2's event table and all four are internal to this section.

**Drop policy, spelled out:**

| At `pointerup`                                                       | Action                                                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbiter target is in **another** window                              | `detachPaneForTransfer` → `emitTo(target.label, "deck:drag-adopt", …)` → **await `transfer:settled` for this token** → release or keep         |
| Arbiter target is **null** and the cursor is **outside** this window | `detachPaneForTransfer` → `open_pane_window({ token, screenX, screenY })` → **await `transfer:settled`** → release or keep                     |
| Arbiter target is **null** and the cursor is **inside** this window  | Not claimed — `onDragEnd` returns `false` and the in-window `onMove` / `onSwap` runs unchanged                                                 |
| This window holds one pane and it is the one being dragged           | Still claimed; the source window closes itself per spec §10.3 step 3                                                                          |

**Settlement, not an ack.** The source never asks the destination whether the
adopt worked. `emitTo` resolves the moment the message is dispatched, so a
destination-side `adoptIntoActiveTab` failure would otherwise never reach this
abort path — and a webview ack could arrive for a transfer Rust had already
timed out at the §7.5 ten-second bound. Rust owns the route, so Rust's
`transfer:settled` is the only authoritative answer:

- `outcome: "committed"` → `releaseDetachedPane(sourceId)`. The pane arrived.
- `outcome: "aborted"` → **do not release, and do not call `abortDetach`** — the
  route is already back with the source. Surface `reason`, which distinguishes a
  refusal from a timeout.
- The send itself throws → `abortDetach(token)`; nothing downstream ever saw the
  token.
- `detachPaneForTransfer` throws → nothing was staged; return without claiming.

There is no frontend timer: §7.5's 10 s bound auto-aborts and emits
`transfer:settled` on that path too, so the await always terminates.

- [ ] **Step 1: Write the failing test**

`src/terminal/window-drag.controller.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createWindowDragController } from "./window-drag";
import type { WindowBounds } from "./window-registry";

const BOUNDS: WindowBounds = {
  label: "main",
  innerX: 820,
  innerY: 226,
  innerWidth: 2400,
  innerHeight: 1500,
  scaleFactor: 2,
};

function harness(overrides = {}) {
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const detach = vi.fn(async () => ({ token: "tok-1" }));
  const release = vi.fn();
  const abort = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => "deck-2");
  const sendAdopt = vi.fn(async () => undefined);
  const emitEnd = vi.fn();
  // Default: Rust reports the transfer committed.
  const awaitSettled = vi.fn(async () => ({ outcome: "committed" }) as const);
  let clock = 0;
  const deps = {
    label: "main",
    bounds: () => BOUNDS,
    focusOrder: () => ["deck-1", "main"],
    now: () => clock,
    newDragId: () => "drag-1",
    emitFrame: (payload: unknown) =>
      emitted.push({ name: "deck:drag-move", payload }),
    emitEnd,
    sendAdoptRequest: sendAdopt,
    awaitSettled,
    detachPaneForTransfer: detach,
    releaseDetachedPane: release,
    abortDetach: abort,
    openPaneWindow: openWindow,
    ...overrides,
  };
  // Read every accessor back off `deps`, NOT off the closure locals above.
  // `overrides` is spread into `deps`, so the controller calls the override
  // while a local would still point at the default — an assertion on the local
  // could then never fire.
  return {
    deps,
    emitted,
    detach: deps.detachPaneForTransfer,
    release: deps.releaseDetachedPane,
    abort: deps.abortDetach,
    openWindow: deps.openPaneWindow,
    sendAdopt: deps.sendAdoptRequest,
    awaitSettled: deps.awaitSettled,
    emitEnd: deps.emitEnd,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createWindowDragController", () => {
  it("emits a frame only once the cursor has left the window", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(600, 300, true);
    expect(h.emitted).toHaveLength(0);
    controller.onDragPoint(100, 300, false);
    expect(h.emitted).toHaveLength(1);
    controller.dispose();
  });

  it("stops emitting once the cursor comes back inside", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    h.tick(20);
    controller.onDragPoint(600, 300, true);
    expect(h.emitted).toHaveLength(1);
    controller.dispose();
  });

  it("does not claim a drop that never left the window", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(600, 300, true);
    expect(controller.onDragEnd(5)).toBe(false);
    expect(h.detach).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("claims the drop and opens a new window when no target replied", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    expect(controller.onDragEnd(5)).toBe(true);
    await vi.waitFor(() => expect(h.openWindow).toHaveBeenCalled());
    expect(h.openWindow).toHaveBeenCalledWith({
      token: "tok-1",
      screenX: 100,
      screenY: 300,
    });
    expect(h.release).toHaveBeenCalledWith(5);
    controller.dispose();
  });

  it("claims the drop and asks the accepted window to adopt", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onReply({
      dragId: "drag-1",
      seq: 0,
      target: { label: "deck-1", paneId: 42, edge: "top" },
    });
    expect(controller.onDragEnd(5)).toBe(true);
    await vi.waitFor(() => expect(h.sendAdopt).toHaveBeenCalled());
    expect(h.sendAdopt).toHaveBeenCalledWith("deck-1", {
      token: "tok-1",
      targetPaneId: 42,
      edge: "top",
    });
    expect(h.openWindow).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.release).toHaveBeenCalledWith(5));
    controller.dispose();
  });

  it("ignores a reply carrying a stale drag id", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onReply({
      dragId: "drag-0",
      seq: 99,
      target: { label: "deck-9", paneId: 1, edge: "left" },
    });
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.openWindow).toHaveBeenCalled());
    expect(h.sendAdopt).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps the pane when Rust settles the transfer as aborted", async () => {
    // The destination refused AFTER the message was dispatched. `emitTo`
    // resolved fine; only `transfer:settled` knows the truth.
    const h = harness({
      awaitSettled: vi.fn(async () => ({
        outcome: "aborted" as const,
        reason: "destination closed",
      })),
    });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onReply({
      dragId: "drag-1",
      seq: 0,
      target: { label: "deck-1", paneId: 42, edge: "top" },
    });
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.awaitSettled).toHaveBeenCalledWith("tok-1"));
    expect(h.release).not.toHaveBeenCalled();
    // The route is already back with the source — a second abort would be wrong.
    expect(h.abort).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("releases the pane only after a committed settlement", async () => {
    let settle: (value: { outcome: "committed" }) => void = () => undefined;
    const h = harness({
      awaitSettled: vi.fn(
        () =>
          new Promise<{ outcome: "committed" }>((resolve) => {
            settle = resolve;
          }),
      ),
    });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.openWindow).toHaveBeenCalled());
    expect(h.release).not.toHaveBeenCalled(); // still in flight
    settle({ outcome: "committed" });
    await vi.waitFor(() => expect(h.release).toHaveBeenCalledWith(5));
    controller.dispose();
  });

  it("aborts when the adopt message cannot be dispatched", async () => {
    const h = harness({
      sendAdoptRequest: vi.fn(async () => {
        throw new Error("no such window");
      }),
    });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onReply({
      dragId: "drag-1",
      seq: 0,
      target: { label: "deck-1", paneId: 42, edge: "top" },
    });
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.abort).toHaveBeenCalledWith("tok-1"));
    expect(h.release).not.toHaveBeenCalled();
    expect(h.awaitSettled).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("aborts when opening the new window rejects", async () => {
    const h = harness({
      openPaneWindow: vi.fn(async () => {
        throw new Error("builder failed");
      }),
    });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.abort).toHaveBeenCalledWith("tok-1"));
    expect(h.release).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not claim when prepare_transfer itself fails", async () => {
    const h = harness({
      detachPaneForTransfer: vi.fn(async () => {
        throw new Error("pane already transferring");
      }),
    });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    await vi.waitFor(() => expect(h.openWindow).not.toHaveBeenCalled());
    expect(h.release).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("emits drag-end when the drop is claimed, so no overlay is orphaned", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    expect(h.emitEnd).toHaveBeenCalledWith({
      dragId: "drag-1",
      sourceLabel: "main",
    });
    controller.dispose();
  });

  it("emits drag-end when the drag is cancelled with Escape", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragCancel();
    expect(h.emitEnd).toHaveBeenCalledTimes(1);
    expect(h.detach).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("emits drag-end when the cursor comes back into the source window", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    h.tick(20);
    controller.onDragPoint(600, 300, true);
    expect(h.emitEnd).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("emits no drag-end for a drag that never left the window", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(600, 300, true);
    controller.onDragEnd(5);
    controller.onDragCancel();
    expect(h.emitEnd).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("emits exactly one drag-end per drag", async () => {
    const h = harness();
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    controller.onDragCancel(); // a stray cancel after the drop must not re-emit
    controller.dispose();
    expect(h.emitEnd).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh drag id for the next drag", async () => {
    let id = 0;
    const h = harness({ newDragId: () => `drag-${(id += 1)}` });
    const controller = await createWindowDragController(h.deps);
    controller.onDragPoint(100, 300, false);
    controller.onDragEnd(5);
    h.tick(100);
    controller.onDragPoint(100, 300, false);
    const frames = h.emitted.map(
      (entry) => (entry.payload as { dragId: string }).dragId,
    );
    expect(frames[0]).toBe("drag-1");
    expect(frames[frames.length - 1]).toBe("drag-2");
    controller.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/window-drag.controller.test.ts`
Expected: FAIL — `createWindowDragController is not a function`, all seventeen
tests.

- [ ] **Step 3: Implement the controller**

Append to `src/terminal/window-drag.ts`:

```ts
export interface AdoptRequest {
  readonly token: string;
  readonly targetPaneId: number;
  readonly edge: Edge;
}

export interface WindowDragDeps {
  readonly label: string;
  bounds(): WindowBounds | null;
  /**
   * Deck window labels, most recently focused first. Backed by the lifecycle
   * section's `focus_order()` Rust command, which is read-only — it never
   * focuses or raises anything, which is what keeps it clear of spec §11.2.
   */
  focusOrder(): readonly string[];
  now(): number;
  newDragId(): string;
  emitFrame(frame: DragFrame): void;
  /** Broadcast `deck:drag-end`. Every window clears its overlay on it. */
  emitEnd(frame: DragEndFrame): void;
  /**
   * Dispatch `deck:drag-adopt` to another window. Resolving means the message
   * was SENT, not that the adopt worked — `awaitSettled` is the answer.
   */
  sendAdoptRequest(label: string, request: AdoptRequest): Promise<void>;
  /**
   * Resolve when Rust emits `transfer:settled` for this token. Authoritative:
   * Rust owns the route, so it knows about a §7.5 timeout the destination
   * webview never hears about.
   */
  awaitSettled(token: string): Promise<TransferSettled>;
  detachPaneForTransfer(paneId: number): Promise<{ token: string }>;
  releaseDetachedPane(paneId: number): void;
  abortDetach(token: string): Promise<void>;
  /** Coordinates are CSS pixels; Rust converts to physical. */
  /**
   * §0.2: CSS pixels in, the NEW WINDOW'S LABEL out. Never typed `void`.
   * This section ignores the label — it is the source window, not the new one —
   * but the type must not lie about the contract.
   */
  openPaneWindow(args: {
    token: string;
    screenX: number;
    screenY: number;
  }): Promise<string>;
}

/** Payload of the `transfer:settled` event, owned by the transfer section. */
export interface TransferSettled {
  readonly outcome: "committed" | "aborted";
  readonly reason?: string;
}

export interface WindowDragController {
  /** Feed from `PaneDragOptions.onDragPoint`. */
  onDragPoint(screenX: number, screenY: number, insideWindow: boolean): void;
  /** Feed from the `deck:drag-reply` listener. */
  onReply(reply: DragReply): void;
  /** Feed from `PaneDragOptions.onDragEnd`. True = this path took the pane. */
  onDragEnd(sourceId: number): boolean;
  /** Feed from `PaneDragOptions.onDragCancel` — Escape or `pointercancel`. */
  onDragCancel(): void;
  dispose(): void;
}

/**
 * The source window's half of cross-window drag. It starts relaying the moment
 * the cursor leaves this window and stops when it comes back; a drag that never
 * leaves is a plain in-window drag and is not claimed here.
 */
export async function createWindowDragController(
  deps: WindowDragDeps,
): Promise<WindowDragController> {
  const arbiter = createDropArbiter(deps.focusOrder);
  const emitter = createRelayEmitter({
    sourceLabel: deps.label,
    emit: deps.emitFrame,
    now: deps.now,
  });
  let leftWindow = false;
  let dragId: string | null = null;
  let lastScreenX = 0;
  let lastScreenY = 0;

  /**
   * End the relay session and tell every other window to drop its overlay.
   * This is the ONLY thing that clears a destination overlay in the common
   * cases: after a successful adopt no further frame is ever sent, and after
   * Escape the pointer stream stops entirely. Emitting on every ending —
   * drop, cancel, or the cursor coming home — is what keeps that from being a
   * per-path bug.
   */
  function endSession(): void {
    if (leftWindow && dragId !== null) {
      deps.emitEnd({ dragId, sourceLabel: deps.label });
    }
    emitter.end();
    arbiter.clear();
    leftWindow = false;
    dragId = null;
  }

  async function runTransfer(
    sourceId: number,
    target: DragTarget | null,
    screenX: number,
    screenY: number,
  ): Promise<void> {
    let token: string;
    try {
      ({ token } = await deps.detachPaneForTransfer(sourceId));
    } catch (error: unknown) {
      // Nothing was staged, so there is nothing to abort and the pane is
      // untouched. Spec §13: never assume it moved.
      console.warn("window-drag: could not prepare the transfer", error);
      return;
    }
    try {
      if (target === null) {
        await deps.openPaneWindow({ token, screenX, screenY });
      } else {
        await deps.sendAdoptRequest(target.label, {
          token,
          targetPaneId: target.paneId,
          edge: target.edge,
        });
      }
    } catch (error: unknown) {
      // The request never left. Nothing downstream saw the token, so the
      // source is the one that has to unwind it.
      console.warn("window-drag: could not dispatch the transfer", error);
      await deps.abortDetach(token);
      return;
    }
    // Rust decides, not the destination webview: `emitTo` resolves at send,
    // and the §7.5 ten-second bound can abort a transfer the destination is
    // still working on. This await always terminates because that bound emits
    // `transfer:settled` too.
    const settled = await deps.awaitSettled(token);
    if (settled.outcome === "committed") {
      deps.releaseDetachedPane(sourceId);
      return;
    }
    // Already back with the source — calling abortDetach again would be a
    // second unwind of a route that is no longer transferring.
    console.warn(
      `window-drag: transfer aborted, keeping the pane (${settled.reason ?? "no reason given"})`,
    );
  }

  return {
    onDragPoint(screenX: number, screenY: number, insideWindow: boolean): void {
      lastScreenX = screenX;
      lastScreenY = screenY;
      if (insideWindow) {
        if (leftWindow) {
          // Back home: the in-window overlay takes over again.
          endSession();
        }
        return;
      }
      if (!leftWindow) {
        leftWindow = true;
        dragId = deps.newDragId();
        emitter.begin(dragId);
        arbiter.begin(dragId);
      }
      emitter.send(screenX, screenY);
    },
    onReply(reply: DragReply): void {
      arbiter.accept(reply);
    },
    onDragEnd(sourceId: number): boolean {
      if (!leftWindow) {
        endSession();
        return false; // a plain in-window drag
      }
      const target = arbiter.current();
      const screenX = lastScreenX;
      const screenY = lastScreenY;
      endSession();
      void runTransfer(sourceId, target, screenX, screenY);
      return true;
    },
    onDragCancel(): void {
      // Escape or pointercancel: no drop, no transfer — but the destinations
      // still have overlays up, and endSession is what takes them down.
      endSession();
    },
    dispose(): void {
      endSession();
    },
  };
}
```

- [ ] **Step 4a: Give the destination an overlay element**

`pane-drag.ts` creates `.drop-overlay` inside `beginDrag()`, which only ever
runs in the window that owns the pointer. A destination window therefore has
**no overlay element at all**. Add a tiny owner for one in
`src/terminal/window-drag.ts`, using the same class so the two paths cannot
drift visually (`styles.css:1610-1622`). It never sets `is-swap`: cross-window
drops always dock.

```ts
export interface DropOverlayHandle {
  show(box: OverlayBox): void;
  hide(): void;
  dispose(): void;
}

/**
 * A lazily created `.drop-overlay` for a window that is NOT the drag source.
 * Body-level and `position: fixed`, like the in-window one, so a layout
 * re-render underneath it cannot wipe it.
 */
export function createDropOverlay(): DropOverlayHandle {
  let element: HTMLElement | null = null;

  return {
    show(box: OverlayBox): void {
      if (element === null) {
        element = document.createElement("div");
        element.className = "drop-overlay";
        document.body.append(element);
      }
      element.style.display = "block";
      element.style.left = `${box.left}px`;
      element.style.top = `${box.top}px`;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
    },
    hide(): void {
      if (element !== null) {
        element.style.display = "none";
      }
    },
    dispose(): void {
      element?.remove();
      element = null;
    },
  };
}
```

Add three cases to `src/terminal/window-drag.receiver.test.ts` (already jsdom):

```ts
import { createDropOverlay } from "./window-drag";

describe("createDropOverlay", () => {
  it("creates one body-level .drop-overlay on first show", () => {
    const overlay = createDropOverlay();
    overlay.show({ left: 10, top: 20, width: 30, height: 40 });
    overlay.show({ left: 50, top: 60, width: 70, height: 80 });
    const nodes = document.body.querySelectorAll(".drop-overlay");
    expect(nodes).toHaveLength(1);
    expect((nodes[0] as HTMLElement).style.left).toBe("50px");
    overlay.dispose();
  });

  it("never marks a cross-window drop as a swap", () => {
    const overlay = createDropOverlay();
    overlay.show({ left: 0, top: 0, width: 10, height: 10 });
    expect(
      document.body.querySelector(".drop-overlay")?.classList.contains("is-swap"),
    ).toBe(false);
    overlay.dispose();
  });

  it("removes the element on dispose", () => {
    const overlay = createDropOverlay();
    overlay.show({ left: 0, top: 0, width: 10, height: 10 });
    overlay.dispose();
    expect(document.body.querySelector(".drop-overlay")).toBeNull();
  });
});
```

- [ ] **Step 4b: Wire it into `TerminalManager`**

Two targeted edits at `src/terminal/terminal-manager.ts:482-492`. Do not
restructure the surrounding code. First, three option members inside the
existing `createPaneDragController` call:

```ts
    onDragPoint(screenX, screenY, insideWindow) {
      windowDrag?.onDragPoint(screenX, screenY, insideWindow);
    },
    onDragEnd(sourceId) {
      return windowDrag?.onDragEnd(sourceId) ?? false;
    },
    onDragCancel() {
      windowDrag?.onDragCancel();
    },
```

Second, the initializer above it. Until it resolves every hook is a no-op and
the in-window drag behaves exactly as it does today — the correct degradation,
not a gap:

```ts
  let windowDrag: WindowDragController | null = null;
  let dragRegistry: LocalWindowRegistry | null = null;
  let dragReceiver: DragReceiver | null = null;
  const dropOverlay = createDropOverlay();
  const dragUnlisteners: UnlistenFn[] = [];
  // Settlement waiters, keyed by transfer token (§0.2 `transfer:settled`).
  const settleWaiters = new Map<string, (value: TransferSettled) => void>();

  async function installCrossWindowDrag(): Promise<void> {
    const win = getCurrentWindow();
    dragRegistry = await createLocalWindowRegistry({
      label: win.label,
      scaleFactor: () => win.scaleFactor(),
      innerPosition: () => win.innerPosition(),
      innerSize: () => win.innerSize(),
      onMoved: (handler) => win.onMoved(() => handler()),
      onResized: (handler) => win.onResized(() => handler()),
      onScaleChanged: (handler) => win.onScaleChanged(() => handler()),
    });

    dragReceiver = createDragReceiver({
      label: win.label,
      bounds: () => dragRegistry?.bounds() ?? null,
      slotRects: () => layout.slotRects(),
      reply: (sourceLabel, reply) => {
        void emitTo(sourceLabel, "deck:drag-reply", reply);
      },
      showOverlay: (box) => dropOverlay.show(box),
      hideOverlay: () => dropOverlay.hide(),
    });

    // One MRU read per drag start, not per frame: it is an ordering, not
    // geometry, so the never-cache rule in window-registry.ts does not reach it.
    let mru: readonly string[] = await invoke<string[]>("focus_order");

    windowDrag = await createWindowDragController({
      label: win.label,
      bounds: () => dragRegistry?.bounds() ?? null,
      focusOrder: () => mru,
      now: () => performance.now(),
      newDragId: () => {
        void invoke<string[]>("focus_order").then((order) => {
          mru = order;
        });
        return `${win.label}-${Date.now()}`;
      },
      emitFrame: (frame) => {
        void emit("deck:drag-move", frame);
      },
      emitEnd: (frame) => {
        void emit("deck:drag-end", frame);
      },
      sendAdoptRequest: (label, request) =>
        emitTo(label, "deck:drag-adopt", request),
      awaitSettled: (token) =>
        new Promise<TransferSettled>((resolve) => {
          settleWaiters.set(token, resolve);
        }),
      detachPaneForTransfer,
      releaseDetachedPane,
      abortDetach,
      openPaneWindow: (args) => invoke<string>("open_pane_window", args),
    });

    dragUnlisteners.push(
      await listen<DragFrame>("deck:drag-move", (event) => {
        dragReceiver?.onFrame(event.payload);
      }),
      await listen<DragEndFrame>("deck:drag-end", (event) => {
        dragReceiver?.onEnd(event.payload);
      }),
      await listen<DragReply>("deck:drag-reply", (event) => {
        windowDrag?.onReply(event.payload);
      }),
      await listen<AdoptRequest>("deck:drag-adopt", (event) => {
        void adoptIntoActiveTab(event.payload);
      }),
      await listen<TransferSettled & { token: string }>(
        "transfer:settled",
        (event) => {
          const waiter = settleWaiters.get(event.payload.token);
          if (waiter !== undefined) {
            settleWaiters.delete(event.payload.token);
            waiter({
              outcome: event.payload.outcome,
              reason: event.payload.reason,
            });
          }
        },
      ),
    );
  }

  void installCrossWindowDrag().catch((error: unknown) => {
    console.warn("terminal-manager: cross-window drag unavailable", error);
  });
```

`deck:drag-end` is broadcast with `emit`, not `emitTo`, for the same reason
`deck:drag-move` is: the source does not know which windows drew an overlay, so
every window must hear the ending. The receiver ignores the frame it sent
itself.

Third, in `TerminalManager.dispose()`, beside the existing `paneDrag.dispose()`:

```ts
    windowDrag?.dispose();
    dragReceiver?.dispose();
    dragRegistry?.dispose();
    dropOverlay.dispose();
    for (const unlisten of dragUnlisteners) {
      unlisten();
    }
    dragUnlisteners.length = 0;
    settleWaiters.clear();
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/terminal/`
Expected: pass — 17 controller tests, 18 receiver tests (15 plus the three
`createDropOverlay` cases), and the untouched `terminal-manager.test.ts` suite.

- [ ] **Step 6: Full gates**

Run: `npm test` then `npm run build`
Expected: both green. `npm run build` is `tsc && vite build`, so it is the
typecheck gate too.

- [ ] **Step 7: Commit**

```bash
git add src/terminal/window-drag.ts src/terminal/window-drag.controller.test.ts \
        src/terminal/window-drag.receiver.test.ts src/terminal/terminal-manager.ts
git commit -m "feat(terminal): drop a dragged pane into another window or a new one"
```

---

### Task D9: Let a single-pane window start a drag

> **BLOCKED ON D1 PASSING.**

**Files:**

- Modify: `src/terminal/pane-drag.ts:118-120`
- Modify: `src/terminal/pane-drag.cross-window.test.ts`

**Why:** `onPointerDown` returns early when `opts.paneCount() < 2`
(`pane-drag.ts:118-120`). That guard is correct for the in-window drag — with
one pane there is nowhere to dock — but it makes the most obvious cross-window
gesture impossible: dragging the only pane of a window out into its own window.
The guard becomes "at least two panes **or** a cross-window handler is
installed".

**Interfaces:**

- Consumes: `PaneDragOptions.onDragEnd` (D6)
- Produces: no new export.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/pane-drag.cross-window.test.ts`. This block reuses the
module-scope `container`, `bar`, `build` and `pointer` helpers D6 placed
**outside** its describe block for exactly this reason — if they were nested,
every assertion below would be a `ReferenceError` rather than the intended red.

```ts
describe("pane drag — single-pane window", () => {
  // One pane filling the whole window, overriding the two-rect default.
  const SOLO = [{ id: 1, left: 0, top: 0, right: 1000, bottom: 800 }];

  it("refuses to start when there is one pane and no cross-window handler", () => {
    const onDragPoint = vi.fn();
    const controller = build({
      paneCount: () => 1,
      slotRects: () => SOLO,
      onDragPoint,
    });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", { clientX: 300, clientY: 300 }),
    );
    expect(onDragPoint).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("starts when there is one pane and a cross-window handler is installed", () => {
    const onDragPoint = vi.fn();
    const controller = build({
      paneCount: () => 1,
      slotRects: () => SOLO,
      onDragPoint,
      onDragEnd: () => false,
    });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", {
        clientX: -50,
        clientY: 300,
        screenX: 360,
        screenY: 413,
      }),
    );
    expect(onDragPoint).toHaveBeenCalledWith(360, 413, false);
    controller.dispose();
  });

  it("does not dock a single pane onto itself inside its own window", () => {
    const onMove = vi.fn();
    const controller = build({
      paneCount: () => 1,
      slotRects: () => SOLO,
      onMove,
      onDragEnd: () => false,
    });
    bar.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(
      pointer("pointermove", { clientX: 300, clientY: 400 }),
    );
    window.dispatchEvent(pointer("pointerup", { clientX: 300, clientY: 400 }));
    expect(onMove).not.toHaveBeenCalled();
    controller.dispose();
  });
});
```

The third case is the one that proves the guard relaxation is safe: with one
pane, `dropTargetAt` returns `null` for the source itself
(`pane-drag.ts:72-74`), so no in-window move can fire. It is a **pin, not a red**
— see Step 2.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/terminal/pane-drag.cross-window.test.ts`
Expected: **exactly one** new failure — case 2, _"starts when there is one pane
and a cross-window handler is installed"_, with `AssertionError: expected "spy"
to be called with arguments: [ 360, 413, false ]` — because `paneCount() < 2`
returns at `pane-drag.ts:118-120` before `beginDrag`, so `onDragPoint` never
fires.

Cases 1 and 3 pass **before** the change and are pins, not reds. Case 1 pins the
old refusal. Case 3 asserts `onMove` was not called, and today the early return
means no listener is even bound — it goes on guarding the same statement after
the change, when `dropTargetAt` returning null for the source
(`pane-drag.ts:72-74`) becomes the reason instead. That both reasons produce the
same observable is exactly why relaxing the guard is safe.

- [ ] **Step 3: Relax the guard**

Replace `pane-drag.ts:118-120`:

```ts
// One pane has nowhere to dock inside its own window, but it can still be
// dragged OUT of it once cross-window drag is installed (spec §11).
if (opts.paneCount() < 2 && opts.onDragEnd === undefined) {
  return;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/terminal/pane-drag.test.ts src/terminal/pane-drag.cross-window.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane-drag.ts src/terminal/pane-drag.cross-window.test.ts
git commit -m "feat(terminal): allow dragging the only pane out of its window"
```

---

### Task D10: Manual verification — what no unit test can reach

> **BLOCKED ON D1 AND D2 PASSING and on D3–D9 being complete.**
> Spec §14 states plainly that real window creation, mixed-DPI coordinates,
> occlusion and focus behaviour are not automatable here. `tauri-driver` has no
> macOS support, so no E2E harness is assumed.

**Files:** none. This task produces observations, not a diff.

Run `npm run tauri dev` and work through the list. Record pass/fail for each
line; a line without an observation is not done.

- [ ] **1. Drop into another window.** Two Deck windows side by side, both
      visible. Drag a pane from window A over a pane in window B. Look at: the
      overlay appears in **B**, over the half of B's pane nearest the cursor, and it
      follows the cursor across B's panes. Release. The pane arrives at that edge,
      its scrollback is intact, and typing reaches the same agent.

- [ ] **2. The source window is not raised and B is not raised.** During step 1,
      confirm that neither window's titlebar changes to the focused style and that
      no window jumps to the front. Spec §11.2 forbids raising the destination.

- [ ] **3. Occlusion — the accepted limitation, verified as a limitation.**
      Put window B _entirely behind_ window A. Drag a pane over the region where B
      sits. Expected: **the drop still lands in B and you cannot see the overlay.**
      This is the stated §11.2 limitation, not a defect. Record what actually
      happened; if the drop lands somewhere else, that _is_ a defect.

- [ ] **4. Drop on empty screen.** Drag a pane to a bare part of the desktop and
      release. A new `deck-<n>` window opens near the release point with that one
      pane. Look at: the window is a full Deck window with one tab, not a bare
      frame.

- [ ] **5. Drop back inside the source window.** Drag a pane out past the edge,
      then back in, then release over another pane in the same window. Look at: the
      in-window dock overlay reappears, the drop is an ordinary in-window move, and
      no new window is created.

- [ ] **5b. Left and top drops land where the overlay said.** Drag a pane into
      window B and release on the **left** half of one of its panes. Look at: the
      arriving pane is on the LEFT of that pane, not the right. Repeat on the
      **top** half. Then repeat both **inside one window** to confirm the
      in-window path is unchanged. This is the D7b defect made visible; the unit
      tests pin the tree shape, but only this shows that the overlay and the
      layout agree.

- [ ] **6. Cmd-drag swap still works.** Hold the platform modifier over a pane
      in the same window: the dashed full-pane `.drop-overlay.is-swap` appears and
      release swaps the panes. Cross-window drag must not have changed this.

- [ ] **7. Escape cancels.** Press Escape mid-drag while the cursor is outside
      the window. Look at: every overlay disappears in **both** windows, no transfer
      runs, the pane stays put. This is the `deck:drag-end` path (D6 Edit 4 →
      D8 `onDragCancel`) — the one ending that never reaches `pointerup`, so it
      is the likeliest place for an orphaned overlay to survive.

- [ ] **8. The only pane of a window (D9).** Window B holds exactly one pane.
      Drag it into window A. Look at: it docks in A, and B closes itself (spec
      §10.3 step 3) rather than respawning a shell.

- [ ] **9. Mixed-DPI drop.** With the D2 hardware — window A on the 2x display,
      window B on the 1x display — drag a pane from A to B and drop it on B's
      **right half**. Look at: the overlay is over the right half, not offset, and
      the pane lands on the right. Then drag a whole window between displays
      mid-session and repeat. This is where a stale `scaleFactor` shows up as an
      overlay several hundred pixels away from the cursor.

- [ ] **10. Three windows, overlapping.** Open three windows with overlapping
      bounds. Drag over the overlap. Look at: exactly **one** overlay is visible at
      a time, and it is in the most recently focused of the overlapping windows —
      the D5 tiebreak, observed rather than assumed.

- [ ] **11. Destination closed mid-drag.** Start a drag toward window B, then
      close B with ⌘W while still holding the button, then release over where B was.
      Look at: no crash, the pane stays in A or lands in a new window, and no
      overlay is orphaned on screen.

- [ ] **12. A busy agent survives the move.** Start a long-running agent command
      in the pane, drag it to another window mid-output. Look at: output continues
      in the destination with no duplicated and no missing lines around the seam.

- [ ] **13. Windows parity.** Repeat items 1, 4, 5, 7 and 9 on the Windows build
      from D1. If D1 passed but any of these fail, stop and report — a passing
      capture measurement does not guarantee a working drop path.

- [ ] **14. Record the outcome.** Write the results into `AGENTS.md`'s "In
      flight" list, including anything left unobserved, and only then call Phase B
      done (L5/W4).

---

## Findings

### (a) Spec claims that are wrong or unsupported against the code

1. **`file-drop.ts:15` is the wrong path.** The file is
   `src/terminal/file-drop.ts`, not `src/lib/file-drop.ts` (spec §11.3 and
   §12 both cite the bare name; the plan reader will look in `src/lib/`).
   Line 15 does document the trap — but as a **known limitation of a cache that
   is still there**, not as a solved pattern: `installFileDrop` reads
   `scaleFactor()` once at install and its own comment says the value "can
   drift". So §11.3's "the same trap `file-drop.ts:15` already documents" is
   true, while any reading of it as "we already do this correctly" is false.
   Fixing `file-drop.ts` is **out of scope** for this section (W3) — flagged,
   not done. Confirmed by the lead: it carries into the merged plan as a known
   adjacent defect with this evidence.
2. **§6 does not publish the two measured samples it is cited for.** It gives
   the formula, one window origin (`innerPosition` = 820,226, `scaleFactor` = 2)
   and one `pointerup` value (`clientX = -227`); the two raw
   `(screenX, clientX)` pairs whose residual was 0 are not in the document. My
   D3 test therefore **reconstructs** one pair (`screenX = 183 → clientX = -227`)
   from the published numbers and labels it as reconstructed in the test comment.
   **Closed with data, not a comment:** D3 Step 6 replaces the fixture with the
   raw rows D1 Step 5 and D2 Step 3 record, and both gates now say to keep the
   full coordinate tuples rather than only the residual. §6 should gain those
   rows too.
3. **§7.3's command table is missing `stage_transfer`,** which the frozen
   contract given to the implementers contains. Not a blocker for this section
   (it never calls it), but the table is incomplete.
4. **§5's fact table says "In-window pane drag uses Pointer Events +
   `setPointerCapture`" — true, but capture is taken on the tab container
   (`pane-drag.ts:142`), not on `document` or `body`.** If the container is
   replaced or removed mid-drag the capture goes with it. `layout.sync` replaces
   the container's _children_ only (documented at `pane-drag.ts:82-86`), so this
   holds today — but a cross-window drop that empties the source window is a new
   way for that element to disappear mid-gesture. Item 8 of D10 is where it
   shows up.
5. **`spacevibe-deck` is a public repo,** so the only Windows artifact job
   (`windows-engineering-bundle`) refuses to run — see (e).

6. **`movePane` cannot adopt, and nothing says so.** `src/lib/split-tree.ts`
   exports `splitLeaf` (direction, appends to `b`) and `movePane` (edge, but
   requires the source already in the tree, `:65-68`). Neither serves "dock a
   pane arriving from another window", and the failure is silent in both
   directions — wrong side, or no move at all. Task D7b adds `dockNewPane` and
   its doc comment says why the other two do not fit, so the next reader does
   not have to re-derive it.

### (b) Expected conflicts with the other sections

1. **RESOLVED — `adoptIntoActiveTab({ token, targetPaneId, edge })`.** Renamed
   from `adoptPaneIntoActiveTab` at the lead's direction; the frontend section
   owns that module and its name wins. Called by the destination window when it
   receives `deck:drag-adopt`, not by this section directly.
2. **RESOLVED — `open_pane_window({ token, screenX?, screenY? })` takes CSS
   pixels; Rust converts to physical.** I raised the unit risk (getting it wrong
   puts the new window on the wrong monitor); it is now pinned on both sides.
3. **The destination's `slotRects()` comes from `terminal-manager.ts:482-492`,**
   the same options object the frontend section is also editing. Confirmed with
   the lead: the conflict is expected, additive on both sides, and the lead
   sequences the sections so it merges rather than collides. My edit stays as
   written.
4. **RESOLVED — `deck:drag-adopt` keeps carrying `{ token, targetPaneId, edge }`;
   it is deliberately NOT routed through Rust.** I raised this because §0.2's
   `transfer:offer` carries `{ token }` only — enough for the menu path but not
   for a drop, where the destination also needs to know *where* in its layout
   the pane lands. The alternative I offered was to let `offer_transfer` carry
   the token and shrink `deck:drag-adopt` to the geometry.

   **Chosen, with reasoning, so the next reader does not read this as a
   default:** `transfer:offer` is layout-blind on purpose. Rust owns pane
   *ownership*, not pane *placement*; the moment a Rust payload carries
   `targetPaneId` and `edge`, the coordinator has to understand a layout tree it
   has no business knowing about. The menu path is the proof that the split is
   drawn in the right place — it needs no placement information at all, because
   it adopts into a new tab. Placement therefore travels window-to-window on
   this section's own event, and `deck:drag-adopt` is not a contract change.
5. **`adoptIntoActiveTab` must place with `dockNewPane` (Task D7b), not
   `splitLeaf`.** Reported to me as "`splitLeaf` always puts the new pane in
   slot `b`, so left/top drops dock on the wrong side". Verified, and the
   framing needs one correction: `splitLeaf` (`src/lib/split-tree.ts:31-39`)
   takes a `Direction`, not an `Edge`, and is the Cmd+D split action
   (`terminal-manager.ts:352`) where "new pane second" is intended — it is not
   defective, it is the wrong tool. In-window drag is already correct via
   `movePane` → `dockIntoLeaf(..., sourceFirst)` (`:75`, `:96-97`), pinned by
   `split-tree.test.ts:69-110`. **The actual hazard is sharper:** `movePane`
   returns the tree BY REFERENCE when the source leaf is not already in it
   (`:65-68`), so for an adopted pane it is a silent no-op — leaving `splitLeaf`
   as the only exported function that looks like it fits. D7b adds
   `dockNewPane` so there is a right answer to reach for. **If the frontend
   section has already written `adoptIntoActiveTab` against `splitLeaf`, that is
   a live wrong-side bug**, and its own tests must assert tree shape, not
   `leafIds` membership.
6. **`capabilities/default.json` widening to `["main", "deck-*"]` is the
   lifecycle section's Task B5**, which verified the generated schema accepts
   glob labels. The dependency is real and the failure mode is the expensive
   kind: if it lands late the relay is **silently one-directional** — main hears
   the deck windows, the deck windows are denied — rather than breaking loudly.
   Nothing in D3–D9 will fail a unit test because of it; it shows up first at
   D10 item 1.
7. **RESOLVED — no ack; the drop path awaits `transfer:settled`.** My finding
   stands (`emitTo` resolves at send, so a destination-side adopt failure never
   reached the abort path), and the fix is the transfer section's
   `transfer:settled { token, outcome, reason? }`, emitted to both the `from`
   and `to` labels inside the route-finalising lock. It is authoritative where a
   webview ack would not be: Rust can settle a transfer the §7.5 ten-second
   bound already aborted, which the destination never hears about. D8 now
   distinguishes three failure shapes — dispatch failed (source aborts),
   settled `aborted` (keep the pane, do **not** double-abort), settled
   `committed` (release).
8. **RESOLVED — `focusOrder()` reads the lifecycle section's `focus_order()`.**
   A Rust command returning the MRU roster, most recent first. Read-only by
   construction, which matters: it must never become a back door to raising the
   destination mid-drag, since spec §11.2 forbids exactly that.
9. **RESOLVED — the `console.warn` sites stay.** The persist-error bar is for
   user-visible failures; a dropped relay frame or a refused settlement is
   diagnostic. Not worth a fork.

### (c) Forks I hit and did NOT decide

1. **§11.4 Windows pointer capture — untouched, by instruction.** D1 is written
   as a gate that stops the plan. The three spec options are reproduced verbatim
   and not ranked.
2. **A distinct cross-window overlay affordance.** The relayed overlay is the
   same `.drop-overlay` as the in-window one, so a user cannot tell from the
   overlay alone whether the pane will change windows. Making it distinct is an
   R2 change to `docs/DESIGN-LANGUAGE.md` — flagged, not decided.
3. **Cross-window _swap_.** The in-window drag supports Cmd-drag swap
   (`.drop-overlay.is-swap`). My receiver only ever docks. Swapping two panes
   across windows would be two transfers in opposite directions and is not in
   spec §11. Flagged as out of scope, not decided.
4. **Whether a drop on a non-Deck application should do anything.** Spec §11.1
   says a drop "outside every Deck window" creates a new window — which includes
   dropping onto Finder, a browser, or the Dock. I implemented exactly that.
   Whether dropping onto another app should instead cancel is a product call.

**Two gaps I closed inside the plan rather than escalating,** both routine and
both listed here so they can be overruled cheaply:

- **Same-frame tie between two windows** (§11.1 does not state a rule):
  most recently focused window wins. Rationale in D5.
- **Registry scope**: `window-registry.ts` tracks only _this_ window's bounds.
  Cross-window hit-testing is done by each window answering for itself, because
  a source-held map of everyone's geometry is the cached-bounds trap wearing a
  different hat.

**Two deviations from the section brief — both ACCEPTED by the lead:**

1. **D3–D5 may be written before the D1 Windows gate returns.** Pure geometry,
   needed under every branch of the fork including `SetCapture`. Rationale in
   the *Blocking order* section above.
2. **`window-registry.ts` tracks only THIS window's bounds.** A source-held map
   of every window's geometry is the cached-bounds trap in a different shape —
   the source cannot observe another window's move, resize or scale change, only
   that window can. Each window answers for itself (D7). The MRU roster from
   `focus_order()` is a separate thing and is fine to hold: it is an ordering,
   not geometry.

### (d) Are `dropTargetAt` and `edgeFor` genuinely pure and reusable across windows?

**Yes — verified by reading `src/terminal/pane-drag.ts:35-79` in full.**

Evidence:

- `edgeFor(rect, x, y)` (`:35-53`) reads only its three parameters, calls only
  `Math.min`, and returns a string literal. No DOM, no closure variable, no
  module state, no mutation of `rect`.
- `dropTargetAt(rects, x, y, sourceId)` (`:59-79`) iterates its `readonly`
  parameter, compares numbers, and delegates the edge to `edgeFor`. Same: no
  DOM, no closure capture, no `this`.
- Both are declared at module scope **above** `createPaneDragController`
  (`:88`), so they cannot capture any controller state, and the controller
  itself calls `dropTargetAt` through the injected `opts.slotRects()`
  (`:165`) rather than reaching into the DOM.
- Their existing tests already exercise them with hand-written `PaneRect`
  literals and no DOM (`src/terminal/pane-drag.test.ts:1-12`), which is direct
  proof they run outside a browser environment.

**One caveat that changes how they must be called, not whether:** their `x`/`y`
are **client** coordinates in _one_ window's viewport, because the rects come
from `getBoundingClientRect()` (`layout-engine.ts:190`). They are reusable
across windows only if each window converts the relayed screen point with its
**own** bounds _before_ calling them. That ordering is why D3 exists as a
separate task and why D7's receiver converts first and hit-tests second.

`overlayRectFor` (D7) is a new extraction from the controller's imperative
`showOverlay` (`:177-206`) with the same purity property, needed because the
destination has to draw the identical box without owning the source's closure.

### (e) Is a Windows machine reachable from this repo's tooling?

**No — not for this measurement, and one of the two paths is currently blocked
outright. The lead is taking this to the user as a BLOCKER, not a footnote:
Phase B stalls at D1 until hardware is scheduled.**

- `.github/workflows/ci.yml:66` and `:114` run `windows-latest`. They build,
  typecheck and run `cargo test` — they are **non-interactive**. A pointer-capture
  measurement needs a human moving a mouse across a window edge and watching the
  event stream. A CI runner cannot produce a single row of the D1 table.
- The only job that produces a runnable Windows artifact is
  `windows-engineering-bundle` (`.github/workflows/ci.yml:111`). It is
  `workflow_dispatch`-only **and** its first step throws unless
  `github.event.repository.private == "true"`. `gh repo view --json isPrivate`
  returns **`false`** for `mxrsv/spacevibe-deck`, so **that job cannot run at
  all right now.**
- The repo's own history says the same thing from another angle: `AGENTS.md`
  records that Windows E2E was **deliberately skipped** for v0.11.0 (2026-08-05)
  and that `ShellExecuteW` "is therefore in the shipped binary but never
  observed running", and the one Windows installer defect on record arrived as a
  **third-party user report**, not from a machine in this workflow.

**Consequence for D1:** the gate needs a real interactive Windows machine — the
maintainer's own, a VM, or a cloud desktop — or a private mirror to unlock the
artifact job. That is a prerequisite to schedule, not a step to run. Because the
lead accepted the D3–D5 deviation, the hardware question can be answered in
parallel while the pure tasks are written; nothing touching a pointer, an
overlay or a transfer starts until D1 returns.
