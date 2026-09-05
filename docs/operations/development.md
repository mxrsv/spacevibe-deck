# Development

How to build, run, test and check the repository. Architecture is in
[`../internals/`](../internals/overview.md); cutting a release is in [release.md](release.md).

## Prerequisites

Node.js 22 (what CI runs) and the native toolchain `node-pty` needs on your platform. The
Rust toolchain is required only to build the frozen Tauri host or to run its tests.
`npm ci` runs a postinstall that restores the executable bit on node-pty's spawn helpers,
whose only symptom when lost is `posix_spawnp failed`.

## Commands

| Command                              | What it does                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run electron:dev`               | Build the renderer and the main process, then launch Electron from `dist-electron/`                            |
| `npm run electron:dev:watch`         | Same host with hot reload: the renderer loads the Vite dev server, main rebuilds and relaunches on save         |
| `npm run dev`                        | Browser-only Vite preview of the renderer; every IPC call fails soft                                            |
| `npm run tauri dev`                  | The frozen Tauri host                                                                                          |
| `npm test`                           | The Vitest suite                                                                                               |
| `npm run build`                      | `tsc` over `src/` plus the shipping renderer bundle                                                            |
| `npm run electron:build`             | `tsc -p tsconfig.electron.json` plus the CommonJS rename pass; this is the whole typecheck of `electron/`       |
| `npm run lint`                       | oxlint, then `prettier --check`                                                                                |
| `npm run generate:menu`              | Regenerate `src-tauri/src/menu_registry.rs` from the action registry                                           |
| `npm run generate:menu:check`        | Fail if the generated file is stale                                                                            |
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

`predev` and `prebuild` run `generate:menu`, so a plain `npm run build` always regenerates
the Rust registry first.

## CI

[`ci.yml`](../../.github/workflows/ci.yml) runs on every push to `main`, every pull request,
and by hand.

- `check` (ubuntu): `generate:menu:check`, `lint`, `test`, `build`, `electron:build`,
  `cargo fmt --check`, `cargo test`.
- `windows-check` (windows): the same without lint, plus the Windows bundle validator's own
  test and `tauri build --no-bundle`. `npm test` there spawns a real ConPTY through
  `electron/pty/windows-pty.test.ts`.
- Two `workflow_dispatch`-only packaging jobs: a Tauri Windows engineering bundle that
  refuses to run in a public repository, and the unsigned Electron Windows preview, kept as
  7-day artifacts.

Lint is oxlint with `correctness` as errors and `max-lines` at 300 as a warning, so the
over-length files that predate the rule stay a visible backlog without failing the build.
Prettier ignores every `*.md`, `electron/vendor/**`, `marketing/**`, test fixtures and the
generated pricing snapshot. `marketing/**` is also outside oxlint's scope, so no lint signal
covers that tree.

## Tests

Vitest with the `node` environment by default; component tests opt into jsdom with an
`@vitest-environment jsdom` pragma. `npm test` excludes two `node:test` suites (run with
`npm run test:updater-manifest` and in CI directly) and the superseded Tauri IPC contract
test, which stays untouched until `src-tauri/` goes.

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
  scanner reproduces a golden snapshot produced by the Rust scanner. Regenerate the fixture
  from the Rust side, never from this port's own output.

## What a green run proves

Suite and build evidence is renderer and main-process evidence. It says nothing about:

- native behaviour in a running host (PTY, menu accelerators, window close, updater), which
  needs `npm run electron:dev` or a packaged build on the platform;
- Windows, where no owner has run a real-hardware pass;
- the Tauri host, which shares the renderer but has its own commands and is run by nobody.

Name the class of evidence a change has when describing it.

## Generated and vendored files

- `src-tauri/src/menu_registry.rs` is generated. Edit
  [`src/terminal/action-registry.ts`](../../src/terminal/action-registry.ts) and run
  `generate:menu`. The Electron menu needs no generated file: main imports the registry.
- `src/lib/usage-pricing-snapshot.ts` is generated by `refresh:pricing`.
- `electron/vendor/react-grab/` is vendored; its `SOURCE.md` records the version and hash,
  and a test pins the same SHA-256.

## Marketing

`marketing/` ships nothing into the app. `stage/` is the shared app-window mock the landing
hero, the tour and the video all draw from; `landing-prototype/` is the site Vercel builds
(`vercel.json` builds only that tree); `video/` renders the film from the DOM through a
virtual clock. Component changes under `src/` can change rendered media, because the stage
shares application components.
