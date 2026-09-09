# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app; no shared DB or API with the SpaceVibe web repos.
> Do not edit sibling repos from this session. Workspace map: [`../AGENTS.md`](../AGENTS.md).

Deck is a terminal for running many agent CLIs side by side. `main` carries **two hosts**: the
Tauri 2 + Rust host, feature-frozen and built only by hand, and the Electron host in
`electron/` that has replaced it on every tag. The renderer is Preact + xterm.js and reaches
whichever host it runs under through the facades in `src/host/`. Everything in this repo — UI
strings, comments, docs, and commits — is **English only**.

Read [docs/internals/overview.md](docs/internals/overview.md) before your first change. The
documentation index is [docs/README.md](docs/README.md).

## Current direction

- **Auto-update is a core requirement.** A release is not complete if distribution falls back
  to manual download. Release claims need platform-specific runtime evidence; see
  [operations/release.md](docs/operations/release.md).
- **Tauri is feature-frozen.** New product features land on Electron so they are not
  implemented twice. A renderer change reaches both hosts; a change needing a new host command
  is Electron-only and degrades on Tauri through an `available` flag, never a second
  implementation. Say which host a change runs on rather than implying both.
- **Windows has no owner-verified native pass.** It ships unsigned by decision. Green unit and
  build checks are not evidence there.
- **Analytics is mandatory** — always on, no opt-out, and the disclosure stays. The contract is
  [internals/telemetry.md](docs/internals/telemetry.md); the receiving service is
  [backend/](backend/README.md).
- **The Electron cutover is a clean install**, with no settings or workspace migration.

Where the current behaviour of a surface is written down:

| Surface                                                | Page                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Process model, IPC bridge, persistence, R4 seams        | [internals/overview.md](docs/internals/overview.md)               |
| PTYs, panes, tabs, materialization, launch, phase, menu | [internals/terminal.md](docs/internals/terminal.md)               |
| The rail, checkout cards, tails, close and order        | [internals/agent-rail.md](docs/internals/agent-rail.md)           |
| The Agent Board                                         | [internals/agent-board.md](docs/internals/agent-board.md)         |
| Explorer, editor, markdown, browser tab, path opening   | [internals/file-surface.md](docs/internals/file-surface.md)       |
| The journal, boot restore, resume resolution            | [internals/session-restore.md](docs/internals/session-restore.md) |
| Usage analytics                                         | [internals/telemetry.md](docs/internals/telemetry.md)             |
| Traps, live switches, accepted limitations              | [internals/traps.md](docs/internals/traps.md)                     |
| Vocabulary this repo uses precisely                     | [internals/glossary.md](docs/internals/glossary.md)               |
| Visual rules, cited from code and read by a test        | [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md)                |

Closed decisions, measurements and long rationale live in git history and in the issue that
owned the work — not in this file.

## Forks

Stop and ask before writing code when a task touches:

- PTY ownership, process classification, the window coordinator, tab materialization, layout
  or close/quit coordination, on either host;
- bundle, dependency, signing, release channel, updater or version configuration;
- a rule in [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md);
- Electron/Tauri cutover scope, or a platform claim with no matching hardware evidence;
- any sibling repo.

Not a fork: internal renames, tests, styling within current DL rules, and editing the menu
registry. Record a resolved fork on the issue that owns the work, with the alternative you
turned down and why — a fork nobody can reconstruct is a decision that will be re-litigated.

## Verification and commands

| Command                       | Purpose                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | browser-only Vite preview; IPC operations fail soft                                                                                                                     |
| `npm run tauri dev`           | the Tauri host                                                                                                                                                          |
| `npm run electron:dev`        | the Electron host, built and launched from `dist-electron/`                                                                                                             |
| `npm run electron:dev:watch`  | same host with hot reload: renderer on the Vite dev server, main rebuilds and relaunches on save via [`scripts/electron-dev-watch.mjs`](scripts/electron-dev-watch.mjs) |
| `npm run electron:build`      | typecheck and bundle the Electron main process                                                                                                                          |
| `npm run electron:package`    | package the Electron host as a local **unsigned** `Deck Electron.app` (arm64, `dir` target, no installer/updater/publish) into `dist-electron-app/`                     |
| `npm run electron:smoke`      | headed smoke test; needs a display server and a real PTY                                                                                                                |
| `npm test`                    | Vitest suite                                                                                                                                                            |
| `npm run build`               | TypeScript + shipping renderer bundle                                                                                                                                   |
| `npm run generate:menu`       | regenerate menu from registry                                                                                                                                           |
| `npm run generate:menu:check` | prove generated menu is current                                                                                                                                         |
| `npm run lint`                | oxlint + prettier check; max-lines stays a warning (101 pre-existing over-length files are backlog)                                                                     |
| `npm run prototype:gallery`   | visual comparison gallery at `127.0.0.1:5175`                                                                                                                           |
| `npm run build:landing`       | landing production build                                                                                                                                                |
| `npm run video:render`        | render marketing video from DOM stage                                                                                                                                   |

Standing rule in this repo: gates run only when asked. A change reported without them says so.

## Layout

Both hosts are installed in this checkout, so Electron and its native dependencies belong
here. Adding a feature to one host without the other leaves a parity gap.

## Repo rules

- **R1. English only** for strings, comments, docs and commit messages.
- **R2. Design language is executable policy.** Chrome styling follows numbered DL rules; code
  comments cite them. Fixing a violation also updates the ledger in that document.
- **R3. Menu output is generated.** Edit the registry, then run `generate:menu`; never edit
  generated menu code manually.
- **R4. Load-bearing seams stay explicit.** PTY/window/tab/layout/close modules require a plan
  and cross-boundary verification, not a drive-by refactor.
- **R5. Renderer state uses Preact signals; module stores are window-scoped.**
- **R6. IPC payload shape is a contract.** Keep flat command arguments where the frozen
  frontend contract sends flat keys; `scripts/electron-ipc-contract.test.ts` guards this
  boundary in `npm test`.
- **R7. Gallery imports flow app → gallery only.** Shipping modules must not import
  `src/gallery/` or its stubs.

## Known traps

The full list, with the live switches and the limitations that were looked at and accepted, is
[internals/traps.md](docs/internals/traps.md). The four that catch people first:

- The app running an update is the **old build**; an updater fix cannot protect the transition
  into the release that carries it.
- **Browser `npm run dev` paints the shell** because IPC failures are caught. It proves nothing
  about persistence, PTY, the updater or packaging.
- **`src/styles.css` has no global `box-sizing` reset**, so a percentage size beside a padding
  overflows its box. Form controls get `border-box` from the user agent; a plain element does
  not. Two shipped defects came from exactly this in one day.
- **A one-pixel overflow moves the whole window.** `#root` is `overflow: clip`, not `hidden`,
  because `hidden` still builds a scroll container. Treat "the top bar looks misaligned" as a
  scroll report, not a layout one.

Old `FR-` and `ADR-` references are historical. Do not recreate `PIPELINE.lock` or
`docs/decisions/` merely to satisfy those comments.

## Documentation

Most code changes need no documentation change; agents and maintainers can read the code. The
index is [docs/README.md](docs/README.md).

- `docs/internals/` holds architectural decisions and their reasons, constraints that span
  modules, and traps hard to discover from the source. Before adding a paragraph, ask what a
  maintainer would get wrong without it. It is the one place in the repository that still
  takes new documentation.
- `docs/user/` helps users accomplish tasks, in the voice of the shipped product, with no
  implementation detail and no contributor tooling. A UI tweak needs no entry.
- `docs/operations/` is the maintainer runbook: setup, release, debugging. Every page under
  `internals/` and `operations/` opens with the "For maintainers" callout.
- Do not write file catalogs, field or method enumerations, control-flow narration, or
  appended PR summaries. When a documented decision changes, rewrite or remove the text; never
  append a second account. Keep a local explanation in a code comment; use an internal page
  only when the reasoning crosses boundaries.
- **Plans, specs, research notes and review reports are not committed.** A merged PR is the
  implementation record, and active work lives in the issue that owns it.
- `docs/DESIGN-LANGUAGE.md` stays at its path and keeps its numbering: a test reads it, and
  code comments cite its rules. `CHANGELOG.md` is read by the release workflow.
