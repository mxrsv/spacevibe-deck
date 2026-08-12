# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app; no shared DB or API with the SpaceVibe web repos.
> Do not edit sibling repos from this session. Workspace map:
> [`../AGENTS.md`](../AGENTS.md) `current`.

Deck is a terminal for running many agent CLIs side by side. The shipping app is Tauri 2 +
Rust + Preact + xterm.js; an Electron replacement is being built in an isolated worktree.
Everything in this repo — UI strings, comments, docs, and commits — is **English only**.

Project state: [docs/CONTEXT.md](docs/CONTEXT.md) `current`; architecture:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) `current`; visual rules:
[docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md) `current`.

## Current direction

- **Auto-update is a core requirement.** A release is not complete if distribution falls
  back to manual-download-only. Release claims require platform-specific runtime evidence.
- **Tauri is feature-frozen** except hotfixes and release support. New product features land
  on Electron so they are not implemented twice.
- **Electron migration is approved and building** in branch/worktree `electron-migration` at
  `~/Documents/Development/spacevibe-deck-worktrees/`. The owner explicitly allowed MVP work
  before Gate A (Apple signing identity) and Gate C (real Windows hardware) closed; that risk
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
- **Queued after Electron MVP closes:** token usage dashboard and file explorer. The explorer
  spec is [docs/specs/2026-08-12-file-explorer-design.md](docs/specs/2026-08-12-file-explorer-design.md) `decided`;
  no explorer implementation may be folded into MVP. Monaco must first pass Gate M
  in a packaged build. Dirty files must block tab close, window close, and app quit.
- **Chrome gallery is current:** `gallery.html` mounts real components through
  `src/gallery/`; run `npm run prototype:gallery`. Gallery code must never enter the shipping
  bundle. It is the comparison surface for design-token constraint work, not a second UI copy.

Closed release history, updater-fork rationale, measurements and long decision trails belong
in `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, frozen specs/plans, and git — not here.

## Forks

Stop and ask before writing code when a task touches:

- PTY ownership, process classification, window coordinator, tab materialization, layout or
  close/quit coordination;
- bundle, dependency, signing, release channel, updater or version configuration;
- a rule in `docs/DESIGN-LANGUAGE.md`;
- Electron/Tauri cutover scope or a platform claim without matching hardware evidence;
- any sibling repo.

Not a fork: internal renames, tests, styling within current DL rules, and editing the menu
registry. Record a resolved fork in this queue with a one-line reason; move it to
`docs/ARCHITECTURE.md` when the work closes.

## Verification and commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | browser-only Vite preview; IPC operations fail soft |
| `npm run tauri dev` | current native desktop app |
| `npm test` | Vitest suite |
| `npm run build` | TypeScript + shipping renderer bundle |
| `npm run generate:menu` | regenerate menu from registry |
| `npm run generate:menu:check` | prove generated menu is current |
| `npm run prototype:gallery` | visual comparison gallery at `127.0.0.1:5175` |
| `npm run build:landing` | landing production build |
| `npm run video:render` | render marketing video from DOM stage |

Minimum completion gate: `npm test && npm run build && npm run generate:menu:check`.
Changes under `src-tauri/` additionally require the focused Rust tests; release/updater work
requires its dedicated scripts and real target-platform checks. Rendered UI changes require
screenshot/recording approval; automated checks do not establish native visual correctness.

## Layout

```text
src/                  Preact renderer, xterm panes, stores and chrome
src/gallery/          dev-only real-component gallery; never imported by app modules
src-tauri/src/        current Rust host: PTY, windows, process snapshot, updater
scripts/              generators and cross-boundary contract/release checks
marketing/            landing and DOM-driven video stage
docs/                 architecture, context, design language, specs/plans/reviews
```

Electron implementation lives only in its dedicated worktree until its plan says otherwise;
do not install Electron/native dependencies into the primary Tauri checkout.

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
  frontend contract sends flat keys; `scripts/ipc-contract.test.ts` guards this boundary.
- **R7. Gallery imports flow app → gallery only.** Shipping modules must not import
  `src/gallery/` or its stubs.

## Known traps

- The app running an update is the **old build**; updater fixes do not retroactively protect
  the transition into that release.
- Green unit/build checks are not Windows or macOS native evidence. Name untested platform
  behavior as unverified.
- Browser `npm run dev` can paint the shell because IPC failures are caught; it cannot prove
  native persistence, PTY, updater or packaging behavior.
- Marketing video shares application components and a virtual clock; component changes can
  silently alter rendered media.
- Old `FR-`/`ADR-` references are historical after removal of the ADR pipeline. Do not recreate
  `PIPELINE.lock` or `docs/decisions/` merely to satisfy those comments.

## Chưa khớp thực tế

_(Heading retained for the global living-doc convention.)_

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| Electron can replace Tauri on both supported platforms | `building` | unverified | Gate A lacks Apple identity; Gate C lacks a real Windows run |
| Pane detach is complete cross-platform | `building` | partial | Phase A has focused/native macOS evidence; Phase B and Windows pointer capture remain open |
| File explorer is available | `decided` | backlog | Spec approved; implementation waits for Electron MVP and packaged Monaco Gate M |

Updated 2026-08-12.
