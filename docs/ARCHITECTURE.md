> Generated from `~/.claude/templates/ARCHITECTURE.template.md` — LIVING doc, update in place (D1).

# SpaceVibe Deck — architecture

A desktop terminal (Tauri 2) for running many AI agent CLIs side by side:
Rust owns PTYs and native platform integration; a Preact + xterm.js frontend
renders panes, tabs and the workspace board. macOS is the current public
release; Windows 11 x64 is an engineering preview whose runtime gates remain
open ([macOS release workflow](../.github/workflows/release.yml) `current`,
[Windows spec](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).

## Modules and boundaries

| Module                                                                                                                        | Responsibility                                                             | In            | Out                   |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- | --------------------- |
| [src-tauri/src/pty.rs](../src-tauri/src/pty.rs) `current`                                                                     | PTY spawn/IO for agent CLIs                                                | commands      | shell procs           |
| [src-tauri/src/coordinator.rs](../src-tauri/src/coordinator.rs) `current`                                                     | window/pane coordination (load-bearing seam)                               | frontend      | windows               |
| [src-tauri/src/menu.rs](../src-tauri/src/menu.rs) `current` + [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current` | native menu — generated, edit the registry                                 | build script  | macOS menu            |
| [src-tauri/src/migrate.rs](../src-tauri/src/migrate.rs) `current`                                                             | settings carry-over from the Stackgrid bundle id                           | first launch  | app dirs              |
| [src-tauri/src/platform/](../src-tauri/src/platform) `current`                                                                | platform shell, home, discovery and process lifecycle                      | PTY state     | OS APIs               |
| [src-tauri/src/info.rs](../src-tauri/src/info.rs#L10-L34) `current`                                                           | explicit pane CWD/process kind/agent truth                                 | PTY sessions  | frontend              |
| [src-tauri/tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`                                           | native Windows chrome, WebView2 and NSIS-only bundle config                | Tauri build   | Windows app           |
| [src/terminal/](../src/terminal) `current`                                                                                    | xterm.js panes                                                             | chrome        | Tauri IPC             |
| [src/chrome/](../src/chrome) `current`                                                                                        | window chrome, tabs                                                        | main          | terminal              |
| [src/open-board/](../src/open-board) `current`                                                                                | workspace board: open, recents, workspaces store                           | chrome        | lib                   |
| [src/settings/](../src/settings) `current` + [src/presets/](../src/presets) `current`                                         | settings UI/stores, layout presets                                         | chrome        | lib                   |
| [src/ui/controls/deck-icon.tsx](../src/ui/controls/deck-icon.tsx) `current`                                                   | the one icon primitive — Phosphor presentation defaults and the four sizes | every surface | @phosphor-icons/react |
| [src/updater/](../src/updater) `current`                                                                                      | single-flight update state, Tauri adapter and chrome action                | app           | Tauri                 |
| [marketing/landing-prototype/](../marketing/landing-prototype) `current`                                                      | multi-page landing and live GitHub release changelog                       | Releases API  | dist                  |
| [marketing/video/](../marketing/video) `current`                                                                              | marketing video stage — shares app components, virtual clock               | app stage     | video                 |

## Main flows

1. Open a pane → frontend asks Rust to spawn a PTY ([pty.rs](../src-tauri/src/pty.rs) `current`) → output streams into an xterm.js pane ([src/terminal/](../src/terminal) `current`).
2. Window/pane lifecycle (split, move, close) goes through the coordinator ([coordinator.rs](../src-tauri/src/coordinator.rs) `current`); state lives in window-scoped Preact signal stores.
3. Workspace board ([open-board.tsx](../src/open-board/open-board.tsx) `current`) lists workspaces/recents ([workspace-recents.ts](../src/lib/workspace-recents.ts) `current`); existence checks mirror input order.
4. Chrome UI styling is governed by the numbered DL rulebook ([DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) `current`), cited from code comments.
5. Windows shell creation prefers PowerShell 7, falls back to Windows
   PowerShell, and adds only session-local prompt/CWD integration
   ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L84-L113) `current`).
6. Each Windows pane owns a kill-on-close Job Object; one WMI snapshot maps
   descendants into `idle-shell`, `agent`, `busy`, or `unknown`
   ([session ownership](../src-tauri/src/platform/windows/mod.rs#L26-L41) `current`,
   [process mapping](../src-tauri/src/info.rs#L111-L165) `current`).
7. Terminal links send structured editor intent. Windows validates canonical
   paths, parses custom templates as argv, rejects shell syntax, and launches
   the executable directly
   ([links.rs](../src-tauri/src/links.rs#L187-L314) `current`).
8. The initialized desktop environment selects the platform keymap, visible
   labels, pointer modifier, and Windows clipboard chords. The chords dispatch
   through the shared action path, not a pane-local handler
   ([platform.ts](../src/lib/platform.ts#L76-L107) `current`,
   [WINDOWS_KEYMAP](../src/terminal/default-keymaps.ts#L289-L358) `current`,
   [commands table](../src/terminal/tab-manager.ts#L1068-L1088) `current`,
   [Pane clipboard](../src/terminal/pane.ts#L362-L367) `current`,
   [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`).
9. After the tab manager exists, Deck checks the configured updater channel
   once. The macOS App menu may trigger a later manual check or open the trusted
   web changelog; download and install remain separate user actions.
   Immediately before install, `App` reuses the fresh pane close guard, flushes
   settings, then installs and relaunches
   ([App updater wiring](../src/ui/app.tsx#L182-L210) `current`,
   [update state machine](../src/updater/update-controller.ts#L82-L208) `current`,
   [update menu actions](../src/updater/update-menu-actions.ts#L62-L90) `current`).
10. The landing fetches one validated GitHub Releases list, derives stable
    macOS and preview Windows downloads from it, shows the latest stable tag,
    sums verified `.dmg` and `.exe` asset downloads into the hero proof, and
    feeds the same normalized records and their release-note bodies into the
    changelog page
    ([release-data.js](../marketing/landing-prototype/src/release-data.js#fetchPublishedReleases) `current`,
    [installer download total](../marketing/landing-prototype/src/release-data.js#totalInstallerDownloads) `current`,
    [changelog-view.js](../marketing/landing-prototype/src/changelog-view.js#renderReleaseList) `current`).

## Standing architecture decisions

- English only across strings/comments/docs — [AGENTS.md](../AGENTS.md) `current`.
- The repository rail renders one row per worktree rather than one row per
  terminal tab. Each tab is projected as a separate focusable agent button;
  same-agent tabs remain distinct, the active tab stays inside the three-button
  visible budget, and `+N` exposes the rest. Selection and close still leave
  through `App`'s existing callbacks, so ownership stays in `TabManager`
  ([worktree row projection](../src/ui/repository-rail.tsx#L315-L442) `current`,
  [agent tab controls](../src/ui/worktree-agent-stack.tsx#L41-L251) `current`).
- Sidebar navigation owns presentation scope, not terminal ownership. Its
  [`TabStrip`](../src/ui/tab-strip.tsx) `current` derives the active worktree
  through the same repository model as the rail and projects only that row's
  terminal tabs; every action still carries the original global index into
  `TabManager`. [`RepositoryRail`](../src/ui/repository-rail.tsx) `current`
  remembers the last selected tab key per worktree for row-level navigation.
  Top-tab mode remains global because it has no worktree rail to change scope.
- The active theme's background belongs to the center stage; both side columns
  share a separately derived recessed surface so changing themes cannot flatten
  the three-column hierarchy. The derivation, publication, and governing visual
  rule live in [derive-colors.ts](../src/lib/derive-colors.ts) `current`,
  [theme-vars.ts](../src/lib/theme-vars.ts) `current`, and
  [DESIGN-LANGUAGE.md §18](DESIGN-LANGUAGE.md#18-application-frame) `current`.
- A theme comes from one of two places and is looked up through one function.
  Four built-ins are literals; the rest are files in `<userData>/themes`, read
  as text by the host and parsed in the renderer
  ([theme-formats](../src/settings/theme-formats/parse-theme-file.ts) `current`,
  [themes folder host](../electron/themes.ts) `current`). Imported presets are
  published on a signal that [getPreset](../src/settings/themes.ts#L144-L156)
  `current` reads, so `pane.ts`, `editor-host.ts` and the status bar resolve
  both sources through the same call and every derived chrome token follows for
  free. Electron only — the Tauri host has no such channel, and the renderer
  treats that as "no imported themes" rather than an error.
- Functional icons come from `@phosphor-icons/react` through a single
  `DeckIcon` primitive (`lucide-preact` until 2026-08-16, uninstalled in the
  same pass — the two never ship together), and nothing else authors an
  `<svg>` or presses a glyph character into an action's place. This is
  chrome's one approved runtime dependency (DL-1.1), bounded by a build-time
  gzip ceiling and a filesystem drift guard rather than by review attention —
  the ceiling has not been re-measured against Phosphor. It is a React package
  reached through `preact/compat`, so `tsconfig.json` carries the `paths`
  entry that makes its types resolve. CSS must never set an icon's `width`,
  `height`, `fill`, `stroke` or `stroke-width`: those declarations beat SVG
  attributes and would move geometry back out of the primitive
  ([DeckIcon](../src/ui/controls/deck-icon.tsx) `current`,
  [rules §14](DESIGN-LANGUAGE.md) `current`,
  [guard](../scripts/icon-system.test.ts) `current`).
- The shared design contract has three homes in code, and the renderer reads the
  same ones under any host. Standard chrome text takes its size from the four `--type-*` roles
  declared once in `:root` ([01-tokens.css](../src/styles/01-tokens.css#--type-title)
  `current`); the text-contrast floors (8 / 6 / 4.5) are constants inside the
  colour derivation
  ([TEXT_PRIMARY_FLOOR](../src/lib/derive-colors.ts#TEXT_PRIMARY_FLOOR)
  `current`, applied by
  [deriveChromeColors](../src/lib/derive-colors.ts#deriveChromeColors)
  `current`); and the banner treatment is one class on one component
  ([SidebarBanner](../src/ui/sidebar-banner.tsx#SidebarBanner) `current`). The
  rules those implement — DL-3.5, DL-4.3, DL-4.4, DL-4.5, DL-16.2 and §26 of
  [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) `current` — are executable policy,
  parsed out of the stylesheet by
  [design-language.test.ts](../scripts/design-language.test.ts) `current`
  rather than left to review attention. **There is no host-specific stylesheet
  and no Electron-only fork:** `src/styles.css` is the one stylesheet the
  renderer ships, so a typography or contrast change reaches every surface that
  mounts it. The Gallery may
  consume these tokens; it may never declare a second set of them
  ([gallery-entry.test.ts](../scripts/gallery-entry.test.ts) `current`).
  Established by the Native balanced rollout, 2026-08-16
  ([plan](plans/2026-08-16-native-balanced-rollout.md) `current`,
  [CONTEXT.md](CONTEXT.md#the-native-balanced-rollout--2026-08-16) `current`).
- ADR pipeline removed 2026-07-27; decisions now live in dated specs/plans — [CONTEXT.md](CONTEXT.md) `current`.
- Menu is generated from a registry, never hand-edited — CI runs `generate:menu:check` — [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current`.
- Overlay guard ranks overlays by z-order — `pane`(0) < `settings`(20) < `board`(30) < `modal`(40) — and blocks an action while any open overlay's rank is `>=` its own tier; `>=` (not `>`) is deliberate so two `modal`-tier overlays exclude each other with no extra concept needed — [OverlayTier/TIER_RANK](../src/terminal/action-registry.ts#L8-L37) `current`, [overlayBlocksAction](../src/terminal/tab-manager.ts#L931-L962) `current`.
- Every modal mounts through one shell, so the scrim, the `role="dialog"`
  frame, focus-on-mount and both exits (Escape; a scrim click, unless the modal
  holds an unsaved draft) live in one place instead of a copy per modal —
  [Modal](../src/ui/modal.tsx) `current`, rules in
  [DESIGN-LANGUAGE §29](DESIGN-LANGUAGE.md) `current`. It is a **frame, not a
  coordinator**: it renders a scrim and a panel, knows nothing about tabs, panes
  or the overlay guard above, and each modal keeps its own panel class. Two
  separate registrations still have to name a modal by hand — the overlay guard's
  `modal` tier and `panelObscured()`, which hides the browser's native view;
  neither is derivable from mounting the shell
  ([CONTEXT.md](CONTEXT.md#one-modal-shell-and-a-scrim-that-closes--2026-08-16)
  `current`).
- Action identity and scope are shared, but macOS and Windows keymaps are
  separate. Cocoa menu generation reads only the macOS map; the Windows map
  preserves bare Ctrl terminal controls except standard text paste:
  `Ctrl+V`, `Ctrl+Shift+V`, and physical `Shift+Insert` resolve to real
  `paste` targets in the shared `commands` table. Deck leaves `Alt+V` unbound;
  whether an active agent CLI handles it for image paste is unverified. The
  path reads clipboard text, then uses xterm's
  `Terminal.paste()` so bracketed paste and CRLF normalization apply; it does
  not support Explorer `CF_HDROP` file-list clipboard data or smart routing
  ([platform keymaps](../src/terminal/default-keymaps.ts#L86-L358) `current`,
  [commands table](../src/terminal/tab-manager.ts#L1068-L1088) `current`,
  [Pane clipboard](../src/terminal/pane.ts#L362-L367) `current`,
  [clipboard text boundary](../src/terminal/terminal-clipboard.ts#L45-L55) `current`,
  [menu generator](../scripts/generate-menu.ts) `current`).
- The macOS menu path can't tell an accelerator from a mouse click (Tauri's `MenuEvent` carries only an id), so only `destructive: true` actions (`close-pane`/`close-tab`/`clear-buffer`) are suppressed while a chrome text field holds the caret — every other action still runs there — [ActionDefinition.destructive](../src/terminal/action-registry.ts#L82-L115) `current`, [runAction](../src/terminal/tab-manager.ts#L1032-L1054) `current`.
- [`activateWebglRenderer()`](../src/terminal/pane.ts) `current` runs once in a
  pane's first `mount()`, after `Terminal.open()`, so every pane automatically
  attempts xterm's WebGL custom-glyph path. Renderer choice is not persisted or
  exposed in Settings ([settings schema](../src/settings/settings-schema.ts)
  `current`, [Appearance section](../src/ui/settings/sections/appearance-section.tsx)
  `current`).
- WebGL initialization failure and context loss explicitly dispose the active
  addon, clear its identity-guarded handle, and warn before leaving xterm's DOM
  renderer active; neither fallback restarts the pane or PTY. `applySettings()`
  does not create or replace renderer addons
  ([pane renderer lifecycle](../src/terminal/pane.ts) `current`).
- Pane disposal explicitly releases a still-active WebGL addon and its GPU
  context. The lifecycle lives entirely in the shared renderer under `src/`, so
  both Electron and Tauri receive the same behavior without host-specific code
  ([pane disposal](../src/terminal/pane.ts) `current`).
- `lineHeight` stays 1.25: flush rows were never the fix, since custom glyphs
  are drawn to the full cell box and `device.cell.height` already multiplies the
  char height by that value.
- Windows uses native decorated system chrome; Preact renders only Deck's
  internal toolbar and omits synthetic minimize/maximize/close controls
  ([tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Pull requests compile the Windows desktop without bundling. An authorized
  manual run may build one unsigned NSIS setup and upload it for seven days,
  but the job fails before bundling unless the repository is private
  ([ci.yml](../.github/workflows/ci.yml#L65-L159) `current`). The tagged macOS
  release workflow is separate
  ([ci.yml](../.github/workflows/ci.yml#L65-L159) `current`).
- Tagged releases build updater-signed macOS stable and unsigned Windows
  preview drafts separately. Neither can publish until a validation job
  re-downloads every asset from that exact draft by API asset id and verifies
  it: the manifest signature must equal the downloaded sidecar, the digests
  must equal the build provenance, the asset set must be exactly what the
  platform descriptor names, and the payload must pass Minisign verification
  against `DECK_UPDATER_PUBLIC_KEY` — reproduced in Node rather than trusted
  from the bundler
  ([release DAG](../.github/workflows/release.yml) `current`,
  [manifest validator](../scripts/verify-updater-manifest.mjs) `current`,
  [Minisign verification](../scripts/verify-updater-manifest.mjs#verifyUpdaterSignature) `current`).
- Draft assets bind to build outputs **by digest, never by name**: tauri-action
  renames the bundle as it uploads and GitHub replaces spaces with dots, so the
  two sets never share a filename
  ([digest binding](../scripts/verify-updater-manifest.mjs#bindDraftToStagedBytes) `current`).
- The workflow accepts only exact `vX.Y.Z` or `vX.Y.Z-rc.N` source tags, so the
  `-windows-preview` and channel tags it creates cannot start another release.
  Release candidates are prereleases routed to dedicated RC channels; only a
  final release moves `windows-preview-channel`, and `releases/latest` ignores
  prereleases by construction
  ([tag and channel routing](../scripts/release-workflow.test.ts) `current`).
- Before either platform draft can build, the release workflow requires every
  active `feat`, `fix`, and `perf` commit since the prior source tag to carry an
  explicit `Release-Note: <user-facing description>` or `Release-Note: skip`
  trailer. Standard, nested, and merge-reverted commits are removed; `skip`
  suppresses the entry; and `!` or `BREAKING CHANGE:` routes the explicit
  public description into a separate breaking section. No public entry fails
  the release instead of publishing boilerplate. Stable macOS and the unsigned
  Windows preview share the same change sections; only Windows adds its
  distribution warning. A manual Windows rebuild for a pre-policy tag reuses
  that tag's reviewed stable GitHub release body, so retrying an already-shipped
  artifact does not retroactively apply the commit-trailer gate
  ([release-note generator](../scripts/generate-release-notes.mjs#generateReleaseNotes) `current`,
  [workflow gate](../scripts/release-workflow.test.ts) `current`).
- The updater plugin is pinned to a reviewed fork revision carrying upstream
  PR #3516 plus a macOS transactional bundle swap: the previous `.app` is moved
  aside and restored if the replacement or the permission fix fails, and the
  installed bundle keeps the previous root mode instead of the extraction
  directory's `0700`
  ([pin](../src-tauri/Cargo.toml) `current`).
- Runtime updater registration is compile-time gated by the operator-owned
  public key; local builds without `DECK_UPDATER_PUBLIC_KEY` keep the updater
  plugin disabled while the process plugin remains available
  ([Tauri plugin registration](../src-tauri/src/lib.rs#L28-L43) `current`).
- Redesign phases 3–5 (2026-08-14) closed under the same standing authority:
  the toolbar is the single chrome actions surface, built once by `App` and
  mounted by both layouts (`DeckToolbar` → `FeatureToolbar`; `ChromeActions`
  removed); Browser is a docked panel by frozen contract and its toolbar
  action toggles the dock (D12,
  [spec](specs/2026-08-13-browser-productization-design.md) `decided`);
  tooltips and the overflow menu are governed by DL §23; the live IPC gate is
  `scripts/electron-ipc-contract.test.ts` (D8 closed as a correction); the
  usage scanner exists twice on purpose — Rust for the frozen Tauri host,
  `electron/usage/` for the shipping direction — held equal by a
  Rust-produced golden-fixture parity test; and Gate M's packaging path is
  local and unsigned by design (D10), with the explorer surface ordered
  strictly after a Gate M pass on real hardware.
- Redesign phase 2 (2026-08-14) closed its forks as follows, all owner-approved
  or resolved under the plan's standing authority and recorded in
  [the plan's §0.3 and §2](plans/2026-08-13-redesign-phases-2-5.md) `current`:
  selection is a full wash, the accent bar is retired app-wide (DL §21);
  radius/motion are two closed scales (DL §20); the frame is the head of the
  navigation column and the stage reaches the window top (DL-18 rewritten,
  rail 275px to keep a draggable titlebar); the restyle is cross-host and
  visual-only — `src/styles.css` is shared with shipping Tauri and no evidence
  may be labelled Electron-only (D9); `deriveChromeColors` gained only
  `--state-hover-bg`, following `seamDivider`'s pattern, with the ramp and
  contrast floors unchanged; and both hosts' pre-render window grounds follow
  `--bg`'s default.
- The straight-through completion run (2026-08-14) closed the forks it opened,
  recorded in
  [the plan](plans/2026-08-14-straight-through-completion.md) `current` and
  [the evidence record](review/2026-08-14-straight-through-evidence.md)
  `current`: the file explorer surface is built now that Gate M has passed
  packaged on real hardware, and file-tab chips render in both toolbar layouts
  rather than only one, because the spec's strip-ordering intent and the
  task's own "file tabs join the strip" wording bind over an incomplete task
  file list ([`SurfaceStrip`](../src/terminal/tab-manager.ts#L278-L322)
  `current` is live, not the inert stub); tab-level close guards deliberately
  never aggregate busy + dirty into one dialog — only window-close and
  app-quit do, so a file tab's prompt never accuses an unrelated terminal tab
  of being busy
  ([`close-guard.ts`](../src/terminal/close-guard.ts) `current`); `listDir`
  bounds its per-symlink resolution to a 32-worker async pool rather than
  resolving serially or unboundedly
  ([`electron/fs/read.ts`](../electron/fs/read.ts) `current`); the open board
  is one center surface with two views (home/worktree — the Layout + Agent
  config view was deleted on 2026-08-16, so picking a workspace opens it with
  the combo it was last opened with) and the board's own second sidebar is
  retired in favor of the app's own `WorkspaceSidebar` as the one sidebar
  ([`open-board.tsx`](../src/open-board/open-board.tsx) `current`); and
  create-worktree is an Electron-only flow gated on `worktree-host`'s
  presence check, running `git worktree add` via `execFile` argv (never a
  shell string) behind the new flat `worktree_add` IPC channel
  ([`electron/git/worktree.ts`](../electron/git/worktree.ts) `current`,
  [`worktree-host.ts`](../src/host/worktree-host.ts) `current`).

## Resolved forks

Forks resolved in [`../AGENTS.md`](../AGENTS.md) `current`, moved here when the work
closed. Newest first; each entry states what the fork touched and which choice the
owner made.

- 2026-08-17: **the rail's `New` row moved to the top, gained a `Workspace`
  caption, and dropped a type rung** — DL-27.14 said "the rail's LAST row" and
  named `--type-title`, so all three are rule changes, the listed fork. Owner
  asked from the shipped rail: `New` reads as the rail's primary action, and
  with several projects open the old placement put it below the fold. Kept
  inside the scrollport rather than pinned, so it is a reorder and not a new
  structural row; `.asr-cluster:first-child`'s `padding-top: 2px` override went
  with it, since every cluster head now has something above it. The caption is
  deliberately outside the button (owner picked "label riêng, không bấm được"
  over folding it into `New`), which is why the button shrank to its content.
  The size ask was "2px smaller" — 12px, which is off DL-4.4's ladder — and the
  owner chose `--type-body` (12.5px) over opening DL-4.5's closed exception
  list for a literal.
- 2026-08-17: **built-in theme foregrounds are neutral gray, and hairlines
  left `--fg`** — a `docs/DESIGN-LANGUAGE.md` rule, the listed fork. Offered the
  owner three shapes for "the text looks blue": neutralize only inside
  `deriveChromeColors` (chrome goes gray, palettes untouched, reaches imported
  themes too), rewrite the built-in `foreground` literals, or both. Owner chose
  the palettes, and separately chose to bring `--hair`/`--hair-strong` along.
  Recorded as new **DL-3.6**, with DL-2.3's hairline carve-out closed. The ANSI
  sixteen and imported themes' own foregrounds are explicitly out of scope; the
  replacement grays match each palette's WCAG luminance, so DL-3.5's floors did
  not move. See
  [docs/CONTEXT.md](CONTEXT.md#chrome-ink-goes-neutral--2026-08-17) `current`.
- 2026-08-16: **a local, unsigned Electron package path exists** —
  [`electron-builder.yml`](../electron-builder.yml) `current` plus an
  `electron:package` script, which is bundle configuration, the listed fork.
  Owner asked for a locally testable Electron build before any mac/Windows
  release and chose an arm64 `dir` target (no DMG, no universal), an identity
  of its own, and committing the config. **Nothing about release moved:**
  `.github/workflows/release.yml` still builds Tauri, no `electron-updater`
  dependency was added, no signing or notarization is configured, and Gate A
  and Gate C are untouched. Modelled directly on
  `electron-builder.gate-m.yml` — same `files` list minus the harness
  renderer, same `extraMetadata.main`, same node-pty `asarUnpack`,
  `identity: null` — with the icon named explicitly because `build/` does not
  exist here. `extraMetadata.productName` is the one non-obvious line:
  `app.getName()` reads the packaged package.json, NOT Info.plist, so the
  first packaged launch ran on `~/Library/Application Support/spacevibe-deck`,
  the very profile `electron:dev` writes, and rewrote its `session.json`
  before the fix. The app now boots on its own `Deck Electron` profile.
  Evidence: `npm run build`, `npm run electron:build`, electron-builder all
  exit 0; the packaged asar carries both graphs and node-pty is unpacked with
  `spawn-helper` still executable; the app stays alive after launch. **No
  owner eye review of the packaged app, no suite run, no Windows anything.**
- 2026-08-16: the rail's last row became **`New`, a button that can also be
  dragged onto a pane** — touched `DESIGN-LANGUAGE` (new DL-27.14, amended the
  same day to size the row as a launcher: `--type-title` + `RAIL_ICON`, the
  role widening DL-23.9 already made for the `More` menu's rows — no new size,
  DL-4.5 untouched) and **tab
  materialization**, the listed fork: `dropAgentPane` is the first agent launch
  that docks a pane into a LIVE tab instead of creating a tab, and so the only
  `arm` call outside `materialize` (safe because `arm` merges per pane id
  rather than replacing the pending set — session restore arms many panes at
  once). User asked for the rename and the drag from a screenshot, and — asked
  which agent a drop should run — chose spawn-immediately over a picker step,
  and chose to keep the click opening the Open board. So the agent comes from
  memory alone: [`agentForWorkspace`](../src/lib/workspace-recents.ts) `current`
  reads the tab's workspace `lastAgent`, resolved against a live
  `detect_agents` probe the drop AWAITS, exactly as the open board does; an
  unknown folder takes the first detected agent and a host that detects none
  opens a plain shell. Two new seams, both mirroring existing ones:
  `TerminalManager.dockNewPaneAt` follows `adoptIntoActiveTab` (it uses
  `dockNewPane`, NOT `splitLeaf`, so a left/top drop lands on the correct side)
  and `slotRects()`/`activeSlotRects()` follow the file-drop trio's precedent
  of hit-testing panes from outside the stage. The pointer controller is NEW
  rather than a mode of `pane-drag.ts`: it carries no source pane, so no slot
  is excluded and a lone pane is a legal target, where that controller refuses
  below two panes. No PTY, window or close path changed. `RepositoryRail` is
  parked and keeps its own `Open workspace` row. Renderer-only, so it reaches
  Tauri too, where nothing has been run.
- 2026-08-16: **the rail's states read from the dev's side, and a multi-agent
  tab is a pane tree** — touched `DESIGN-LANGUAGE` (DL-27.3 revocabularised,
  DL-27.4/27.6 amended, DL-3.2's yellow widened and green given its first
  chrome mark, DL-14.6 given its one scoped exception, DL-27.11's two-level
  half reversed by new DL-27.13), the rail spec §3 (amended in place), the
  attention tracker (new `hasRun` bit, reset on gate open — the ONLY tracker
  change; `completed` stays a distinct `AttentionKind`, the fold into `asked`
  is one case label in `agent-rail-model`), `PaneView`, and the rail's
  renderer/CSS. The five states: `failed` red · `asked` yellow (a question, a
  permission wait, OR a finished unchecked run — the accent `done` ring
  folded in, recorded as TEMPORARY) · `working` arc · `done` green
  `CheckCircle` via `DeckIcon` (owner chose the library icon over a CSS
  drawing) · `idle` hairline ring with a core (owner's R4 pick). A tab with
  several agents lists each pane as an always-visible elbow-joined leaf row;
  its chip budget, `+N` and the joined `claude + codex` identity died —
  unnamed multi-agent parents say `N agents`. Same pass: the rail close's
  hover wash went neutral, matching the strip's 2026-08-16 precedent. All
  owner-driven through gallery specimens (`agent-rail-variants.tsx`, kept as
  the approved record). No PTY, window, materialization or close path
  changed; ⌘⇧A and the notifier are untouched. Renderer-only plus one
  tracker bit, so it reaches Tauri too, where nothing has been run. Suite
  NOT run; typecheck clean, gallery render is the evidence.
- 2026-08-16: **an icon button that toggles a surface paints no active
  state** — touched `DESIGN-LANGUAGE` (new DL-21.8; the ledger's same-day
  `.iconbtn.is-active` fix marked superseded). The rule is DELETED from the
  stylesheet and the class is no longer emitted by any of its four call
  sites: `SidebarToggle`, `DockToggle`, `FeatureToolbar` (so `More` no
  longer washes while its menu stands open) and the browser's Inspect
  button. User said a toggle needs no active state because the screen
  already shows the result, and chose all four over stopping at the two
  panel toggles. **`aria-pressed` / `aria-expanded` stay on every one of
  them** — the argument is about what a sighted user can already see, which
  says nothing about a screen reader — and the two toggle tests now assert
  the class is absent while the ARIA state is true, so the wash cannot come
  back unnoticed. Scope is `.iconbtn` alone: DL-23.5's rows inside the
  `More` menu still report state. No PTY, window, materialization or close
  path changed. Renderer-only, so it reaches Tauri too, where nothing has
  been run.
- 2026-08-16: **a group label heading a list of rows outranks its rows** —
  touched `DESIGN-LANGUAGE` (DL-4.4's ladder and DL-3.4's tone hierarchy
  amended in place, §5's diagram, DL-15.5 decoupled, DL-27.9 generalised, a
  §10 ledger entry closed). The agent rail's project header, `.cfg-group` in
  every §5 surface and the rail footer's `Tools` moved from
  `--type-micro`/`--text-faint` to `--type-title`/`--text-muted`, one rung
  above the `--type-body` rows under them. User asked for it from a
  screenshot of the rail, chose 14-over-12.5 rather than demoting the row
  names, chose the brighter tone, and chose to carry it to every group label
  rather than the rail alone. Column headers deliberately stayed at
  10.5/faint (DL-15.5), which had defined itself as "the same treatment as a
  `cfg-group` label" and no longer can. No new size: DL-4.5's closed
  exception list is untouched. **One real defect fell out of it** —
  `.sidebar-actions__label` sized itself with `var(--type-caption)`, a token
  this app never declared, so the declaration was invalid and the label had
  been inheriting the shell's size since §28 shipped. Nothing in the repo
  checks that a `var(--type-*)` name is one of the four. Renderer-only, so
  it reaches Tauri too, where nothing has been run.
- 2026-08-16: **the icon library changed** — `lucide-preact` out,
  `@phosphor-icons/react` in, at `weight="regular"`. Touched
  `DESIGN-LANGUAGE` (DL-1.1's dependency exception **moved** rather
  than widened, DL-14.1 rewritten, DL-14.3 gained `fill`, DL-14.5
  gained the git-mark ruling, one new §10 ledger row) and a
  **dependency**, which is the listed fork; `docs/ARCHITECTURE.md`
  and `docs/CONTEXT.md` followed. User asked for another library's
  icon set, was told Lucide is outline-only so a different look means
  a different package, chose Phosphor over Tabler/Heroicons/retuning
  the stroke, chose to eye-review a gallery specimen before the swap,
  and picked `regular` from it. Three things moved that are not
  icons: `tsconfig.json` gained `paths` react/react-dom →
  `preact/compat` (Phosphor is a React package — this changes how the
  WHOLE repo typechecks from here on), the stylesheet's icon rule now
  hangs off `DeckIcon`'s own `.deck-icon` class instead of the
  vendor's `.lucide`, and `DeckIcon` gained `mirrored` because
  Phosphor draws one-sided marks facing left only. Phosphor is
  genuinely thinner in one place: no folder-with-git and no
  branch-with-plus, so `FolderGit2` → `GitFork` (parked
  `RepositoryRail`) and `GitBranchPlus` → `GitBranch` (live open
  board) to keep DL-14.5. `FolderX` → `FolderDashed`,
  `FolderTree` → `TreeView`, `FileJson` → `BracketsCurly`. The
  gallery specimen was DELETED in the same pass — it was the last
  module importing lucide, so the dependency could not come out while
  it stood. No PTY, window, materialization or close path changed.
  Renderer-only, so it reaches Tauri too, where nothing has been run.
  **Evidence is `npx tsc --noEmit` alone**: no suite, no bundle, no
  native pass, and DL-1.1's gzip ceiling not re-measured.

- 2026-08-16: the **`More` menu's rows grew** — label `--type-body` →
  `--type-title` (14px), chord → `--type-body`, unavailable reason →
  `--type-meta`, icon `ROW_ICON` → `RAIL_ICON` (16px), vertical padding
  5px → 6px, so a row stands 28px instead of 24px. Touched
  `DESIGN-LANGUAGE` (new DL-23.9; DL-4.4's title role and DL-14.2's
  `RAIL_ICON` annotation amended in place) — a rule change, which is the
  listed fork. It is a **role widening, not a fifth rung**: no new size
  exists and DL-4.5's closed exception list is untouched. Offered the
  choice of icon-only (no rule touched) against icon + text, the user
  chose icon 16 + text 14 knowing it needs the amendment. Justified by
  DL-23.8: since the pane group moved permanently off the bar, this menu
  is the only place those four actions ever say their names. Scope is
  `.toolbar-menu__row` alone — §13's other popovers and every §5 config
  row are untouched. Nothing about PTY, windows, materialization or close
  coordination moved; `toolbar-overflow-menu.tsx` changed one import and
  one `size` prop. Renderer-only, so it reaches Tauri too, where nothing
  has been run.
- 2026-08-16: **`TabPopover` and everything it carried were deleted** — tab
  rename, the parked dot-colour picker, the workspace logo, the ⌘⇧R
  `open-tab-options` action and the window-wide popover slot. Touched
  `DESIGN-LANGUAGE` (§13's preamble records that the genre has one member
  left, DL-27.5 amended in place, §18's "removal from the strip, not deletion"
  note superseded for its `TabPopover` half), the action registry and both
  keymaps (`generate:menu:check` green — the action never had a menu item),
  `TabManager.renameTab`/`setTabDotColor` and their private `setOverride`, the
  favicon scan, the image-drop-onto-a-row path and `workspace-logo-store`.
  User asked for the popover and its features to go, from a screenshot, then
  chose "nhổ tận gốc" over keeping the API, and chose to delete the whole logo
  system on being told `WorkspaceLogo` only ever rendered inside a component
  that is not mounted. **Files deleted:** `tab-popover.tsx`,
  `tab-popover-slot.ts`, `workspace-logo.tsx`, `workspace-logo-store.ts`,
  `workspace-sidebar.tsx` and their tests — `WorkspaceSidebar` went because it
  existed to draw that logo list, which takes the parked-rail count from two to
  one. `RepositoryRail` stays, stripped of its popover and logo paths, so a row
  press there is a plain select now. **NOT touched:** the `TabOverride`
  plumbing itself — `tabName`/`dotColor` still ride the window-transfer payload
  and the preset snapshot, dormant, because tearing that out means opening the
  materialization/transfer seam (R4) and nobody asked for it. No PTY, window,
  materialization or close path changed. Renderer-only, so it reaches Tauri
  too, where nothing has been run.
- 2026-08-16: the open board's **config view was deleted** — touched
  `DESIGN-LANGUAGE` (DL-4.5's exception list amended in place, the §10
  ledger's "board cards" row rewritten, a closed-by-deletion entry added,
  DL-29.7 amended where it contrasted itself with the board's grid). User
  said the screen was not needed any more and, asked what a click should do
  instead, chose **open straight through with the remembered combo** over an
  `AgentQuickPicker` hand-off or moving the chips onto home; on the layout
  half they chose to keep presets and drop only the board's picker. Not a
  materialization fork: `onOpen` is unchanged and still receives
  `(workspace, preset, agent)` — what moved is who decides the last two.
  Two named costs, both disclosed and accepted as part of "bỏ screen này":
  preset **rename/delete** had no other call site and is now unreachable
  (the store keeps both functions), and a remembered agent missing from
  `$PATH` falls back silently because there is no longer a step in which to
  warn. The open path awaits the agent probe rather than reading a
  possibly-empty signal — one click opens, so the old double-click race
  became the normal path. Renderer-only, so it reaches Tauri too, where
  nothing has been run.
- 2026-08-16: `AgentQuickPicker` gained a **worktree destination** and became
  a column of rows — touched `DESIGN-LANGUAGE` (new DL-29.6 and DL-29.7) and
  **tab materialization**, which is a listed fork: `openQuickAgent` took a
  second argument, and a chosen destination now overrides both the new tab's
  cwd and its workspace tag. User asked for the rows, for the worktree and
  branch to be shown, and for both to be changeable; told that git couples the
  two and that changing a branch means `git checkout` into a possibly-dirty
  worktree that may have agents running in it, they chose the
  one-destination reading. No new IPC and no new store: `git_repository`
  already reports a branch per worktree and the rail's scan cache already holds
  the answer. Nothing about PTY, windows or close coordination moved —
  `materialize` gained no parameter, it just receives a different cwd.
  Electron-only in effect (the channel does not exist on the frozen Tauri
  host), where the row is omitted rather than rendered empty.
- 2026-08-16: the agent rail became **project → tab, and stops there** — touched
  `DESIGN-LANGUAGE` (new DL-27.11, amending DL-27.1/27.4/27.5/27.8/27.9/27.10)
  and the rail's own spec (§2.6). From a screenshot of the running Electron
  rail, the user said the project → tab → pane shape was visually dense and
  hard to control, chose the flat two-level direction, then explicitly asked
  to implement it in Electron rather than return to the gallery first. A tab
  is one compact line now: leading agent glyphs, tab name, age, one rolled-up
  state and a fixed hover-close slot. The per-row disclosure, its gutter and
  every nested pane row are gone; the three-glyph budget remains, visible
  glyphs still focus their exact pane and `+N` is an inert count. Per-glyph
  state badges are gone because the row's one mark already owns state. Only
  `asked`/`failed` may spend a second line on a turn. A project header is the
  rail's one disclosure and collapses the whole group. **Same-day follow-up,
  DL-27.12/spec §2.7:** a second running screenshot showed that omitting the
  header for a singleton project made it look like an unrelated tab beside the
  labelled project above. The owner chose one invariant hierarchy, so EVERY
  live project now prints its header and the child row always names its
  tab/agents; the one-tab exception is gone. No tab, PTY, window,
  materialization or close ownership changed. Renderer-only, so the shape
  reaches both hosts; native evidence is Electron only and Tauri remains
  unverified.
- 2026-08-16: the agent rail lost its **pinned `Needs you` block**, stopped
  reordering itself, and moved the age onto a line of its own — touched
  `DESIGN-LANGUAGE` (new DL-27.10; DL-27.5 amended in place, one sentence of
  DL-27.9 voided) and the rail's own spec (new §2.5, amending §2, §3 and §6).
  User asked for all of it from screenshots of the shipped rail: one project is
  printed once with all of its tabs under it, and — asked whether an active
  project should climb to the top — chose to keep the order the projects were
  opened in, because the state marks already say what happened. Ordering now
  reads the window's one open clock, the same key `TabStrip` sorts by, so the
  strip and the rail cannot disagree. `needsYou`/`needsYouCount` left
  `AgentRailView` and `onFocusAttention` left the rail's props; the feature
  itself is untouched — `focus-next-attention` (⌘⇧A, View menu) still walks to
  the next waiting pane through the same preflight. The age moving off the name
  line pushed the hover actions onto the meta line's trailing end, in reserved
  space, because the trailing pair they used to cover is now 10px wide and
  agent chips are targets rather than readouts. No PTY, window,
  materialization or close path changed. Renderer-only, so it reaches Tauri
  too, where nothing has been run.
- 2026-08-16: the feature toolbar became **the `More` control alone** —
  touched `DESIGN-LANGUAGE` (§23 preamble amended in place, new DL-23.8).
  Split vertically, Split horizontally, Focus expand and Close pane left
  the bar for rows in the menu at every width, so the stage strip's
  trailing end carries one `Ellipsis` button instead of four glyphs.
  User asked for it from a screenshot and chose to move all four rather
  than keep Close pane outside. Nothing moved out of the toolbar's
  ownership — DL-28.3 still keeps pane operations off the rail's footer,
  and `More` is the toolbar's own surface — so no PTY, window,
  materialization or close path changed and every chord is untouched:
  a row calls the same `onActivate` the icon did. One structural
  consequence: `More` was rendered from inside `FeatureToolbar`'s group
  loop, so a bar with zero groups drew nothing at all; the trailing
  block (update pill + `More`) is now placed independently of that loop.
  Top-tab mode's menu prints the pane group first, then the DL-28.4
  rows, separated by the hairline DL-23.5 already carries. Overflow by
  width stays wired but idle. Renderer-only, so it reaches Tauri too,
  where nothing has been run.
- 2026-08-16: a history row became **content plus a named `Resume`
  button**, reversing DL-25.1's "the whole row is the button" — touched
  `DESIGN-LANGUAGE` (DL-25.1 amended in place with its reversal stated,
  DL-25.2 and DL-25.3 amended, new DL-25.5) and nothing else: the row's
  `onResume` contract, `SessionsList` and the store are unchanged. The
  same pass swapped the row's lucide stand-ins (`Bot`/`Terminal`) for the
  agents' real brand marks through `AgentGlyph`, which is what the rail
  rows and the strip chips already draw. User chose an inert row body over
  click-to-select, and an always-visible icon + label over an icon-only or
  hover-revealed control, knowing it costs title width in a 360px column.
  Renderer-only, so it reaches Tauri too, where nothing has been run. It
  also cleared the standing `icon-system` failure: the retired glyph that
  test flagged was inside the docblock this rewrote. **Same-day follow-up,
  from a screenshot:** the panel's agent-filter RAIL was retired for a
  compact chip row above the list (new DL-19.8) — a fixed 120px column at
  the 360px dock floor is a third of the panel and it was spending it on
  labels it clipped to `Cla…`. Same tablist, same DL-21.1/21.2 selection,
  walked with ←/→ instead of ↑/↓, printing short labels with the full name
  kept as the accessible name. The screen variant is untouched. One
  regression found and fixed in the same pass: `.session-row` stopped being
  a `<button>`, which took the UA's `border-box` with it and put an 8px
  horizontal scrollbar under the list.
- 2026-08-16: Settings became **full-bleed over the stage** — touched
  `DESIGN-LANGUAGE` (DL-11 preamble and DL-20.1 amended in place: the
  screen left the `--radius-surface` set). User asked from a screenshot
  to drop the 8px inset, the radius and the raised seam so the surface
  meets the stage edges instead of floating inside them. Matches the
  shell usage/sessions already used when they were full-window screens.
  No PTY, window, materialization or close path changed.
- 2026-08-16: the three modals became **one shell with one dismissal
  contract**, and the scrim gained a blur — touched `DESIGN-LANGUAGE`
  (new §29; DL-1.3 amended with a second scoped exception, this one for
  `backdrop-filter` on `.modal-scrim`; two `filter` debts the ledger had
  never carried recorded in §10 and deliberately not fixed). User asked
  for the base component and for a blurred, more translucent overlay;
  told the exception's cost and shown the no-blur alternative, they
  chose to proceed, which is the owner decision DL-1.3 needed. Scrim
  dismissal defaults ON and `PresetEditor` withdraws it, because that
  modal is the only one holding state that exists nowhere else; it reads
  the pointer PRESS, not the click, so dragging a divider out of the
  panel cannot close it. The digit badges came off the agent chips in
  both the picker and the Open board on the same ask — the keys still
  pick. No PTY, window, materialization or close path changed: `Modal`
  renders a scrim and a panel and nothing more, and the panel classes
  are untouched so the stylesheet did not move. One real bug fell out of
  the work and was fixed with it — `agentQuickPickerOpen` was ranked as
  a modal by `openOverlayRanks()` but missing from `panelObscured()`, so
  ⌘T over an open browser tab drew the picker under the native
  `WebContentsView`. Renderer-only — it reaches Tauri too, where nothing
  has been run.
- 2026-08-16: the agent rail's stream became **clustered by project** —
  touched `DESIGN-LANGUAGE` (new DL-27.9) and the rail's own spec (new
  §2.4, amending §2's "one flat list"). Running the shipped rail showed
  what the spec's corpus could not: §1 measured PROJECTS per hour, never
  TABS PER PROJECT, so four tabs on one workspace printed the same word
  four times and recency scattered the copies. The project name is now
  printed once above its tabs and the row names the tab instead; a
  cluster of one printed no header (superseded later the same day by DL-27.12),
  the pinned block is never clustered
  (void later the same day — DL-27.10 removed that block outright),
  and the header was initially a label with no state, age, disclosure or hit
  target (superseded by DL-27.11's project collapse) — which is what keeps it
  from reinstating the worktree tree spec §9 rules out. The same pass stopped
  printing the fallback message line
  when nobody typed the title, since a derived label only repeated the
  name above it. `AgentRailView.stream` changed type
  (`RailTabRow[]` → `RailStreamGroup[]`); no PTY, window,
  materialization or close path was touched, and the click contract
  (§2.2) is unchanged. User chose grouping over run-dedup or a
  project-level disclosure. Renderer-only, so it reaches Tauri too,
  where nothing has been run.
- 2026-08-16: the tab strip became **one row of one chip shape in open
  order** — touched `DESIGN-LANGUAGE` (new DL-18.10; DL-18.6 and DL-18.8
  amended in place), the `SurfaceStrip` seam (one new optional method,
  `orderKey`) and the keyboard's meaning of a position (⌘1–9 and ⌘9 now count
  chips, reversing the 2026-08-14 digits-stay-terminal-only rule). User chose
  the glyph-led chip from an editor screenshot over keeping today's dot-led
  one, chose interleaving by open time over keeping documents in their own
  segment, ruled out git-status label colours, and asked for the work without a
  spec or plan document. On seeing it rendered they removed the colour dot and
  its picker outright (temporarily — the override stays wired) and took the
  close control's hover off `--red`, both folded into DL-18.10 as same-day
  amendments. Ordering is a pure merge in `src/lib/`
  that `TabManager` and `TabStrip` both consume, so the strip a keyboard
  command walks and the strip painted on screen cannot drift; no PTY, window,
  materialization or close path changed. `AgentGlyph` was lifted out of
  `AgentRail` so a chip and a rail row cannot disagree about what an agent
  looks like. Renderer-only — it reaches Tauri too, where nothing has been run.
- 2026-08-16 (follow-up 2): the rail's `Tools` rows are shortcuts that OPEN and
  report nothing — no selection wash, no `aria-pressed`/`aria-expanded`, and
  pressing the row of a surface already on screen is a no-op. Closing stays with
  each surface's own control. Touched `DESIGN-LANGUAGE` (new DL-28.5, DL-28.2
  amended in place) and added `openDockTab` beside `revealDockTab` — a chord
  stays a toggle, a launcher only opens. User asked for this directly from a
  screenshot. **Known divergence:** top-tab mode's `More` menu still carries
  those five as toolbar items, which DO report state (DL-23.5 keeps state on a
  row that moves off the bar); nothing has been decided for that mount yet.
- 2026-08-16 (follow-up): the rail's `Tools` group grew to five rows — Open
  browser, Token usage, Session history, Prompts, Settings — so the Browser
  left the toolbar and the bar is now the pane group alone; DL-28.3 widened
  to match. The `Open workspace` row moved INSIDE the scrolling list (it
  follows the last workspace instead of sitting under a separator), and the
  `Tools` group took a larger bottom padding so its last row does not sit on
  the window edge. User asked for all three directly, from a screenshot.
- 2026-08-16: the docked right column became a **tabbed side panel** and the
  rail grew an action footer — touched layout, `DESIGN-LANGUAGE` (DL-19.3
  amended, new DL-19.7, §11 preamble, new §28), the settings schema
  (`explorerOpen`/`explorerWidth` retired for `dockOpen`/`dockWidth`, new
  `dockTab`, floor 180→360, default 260→420), the action registry (new
  `toggle-dock`; `toggle-usage` re-tiered `always`→`pane` and its label lost
  its ellipsis) and `openOverlayRanks()`. Token usage and session history left
  full-window for tabs of that column, so the three-way Settings/Usage/Sessions
  mutual exclusion is gone: a docked column displaces the grid instead of
  covering it, which also takes both out of `overlayCoversPane()`. The browser
  deliberately did NOT move back — it stays a stage tab (DL-18.8). User chose
  a tab row inside the column over separate columns, chose to keep the rail's
  footer for Settings + Prompts (the non-surface actions) with top-tab mode
  standing those two up in the toolbar's `More` menu, and asked for the work to
  be implemented directly without a plan document. Electron and Tauri share the
  renderer, so the column reaches both hosts; only Electron has ever been run.

- 2026-08-16: the navigation sidebar gained a resize seam and hides completely,
  and the frame row was reduced to window controls — touched layout,
  `DESIGN-LANGUAGE` (new DL-18.9, DL-19.4 amended in place) and the settings
  schema (`sidebarWidth`, `sidebarCollapsed`). Collapse-to-icon-rail was
  chosen first, on the constraint that the frame row lives inside that column
  and takes the traffic lights with it; the user then chose to hide the column
  outright, put the hide control beside the traffic lights, and move the
  feature toolbar (globe, `More`, split, expand, close pane) to the stage
  strip's trailing end — which removes the constraint instead of working
  around it. No PTY, window or tab seam touched; the dock's own close routes
  through the existing `toggle-dock` action.
- 2026-08-15: chrome text that NAMES something is sentence-case — group labels,
  rail labels, table column headers, row descriptions, range-selector options —
  while values (`on`, `off`, `unbound`, theme ids) stay lowercase. Touched
  `DESIGN-LANGUAGE` (DL-4.3 clarified for acronym/proper-noun casing, DL-4.4,
  §5 diagram, §8, DL-11.4, DL-15.5, §16 appearance note amended in place) and
  the label strings across settings, usage and prompt surfaces. User asked for
  capitalized labels; the label/value split follows their chosen scope.
- 2026-08-15: the Shortcuts settings rows show only the running platform's
  keymap, reversing the 2026-08-11 both-keymaps decision — touched
  `DESIGN-LANGUAGE` (§17 preamble, DL-17.2/17.3/17.4 amended in place; rule
  numbers and DL-17.3's readout precedent kept, since the repository rail
  cites it). User confirmed that an installed app knows its platform and
  dual-column shortcut listings are a docs-page convention. The other
  keymap's overrides remain stored in settings, just not rendered.
- 2026-08-15: session restore reverses the recorded no-restore constraint — touched tab
  materialization (widened `MaterializeIntent.paneCommands`), `AgentLauncher.arm`'s signature
  (now takes `AgentLaunchEntry[]` carrying a per-pane command), the quit-vs-close flush split,
  and the rail's readout→pressable promotion for a worktree with an archived session (reuses
  DL-17.3's border-as-affordance precedent, no new DL rule). Approved through brainstorming
  2026-08-15; plan at `docs/plans/2026-08-15-session-restore.md`.
- 2026-08-15: the daily usage table merged its per-agent rows into one row per
  local day, with each agent's mark and figures stacked inside the `agent`
  cell — touched `DESIGN-LANGUAGE` (new DL-15.9, a §15 amendment) and widened
  `MetricRow.cells` to rendered content. User chose per-agent figures kept
  visible inside the day row over day totals alone or a column pair per agent.
  No aggregation semantics changed: `dailyRows` is untouched and `dailyTotals`
  sums already-rolled-up agent costs, so the 2026-08-10 priced/unpriced rule
  holds. Read-only still: DL-15.2 explicitly reaches inside a cell.
- 2026-08-15: the browser left the docked right column and became a tab on the
  stage strip — touched layout, `DESIGN-LANGUAGE` (new DL-18.8, §19 preamble),
  `TabStrip`, and the `SurfaceStrip` seam's IMPLEMENTATION (a composing wrapper
  in `App`; `TabManager` itself untouched, R4 intact). User chose tab-on-strip
  over keeping any docked mode, one singleton chip beside the file tabs, and
  close-keeps-the-page toggle semantics. `browserWidth` left the settings
  schema; `browserHomeUrl`/`browserLastUrl` are unchanged.
- 2026-08-16: the navigation rail's unit became **a live agent**, not a checkout —
  `AgentRail` replaced `RepositoryRail` in the sidebar slot. Touched
  `DESIGN-LANGUAGE` (new §27, a row genre, carrying the DL-3.2 yellow role and a
  scoped DL-1.2 exception; DL-1.3 deliberately NOT amended), the per-pane
  projection published with `tabViews`, and the stage strip's scope. Approved
  through the gallery specimen on 2026-08-16; design at
  [spec](../docs/specs/2026-08-16-agent-status-rail-design.md) `decided`. No PTY,
  window, materialization or close path changed — the rail reuses
  `TabManager.activateForAttention` and the existing `runAttentionFocus`
  preflight for its pane-exact destination. **Tier 3 (the `session_tail` channel
  behind the message line) is deliberately NOT built**: spec §10 gates it behind
  a native pass and an owner eye review of tier 1.
- 2026-08-15 (amended 2026-08-16): sidebar mode's `TabStrip` followed the selected
  `RepositoryRail` worktree and restored a row's last selected terminal. The unit
  is now the **repository** (`activeRepositoryTabIndexes`), because the rail's rows
  are tabs in a project and a strip scoped tighter than the rail would hide a
  sibling tab the rail still lists. The last-selected-tab-per-worktree memory went
  with `RepositoryRail`. Callbacks still retain global indexes, top-tab mode
  remains global, and tab ownership stays in `TabManager`.
- 2026-08-15: the theme setting became a card gallery and custom themes became imported
  files — touched `DESIGN-LANGUAGE` (new §24, a §5 fork), the settings surface, and three
  new Electron-only IPC channels (`themes_list` / `themes_import` / `themes_reveal`). User
  chose import-from-file over a palette editor, a native picker plus a scanned folder over
  drag-and-drop or paste, `appearance` over a category of its own, and Windows Terminal /
  iTerm2 / Ghostty / Alacritty over VS Code themes (which mostly omit `terminal.ansi*`). No
  new dependency: all four parsers are hand-written. No PTY, window or tab seam touched.
- 2026-08-15: `RepositoryRail` now renders one row per worktree and projects each
  terminal tab as its own focusable agent button. User chose duplicate marks for
  same-agent tabs, a three-button budget with `+N` overflow, and a row close action
  that targets only the active tab; the existing select/close callbacks retain tab
  ownership.
- 2026-08-14: the center stage became the focal theme surface while the navigation and
  docked side panels moved onto one derived recessed background — touched
  `DESIGN-LANGUAGE` (new DL-18.7, amended DL-18.2/DL-18.6/DL-19.2). User required the
  center background to remain distinct from both sidebars under every theme.
- 2026-08-14: the tab strip moved onto the stage in sidebar layout and the document
  moved out of the explorer panel onto the stage — touched layout, `DESIGN-LANGUAGE`
  (new DL-18.6, amended DL-18.3) and the chip-rendering half of `TabBar`. User chose
  one strip carrying both segments beside the kept sidebar, over flipping
  `tabBarPosition` or a file-only strip, and chose to drop the rail's file rows
  rather than duplicate them. No tab coordination moved (R4 seams untouched).
- 2026-08-14: `electron:dev:watch` script + `scripts/electron-dev-watch.mjs` — touched
  `package.json` scripts and `electron/main.ts`'s window-load branch. User chose the
  renderer-HMR-plus-main-process-watch-rebuild approach over renderer-only; no new
  dependency added.
- 2026-08-14: `TabManager.newTab()`/`openQuickAgent` — touched tab materialization
  (`tab-manager.ts`'s `materialize()` gained a new call site) and `action-registry.ts`'s
  `new-tab` scope comment. Approved through a full brainstorming + demo-surface cycle in
  chat first (gallery specimen eye-reviewed before wiring); user chose a lightweight modal
  reusing the Open board's agent chips over reshaping the Open board itself, and chose to
  keep its full flow reachable rather than fold it into the quick picker.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

| "a pane moves between windows without losing output" | `building` | (backlog) | Phase A of the pane-detach work landed 2026-08-10 with every automated gate green, but nothing that needs a real window has been exercised: no window was created, no PTY changed owner, and the lock-across-emit stall named in the plan's §0.6 is invisible to unit tests. The outstanding manual pass is listed in [CONTEXT.md](CONTEXT.md#pane-detach--phase-a-landed-2026-08-10) `building` |

| "the hardened updater installs correctly on Windows" | `building` | (backlog) | 0.11.0 shipped the `ShellExecuteW` fix without ever observing it run: the Windows end-to-end upgrade was deliberately skipped on 2026-08-05. The claim holds on macOS, where rc.1 → rc.2 upgraded for real and the installed bundle kept mode `0755`. See [AGENTS.md](../AGENTS.md) `current` for the accepted cost |

| "Deck shows the Native balanced treatment" | `current` | `unverified` | The 2026-08-16 rollout landed in the shared renderer, but nobody launched `npm run electron:dev` and no owner eye review has happened. Evidence is the suite, the builds, and a `npm run prototype:gallery` browser pass; the Gallery is a dev harness on stub IPC, not the app. See [CONTEXT.md](CONTEXT.md#the-native-balanced-rollout--2026-08-16) `current` |

Updater claims above were re-checked on 2026-08-05 against the published
`0.11.0` bytes; the remaining `current` source/config claims were last checked
on 2026-07-29. Unpassed Windows delivery gates are tracked in
[CONTEXT.md](CONTEXT.md#windows-engineering-preview--2026-07-29) `current`.
Do not remove this section (D7).
