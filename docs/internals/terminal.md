# Terminal, panes and tabs

The stage is a set of tabs, each a split tree of panes, each pane one xterm.js instance bound
to one PTY that the main process owns. This page covers the PTY manager and its ownership
model, the tab and layout layer in the renderer, how a tab is materialized and an agent
launched into it, how a pane's phase and attention are derived, and the close, quit and
window-transfer protocols. The vocabulary is in [glossary.md](glossary.md).

## PTY ownership (main)

[`electron/pty/manager.ts`](../../electron/pty/manager.ts) spawns and owns every PTY.
Ids are process-local integers from 1, never reused.

- **Every pane command validates ownership through the coordinator first.** `write_pty`,
  `resize_pty` and `kill_pty` call `assertOwner(paneId, windowLabel)`; a pane routed to
  another window, or one mid-transfer, is refused with a `PaneAccessError`. Output is
  delivered by `coordinator.deliver`, which drops (never broadcasts) an event with no route.
- **Spawn** runs the user's login shell (`$SHELL -l` on macOS; `pwsh.exe` or Windows
  PowerShell on Windows, which throws rather than falling back to `cmd.exe`) with
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=SpaceVibeDeck` and
  `encoding: null` so bytes arrive as Buffers and a streaming UTF-8 decoder can hold back a
  split code point. `ConEmuANSI=ON` is set on macOS only, so Claude Code emits OSC 9;4.
  On Windows node-pty ignores the encoding and delivers strings, which the decoder passes
  through untouched.
- **Output is batched** ([`stream.ts`](../../electron/pty/stream.ts)): chunks queue up to
  64 KiB per batch, the source is paused above 512 KiB queued, and batches go out on a
  microtask. Three events reach the renderer: `pty:output` `{ id, data }`, `pty:exit`
  `{ id }` and `pty:prompt-ready` `{ id }`.
- **Main parses exactly two OSC sequences** ([`shell-integration.ts`](../../electron/shell-integration.ts)):
  `133;B` (prompt ready) and `9;9;<path>` (current directory). At most the last 8 cwd
  candidates per batch are probed, backwards, and a UNC-shaped root is rejected before any
  filesystem call, because probing `\\host\share` offers NTLM credentials to that host.
- **Kill** signals the foreground process group with SIGHUP, then SIGKILL after 500ms, and
  the shell group outright; groups 0 and 1 are refused. `killAll` reads the process table
  once for the whole batch. On Windows it is `taskkill /T`, which only walks the tree that
  exists at call time, so a crashed Deck orphans agents; accepted.

## Process classification

`pty_info` answers `{ id, cwd, process, kind, agent }` per pane
([`electron/pty/info.ts`](../../electron/pty/info.ts)), where
`kind` is `idle-shell` / `agent` / `busy` / `unknown`.

- The foreground process is found from a **measured `ps` snapshot**, not node-pty's
  `.process` getter, which reads a truncated `p_comm` and once answered a version string for
  a `claude` pane. macOS runs `/bin/ps -A -o pid=,pgid=,tpgid=,tty=,args=` and joins on the
  pane's tty; `tpgid` names the foreground group. Windows runs one `Get-CimInstance
  Win32_Process` snapshot and walks the shell's descendant tree, picking the deepest, newest
  process. Both reads reject rather than answer when the table cannot be read.
- Classification ([`platform/classify.ts`](../../electron/platform/classify.ts)): a built-in
  agent by binary name or by the script an interpreter is running, then a user-declared
  matcher (label as identity), then a shell name → `idle-shell`, otherwise `busy`. An
  incomplete reading is `unknown`.
- **`unknown` is neither idle nor busy.** The census treats it as "cannot say", and a failed
  reading never becomes an empty census.
- cwd is the live `lsof -d cwd` answer first (macOS only), then the last OSC 9;9 the shell
  printed. On Windows the injected prompt's OSC 9;9 is the whole cwd story.

## Tabs, panes and layout (renderer)

- **[`TabManager`](../../src/terminal/tab-manager.ts)** owns the tabs: a list of
  `TabEntry { key, manager, openedAt, workspacePath }`. `workspacePath` is fixed for the
  tab's life and never re-derived from a pane's cwd. It publishes `tabViews` and
  `activeTabIndex` ([`tabs-store.ts`](../../src/terminal/tabs-store.ts)); every pane appears
  in `TabView.panes`, agent or not, and filtering belongs to the surface that renders rows.
  `syncViews` rebuilds the views from the 2-second pane poll and re-applies name and colour
  overrides so a rename survives polling.
- **[`TerminalManager`](../../src/terminal/terminal-manager.ts)** owns one tab's panes and its
  split tree ([`split-tree.ts`](../../src/lib/split-tree.ts), immutable; every operation
  returns a new tree). A split or dock takes a **fresh** cwd from `pty_info`, not the poll
  cache, and assigns `activeId` directly because `setActive` applies ratios to a DOM that
  does not match the just-split tree yet. `closePane` refuses a pane whose route is
  transferring: an aborted transfer would return an agent to a window with no UI for it.
- **[`LayoutEngine`](../../src/terminal/layout-engine.ts)** maps the tree to the DOM: Focus
  Expand gives the active pane at least 65% along its path, ratios clamp to 15–85%, zoom is an
  overlay that a structural rebuild drops first, and hit-testing goes through the engine so
  no consumer queries `.pane-slot` itself.
- **Pane** ([`pane.ts`](../../src/terminal/pane.ts)): xterm with fit, search, serialize,
  unicode-graphemes and WebGL addons. WebGL is attempted once at mount; failure or context
  loss disposes the addon and leaves the DOM renderer, never restarting the pane. `flush()`
  waits for xterm's write drain so a transfer serializes after every byte landed. Paste is
  bracketed and `\n` becomes `\r`, the only route that lands a multi-line body in an agent
  TUI's composer as one block.
- **Strip order** is one window-wide clock ([`open-sequence.ts`](../../src/lib/open-sequence.ts)):
  terminal tabs, documents and the browser tab share it, keys are never reused, and
  [`mergeStripOrder`](../../src/lib/strip-order.ts) is walked by both the keyboard
  (`TabManager`) and the paint (`TabStrip`), so ⌘1–9 and tab cycling count chips.
- The closed-tab stack holds 10 snapshots in memory (`layout`, `cwds`, `name`, `dotColor`,
  `workspacePath`); ⌘⇧T reopens with fresh shells and does not re-run agents.

## Materialization and agent launch

`MaterializeIntent` ([`tab-materialize.ts`](../../src/terminal/tab-materialize.ts)) is the
one interface behind the Open board, the quick picker, closed-tab reopen, presets, rail drop
and session restore. `TabManager.materialize` owns the implementation.

| Field           | Contract                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| `layout`, `cwds` | The split tree and one cwd per leaf, left to right; cwd policy is `fresh`, `polled`, `none` or `given` |
| `agent`         | The agent to type into every pane; `null` for a reopen                                     |
| `launchCommand` | `undefined` resolves the agent's default preset, `null` forces the bare binary, a string is typed as is |
| `paneCommands`  | Per-pane commands that override `agent`; session restore's path                            |
| `workspacePath` | Absent means a tab with no workspace                                                       |

- **An agent is typed, not spawned.** [`AgentLauncher`](../../src/terminal/agent-launch.ts)
  writes `<command>\r` into the pane's interactive shell once it is ready, so the command
  inherits the shell's real `PATH`. On macOS readiness is first output, with a 3-second
  fallback; on Windows only `pty:prompt-ready` counts and a 15-second timeout cancels that
  pane and reports it. Each pane is typed into exactly once; a failed write leaves a plain
  shell and never sinks the tab. The launcher's keystrokes count as input so the echo does
  not light the working spinner.
- **The command is a string, validated at the door.** `commandProblem` in
  [`launch-profile.ts`](../../src/lib/launch-profile.ts) refuses separators, substitution,
  redirects, quotes, globs and newlines, and caps at 200 characters, because the string
  reaches a live shell verbatim. Resolution order in
  [`launch-command.ts`](../../src/lib/launch-command.ts): the starred preset, then any
  preset for the agent, then the catalog's shipped `defaultCommand`, then the bare binary.
- **The catalog** ([`agent-catalog.ts`](../../src/lib/agent-catalog.ts)): a built-in's id, its
  binary name and its bare command are the same string, which is what keeps every
  `lastAgent` on disk resolving. Order is the digit-key contract, so new agents append.
  Discovery probes `sh -ilc "command -v <name>"` on macOS (interactive and login, because
  CLIs register `PATH` in rc files) and walks `PATH` with `.cmd`/`.exe` suffixes on Windows.
  Probe names are restricted to `[A-Za-z0-9._~+/-]`, enforced again in main.

## Agent phase and attention

Two independent axes per pane, both computed in the renderer and both gated on the last
poll having classified the pane's foreground process as an agent.

- **Phase** ([`agent-activity.ts`](../../src/terminal/agent-activity.ts)):
  `unknown` / `idle` / `working` / `exited`. OSC 9;4 progress, parsed from every output chunk,
  is the sole source once a pane has emitted one (state 0 clears; 2 is error; 4 is warning;
  anything else is working). Otherwise a sustained-output heuristic: at least 400ms of
  continuous output still fresh within 3 seconds, ignoring output within 300ms of the user's
  own keystrokes. A process change resets the record so a stale "busy" cannot pin the
  spinner. A 3.2-second re-sync timer feeds a synthetic idle when activity decays.
- **Attention** ([`agent-attention.ts`](../../src/terminal/agent-attention.ts)):
  `none` / `completed` / `requested` / `warning` / `error`, latched until acknowledged and
  never downgraded. Explicit signals (OSC 9;4 severity, OSC 9 or 777 notifications, the
  bell) outrank the heuristic, which may only ever produce `completed`. The UI reads
  attention before phase. `hasRun` separates a pane that finished and was checked (`done`)
  from one that never ran anything (`idle`).
- **Acknowledge** clears attention and per-pane unread, never phase. Focus counts only when
  the window is foreground, the tab is active, and DOM focus rests inside the pane.
- Notifications dedupe on the latch identity, so only a newly raised or escalated kind is
  forwarded, and the OSC classifier never carries the payload's title or body text.

## Actions, keymaps and the menu

- [`action-registry.ts`](../../src/terminal/action-registry.ts) is the one list of actions:
  id, label, scope, menu placement and the `destructive` flag. Keymaps live in
  [`default-keymaps.ts`](../../src/terminal/default-keymaps.ts) as `MACOS_KEYMAP` and
  `WINDOWS_KEYMAP`; user rebinds are applied by `active-keymap.ts`.
- **Bind on whatever the menu accelerator binds on.** An action with a macOS menu item must
  use a character binding, because a Cocoa accelerator is declared by character; physical
  (`event.code`) bindings are only for actions with no menu item, which is what makes the
  bracket and digit chords work on non-US layouts. Ctrl+Alt chords are skipped while AltGr
  is down.
- **The overlay guard** ranks open overlays `pane` 0 < `settings` 20 < `board` 30 <
  `modal` 40 and blocks an action while any open rank is `>=` its scope's rank; `>=` is
  what makes two modals exclude each other with no extra concept.
- **A chord that cannot act does not eat the key.**
  [`action-performable.ts`](../../src/terminal/action-performable.ts) is asked before
  `preventDefault()`; a false answer leaves the event to whatever holds focus. Three
  predicates exist: `copy-selection` needs a terminal on the stage; `copy-or-interrupt`
  (Ctrl+C on Windows) needs a terminal and a selection, and otherwise lets xterm encode the
  interrupt itself, because Deck writes no `\x03`; `toggle-markdown-view` needs a document
  that can toggle.
- **The menu is generated on Tauri and derived at runtime on Electron.**
  `scripts/generate-menu.ts` writes `src-tauri/src/menu_registry.rs`; `electron/menu.ts`
  imports the registry directly and builds the native menu on macOS only, installing
  `null` elsewhere so Electron's default accelerators cannot reload or close the window.
  Accelerators are suspended app-wide while any window records a shortcut, keyed by sender
  so a dead window cannot strip them for the rest of the run. The `destructive` actions
  (`close-pane`, `close-tab`, `clear-buffer`) are suppressed while a chrome text field holds
  the caret, because a menu event cannot say whether it came from a keystroke or a click.

## Close, quit and the census

- **The census is computed in main from live PTY state**, so a wedged renderer cannot make
  quit unanswerable. `censusFor` ([`quit-flow.ts`](../../electron/quit-flow.ts)) names busy
  processes and counts busy panes; `agent` and `busy` are busy, `unknown` makes the census
  not fully named. A reading that fails yields null, and null is refused, not treated as
  empty: refusing to close is recoverable, killing an agent on a guess is not.
- **Window close** always routes through the renderer, even with nothing busy, because the
  renderer's guard flushes debounced state before it auto-confirms. Order is load-bearing:
  abort any transfer involving the window first, then census. `CloseFlight` is per window;
  `QuitFlight` is app-wide, so a second ⌘Q while the dialog is open does nothing.
- **Quit** asks one window with every window's unsaved files deduplicated, and skips the
  question only when there are no panes and nothing dirty. With no window to answer it kills
  the PTYs and exits. `confirm_quit` runs `killAll` → telemetry flush → `saveAll` → exit.
- **An update install bypasses the census** through `isInstalling()`, because
  `quitAndInstall` closes every window before `before-quit` and the renderer already
  confirmed. `prepareForInstall` runs the same three steps.
- **Renderer-side** ([`close-coordinator.ts`](../../src/terminal/close-coordinator.ts)): ⌘W
  closes the pane, or the tab when it is the last pane; the busy dialog runs on the final
  target and the id confirmed is the id closed, re-pinned after the dialog because a
  `pty:exit` can move focus during it. Tab-level guards never aggregate busy and dirty into
  one dialog; only window close and quit do. The last tab closing leaves the window on the
  Open board.

## Moving a pane between windows

The coordinator ([`electron/coordinator.ts`](../../electron/coordinator.ts)) routes every
pane to exactly one window or to an in-flight transfer.

1. `prepare_transfer` moves the route to `transferring`; output buffers up to 4 MiB.
2. The source serializes the pane (after `flush()`) and `stage_transfer`s the payload.
3. `open_pane_window` (flat `{ token, screenX?, screenY? }`) or `offer_transfer` names the
   destination; the destination `claim`s the payload and `commit`s.
4. Buffered events flush in order, then `transfer:settled` reaches both sides and the route
   is re-owned. Abort, a 10-second timeout, a full buffer or a dead destination settle as
   aborted and return the pane to the source; a dead source does not abort.

`paneId` crosses `prepare_transfer` as a string and is coerced; `offer_transfer` sends
`targetLabel`; `open_pane_window` takes its arguments flat. All three shapes are frozen by
[`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts).
A window's `close` aborts transfers involving it before anything else; `closed` terminates
the panes it still owned.
