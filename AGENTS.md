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
- **The Electron host is merged; the release path is not.** Tagging still builds Tauri —
  `.github/workflows/release.yml` and `src-tauri/tauri*.conf.json` are the shipping path and
  carrying `electron/` on `main` did not change them. Switching what ships is a separate
  decision, still blocked by Gate A (Apple signing identity) and Gate C (real Windows
  hardware). The owner explicitly allowed MVP work before those gates closed; that risk
  remains accepted, not resolved. See
  [design](docs/specs/2026-08-11-electron-migration-design.md) `decided` and
  [MVP plan](docs/plans/2026-08-11-electron-mvp.md) `building`.
- The Electron cutover is a **clean install** with no settings/workspace migration. The final
  Tauri release must explain the manual transition and old data location. “No Electron” must
  stop being a proof point at cutover; “no accounts, no telemetry” remains valid.
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
- **Gate M has passed packaged, on the owner's verification Mac (2026-08-14), 6/6.** The
  file explorer surface is now built on top of the merged model/host layers: the docked
  panel, the virtualized tree, file-tab chips in both toolbar layouts, `toggle-explorer`
  (⌘⇧B) and `save-file` (⌘S), a focus guard, document-lifecycle fixes, and `fs:changed`-driven
  tree refresh. The [spec](docs/specs/2026-08-12-file-explorer-design.md) `decided` stays
  frozen; full details and evidence in
  [docs/CONTEXT.md](docs/CONTEXT.md#straight-through-completion-run--explorer-surface-board-redesign-usage-acceptance--2026-08-14)
  `current`. **Pending: owner eye review (DL §9.6) and native macOS sign-off** — no
  automated gate establishes this. Adding a CSP later invalidates the Gate M run and
  requires a rerun. Electron only; no Tauri implementation exists.
- **The tabs are one strip on the stage's own frame-row half, and the document
  renders on the stage (2026-08-14).** [`TabStrip`](src/ui/tab-strip.tsx) `current` is
  the chips; `TabBar` is top-tab mode's frame around it and `.stage__strip` is sidebar
  mode's mount (DL-18.6). The editor left `ExplorerPanel`'s preview block for
  `.stage__surface`, which covers the terminal grid rather than replacing it, and
  `RepositoryRail` stopped listing file tabs entirely. Since 2026-08-15, the sidebar
  mount shows only terminal tabs belonging to its selected worktree and restores that
  worktree's last selected tab; top-tab mode remains global. Verified by suite/build only:
  the shape Gate M covered has changed, so **that pass does not carry over** — the
  packaged both-layout manual pass (plan T35) and the owner eye review are owed on
  the new picture. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-stage-tab-strip-and-the-document-off-the-panel--2026-08-14)
  `current`.
- **The token usage dashboard is landed, ported, and its owner-machine acceptance table has
  run (2026-08-14).** The branch merged over `main` during the redesign's phase 5; its Rust
  backend has an Electron port in `electron/usage/` gated by a Rust-produced golden-fixture
  parity test. `docs/DESIGN-LANGUAGE.md`'s §15/§16 now hold its sections, §20/§21/§23 are
  written, and §22 stays reserved — take the next free number above §23 rather than filling
  a gap. The §6.1.8 acceptance table ran against this machine's real `~/.claude`/`~/.codex`
  corpus, all 7 rows pass — but it surfaced a real, unfixed gap:
  [`discoverClaude`](electron/usage/discover.ts#L197-L217) `current` only walks one level into
  `subagents/`, so `subagents/workflows/<id>/*.jsonl` (~25% of this machine's Claude corpus)
  is invisible to every count the dashboard shows. Not remediated; a follow-up task. Windows
  corpus behaviour is unverified (Gate C). The branch's owner-local dirty tree remains owed.
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
- **The theme setting is a gallery of cards, and custom themes are imported files
  (2026-08-15).** [`ThemeGallery`](src/ui/settings/theme-gallery.tsx) `current` replaced the
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
  click on the active chip is now inert. Nothing was deleted (`dotColor`,
  `AgentAttentionMark` and `TabPopover` are untouched and the rail still raises the
  popover), but **⌘⇧R reaches nothing in top-tab mode**, which has no rail. Every chip now has a resting wash
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
  BOTH hosts; **nothing has been run against it — no suite, no build, no native pass**. See
  [docs/CONTEXT.md](docs/CONTEXT.md#the-open-board-stops-asking--2026-08-16) `current`.
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

Resolved:

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
  cluster of one prints no header, the pinned block is never clustered
  (void later the same day — DL-27.10 removed that block outright),
  and the header is a label with no state, age, disclosure or hit target
  — which is what keeps it from reinstating the worktree tree spec §9
  rules out. The same pass stopped printing the fallback message line
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
  [spec](docs/specs/2026-08-16-agent-status-rail-design.md) `decided`. No PTY,
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

## Verification and commands

| Command                       | Purpose                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | browser-only Vite preview; IPC operations fail soft                                                                                                                                                     |
| `npm run tauri dev`           | current native desktop app, the one releases build                                                                                                                                                      |
| `npm run electron:dev`        | the Electron host, built and launched from `dist-electron/`                                                                                                                                             |
| `npm run electron:dev:watch`  | same host with hot reload: renderer loads the Vite dev server (real HMR), main process rebuilds and relaunches on save via [`scripts/electron-dev-watch.mjs`](scripts/electron-dev-watch.mjs) `current` |
| `npm run electron:build`      | typecheck and bundle the Electron main process                                                                                                                                                          |
| `npm run electron:smoke`      | headed smoke test; needs a display server and a real PTY                                                                                                                                                |
| `npm test`                    | Vitest suite                                                                                                                                                                                            |
| `npm run build`               | TypeScript + shipping renderer bundle                                                                                                                                                                   |
| `npm run generate:menu`       | regenerate menu from registry                                                                                                                                                                           |
| `npm run generate:menu:check` | prove generated menu is current                                                                                                                                                                         |
| `npm run prototype:gallery`   | visual comparison gallery at `127.0.0.1:5175`                                                                                                                                                           |
| `npm run build:landing`       | landing production build                                                                                                                                                                                |
| `npm run video:render`        | render marketing video from DOM stage                                                                                                                                                                   |

## Layout

```text
src/                  Preact renderer, xterm panes, stores and chrome
src/host/             facades the renderer calls; the seam between it and either host
src/files/            file model, dirty tracking and editor pieces; no explorer surface
src/browser/          browser tab's stage surface and its Inspect formatting
src/gallery/          dev-only real-component gallery; never imported by app modules
electron/             Electron host: PTY, windows, fs, browser views, menu, IPC
src-tauri/src/        current Rust host: PTY, windows, process snapshot, updater
scripts/              generators and cross-boundary contract/release checks
marketing/            landing and DOM-driven video stage
docs/                 architecture, context, design language, specs/plans/reviews
```

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
- A shell that overflows by one pixel **moves the whole window**. `#root` was
  `overflow: hidden`, which still builds a scroll container, so the first focus the browser
  answered with `scrollIntoView` shifted the traffic lights, the stage strip and the chrome
  off their rows with nothing to scroll them back. It is `overflow: clip` now — keep it that
  way, and treat "the top bar looks misaligned" as a scroll report, not a layout one.

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention.)_

| Claim                                                  | Intent     | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron can replace Tauri on both supported platforms | `building` | unverified | Gate A lacks Apple identity; Gate C lacks a real Windows run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Deck ships the Electron host                           | `decided`  | backlog    | `electron/` is on `main`, but the tag workflow still builds Tauri and the updater path is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pane detach is complete cross-platform                 | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| File explorer is available                             | `decided`  | backlog    | Surface built 2026-08-14 behind a passed Gate M (6/6 packaged), then reshaped the same day — tabs on the stage strip, document on the stage — so that pass no longer covers it. Owner eye review, packaged both-layout pass and native macOS sign-off owed. Electron only, no Tauri implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The browser tab works everywhere Deck does             | `building` | partial    | Electron-only; no Tauri implementation exists. The 2026-08-15 tab-on-stage reshape is verified by suite/build only — native `electron:dev` pass and owner eye review owed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AgentQuickPicker's wired flow is native-verified       | `building` | unverified | Built and wired 2026-08-14; visual design eye-approved via a gallery specimen only — no native `npm run electron:dev` click-through or owner eye review of the wired flow itself yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sidebar collapse and drag-to-close are native-verified | `building` | unverified | Landed 2026-08-16 (DL-18.9; DL-19.4 amended). Suite/build plus a browser (`npm run dev`) measurement of the hide, the drag and both controls — no native `electron:dev` pass, no owner eye review of either surface. The renderer is shared, so the sidebar seam reaches the Tauri host too, where nothing has been run; the Windows collapse floor is unverified (Gate C)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| The unified tab strip is native-verified               | `building` | unverified | Landed 2026-08-16 (new DL-18.10): one chip shape, one row, open order, and the keyboard counting chips. Suite/build plus a gallery screenshot of the merged strip — no native `electron:dev` pass and no owner eye review of the running app. Renderer-only, so it reaches the Tauri host too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The side panel's three tabs work                       | `building` | unverified | Landed 2026-08-16: the docked column became a tab host (file explorer / token usage / session history) and the rail grew an action footer. Explorer and usage: suite/build evidence only — no native `electron:dev` pass, no owner eye review, no gallery specimen, and both were reshaped for a 360–560px column they have never been seen rendered in. **Session history is the exception since 2026-08-16:** it was rendered natively against this machine's real corpus (794 rows, 717 brand marks, 794 `Resume` controls) and measured at dock widths 360 and 520 with zero horizontal overflow — but that is a machine's reading, not the owner's eye, and Windows stays unverified (Gate C). Session history still sits on `src/ui/sessions/`, an untracked copy of an unmerged branch |
| Session restore resumes agent conversations            | `building` | unverified | Landed 2026-08-15, suite/build evidence only (`npm test` 2619 green); no native macOS run, no owner eye review of the rail row; Windows unverified (Gate C); gemini/agy are best-effort by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The agent rail replaces the repository rail            | `building` | unverified | Landed 2026-08-16; suite/build evidence only. No native `electron:dev` pass, no owner eye review of the wired rail (only of the gallery specimen it was ported from). `RepositoryRail` stays parked in the tree until that pass. The stream was reshaped into project clusters the same day (DL-27.9, spec §2.4), then lost its pinned `Needs you` block, its recency ordering and the age on the name line (DL-27.10, spec §2.5) — all suite/build only, plus a static browser preview of the row's two lines and its hover pair. `src/gallery/agent-status-rail.tsx` still draws the pre-cluster shape, so the approved specimen no longer matches the shipped rail                                                                                                                         |
| The rail row shows the agent's newest turn             | `decided`  | backlog    | Tier 3 (`session_tail`) is not built — spec §10 gates it behind the tier-1 native pass. Every message line is the tab title today, so a `failed` row cannot yet show the failure text §3 asks for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The blurred modal scrim is native-verified             | `building` | unverified | Landed 2026-08-16 with DL §29 and DL-1.3's `backdrop-filter` exception. Suite/build plus a browser measurement — the gallery specimen photographed over a synthetic terminal ground, which is where `blur(10px)` was chosen over 6px and 14px. A gallery is a browser, not a host: how the blur composites in a packaged app over a real xterm canvas is unverified, and the frugality claim behind the exception (a transient compositing layer) is reasoned, never profiled. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                             |
| The collapsed feature toolbar is native-verified       | `building` | unverified | Landed 2026-08-16 (new DL-23.8): the pane group moved off the bar into `More`, leaving one `Ellipsis` control at the stage strip's trailing end. Suite/build evidence only — no native `electron:dev` pass and no owner eye review of the running toolbar or of the menu in top-tab mode, where the pane group and the DL-28.4 rows share one popover for the first time. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                                                                                                  |
| The quick picker opens into a chosen worktree          | `building` | unverified | Landed 2026-08-16 (new DL-29.7). Suite/build plus a gallery specimen — **no worktree has actually been opened into**: every test feeds `worktreeDestinations` a fabricated scan, so nothing here proves `git_repository`'s real output resolves to the destinations the row lists, nor that a tab tagged with a chosen worktree files under the right rail row. Electron-only in effect; the row is omitted on Tauri, which has no such channel                                                                                                                                                                                                                                                                                                                                               |
| One click on the open board opens the workspace        | `current`  | unverified | Landed 2026-08-16 with the config view's deletion. **Nothing has been run**: no `npm test`, no `npm run build`, no typecheck, no native pass — the suite was rewritten in the same pass and has never executed. Unproven by anything: that the awaited probe actually closes the fast-click race in a real window, that a remembered `null` agent opens a Shell rather than an agent, and that the notice line is the only reachable failure surface. Renderer-only, so it reaches Tauri too, where nothing has been run                                                                                                                                                                                                                                                                      |
| A preset can be renamed or deleted                     | `current`  | **false**  | Was true until 2026-08-16 and is now unreachable: the layout cards were the only call sites of `renamePreset` / `deletePreset`, and they went with the config view. `presets-store` still exports both. Creating (⌘⇧N / menu) and overwriting (⌘⇧S) still work. Named and accepted at removal time, not an oversight — restoring it needs a new home, most likely a settings section                                                                                                                                                                                                                                                                                                                                                                                                          |

Updated 2026-08-16.
