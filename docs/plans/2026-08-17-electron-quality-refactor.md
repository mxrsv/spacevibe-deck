# Electron quality stabilization and refactor plan

Status: **proposed 2026-08-17; implementation requires owner approval**.

**Spec**: [Electron migration design](../specs/2026-08-11-electron-migration-design.md)
**Related record**: [Large-file decomposition](2026-08-16-large-file-decomposition.md)
**Goal**: Restore a trustworthy quality gate, eliminate the audit's data-loss and lifecycle
risks, move cold corpus work off the Electron main thread, and narrow renderer authority before
further R4 decomposition.
**Architecture**: Work in severity order. Behavior fixes start with focused failing tests and
remain separate from structural moves. The main process owns cross-window transactions;
renderer async work uses stable identities and cancellation tokens; corpus scanning runs in
workers; preload exposes named capabilities instead of arbitrary IPC strings.

## 1. Expected outcomes

- Real Phosphor components render through Preact in Vitest — verify with
  `npm test -- src/ui/controls/deck-icon.test.tsx`.
- The full suite reports zero failed tests and zero unhandled errors before R4 promotion.
- Application quit persists the latest debounced journal state, including file-only windows.
- Corrupt settings are preserved or quarantined and never overwritten by startup defaults.
- Cross-window labels are atomic; stale async results cannot repopulate state or leak listeners.
- Shared documents survive until their final surface closes.
- Cold session list and resume work no longer stall the Electron event loop.
- Renderer code cannot supply arbitrary IPC channel or event strings.
- Automated and packaged macOS evidence is recorded exactly; Windows remains unverified until
  Gate C runs on real hardware.

## 2. Sources of truth

**Canonical behavior**: the migration spec, [AGENTS.md](../../AGENTS.md), host facade types under
[src/host](../../src/host), and the regression tests added by this plan.

**Allowed evidence**: committed source, an identified dirty snapshot, temporary fixtures,
content-free owner-corpus timings, packaged Electron observations and real hardware checks.

**Disallowed evidence**: browser Vite rendering as proof of native persistence or PTY behavior;
a build as proof that Vitest is healthy; and macOS results as proof of Windows behavior.

## 3. Invariants

- **Final write wins**: quit performs `cancel debounce -> force write -> suspend`; deliberate
  window close alone deletes that window's journal record.
- **Corruption is not absence**: only `ENOENT` seeds defaults; other read failures preserve bytes
  and surface a diagnostic.
- **One cross-window writer**: main serializes session-label mutations.
- **Explicit persistence mode**: `autoSave: false` disables automatic writes; immediate mode is
  represented separately.
- **Stable async identity**: results commit only while generation, controller and target identity
  remain current.
- **Orphan-only disposal**: shared document state is deleted after its final surface closes.
- **Responsive main process**: cold traversal and transcript reads run outside the event loop.
- **Least-authority bridge**: preload exposes named typed operations, not generic IPC forwarding.
- **No mixed refactors**: behavior fixes, module moves and dependency changes land separately.

## 4. Scope

**Included**:

- Five adjudicated High findings and Medium findings affecting integrity, stale state, latency,
  cache validity, theme safety and usage completeness.
- Dirty Phosphor/Vitest repair and every residual suite failure it exposes.
- Performance instrumentation, typed IPC contracts and packaged macOS acceptance.
- Living-doc updates only after behavior and architecture change.

**Excluded**:

- Further decomposition of `App` or `TabManager` before stabilization.
- Electron cutover, signing, updater channels and release-workflow promotion.
- New UI styling, product features, unrelated cleanup and Windows claims without Gate C.

## 5. Risks and open decisions

**Accepted constraints**:

- The checkout is shared and heavily dirty. Implementation starts only after an owner checkpoint
  or in an owner-approved branch paired with a worktree.
- Adding CSP changes the packaged security boundary and invalidates earlier Gate M evidence.
- `npm audit` reports a low and moderate DOMPurify advisory through Monaco; its forced downgrade
  is breaking and is not an automatic fix.

**Owner decisions required**:

- Approve R4 edits to quit, close, restore and pane-drop coordination.
- Keep Phosphor and repair Vitest compatibility, or revert the dependency migration separately.
  Recommendation: keep it and repair the test boundary.
- Approve a security fork for preload allowlisting, sender validation, CSP and a sandbox spike.
- Choose checkpoint-on-`main` or authorize a branch plus isolated worktree.

## 6. Tasks

### Task 1: Identify the implementation baseline

**Files**: [package.json](../../package.json), [package-lock.json](../../package-lock.json),
[vite.config.ts](../../vite.config.ts)

**Decision**: No implementation starts from an unidentified moving snapshot.

**Build**:
- Record HEAD, status, diff statistics and untracked paths.
- Assign paths to the owner checkpoint, this plan or unrelated work; never broad-stage.

**Verify**:
- `git diff --check` exits 0 and the record names the exact HEAD and dirty-path count.

### Task 2: Reproduce the real Phosphor boundary

**Files**: [deck-icon.test.tsx](../../src/ui/controls/deck-icon.test.tsx),
[deck-icon.tsx](../../src/ui/controls/deck-icon.tsx)

**Decision**: The regression imports a real Phosphor icon through `DeckIcon`; it mocks neither.

**Build**:
- Render one icon and assert its accessible name and `.deck-icon` class.

**Verify**:
- The unfixed `npm test -- src/ui/controls/deck-icon.test.tsx` reproduces the QName failure.

### Task 3: Align Vitest with production Preact resolution

**Files**: [vite.config.ts](../../vite.config.ts), [tsconfig.json](../../tsconfig.json)

**Depends on**: Task 2.

**Decision**: Inline Phosphor in Vitest while retaining React-to-Preact aliases.

**Build**:
- Configure the test dependency boundary; install no second runtime adapter.

**Verify**:
- `npm test -- src/ui/controls/deck-icon.test.tsx` passes.
- `npm ls react react-dom preact @phosphor-icons/react` is captured with the evidence.

### Task 4: Resolve contract and generator residue

**Files**: [agent-rail-model.test.ts](../../src/ui/agent-rail-model.test.ts),
[tab-manager.tab-lifecycle.test.ts](../../src/terminal/tab-manager.tab-lifecycle.test.ts),
[refresh-usage-pricing.test.ts](../../scripts/refresh-usage-pricing.test.ts)

**Depends on**: Task 3.

**Decision**: Assert `idle` for agentless tabs, include the live `hasRun` projection field, and
make pricing output and its checked-in snapshot use one deterministic format.

**Build**:
- Align the two contract assertions and generator formatting with their current consumers.

**Verify**:
- `npm test -- src/ui/agent-rail-model.test.ts src/terminal/tab-manager.tab-lifecycle.test.ts scripts/refresh-usage-pricing.test.ts`
  passes.

### Task 5: Diagnose component behavior residue

**Files**: [agents-section.test.tsx](../../src/ui/settings/sections/agents-section.test.tsx),
[prompt-popover.test.tsx](../../src/prompts/prompt-popover.test.tsx),
[open-board.views.test.tsx](../../src/open-board/open-board.views.test.tsx)

**Depends on**: Task 3.

**Decision**: Separate product defects from insufficient async flushing before editing components.

**Build**:
- Trace custom-agent label commit, prompt validation blur and failed-open notice timing.
- Fix only reproduced production behavior; otherwise make the test await its real boundary.

**Verify**:
- Each file passes in isolation and the product-defect case fails before its fix.

### Task 6: Isolate suite-load timeouts

**Files**: [file-tree-view.test.tsx](../../src/files/ui/file-tree-view.test.tsx),
[search-bar.test.ts](../../src/terminal/search-bar.test.ts)

**Depends on**: Task 3.

**Decision**: Use cheaper fixtures or file-scoped timeouts; never raise the global timeout.

**Build**:
- Record isolated duration and full-suite duration for both tests.

**Verify**:
- Both files pass in isolation and under the full suite without changing production code.

### Task 7: Specify force-flush journal semantics

**Files**: [session-journal.test.ts](../../src/terminal/session-journal.test.ts),
[session-journal.ts](../../src/terminal/session-journal.ts)

**Decision**: One operation cancels debounce, writes the latest snapshot and suspends later writes.

**Build**:
- Add a fake-timer test for a mutation inside the one-second debounce followed by immediate quit.

**Verify**:
- The test fails against the current `suspendSessionJournal(); flushSessionJournal()` order.

### Task 8: Route quit through atomic force-flush

**Files**: [session-journal.ts](../../src/terminal/session-journal.ts),
[app.tsx](../../src/ui/app.tsx)

**Depends on**: Task 7.

**Decision**: Use the atomic operation only after quit confirmation succeeds.

**Build**:
- Replace the two-call order without changing deliberate-window-close deletion.

**Verify**:
- `npm test -- src/terminal/session-journal.test.ts src/lib/quit-guard.test.ts` passes.

### Task 9: Reproduce file-only application quit

**Files**: [quit-flow.test.ts](../../electron/quit-flow.test.ts), [main.ts](../../electron/main.ts)

**Decision**: App quit stays distinct from window close with no PTY and no dirty document.

**Build**:
- Add a one-window clean-file fixture; assert quit flushes and does not clear the record.

**Verify**:
- The fixture fails against the current `before-quit` early return.

### Task 10: Carry explicit quit intent through close

**Files**: [main.ts](../../electron/main.ts), [quit-flow.ts](../../electron/quit-flow.ts),
[app.tsx](../../src/ui/app.tsx)

**Depends on**: Tasks 8 and 9.

**Decision**: Main-process quit intent selects quit-flush behavior for every window.

**Build**:
- Set intent before census; preserve current busy-pane and dirty-file confirmation.

**Verify**:
- `npm test -- electron/quit-flow.test.ts src/lib/quit-guard.test.ts` passes.

### Task 11: Distinguish missing and damaged stores

**Files**: [store.test.ts](../../electron/store.test.ts), [store.ts](../../electron/store.ts)

**Decision**: Only `ENOENT` returns a new-store state; other failures return a typed error.

**Build**:
- Add missing, invalid-JSON and unreadable temporary-file cases; preserve invalid bytes.

**Verify**:
- The corrupt-file test fails against the current catch-all `{}` fallback.

### Task 12: Quarantine corrupt settings at startup

**Files**: [store.ts](../../electron/store.ts),
[register-store.ts](../../electron/ipc/register-store.ts), [main.ts](../../electron/main.ts)

**Depends on**: Task 11.

**Decision**: Defaults seed missing files only; corrupt input moves once to a timestamped quarantine
path and returns a safe error code.

**Build**:
- Quarantine in main; log operation/path context without printing file contents.

**Verify**:
- `npm test -- electron/store.test.ts electron/wire-contract.test.ts` passes and quarantined bytes
  are identical.

### Task 13: Separate disabled and immediate autosave

**Files**: [store.test.ts](../../electron/store.test.ts), [store.ts](../../electron/store.ts),
[store-host.ts](../../src/host/store-host.ts)

**Decision**: `autoSave: false` writes only through explicit `save()`; immediate mode is separate.

**Build**:
- Add disabled, delayed, immediate and explicit-save cases; write once per logical snapshot.

**Verify**:
- `npm test -- electron/store.test.ts` passes and disabled mode records zero automatic writes.

### Task 14: Add an atomic main-process label mutation

**Files**: [store.test.ts](../../electron/store.test.ts), [store.ts](../../electron/store.ts),
[register-store.ts](../../electron/ipc/register-store.ts)

**Decision**: Main serializes one `windowLabels` set/delete transaction.

**Build**:
- Define the flat IPC mutation and test two updates resolving in reverse order.

**Verify**:
- `npm test -- electron/store.test.ts electron/wire-contract.test.ts` preserves both labels.

### Task 15: Remove renderer label read-modify-write

**Files**: [store-host.ts](../../src/host/store-host.ts),
[session-journal.ts](../../src/terminal/session-journal.ts)

**Depends on**: Task 14.

**Decision**: Renderer sends the atomic mutation and never rewrites the shared registry object.

**Build**:
- Replace label set/delete paths while retaining existing window-record writes.

**Verify**:
- `npm test -- src/terminal/session-journal.test.ts electron/store.test.ts` passes.

### Task 16: Dispose shared documents only when orphaned

**Files**: [file-surface-store.test.ts](../../src/files/file-surface-store.test.ts),
[file-surface-store.ts](../../src/files/file-surface-store.ts)

**Decision**: Single-tab close uses the same orphan check as workspace close.

**Build**:
- Close two surfaces sharing a path in sequence; preserve content and dirty state until the last.

**Verify**:
- `npm test -- src/files/file-surface-store.test.ts` passes and disposal occurs once.

### Task 17: Preserve restore identity through filtering

**Files**: [session-restore.test.ts](../../src/terminal/session-restore.test.ts),
[session-restore.ts](../../src/terminal/session-restore.ts)

**Decision**: Map selection by original window/tab identity, never a post-filter index.

**Build**:
- Add dead leading tabs and a second window with overlapping local indices.

**Verify**:
- `npm test -- src/terminal/session-restore.test.ts` selects the original live tab.

### Task 18: Reject stale repository scans

**Files**: [repositories-store.test.ts (new)](../../src/repositories/repositories-store.test.ts),
[repositories-store.ts](../../src/repositories/repositories-store.ts)

**Decision**: Invalidation increments a generation; only its current request may publish.

**Build**:
- Resolve scan B before stale scan A and assert A never repopulates visible state.

**Verify**:
- `npm test -- src/repositories/repositories-store.test.ts` passes.

### Task 19: Cancel late file-controller initialization

**Files**: [file-surface-controller.test.ts](../../src/files/file-surface-controller.test.ts),
[file-surface-controller.ts](../../src/files/file-surface-controller.ts)

**Decision**: A disposed controller unregisters late results and installs no focus callback.

**Build**:
- Defer `listenFileChanged()`, dispose, resolve it, and assert unlisten runs once.

**Verify**:
- `npm test -- src/files/file-surface-controller.test.ts` passes.

### Task 20: Bind pane drop to a stable target

**Files**: [tab-manager.drop-agent-pane.test.ts](../../src/terminal/tab-manager.drop-agent-pane.test.ts),
[tab-manager.ts](../../src/terminal/tab-manager.ts)

**Decision**: Capture manager, tab id and workspace before detection; abort if no longer live.

**Build**:
- Switch active tabs while detection is deferred; assert no mixed-workspace pane is added.

**Verify**:
- `npm test -- src/terminal/tab-manager.drop-agent-pane.test.ts` passes.

### Task 21: Establish a session-list event-loop benchmark

**Files**: [list.test.ts](../../electron/sessions/list.test.ts), [list.ts](../../electron/sessions/list.ts)

**Decision**: Generated temporary metadata measures heartbeat gaps without owner transcript content.

**Build**:
- Add cold/warm fixtures and a short heartbeat while list traversal executes.

**Verify**:
- The unfixed cold fixture demonstrates a heartbeat gap and preserves result-order assertions.

### Task 22: Move session listing into a worker

**Files**: [list.ts](../../electron/sessions/list.ts),
[list-worker.ts (new)](../../electron/sessions/list-worker.ts),
[register-services.ts](../../electron/ipc/register-services.ts)

**Depends on**: Task 21.

**Decision**: Worker owns traversal/head reads; capability probes stop at their requested limit.

**Build**:
- Bound filesystem concurrency, preserve deterministic order and propagate contextual errors.

**Verify**:
- Task 21 records no long heartbeat gap; `npm test -- electron/sessions/list.test.ts` passes.

### Task 23: Move resume resolution into a worker

**Files**: [resolve.test.ts](../../electron/resume/resolve.test.ts),
[resolve.ts](../../electron/resume/resolve.ts),
[resolve-worker.ts (new)](../../electron/resume/resolve-worker.ts)

**Decision**: Worker performs transcript scanning; the IPC result shape stays unchanged.

**Build**:
- Add a heartbeat fixture, bounded traversal and contextual worker failure propagation.

**Verify**:
- `npm test -- electron/resume/resolve.test.ts` passes with no long cold heartbeat gap.

### Task 24: Bound session enrichment cache growth

**Files**: [list.test.ts](../../electron/sessions/list.test.ts), [list.ts](../../electron/sessions/list.ts)

**Decision**: Keep one current fingerprint per path with fixed least-recently-used eviction.

**Build**:
- Exercise repeated mtime/size changes beyond the cap.

**Verify**:
- `npm test -- electron/sessions/list.test.ts` leaves one entry per path and never exceeds the cap.

### Task 25: Validate the complete usage cache schema

**Files**: [cache.test.ts](../../electron/usage/cache.test.ts), [cache.ts](../../electron/usage/cache.ts)

**Decision**: Invalid nested totals or records return an empty cache for rebuild.

**Build**:
- Add malformed nested values that currently pass top-level validation.

**Verify**:
- `npm test -- electron/usage/cache.test.ts` passes and scan consumers do not throw.

### Task 26: Discover bounded nested Claude workflows

**Files**: [discover.test.ts (new)](../../electron/usage/discover.test.ts),
[discover.ts](../../electron/usage/discover.ts)

**Decision**: Include `subagents/workflows/<id>/*.jsonl` under depth, count and byte caps.

**Build**:
- Add direct, nested, excessive-depth and excessive-count fixtures; deduplicate canonical paths.

**Verify**:
- `npm test -- electron/usage/discover.test.ts` passes and owner acceptance includes nested files.

### Task 27: Make concurrent theme import collision-safe

**Files**: [themes.test.ts](../../electron/themes.test.ts), [themes.ts](../../electron/themes.ts)

**Decision**: Reserve destination atomically; suffix exhaustion returns an explicit error.

**Build**:
- Race two imports requesting the same name; use exclusive create/copy with retry.

**Verify**:
- `npm test -- electron/themes.test.ts` preserves both byte-identical imports under unique names.

### Task 28: Bound theme startup payload

**Files**: [themes.test.ts](../../electron/themes.test.ts), [themes.ts](../../electron/themes.ts),
[main.tsx](../../src/main.tsx)

**Decision**: Enforce aggregate bytes and load deterministic bounded batches before first paint.

**Build**:
- Add aggregate-limit and deterministic truncation/error fixtures.

**Verify**:
- `npm test -- electron/themes.test.ts` passes at count, per-file and aggregate boundaries.

### Task 29: Specify a named preload contract

**Files**: [preload.ts](../../electron/preload.ts),
[electron-ipc-contract.test.ts](../../scripts/electron-ipc-contract.test.ts)

**Decision**: Shipping bridge exposes no generic `invoke`, `send` or `listen`.

**Build**:
- Inventory every renderer operation/event and assert one named capability for each.

**Verify**:
- The new contract fails against the current generic preload bridge.

### Task 30: Implement the named renderer bridge

**Files**: [preload.ts](../../electron/preload.ts), [bridge.ts](../../src/host/bridge.ts),
[channels.ts](../../electron/ipc/channels.ts)

**Depends on**: Task 29.

**Decision**: Renderer consumers call typed capability methods and never provide channel strings.

**Build**:
- Replace generic forwarding while preserving current flat payload shapes.

**Verify**:
- `npm test -- scripts/electron-ipc-contract.test.ts electron/wire-contract.test.ts` passes.

### Task 31: Build and prove the IPC sender guard

**Files**: [sender-guard.ts (new)](../../electron/ipc/sender-guard.ts),
[sender-guard.test.ts (new)](../../electron/ipc/sender-guard.test.ts),
[register-services.ts](../../electron/ipc/register-services.ts)

**Depends on**: Task 30.

**Decision**: Privileged handlers accept only the main frame of an owned Deck window on its
configured development or packaged origin.

**Build**:
- Add owned, unknown-window, subframe and wrong-origin cases; apply the guard to services first.

**Verify**:
- `npm test -- electron/ipc/sender-guard.test.ts electron/wire-contract.test.ts` passes and rejects
  invalid senders before side effects.

### Task 32: Guard browser and explorer IPC

**Files**: [register-browser.ts](../../electron/ipc/register-browser.ts),
[register-explorer.ts](../../electron/ipc/register-explorer.ts)

**Depends on**: Task 31.

**Decision**: Every browser-view and filesystem handler enters through the sender guard.

**Build**:
- Wrap all handlers without changing their flat payload validation or path guards.

**Verify**:
- IPC contract, browser security and explorer path-boundary suites pass.

### Task 33: Guard store, theme and updater IPC

**Files**: [register-store.ts](../../electron/ipc/register-store.ts),
[register-themes.ts](../../electron/ipc/register-themes.ts),
[register-updater.ts](../../electron/ipc/register-updater.ts)

**Depends on**: Task 31.

**Decision**: Persistence, theme-file and updater handlers reject unowned senders.

**Build**:
- Wrap every handler and retain existing payload and platform validation.

**Verify**:
- Store, theme, updater and IPC contract suites pass with invalid-sender fixtures.

### Task 34: Guard remaining privileged IPC

**Files**: [register-dialogs.ts](../../electron/ipc/register-dialogs.ts),
[register-shell.ts](../../electron/ipc/register-shell.ts), [main.ts](../../electron/main.ts)

**Depends on**: Task 31.

**Decision**: Dialog, shell and direct main-process handlers use the same sender policy.

**Build**:
- Wrap remaining privileged registrations and prove the IPC inventory has no unguarded handler.

**Verify**:
- `npm test -- scripts/electron-ipc-contract.test.ts electron/ipc/sender-guard.test.ts` passes.

### Task 35: Evaluate CSP and sandboxing as a separate fork

**Files**: [index.html](../../index.html), [main.ts](../../electron/main.ts),
[security-regressions.test.ts](../../scripts/security-regressions.test.ts)

**Depends on**: Task 34.

**Decision**: Add the strictest measured CSP compatible with Monaco; retain `sandbox: true` only if
packaged PTY, browser view and preload checks pass.

**Build**:
- Assert packaged CSP; run sandboxing in a disposable package and record every required source.

**Verify**:
- Security tests and `npm run electron:package` pass; Gate M reruns 6/6 after CSP change.

### Task 36: Resolve dependency advisories without a forced downgrade

**Files**: [package.json](../../package.json), [package-lock.json](../../package-lock.json),
[file-editor.test.tsx](../../src/files/ui/file-editor.test.tsx)

**Decision**: Accept only a non-breaking Monaco/DOMPurify update with editor evidence.

**Build**:
- If none exists, record advisory, exploitability boundary and monitoring owner without churn.

**Verify**:
- Capture `npm audit --omit=dev --audit-level=moderate`; editor tests and build remain green.

### Task 37: Run automated promotion gates

**Files**: [package.json](../../package.json),
[electron-ipc-contract.test.ts](../../scripts/electron-ipc-contract.test.ts)

**Depends on**: Tasks 4-34 and any approved Tasks 35-36.

**Decision**: Native acceptance never starts from a red automated gate.

**Build**:
- If parallel load flakes, rerun isolated or serial and report both results.

**Verify**:
- `npm test`, `npm run build`, `npm run electron:build`, `npm run generate:menu:check` and
  `git diff --check` all exit 0; the test run has zero failures and unhandled errors.

### Task 38: Run isolated packaged macOS acceptance

**Files**: [electron-builder.yml](../../electron-builder.yml), [CONTEXT.md](../CONTEXT.md)

**Depends on**: Task 37.

**Decision**: Use disposable Electron `userData`, never the owner's live Deck data.

**Build**:
- Test last-second quit/relaunch, clean file-only quit, two-window labels and cold session response.
- Rerun Gate M after CSP or sandbox changes.

**Verify**:
- `npm run electron:package` exits 0; four scenarios have timestamped evidence; Gate M is 6/6 when
  applicable.

### Task 39: Close documentation and platform evidence

**Files**: [CONTEXT.md](../CONTEXT.md), [ARCHITECTURE.md](../ARCHITECTURE.md)

**Depends on**: Task 38.

**Decision**: Document observed behavior only; leave Windows and cutover claims open.

**Build**:
- Record gates in `CONTEXT.md` and architectural changes in `ARCHITECTURE.md`.

**Verify**:
- Living claims have relative anchors and intent labels; drift ledgers remain; `git diff --check`
  exits 0.

## 7. Refactor order after stabilization

1. Extract quit/session coordination from `App` behind the tested atomic lifecycle interface.
2. Extract restore identity mapping into a pure module with no host calls.
3. Keep pane-drop coordination in `TabManager` until stale-target tests and native drag acceptance
   are green; then extract one controller without changing initialization order.
4. Split parsing from scheduling only after worker performance results are stable.
5. Remove bridge compatibility code only after Electron cutover is separately approved.

Each extraction is a pure move in its own patch, followed by its focused suite,
`npm run build`, `npm run electron:build` and `git diff --check`.
