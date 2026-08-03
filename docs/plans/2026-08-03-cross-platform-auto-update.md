# Cross-platform auto-update implementation plan

**Spec**: [2026-08-03-cross-platform-auto-update-design.md](../specs/2026-08-03-cross-platform-auto-update-design.md)
**Goal**: Add user-controlled Tauri updates for stable macOS and the unsigned Windows preview channel, with a compact chrome action and fresh PTY safety checks before installation.
**Architecture**: A feature-scoped frontend controller owns the update state machine and adapts Tauri's split `check`/`download`/`install` APIs. `App` injects live pane ownership and renders a small `UpdateAction` beside Settings. Release-only Tauri configuration and the existing tag workflow create signed updater artifacts while keeping Windows in a separate prerelease.

## 1. Expected outcomes

- Startup performs one non-blocking check and hides the feature when current, unsupported, or unavailable — verified by `update-controller.test.ts`.
- A discovered update moves through `Update` → `Downloading…` → `Install & Relaunch`, with retry states and two separate user clicks — verified by `update-action.test.tsx` and controller tests.
- Install reuses fresh process inspection, preserves cancellation, flushes settings, installs, and relaunches — verified by controller tests and existing close-guard tests.
- macOS stable and Windows preview builds use distinct HTTPS manifests and mandatory Tauri signatures — verified by config inspection and release-manifest tests.
- The full repository test/build/Rust gates pass, and the button is rendered for user eye review at both required window sizes.

## 2. Canonical data

**Canonical data**: Tauri's `Update` object is the only source for current version, available version, release notes, verified download bytes, and install lifecycle. The live `TabManager.allPaneIds()` result is the only source for processes protected before installation.

**Taken from**: configured HTTPS GitHub Release manifests, Tauri updater metadata, current window-scoped tab manager state, and existing settings flush/close-guard functions.

**Never taken from**: DOM labels, local storage, unvalidated GitHub API payloads, release-note HTML, cached pane polls, or a frontend-supplied artifact URL.

## 3. Business rules and invariants

- **Automatic check only**: startup may check but never download or install — verified by `start leaves available update undownloaded`.
- **Two user actions**: download and install require separate clicks — verified by `download completion waits in downloaded state`.
- **Single flight**: duplicate check/download/install calls are ignored while the same operation is active — verified by `drops re-entrant operations`.
- **Fresh safety gate**: installation calls `confirmClose` with every current pane id immediately before install — verified by `busy cancellation preserves downloaded update`.
- **Fail closed**: unknown process state, dialog failure, or missing update plugin never initiates installation — verified by controller and close-guard tests.
- **Signed artifacts**: release jobs fail when updater signing variables are empty; no private key enters source, PR jobs, logs, or workflow artifacts — verified by workflow inspection.
- **Channel isolation**: stable macOS assets stay in `vX.Y.Z`; Windows stays in `vX.Y.Z-windows-preview` and a fixed preview manifest channel — verified by manifest validation tests.
- **No downgrade**: default Tauri SemVer comparison remains unchanged — verified by absence of `allowDowngrades` and custom comparators.

## 4. Scope

**Included**:

- Tauri updater/process dependencies, minimal permissions, plugin registration, and release-only artifact config.
- Pure update controller, Tauri adapter, compact chrome action, busy guard integration, tests, CSS, and visual review fixtures.
- Stable macOS plus unsigned Windows preview release workflow and strict manifest validator.
- Living architecture/context updates anchored to implemented source.

**Excluded**:

- Apple Developer signing, notarization, Authenticode, Store/MSIX, Linux, ARM64, Windows 10, downgrade support, or silent install.
- Settings UI, custom modal/progress screen, polling, background download, or release-note HTML.
- Generating the production keypair, creating GitHub Secrets/Variables, pushing a tag, or publishing/moving a release channel in this implementation run.

## 5. Risks and resolved decisions

**Resolved with risk**:

- Windows remains unsigned B2 preview — SmartScreen and `Unknown publisher` remain visible and must be repeated in release copy.
- Existing v0.9.0 cannot bootstrap itself — users manually install the first updater-enabled version once.
- The updater plugin is registered only when a build-time public key exists — local/web development remains usable, but updater runtime proof requires an authorized keypair later.
- The worktree contains unrelated Settings changes — updater work avoids Settings modules and limits overlapping edits in `app.tsx` and `styles.css` to narrow hunks.
- Windows installation exits the process — consent and fresh pane inspection must complete before calling `install()`.

**No unresolved implementation decisions**: production credential creation and external release mutation are explicit later authorization gates, not design gaps.

## 6. Tasks

### Task 1: Lock the pure controller contract with failing tests

**Files**:

- [update-controller.test.ts](../../src/updater/update-controller.test.ts)
- [update-controller.ts](../../src/updater/update-controller.ts)

**Decision**: `createUpdateController(deps)` exposes a readonly signal plus `start`, `download`, and `installAndRelaunch`; the controller stores one pending update object and no persistent data.

**Build**:

- Add failing tests for current/no update, available update without download, separate download/install clicks, busy and unknown cancellation, retryable download/install/relaunch failures, unsupported platform, bounded notes, and re-entrant operations.
- Add a named flush-failure case asserting that a rejected settings flush never
  calls install or relaunch and retains the downloaded update for retry.
- Define narrow `PendingUpdate` and injected dependency interfaces so tests require no Tauri runtime.

**Verify**:

- `npm test -- --run src/updater/update-controller.test.ts` → fails initially because the controller is absent, then passes after Task 2.

---

### Task 2: Implement the controller state machine

**Files**:

- [update-controller.ts](../../src/updater/update-controller.ts)
- [update-controller.test.ts](../../src/updater/update-controller.test.ts)

**Depends on**: Task 1

**Decision**: Phases are `hidden`, `available`, `downloading`, `downloaded`, `download-failed`, `installing`, `install-failed`, and `relaunch-failed`; every transition returns a new frozen view object.

**Build**:

- Implement single-flight check/download/install operations and release-note normalization.
- Preserve the downloaded update after safety cancellation or install failure; a relaunch failure retries only relaunch, never installation.
- Treat settings-flush rejection as `install-failed`, retain the downloaded update,
  and never call install or relaunch until a later retry flushes successfully.
- Log automatic-check failure without surfacing UI; expose user-triggered failures as retry states.

**Verify**:

- `npm test -- --run src/updater/update-controller.test.ts` → all controller cases pass.

---

### Task 3: Lock and build the compact update action

**Files**:

- [update-action.test.tsx](../../src/updater/update-action.test.tsx)
- [update-action.tsx](../../src/updater/update-action.tsx)
- [update-preview.test.ts](../../src/updater/update-preview.test.ts)
- [update-preview.ts](../../src/updater/update-preview.ts)
- [chrome-actions.tsx](../../src/ui/chrome-actions.tsx)

**Depends on**: Task 2

**Decision**: `UpdateAction` renders nothing for hidden/checking/current states and renders one button for all actionable states; `ChromeActions` receives it as an optional child immediately before Settings.

**Build**:

- Write failing component tests for every label, disabled/busy state, accessible
  name, bounded tooltip, click routing, polite live-region output, narrow-label
  markup, and `relaunch-failed` routing directly to relaunch.
- Add a validated dev-only preview resolver for the four visual states and both
  tab-bar layouts; it returns `null` when `import.meta.env.DEV` is false and
  rejects every unknown query value.
- Implement the component and add an optional `updateAction` slot to `ChromeActions` without importing updater types into chrome.

**Verify**:

- `npm test -- --run src/updater/update-action.test.tsx src/updater/update-preview.test.ts` → red before component implementation, green afterward.
- Existing `ChromeActions` consumers compile unchanged when the slot is omitted.

---

### Task 4: Apply the approved button treatment

**Files**:

- [styles.css](../../src/styles.css)

**Depends on**: Task 3

**Decision**: Use the spec's 24px theme-bound button, existing focus ring, restrained color transitions, no shadow/loop, and compact `Relaunch` label at minimum width.

**Build**:

- Add feature-specific styles beside `.iconbtn` rules; do not alter Settings styles or design-language tokens.
- Cover hover, focus-visible, disabled/downloading, retry/error, reduced-motion, and `480px` responsive behavior.

**Verify**:

- `npm run build` → CSS and component compile.
- Screenshots in Task 10 show the full and compact labels without toolbar overflow.

---

### Task 5: Add Tauri adapters and least-privilege plugins

**Files**:

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)
- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [lib.rs](../../src-tauri/src/lib.rs)
- [default.json](../../src-tauri/capabilities/default.json)
- [tauri-updater-adapter.ts](../../src/updater/tauri-updater-adapter.ts)

**Depends on**: Task 2

**Decision**: Use separate Tauri `check`, `download`, and `install` APIs; grant only `updater:allow-check`, `updater:allow-download`, `updater:allow-install`, and `process:allow-restart`.

**Build**:

- Install compatible v2 updater/process JS and Rust dependencies with npm/Cargo lockfile updates.
- Register process always; register updater in `setup` only when `DECK_UPDATER_PUBLIC_KEY` was present at compile time, overriding the empty config key.
- Adapt Tauri metadata and resource methods to `PendingUpdate`; never accept a caller-provided URL or downgrade option.

**Verify**:

- `npm run build` → adapter types compile.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` → plugin registration compiles on the current platform.
- Permission inspection shows no `updater:default` or `process:default` broad grant.

---

### Task 6: Integrate live pane safety and application state

**Files**:

- [app.tsx](../../src/ui/app.tsx)
- [close-guard.ts](../../src/terminal/close-guard.ts)
- [close-guard.test.ts](../../src/terminal/close-guard.test.ts)
- [app.test.tsx](../../src/ui/app.test.tsx)

**Depends on**: Tasks 2, 3, and 5

**Decision**: `App` creates one controller, starts it after the tab manager exists, supplies `allPaneIds`, `confirmClose` with `UPDATE_COPY`, settings flush, and relaunch, then passes `UpdateAction` into `ChromeActions`.

**Build**:

- Add failing `UPDATE_COPY` tests before production copy.
- Inspect the existing scoped diffs for `app.tsx`, `app.test.tsx`, and
  `styles.css` before editing; integrate through narrow hunks and preserve every
  unrelated Settings assertion and treatment already present.
- In development only, use the validated preview resolver to substitute the
  requested update view/layout without registering a Tauri updater or changing
  persisted settings; production builds always ignore the query seam.
- Dispose no PTY and call no quit command during check or download; installation owns the only exit/relaunch path.

**Verify**:

- `npm test -- --run src/terminal/close-guard.test.ts src/ui/app.test.tsx src/updater/update-controller.test.ts src/updater/update-action.test.tsx` → all focused integration tests pass.

---

### Task 7: Configure release-only updater artifacts and platform endpoints

**Files**:

- [tauri.conf.json](../../src-tauri/tauri.conf.json)
- [tauri.macos.conf.json](../../src-tauri/tauri.macos.conf.json)
- [tauri.windows.conf.json](../../src-tauri/tauri.windows.conf.json)
- [tauri.release.conf.json](../../src-tauri/tauri.release.conf.json)

**Depends on**: Task 5

**Decision**: Base config holds an empty updater public-key field; release builds override it through the compile-time public-key variable. Platform configs own stable macOS versus fixed Windows preview HTTPS endpoints; only release config enables updater artifacts.

**Build**:

- Add production HTTPS endpoint config and Windows passive NSIS install mode without insecure transport or downgrade flags.
- Add the release-only config and reference it from the release workflow so ordinary local bundle work does not require signing secrets.

**Verify**:

- `npm run tauri build -- --no-bundle --ci` → compiles without updater credentials and without producing bundles.
- Config inspection finds `createUpdaterArtifacts` only in `tauri.release.conf.json` and distinct platform endpoints.

---

### Task 8: Validate updater manifests with TDD

**Files**:

- [verify-updater-manifest.test.mjs](../../scripts/verify-updater-manifest.test.mjs)
- [verify-updater-manifest.mjs](../../scripts/verify-updater-manifest.mjs)
- [package.json](../../package.json)

**Decision**: The validator accepts only the expected repository, HTTPS asset
URLs, exact SemVer, allowed macOS/Windows targets, non-empty inline signatures,
and NSIS-only Windows assets. Source provenance is not inferred from
`latest.json`: a separately generated JSON sidecar records the event SHA,
release tag, and SHA-256 digests, while captured GitHub Release API metadata
proves that every manifest URL names an asset on the expected draft whose
`target_commitish` is the event SHA.

**Build**:

- Write red Node tests for valid manifest/release-metadata/provenance fixtures and
  every rejected field, target commit, asset association, and digest before
  implementation.
- Implement immutable parsing/validation and a CLI used by release jobs.
- Add `scripts/verify-updater-manifest.test.mjs` as a second exact Vitest
  exclusion and add `test:updater-manifest` for its Node test runner.

**Verify**:

- `npm run test:updater-manifest` → red first, then all Node cases pass.
- `npm test` → Vitest excludes both Node-runner manifest/bundle tests and keeps
  the 901-test baseline plus new Vitest tests green.

---

### Task 9: Expand the existing tagged release workflow

**Files**:

- [release.yml](../../.github/workflows/release.yml)

**Depends on**: Tasks 7 and 8

**Decision**: A stable `vX.Y.Z` source tag creates the macOS stable release and a separate `vX.Y.Z-windows-preview` prerelease; validated Windows `latest.json` is copied to a fixed `windows-preview-channel` prerelease asset.

**Build**:

- Define an explicit release DAG:
  `validate-source` → parallel `build-macos-stable-draft` and
  `build-windows-preview-draft` → `validate-windows-preview` →
  `publish-windows-preview` → `promote-windows-channel`. The macOS draft has its
  own `publish-macos-stable` successor and never depends on Windows publication.
- `validate-source` runs on `ubuntu-latest`, checks out the event SHA, rejects
  non-`vX.Y.Z` source tags and `-windows-preview` recursion, and checks
  package/Cargo/Tauri version equality. It uses `actions/setup-node@v4` with
  Node 22, `dtolnay/rust-toolchain@stable` with `rustfmt`, the same apt Tauri
  packages as `.github/workflows/ci.yml`, and `npm ci`; then runs `npm test`,
  `npm run build`, `npm run test:updater-manifest`,
  `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and
  `cargo test --locked --manifest-path src-tauri/Cargo.toml`.
- Add fail-fast checks for `TAURI_SIGNING_PRIVATE_KEY` and
  `DECK_UPDATER_PUBLIC_KEY`; optional password handling never prints values.
- `build-macos-stable-draft` runs on `macos-latest`; it installs both
  `aarch64-apple-darwin` and `x86_64-apple-darwin`, checks out the same
  `${{ github.sha }}`, runs `npm ci`, and invokes Tauri with
  `--target universal-apple-darwin`. `build-windows-preview-draft` runs on
  `windows-latest` with Node 22, stable Rust, `rustfmt`, and `npm ci`.
- Each build uses `tauri.release.conf.json`, passes
  `releaseCommitish: ${{ github.sha }}`, creates a draft release, and uploads a
  workflow artifact named with `${{ github.sha }}` containing `latest.json`,
  updater bundle, `.sig`, normal installer, captured GitHub Release API JSON,
  and a generated provenance sidecar. The sidecar contains the exact event SHA,
  expected tag, and SHA-256 digest of every carried file; it is generated only
  after all build outputs exist.
- The Windows build also runs tests/Rust gates on `windows-latest`, compiles the
  desktop, verifies exactly one NSIS and zero MSI, and uses
  `updaterJsonPreferNsis: true`.
- `validate-windows-preview` downloads only the exact-SHA artifact, checks
  non-empty bundle/signature files, verifies every sidecar digest, and runs the
  manifest validator with exact version, repository, and target. It also checks
  the captured API object's `tag_name`, `draft`, `prerelease`, and
  `target_commitish`, then requires each manifest URL to equal the immutable API
  `url` of an asset in that exact draft; no source-SHA or tag
  claim is expected inside the Tauri-generated manifest.
- Only `publish-windows-preview` may flip the validated draft to public; only
  `promote-windows-channel` may create/update the fixed manifest asset, and it
  receives the already-validated exact-SHA manifest artifact rather than
  downloading mutable release state again.
- Keep explicit unsigned/SmartScreen warnings in Windows release and channel copy; ignore generated preview tags to prevent recursive workflows.

**Verify**:

- Workflow inspection shows every mutation job has the exact `needs` chain above
  and Windows assets never enter the stable macOS release.
- `npm run generate:menu:check`, `npm run test:updater-manifest`, and
  `ruby -e 'require "yaml"; YAML.safe_load(File.read(".github/workflows/release.yml"), aliases: true)'`
  pass locally; Ruby/Psych is the declared parser prerequisite for this
  repository-only syntax check. No workflow is dispatched and no release is
  mutated.

---

### Task 10: Run visual and repository verification

**Files**:

- [chrome-actions.tsx](../../src/ui/chrome-actions.tsx)
- [update-action.tsx](../../src/updater/update-action.tsx)
- [update-preview.ts](../../src/updater/update-preview.ts)
- [styles.css](../../src/styles.css)
- [capture-updater-preview.mjs](../../scripts/capture-updater-preview.mjs)
- [package.json](../../package.json)

**Depends on**: Tasks 3–9

**Decision**: Visual completion requires rendered evidence and user eye approval; build success alone is insufficient.

**Build**:

- Add a repeatable `preview:updater` script that uses `playwright-core` against a
  caller-supplied local Vite URL, visits only the validated dev query seam, and
  writes all screenshots under `/tmp/spacevibe-deck-updater-preview/`.
- Run `npm run dev -- --host 127.0.0.1 --port 4178 --strictPort`, then
  `npm run preview:updater -- --base-url http://127.0.0.1:4178` to render
  available, downloading, downloaded, and retry states in the real toolbar at
  `1100x720` and `480x320`, top-tab and sidebar layouts.
- Inspect label hierarchy, toolbar overflow, focus visibility, theme colors, reduced motion, and unchanged Settings surface.

**Verify**:

- `npm test` → all Vitest tests pass.
- `npm run build` → TypeScript and Vite production build pass.
- `npm run generate:menu:check` → generated menu is current.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → Rust formatting passes.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` → Rust tests pass.
- `git diff --check` → no whitespace errors.
- User eye-approves the rendered screenshots before UI completion is claimed.

---

### Task 11: Update living documentation without publishing

**Files**:

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [CONTEXT.md](../CONTEXT.md)
- [AGENTS.md](../../AGENTS.md)
- [README.md](../../README.md)

**Depends on**: Task 10

**Decision**: Record implemented source behavior as `current`; keep credential creation, first signed updater artifacts, real Windows update runtime, and release publication as pending gates.

**Build**:

- Add relative source anchors for updater ownership, consent flow, release channels, and security boundary.
- Update README's Windows download/install section, first-manual-bootstrap rule,
  SmartScreen warning, separate preview channel, and user-controlled update flow.
- Preserve unrelated Settings content in dirty living docs and the current
  scoped diffs of `app.tsx`, `app.test.tsx`, `styles.css`, `CONTEXT.md`, and
  `DESIGN-LANGUAGE.md`; keep the in-flight decision queued until external
  release/runtime gates close.

**Verify**:

- Living docs retain `Chưa khớp thực tế`, use intent labels, and contain no claim that unrun release/runtime gates passed.
- `git diff --check -- docs/ARCHITECTURE.md docs/CONTEXT.md AGENTS.md` → no whitespace errors.
- Scoped final diffs show no pre-existing Settings hunk was removed or rewritten
  by updater work.
