# Known traps and live switches

> For maintainers. Using Deck? See [docs/user/](../user/).

Things that have bitten this codebase and are not obvious from reading one file, plus the
constants that currently switch behaviour off and are meant to be flipped back.

## Layout and CSS

- **`#root` is `overflow: clip`, not `hidden`.** `hidden` still builds a scroll container, so
  the first `scrollIntoView` the browser runs on focus shifted the traffic lights, the strip
  and every fixed thing up with nothing to scroll them back. Treat "the top bar looks
  misaligned" as a scroll report.
- **There is no global `box-sizing` reset.** `width: 100%` beside a padding overflows its box.
  Form controls get `border-box` from the user agent; a plain element does not, which is how
  `.session-row` grew a horizontal scrollbar the moment it stopped being a `<button>`.
  Declare it on any element you give a percentage size and a padding.
- **A 1px overflow in the rail moves the whole column.** `.asr-rail__list` clips
  horizontally without removing the scroll container, so a border bled by `margin: 0 -1px`
  slid the column on the first focus. The multi-agent frame is an inset `box-shadow` for
  this reason: it paints inside, needs no layout and clips nothing.
- **`.iconbtn` never resets the user agent's button padding**, so every icon in one sits
  1.5px left of centre: the grid track is 12px against a 15px glyph, and Chromium clamps
  the negative offset. The rendered view's toggle carries its own `padding: 0`; the app-wide
  fix has not been made.
- **A custom scrollbar does not repaint when only the scroller's `:hover` flips.** The
  app-wide thumb is transparent at rest and lit through `*:hover::-webkit-scrollbar-thumb`,
  and that rule never reaches the screen: Chromium repaints a custom scrollbar on its own
  state change or an inherited property change, not on the originating element's hover.
  Every scroll surface is effectively thumbless until the pointer lands on the 6px strip;
  only `.md-doc` declares a resting colour.
- **A shorthand holding `var()` restarts its animation on any global style recalc.** Put
  `var()`-carrying animation values on the longhands.
- **`src/styles.css` is an import index whose order is the cascade.** Several rules rely on
  position, not specificity. Add rules inside the partial, never in the index, and note
  that the design-language test concatenates the partials in that order.
- **Props on the element `DesktopChrome` returns are applied on mount and never updated.**
  The sidebar's live width and collapsed flag are written to `:root` imperatively to
  sidestep it.
- **Under Electron on Windows the OS paints its caption buttons inside Deck's frame row, not
  in a title bar above it.** The window opens with `titleBarStyle: "hidden"` and a
  `titleBarOverlay` ([`window-options.ts`](../../electron/window-options.ts)), so minimize,
  maximize and close sit over the web contents at the row's right end, as the traffic lights
  do on the left on macOS (DL-18.4). `DesktopChrome` sets `window--caption-overlay` only for
  Windows plus the Electron host, and only under that class does `--frame-controls-w` leave
  `0px` ([`22-caption-overlay.css`](../../src/styles/22-caption-overlay.css)). A new occupant
  of the row's right end must pad itself by that token or the buttons cover it, and a new
  surface under the corner needs an entry in
  [`title-bar-overlay-colors.ts`](../../src/lib/title-bar-overlay-colors.ts) so the buttons
  keep its colour. How the buttons render, theme and scale is unverified, and the 138px
  fallback is what applies if `env(titlebar-area-*)` is undefined.
- **A pane's terminal never goes below 24 columns, even when its box does.** opencode 1.18.31 stops
  painting for good once its pty drops to 20 columns or fewer, also under tmux, and Deck
  panes get that narrow easily. [`fit()`](../../src/terminal/pane.ts) clamps the size there,
  so the extra columns clip at the pane's right edge. Rows follow the box: a row floor would
  clip the bottom, where agents keep their prompt. Replacing it with `fitAddon.fit()` brings
  the agent death back.

- **The preset's stylesheet belongs to the surface that imports it, not to `styles.css`.**
  [`preset.css`](../../src/ui/preset.css) has no Tailwind preflight (its `*` and `body` rules
  would restyle every unmigrated surface), so the reset is scoped to `.ui-preset` and to the
  `data-slot` every control root carries; a surface mixing controls and plain Tailwind
  markup needs `.ui-preset` on its root, or its borders have no style. Its `@source` lists
  the preset controls by name: a glob over `src/ui/controls/` once turned
  `class="text-input"` in the legacy `commit-input.tsx` into a colour utility.
  [`ui-preset-boundary.test.ts`](../../scripts/ui-preset-boundary.test.ts) builds the way a first importer
  would and fails on a leak; `--accent` is the one name the two systems shared, so the
  preset's is `--ui-accent`.
- **A migrated region joins the fence with one bare `@source "./<dir>";` line in
  [`preset.css`](../../src/ui/preset.css), and its root carries `.ui-preset`.**
  [`ui-preset-boundary.test.ts`](../../scripts/ui-preset-boundary.test.ts) reads those lines and
  stops counting the directory's markup as chrome, so a slice never edits the test. A legacy
  section mounted inside the root (the [Command Settings](../../src/ui/command-settings/command-settings-rows.tsx)
  area view mounts the old Settings sections as is) sits under the scoped reset, which zeroes
  margin, padding and border in `@layer base`: legacy rules are unlayered and still win, but
  anything that leaned on a browser default (a heading margin, a button border) loses it.
- **A preset control takes `className`, not `class`, and its wrapper is made with
  [`withRef`](../../src/ui/controls/with-ref.ts).** Preact keeps `class` as its own prop, so a
  wrapper that merges `className` never sees it, and strips `ref` from function-component props, so
  `render={<Input />}` loses the element a popup anchors to: the popup stays `opacity: 0`.
  [`forwarded-refs.test.tsx`](../../src/ui/controls/forwarded-refs.test.tsx) fails when a new control
  is neither wrapped nor listed as rootless.
- **Base UI under Vitest loads real React unless the controls come from the test bundle.** Its
  `use-sync-external-store` is CommonJS and calls `require("react")`, which Node resolves to
  the React 19 that Phosphor pulls in as a peer. Control tests import
  `loadPresetControls()`, a bundle built with the `preact/compat` aliases by
  [`preset-controls-bundle.mjs`](../../scripts/preset-controls-bundle.mjs); inlining the package or the
  dependency optimizer does not fix it (the optimizer keeps `import "react"` in its chunks). The
  bundle is built once when Vitest starts, so in watch mode a change to a control needs a restart.

## Hosts and evidence

- **A dev notification check is not release notification evidence.** The
  [dev launcher](../../scripts/electron-dev-launch.mjs) ad-hoc signs Deck Dev with its own
  bundle identity; do not describe `electron:dev` as unsigned or assume its OS permissions
  match the release app's. Unsigned builds cannot prove macOS alert delivery, and the Dock
  badge requires notification permission. Tests that intercept the
  [notification API](../../electron/ipc/register-shell.ts) prove routing and counts only;
  verify native delivery, permission and badge visibility on the exact app being tested.

- **The app running an update is the old build.** An updater fix cannot protect the
  transition into the release that carries it.
- **An installer handover cannot be retried in the same process.**
  [The Electron lifecycle](../../electron/updater/updater.ts) attributes late errors
  to staging only when no check is in flight; a three-minute fallback handles
  silence. Both paths release the installing flag but keep the handover guard.
  [Update IPC](../../electron/ipc/register-updater.ts) returns a structured
  non-retryable failure because Electron drops custom Error properties; the
  [renderer adapter](../../src/updater/electron-updater-adapter.ts) preserves that
  distinction. Keep it when changing failure copy or the About action.

- **Green unit and build checks are not native evidence.** They say nothing about PTYs, menu
  accelerators, window close, the updater or packaging on real hardware, and nothing about
  Windows, where no owner has run a real-hardware pass.
- **Browser `npm run dev` paints the shell because IPC failures are caught.** It cannot prove
  persistence, PTY, updater or packaging behaviour.
- **Only the macOS menu is native.** Electron installs no menu on other platforms, so every
  chord there is a renderer binding; a macOS menu-bound chord (Find, Clear Buffer, zoom) is
  consumed by Cocoa before a document can see it.
- **`windows-check` in CI has pre-existing failures** unrelated to the Electron host, which is
  why the Windows packaging job is deliberately not gated on it.

## Data and contracts

- **A timed-out worktree command is not a rollback.** Git may leave a branch,
  directory or registered worktree, including when a checkout hook stalls after
  files were written. [Worktree creation](../../electron/git/worktree.ts) inspects
  all three after interruption. Do not turn a registered worktree into success
  without checking its files, and do not add automatic cleanup or force retries:
  the remaining checkout may contain user work.
- **A clone job belongs to the window that started it, and a failed clone is not cleaned up.**
  [`registerClone`](../../electron/ipc/register-clone.ts) takes the owner from the sending
  window, never from the payload. [The service](../../electron/git/clone.ts) kills the whole git
  process group when that window closes or the app quits; the quit signal also runs from
  `process.on("exit")`, where only the synchronous SIGTERM can happen. A failed or cancelled
  clone reports `leftoverPath` and deletes nothing: the folder may hold a partial checkout the
  user wants to inspect. The destination is `parent/name` as chosen, not a `realpath`; only the
  destination lock is keyed on the real path. If the clone succeeds but the workspace cannot be
  saved, the checkout stays and the form offers only "Retry adding workspace", never a second clone.
- **A store that cannot be read is write-locked.** Do not "fix" an unreadable file by
  writing defaults over it; the lock exists so recoverable bytes survive.
- **`CHANGELOG.md` is machine-read** by the release workflow. Its `## <version>` headings and
  its location are part of the release contract.
- **`docs/DESIGN-LANGUAGE.md` is read by a test at runtime.** Moving, renaming or trimming
  a cited rule breaks `npm test`.
- **IPC payloads are typed separately on each side.** A key the handler destructures and the
  renderer never sends is green everywhere but the running app; the contract test is the
  only early signal. Keep flat keys where the contract is flat.
- **Dev server rows are matched to the active tab by `displayRoot`, never `workspacePath`.**
  The core's `workspacePath` is the realpath'd root, so it differs from the tab's own path
  wherever a symlink sits above the folder (`/var` against `/private/var`) and a
  [scope filter](../../src/ui/dev-servers/dev-server-model.ts) on it silently shows nothing.
  The chip also watches from the moment it mounts, not when its popover opens, so the
  [store](../../src/dev-servers/dev-server-store.ts) must be re-registered only when the root
  set changes: `tabViews` republishes every two seconds.
- **Open in Deck from the dev servers popover uses
  [`openBrowserAt`](../../src/browser/browser-store.ts), not `openBrowser`.** `openBrowser`
  keeps a page that is already loaded and swallows a failed open; an explicit destination must
  always move the page and report failure, and the stage rule runs before the flags flip.
- **`open_pane_window`, `prepare_transfer` and `offer_transfer` have frozen shapes:** flat
  arguments, a string `paneId`, and `targetLabel`. Two of the three shipped broken once.
- **`node-pty` delivers strings on Windows** whatever encoding you ask for, and it ignores
  `encoding: null`; the streaming decoder passes strings through. Handing one to
  `TextDecoder.decode` throws inside node-pty's emitter and kills the main process.
- **The spawn helpers lose their executable bit** on install; the postinstall restores it and
  the only symptom otherwise is `posix_spawnp failed`.
- **A pane's bash sources `.bashrc` twice** when the user's profile already sources it (the
  common `~/.bash_profile` that ends with `source ~/.bashrc`), because the bootstrap rcfile
  sources the profile and then `.bashrc` itself. Superset does the same; guard-free rc files
  that append to `PATH` or start a program will see the duplicate.
- **A pane's zsh runs the system rc files under Deck's `ZDOTDIR`.** Anything `/etc/zshrc`
  derives from `ZDOTDIR` lands in userData: macOS sets `HISTFILE` there, which the `.zshrc`
  stage repoints, and looks up `.zkbd` there, which nothing repoints. A new stage or a
  reordered one has to keep the `HISTFILE` repair before the user's `.zshrc`.
- **An agent wrapper must never stay a parent process.** It ends in `exec`, and the pane's
  classification and Claude's registry join both break if it does; see
  [Shell bootstrap and agent wrappers](terminal.md#shell-bootstrap-and-agent-wrappers). The
  Claude hook's nesting check needs the same of whatever sits between the wrapper and the CLI:
  a launcher or shim that forks the CLI instead of exec'ing it leaves `CLAUDE_PID` unequal to
  `DECK_AGENT_PID`, and every event of the pane's own Claude is then dropped as nested.
- **In a pane `command -v claude`, `codex` and `opencode` always succeed,** installed or not:
  the wrapper is on `PATH` and exits 127 with `deck: <agent> not found on PATH` when it finds
  no real binary. An agent running in the pane sees the same, so a check for the CLI from
  inside a pane proves nothing. Superset behaves identically.
- **Codex trusts a hook by its position in `hooks.json`.** Deleting or reordering a group or
  handler in the middle of an event makes Codex ask the user to review hooks that did not
  change; Deck empties its group in place instead
  ([why](terminal.md#the-contract-layer)).
- **A Codex hook needs its host's tty.** Codex 0.162 can host a session in a shared daemon
  whose hooks carry the daemon's environment, possibly a live pane's credentials. Main refuses
  a Codex post whose `X-Deck-Tty` is not that pane's tty, so a daemon-hosted Codex stays
  inferred and a hook that bypasses the script is refused.
- **Codex compresses a rollout idle for a week** into `<name>.jsonl.zst` (since 0.162.1), so
  most of a user's Codex history is compressed. A reader that matches only `.jsonl` or reads raw
  bytes silently loses those sessions from resume, history and usage; read rollouts through
  [`compressed-rollout.ts`](../../electron/usage/compressed-rollout.ts) or the readers built on
  it. Electron's zlib throws on a cut-off zstd input that plain Node accepts, so a Vitest run
  alone cannot prove a head read works in the app.
- **Inside a Deck pane, `OPENCODE_CONFIG_DIR` is Deck's while opencode Signals is on.** The
  wrapper overwrites a value the user exported, so their own opencode agents, commands and
  plugins from that directory do not load there; turn Signals off to get them back.
- **A hook or plugin post must never honour proxy variables.** The pane token would go to the
  user's proxy and the signal would be lost. Claude's hook `curl` passes `--noproxy '*'`, and
  the opencode plugin writes a raw loopback socket because `fetch` and `node:http` inside
  opencode follow `HTTP_PROXY`.
- **`marketing/**` has no lint gate.** It is in `.prettierignore` and oxlint's ignore list, so
  a "prettier clean" claim over that tree is vacuous. It also shares application components
  and a virtual clock, so a component change can silently alter rendered media.
- **`npm run refresh:pricing` reaches the network** and must never run from a build.
- The usage scanner's golden fixture came from the removed Rust scanner and is frozen: it
  cannot be regenerated, and regenerating it from the scanner's own output would make the gate
  a tautology. The parity test sums the snapshot over `repo` before comparing, so a fixture
  may gain fields Rust ignored but never usage.
- **A stored cwd → repository answer is permanent**, so the usage resolver
  ([`repo-resolver.ts`](../../electron/usage/repo-resolver.ts)) calls a cwd "not a repository"
  only when the directory is gone or git says exactly that. Exit 128 alone also means an old
  git, `safe.directory` or the macOS `xcrun` shim; treating it as definitive would blank repo
  grouping for good. Subdirectories, including folders inside an ancestor repository, fold
  into the repository that contains them — unlike the rail, which names only a checkout's own
  root.

## Accepted limitations

Named because a maintainer will otherwise read them as bugs to fix on sight. Each was looked
at and left; changing one is a decision, not a cleanup.

- **An explorer channel's `root` is any absolute path the renderer sends,** not a workspace
  this window has open. `resolveRoot` proves _containment_, not authorization, and
  `registerExplorer` takes the renderer's `root` verbatim — a property of every explorer
  channel, not something `create_entry` introduced. Binding roots to the owning window would
  change every explorer channel's authorization at once. The exposure is bounded: `wx` and a
  non-recursive `mkdir` cannot overwrite.
- **The explorer does not restore a per-workspace scroll position.**
  `FileSurfaceState.scrollTop` and `setScrollTop` exist and are never read or written —
  `FileTreeView` keeps its own local state, so scroll leaks between workspaces whenever the
  component survives a `workspacePath` change.
- **A preset can be created but not renamed or deleted.** The layout cards were the only call
  sites of `renamePreset` and `deletePreset`, and they went with the Open board's redesign.
- **A custom editor command cannot be typed for ⌘+click.** `editorId` and `editorCommand`
  became the single catalog id `externalAppId`, and a stored `custom` migrates to the first
  catalog app. `editor-command.ts` and `open_editor`'s `custom` branch still build and still
  validate; restoring the feature needs a catalog entry carrying a command template.
- **A quick agent pressed in a pane opened before its install types a name that pane cannot
  run.** [`pane-quick-agents.tsx`](../../src/terminal/pane-quick-agents.tsx) types the bare
  launch command, and a shell keeps the `PATH` it started with, so the old pane answers "not
  found" while a new pane runs the agent. Typing the resolved path instead needs the pane's
  shell, because PowerShell, cmd and Git Bash each invoke a quoted path differently, and the
  renderer knows the foreground process of the active pane only.

## Live switches

Each is one typed constant whose other branch is kept in the tree on purpose, so reverting
is flipping it back. They are typed `boolean` rather than left as literals so a dead-code
pass cannot delete the half they exist to keep.

| Constant                   | Where                                                             | Currently | Effect                                                                                  |
| -------------------------- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `GRAB_PASTE_DISABLED`      | [`src/browser/browser-store.ts`](../../src/browser/browser-store.ts) | `true`  | A browser grab stops at the clipboard and is never pasted into a pane                   |
| `USAGE_CONSENT_ASKED`      | [`src/telemetry/usage-notice.ts`](../../src/telemetry/usage-notice.ts) | `false` | No consent question is asked; analytics is on by default and the modal mounts nowhere |
| `PANE_TREE_HIDDEN`         | [`src/ui/agent-rail.tsx`](../../src/ui/agent-rail.tsx)             | `true`    | A multi-agent tab renders flat framed rows instead of a parent row with elbow guides    |
| `AGENT_BOARD_RETIRED`      | [`src/ui/agent-board-store.ts`](../../src/ui/agent-board-store.ts) | `true`    | A journaled Agent Board is not restored; Mission Control owns the Board's entry points  |

Two more retirements follow the same pattern without a constant: the theme gallery and theme
import are unmounted from Settings but still build and still resolve a stored id; and
`RepositoryRail` is mounted only in the gallery.

### Release switch convention

New unfinished features use the one [release-switch module](../../src/lib/release-switches.ts),
not another scattered constant. Each positively named definition has an explicit boolean
release value and `createdOn: "YYYY-MM-DD"`; record `enabledOn` for its first stable
publication when known. No production placeholder flag is defined. The
[resolver](../../src/lib/release-switches.ts) returns immutable snapshots: development enables
all defined feature switches; packaged releases use the file values. Unknown keys stay off.

The renderer reads the validated host development identity at invocation time through
[action availability](../../src/terminal/action-availability.ts). Electron uses
`!app.isPackaged`, including dev-once with a production Vite renderer; browser-only preview
may use Vite's dev mode. A dev URL cannot override a packaged host. Main-owned handlers use
[the IPC guard](../../electron/ipc/release-switch-guard.ts); never accept a renderer's claim
that a feature is enabled. Shared IPC services guard only the feature-specific branch. Without a
host the renderer trusts Vite's dev mode except under Vitest (`MODE === "test"`), so a unit test
sees every switch off unless it pins a host identity as
[the availability test](../../src/terminal/action-availability.test.ts) does; read the snapshot
when the guard runs, never into a module-level constant.

Each feature adoption must guard its mount and clicks, direct actions, default/rebound
shortcuts, native menu/registry entries, IPC, restore and background starts. Reuse
[registry availability](../../src/terminal/action-registry.ts),
[the central action guard](../../src/terminal/tab-manager.ts), and the IPC guard before side
effects. A hidden button is insufficient. Test both true and false with real entrance
coverage; preserve both branches while the switch exists and inspect shipping bundles.
Electron-only registry entries also declare the `electron` capability; the native
[menu](../../electron/menu.ts) filters registry entries by availability at build time, using
the host's packaged state.

Activation is a small main commit after checkout handoff: flip the release value to true
and write its user-facing `## Unreleased` CHANGELOG entry in that same commit. Keep worktree
feature commits disabled and do not announce disabled behavior as available. A rollback
also records the changed behavior and clears the activation date. After fourteen consecutive
days enabled in published stable releases, remove the switch and old branch together,
retaining regression coverage and updating this passage's affected references. Verify the
first publication date before removal; local activation alone does not start the clock.
[The cleanup predicate](../../src/lib/release-switches.ts) refuses to consider a switch due
without an activation date. Removal is reviewed code work, never a timed runtime action.

This rule applies to new temporary feature gates only. The five legacy controls above
retain their existing semantics: development-all-on and automatic retirement would invert
safety/consent/retirement decisions. Migrating one requires its own approved scope.
