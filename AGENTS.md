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
- **Every rail row says what its agent just said, and quiet rows dim (2026-08-17).**
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
- A shell that overflows by one pixel **moves the whole window**. `#root` was
  `overflow: hidden`, which still builds a scroll container, so the first focus the browser
  answered with `scrollIntoView` shifted the traffic lights, the stage strip and the chrome
  off their rows with nothing to scroll them back. It is `overflow: clip` now — keep it that
  way, and treat "the top bar looks misaligned" as a scroll report, not a layout one.

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention.)_

| Claim                                                                   | Intent     | Status     | Evidence                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron can replace Tauri on both supported platforms                  | `building` | unverified | Gate A lacks Apple identity; Gate C lacks a real Windows run — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                  |
| Deck ships the Electron host                                            | `decided`  | backlog    | `electron/` is on `main`, but the tag workflow still builds Tauri and the updater path is unchanged — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                           |
| Pane detach is complete cross-platform                                  | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                    |
| File explorer is available                                              | `decided`  | backlog    | Surface built 2026-08-14 behind a passed Gate M (6/6 packaged), then reshaped the same day — tabs on the stage strip, document on the stage — so… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                             |
| The browser tab works everywhere Deck does                              | `building` | partial    | Electron-only; no Tauri implementation exists. The 2026-08-15 tab-on-stage reshape is verified by suite/build only — native `electron:dev` pass… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                              |
| AgentQuickPicker's wired flow is native-verified                        | `building` | unverified | Built and wired 2026-08-14 — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                                    |
| Sidebar collapse and drag-to-close are native-verified                  | `building` | unverified | Landed 2026-08-16 (DL-18.9; DL-19.4 amended); suite/build plus a browser measurement only — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                     |
| The unified tab strip is native-verified                                | `building` | unverified | Landed 2026-08-16 (new DL-18.10): one chip shape, one row, open order, and the keyboard counting chips — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                        |
| The side panel's three tabs work                                        | `building` | unverified | Landed 2026-08-16: the docked column became a tab host (file explorer / token usage / session history) and the rail grew an action footer — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                     |
| Session restore resumes agent conversations                             | `building` | unverified | Landed 2026-08-15, suite/build evidence only (`npm test` 2619 green) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                          |
| The agent rail replaces the repository rail                             | `building` | partial    | Landed 2026-08-16 and reshaped through DL-27.12/spec §2.7: the rail is project → tab only, with 34px flat rows, direct pane-focus glyphs, no tab… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                             |
| The rail row shows the agent's newest turn                              | `building` | unverified | Tier 3 (`session_tail`) landed 2026-08-17 (new DL-27.15), then the turn took the agent name's slot the same day and the strip's chips began printing it too — [detail](docs/CONTEXT.md#one-line-and-the-sentence-takes-the-agents-name--2026-08-17) `current` |
| The blurred modal scrim is native-verified                              | `building` | unverified | Landed 2026-08-16 with DL §29 and DL-1.3's `backdrop-filter` exception — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                        |
| The collapsed feature toolbar is native-verified                        | `building` | unverified | Landed 2026-08-16 (new DL-23.8): the pane group moved off the bar into `More`, leaving one `Ellipsis` control at the stage strip's trailing end — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                               |
| Dragging `New` onto a pane docks an agent pane there                    | `building` | unverified | Landed 2026-08-16 (new DL-27.14) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                              |
| The quick picker opens into a chosen worktree                           | `building` | unverified | Landed 2026-08-16 (new DL-29.7) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                                               |
| One click on the open board opens the workspace                         | `current`  | unverified | Landed 2026-08-16 with the config view's deletion — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                                                                                             |
| The icon set is Phosphor everywhere                                     | `current`  | unverified | Swapped 2026-08-16 (DL-1.1's exception moved, DL-14.1 rewritten): `lucide-preact` uninstalled, 41 source files and 31 class assertions… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                       |
| A preset can be renamed or deleted                                      | `current`  | **false**  | Was true until 2026-08-16 and is now unreachable: the layout cards were the only call sites of `renamePreset` / `deletePreset`, and they went… — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                |
| The new chrome typography and the stateless toggles are native-verified | `building` | unverified | Landed 2026-08-16: group labels went to 14px `--text-muted` (DL-4.4/DL-3.4) and `.iconbtn.is-active` was deleted (DL-21.8) — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                    |
| The neutral chrome ink is native-verified                               | `building` | unverified | Landed 2026-08-17 (new DL-3.6; DL-2.3's hairline carve-out closed): built-in foregrounds and both hairline tokens went neutral — [detail](docs/CONTEXT.md#verification-state-ledger) `current`                                                                |

Updated 2026-08-17.
