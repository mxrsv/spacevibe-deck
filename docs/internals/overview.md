# Architecture overview

> For maintainers. Using Deck? See [docs/user/](../user/).

SpaceVibe Deck is an Electron desktop terminal for running several AI agent CLIs side by
side. The main process (`electron/`) owns everything the renderer cannot: PTYs, the process
table, windows, persistent stores, the native menu, the updater, usage analytics, git
worktrees and agent session lookup. The renderer (`src/`) is Preact plus xterm.js, and reaches
the host only through the facades in `src/host/`.

## The Tauri host is gone

Electron replaced a Tauri 2 + Rust host, removed from `main` on 2026-10-13. Its last release
is `v0.12.3`, whose updater endpoint answers 404; the tag keeps its source. Two traces remain on
purpose:

- Channel and event names are the Tauri build's (`spawn_shell`, `pty_info`, `git_branch`, …),
  kept so the renderer's call sites and tests did not change with the host.
- Many `electron/` modules open with "port of `src-tauri/src/…`". That names where the code
  came from; the Rust file no longer exists.

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
| `electron/usage/`      | Token-usage scanner; buckets carry the repository each usage line ran in         |
| `electron/updater/`    | electron-updater lifecycle and the cross-window check flight                     |
| `electron/telemetry/`  | Consent state, day buffers, the daily POST                                       |
| `electron/git.ts`, `worktrees.ts`, `git/worktree.ts` | `git_branch`, repository scans, `git worktree add` via `execFile` |
| `electron/git/clone.ts` | `git clone` jobs owned by the window that started them: progress, cancellation, leftovers |
| `electron/agents.ts`, `links.ts`, `external-apps.ts`, `images.ts`, `prompt-assets.ts`, `github-star.ts`, `themes.ts` | Discovery, path resolution, external apps, images, prompt assets, `gh`, the themes folder |
| `electron/ipc/`        | The channel table and one `register-*.ts` per service                            |

**Renderer** ([`src/main.tsx`](../../src/main.tsx)) boots in a fixed order: crash reporting
(first, and a load failure only warns), desktop environment, the window's boot mode (normal or
adopting a transferred pane, read before anything renders), settings, the GUI zoom binding,
store-failure listener, then presets, workspaces, repositories, logo and custom themes in
parallel, then `render`. Custom themes are awaited before first paint so an imported theme
cannot flash.

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

The sidebar and mounted Usage Overview share one renderer allowance poll and focus
listener through [the reference-counted observer](../../src/usage/agent-limits-store.ts).
Only the final subscriber stops it; a reply from a stopped generation cannot update a
reopened view. [The shared hook](../../src/ui/usage/use-agent-limits.ts) applies the same
reset/TTL boundaries in both surfaces. Token polling is
[reference-counted](../../src/usage/usage-store.ts): the dock's
[UsageDockTab](../../src/ui/usage/usage-dock-tab.tsx) and the open
[UsagePage](../../src/ui/usage/usage-page.tsx) each hold it, so closing one never freezes the
other. Token errors and limit errors must not hide the other source. The page is an overlay
that ranks as `settings` while open but leaves the dock's chrome actions live
(`overlayBlocksAction`), and `open-usage` is `"always"` with its preflight in `App`. Gallery specimens use
[OverviewContent](../../src/ui/usage/sections/overview-section.tsx) with injected data,
never the store-connected wrapper: a live limit read can activate a collector.


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
  `globalThis.__deckHost` directly: Electron true, the browser preview false. A
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
`presets.json`, `logo.json`, `workspace-logos.json`, `update-attempt.json`,
`repositories.json` and `session.json`. `telemetry.json` and
`usage-cache.json` are main-only on purpose, and `themes/` is read as text.

- A store that parses to a non-object, or fails to read for any reason but `ENOENT`, is
  **unreadable and write-locked**: a failed read never becomes permission to overwrite
  recoverable bytes with defaults. Settings' Retry re-reads it.
- The settings patch is a shallow top-level merge that drops the retired keys named in
  [`settings-merge.ts`](../../electron/settings-merge.ts) and nothing else, then broadcasts `settings:merged` to every window including the sender,
  which is the one authoritative path; the reply exists only to detect a failed write.
- Every write is atomic through one implementation in `electron/fs/write.ts`.
- `saveAll` on quit uses `allSettled`, so one failing store cannot skip the rest.

The optional Google account is the one place a credential lives in this app, so
[`electron/account/`](../../electron/account/service.ts) keeps the whole session in main:
supabase-js runs there, refreshes there, and persists through `account.json`, which is
encrypted with `safeStorage` and, like `telemetry.json`, is not in the renderer's store
allowlist. Windows receive only the display state (`signed-out`, `signing-in`, or
`signed-in` with email, name and plan) from `account_state` and `account:state-changed`;
a token that crossed IPC would be readable by any script running in any renderer. When the OS cannot encrypt, the session stays in memory
for that run rather than reaching disk in the clear. See the
[spec](../specs/2026-10-20-accounts.md) for the requirements.

The [storage scope](../../electron/account/session-store.ts) is revoked and its pending
writes drain before local teardown: a cancelled SDK client must never write or discard
the next client's credential. Failed credential deletion is reported in the existing
signed-out reason rather than claimed as durable logout by the
[account service](../../electron/account/service.ts).

## Load-bearing seams (R4)

These modules require a plan and cross-boundary verification, not a drive-by refactor:

- PTY ownership and process classification (`electron/pty/`, `electron/platform/`).
- The window coordinator and transfer protocol (`electron/coordinator.ts`).
- Tab materialization (`MaterializeIntent`, `TabManager.materialize`, `AgentLauncher`).
- Layout (`src/lib/split-tree.ts`, `src/terminal/layout-engine.ts`).
- Close and quit coordination (`electron/quit-flow.ts`, `src/terminal/close-coordinator.ts`,
  the census).
- The `SurfaceStrip` seam between `TabManager` and the file and browser stores.
- `ManagerCallbacks` between `TerminalManager` and the tab layer.

Each is described in [terminal.md](terminal.md), [file-surface.md](file-surface.md) and
[agent-rail.md](agent-rail.md).

## Other fixed points

- The macOS menu is derived from [`action-registry.ts`](../../src/terminal/action-registry.ts)
  at runtime by [`electron/menu.ts`](../../electron/menu.ts); a registry item changes in the
  registry, never in the menu template (R3).
- Chrome styling is held to the invariants in [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md);
  its patterns describe today's surfaces and change with a redesign (R2). The numbers are cited
  from code and parsed by a test, so the file does not move.
- Every icon is drawn through one `DeckIcon` primitive: Hugeicons in the new shell, Phosphor in
  surfaces not yet cut over (DL-14.1). A control sets the size of an icon it holds; CSS
  never sets an icon's geometry anywhere else.
- Everything in the repository is English (R1).
- `marketing/` shares the renderer's components and a virtual clock for its stage and video,
  ships nothing into the app, and has no lint signal of its own.
