# Development

> For maintainers. Using Deck? See [docs/user/](../user/).

How to build, run, test and check the repository. Architecture is in
[`../internals/`](../internals/overview.md); cutting a release is in [release.md](release.md).

## Prerequisites

Node.js 22 (what CI runs) and the native toolchain `node-pty` needs on your platform.
`npm ci` runs a postinstall that restores the executable bit on node-pty's spawn helpers,
whose only symptom when lost is `posix_spawnp failed`.

## Commands

| Command                              | What it does                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run electron:dev`               | Renderer HMR and incremental main/preload compilation through the [development watcher](../../scripts/electron-dev-watch.mjs) |
| `npm run electron:dev:watch`         | Alias for `electron:dev`                                                                                     |
| `npm run electron:dev:once`          | Build the renderer and main process, then launch once from `dist-electron/`                                   |
| `npm run dev`                        | Browser-only Vite preview of the renderer; every IPC call fails soft                                            |
| `npm test`                           | The Vitest suite                                                                                               |
| `npm run build`                      | `tsc` over `src/` plus the shipping renderer bundle                                                            |
| `npm run electron:build`             | `tsc -p tsconfig.electron.json` plus the CommonJS rename pass; this is the whole typecheck of `electron/`       |
| `npm run lint`                       | oxlint, then `prettier --check`                                                                                |
| `npm run electron:package`           | Local unsigned `Deck Electron.app` (arm64, `dir` target) in `dist-electron-app/`                               |
| `npm run electron:package:release`   | The shipping config: signing preflight, signed and notarized, published nowhere                                 |
| `npm run electron:package:monaco-smoke` | The packaged Monaco regression smoke (universal, unsigned)                                                  |
| `npm run electron:verify:monaco-smoke` | Verify that package's structure and drive it over CDP                                                        |
| `npm run electron:smoke`             | Headed smoke of the real bridge; needs a display and a real PTY                                                |
| `npm run shoot`                      | Screenshot the running app through `webContents.capturePage`                                                   |
| `npm run prototype:gallery`          | The chrome gallery at `127.0.0.1:5175`, mounting real components through `src/gallery/`                        |
| `npm run refresh:pricing`            | Rewrite the usage pricing snapshot from LiteLLM. By hand only, never from a build                              |
| `npm run build:landing`              | The landing production build                                                                                   |
| `npm run video:render`               | Render the marketing video from the DOM stage                                                                  |

The [Electron dev compiler](../../scripts/electron-dev-build.mjs) follows imports from main
and both preloads, including shared `src/` dependencies. It keeps output in
`dist-electron/dev/`; failed builds keep the previous app running. Renderer-only changes
stay with Vite. Main/preload or vendored browser-asset changes restart Electron, interrupting
live terminal sessions and unsaved editor buffers. The [watcher](../../scripts/electron-dev-watch.mjs)
waits for the old process to exit before launching again, and owns Vite until shutdown.
Renderer refresh does not guarantee preservation of terminal or editor state when a
component is remounted; use disposable sessions for development.

## CI

Each workflow runs on push to `main`, on pull requests and by hand, only for the paths it
owns; a newer push cancels an older run of the same workflow on the same ref. A change that
touches only `docs/**` or `*.md` runs nothing.

- [`ci.yml`](../../.github/workflows/ci.yml) `check` (ubuntu): `lint`, `test`, `build`,
  `electron:build`; plus `backend-check` for the ingest Worker. Skipped when
  only `marketing/**` changed.
- [`landing.yml`](../../.github/workflows/landing.yml) (ubuntu): the landing's Vitest files
  and `build:landing`, when `marketing/**` changes.
- [`pr-shots.yml`](../../.github/workflows/pr-shots.yml) (ubuntu, pull requests touching the
  app): builds, runs `electron/shoot.ts` under Xvfb, pushes the PNGs to the `pr-assets` branch
  and keeps one comment on the PR linking them. Fork PRs get the artifact only. By hand on a
  branch, with an optional PR number to comment on.
- By hand only, in `ci.yml`: `windows-check` — `npm test` on Windows, which spawns a real
  ConPTY through `electron/pty/windows-pty.test.ts`, plus `build` and `electron:build`; run
  it before a Windows release. It still carries the pre-existing failures in
  [traps](../internals/traps.md). `windows-electron-package` builds the unsigned Electron
  Windows preview and keeps it for 7 days.

Lint is oxlint with `correctness` as errors and `max-lines` at 300 as a warning, so the
over-length files that predate the rule stay a visible backlog without failing the build.
Prettier ignores every `*.md`, `electron/vendor/**`, `marketing/**`, test fixtures and the
generated pricing snapshot. `marketing/**` is also outside oxlint's scope, so no lint signal
covers that tree.

## Tests

Vitest with the `node` environment by default; component tests opt into jsdom with an
`@vitest-environment jsdom` pragma. `npm test` excludes only `backend/`, whose `node:test`
suite runs in CI's `backend-check`.

Tests that guard a repository rule rather than a module:

- [`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts):
  every payload key a main handler destructures is one the renderer sends, and every channel
  the renderer invokes has a handler. Both sides are typed separately, so a key mismatch is
  green everywhere else and fails only in the running app.
- [`scripts/design-language.test.ts`](../../scripts/design-language.test.ts): parses
  `src/styles.css` through its `@import` index and reads
  [`docs/DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) at test time; every `DL-x.y` cited in
  `src/`, `electron/` or `scripts/` must resolve to a declared rule. **Moving or renaming
  that document breaks `npm test`.**
- [`scripts/electron-release-config.test.ts`](../../scripts/electron-release-config.test.ts):
  locks the lines of `electron-builder.release.yml` and `electron-release.yml` whose loss
  fails silently (the zip target, hardened runtime, the entitlements file, the secret name
  mapping, the direct `needs` on `prepare`).
- [`scripts/gallery-entry.test.ts`](../../scripts/gallery-entry.test.ts): no shipping module
  imports `src/gallery/`.
- [`scripts/icon-system.test.ts`](../../scripts/icon-system.test.ts): no hand-drawn SVG
  outside the icon primitive.
- [`electron/usage/parity.test.ts`](../../electron/usage/parity.test.ts): the Electron usage
  scanner, summed over repositories, reproduces a golden snapshot produced by the Rust scanner
  of the removed Tauri host (in git history). The fixture is frozen: never regenerate it from
  this scanner's own output, which would turn the gate into a tautology.

## What a green run proves

Suite and build evidence is renderer and main-process evidence. It says nothing about:

- native behaviour in a running host (PTY, menu accelerators, window close, updater), which
  needs `npm run electron:dev` or a packaged build on the platform;
- Windows, where no owner has run a real-hardware pass.

Name the class of evidence a change has when describing it.

## Generated and vendored files

- The menu is not generated: [`electron/menu.ts`](../../electron/menu.ts) imports
  [`src/terminal/action-registry.ts`](../../src/terminal/action-registry.ts) at runtime.
- `src/lib/usage-pricing-snapshot.ts` is generated by `refresh:pricing`.
- `electron/vendor/react-grab/` is vendored; its `SOURCE.md` records the version and hash,
  and a test pins the same SHA-256.

## Marketing

`marketing/` ships nothing into the app. `stage/` is the shared app-window mock the landing
hero, the tour and the video all draw from; `landing-prototype/` is the site Vercel builds
(`vercel.json` builds only that tree); `video/` renders the film from the DOM through a
virtual clock. Component changes under `src/` can change rendered media, because the stage
shares application components.
