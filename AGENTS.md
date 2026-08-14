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
- **Browser panel is built and wired** on the Electron host: a docked `WebContentsView` with
  react-grab Inspect, rendered from `src/browser/` and hosted by `electron/browser/`. No Tauri
  implementation exists; its behaviour under `npm run tauri dev` is unverified.
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
  `RepositoryRail` stopped listing file tabs entirely. Verified by suite/build only:
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

Minimum completion gate: `npm test && npm run build && npm run generate:menu:check`.
Changes under `electron/` additionally require `npm run electron:build`; changes under
`src-tauri/` require the focused Rust tests; release/updater work requires its dedicated
scripts and real target-platform checks. `npm test` excludes three suites by configuration;
the live IPC gate is `scripts/electron-ipc-contract.test.ts`, which `npm test` runs — the
excluded `scripts/ipc-contract.test.ts` is the superseded Tauri twin, kept for a Gate C
abort (D8, 2026-08-14). Rendered UI changes require
screenshot/recording approval; automated checks do not establish native visual correctness.

## Layout

```text
src/                  Preact renderer, xterm panes, stores and chrome
src/host/             facades the renderer calls; the seam between it and either host
src/files/            file model, dirty tracking and editor pieces; no explorer surface
src/browser/          docked browser panel and its Inspect formatting
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

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention.)_

| Claim                                                  | Intent     | Status     | Evidence                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron can replace Tauri on both supported platforms | `building` | unverified | Gate A lacks Apple identity; Gate C lacks a real Windows run                                                                                                                                                                                                                                       |
| Deck ships the Electron host                           | `decided`  | backlog    | `electron/` is on `main`, but the tag workflow still builds Tauri and the updater path is unchanged                                                                                                                                                                                                |
| Pane detach is complete cross-platform                 | `building` | partial    | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open                                                                                                                                                                                                         |
| File explorer is available                             | `decided`  | backlog    | Surface built 2026-08-14 behind a passed Gate M (6/6 packaged), then reshaped the same day — tabs on the stage strip, document on the stage — so that pass no longer covers it. Owner eye review, packaged both-layout pass and native macOS sign-off owed. Electron only, no Tauri implementation |
| The browser panel works everywhere Deck does           | `building` | partial    | Electron-only; no Tauri implementation exists                                                                                                                                                                                                                                                      |
| AgentQuickPicker's wired flow is native-verified       | `building` | unverified | Built and wired 2026-08-14; visual design eye-approved via a gallery specimen only — no native `npm run electron:dev` click-through or owner eye review of the wired flow itself yet                                                                                                               |

Updated 2026-08-14.
