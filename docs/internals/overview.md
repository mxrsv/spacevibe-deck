# Architecture overview

SpaceVibe Deck is an Electron desktop terminal for running several AI agent CLIs side by
side. The main process (`electron/`) owns everything the renderer cannot: PTYs, the process
table, windows, persistent stores, the native menu, the updater, usage analytics, git
worktrees and agent session lookup. The renderer (`src/`) is Preact plus xterm.js, and reaches
the host only through the facades in `src/host/`.

## Two hosts, one renderer

`main` still carries a second host, the Tauri 2 + Rust app under `src-tauri/`. It is
**feature-frozen**: releases ship Electron on both platforms, `release.yml` builds Tauri only
by hand from a tag that already shipped, its last version is 0.12.3, and its updater endpoint
now answers 404. It stays in the tree because a hotfix must remain possible and because CI
still compiles and tests it. New product features land on Electron so they are not
implemented twice. See [release.md](../operations/release.md#tauri-hotfix).

Consequences for anyone reading `src/`:

- A renderer change reaches both hosts. A feature that needs a new host command exists only
  on Electron; the renderer degrades on Tauri through an `available` flag rather than a
  separate Tauri implementation.
- Command and event names are **identical** to the Tauri build's, so the renderer's call
  sites and tests did not change with the host.
- Electron-only channels are the majority now: session restore and tails, repositories and
  worktrees, the file explorer, the browser tab, themes, session history, external apps,
  telemetry, the updater and GitHub star. Both hosts share the PTY surface, `pty_info`,
  `git_branch`, `dirs_exist`, `detect_agents`, `resolve_paths`, `open_editor`,
  `usage_snapshot`, the store, dialog, shell and window facades, and the quit and
  window-close protocol.

## Process model

**Main** ([`electron/main.ts`](../../electron/main.ts)) keeps two rules: the quit and
window-close census is computed in main from live PTY state, so a wedged webview cannot make
quit unanswerable; and every pane command validates ownership through the coordinator
before it touches a session. Windows are `BrowserWindow`s with `contextIsolation`, no node
integration, a preload, and `will-navigate` and `window.open` denied, because a navigation
would re-inject the host bridge into whatever just loaded. On Windows a single-instance lock
keeps two processes from sharing one `userData`.

| Directory              | Owns                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| `electron/pty/`        | node-pty sessions, output batching, the streaming UTF-8 decoder, `pty_info`      |
| `electron/platform/`   | Process classification, the `ps` / WMI snapshot, kill, shell launch per platform |
| `electron/coordinator.ts`, `window-lifecycle.ts`, `quit-flow.ts`, `dirty-registry.ts` | Pane → window routing, transfers, labels, the census and its flights |
| `electron/menu.ts`, `menu-state.ts` | The macOS menu built from the action registry at runtime                   |
| `electron/store.ts`, `settings-merge.ts`, `settings-ipc.ts` | JSON stores in `userData`, write locks on unreadable files, the settings patch |
| `electron/fs/`         | Path guard, reads, atomic writes, directory watches, workspace containment        |
| `electron/browser/`    | The `WebContentsView`, URL policy, react-grab injection                          |
| `electron/resume/`, `sessions/` | Session scanners per agent, resume resolution, session tails, history  |
| `electron/usage/`      | Token-usage scanner (a port of the Rust one, held equal by a golden fixture)     |
| `electron/updater/`    | electron-updater lifecycle and the cross-window check flight                     |
| `electron/telemetry/`  | Consent state, day buffers, the daily POST                                       |
| `electron/git.ts`, `worktrees.ts`, `git/worktree.ts` | `git_branch`, repository scans, `git worktree add` via `execFile` |
| `electron/agents.ts`, `links.ts`, `external-apps.ts`, `images.ts`, `prompt-assets.ts`, `github-star.ts`, `themes.ts` | Discovery, path resolution, external apps, images, prompt assets, `gh`, the themes folder |
| `electron/ipc/`        | The channel table and one `register-*.ts` per service                            |

**Renderer** ([`src/main.tsx`](../../src/main.tsx)) boots in a fixed order: desktop
environment, the window's boot mode (normal or adopting a transferred pane, read before
anything renders), settings, store-failure listener, then presets, workspaces,
repositories, logo, banner and custom themes in parallel, then `render`. Custom themes are
awaited before first paint so an imported theme cannot flash.

| Directory           | Owns                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `src/host/`         | One facade per host service, built from the preload's two functions                    |
| `src/terminal/`     | `TabManager`, `TerminalManager`, panes, layout, materialization, launch, attention, keymaps, the journal and restore |
| `src/ui/`           | The shell: `App`, the rail, the strip, the dock, modals, settings, toolbar             |
| `src/files/`        | File surfaces, the explorer tree, the editor, the rendered markdown view               |
| `src/browser/`      | The browser tab's store and grab delivery                                              |
| `src/links/`, `src/lib/terminal-links.ts` | Path detection and external-app routing                          |
| `src/open-board/`   | The start surface: recents, the worktree form                                          |
| `src/launcher/`, `src/prompts/` | The new-task prompt composer (partially wired) and the Prompt Board        |
| `src/settings/`, `src/presets/`, `src/repositories/`, `src/sessions/`, `src/usage/`, `src/telemetry/`, `src/updater/` | Stores and pure models per feature |
| `src/lib/`          | Pure helpers: the agent catalog, launch profiles, split tree, colour derivation, keybindings, strip order |
| `src/chrome/events.ts` | Window-scoped chrome signals (board, settings, picker, path-open requests)           |
| `src/styles/`       | The one stylesheet, numbered partials imported in cascade order                        |
| `src/gallery/`      | The design gallery, a second Vite entry that must never enter the shipping bundle      |

State is Preact signals; module stores are window-scoped (R5).

## The bridge and its contract

The preload exposes exactly two functions on `window.__deckHost`, `invoke(channel, payload)`
and `listen(event, handler)`, mirroring Tauri's `invoke` / `listen`. `invoke` refuses any
channel outside `INVOKABLE_CHANNELS`, the closed set of
[`CHANNELS`](../../electron/ipc/channels.ts) plus the eighteen plugin-derived names; an open
bridge in a `sandbox: false` renderer was one injected script away from `spawn_shell` plus
`write_pty`. `listen` returns an unlisten function and drops the Electron event object.

- **Payloads are flat (R6).** Where the frozen contract sends flat keys, handlers destructure
  flat keys. [`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts)
  scrapes both sides and fails when a handler reads a key the renderer never sends or the
  renderer invokes a channel nothing registers. Both sides are typed separately, so this is
  the only place a mismatch shows before the running app.
- **Host detection is one presence check.** `available` in
  [`worktree-host.ts`](../../src/host/worktree-host.ts) (and its twins) reads
  `globalThis.__deckHost` directly: Electron true, Tauri and the browser preview false. A
  facade that can degrade answers null or an empty list; one that cannot throws
  "Deck host bridge is unavailable", which is what a browser-only `npm run dev` shows on
  every host call.
- **Requests, not replies, bound batched answers.** A facade that sends N requests walks its
  own N when decoding, so a host answering with a different length cannot change how many
  panes get an answer.
- Events are colon-namespaced (`pty:output`, `settings:merged`, `fs:changed`,
  `browser:state`, `telemetry:state-changed`, `store:write-failed`); commands are snake_case.

## Persistence

Everything lives under `app.getPath("userData")` (`SpaceVibe Deck` for the release identity).
The renderer may open only the allowlisted stores `settings.json`, `workspaces.json`,
`presets.json`, `logo.json`, `workspace-logos.json`, `sidebar-banner.json`,
`update-attempt.json`, `repositories.json` and `session.json`. `telemetry.json` and
`usage-cache.json` are main-only on purpose, and `themes/` is read as text.

- A store that parses to a non-object, or fails to read for any reason but `ENOENT`, is
  **unreadable and write-locked**: a failed read never becomes permission to overwrite
  recoverable bytes with defaults. Settings' Retry re-reads it.
- The settings patch is a shallow top-level merge that drops three named retired keys and
  nothing else, then broadcasts `settings:merged` to every window including the sender,
  which is the one authoritative path; the reply exists only to detect a failed write.
- Every write is atomic through one implementation in `electron/fs/write.ts`.
- `saveAll` on quit uses `allSettled`, so one failing store cannot skip the rest.

## Load-bearing seams (R4)

These modules require a plan and cross-boundary verification, not a drive-by refactor:

- PTY ownership and process classification (`electron/pty/`, `electron/platform/`).
- The window coordinator and transfer protocol (`electron/coordinator.ts`).
- Tab materialization (`MaterializeIntent`, `TabManager.materialize`, `AgentLauncher`).
- Layout (`split-tree.ts`, `layout-engine.ts`).
- Close and quit coordination (`quit-flow.ts`, `close-coordinator.ts`, the census).
- The `SurfaceStrip` seam between `TabManager` and the file and browser stores.
- `ManagerCallbacks` between `TerminalManager` and the tab layer.

Each is described in [terminal.md](terminal.md), [file-surface.md](file-surface.md) and
[agent-rail.md](agent-rail.md).

## Other fixed points

- The macOS menu is derived from [`action-registry.ts`](../../src/terminal/action-registry.ts)
  at runtime on Electron and generated into `src-tauri/src/menu_registry.rs` for Tauri; the
  registry is edited, never the output (R3).
- Chrome styling follows the numbered rules in [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md),
  cited from code and parsed by a test (R2). That file does not move.
- Every icon comes from `@phosphor-icons/react` through one `DeckIcon` primitive; CSS never
  sets an icon's geometry.
- Everything in the repository is English (R1).
- `marketing/` shares the renderer's components and a virtual clock for its stage and video,
  ships nothing into the app, and has no lint signal of its own.
