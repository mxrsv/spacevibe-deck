# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app; no shared DB or API with the SpaceVibe web repos.
> Do not edit sibling repos from this session. Workspace map:
> [`../AGENTS.md`](../AGENTS.md) `current`.

Deck is a terminal for running many agent CLIs side by side. `main` carries **two hosts**: the
Tauri 2 + Rust host that every release still builds, and the Electron host in `electron/` that
is meant to replace it. The renderer is Preact + xterm.js and reaches whichever host it runs
under through the facades in `src/host/`. Everything in this repo — UI strings, comments, docs,
and commits — is **English only**.

Project state: [docs/CONTEXT.md](docs/CONTEXT.md) `current`; architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) `current`; visual rules:
[docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md) `current`.

## Current direction

- **Auto-update is a core requirement.** A release is not complete if distribution falls
  back to manual-download-only. Release claims require platform-specific runtime evidence.
- **Tauri is feature-frozen** except hotfixes and release support. New product features land
  on Electron so they are not implemented twice.
- **Tags ship Electron on both platforms now; Tauri is retired from tag triggers
  (2026-08-20).** [`electron-release.yml`](.github/workflows/electron-release.yml) `current`
  is four jobs (prepare → mac + windows → promote): one `build/vX.Y.Z` (stable) or
  `build/vX.Y.Z-electron.N` (prerelease) tag — its commit must sit on `main` — produces a
  draft that goes public only with all six updater assets present, and a stable release
  publishes the tagged commit's `CHANGELOG.md` section as its notes (missing section = the
  release stays a draft); `release.yml` is `workflow_dispatch`-only for Tauri hotfixes. The
  stable is **`1.0.0`** — the owner named it a V1 (2026-08-20).
  **Gate A is CLOSED for macOS** — owner-verified auto-update against `v0.12.5-electron.2`,
  2026-08-19. Windows ships **unsigned and runtime-unverified by owner decision** (Gate C
  stays open), and an updating Windows `Deck Electron` preview.2 becomes a side-by-side
  `SpaceVibe Deck` install with fresh userData (fork F1's identity). No macOS preview ever
  shipped publicly, so the stable is the first public macOS release. **`SpaceVibe Deck 1.0.0`
  is PUBLIC and is `releases/latest` since 2026-08-20** — run 32383647050, all four jobs
  green, eight assets served; the maiden run before it died in `promote` on a
  transitive-needs empty output and published NOTHING, which is the fail-closed design
  working. See [spec](docs/specs/2026-08-20-electron-stable-release-design.md) `decided` and
  [plan](docs/plans/2026-08-20-electron-stable-release.md) `building`.
- The Electron cutover is a **clean install** with no settings/workspace migration. The final
  Tauri release must explain the manual transition and old data location. “No Electron” must
  stop being a proof point at cutover; “no accounts” remains valid. **“No telemetry” is
  retired, and analytics is ON by default (decided 2026-08-23, committed 2026-08-24 as
  `cdc07a0`):** the 2026-08-22 opt-in model was built, never released, and reversed by
  the owner the next day — no consent question is asked,
  `declined` (the Settings → Privacy switch) is the only state never inferred away, an
  unreadable state file still fails closed to off, and public copy says "on by default,
  no code, paths or prompts" and never "anonymous". `USAGE_CONSENT_ASKED` in
  [`usage-notice.ts`](src/telemetry/usage-notice.ts) `current` is the whole reversal
  switch; the consent modal stays in the tree behind it. Rollout consequence: every
  install of the next release POSTs, so the Worker and the privacy page are
  prerequisites, not follow-ups. See the
  [usage analytics spec](docs/specs/2026-08-22-anonymous-usage-telemetry-design.md)
  `decided` (amended 2026-08-24).
- Electron process classification must use the measured `ps` snapshot path, not
  `node-pty.process`; the latter returned version/executable strings instead of argv0.
- **Pane detach Phase A exists on Tauri**, including IPC contract tests; remaining native
  manual checks live in `docs/CONTEXT.md`. Phase B is Electron-only and still gated by a real
  Windows pointer-capture check.
- **The browser is a tab on the stage strip, not a docked column (2026-08-15).** One chip in
  the strip's second segment (globe + page title); its surface covers the stage like the
  document editor does (new DL-18.8), and the docked right column, its resize drag and the
  `browserWidth` setting are gone. [`composeSurfaceStrip`](src/ui/stage-surface-strip.ts)
  `current` folds it into TabManager's `SurfaceStrip` seam, so ⌘W, tab cycling and
  "last surface, not last tab" reach it without touching R4 seams. The `WebContentsView`
  itself, react-grab Inspect and `electron/browser/` are unchanged. Electron only; verified
  by suite/build only — no native `electron:dev` pass or owner eye review yet. No Tauri
  implementation exists; its behaviour under `npm run tauri dev` is unverified.
- **A grab stops at the clipboard and no longer reaches a pane (2026-08-16, temporary).**
  [`GRAB_PASTE_DISABLED`](src/browser/browser-store.ts) `current` short-circuits
  `deliverGrab`, so react-grab's own copy is the whole delivery — the clipboard carries the
  snippet WITHOUT `formatGrab`'s `Page: <url>` line, which only ever existed on the paste
  path. `GrabTarget`, the `paste` seam, its wiring in `App` and every gate in
  `electron/browser/` are untouched: reverting is flipping that one constant and restoring
  `grabSummary`'s two strings. Verified by the browser suite only — no full `npm test`, no
  build, no native pass. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-grab-stops-at-the-clipboard--2026-08-16) `current`.
- **Gate M is retired as a current acceptance gate (2026-08-23).** Its packaged 6/6 run on
  the owner's verification Mac (2026-08-14) remains historical evidence for the pre-reshape
  explorer only. The maintained [`packaged Monaco smoke`](electron-builder.monaco-smoke.yml)
  `current` keeps the useful regression seam — Monaco, its worker/assets, edit/save and
  Monaco↔xterm focus inside an unsigned local package — without claiming the current explorer
  layout passed. The renamed smoke itself is packaged-verified: the universal build completed
  and [`electron:verify:monaco-smoke`](scripts/verify-electron-monaco-smoke-package.mjs)
  `current` passed twice back-to-back on 2026-08-23, including WebGL-safe xterm input/output
  assertions and process-group cleanup. **Pending: owner eye review (DL §9.6), the packaged
  both-layout manual pass and native macOS sign-off.** Adding a CSP later requires rerunning
  the smoke. Electron only; no Tauri implementation exists. Historical detail remains in
  [docs/CONTEXT.md](docs/CONTEXT.md#straight-through-completion-run--explorer-surface-board-redesign-usage-acceptance--2026-08-14)
  `current`.
- **The tabs are one strip on the stage's own frame-row half, and the document
  renders on the stage (2026-08-14).** [`TabStrip`](src/ui/tab-strip.tsx) `current` is
  the chips; `TabBar` is top-tab mode's frame around it and `.stage__strip` is sidebar
  mode's mount (DL-18.6). The editor left `ExplorerPanel`'s preview block for
  `.stage__surface`, which covers the terminal grid rather than replacing it, and
  `RepositoryRail` stopped listing file tabs entirely. Since 2026-08-15, the sidebar
  mount shows only terminal tabs belonging to its selected worktree and restores that
  worktree's last selected tab; top-tab mode remains global. Verified by suite/build only:
  **no packaged or native acceptance covers this shape** — the packaged both-layout manual
  pass (plan T35) and the owner eye review are owed on the new picture. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-stage-tab-strip-and-the-document-off-the-panel--2026-08-14)
  `current`.
- **The token usage dashboard is landed, ported, and its owner-machine acceptance table has
  run (2026-08-14).** The branch merged over `main` during the redesign's phase 5; its Rust
  backend has an Electron port in `electron/usage/` gated by a Rust-produced golden-fixture
  parity test. `docs/DESIGN-LANGUAGE.md`'s §15/§16 now hold its sections, §20/§21/§23 are
  written, and §22 stays reserved — take the next free number above §23 rather than filling
  a gap. The §6.1.8 acceptance table ran against this machine's real `~/.claude`/`~/.codex`
   corpus, all 7 rows pass — and the gap that run surfaced is fixed (2026-08-18):
   [`discoverClaude`](electron/usage/discover.ts#L199-L223) `current` walks `subagents/`
   recursively (capped at `MAX_WALK_DEPTH`), so `subagents/workflows/<id>/*.jsonl` (~25% of
   this machine's Claude corpus) counts; the Rust twin got the same walk to keep the
   parity gate honest, and a nested-file case pins both. Windows corpus behaviour is
   unverified (Gate C). The branch's owner-local dirty tree remains owed.
- **The open board is one center surface with three views (home/config/worktree), and
  create-worktree is an Electron-only flow reached from home (2026-08-14).** The board's own
  second sidebar is retired — the app's own `WorkspaceSidebar` is the one sidebar now.
  `git worktree add` runs main-process side via `execFile` argv (never a shell string) behind
  a flat `worktree_add` IPC channel; Windows is unverified (Gate C). Details in
  [docs/CONTEXT.md](docs/CONTEXT.md#straight-through-completion-run--explorer-surface-board-redesign-usage-acceptance--2026-08-14)
  `current`.
- **The tab strip's `+`/⌘T opens AgentQuickPicker, not the Open board, since 2026-08-14.**
  [`AgentQuickPicker`](src/ui/agent-quick-picker.tsx) `current` is a `.modal-scrim` genre
  alongside `PresetEditor`/`SavePresetDialog` (same "modal" tier in `openOverlayRanks()`):
  pick an agent chip (click or digit key `1-9`/`0`) and `TabManager.openQuickAgent` spawns a
  single pane in the active tab's **live** cwd, carrying its workspace tag, no workspace/preset
  step. The Open board's full flow did not go away — `RepositoryRail`'s "Open workspace" footer
  row now opens it directly (`onOpenWorkspace`, renamed from `onNewTab`; `WorkspaceSidebar` got
  the identical rename to keep the two prop-identical for the one-line revert). Verified by
  suite/build only — no native `npm run electron:dev` click-through or owner eye review of the
  wired flow yet, only of the gallery specimen it was built from. See
  [docs/CONTEXT.md](docs/CONTEXT.md#agentquickpicker--the-tab-strip-fast-path--2026-08-14)
  `current`.
- **On a dark theme the side columns rise off the stage now (2026-08-19).** DL-18.7
  amended; DL-2.2 gained one exception. `--sidebar-bg` was the DARKEST surface in the
  window (`bg` mixed 24% toward black) and is `#272D31` on `deck-dark` — lighter than
  the stage — so the terminal is the deepest plane and every chrome surface stands above
  it. The whole dark ladder moved with it: `--chrome-1`/`--chrome-2`/`--tab-active-bg`
  are measured from `--sidebar-bg` rather than from `--bg`
  ([`deriveChromeColors`](src/lib/derive-colors.ts) `current`), because at the old
  offsets a raised sidebar landed BETWEEN chrome-1 and chrome-2 and a popover read as a
  smudge of the column behind it. The dark steps are 3/6/10 against light's 5/9/15 — at
  4/8/14 One Dark's active row falls to 7.13:1 against white, under DL-3.5's 8:1 floor,
  which would flatten every chrome tone to white and start rejecting imports Deck accepts
  today. `--input-bg` sinks from the sidebar back toward the stage instead of climbing,
  and `--seam-raised` joined the ladder because from `--bg` it fell below `--chrome-2`.
  `#272d31` is a LITERAL — it is not reachable by mixing `#17181c` toward white — pinned
  on the background, not the preset id, so all four `deriveChromeColors` callers agree
  and a background override drops the pin. **Light themes are untouched.** Renderer-only,
  so it reaches BOTH hosts; verified by a colour-relationship smoke only — **no `npm test`,
  no build, no typecheck, no native pass, no owner eye review**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-dark-sidebar-rises-off-the-stage--2026-08-19)
  `current`.
- **Appearance shows Light and Dark, and Settings reads as a document (2026-08-19).**
  [`ThemeModeSelector`](src/ui/settings/theme-mode-selector.tsx) `current` — a new DL-6.5
  `binary` radio group over `deck-light`/`deck-dark` — replaced the theme gallery, the import
  row, the themes-folder row and the four colour overrides in one step. **None of that was
  deleted:** every module and parser still builds and still passes its own tests, they are
  imported by nothing in Settings, so a legacy `themeId` keeps resolving and the reversal is
  re-mounting one component (DESIGN-LANGUAGE §24 carries a retirement banner, not a
  deletion). Opening Settings writes NOTHING; a legacy theme is described by whichever
  segment its **resolved** background belongs to ([`themeModeOf`](src/settings/themes.ts)
  `current`), and a click is the explicit conversion — which also clears `colorOverrides`,
  after a confirmation when an imported selection or non-empty overrides would go. New
  installs default to `deck-dark`, and `getPreset`'s fallback moved with it. The section side
  gained a title/description/grouped-surface hierarchy (new DL-11.6), an icon rail below
  720px (new DL-11.7), achromatic chrome (new DL-3.7), a Tab focus trap, an Escape that a
  dirty draft claims first, and a `fieldset` that is disabled until the settings snapshot
  lands. Two owner follow-ons the same day: the rail is **text only** — DL-11.3 retired,
  `settings-nav-icons.tsx` and its test DELETED, `SettingsCategory.Icon` gone, and DL-11.7's
  compact rail re-specified from a 54px icon rail to 132px of truncating text — and Settings
  now covers the **whole window**, frame row included (`position: fixed`, DL-11.1 amended),
  leaving by a **Back** control or Escape. That exemption is Settings-only: the rule it
  reverses exists so a surface cannot strand the user, and the Open board (which can be
  uncancellable) still stops below the strip. **Reset became an ordinary category too**
  (DL-11.5 amended) — the pinned rail foot is deleted and `reset` is the last registry
  entry, because position was never what made it safe (the native confirm is) and a
  destructive config row pinned in a 220px rail had to stack to fit. Renderer-only, so it reaches BOTH hosts;
  verified by targeted suites only — the full-suite and build gates are currently red on
  OTHER sessions' in-flight work, and there is **no native `electron:dev` pass, no
  `tauri dev` pass, and no owner eye review of the running app**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#light-dark-and-settings-as-a-document--2026-08-19)
  `current`.
- **The theme setting was a gallery of cards, and custom themes are imported files
  (2026-08-15).** Superseded above as a SURFACE on 2026-08-19; the machinery below is
  unchanged and still loaded. [`ThemeGallery`](src/ui/settings/theme-gallery.tsx)
  `deprecated` replaced the
  cycle pill inside the `appearance` category; each card is a miniature of Deck painted with
  that theme's own derived colours (new `DESIGN-LANGUAGE` §24, a §5 fork like §12/§13).
  Custom themes are files in `<userData>/themes` — a native picker copies them in, the folder
  is rescanned on mount, and deleting a file is how a theme is removed. Four formats parse in
  the renderer with no new dependency: Windows Terminal JSON, iTerm2 `.itermcolors`, Ghostty,
  Alacritty TOML. VS Code themes are out on purpose. Electron only; verified by suite/build
  only, so **owner eye review and a native `electron:dev` pass are owed**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#theme-gallery-and-themes-as-files--2026-08-15) `current`.
  Since 2026-08-16 the cards are thumbnails — the track caps at 132px instead of stretching
  on `1fr` — and the `colors` rail category is gone: its four rows are a `Colors` group
  inside `appearance`, under the gallery that clears them
  ([`ColorOverrides`](src/ui/settings/color-overrides.tsx) `current`). No DL rule changed.
- **Session restore reopens Deck's tabs and resumes each pane's agent conversation on
  launch, since 2026-08-15.** A debounced [`session-journal`](src/terminal/session-journal.ts)
  `current` mirrors every window's live tabs into `session.json`, with a per-workspace archive
  backing the rail's now-resumable rows. Boot restore
  ([`session-restore.ts`](src/terminal/session-restore.ts) `current`) runs under a crash-loop
  marker, drops dead cwds by a liveness pass, and resolves each built-in pane's exact session id
  through one batched `resume_lookup` IPC call before typing the resume command via the widened
  `MaterializeIntent.paneCommands` and `AgentLauncher.arm(entries)`. Precision:
  claude/codex/opencode get an exact id; gemini always answers `--resume latest`; agy is a
  best-effort byte-scan with a `--continue` fallback; custom agents relaunch their declared
  command unchanged. Quit flushes the journal; a deliberate window close clears its record
  instead, so a closing window's own tabs cannot resurrect as ghost tabs on the next boot.
  `Settings.restoreSessions` (default on) is the kill switch. Electron only, and reverses the
  earlier no-restore decision. See
  [docs/CONTEXT.md](docs/CONTEXT.md#session-restore--2026-08-15) `current`. Verified by
  suite/build only (`npm test` 2619 green) — native macOS pass, owner eye review of the rail
  row, and Windows (Gate C) are all owed.
- **Both docked edges resize by drag and close by dragging past their floor, and
  hiding the sidebar hides it completely (2026-08-16).** New DL-18.9; DL-19.4 amended.
  [`resolvePanelDrag`](src/ui/panel-resize.ts) `current` is the one threshold both seams
  use. The sidebar had no seam at all before this —
  [`SidebarGrip`](src/ui/sidebar-grip.tsx) `current` is new, as are `sidebarWidth`/
  `sidebarCollapsed`. Hidden means width 0: rail, frame row and seam all go, and the
  stage strip carries the traffic-light inset instead. That was only possible after the
  frame row was reduced to window controls — traffic lights plus
  [`SidebarToggle`](src/ui/sidebar-toggle.tsx) `current` beside them — with the feature
  toolbar moved to the stage strip's trailing end. Renderer-only, so it reaches BOTH
  hosts; verified by suite/build plus a browser measurement, with the native pass and
  owner eye review owed on each. See
  [docs/CONTEXT.md](docs/CONTEXT.md#panel-seams-that-close--2026-08-16) `current`.
- **The tab strip is one row of one chip shape, ordered by when things were opened
  (2026-08-16).** New DL-18.10; DL-18.6/18.8 amended. The two segments and the
  `.tabbar__sep` hairline between them are gone: a terminal tab, a document and the
  browser now share a shape and differ only by their glyph — an agent brand mark (or
  `SquareTerminal` for a plain shell), a file-type icon, a globe. **A chip says what is
  open and nothing else:** the owner then removed the colour dot, the agent attention
  mark and the rename popover from the strip — agent state is the rail's job, and a
  click on the active chip is now inert. Nothing was deleted that day
  (`dotColor`, `AgentAttentionMark` and `TabPopover` were all left standing),
  but later the same day `TabPopover`, the rename/logo features and ⌘⇧R were
  deleted outright — so the recorded "⌘⇧R reaches nothing in top-tab mode"
  consequence is moot: the chord is gone from both keymaps. Every chip now has a resting wash
  (`--tab-rest-bg`, 3% of `--tone`, new DL-21.7) and the selected one adds a neutral 1px
  `--hair-strong` frame (a scoped exception in DL-21.1) — a chip floats alone on the
  stage's `--bg`, so "no wash" read as "nothing here" rather than "not selected". The
  strip also closes with the `--seam-recessed` hairline `.tabbar` always had (DL-18.6
  amended), so both layouts separate chrome from the work area the same way. The strip's
  close control hovers on the neutral wash now, not red (the rail's and sidebar's close
  buttons still do; out of scope). Order comes from one
  window-wide clock ([`open-sequence.ts`](src/lib/open-sequence.ts) `current`) merged by
  [`mergeStripOrder`](src/lib/strip-order.ts) `current`, which **`TabManager` and
  `TabStrip` both walk** — so ⌘⇧[/], ⌘1–9 and ⌘9 count chips, and ⌘2 can land on a
  document (this reverses the earlier digits-stay-terminal-only rule). The R4 seam held:
  `SurfaceStrip` gained one optional method, `orderKey`, and TabManager still knows
  nothing about files. Renderer-only, so it reaches BOTH hosts; verified by suite/build
  plus a gallery screenshot of the merged strip — **no native `electron:dev` pass and no
  owner eye review of the running app yet**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#one-strip-one-chip-one-order--2026-08-16) `current`.
- **Every modal is one shell now, and the scrim closes it (2026-08-16).** New
  DESIGN-LANGUAGE §29; DL-1.3 amended. [`Modal`](src/ui/modal.tsx) `current` owns the
  scrim, the `role="dialog"` frame, focus-on-mount and both ways out; `AgentQuickPicker`,
  `SavePresetDialog` and `PresetEditor` supply only a class and a body. None of the three
  could be dismissed by clicking outside before this, because each had hand-rolled its own
  wrapper. Dismissal reads the pointer **press**, not the click, so a drag out of the panel
  cannot close it, and `PresetEditor` withdraws it entirely (`dismissOnScrim={false}`) —
  its draft exists nowhere else. The scrim now blurs: `backdrop-filter` is DL-1.3's one
  sanctioned exception, scoped to that selector, with the wash dropped 65% → 42%. Two
  follow-ons rode along: the `.achip` digit badges came off in BOTH mounts (the keys still
  pick), and `agentQuickPickerOpen` joined `panelObscured()` — ⌘T over an open browser tab
  used to draw the picker underneath the `WebContentsView`. All three panels then took
  `--sidebar-bg`, the recessed plane the rail and dock already stand on (DL-29.6) — one
  step off `--bg` read as a smudge of the blurred stage rather than an object. Renderer-only,
  so it reaches BOTH hosts; verified by suite/build plus gallery measurements — **no native
  `electron:dev` pass and no owner eye review**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#one-modal-shell-and-a-scrim-that-closes--2026-08-16)
  `current`.
- **AgentQuickPicker states a worktree once, then lists agents as rows (2026-08-16).** New
  DL-29.7. A §5 config row at the top of the panel carries the destination as a `menu` value
  (`folder · branch`); below it the agents are a COLUMN, not the open board's wrapped grid.
  **Worktree and branch are one choice, because git makes them one** — a worktree is checked
  out on exactly one branch — so picking a branch independently (a `git checkout` into a
  possibly-dirty tree with agents running in it) is deliberately NOT offered; the open board's
  create-worktree flow stays the way to reach a branch with no worktree.
  [`worktree-destinations.ts`](src/repositories/worktree-destinations.ts) `current` is the
  pure half; no new IPC, since `git_repository` already reports every worktree with its
  branch and `repositories-store` already caches the scan for the rail. `openQuickAgent`
  took a second argument — a destination overrides BOTH cwd and workspace tag, null keeps
  the old behaviour — which is the one materialization seam that moved (fork approved by the
  owner). `git_repository` is Electron-only, so on Tauri the row is omitted entirely.
  Suite/build plus a gallery specimen; **no native pass, no worktree actually opened into**.
- **The open board is home plus the worktree form; picking a workspace opens it (2026-08-16).**
  The Layout + Agent config view is DELETED, not hidden: a click on a recents row, a folder
  from the picker, or a freshly created worktree goes straight to `onOpen` with the combo
  that workspace was last opened with (`lastPresetId` + `lastAgent`, including a remembered
  `null` = Shell), and an unknown folder takes the last-used preset and the first detected
  agent. Choosing an agent per open is `AgentQuickPicker`'s job (⌘T) — the board no longer
  offers one, and `renamePreset`/`deletePreset` lost their only call sites with the layout
  cards, so **a preset can be created (⌘⇧N / menu) but no longer renamed or deleted anywhere
  in the app**. Two consequences carried on purpose: a remembered agent whose binary has left
  `$PATH` now falls back to the first detected one **silently** (the footer that used to warn
  is gone), and the open path AWAITS the `detect_agents` probe, because a click landing before
  it answered would otherwise resolve against an empty list and quietly spawn a Shell. The
  board's one failure line moved to home (`.board-home__notice`, `role="status"`) — it is the
  only place a failed spawn or a missing folder is ever said. Renderer-only, so it reaches
  BOTH hosts; `npx tsc --noEmit` is clean, but **no suite run, no bundle, no native pass**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-open-board-stops-asking--2026-08-16) `current`.
- **Every rail row says what its agent just said; state no longer dims it (2026-08-17,
  amended 2026-08-19).**
  New DL-27.15; DL-27.11's "only `asked`/`failed` may spend a second line" is superseded.
  The sentence is read off the agent's own session log by
  [`session-tail.ts`](electron/resume/session-tail.ts) `current` over a new flat
  `session_tail` channel, and asked for by
  [`session-tail-store.ts`](src/terminal/session-tail-store.ts) `current` — debounced on
  `tabViews`, never on a timer, and **only for panes that have actually run something**, so
  a fresh pane cannot wear yesterday's session's sentence. `claude`, `codex` and — since the
  same day — `opencode` produce a real tail; `gemini`, `agy` and custom agents answer null.
  Two frozen
  decisions were overridden on the owner's explicit ask that day: the rail spec's §2.6
  ("a message line is exceptional") and its §10 sequencing gate ("tier 1 native pass before
  tier 3 starts"). Electron only — on Tauri the rail degrades to the fallback. Verified by
  suite/build plus a gallery pass on the real `AgentRail`; **the native `electron:dev` pass
  and the owner eye review are owed**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-rail-says-what-the-agent-just-said--2026-08-17)
  `current`. On 2026-08-19 the owner withdrew the quiet-row treatment because live,
  clickable agents read as disabled. Every row now keeps full legibility. The trailing
  state vocabulary also collapsed to one static 9px dot: red `failed`, yellow `asked`,
  neutral `working`; `done` and `idle` paint nothing. The project header now reads
  folder → name → trailing caret; its name and folder are 2px larger, and the redundant
  `Workspace` caption is gone. Targeted rail suite only; **no build, native pass, or
  owner eye review of the running result**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-agent-rail-stops-looking-disabled--2026-08-19)
  `current`.
- **The turn TAKES the agent's name, and the strip's chips say it too (2026-08-17).**
  DL-27.15 amended hours after it landed; DL-18.10 amended; DL-20.1 gained a fourth radius
  role. Every rail row is ONE line — the sentence stands where the agent name stood, because
  the brand glyph beside it already said that word and three `claude` rows in one project
  were told apart by nothing else. A name the USER typed still wins and the turn follows it
  on the same line; a pane that has said nothing keeps its agent name, so no row is blank.
  `RailPaneRow.message` is the tail or empty — the custom-name fallback is gone — and
  `RailTabRow` gained `named`. The tab strip prints the SAME sentence through the same
  precedence ([`tabTail`](src/ui/agent-rail-model.ts) `current`), paying for the longer text
  with `--radius-flat` (2px), `--type-meta` and `max-width: 210px`; the chip still reports no
  agent STATE — what 2026-08-16 took off it stays off. Renderer-only, so it reaches BOTH
  hosts; verified by the rail/strip/design-language suites, `npm run build` and gallery
  screenshots — **no native pass, no owner eye review**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#one-line-and-the-sentence-takes-the-agents-name--2026-08-17)
  `current`.
- **opencode moved to SQLite, and Deck was reading a dead store (2026-08-17).** Deck's
  opencode scanner walked `~/.local/share/opencode/storage/`, a json tree that **opencode
  1.18 stopped writing**: everything now lives in `opencode.db` beside it, ids and json
  shapes unchanged. Nothing failed loudly — the old tree is still on disk, so the scan just
  returned stale sessions, which silently broke BOTH the rail's `session_tail` (no sentence)
  and `resolveResume` (session restore resuming the wrong conversation, or none).
  [`opencode-db.ts`](electron/resume/opencode-db.ts) `current` reads it through **`node:sqlite`,
  Node's own driver** — no npm dependency, no native rebuild, no packaging/signing
  consequence (owner-approved fork; `better-sqlite3` was the rejected alternative). Verified
  present in the Node that Electron 43 embeds (24.18.1). `opencode.ts` merges both layouts,
  database first, **deduping by id** — the migration kept ids, and two copies of one session
  would defeat `resolve.ts`'s greedy dedup and hand two panes the same conversation.
  `resolve.ts` itself did not change: it still calls `opencode.candidates`.
  Sub-agent sessions (`parent_id IS NOT NULL`) are excluded — they share their parent's
  directory, and quoting one shows a delegated task's turn as the pane's own. The tail is one
  statement whose two `json_extract` predicates are the file walk's rules in SQL:
  `role = 'assistant'` skips the user, `type = 'text'` skips `reasoning` (which carries a
  `text` field of its own — matching the field prints private thinking on the rail). Electron
  only. Evidence: `electron/resume` suites 45/45 (`opencode-db`, `session-tail`, `resolve`),
  `tsc -p tsconfig.electron.json` clean, and a `tsx` smoke against the owner's real
  `opencode.db` resolving the live `spacevibe-api` pane to its own session id and its own
  sentence. **No full suite, no bundle, no native `electron:dev` pass, no owner eye review.**
- **Chrome ink is neutral gray now, and so are the hairlines (2026-08-17).** New
  DL-3.6; DL-2.3's hairline carve-out closed. `deriveChromeColors` builds the whole
  `--text-*` ladder out of the theme's `foreground`, so three built-in palettes' blue-violet
  ink (Tokyo Night `#c0caf5`, 73% saturated; Catppuccin `#cdd6f4`, 64%) was tinting every
  label, path and menu item in the app. Each built-in `foreground` in
  [`THEME_PRESETS`](src/settings/themes.ts) `current` became the gray of **matching WCAG
  luminance** — every contrast ratio moves by under 0.06, so DL-3.5's floors did not move and
  only the hue is gone. **The ANSI sixteen are untouched**; a `cursor` follows only where the
  palette already had it equal to `foreground`. DL-3.6 binds the four built-ins ONLY — an
  imported theme keeps its file's foreground, so chrome under a tinted import is still tinted.
  `--hair`/`--hair-strong` were the last tokens mixing from `--fg` and now mix from `--tone`
  like the seams. Renderer-only plus a data change, so it reaches BOTH hosts; verified by
  suite/build plus a gallery browser pass — **no native pass and no owner eye review**, which
  is the weakest evidence class for a colour change. See
  [docs/CONTEXT.md](docs/CONTEXT.md#chrome-ink-goes-neutral--2026-08-17) `current`.
- **The quick picker answers the keyboard from anywhere, and every project has
  its own `+` (2026-08-19).** New DL-27.18 and DL-29.8; DL-27.17 and DL-29.5
  amended. [`Modal`](src/ui/modal.tsx) `current` reads Escape at the DOCUMENT in
  the capture phase now — on the panel it only answered while focus was still
  inside the dialog, so one click on the scrim left the modal on screen with
  Escape travelling into the terminal behind it. That fix reaches all three
  modals without any of them changing. `AgentQuickPicker` gained roving focus
  over its rows (ArrowUp/Down/Home/End, Enter as the native press; focus still
  STARTS on the panel per DL-29.2, so a reflexive Enter after ⌘T still does
  nothing), one `--text-faint` line naming the keys — the digits kept working
  after the badges came off on 2026-08-16 and nothing said so — and a missing
  row that opens Settings instead of spawning `command not found`. The rail's
  project header is a row of TWO controls now
  ([`AgentRail`](src/ui/agent-rail.tsx) `current`): `.asr-cluster__toggle`
  keeps folder → name → caret, and `.asr-cluster__add` opens the picker with
  [`quickPickerWorkspace`](src/chrome/events.ts) `current` pinned to that
  project. That signal lives beside `agentQuickPickerOpen` because `newTab()`
  has to CLEAR it — otherwise the next ⌘T inherits the rail's target. A folder
  git does not know is stated by `plainFolderDestination` rather than by the
  panel's "Runs in this workspace" line, which would be a lie about a project
  the user pressed. Renderer-only, so it reaches BOTH hosts; verified by
  targeted suites and `npx tsc --noEmit` only — **no `npm test`, no
  `npm run build`, no native pass, no owner eye review**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-quick-picker-grows-keys-and-every-project-gets-a---2026-08-19)
  `current`.
- **Settings → Agents is the agent catalog, and the commands ship with the app
  (2026-08-19).** Every agent Deck knows is a row stating the command it will launch with,
  and that command comes from the CATALOG, not from a setting:
  [`BuiltinAgent`](src/lib/agent-catalog.ts) `current` gained `defaultCommand` and `url`, so
  a fresh install shows `claude --dangerously-skip-permissions` immediately rather than a
  bare binary waiting for someone to type a flag. Flags are verbatim from each CLI's own
  `--help` on the owner's machine; `opencode` ships bare because its `--auto` is opt-in per
  session. **A user preset replaces the shipped command for that agent** — nothing merges.
  The list splits on what the discovery probe found: **Installed** with a count and a
  Refresh, then **Available to install**, so "can Deck run X" is answered on screen. Two
  settings fields carry the row's controls: `disabledAgents`, because a built-in cannot be
  deleted (the probe finds it again) and the switch is the only thing that takes one out of
  the pickers; and `defaultAgent`, offered on installed rows ONLY, since starring a binary
  that is not on `$PATH` names a default that cannot run.
  **A preset is a command line, not a set of options.** [`launch-profile.ts`](src/lib/launch-profile.ts)
  `current` stores the STRING and one text field adds it. Two earlier builds the same day
  stored semantic options per agent and composed them; neither could express a flag nobody
  had modelled, and both put four controls between the user and a command they already knew.
  The safety rule that made the enums attractive is enforced directly instead:
  `AgentLauncher.arm` writes this string VERBATIM into a live interactive shell, so
  [`commandProblem`](src/lib/launch-profile.ts) `current` refuses separators, substitution,
  redirects, quotes and newlines and says why — a pipeline belongs in a wrapper script
  declared as a custom agent. An agent is **derived from a command's first word**, never
  stored beside it. The journal stores the COMMAND, not a preset id, so editing or removing
  a preset cannot rewrite a running session; on restore only `claude` is re-flagged, its
  flags sitting beside `--resume` where `codex resume` and `opencode` take theirs in
  positions this repo does not model. `cursor-agent` is the sixth built-in, appended LAST so
  every existing digit key keeps its agent; **no Cursor session scanner exists**, so
  `resume_lookup` answers null for a cursor pane and it relaunches bare. **Not built:**
  drag-to-reorder and the per-row expand caret, both of which the owner's reference shows.
  Renderer-only plus a catalog change, so it reaches BOTH hosts; verified by `npm test`
  (3250 passed, 0 failed), `npm run build` and a gallery pass on the REAL component —
  **no native `electron:dev` or `tauri dev` pass**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-agent-catalog--2026-08-19) `current`.
- **The panes of one tab stand inside a frame (2026-08-20).** New DL-27.19. A tab running
  several agents listed its panes as rows that said nothing about belonging together, ever
  since DL-27.13's parent row and elbow guides went behind `PANE_TREE_HIDDEN`; a rounded
  `--hair-strong` hairline at `--radius-control` now closes each such block. It is **CSS
  only** — [the headless-item rule](src/styles/04b-agent-rail-rows.css) `current`
  is exactly "several panes, no parent row", so the frame needed no markup, no model change
  and no R4 seam. The frame is DL-1.3's inset hairline (`box-shadow: inset 0 0 0 1px`), and
  it took two wrong shapes to get there — the owner caught both within minutes. A border
  bled back by `margin: 0 -1px` put 255px of content in the 254px `.asr-rail__list`, and
  `overflow-x: hidden` hides that bar without removing the scroll container (Known traps: a
  1px overflow moves chrome once focus lands in it). An outline then paints on the 1px
  OUTSIDE the block, which that same `hidden` clips — the left stroke simply vanished. An
  inset hairline paints inside: no layout, no overflow, nothing to clip. The
  colour stays neutral: the drawn alternative wore the tab's `TabView.dotColor` (gallery
  column B4) and was turned down, since red and yellow are the status dot's words and
  nothing has been able to SET that field since `TabPopover` was deleted. Electron-only in
  effect — the seam needs `showAgentPresence` — and it rides `PANE_TREE_HIDDEN`, so
  restoring the tree takes named multi-agent tabs back out of the frame. Verified by the
  design-language and agent-rail suites plus a gallery measurement and screenshot of the
  REAL rail — **no full `npm test`, no build, no native pass, no owner eye review**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#one-tab-one-frame--2026-08-20) `current`.
- **⌘+click on a path an agent printed opens it in Deck (2026-08-20).** New
  DL-14.7 and DL-23.11. A path inside a workspace this window already has open
  lands in Deck's own editor as a preview tab, revealed at its line; anything
  else goes to the app selected on a new split-button beside `More`. Containment
  is answered main-process side by
  [`workspaceForPath`](electron/fs/workspace-for-path.ts) `current` through the
  explorer's own `resolveInsideRoot` guard, and it answers the root **as the
  renderer spelled it** — a realpath'd root is a key no file-surface lookup
  knows. Detection gained four grammars (tsc's `(340,15)`, quoted paths and
  Python's `, line N`, git's `a/` prefix stripped renderer-side into the same
  resolve batch, and ESLint's cross-line rows, whose header text is part of the
  provider's cache key). The external apps are a ten-entry catalog mirrored
  across [`src/lib/external-app-catalog.ts`](src/lib/external-app-catalog.ts)
  `current` and [`electron/external-apps.ts`](electron/external-apps.ts)
  `current`; installed = the bundle exists, the icon is read off that bundle at
  runtime, and launching is `execFile` argv, never a shell string. **One setting
  replaced two:** `externalAppId` where `editorId`/`editorCommand` were, which
  costs the custom editor command — a real loss, in the drift table below.
  `resolve_paths` and `open_editor` are UNCHANGED, so the Rust twin stays valid.
  Detection is renderer-only and reaches both hosts; routing and the button are
  Electron-only. **Tauri keeps today's behaviour because a host that cannot
  ANSWER is a third state, not an empty machine:**
  [`available`](src/host/external-apps-host.ts) `current` (the `__deckHost`
  presence flag `worktree-host.ts` already uses) makes an unanswered host take
  the selection at its word — editor selections keep their template, anything
  else falls back to VS Code's — and hides the button entirely. Verified by suite and
  build only — **no native `electron:dev` pass, no owner eye review, Windows is
  Gate C**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#opening-a-path-an-agent-printed--2026-08-20)
  `current`.
- **The landing's window mock draws the shipped app, not the July one (2026-08-20).** Marketing
  only — **no `src/` or `electron/` file changed**, and no DL rule moved: DL binds app chrome and
  this is a drawing of it. The hero is one still `.a-appwin` in `deck-dark`'s plane order — an
  agent rail of project clusters and per-pane sentence rows, one unified tab strip (terminal +
  file + browser chip), a frame row of traffic lights + sidebar toggle + `New`, three streaming
  panes, and **no status bar and no dock**. The tour's `grid` panel is cut and its whole render
  chain deleted; four panels are rebuilt and two are new (Usage → Overview, Settings → Agents).
  All ten `--sg-*` tokens are re-derived from `deck-dark` and eleven added, each named for the app
  token it mirrors. A pane's script now carries `tail`/`state` per step, which
  [`mountStageStream`](marketing/landing-prototype/src/product-stage.js) `current` writes to every
  `[data-tail]`/`[data-dot]` node the pane owns — `querySelectorAll`, never `querySelector`, and
  scoped to the root it was handed. **Two knowing divergences:** the active chip echoes the FOCUSED
  pane, where the app's `tabTail` prints the LOUDEST; and **the marketing video keeps drawing the
  July shell by choice** (`stage-driver.js` hard-requires `[data-ws-avatar]`), so `stageSidebar` /
  `renderStageSidebar` / `renderStageStatus` survive as video-only and nothing was removed from
  `marketing/stage/`. **`marketing/**` has NO lint signal at all** — it is in `.prettierignore`
  AND in oxlint's `ignorePatterns`, so every "prettier clean" claim over this tree is vacuous.
  Verified by `build:landing`, `vitest run marketing/` 159/159 and a 42-image headless capture at
  1440/768/390 in both motion modes; **owner eye review and `frontend-design-bar` are owed, and
  `marketing/video/out/` is now stale in colour as well as shape**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-landing-stage-draws-the-shipped-app--2026-08-20)
  `current`. Same day, owner-asked (the onorca.dev pattern, adapted): the hero rail
  **densified to six clusters** — a red `failed` row, a second remembered header, and all six
  built-in agents including the `cursor-agent` monogram — and the hero's stage region **cycles
  through four scenes on a timer** ([`HERO_SCENES`](marketing/landing-prototype/src/directions/a.js)
  `current`) behind the ONE live rail: agents (14s) / restore / surfaces / usage (9s each), the
  last three being the panels' own bodies re-mounted, never redrawn. It began the day as a row
  of click pills; the owner replaced them hours later with the automatic cycle ("the workspaces
  run one after another"), which **knowingly amends the 2026-08-19 no-decorative-loops line**:
  this one timer shows work, it is the page's only one, and reduced motion holds the hero still
  on the agents frame. The same review made the window NATIVE: pane grids are flush over a 1px
  `--sg-seam-divider` (no card border, radius, gap, or focus ring — 06-stage-panes.css is the
  reference), and the transcript inks went neutral — `t-tool` purple and `t-ok` green died, the
  codex header blue became dim bold — because the real CLIs print plain foreground. The scene
  animations' gate widened to `:is(.panel, .a-appwin__stage).is-revealed` — one class, two
  writers (the panels' IntersectionObserver and the cycle) — and the
  `var()`-carrying ones moved to animation LONGHANDS — a shorthand holding `var()` is stored
  pending-substitution and Chromium restarts it on any global style recalc, which is what had
  Playwright's own screenshots catching two restore panes at width 0. Verified by
  `vitest run marketing/` 165/165, `build:landing`, the capture gate, and scene screenshots.
- **A chord that cannot do anything no longer eats the key, and Ctrl+C copies or
  interrupts on Windows (2026-08-20).** `handleShortcut` consumed the keystroke the
  moment `matchBinding` returned an action and only then let `overlayBlocksAction`
  decide whether the action could run — so every `scope: "pane"` chord was swallowed
  and then blocked over a file surface, and Ctrl+Shift+C on an open document copied
  nothing AND denied Chromium's own copy. [`isActionPerformable`](src/terminal/action-performable.ts)
  `current` is asked BEFORE `preventDefault()`, and a false answer leaves the event
  alone so it reaches whatever holds focus. The predicate is keyed on the ACTION, not
  the binding, because user overrides replace an action's whole chord set — so
  [`copy-or-interrupt`](src/terminal/action-registry.ts) `current` is a second action
  (Ctrl+C, `WINDOWS_KEYMAP` only, no `menu` field) rather than a flag on
  `copy-selection`. It consumes only while a terminal owns the stage AND holds a
  selection, and it CLEARS that selection so the next press interrupts;
  **Deck writes no `\x03`** — not consuming is what lets xterm encode the interrupt.
  Cancelling after a selection therefore takes two presses, accepted. macOS is
  untouched: ⌘C stays the native Cocoa Copy role. Renderer-only, so it reaches BOTH
  hosts. Verified by `npm test` (3375 passed / 10 failed, all ten reproduced on a
  pristine `HEAD` worktree and attributed to other sessions), both typechecks,
  `npm run build` and `generate:menu:check` — **the Ctrl+C keystroke has never been
  pressed on Windows (Gate C), and there is no host run and no owner eye review**.
  Known gap carried on purpose: macOS **menu**-bound chords (`find`, `clear-buffer`,
  `zoom-*`…) still die over a file surface, because Cocoa consumes their accelerators
  before the webview and no renderer-side reorder can reach them. See
  [docs/CONTEXT.md](docs/CONTEXT.md#performable-keybindings-and-ctrlc--2026-08-20)
  `current`.
- **Tauri users are told the build has stopped updating itself (2026-08-21).** New DL §30.
  [`migration-notice.ts`](src/updater/migration-notice.ts) `current` holds the switch
  (`MIGRATION_NOTICE_ENABLED`, the `GRAB_PASTE_DISABLED` precedent) and a pure
  `shouldShowNotice`, so the case that matters — Electron host → false — is proven without
  mounting anything; [`MigrationBanner`](src/ui/migration-banner.tsx) `current` is the row.
  It became true rather than defensive when `1.0.0` took `releases/latest`: the endpoint
  `tauri.macos.conf.json` serves, `releases/latest/download/latest.json`, now answers **404**,
  so a deployed Tauri client's update check FAILS. The row sits BENEATH the tab strip
  (the strip is `top: 0` and a hidden sidebar puts the traffic lights there), costs
  `--notice-h` of stage height rather than floating over the panes, and its dismissal is
  window-scoped and unpersisted — two windows dismiss twice, accepted. **No file under
  `src-tauri/` and no workflow step changed** (spec §2: the notice must never become a
  second way to reach `download-failed`). `npm test` 3529/0, `npm run build`,
  `generate:menu:check` and the design-language gate are green, plus a gallery screenshot
  of the real component — **no `tauri dev` pass, no `electron:dev` pass proving it stays
  hidden, no owner eye review**. See
  [spec](docs/specs/2026-08-17-tauri-migration-notice-design.md) `decided`.
- **A project cluster goes where the user drags it, and stays there (2026-08-22).** New
  DL-27.20. The rail's clusters sat where their oldest tab put them and the remembered tier
  below them sat in MRU order; the header is the whole cluster's drag handle now, and the
  position survives the case the owner named — the cluster's last tab closing. That works
  because [`RailStreamGroup.orderKey`](src/ui/agent-rail-model.ts) `current` is the
  un-prefixed key both tiers produce, where `key` carries `remembered:` and therefore
  changes. [`rail-order.ts`](src/ui/rail-order.ts) `current` is the pure half: pinned
  clusters first in stored order, everything else in exactly today's order, and an empty
  `railOrder` returns the assembled array ITSELF. A pinned cluster ignores the
  live/remembered boundary — a knowing break with 2026-08-20, because the owner asked for a
  position, not a position within a tier — and a drop pins every cluster above it, or slot 1's
  open order would push slot 2 around. `plain:<path>` entries written before a scan lands
  match AND are rewritten to the repository key on the next write, so the list canonicalizes
  instead of holding two spellings. **Only the CLUSTER drags** (owner: not a tab row, not a
  pane row, not between clusters), which is what keeps this off the tab strip: the shared
  order key is about TABS and no `openedAt` is rewritten. Settings are app-level, so a drag
  reorders every window's rail. Renderer-only, so it reaches BOTH hosts; targeted suites,
  typecheck, lint and the DL gate are green over every file it touches, but **the full suite,
  the build, a host pass and the owner eye review are all owed — no cluster has been dragged
  in a running app.** See
  [spec](docs/specs/2026-08-22-rail-workspace-reorder-design.md) `decided`.
- **Every rail row closes what it names, and the window outlives its last agent
  (2026-08-22).** New DL-27.21. The rail drew AGENTS and closed TABS: a single-agent row's
  ✕ said `Close tab`, a multi-agent tab's rows had no ✕ at all (DL-27.13's parent row is
  behind `PANE_TREE_HIDDEN`, so closing one of three agents from the rail was impossible),
  and a project header's ✕ existed only on a REMEMBERED cluster, where it forgot a folder.
  One rule replaces the three: **the control closes the thing its row names.** An agent row
  closes that pane — ⌘W's own contract, so the tab follows only when the pane was its last
  ([`closePaneAt`](src/terminal/close-coordinator.ts) `current`, deciding from
  `manager.paneCount()`, never from the rail's agent-row count); a row with no agent is a
  shell tab and closes the tab. **A tab holding one agent beside a plain shell now survives
  that agent's close** — carried on purpose, since the alternative kills a shell nobody
  asked about. A project header closes every tab of the repository, secondary worktrees
  included, under ONE busy dialog over every pane
  ([`closeTabs`](src/terminal/close-coordinator.ts) `current`, which pins entries by
  identity before the first dispose and answers `false` for a decline, so a cancelled close
  cannot forget a project whose tabs are all still open) and THEN takes the project off the
  rail — `RailStreamGroup.historyPaths` is populated for LIVE clusters now, by prefix attach
  AND by project key, because a worktree of the same repository with nothing open in it is
  attached to no live path and would rebuild the header under its own `orderKey`.
  **`disposeTab` stopped closing the window:** the last agent leaves the window standing on
  the Open board with its project headers intact, and `flushSettingsSave` went with the
  close it existed for. `removeEmptyTab`'s `closeWindow` (the pane-MOVED path) is
  deliberately unchanged, and no pty exit reaches `disposeTab` at all — a tab's last pane
  exiting prints `[Session ended]` and removes nothing. ⌘⇧W is untouched. A leaf became a
  DL-27.1 container plus hit layer, since a button cannot hold one. Renderer-only apart from
  that one `disposeTab` branch, so it reaches BOTH hosts. `npx tsc --noEmit` clean and the six
  affected suites green (183 tests) after a medium code review caught three real defects in
  this work — an unused `flushSettingsSave` import that broke the build, an ES2022 `Array.at`
  in a test under an ES2020 `lib`, and `closePaneAt` routing on a STALE index before checking
  pane membership, which could close an unrelated single-pane tab silently. **Still owed: full
  `npm test`, `npm run build`, the design-language gate, a host pass and an owner eye
  review**; no agent has been closed from a leaf and no project from a header in a running
  app. See [spec](docs/specs/2026-08-22-rail-close-model-design.md) `decided`.
- **A rail row quotes its OWN session now, because the pairing is remembered
  (2026-08-22).** Three rows in one cluster printed the identical sentence, each stamped
  `now`. It was said once and copied: the tail request carried `(agent, cwd, lastSeenAt)` and
  nothing else, so the pane→session pairing was re-guessed by mtime proximity every 300ms and
  permuted; `merged` kept the previous sentence on a null answer; and null was the COMMON
  answer for a working pane, since only the last 64 KiB was read and an agent's own tool
  traffic fills it (486 of the 616 records past the window were `user:tool_result`, measured).
  So a pane kept a sentence while its session was released to the next pane, which kept it
  too. A request may now carry `preferredId` and
  [`resolveSessionTails`](electron/resume/session-tail.ts) `current` runs **two passes** —
  every pin honoured before anything is ranked, because one pass in request order lets an
  earlier unpinned pane take a later pane's pinned session and the churn resumes. The answer
  became `{ id, tail }`: only the id separates "same conversation, nothing new to quote"
  (keep the row) from "different conversation" (drop it, empty or not).
  [`findCandidateById`](electron/resume/resolve.ts) `current` skips the 30-day cutoff and the
  ranking on purpose — both exist to guess at what a pin states. Two review findings shaped the
  rest. **A pairing must not outlive its agent generation:** a pane id outlives its occupants
  (`claude` → shell → `claude`), and a surviving pairing kept being sent as `preferredId`,
  kept being honoured, and pinned the new agent's row to the old agent's sentence for the life
  of the pane — worse than the drift this change fixes, since a drift self-corrects and a pin
  does not. The forget reads two tells already on `PaneView` (agent label changed, or `hasRun`
  went true → false), and `fingerprintOf` gained `hasRun` and now covers EVERY pane so a
  generation change cannot be skipped as a repeat. **And a mark says "ask for this pane", never
  "this pane is running session X":** `noteResumedPane` briefly carried the resolved session id
  so a restored pane would start out pinned, and that was BUILT AND WITHDRAWN the same day — a
  mark is keyed by (workspace, agent) with no causal link to a pane, is claimed by whichever
  matching pane the poll recognizes first (refs `[none, B]` leave one mark the FRESH pane
  takes), and is left as soon as `materialize` resolves while the command is only armed. Doing
  it properly needs a mark bound to a pane id — the tab-materialization seam, a fork. Also
  from review: the host facade walks the REQUESTS not the reply, `resetSessionTailStore` bumps
  an epoch an in-flight answer checks before merging, and the growing window lost its
  short-read early exit (one `readSync` may legally return short; that is not EOF).
  **Deliberately not fixed:** a fresh pane's FIRST pairing is still ranked (`birthtime` is the
  honest anchor and is unread), the request still carries the TAB's cwd, and the 300-file scan
  cap is global and pre-cwd. `npm test` 3673/8 with every failure proven to belong to other
  sessions on a pristine `HEAD` worktree (this change alone there: 1019/1019), both
  typechecks, `npm run build`, `npm run electron:build` and Prettier clean — **no
  `electron:dev` pass, no owner eye review, and no rail watched for the minutes of live
  traffic the bug needs.** See
  [docs/CONTEXT.md](docs/CONTEXT.md#one-sentence-on-three-rows--2026-08-22) `current` and the
  [plan](docs/plans/2026-08-22-rail-tail-pane-pairing.md) `current`.
- **Markdown opens rendered, and ⌘⇧V flips it to source (2026-08-23).** New DL §31.
  Opening a `.md`/`.markdown` file from the tree shows the RENDERED document instead of
  Monaco; `.mdx` opens as source, because its JSX renders as broken prose. The view is a
  read-only picture of the LIVE BUFFER — saved or dirty — so it rides the external-change
  silent-reload path for free, debounced 150ms so an agent streaming a file cannot thrash
  layout. [`markdown-render.ts`](src/files/markdown-render.ts) `current` is synchronous and
  pure: fenced blocks, mermaid fences and local images come out as `data-md-*` placeholders
  and [`markdown-enhance.ts`](src/files/markdown-enhance.ts) `current` fills them in against
  the mounted node, which is what makes the whole policy assertable as strings with no jsdom,
  no Monaco and no mermaid. Fenced code is tokenized by **Monaco's own colorizer** against the
  enumerated `EDITOR_LANGUAGES` set (no new dependency, and `.md` already lazy-loads Monaco);
  `mermaid` is imported ONLY when a document actually holds a fence, and a diagram that will
  not parse keeps its code block plus the error — never a blank hole. **The feature needs no
  CSP, by design:** raw HTML is escaped and shown verbatim, a link carries no `href` at all
  (the decision rides in `data-md-target`), `javascript:`/`data:`/every unhandled scheme and
  anything resolving outside the workspace root render as PLAIN TEXT, `http(s)` goes out
  through `shell_open_url`, an in-workspace relative link raises the same `requestPathOpen`
  a ⌘+click does, and **images are local-only with no network fetch, ever**. One departure
  from the spec, named: images resolve containment through `workspace_for_path` and read
  through `read_image_as_data_url` rather than `read_file`, which `looksBinary` refuses for
  every PNG — still two EXISTING channels, so **no new IPC** and no contract moves. No R4
  seam moved: `SurfaceStrip` gained two optional methods (`canToggleView`/`toggleView`)
  beside `orderKey` and `runEditCommand`. `toggle-markdown-view` is the 54th registry action,
  performable-gated so ⌘⇧V passes through untouched anywhere else, and **macOS-only —
  Ctrl+Shift+V is already `paste`, and a declined performable action does not fall through to
  a second binding**. Electron-only in effect by inheritance (the file surface has no Tauri
  implementation). `npm test` 3755/8 with all eight proven to belong to other sessions on a
  pristine `HEAD` worktree, both typechecks, `npm run build` and `generate:menu:check` clean,
  and both new dependencies confirmed as their own lazy chunks — but **no native
  `electron:dev` pass and no owner eye review: no diagram has been drawn, no image read off
  disk and no link clicked in a running app.** See
  [spec](docs/specs/2026-08-23-markdown-rendered-view-design.md) `decided`,
  [plan](docs/plans/2026-08-23-markdown-rendered-view.md) `building` and
  [docs/CONTEXT.md](docs/CONTEXT.md#markdown-opens-rendered--2026-08-23) `current`.
- **The rail marks the agent holding the keyboard (2026-08-23).** New DL-27.22.
  A multi-agent tab renders headless (DL-27.13), so DL-27.8's row wash had no row
  to land on and the rail could show a whole column with NOTHING selected — the
  owner reported exactly that, from a screenshot of framed rows. The focused
  leaf now wears DL-21.1's own `--tab-active-bg`, so a one-agent tab marks its
  ROW and a several-agent tab marks its LEAF: one signifier, at most one washed
  row. **The fact had to be plumbed, because nothing carried it:**
  [`PaneView.focused`](src/terminal/tabs-store.ts) `current` is
  `activePaneId()` projected per pane in `syncViews`, and
  [`onActivePaneChange`](src/terminal/terminal-manager-types.ts) `current` —
  fired from `setActive`, where every focus path converges and a repeat already
  early-returns — is what tells the tab layer focus moved. `onPaneFocus` could not do
  it: it is suppressed while `focusPane` drives the focus (so a rail click never
  reached it), gated on the window being foreground, and syncs only when an
  attention ACK changed something, which is `null` for a pane with nothing
  latched. The AND with the tab's own `active` lives in
  [`paneRows`](src/ui/agent-rail-model.ts) `current`, where "at most one focused
  row in the whole rail" is assertable. A document or the browser on the stage
  does NOT clear the mark — the active pane is unchanged, and the row then reads
  as where the keyboard returns to. Renderer-only apart from that one callback,
  so it reaches BOTH hosts; verified by `npx tsc --noEmit`, `npm run build`, the
  five affected suites (156 tests) and a gallery pass on the real rail — **no native
  `electron:dev` pass and no owner eye review of the running app**. See
  [plan](docs/plans/2026-08-23-rail-focused-pane-marker.md) `building` and
  [docs/CONTEXT.md](docs/CONTEXT.md#the-rail-marks-the-agent-holding-the-keyboard--2026-08-23) `current`.
- **Chrome gallery is current:** `gallery.html` mounts real components through `src/gallery/`;
  run `npm run prototype:gallery`. Gallery code must never enter the shipping bundle. Its
  window-chrome section is narrowed to the one selected direction on purpose; parked
  comparison specimens stay in the tree but out of the registry.

Closed release history, updater-fork rationale, measurements and long decision trails belong
in `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, frozen specs/plans, and git — not here.

## Forks

Stop and ask before writing code when a task touches:

- PTY ownership, process classification, window coordinator, tab materialization, layout or
  close/quit coordination, on either host;
- bundle, dependency, signing, release channel, updater or version configuration;
- a rule in `docs/DESIGN-LANGUAGE.md`;
- Electron/Tauri cutover scope or a platform claim without matching hardware evidence;
- any sibling repo.

Not a fork: internal renames, tests, styling within current DL rules, and editing the menu
registry. Record a resolved fork in this queue with a one-line reason; move it to
`docs/ARCHITECTURE.md` when the work closes.

Open queue:

- **Analytics consent reversed to default-on (decided 2026-08-23 in conversation
  after hearing the risks; committed 2026-08-24 as `cdc07a0`).** A fork because it amends DL-29.9 —
  the decision modal's rule now governs a surface that mounts nowhere
  (retirement banner in `docs/DESIGN-LANGUAGE.md`, the §24 precedent) — and
  reverses the 2026-08-22 spec's first principle. `EMPTY_STATE` is `enabled`,
  `parsePersisted` folds every spelling except `declined` into the default,
  the `CONSENT_VERSION` downgrade-to-unanswered gate is deleted (nothing
  renders `unanswered` any more, so a version bump would have silently and
  permanently stopped collection), and README/landing/tour copy state the
  default honestly. Chosen over opt-out-with-notice and ask-with-default-share,
  both offered. NOT resolved here: the Worker, D1 and the privacy page are
  other repos/sessions and are now prerequisites for the next release — an
  opted-in-by-default client's POSTs die silently until they land (today the
  hostname does not even resolve).
- **The rail marks the focused agent, and the terminal manager reports focus
  moving (2026-08-23, owner-decided by choosing option B from three).** Two
  fork-listed categories: **a rule in `docs/DESIGN-LANGUAGE.md`** — DL-27.22 is
  new, and it reverses DL-27.13's "it marks selection with NOTHING" for a
  headless item, which was ruled while the pane TREE was on screen and meant
  _nothing covers the tree_; with the tree behind `PANE_TREE_HIDDEN` a leaf is
  a row, so washing it covers no guides — and **an R4 seam**,
  `ManagerCallbacks.onActivePaneChange`, plus `PaneView.focused`. Chosen over
  patching the existing focus paths (`onPaneFocus` is suppressed while
  `focusPane` drives focus, is gated on the window being foreground, and syncs
  only when an attention ACK changed something; `activateForAttention`'s
  same-tab branch returns before its own `syncViews`) and over a SECOND
  signifier for tab-vs-pane, which would have put two washes in one column. The
  callback is fired from `setActive` because that is where every FOCUS path
  converges and it already early-returns on a repeat, so the consumer can be
  unconditional; the structural paths (split, close, respawn, adoption) assign
  `activeId` directly and are covered by `onLayoutChange` and the pane poller,
  which is why this is additive rather than a re-routing. NOT
  touched: PTY ownership, process classification, the window coordinator, tab
  materialization, layout, close/quit coordination, IPC, settings, the keymap
  or any sibling repo.
- **Two new dependencies and a new DL section for the rendered markdown view
  (2026-08-23, owner-decided by "implement this spec right now").** Three
  fork-listed categories: **dependencies** — `marked` and `mermaid` join
  `dependencies`, chosen by the owner over a hand-rolled subset, over
  `markdown-it` (needs plugins for task lists) and over the remark/unified tree
  (~10+ transitive packages), with mermaid's weight accepted because the import
  is gated on a document actually holding a fence; **a rule in
  `docs/DESIGN-LANGUAGE.md`** — §31 is new, and DL-31.1 admits a SECOND type
  scale scoped to one selector subtree, which DL-4.5's "never a second standard
  ladder" does not cover because it was written about chrome; and **the
  `SurfaceStrip` seam**, which gained `canToggleView`/`toggleView` as optional
  methods (the `orderKey` precedent). Two decisions the spec left open are
  resolved here and recorded in the [plan](docs/plans/2026-08-23-markdown-rendered-view.md)
  `building`: ⌘⇧V is **macOS-only**, because a performable action that declines
  its key does not fall through to a second binding and Ctrl+Shift+V is already
  `paste`; and images take `workspace_for_path` + `read_image_as_data_url`
  rather than spec §6's `read_file`, which refuses every PNG as binary — both
  channels already exist, so **no new IPC** and spec §9's "no contract moves"
  survives. NOT touched: PTY, window coordinator, tab materialization, layout,
  close/quit coordination, bundle/signing/updater configuration, or any sibling
  repo.
- **The consent question became a decision modal (2026-08-22, owner-decided in
  conversation, hours after the row shipped).** A fork because it adds a DL rule —
  DL-29.9, the modal that withdraws BOTH of DL-29.3's exits — and re-amends two more:
  DL-30.1 (the notice row is back to one instance) and DL-30.5 (the decision-row branch
  moved out with the consent question). `Modal` gained `dismissOnEscape` (default true;
  only a decision modal may pass false), `browserPanelObscured` gained `usageConsentOpen`
  so the dialog can never draw under the browser's native view, and
  `UsageConsentBanner` was DELETED (component, test, CSS) rather than left unmounted —
  unlike the theme gallery there is no per-user state a revert would want to keep. Spec
  §6 carries the amendment note with the row design kept as the approved record. Chosen
  over showing the modal only while the Open board is up (a restored session would never
  be asked) and over keeping the banner for later launches (two surfaces, one question).
- **Opt-in usage analytics: a third outbound path, main-owned consent state, three IPC
  channels, and two DL amendments (2026-08-22, owner-decided by "implement this spec").**
  The spec's own §13 enumerates the forks and the owner's implement order resolves them:
  the app's outbound paths grow from two (updater, `gh`) to three, running unattended only
  after opt-in; `telemetry_count`/`telemetry_state`/`telemetry_set_enabled` join `CHANNELS`
  plus one `telemetry:state-changed` event; DL §30 widens from "the migration notice" to a
  two-instance notice-row genre (DL-30.1) and DL-30.5 gains the decision-row branch (no ✕)
  — both DL halves superseded the same day by the decision-modal entry above;
  and the analytics state lives in `telemetry.json`, reversing the earlier draft's
  settings-schema fields so copied settings can never carry consent. The public "no
  telemetry" claim is retired in the same change, replaced by precise opt-in wording. NOT
  resolved here: the `api.deck.spacevibe.dev` subdomain is workspace-level (`../AGENTS.md`,
  X1) and must be recorded in a workspace session; the Worker/D1/privacy-page work is a
  different repo and session, and the client ships dark until it exists.

- **The window outlives its last agent, and the rail's ✕ changed meaning
  (2026-08-22, owner-decided).** The owner's own settled table IS the fork
  resolution. Three fork-listed categories at once: **close/quit
  coordination** — `disposeTab`'s empty branch stops calling `closeWindow()`,
  reversing electron-migration spec §9.5's "every window is a peer, the last
  SURFACE closes THIS window"; **a rule in `docs/DESIGN-LANGUAGE.md`** —
  DL-27.21 is new; and **pane/tab close routing** — `CloseCoordinator` gained
  `closePaneAt` and `closeTabs`. Chosen over reacting to an empty `tabViews` in
  `App` (only `disposeTab` knows the last tab just went, and the board would
  race the sync), over N× `closeTab` for a project (N busy dialogs, stale
  indexes), and over leaving the tab-row ✕ on `closeTab` for a single-agent row
  (which would keep two meanings for one glyph in one column). NOT touched:
  `removeEmptyTab`'s own `closeWindow` — that is the pane-MOVED path, and a
  donor window sitting on a board is worse than one that closes. No R4 seam
  moved, no IPC, no settings field, no keymap action.
- **The migration notice adds DL §30 and ships enabled (2026-08-17 spec,
  built 2026-08-21).** A fork because it adds a rule to
  `docs/DESIGN-LANGUAGE.md` and because it upgrades a frozen decision: the
  migration spec §5 specified a final release's NOTES plus a doc page and
  said "Neither is code". An in-app surface is code; the owner asked for it.
  Ships **enabled** rather than dormant — the alternative (flip the constant
  as the deliberate act that makes a release the final one) was offered and
  declined — so any Tauri hotfix tagged from here carries the notice unless
  `MIGRATION_NOTICE_ENABLED` is set to false for that build. Release-adjacent
  but NOT release configuration: no updater endpoint, channel, signing input
  or workflow step moved.
- **The `More` trigger draws solid at 15px (2026-08-20, owner-asked).** Two DL
  amendments, which is what makes it a fork: DL-14.2's dock-header role
  widening gains the toolbar's `More` trigger (the entry point to every pane
  action since DL-23.8, icon-only at the strip's trailing end), and DL-14.1's
  surface-scoped `filled` list gains its second entry — `DotsThreeOutline`
  solid, a new import, because `DotsThree` at `fill` is the bare-glyph
  knock-out tile DL-14.1 records and its `regular` dots were near-invisible at
  13px. The 24px `.iconbtn` box and the split-button caret beside it are
  unchanged; the overrides live on `feature-toolbar.tsx`'s private
  `ToolbarControl`, not on `ToolbarItem`. Unverified: no typecheck, suite,
  build, host run or owner eye review has run on this change.
- **The rail keeps remembered projects, and the working spinner grew to 14px
  (2026-08-20, owner-asked).** Two halves. The spinner half amends DL-27.3
  twice: 12px `--text-muted` → 14px `--text-primary` because the ring read as
  a smudge, then — same day, owner again — the rotation itself went: the
  drawing is 8 round STILL dots and the motion is a bright head running
  around them on a staggered opacity cycle (`wschase` in `02-shell.css`,
  replacing `wsspin`), so the loop animates only `opacity` and the §5
  working-spinner gap is now about infinity alone. The remembered half ends
  "the rail contains live work only": a
  workspace-history entry whose last tab closed keeps a ROWLESS cluster header
  (still label, no caret — DL-19.7 — plus its own DL-27.18 `+`) after the live
  clusters, deduplicated against every live worktree path and folded per
  repository by the cached scans, which now also cover the recents. Chosen
  over resurrecting the archived-session "resume" rows: the header's `+` is a
  launcher, not a promise to restore a dead session. Model + component +
  CSS only; `openQuickAgent` already handles a destination with no open tab.
  Same day (owner-asked): the launcher glyph became `PlusSquare` at 15px (was
  the bare 13px `Plus`, then `PlusCircle` for minutes — too round beside the
  rows), the header's caret is hover/focus-revealed like the `+` (visible
  while collapsed, since the turned caret is then the only "folded, not
  empty" cue), and the rowless header carries a close of its own —
  `.asr-cluster__remove` in the caret's empty track — that forgets the folder
  by dropping EVERY history entry the header folds (`RailStreamGroup` gained
  `historyPaths` so one X cannot leave a sibling entry that re-derives the
  header). Neutral hover per DL-21.2; omitted when nothing wires it (DL-19.7).
- **A multi-agent tab's rows stand inside a frame (2026-08-20,
  owner-approved).** It is a fork because it adds a DL rule — DL-27.19 — to a
  rail whose tab tier the owner had stripped four times. Chosen over B4, the
  same frame in the tab's own `TabView.dotColor`: the status dot owns red and
  yellow, and nothing can set that field since `TabPopover` was deleted, so
  the colour would ship as a frame nobody can change. Also chosen over
  reviving DL-27.13's parent row, which is the chrome those four passes
  removed. CSS only — the frame rides the `data-headless` seam
  `PANE_TREE_HIDDEN` already produces, so no component, model or R4 seam moved.
- **⌘+click routing, three IPC channels and a settings-schema change
  (2026-08-20, owner-approved by "implement this spec").** Four fork-listed
  categories at once, which the design enumerates in its own §9: two DL rules
  are NEW (DL-14.7, a brand mark supplied by the user's machine at runtime;
  DL-23.11, the toolbar's first split-button), three flat Electron-only channels
  join `CHANNELS`, and `editorId`/`editorCommand` become the single
  `externalAppId`. Chosen over routing inside `openCandidate` (the link provider
  would have to import the file layer, making the `TabManager`-knows-no-files
  seam unobservable) and over stripping git's `a/` prefix in `resolveOne` (a fix
  that would be written twice or become a host parity gap, and would reshape a
  payload R6 freezes). No R4 seam moved.
- **The rail header grew a launcher and Escape left the modal panel
  (2026-08-19, owner-approved).** Both halves change DL rules, which is what
  makes it a fork: DL-27.17's "caret at the far edge" is amended by DL-27.18,
  and DL-29.5's "Escape stops at the panel" by DL-29.8. Chosen over a
  window-level shortcut for the `+` (a chord cannot name WHICH project) and
  over leaving Escape on the panel and re-focusing it after every scrim click
  (a fix that has to be repeated at each new focus sink). **Re-amended the same
  day on the owner's ask:** the `+` moved one slot INSIDE the caret, so
  DL-27.17's trailing caret is restored and the header became a grid whose two
  trailing tracks are the tab rows' own glyph slots — which also closed a
  `width: 100%` + padding overflow that had the header 11px wider than every
  row under it.
- **The dock header grew tooltips, bigger glyphs and two new chords
  (2026-08-19, owner-approved).** Three DL rules move, which is what makes it
  a fork: DL-14.2 gains the dock header at the 15px rung (a role widening, not
  a fifth size), and new DL-23.10 takes §23's tooltip out of the feature
  toolbar and hands it to any icon-only chrome control with an action — which
  also makes dropping the native `title` a rule. The third change is the
  reason for the other two: `toggle-sessions` did not exist (file-explorer
  spec §3.1 shipped the tab with "no shortcut, no menu item"), so one of the
  three chips could print no chord; it is an action now, at ⌘⇧Y, and
  `toggle-dock` — which had a menu item but no accelerator — took ⌘⇧J.
  Chosen over leaving one chip chordless (the row would say "these two are
  reachable by keyboard and this one is not") and over a literal chord string
  in the descriptor (a rebind would not reach it, and one platform's notation
  would ship to the other).
- **`cursor-agent` joined `BUILTIN_AGENTS` (2026-08-19, owner-approved).** The list reaches
  process classification (`agentProcessMatchers`), which is why it is a fork. Appended last
  rather than placed by "reach" so no existing digit key changes agent. `electron/agents.ts`
  mirrors it; `COMMAND_TABLE` gained an entry whose `id`/`latest` forms are unreachable until
  someone writes a Cursor session scanner.
- **Materialization gained a launch-command seam (2026-08-19, owner-approved).**
  `MaterializeIntent.launchCommand` has three states: `undefined` resolves the
  agent's starred preset, `null` forces the bare binary, a string is used as
  typed. `AgentLauncher` still receives one finished string, so its readiness
  state machine did not move.
- **The dark chrome ladder is measured from the sidebar, and one background pins its
  sidebar colour (2026-08-19, owner-approved).** Both halves change DL rules: DL-18.7's
  direction reverses for dark themes, and DL-2.2 admits a literal keyed on a background.
  Chosen over pinning `deck-dark` alone so imported dark themes get the same plane order,
  and over re-tuning the ladder from `--bg` so separation is structural rather than a
  spacing that a lighter import could close.
- **Updater install stands the quit/close census aside (2026-08-17, owner-approved).**
  `quitAndInstall` closes every window and only then emits `before-quit`, so main would
  raise a prompt the renderer already answered through `confirmInstall`, and the install
  would deadlock behind it. `registerUpdater`'s `isInstalling()` is the flag both handlers
  read, and `prepareForInstall` runs `pty.killAll()` then `stores.saveAll()` — `confirm_quit`'s
  own order — because that exit no longer reaches the census.

Resolved forks are logged in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#resolved-forks) `current`.

## Verification and commands

| Command                       | Purpose                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | browser-only Vite preview; IPC operations fail soft                                                                                                                                                     |
| `npm run tauri dev`           | current native desktop app, the one releases build                                                                                                                                                      |
| `npm run electron:dev`        | the Electron host, built and launched from `dist-electron/`                                                                                                                                             |
| `npm run electron:dev:watch`  | same host with hot reload: renderer loads the Vite dev server (real HMR), main process rebuilds and relaunches on save via [`scripts/electron-dev-watch.mjs`](scripts/electron-dev-watch.mjs) `current` |
| `npm run electron:build`      | typecheck and bundle the Electron main process                                                                                                                                                          |
| `npm run electron:package`    | package the Electron host as a local **unsigned** `Deck Electron.app` (arm64, `dir` target, no installer/updater/publish) into `dist-electron-app/`                                                     |
| `npm run electron:smoke`      | headed smoke test; needs a display server and a real PTY                                                                                                                                                |
| `npm test`                    | Vitest suite                                                                                                                                                                                            |
| `npm run build`               | TypeScript + shipping renderer bundle                                                                                                                                                                   |
| `npm run generate:menu`       | regenerate menu from registry                                                                                                                                                                           |
| `npm run generate:menu:check` | prove generated menu is current                                                                                                                                                                         |
| `npm run lint`                | oxlint + prettier check; max-lines stays a warning (101 pre-existing over-length files are backlog)                                                                                                    |
| `npm run prototype:gallery`   | visual comparison gallery at `127.0.0.1:5175`                                                                                                                                                           |
| `npm run build:landing`       | landing production build                                                                                                                                                                                |
| `npm run video:render`        | render marketing video from DOM stage                                                                                                                                                                   |

## Layout

Both hosts are installed in this checkout, so Electron and its native dependencies belong
here now. Adding a feature to one host without the other leaves a parity gap: say which host
it runs on rather than implying both.

## Repo rules

- **R1. English only** for strings, comments, docs and commit messages.
- **R2. Design language is executable policy.** Chrome styling follows numbered DL rules;
  code comments cite them. Fixing a violation also updates the ledger in that document.
- **R3. Menu output is generated.** Edit the registry, then run `generate:menu`; never edit
  generated menu code manually.
- **R4. Load-bearing seams stay explicit.** PTY/window/tab/layout/close modules require a
  plan and cross-boundary verification, not a drive-by refactor.
- **R5. Renderer state uses Preact signals; module stores are window-scoped.**
- **R6. IPC payload shape is a contract.** Keep flat command arguments where the frozen
  frontend contract sends flat keys; `scripts/electron-ipc-contract.test.ts` guards this
  boundary in `npm test` (the excluded Tauri twin stays until `src-tauri/` goes — D8).
- **R7. Gallery imports flow app → gallery only.** Shipping modules must not import
  `src/gallery/` or its stubs.

## Known traps

- The app running an update is the **old build**; updater fixes do not retroactively protect
  the transition into that release.
- Green unit/build checks are not Windows or macOS native evidence. Name untested platform
  behavior as unverified.
- Browser `npm run dev` can paint the shell because IPC failures are caught; it cannot prove
  native persistence, PTY, updater or packaging behavior.
- Two hosts means two answers. A renderer change that passes under Electron says nothing
  about Tauri, which is what users actually run until the cutover.
- Marketing video shares application components and a virtual clock; component changes can
  silently alter rendered media.
- Old `FR-`/`ADR-` references are historical after removal of the ADR pipeline. Do not recreate
  `PIPELINE.lock` or `docs/decisions/` merely to satisfy those comments.
- `src/styles.css` has **no global `box-sizing` reset**, so `width`/`height: 100%` beside a
  `padding` overflows its box. Two shipped defects came from exactly this in one day
  (2026-08-16): `.asr-rail` stood 15px taller than its grid row, and `.session-row` grew a
  horizontal scrollbar the moment it stopped being a `<button>` — form controls get
  `border-box` from the UA, a plain element does not. Declare it on any element you give a
  percentage size and a padding.
- **`.iconbtn` never resets the UA's button padding, so every icon in one leans
  left.** Chrome gives every `<button>` `padding: 1px 6px` and `box-sizing:
  border-box`, and `.iconbtn` sets only `width: 24px` / `height: 24px` /
  `display: grid` / `place-items: center`. The grid TRACK is therefore 12px
  wide against a 15px glyph, and a grid item wider than its track is not
  centred — Chromium clamps the negative offset to the track's start edge. Every
  icon button in Deck sits 1.5px left of centre because of it. The rendered
  view's toggle made it visible by adding a 1px border, which cut the track to
  10px and pushed the glyph 5px off (measured 2026-08-23: 7px of air on the
  left, 2px on the right); it carries its own `padding: 0` now. **The app-wide
  fix — `padding: 0` on `.iconbtn` itself — has NOT been made**, so do not read
  the toggle's local reset as redundant.
- **A custom scrollbar does not repaint when only the SCROLLER's `:hover` flips.**
  `01-tokens.css`'s app-wide treatment paints the thumb `transparent` at rest and
  lights it through `*:hover::-webkit-scrollbar-thumb` — and that rule has never
  reached the screen. Chromium repaints a custom scrollbar when the scrollbar's
  OWN state changes (its hover, a drag, a resize) or when an inherited property
  on the scroller changes; flipping a declaration on the pseudo-element through
  the originating element's `:hover` computes the new value and paints nothing.
  Measured 2026-08-23 against the shipped stylesheet:
  `getComputedStyle(el, "::-webkit-scrollbar-thumb")` answered the 20% colour
  while every pixel of the 6px column stayed background, and the same thumb
  forced to a literal red painted at once. So the only step a user ever sees is
  `::-webkit-scrollbar-thumb:hover`, which fires because hovering the bar IS a
  scrollbar state change — every scroll surface in Deck is effectively
  thumbless until the pointer lands on the 6px strip. Only `.md-doc` is fixed
  (owner-scoped, 2026-08-23): it declares a resting colour and restates its own
  `:hover`, because the tokens file's 32% rule shares its specificity and sits
  earlier in the cascade. The rest of the app still has the defect.
- A shell that overflows by one pixel **moves the whole window**. `#root` was
  `overflow: hidden`, which still builds a scroll container, so the first focus the browser
  answered with `scrollIntoView` shifted the traffic lights, the stage strip and the chrome
  off their rows with nothing to scroll them back. It is `overflow: clip` now — keep it that
  way, and treat "the top bar looks misaligned" as a scroll report, not a layout one.

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention.)_

| Claim                                                                         | Intent     | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron can replace Tauri on both supported platforms                        | `building` | partial    | Gate A is CLOSED for macOS (owner-verified auto-update, 2026-08-19); Gate C still lacks a real Windows run and Windows ships unverified by decision — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| One pushed tag ships macOS and Windows, both self-updating                    | `current`  | partial    | Shipped 2026-08-20: `SpaceVibe Deck 1.0.0` is public and `releases/latest` (run 32383647050, four jobs green, eight assets). macOS self-update was owner-verified on the prerelease channel; **the electron.2 → 1.0.0 hop and everything Windows (install, SmartScreen, self-update) are still unwitnessed** — Windows is unsigned by decision (Gate C); preview.2 on Windows updates into a side-by-side install; Intel Mac and Windows ARM not served — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                    |
| Pane detach is complete cross-platform                                        | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| File explorer is available                                                    | `decided`  | backlog    | Surface built 2026-08-14 after the historical Gate M run, then reshaped the same day — that run is retired as current acceptance. The maintained packaged Monaco smoke passed its renamed universal package/runtime path twice on 2026-08-23, but proves packaging mechanics only; owner eye review, packaged both-layout pass and native macOS sign-off remain owed — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                    |
| The browser tab works everywhere Deck does                                    | `building` | partial    | Electron-only; no Tauri implementation exists. The 2026-08-15 tab-on-stage reshape is verified by suite/build only — native `electron:dev` pass… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AgentQuickPicker's wired flow is native-verified                              | `building` | unverified | Built and wired 2026-08-14 — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Sidebar collapse and drag-to-close are native-verified                        | `building` | unverified | Landed 2026-08-16 (DL-18.9; DL-19.4 amended); suite/build plus a browser measurement only — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The unified tab strip is native-verified                                      | `building` | unverified | Landed 2026-08-16 (new DL-18.10): one chip shape, one row, open order, and the keyboard counting chips — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The side panel's three tabs work                                              | `building` | unverified | Landed 2026-08-16: the docked column became a tab host (file explorer / token usage / session history) and the rail grew an action footer — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Session restore resumes agent conversations                                   | `building` | unverified | Landed 2026-08-15, suite/build evidence only (`npm test` 2619 green) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The agent rail replaces the repository rail                                   | `building` | partial    | Landed 2026-08-16 and reshaped through DL-27.12/spec §2.7: the rail is project → tab only, with 34px flat rows, direct pane-focus glyphs, no tab… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The rail row shows the agent's newest turn                                    | `building` | unverified | Tier 3 (`session_tail`) landed 2026-08-17 (new DL-27.15), then the turn took the agent name's slot the same day and the strip's chips began printing it too — [detail](docs/CONTEXT.md#one-line-and-the-sentence-takes-the-agents-name--2026-08-17) `current`                                                                                                                                                                                                                                                                                                                                                                                               |
| The rail row shows the turn of THAT pane's session                            | `building` | unverified | Was **false** from 2026-08-17 to 2026-08-22 and observed failing: the pane→session pairing was re-guessed by mtime proximity every 300ms, a null answer kept the previous sentence, and null was the common answer for a working pane — so one sentence was copied onto three rows at once and never cleared. Fixed 2026-08-22 by pairing and pinning (`preferredId`, two-pass allocation, `{ id, tail }` answers, a growing read window), then hardened the same day against an adversarial review that found the pairing outliving its pane's agent generation and the id-carrying resume mark pinning the WRONG pane — the first is fixed, the second is withdrawn. `npm test` 3673/8 with all eight attributed to other sessions on a pristine `HEAD` worktree (this change alone there: 1019/1019), both typechecks, both builds and Prettier clean — but **nothing has been watched in a running host**, which is the only place the bug appears, and a FRESH pane's first pairing is still ranked rather than anchored — [detail](docs/CONTEXT.md#one-sentence-on-three-rows--2026-08-22) `current` |
| The blurred modal scrim is native-verified                                    | `building` | unverified | Landed 2026-08-16 with DL §29 and DL-1.3's `backdrop-filter` exception — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The collapsed feature toolbar is native-verified                              | `building` | unverified | Landed 2026-08-16 (new DL-23.8): the pane group moved off the bar into `More`, leaving one `Ellipsis` control at the stage strip's trailing end — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Dragging `New` onto a pane docks an agent pane there                          | `building` | unverified | Landed 2026-08-16 (new DL-27.14) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The quick picker opens into a chosen worktree                                 | `building` | unverified | Landed 2026-08-16 (new DL-29.7) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| One click on the open board opens the workspace                               | `current`  | unverified | Landed 2026-08-16 with the config view's deletion — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The icon set is Phosphor everywhere                                           | `current`  | unverified | Swapped 2026-08-16 (DL-1.1's exception moved, DL-14.1 rewritten): `lucide-preact` uninstalled, 41 source files and 31 class assertions… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A preset can be renamed or deleted                                            | `current`  | **false**  | Was true until 2026-08-16 and is now unreachable: the layout cards were the only call sites of `renamePreset` / `deletePreset`, and they went… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The new chrome typography and the stateless toggles are native-verified       | `building` | unverified | Landed 2026-08-16: group labels went to 14px `--text-muted` (DL-4.4/DL-3.4) and `.iconbtn.is-active` was deleted (DL-21.8) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The neutral chrome ink is native-verified                                     | `building` | unverified | Landed 2026-08-17 (new DL-3.6; DL-2.3's hairline carve-out closed): built-in foregrounds and both hairline tokens went neutral — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A theme can be chosen from cards, imported, or colour-overridden              | `current`  | **false**  | True until 2026-08-19, now unreachable from Settings: `ThemeGallery`, `ColorOverrides` and the import/folder rows are unmounted, though every module still builds and a stored id still resolves — [detail](docs/CONTEXT.md#light-dark-and-settings-as-a-document--2026-08-19) `current`                                                                                                                                                                                                                                                                                                                                                                    |
| The raised dark sidebar and its re-based chrome ladder are verified           | `building` | unverified | Landed 2026-08-19 (DL-18.7 amended, DL-2.2 gained a pinned-literal exception): a colour-relationship smoke over every preset is the only evidence — no suite, no build, no typecheck, no host run, no eye review — [detail](docs/CONTEXT.md#the-dark-sidebar-rises-off-the-stage--2026-08-19) `current`                                                                                                                                                                                                                                                                                                                                                     |
| Light/Dark and the reshaped Settings are native-verified                      | `building` | unverified | Landed 2026-08-19 (new DL-3.7, DL-6.5, DL-11.6, DL-11.7; DL-4.3/4.5/21.3 amended, §24 retired): suite and build only, no host run and no owner eye review of the running app — [detail](docs/CONTEXT.md#light-dark-and-settings-as-a-document--2026-08-19) `current`                                                                                                                                                                                                                                                                                                                                                                                        |
| The rail's per-project `+` and the picker's keyboard are native-verified      | `building` | unverified | Landed 2026-08-19 (new DL-27.18, DL-29.8; DL-27.17/29.5 amended): document-capture Escape, roving focus, a stated key line, a missing row that routes to Settings, and a launcher on every project header, re-amended the same day so the `+` sits one slot INSIDE the caret and the header stops overflowing its rows by 11px. Rail and design-language suites, `tsc` and `npm run build` plus a gallery measurement (caret box and the rows' agent-glyph box are one 17px slot, both branches of the `:has` reserve) — no full suite, no host run — [detail](docs/CONTEXT.md#the-quick-picker-grows-keys-and-every-project-gets-a---2026-08-19) `current` |
| The dock header's tooltips, glyph size and two new chords are native-verified | `building` | unverified | Landed 2026-08-19 (new DL-23.10; DL-14.2 widened): §23's tooltip left the feature toolbar for the dock header, the native `title` came off, glyphs went 13px → 15px, and `toggle-sessions` (⌘⇧Y) / `toggle-dock` (⌘⇧J) became real chords with the Tauri menu regenerated. Targeted suites, `tsc`, `npm run build` and a gallery pass — no host run, and Windows Ctrl+Shift+J beside Chromium's DevTools chord is unverified (Gate C) — [detail](docs/CONTEXT.md#the-dock-header-says-what-it-is-and-its-third-tab-gets-a-chord--2026-08-19) `current`                                                                                                      |
| A custom editor command can be typed for ⌘+click                              | `current`  | **false**  | True until 2026-08-20 and now unreachable: `editorId`/`editorCommand` became the single catalog id `externalAppId`, and a stored `custom` migrates to the first catalog app. Named and accepted at removal time, exactly as the preset rename/delete loss was — restoring it needs a catalog entry that carries a command template. `editor-command.ts` and `open_editor`'s `custom` branch still build and still validate — [detail](docs/CONTEXT.md#opening-a-path-an-agent-printed--2026-08-20) `current`                                                                                                                                                |
| Opening a path an agent printed is native-verified                            | `building` | unverified | Landed 2026-08-20 (new DL-14.7, DL-23.11): ⌘+click routes into Deck's editor, four detection grammars, a ten-app catalog and a split-button. `npm test` 3356/8 with every failure attributed to a concurrent session, `npm run build` / `electron:build` / `generate:menu:check` clean, 133 targeted assertions — but nothing has been clicked in a running host and no bundle icon has ever rendered — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                                       |
| The migration notice reaches Tauri users                                      | `building` | unverified | Built 2026-08-21 (new DL §30) after sitting as a spec since 2026-08-17; urgent now that `releases/latest/download/latest.json` 404s for every deployed Tauri client. `npm test` 3529/0, `npm run build`, `generate:menu:check`, the design-language gate 15/15 and a gallery screenshot of the real row — but **nothing has run under `npm run tauri dev`**, which is the ONLY host that shows it, no `electron:dev` pass proves it stays hidden there, and no owner eye review — [detail](docs/specs/2026-08-17-tauri-migration-notice-design.md) `decided` |
| Ctrl+C copies or interrupts on Windows                                        | `building` | unverified | Landed 2026-08-20 (new `action-performable.ts`; `copy-or-interrupt` is the 53rd registry action). `npm test` 3375 passed / 10 failed with every failure reproduced identically on a pristine `HEAD` worktree, both typechecks, `npm run build` and `generate:menu:check` clean, 4 new chord tests on the real capture-phase listener — but no Windows hardware (Gate C), no host run and no owner eye review — [detail](docs/CONTEXT.md#performable-keybindings-and-ctrlc--2026-08-20) `current` |
| The agent catalog and its shipped commands are native-verified                | `building` | unverified | Landed 2026-08-19 after three reshapes the same day: enum options → typed commands → catalog rows with `defaultCommand`. `npm test` 3250/0 and `npm run build` plus a gallery pass on the real component — no host run; drag-to-reorder and the expand caret are unbuilt — [detail](docs/CONTEXT.md#the-agent-catalog--2026-08-19) `current`                                                                                                                                                                                                                                                                                                                |
| A multi-agent tab's frame is native-verified                                  | `building` | unverified | Landed 2026-08-20 (new DL-27.19): CSS only, on the `data-headless` seam. Design-language and agent-rail suites (57/57), plus a browser measurement proving a framed row and an unframed one start on the same x, and a screenshot of the real rail — no full suite, no build (another session's `terminal-links.ts` is mid-edit and red), no host run, no owner eye review — [detail](docs/CONTEXT.md#one-tab-one-frame--2026-08-20) `current`                                                                                                                                                                                                              |
| The landing stage mirrors the shipped app                                     | `building` | unverified | Landed 2026-08-20 across 21 tasks, marketing-only (no `src/`, no DL rule). `npm run build:landing` clean, `vitest run marketing/` 159/159 (38 before), and 42 headless screenshots at 1440/768/390 in both motion modes with every in-page check passing — but `frontend-design-bar` (gate 3) and the owner eye review (gate 5) are owner-side and NOT run, the capture is Linux chromium rather than macOS type, and `prefers-reduced-motion` was emulated — [detail](docs/CONTEXT.md#the-landing-stage-draws-the-shipped-app--2026-08-20) `current` |
| `marketing/**` has a lint gate                                                | `current`  | **false**  | Measured 2026-08-20 and never true: `marketing/**` sits in `.prettierignore` AND in `.oxlintrc.json`'s `ignorePatterns`, so `npx oxlint marketing/` answers "No files found to lint" and `prettier --check` reports clean without reading the file (proven with `--ignore-path /dev/null`). Every "prettier clean" claim over this tree is vacuous. Not fixed: the sheets are written at 80 columns against prettier's 100, so `--write` would reformat the tree against its own convention — [detail](docs/CONTEXT.md#the-landing-stage-draws-the-shipped-app--2026-08-20) `current` |
| The rendered marketing video matches the app                                  | `decided`  | **false**  | Knowingly stale in SHAPE since the Electron chrome landed, and since 2026-08-20 in COLOUR too: `tokens.css`'s `:root` is shared, so the live video page took the re-derived palette while `marketing/video/out/` still holds the old render. The video entry links and paints (896.2 x 555.8, no console error) and keeps drawing the July shell BY CHOICE — `stage-driver.js` hard-requires `[data-ws-avatar]`. Nothing was re-rendered — [detail](docs/CONTEXT.md#the-landing-stage-draws-the-shipped-app--2026-08-20) `current` |
| A project cluster can be dragged into place                                    | `building` | unverified | Built 2026-08-22 from the [spec](docs/specs/2026-08-22-rail-workspace-reorder-design.md) `decided` (new DL-27.20): `RailStreamGroup.orderKey`, a pure `rail-order.ts`, a delegated pointer controller on the rail's list, and a `railOrder` settings field. Renderer-only, so it reaches BOTH hosts. Targeted suites green (147 assertions across `rail-order`, `rail-cluster-drag`, `settings-schema`, `agent-rail-model`, plus the two reorder cases in `agent-rail.test.tsx`), and `tsc --noEmit` / prettier / oxlint / the design-language gate clean against every file this touches — the four failures in those runs were read and attributed to concurrent sessions. **The full `npm test` (3776/0) and `npm run build` ran green on 2026-08-24 with the whole batch; still owed: a host pass and owner eye review — no cluster has ever actually been dragged.** A code review and a four-angle simplify ran over it: six correctness findings fixed (the worst deleted a cluster from the rail on a duplicated `orderKey`), two cleanups taken, and one declined — the controller reads the rail's DOM instead of taking injected geometry, so spec §8's "mirroring `new-pane-drag.ts`'s deps shape" is not yet true. Cross-window drag is phase 2 and unbuilt; there is no keyboard equivalent — [detail](docs/CONTEXT.md#a-project-cluster-goes-where-the-user-puts-it--2026-08-22) `current` |
| The rail's close model is native-verified                                     | `building` | unverified | Built 2026-08-22 from the [spec](docs/specs/2026-08-22-rail-close-model-design.md) `decided` (new DL-27.21): every agent row carries its own ✕ closing that PANE, a live project header closes every tab of the repository under one busy dialog and then drops its history entries, and the leaf became a container plus hit layer. Renderer-only apart from one `disposeTab` branch, so it reaches BOTH hosts. `npx tsc --noEmit` is clean and the six affected suites are green (183 tests: close-coordinator, agent-rail, agent-rail-model, app, tab-lifecycle, rail-order) — the full `npm test` (3776/0), `npm run build` and the design-language gate ran green on 2026-08-24 with the whole batch, but there is **no `electron:dev` or `tauri dev` pass and no owner eye review**; no agent has been closed from a leaf and no project from a header in a running app — [detail](docs/CONTEXT.md#every-rail-row-closes-what-it-names--2026-08-22) `current` |
| Closing the last tab closes the window                                        | `current`  | **false**  | True until 2026-08-22 and deliberately reversed (close model table row 3): `disposeTab`'s empty branch raises the Open board and leaves the window standing, so electron-migration spec §9.5's "the last SURFACE closes THIS window" no longer describes the tab path. `removeEmptyTab`'s pane-MOVED path still closes the window, and the `surfaces.total() > 0` branch still shows a document instead of the board. Pinned by `tab-manager.tab-lifecycle.test.ts` (the old assertion was inverted, not deleted); never seen in a running host — [detail](docs/CONTEXT.md#every-rail-row-closes-what-it-names--2026-08-22) `current` |
| Deck sends usage analytics by default                                         | `building` | unverified | Built 2026-08-22 as the spec's opt-in client, then REVERSED to default-on by the owner (decided 2026-08-23, committed 2026-08-24 as `cdc07a0`): no consent question, `declined` is the only value never inferred away, unreadable still fails closed, and the consent modal survives behind `USAGE_CONSENT_ASKED=false`. Suite-verified — the telemetry suites' first execution was 62/62 (2026-08-23) and the full `npm test` is 3776/0 with both typechecks and `npm run build` green — but **no host pass and no owner eye review**, and the Worker, D1 and privacy page DO NOT EXIST, so every install of the next release would POST into a hostname that does not resolve today, and Settings links a page that 404s; rollout §12 steps 1-2 are prerequisites now — [plan](docs/plans/2026-08-22-anonymous-usage-telemetry.md) |
| Markdown opens rendered, and its policy holds                                  | `building` | unverified | Built 2026-08-23 from the [spec](docs/specs/2026-08-23-markdown-rendered-view-design.md) `decided` (new DL §31): `.md` opens rendered, ⌘⇧V flips it, Monaco colorizes the fences, mermaid loads only for a document that has one, and the §6 policy (escaped raw HTML, no `href` anywhere, dead `javascript:`/`data:`/out-of-root links, local-only images, no network fetch) is unit-asserted as pure functions. `npm test` 3755 passed / 8 failed with every failure reproduced as another session's uncommitted work and green on a pristine `HEAD` worktree; `src/files` 278/278; both typechecks, `npm run build` and `generate:menu:check` clean; `marked` and `mermaid` measured as their own lazy chunks. **Owed: a native `electron:dev` pass and the owner eye review** — nothing has been rendered in a running host, so no diagram has been drawn, no image read off disk, no link clicked and no colorized fence seen in either theme. Electron-only by inheritance (no Tauri file surface); Windows is Gate C — [detail](docs/CONTEXT.md#markdown-opens-rendered--2026-08-23) `current` |
| “No telemetry” is public copy                                                 | `deprecated` | retired  | Retired 2026-08-22 with the opt-in client, re-worded with the default-on reversal (`cdc07a0`, 2026-08-24): README (both spots) and the landing proof point now say analytics is on by default with no code, paths or prompts and a Settings → Privacy switch; the tour's proof is `cat src/telemetry/payload.ts`, whose quoted lines state only what is absent. The 1.0.0 `CHANGELOG.md` entry keeps the old claim as a frozen release record on purpose — [spec §9](docs/specs/2026-08-22-anonymous-usage-telemetry-design.md) `decided` |
| The rail says which agent holds the keyboard                                  | `building` | unverified | Built 2026-08-23 (new DL-27.22) after the owner reported a rail with no active item: a multi-agent tab renders headless, so DL-27.8's row wash had nowhere to land. `PaneView.focused` projects `activePaneId()`, `ManagerCallbacks.onActivePaneChange` is what tells the tab layer focus moved, and the model ANDs the two so at most one leaf in the rail is washed. `npx tsc --noEmit`, `npm run build`, prettier and the five affected suites are green (156 tests across `agent-rail`, `agent-rail-model`, `terminal-manager`, `tab-manager.tab-lifecycle` and `tabs-store`), plus a gallery pass on the REAL rail measuring exactly one washed row at `--tab-active-bg` with `aria-current="true"`. **Owed: a native `electron:dev` pass and the owner's eye review** — no pane has been focused in a running app; the gallery screenshot shows the wash inside DL-27.19's frame on `deck-dark` only, and no light theme was checked. Renderer-only apart from one callback, so it reaches BOTH hosts — [plan](docs/plans/2026-08-23-rail-focused-pane-marker.md) `building` |

Updated 2026-08-24.
