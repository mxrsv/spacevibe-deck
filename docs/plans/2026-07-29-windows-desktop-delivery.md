# Windows desktop engineering preview delivery plan

**Spec**: [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
**Implementation plan**: [2026-07-29-windows-desktop.md](2026-07-29-windows-desktop.md)
**Goal**: Complete the Windows engineering preview with platform-correct copy, native chrome, NSIS validation, an early Windows CI gate, a private unsigned artifact, living documentation, and explicit real-device gates.
**Architecture**: This plan consumes the runtime and input contracts defined by Tasks 1–27 plus Tasks 1A and 4A of the implementation plan. Platform configuration owns system chrome and bundling; the early non-publishing `windows-check` job is extended to retain a private engineering artifact without changing the existing macOS release workflow. Real Windows evidence remains separate from macOS-local verification, and a shared public release remains blocked on signing, acceptance, and separate authorization.

## 1. Expected outcomes

- every visible shortcut hint reflects the initialized platform.
- Windows uses native decorated chrome and correct in-app spacing at both required viewport sizes.
- the Windows bundle contains one NSIS setup executable and no MSI.
- the early Windows CI lane runs frontend and Rust checks without elevation after each authorized Windows slice.
- the unsigned Windows setup is retained only as a private GitHub Actions artifact; it is not attached to a GitHub Release.
- the existing public macOS release workflow remains unchanged by the engineering preview.
- README and living docs describe only proven engineering-preview behavior.
- beta approval remains blocked until Gates W1–W4 and the real-device acceptance checklist have evidence.

## 2. Sources of truth

**Canonical data**: platform keymaps format shortcut copy; platform-specific Tauri configuration controls window/bundle behavior; the private GitHub Actions artifact records engineering output; the dated spec determines runtime acceptance and public-release eligibility.

**Read from**: the initialized desktop-environment contract, `MACOS_KEYMAP`, `WINDOWS_KEYMAP`, Tauri platform config merges, private workflow artifact paths, and dated Windows test evidence.

**Do not read from**: user-agent strings, hardcoded Cmd/Ctrl copy, MSI defaults, unpublished local bundle assumptions, or inferred Windows results from macOS tests.

## 3. Business rules and invariants

- **Native controls**: Preact never implements Windows minimize, maximize, close, Snap, resize, or title-bar accessibility.
- **Artifact cardinality**: Windows validation requires one `*-setup.exe` and zero MSI files.
- **Release completeness**: no Windows asset reaches the shared public GitHub Release until signing, Gates W1–W4, the full real-device checklist, and a separate publish authorization all pass.
- **Unsigned boundary**: unsigned Windows artifacts remain private GitHub Actions artifacts with bounded retention and SmartScreen copy; they never enter the existing public macOS release workflow.
- **Evidence boundary**: CI can prove an engineering artifact; only Windows 11 runtime evidence can approve beta behavior.
- **Living-doc honesty**: every behavior claim has a relative anchor/intent label and every unpassed gate appears in the drift ledger.

## 4. Scope

**Included**:

- remaining shortcut copy.
- native Windows chrome and platform-specific Tauri configuration.
- NSIS artifact validator, final Windows CI hardening, and private artifact staging.
- README/architecture/context updates.
- local regression verification and the real-Windows evidence checklist.

**Excluded**:

- Store/MSIX, Windows 10, ARM64, alternate shells, auto-update, custom title bars, and public unsigned release.
- pushing, manually dispatching workflows, tagging, publishing, signing, or deploying without separate authorization.
- claiming real-device completion from source/build checks.

## 5. Risks and gates

- macOS can verify source, pure tests, macOS regressions, and local config shape, but not ConPTY, WMI permissions, Job Object behavior, WebView2, IME, SmartScreen, or native Windows visuals.
- remote `windows-check` evidence exists only after the user separately authorizes the required branch/worktree, commit, push/PR, and any manual workflow dispatch; without that authority, the gate stays pending.
- Gates W1–W4 from the spec remain mandatory; any failure returns the design to review.
- visual approval requires real Windows screenshots at `1100x720` and `480x320`, in top-tab and sidebar modes.

## 6. Tasks

### Task 28: Replace remaining user-visible hardcoded macOS labels

**Files**:

- [tab-bar.tsx](../../src/ui/tab-bar.tsx)
- [tab-bar.test.tsx](../../src/ui/tab-bar.test.tsx)
- [workspace-sidebar.tsx](../../src/ui/workspace-sidebar.tsx)
- [workspace-sidebar.test.tsx](../../src/ui/workspace-sidebar.test.tsx)
- [status-bar.tsx](../../src/ui/status-bar.tsx)
- [status-bar.test.tsx](../../src/ui/status-bar.test.tsx)

**Depends on**: Implementation Task 27

**Decision**: tab/sidebar/status hints display active-platform chords without changing action behavior.

**Build**:

- update New Tab tooltips and status hints.
- retain existing accessible labels and layout.

**Verify**:

- `npm test -- src/ui/tab-bar.test.tsx src/ui/workspace-sidebar.test.tsx src/ui/status-bar.test.tsx` → the Windows-label Red cases fail before production edits, then macOS and Windows tooltip/status cases pass.
- `rg -n "⌘|Cmd\\+" src/ui/tab-bar.tsx src/ui/workspace-sidebar.tsx src/ui/status-bar.tsx` → no hardcoded shortcut remains.

---

### Task 29: Update board and Settings shortcut copy

**Files**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [open-board.test.tsx](../../src/open-board/open-board.test.tsx)
- [editor-row.tsx](../../src/ui/controls/editor-row.tsx)
- [editor-row.test.tsx](../../src/ui/controls/editor-row.test.tsx)
- [settings-schema.ts](../../src/settings/settings-schema.ts)
- [settings-schema.test.ts](../../src/settings/settings-schema.test.ts)

**Depends on**: Implementation Tasks 22 and 27

**Decision**: Open Folder and editor-link descriptions name the active platform modifier.

**Build**:

- render the platform Open Folder chord.
- render `Cmd+click` on macOS and `Ctrl+click` on Windows.
- make shared-behavior comments platform-neutral.

**Verify**:

- `npm test -- src/open-board/open-board.test.tsx src/ui/controls/editor-row.test.tsx src/settings/settings-schema.test.ts` → reuse the Task 22 Open board platform harness; editor-row and Settings Windows-copy Red cases fail before production edits, then all copy passes for both platforms.
- `rg -n "⌘O|⌘\\+click|Cmd\\+click" src/open-board/open-board.tsx src/ui/controls/editor-row.tsx src/settings/settings-schema.ts` → hardcoded user-facing copy is gone.

---

### Task 30: Configure native Windows chrome

**Files**:

- [tauri.conf.json](../../src-tauri/tauri.conf.json)
- [tauri.macos.conf.json](../../src-tauri/tauri.macos.conf.json)
- [tauri.windows.conf.json](../../src-tauri/tauri.windows.conf.json)

**Depends on**: Implementation Task 4

**Decision**: base config contains neutral shared window metadata; macOS keeps overlay/hidden title behavior; Windows uses decorated native chrome and NSIS/WebView2 settings.

**Build**:

- move overlay-only window fields and macOS bundle values into the macOS config.
- define the full Windows window entry with native decorations and required size bounds.
- set Windows bundle target to `nsis` and Evergreen `downloadBootstrapper` WebView2 mode.
- replace the macOS-only short description with neutral product copy.

**Verify**:

- `npm run tauri build -- --no-bundle` on macOS → Tauri automatically merges `tauri.macos.conf.json`, runs the frontend build, compiles the desktop binary, and exits zero without bundling.
- the Task 33 `npm run tauri build -- --no-bundle --ci` Windows step automatically merges `tauri.windows.conf.json`, sees `bundle.targets = ["nsis"]`, and contains no macOS-only description/window fields.

---

### Task 31: Adapt in-app chrome without recreating Windows controls

**Files**:

- [app.tsx](../../src/ui/app.tsx)
- [app.test.tsx](../../src/ui/app.test.tsx)
- [styles.css](../../src/styles.css)

**Depends on**: Task 30

**Decision**: Windows top-tab mode omits the blank traffic-light row; Windows sidebar mode keeps a compact Deck action toolbar below native chrome; Preact renders no system controls.

**Build**:

- add platform classes and conditional titlebar/toolbar rendering.
- keep macOS drag region and double-click maximize behavior unchanged.
- remove the Windows top-mode spacer and size the sidebar toolbar at both required viewports.
- cite applicable `DL-*` rules and update the design-language ledger only for an actual fixed violation.

**Verify**:

- `npm test -- src/ui/app.test.tsx` → macOS top/sidebar and Windows top/sidebar structures pass.
- web preview screenshots catch layout overflow; real Windows screenshots remain required for eye approval.

---

### Task 32: Validate one Windows NSIS artifact

**Files**:

- [verify-windows-bundle.mjs](../../scripts/verify-windows-bundle.mjs)
- [verify-windows-bundle.test.mjs](../../scripts/verify-windows-bundle.test.mjs)
- [package.json](../../package.json)

**Depends on**: Task 30

**Decision**: a focused validator fails unless exactly one `*-setup.exe` and zero MSI files exist under the Windows bundle directory.

**Build**:

- add an explicit bundle-root argument and fail on missing/non-directory input.
- list matched paths on failure without deleting or rewriting artifacts.
- expose `npm run verify:windows-bundle`.

**Verify**:

- `node --test scripts/verify-windows-bundle.test.mjs` → scratch-directory fixtures for zero, one, many setup executables, and any MSI pass without writing fixtures into the repository.
- `node scripts/verify-windows-bundle.mjs <bundle-root>` exits zero only for the one-NSIS fixture.

---

### Task 33: Harden the early Windows CI lane for the complete preview

**Files**:

- [ci.yml](../../.github/workflows/ci.yml)

**Depends on**: Implementation Tasks 1A, 12, and 26, plus Task 30

**Decision**: the existing non-publishing `windows-check` job from Implementation Task 1A remains the stable gate and expands only with checks required by the completed preview.

**Build**:

- preserve the job name, pull-request trigger, Node 22, stable Rust, caches, non-admin execution, and the Linux job from Implementation Task 1A.
- retain `npm ci`, `npm run generate:menu:check`, `npm test`, `npm run build`, Rust formatting, and locked Rust tests.
- run `npm run tauri build -- --no-bundle --ci` so Tauri automatically merges `tauri.windows.conf.json`, compiles the Windows desktop binary, and validates configuration without building or publishing an installer.
- keep release permissions, tags, signing, installer upload, and GitHub Release creation absent.

**Verify**:

- `git diff --check -- .github/workflows/ci.yml` → no workflow whitespace errors.
- after separate authorization for the remote ref, the completed `windows-check` URL is recorded and `npm run tauri build -- --no-bundle --ci` plus all frontend, Rust, formatting, and menu steps are green before Task 34.

---

### Task 34: Stage the unsigned Windows setup as a private artifact

**Files**:

- [ci.yml](../../.github/workflows/ci.yml)

**Depends on**: Tasks 32 and 33

**Decision**: an explicitly dispatched Windows engineering build uploads one validated unsigned setup as a private, retention-limited GitHub Actions artifact; it never modifies or invokes the public macOS release workflow.

**Build**:

- add `workflow_dispatch` to the non-publishing CI workflow and a Windows x64 NSIS bundle job that runs only for that event after `windows-check`.
- fail before bundling unless `github.event.repository.private` is true, so a repository visibility change cannot expose an unsigned artifact.
- run `npm run tauri build -- --ci`; the automatically merged `tauri.windows.conf.json` limits bundling to NSIS.
- run the exact-one-artifact validator before upload.
- upload only the validated `*-setup.exe` through `actions/upload-artifact` with a fixed engineering-preview artifact name and bounded retention.
- grant no `contents: write` permission and perform no tag, GitHub Release, signing, or publication action.
- leave `.github/workflows/release.yml` unchanged; adding a signed Windows asset to the shared public release is a future separately approved task after Task 37 passes.

**Verify**:

- workflow dependencies show the private bundle job depends on `windows-check`, runs only on `workflow_dispatch`, requires a private repository, and has no release-writing permission.
- `git diff --exit-code -- .github/workflows/release.yml` → the existing macOS public-release workflow is unchanged.
- after separate authorization for commit, push, and dispatch, the workflow URL records exactly one private setup artifact and zero MSI files; no GitHub Release is created or edited.

---

### Task 35: Update product and living documentation

**Files**:

- [README.md](../../README.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [CONTEXT.md](../CONTEXT.md)

**Depends on**: Implementation Tasks 14, 19, and 23, plus Tasks 31 and 34

**Decision**: docs describe implemented preview behavior, preserve relative anchors/intent labels, and do not claim Windows runtime acceptance.

**Build**:

- add Windows engineering-preview status, private artifact access, SmartScreen warning, shortcut map, and editor/link behavior to README.
- update architecture boundaries and flows with `current` anchors.
- update context with engineering-preview state and every pending gate.
- keep accurate `Chưa khớp thực tế` ledgers in both living docs.

**Verify**:

- every new living-doc behavior claim has a valid relative code/config link and intent label.
- `rg -n "Gate W[1-4]|engineering preview|SmartScreen" README.md docs/ARCHITECTURE.md docs/CONTEXT.md` → status and gates are explicit.

---

### Task 36: Run local regression verification

**Files**:

- [package-lock.json](../../package-lock.json)
- [Cargo.lock](../../src-tauri/Cargo.lock)

**Depends on**: Implementation Tasks 1–27 plus Tasks 1A and 4A, and Delivery Tasks 28–35

**Decision**: lockfiles contain only required platform/clipboard dependencies; no completion claim is made from partial checks.

**Build**:

- inspect dependency diffs for unrelated upgrades.
- run generated-file, frontend, Rust, format, and production-build checks from fresh invocations.
- inspect status for temporary or orphan files.

**Verify**:

- `npm run generate:menu:check`, `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` pass with exact totals recorded.
- `git diff --check` reports no whitespace errors.
- `git status --short` lists only scoped changes.

---

### Task 37: Run Windows evidence gates before beta approval

**Files**:

- [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
- [CONTEXT.md](../CONTEXT.md)

**Depends on**: Tasks 33–36

**Decision**: Windows CI evidence may validate the private engineering artifact; only real Windows 11 runtime evidence can advance it toward beta, and public distribution still requires signing plus separate authorization.

**Build**:

- collect the successful Windows CI URL and exact private GitHub Actions artifact name/count.
- run Gates W1–W4 and the full spec runtime list on a clean non-admin Windows 11 x64 VM/device.
- capture both tab positions at `1100x720` and `480x320` for user eye approval.
- record dated pass/fail evidence in context; any failure returns the spec to review.
- after all gates pass, stop for an explicit decision on signing and a separately authorized public-release plan; do not attach the unsigned artifact to the existing GitHub Release.

**Verify**:

- Gates W1–W4 each have a dated evidence record rather than an inferred result.
- no doc/release copy says Windows beta/public support while any gate lacks passing evidence, signing is absent, or publication lacks separate authorization.

## 7. Spec coverage review

- PowerShell, discovery, readiness, CWD, WMI, Job Object, process-state, path/editor, and input failures map to implementation Tasks 5–26.
- shortcut labels and platform copy map to implementation Task 27 and delivery Tasks 28–29.
- native chrome and both demo surfaces map to Tasks 30–31 and 37.
- WebView2, NSIS cardinality, macOS coexistence, private staging, and prevention of unsigned public release map to Tasks 30 and 32–34.
- local automated acceptance maps to Task 36.
- install/relaunch/replacement/uninstall, real agents, ConPTY streaming/resize, CWD inheritance, teardown, IME, notifications, SmartScreen, and screenshot approval map to Task 37.
- excluded Store, ARM64, Windows 10, alternate shell, custom title-bar, auto-update, and Linux scope remains unchanged.
- placeholder scan is clear; all deferred work is explicit real-Windows evidence outside the macOS host.
- type names and task dependencies match the implementation plan.
