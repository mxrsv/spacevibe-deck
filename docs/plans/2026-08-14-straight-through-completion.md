# Straight-through completion — implement everything, review after

> **For agentic workers:** execute with `superpowers:executing-plans` (inline) or
> `superpowers:subagent-driven-development`. Steps use checkbox syntax for tracking.

**Goal:** run the program's entire remaining implementable work in one pass on this machine —
Gate M, the whole phase-4 explorer surface, the real-corpus usage acceptance, the browser
compositor evidence, the native-run evidence debt, and the open-board redesign with its new
create-worktree flow — deferring all human review to a single recorded backlog instead of
stopping between phases.

**Authority:** the owner's 2026-08-14 instruction: "implement all phases in one pass; review
and gates come after." This plan supersedes the sequencing in
[redesign phases 2–5 §7](./2026-08-13-redesign-phases-2-5.md) `current` and resumes from its
§0.8 anchor. It does **not** supersede that plan's requirements — every §5.1/§5.2/§6.1/§6.2
requirement is restated or carried here.

**Architecture:** the model (`src/files/`, 9 modules), the host (`electron/fs/`), the dirty
guards, and the `SurfaceStrip` seam in `src/terminal/tab-manager.ts` are already merged and
tested. Phase 4 builds the surface that plugs into them. The Gate M packaging path, harness
and verifier are in-tree; only the packaged run was missing a Mac — this session has one.

**Tech stack:** Preact + signals (R5), Monaco (imperative mount), xterm.js, Electron host,
electron-builder (Gate M proof config), Vitest.

**Spec:** [file explorer design](../specs/2026-08-12-file-explorer-design.md) `decided`;
[usage/browser requirements](./2026-08-13-redesign-phases-2-5.md) §6 `current`. The
open-board redesign (Tasks 15–16) has no separate spec file: its contract was brainstormed
and locked with the owner in-chat on 2026-08-14 and is recorded in full inside those tasks.

## Global constraints

- **Machine assumption:** this run treats the local macOS machine as the verification Mac.
  If the owner later designates different hardware, Gate M and the §5.2.4 responsiveness
  threshold rerun there.
- Per-change gate: `npm test && npm run build && npm run generate:menu:check`; `electron/`
  changes add `npm run electron:build`; IPC-touching changes confirm
  `scripts/electron-ipc-contract.test.ts` ran inside `npm test`.
- Panel styling cites **DL §19** — never DL-15 (D4). New DL numbers start above §23; §22
  stays reserved.
- English only (R1). Menu output is generated, never hand-edited (R3). Actions live in
  `src/terminal/action-registry.ts` and flow through `npm run generate:menu`.
- One commit per task (W5), conventional message with scope. No `git add -A` — ever
  (§0.2 of the frozen plan is the incident report).
- **Evidence capture is part of every rendered-UI task.** The owner deferred _approval_, not
  _evidence_: each task that changes or exercises rendered UI saves a screenshot/recording
  under `docs/review/assets/2026-08-14-straight-through/` and appends a row to
  `docs/review/2026-08-14-straight-through-evidence.md` (created in Task 0). Automated
  checks do not establish native visual correctness — the captures are what the deferred
  review reviews.
- **Doc stops are not deferrable.** D14 still gates committing doc content that needs owner
  approval (Task 17, Task 18). These are the only mid-run stops besides the three below.

## The only legitimate stops

1. **Gate M fails** (Task 1). A failure reopens the editor-engine decision (spec §9); it
   never degrades to dev-only, and the §5.1 surface is not built on a failed engine.
   Stop, paste the failing evidence, report.
2. **The 100 ms event-loop stall threshold cannot hold** (Task 10). "Stop and redesign
   rather than moving the work into an unbounded `Promise.all`."
3. **Bundle re-measure lands far outside expectation** (Task 12): entry +10.92 kB gzip,
   lazy `editor.api` 674.50 kB. "Far outside expectation is a re-decision, not a footnote."

Everything else runs straight through; findings go into the evidence doc, not into stops.

---

### Task 0: Owner-hardware baseline and evidence scaffold

Every green run so far was Linux/xvfb. This is the first check on owner hardware, and it
settles that the §5.0.1 `/var` symlink fix truly landed.

**Files:**

- Create: `docs/review/2026-08-14-straight-through-evidence.md` (table: task / claim /
  evidence path / platform / needs-eyes)
- Create: `docs/review/assets/2026-08-14-straight-through/` (captures land here)

- [ ] Run `npm test` — expect all suites green, including `electron/fs/read.test.ts`.
- [ ] Run `npm run build && npm run generate:menu:check && npm run electron:build` — green.
- [ ] Record all outputs in the evidence doc as the macOS baseline row.
- [ ] Commit: `docs(review): open the straight-through evidence record`

### Task 1: Gate M — the packaged Monaco proof (STOP #1 lives here)

All artifacts exist (`electron-builder.gate-m.yml`, `gate-m.html`,
`src/files/gate-m-main.tsx`, `vite.gate-m.config.mjs`,
`scripts/verify-electron-gate-m-package.mjs`). Only the packaged run was owed.

- [ ] Run `npm run electron:package:gate-m` (packages `dist-gate-m` via the proof-only
      config; never touches release workflows).
- [ ] Run `npm run electron:verify:gate-m` (creates a disposable fixture outside the repo,
      launches the packaged app with `DECK_GATE_M=1` / `DECK_GATE_M_FILE=<fixture>`).
- [ ] Paste the six individual results into the evidence doc: file opens; syntax
      highlighting proves its worker loaded; edit marks dirty; save reaches disk; DevTools
      has no `file://` worker/asset 404; focus moves between Monaco and xterm without
      keyboard capture.
- [ ] On failure: STOP #1. On pass: note "adding CSP later invalidates this evidence and
      requires a rerun", commit evidence rows only:
      `docs(review): Gate M passes packaged on the verification Mac`

### Task 2: Minimum product slice — panel, tree, one open path

**Files:**

- Create: `src/files/ui/explorer-panel.tsx` — the docked right grid column (spec §3):
  real grid column in `.window`, never an overlay; stage resizes around it.
- Create: `src/files/ui/file-tree-view.tsx` — first render: flat list from
  `src/files/file-tree.ts`, click-to-open; windowing arrives in Task 4.
- Create: `src/files/file-tab-views.ts` — projects open documents into tab-strip view
  models (name, dirty dot, preview italic flag) for `TabBar`/`WorkspaceSidebar`.
- Modify: `src/ui/app.tsx` — mount `createFileSurfaceController()` (exists at
  `src/files/file-surface-controller.ts:90`; deps `{ onSurfacesChanged }` re-derives
  TabManager views), replace the bare `dirtyPaths` import with the controller's.
- Test: `src/files/ui/explorer-panel.test.tsx`, `src/files/ui/file-tree-view.test.tsx`,
  `src/files/file-tab-views.test.ts`

**Interfaces:**

- Consumes: `createFileSurfaceController(deps?: FileSurfaceDeps): FileSurfaceController`
  (`openPath`, `savePath`, `closePath`, `setEditorFocus`, `dispose`); tree model from
  `src/files/file-tree.ts`; `FileEditor` from `src/files/ui/file-editor.tsx`.
- Produces: `<ExplorerPanel controller={...} workspacePath={...} />` mounted in both chrome
  layouts; `fileTabViews(controller): readonly TabViewModel[]` consumed by Task 5.

- [ ] Write failing tests: selecting a file creates the preview surface and supplies its
      editor document; both layout mounts render the panel node.
- [ ] Implement; verify per-change gate; capture a screenshot of the panel in both layouts
      (horizontal `TabBar`, vertical `WorkspaceSidebar`) into the evidence doc.
- [ ] Commit: `feat(explorer): minimum surface — panel, tree, one file-open path`

### Task 3: Panel contract — chord, settings, styling

**Files:**

- Modify: `src/terminal/action-registry.ts` — add `toggle-explorer` on **⌘⇧B /
  Ctrl+Shift+B** (D11's approved `B` chord; `b` verified unused in both keymaps).
- Modify: `src/settings/settings-schema.ts` + `src/settings/settings-store.ts` — add
  `explorerOpen: boolean` (default false) and `explorerWidth: number` (default 260,
  clamped min/max on read), with merge coverage.
- Modify: `src/styles.css` (or the panel's co-located styles per current convention) — panel
  CSS entirely in the restyled token language; comments cite **DL §19**.
- Modify: `src/files/ui/explorer-panel.tsx` — drag-to-resize on the inner edge, persisting
  `explorerWidth`.
- Test: settings merge tests beside the existing settings suites; panel resize test.

- [ ] Failing tests: chord toggles `explorerOpen`; width persists and clamps; merge of a
      settings file missing both keys yields defaults.
- [ ] Implement; run `npm run generate:menu` (View-menu item is generated, R3) and
      `npm run generate:menu:check`.
- [ ] Capture: panel open/closed at both layouts, one drag-resize recording.
- [ ] Commit: `feat(explorer): panel contract — B chord, settings, DL §19 styling`

### Task 4: Tree scale — windowing and icons

**Files:**

- Modify: `src/files/ui/file-tree-view.tsx` — 22px arithmetic windowing (fixed row height,
  index math over scrollTop; no virtualization dependency).
- Create: `src/files/ui/file-icons.ts` — monochrome lucide mapping (directory,
  chevron, per-extension file glyphs; single named exclusion-list constant already lives in
  the renderer model).
- Test: `src/files/ui/file-tree-view.test.tsx` extended.

- [ ] Failing tests: empty, loading, deeply nested, 10k-row (only visible rows in DOM), and
      keyboard focus states (arrows navigate and expand per spec §3.1).
- [ ] Implement; per-change gate; capture a 10k-row scroll recording.
- [ ] Commit: `feat(explorer): tree scale — 22px windowing and monochrome icons`

### Task 5: Chrome integration — the seam goes live

**Files:**

- Modify: `src/files/file-tab-views.ts` — complete: preview italic, promoted-on-intent
  (double-click or first edit, spec §4.1), strip ordering "all terminal tabs, then the
  active workspace's file tabs" (spec §4.2).
- Modify: `src/ui/status-bar.tsx` — file branch (path, dirty, encoding/CRLF note).
- Modify: `src/ui/app.tsx` — pass the controller as `TabManagerDeps.surfaces`
  (`SurfaceStrip` at `src/terminal/tab-manager.ts:269`: `count`, `total`, `activeIndex`,
  `activate`, `deactivate`, `focus`, `close`, `save`, `applySettings`), replacing
  `INERT_SURFACES` and turning the latent tab-close dirty guard live.
- Test: `src/files/file-tab-views.test.ts`, `src/ui/status-bar.test.tsx`,
  `src/terminal/tab-manager.test.ts` (the seam's invariants now run against a real strip).

- [ ] Failing tests: preview replaced without discard; promotion on double-click and on
      first edit; ⌘⇧]/⌘⇧[ cycle across the combined index space; "last surface, not last
      tab"; ⌘W closes the file tab; ⌘1..9 stay terminal-only (spec §4.3).
- [ ] Implement; per-change gate; capture strip-with-file-tabs in both layouts.
- [ ] Commit: `feat(explorer): file tabs join the strip — SurfaceStrip goes live`

### Task 6: Actions — save, menu, placement

**Files:**

- Modify: `src/terminal/action-registry.ts` — add `save-file` (⌘S; scoped: no-op when no
  file surface is active). Bare `Ctrl+S` on Windows remains PTY-reserved until an explicit
  binding decision says otherwise.
- Modify: menu `PLACEMENT` rows for `toggle-explorer` and `save-file`; regenerate.
- Test: action-registry tests; user-configurable-binding conflict check for both actions.

- [ ] Failing tests; implement; `npm run generate:menu && npm run generate:menu:check`.
- [ ] Commit: `feat(explorer): toggle-explorer and save-file actions with generated menu`

### Task 7: Burn-down — action/focus boundary

- Modify: the pane-scoped shortcut guard at `overlayBlocksAction` — fix once, centrally.
  Monaco focuses a `<div>`, so `isChromeTextField` is insufficient.
- [ ] Failing tests: terminal actions do not fire while a file surface owns focus;
      attention-rail and terminal-tab focus call `surfaces.deactivate()` before returning
      focus to xterm.
- [ ] Implement; per-change gate.
- [ ] Commit: `fix(explorer): pane shortcuts respect file-surface focus at the one guard`

### Task 8: Burn-down — document lifecycle

- [ ] Failing tests (across `file-surface-controller.test.ts` / `file-surface-store.test.ts`):
      preview replacement disposes the prior document; workspace close removes its file
      tabs; dirty registry cleans up; a failed close leaves the document and dirty path
      intact.
- [ ] Implement whatever the tests flush out; per-change gate.
- [ ] Commit: `fix(explorer): document lifecycle holds under replace, close and failure`

### Task 9: Burn-down — watch authorization and bounds

**Files:** modify `electron/fs/watch.ts`, `electron/fs/read.ts` (route every `stat_files`
and `watch_paths` input through `electron/fs/path-guard.ts` before filesystem access);
constants live beside the feature.

- [ ] Failing tests: outside-root paths, symlinks escaping root, malformed payloads,
      cap + 1, duplicate paths, watcher teardown on workspace/window close. Limits:
      `MAX_STAT_PATHS = 512`, `MAX_WATCH_DIRECTORIES = 256`, `MAX_WATCH_FILES = 2048`;
      first item over a limit rejects with a structured IPC error.
- [ ] Implement; `npm run electron:build`; per-change gate.
- [ ] Commit: `fix(fs): path-guard and named bounds on every stat and watch input`

### Task 10: Burn-down — filesystem responsiveness (STOP #2 lives here)

- Modify: `electron/fs/read.ts` — replace per-entry `realpathSync` with bounded async work,
  `MAX_REALPATH_CONCURRENCY = 32`.
- [ ] Failing test: a 10k-entry fixture produces the same sorted result as the sync path.
- [ ] Measure on this Mac: no sampled event-loop stall above **100 ms** during the listing.
      If the threshold cannot hold → STOP #2 (redesign, not `Promise.all`).
- [ ] Record the measured numbers in the evidence doc.
- [ ] Commit: `fix(fs): bounded realpath keeps the event loop responsive at 10k entries`

### Task 11: Burn-down — live invalidation

- Modify: `src/files/file-surface-controller.ts` — consume `fs:changed`, coalesce bursts per
  workspace, refresh only affected tree branches.
- [ ] Failing tests: burst coalescing; only affected branches refresh; events after
      controller disposal are ignored.
- [ ] Implement; per-change gate.
- [ ] Commit: `feat(explorer): fs-changed drives targeted tree refresh`

### Task 12: Phase-4 verification (STOP #3 lives here)

- [ ] Focused tests green: `update-controller`, `App.confirmInstall`, the dirty registry,
      the `app_relaunch` path.
- [ ] Exercise **three of the four exits headed on this Mac** — tab close, window close, app
      quit — dirty-only and busy+dirty each: one combined dialog names both causes, Cancel
      preserves the buffer, confirm proceeds only after settings flush. Record each.
      (Install & Relaunch needs a signed updater build — Gate A — and goes to the deferred
      register.)
- [ ] Bundle re-measure against the recorded numbers (entry +10.92 kB gzip, lazy
      `editor.api` 674.50 kB). Far outside → STOP #3.
- [ ] Commit evidence rows: `docs(review): phase-4 exits and bundle measured on macOS`

### Task 13: Usage §6.1.8 — real-corpus acceptance on this machine

The parity gate is green over golden fixtures; the owner-machine table has never been run.
Scratch scripts live in the session scratchpad, never the repo (F4).

- [ ] Fingerprint the corpus by source/file counts without recording content.
- [ ] Compare totals to an independent sample oracle (hand-computed from a small sampled
      subset of this machine's real transcripts).
- [ ] Record cold/warm scan duration and peak RSS.
- [ ] Prove an unchanged poll reads zero JSONL bytes.
- [ ] Exercise missing, unreadable and stale sources.
- [ ] Confirm the dashboard stays interactive during the scan (headed run, recorded).
- [ ] Paste every acceptance row into the evidence doc; state "Windows remains unverified".
- [ ] Commit: `docs(review): usage real-corpus acceptance table, macOS`

### Task 14: Browser §6.2 remainder + native-run evidence debt

- [ ] Compositor pass headed on this Mac, recorded: resize, drag-to-width,
      hide-under-overlay; confirm the `WebContentsView` hole tracks its DOM rect.
- [ ] Inspect payload checked against a real dev server (`npm run dev` as the target).
- [ ] Confirm the native view is labeled Electron-only in UI copy; add the label if absent.
- [ ] **Native evidence debt, captured not approved:** headed Electron run over phase 2
      steps 4–10 and both toolbar layouts — screenshots/recordings filed; one
      `npm run tauri dev` run (first of the program; `styles.css` is shared) — same
      captures, findings recorded as findings, not fixed here unless one-line (W3).
- [ ] Commit: `docs(review): compositor, Inspect and native-run evidence, macOS`

### Task 15: Open board — one sidebar, Cursor-style home and config views

The board currently renders its own `.rail` beside the app's `WorkspaceSidebar`, producing
two sidebars. The locked contract: the rail is removed entirely — the app sidebar (unchanged)
is the only sidebar — and the board becomes a single center surface with two views.

**Files:**

- Modify: `src/open-board/open-board.tsx` (862 lines — split if the rework crosses 800, F8):
  drop `.rail`, add the view switch.
- Modify: the board's styles in the current DL token language (styling within current DL
  rules — not a fork).
- Test: `src/open-board/open-board.removal.test.tsx` and new view tests beside it.

**Contract (locked in-chat 2026-08-14):**

- **Home view** (default, and whenever nothing is picked): centered app logo
  (`logoDataUrl` or `DefaultMark`), an `Open project` button (replaces `Open Folder…`,
  keeps the ⌘O binding and `pickFolder()`), a `Create worktree` button (Task 16; hidden
  when the host lacks the capability), and a **Recent** list below — name, tildified path,
  relative time, per-row remove, the existing `partitionRecents` alive/missing grouping
  with its bulk-remove row. No recents → logo and buttons only.
- **Config view**: clicking a recent (or picking a folder) switches the center to the
  existing Layout + Agent + `Open ⏎` content, plus a back control returning to home.
  Double-click on a recent still opens immediately with its remembered preset/agent.
  The board's keyboard flow (1–9 agent digits, arrows, Enter, section cycling) is
  unchanged inside this view; Escape in config view goes back to home before it cancels
  the board.
- The app's `WorkspaceSidebar`/`TabBar` are untouched; the board still mounts in the stage
  area behind `boardOpen` in `src/ui/app.tsx` with the same `OpenBoardProps`.

**Steps:**

- [ ] Failing tests: home view renders logo, both buttons and grouped recents; selecting a
      recent switches to config view with that path shown; back returns home; double-click
      calls `onOpen` with the remembered preset/agent; empty recents renders no list.
- [ ] Implement; per-change gate (`npm test && npm run build && npm run generate:menu:check`).
- [ ] Capture screenshots of both views (with and without recents) into the evidence doc.
- [ ] Commit: `feat(board): one sidebar — cursor-style home and config views`

### Task 16: Create worktree — Electron host channel and board flow

New capability, Electron-only (Tauri is feature-frozen; the button hides itself there).

**Files:**

- Create: `electron/git/worktree.ts` + `electron/git/worktree.test.ts` — run
  `git -C <repoPath> worktree add <destPath> -b <branch>` via the host's existing
  child-process pattern; structured errors, never a shell string.
- Modify: `electron/ipc/channels.ts` — add `worktree_add`; thin handler in
  `electron/main.ts`. Flat args per R6: `{ repoPath, branch, destPath }`.
- Modify: `scripts/electron-ipc-contract.test.ts` — fixture for the new channel's flat
  payload.
- Create: `src/host/worktree-host.ts` — facade on the existing bridge; exposes
  `available` (false under Tauri and browser dev, so the button renders nothing there)
  and `addWorktree(args)`.
- Modify: `src/open-board/open-board.tsx` — the create-worktree form.

**Contract (locked in-chat 2026-08-14):**

- The form lives in the board's center: repo picker (dropdown of recents plus a browse
  button), a branch-name input, and a **visible, editable destination path** prefilled
  with `<repo parent>/<repo name>-worktrees/<branch>` — the owner's real trees deviate
  from any fixed convention, so the prefill is a suggestion, not a rule.
- Errors surface in the form with user-friendly copy (C5/C6): not a git repository,
  branch already exists, destination exists, git not found. Detailed context stays in
  main-process logs.
- Success flows straight into Task 15's config view with the new worktree selected —
  from there it opens like any workspace.

**Steps:**

- [ ] Failing host tests (git mocked): success; not-a-repo; existing branch; existing
      destination; missing git binary — each a distinct structured error.
- [ ] Failing renderer tests: prefill computation; button absent when
      `worktreeHost.available` is false; error copy renders; success hands the path to the
      config view.
- [ ] Implement; per-change gate plus `npm run electron:build`; confirm the contract test
      covered `worktree_add` inside `npm test`.
- [ ] Headed check on this Mac: create a real worktree from a throwaway repo in the session
      scratchpad (F4 — never inside this repo), open it, record the flow.
- [ ] Commit: `feat(worktree): create-worktree flow from the open board (Electron host)`

### Task 17: Usage worktree residue (D14 STOP — enumerate, then ask)

Both branches are already on origin (`origin/feat/token-usage-dashboard`,
`origin/feat/workspace-reorder`), so §6.0's push authorization is moot. What remains is the
worktree at `~/Documents/Development/spacevibe-deck-worktrees/token-usage-dashboard`:
uncommitted `AGENTS.md` + `docs/CONTEXT.md` modifications, untracked
`docs/plans/2026-08-10-token-usage-dashboard.md` and
`docs/specs/2026-08-10-token-usage-dashboard-design.md` (`.claude/` stays local).

- [ ] Show the owner the exact diffs and both untracked docs.
- [ ] **STOP for D14 approval.** On approval: land the two docs onto `main` (the branch is
      merged; the docs are its missing spec/plan record), discard or land the stale
      AGENTS/CONTEXT edits per the owner's word.
- [ ] Commit (post-approval): `docs(usage): land the dashboard's spec and plan record`

### Task 18: Close-out docs (D14 STOP for content)

- [ ] `docs/CONTEXT.md` — phases closed on owner hardware; what the evidence doc holds (D9).
- [ ] `docs/ARCHITECTURE.md` — resolved forks move in from the AGENTS.md queue.
- [ ] `AGENTS.md` — flip the drift rows that changed: "File explorer is available" →
      surface built, pending eye review; Gate M row; note the open-board redesign and the
      Electron-only create-worktree flow; update the date.
- [ ] Run `bash ~/.claude/scripts/docs-compliance.sh && bash ~/.claude/scripts/docs-anchors.sh`,
      paste output.
- [ ] **STOP for D14 approval of all doc diffs**, then commit:
      `docs: record the straight-through run — surface built, evidence filed`

---

## Deferred register — what "review after" reviews

| #   | Item                                                                                                                                                         | Needs                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | Eye review of every rendered change (DL §9.6) against the captured evidence                                                                                  | owner eyes                     |
| 2   | `css-audit` re-read with the owner                                                                                                                           | owner eyes                     |
| 3   | Native macOS **sign-off** for phase 2 steps 4–10, both toolbar layouts, the explorer surface and the redesigned open board (captures exist after Tasks 2–16) | owner eyes                     |
| 4   | Tauri-run sign-off (capture exists after Task 14)                                                                                                            | owner eyes                     |
| 5   | Four-exit pass, exit #4: Install & Relaunch                                                                                                                  | Gate A (Apple signing)         |
| 6   | Every Windows claim                                                                                                                                          | Gate C (real Windows hardware) |
| 7   | Gate M rerun if CSP is ever added, or if the owner designates a different verification Mac                                                                   | conditional                    |
| 8   | Browser productization spec's owed owner read (frozen plan §0.3.7)                                                                                           | owner eyes                     |

## Chưa khớp thực tế

Rỗng at authoring time — this plan freezes on approval; execution truth lands in
`docs/review/2026-08-14-straight-through-evidence.md` and `docs/CONTEXT.md`.
