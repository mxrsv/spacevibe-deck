# Native two-column OpenBoard — recents rail + Layout/Agent detail

**Spec**: mock eye-approved in session (scratchpad `open-board-mock.html`, final screenshot 2026-07-27); constraints distilled from 3 same-day agent reports (state/keyboard/design).
**Goal**: replace the current OpenBoard layout (logo panel + 520px right column) with two columns in the stage — a 300px rail (removable recents, Open Folder pinned at the bottom) and a detail column (workspace header, Layout grid with terminal-mini thumbnails, Agent row, footer) — keeping every existing keyboard path intact.
**Architecture**: pure Preact + CSS in the existing files; one new remove-recent API in the store; no `workspaces.json` schema change (version stays 2); the preset/split-tree/PTY machinery is untouched. LogoPanel is deleted, `logoDataUrl` is re-homed to the top of the rail, so the App logo feature in Settings stays alive.

## 1. Expected outcomes

- The board renders two columns matching the mock in the 900×658 stage (default 1100×720 window) — verify with an `npm run dev` screenshot against the final mock image.
- Every recent row has a folder icon, name, tildified path, readable time, and an × button removing it from recents; missing rows get a yellow icon and struck-through path, and remain removable — verify with the `removeRecent` test in `workspace-recents.test.ts` plus real mouse interaction.
- The Missing group sits at the bottom of the rail with a one-click "Remove N" button — verify with the `partitionRecents` test and a real click.
- Hovering a (non-built-in) preset card shows ✎/× buttons; built-ins only show the dot; rename/delete work by mouse — verify by real interaction + the existing presets-store tests still passing.
- Every existing key keeps its behavior: ↑↓, Tab/←→, 0–9, ⌘O, Enter, Esc, R, ⌫ — verify with `npm test` (new board tests) + real interaction.
- Removing the currently selected recent does not "resurrect" it; selection jumps to the next row — verify with the `open-board.removal.test.tsx` test.
- `npm run build` and `npm test` fully green.

## 2. Canonical data sources

**Canonical data**: `workspacesData` ([workspaces-store.ts](../../src/open-board/workspaces-store.ts)) for recents; `presetsData`/`boardPresets()` ([presets-store.ts](../../src/presets/presets-store.ts)) for Layout cards; `detectAgents()` ([pty-client.ts](../../src/terminal/pty-client.ts)) for Agent chips; `logoDataUrl` ([logo-store.ts](../../src/settings/logo-store.ts)) for the rail-top logo.

**Read from**: the signals/stores above + the `dirs_exist` IPC (already used by the board).

**Do NOT read from**: `$SHELL` (no UI-side source), an open counter (not in the schema — no "Opened N times" display), `git_branch` (would spawn a process per arrow key — out of scope).

## 3. Business rules & invariants

- **Removing a recent is new store behavior, not a UI filter**: `removeRecent(path)` rewrites `workspaces.json`; a removed row does not come back after restart — verify with a store test + relaunching the app.
- **No ghost-row resurrection**: when removing exactly `selectedPath`, selection must be reassigned BEFORE the entry leaves the list, because `displayRecents` fabricates a live entry for a `selectedPath` not present in recents ([open-board.tsx](../../src/open-board/open-board.tsx) lines 155-159) — verify with the `open-board.removal.test.tsx` test.
- **No button nested in button**: a recent row changes from `<button>` to `<div role="option">` + a separate `<button>` for ×; missing rows no longer use `disabled` (so × stays clickable) — verify by reading the DOM in a render test.
- **Keyboard and mouse are peers (ADR 0006 legacy)**: every new mouse behavior (recent ×, Remove N, preset ✎/×) has a pre-existing keyboard equivalent (⌫ removes the selected recent; R/⌫ for presets) — verify with keyboard tests.
- **Solid accent only for recents selection + primary button**: Layout/Agent cards keep the `inset 0 0 0 1px var(--accent)` ring; text on an accent background uses `var(--bg)`, secondary text at 82% — no hardcoded colors — verify by grepping `#0f1219\|#0b0b11` for 0 hits in the diff.
- **Thumbnails from tokens**: gutter background `var(--bg)`, panes `color-mix(bg 80%, tone)` — a light theme flips automatically — verify by switching `colorOverrides.background` to a light value in Settings and looking.
- **FR-025 legacy**: `detectAgents` failing → Shell only remains, the board still opens — existing behavior, do not break — verify by the existing `workspace-recents` tests passing untouched.

## 4. In scope / out of scope

**Do**:

- `removeRecent` + `removeRecents` API (batch for Missing) in the store, with tests.
- Rewrite the OpenBoard JSX + CSS to the mock: rail (logo + title + count, list, Missing group, Open Folder pinned at the bottom) and detail (name/path header, Layout grid, Agent chips, footer unchanged).
- Terminal-mini thumbnails drawn with CSS background layers in `PresetThumb` (keep the existing split recursion).
- Hover ✎/× buttons on non-built-in preset cards, wired to the existing `startRename`/`confirmDeleteId`.
- Let ⌫ remove a recent when section = workspace (with safe selection handoff); keep ⌫ deleting a preset when section = layout.
- Let `moveWorkspace` reach missing rows (drop the filter), since missing rows are now keyboard-removable.
- Delete `logo-panel.tsx`; render the logo (`logoDataUrl` or DefaultMark) at the top of the rail; fix the LogoRow desc in Settings if it drifts.
- New tests for the removal flow and the Missing partition.

**Do NOT**:

- A search/filter box for recents (kills the keyboard model, not worth it for 8 items — decided in session).
- Today/This Week time groups (the list is already time-sorted).
- "Opened N times", a git-branch chip, a shell label (`zsh`) — no cheap data source.
- Schema/`WORKSPACES_VERSION` changes, migrations, raising `MAX_RECENTS`.
- Fixing the late agent-detect behavior (S7) and global focus-visible (B4) — pre-existing debt, separate tasks.
- Drag-and-drop image to set the logo (the drop-zone dies with LogoPanel; the Settings path remains).

## 5. Risks & open decisions

**Decided, with risk**:

- Dropping the logo drop-zone — risk: anyone used to drag-and-drop won't find it; mitigated by a clear desc in Settings.
- `moveWorkspace` entering missing rows — risk: Enter on a missing row must be blocked (the footer already warns, `workspaceValid` already blocks Open — keep that guard).
- Recent rows as `div role="option"` — risk: losing a button's default focus; the board already drives roving selection on the container, so real behavior is unchanged.

**Undecided, needs resolution**: (none left — every UI decision was locked on the mock)

## 6. Tasks

### Task 1: Remove-recent API in lib + store

**File(s)**:

- [workspace-recents.ts](../../src/lib/workspace-recents.ts)
- [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts)
- [workspaces-store.ts](../../src/open-board/workspaces-store.ts)

**Decision**: remove by exact `path` (no normalization — same comparison rule as the current `pushRecent`); the batch form takes an array of paths.

**Build**:

- Add a pure function `removeRecents(recents, paths: readonly string[]): readonly RecentWorkspace[]` to the lib (filter by a path Set).
- Add `removeWorkspaceRecents(paths: readonly string[]): void` to the store: call the lib, write the signal, persist following the exact `recordWorkspaceOpen` pattern (including `reportPersistError`).
- Lib tests: remove 1 path from the middle of the list; remove several paths; a path that does not exist → the array stays intact (same reference not required, equal contents).

**Verify**:

- `npm test -- workspace-recents` → new tests pass, old tests untouched.

### Task 2: Split recent rows out of `<button>` + partition Missing

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [workspace-recents.ts](../../src/lib/workspace-recents.ts)
- [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts)

**Depends on**: Task 1

**Decision**: a row is a `<div role="option" aria-selected>` clickable across its whole area; × is a child `<button>`; the list splits into `alive`/`missing` arrays rendered back to back, Missing gets a heading + a "Remove N" button (N = real count, hidden at 0).

**Build**:

- Add an in-file helper: `partitionRecents(displayRecents, missingSet)` returning `{ alive, missing }`.
- Rewrite the list markup: inline SVG folder icon (per the mock), `row__body` (name + path/time meta row), the × button.
- The × button calls `removeSelectedSafely(path)`: if `path === selectedPath.value` → reassign `selectedPath` to the next row in `alive` (or `null` if none) BEFORE calling `removeWorkspaceRecents([path])`.
- The "Remove N" button calls the same helper with the missing path array.
- Drop `disabled={gone}` — missing rows stay click-selectable, only `confirmOpen` stays guarded by `workspaceValid` as before.
- Change the `formatRelativeTime` copy in [workspace-recents.ts](../../src/lib/workspace-recents.ts) to the full form from the mock: `just now` / `N minutes ago` / `N hours ago` / `Yesterday` / `N days ago` / `N weeks ago`; update the matching assertions in [workspace-recents.test.ts](../../src/lib/workspace-recents.test.ts). Do NOT fork a new function.

**Verify**:

- `npm run build` green.
- No `button` nested in `button` in the DOM: grepping the list JSX region finds a single `<button>`, `row__x`.

### Task 3: Removal-flow tests

**File(s)**:

- [open-board.removal.test.tsx](../../src/open-board/open-board.removal.test.tsx) (new file)

**Depends on**: Task 2

**Decision**: render tests use the repo's existing Preact harness (after the `app.test.tsx` pattern).

**Build**:

- Test 1 `removing the selected recent moves selection to the next row`: seed 3 recents, select row 1, click × → `selectedPath` = row 2, list holds 2, NO row carries the removed path (catches the resurrection bug).
- Test 2 `remove-all missing clears the group`: seed 2 missing (mock `dirs_exist` returning false) → click "Remove 2" → the group disappears.
- Test 3 `Backspace on workspace section removes the selected recent`: pressing ⌫ with section=workspace → the row goes away, selection moves to the next row.

**Verify**:

- `npm test -- open-board.removal` → 3 tests pass.

### Task 4: Keyboard — ⌫ for recents, arrows reaching Missing

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)

**Depends on**: Task 2

**Decision**: ⌫ removes a recent IMMEDIATELY (no inline confirm — × and ⌫ share semantics, undo = reopen the folder); presets keep their confirm since a deleted preset is costly to rebuild.

**Build**:

- `handleKeyDown` case "Backspace": if `section === "workspace"` with a `selectedPath` → `removeSelectedSafely(selectedPath)`; keep the old branch for `section === "layout"`.
- `moveWorkspace`: drop the `!missing.value.has(...)` filter — walk all of `displayRecents`.
- Footer keys hint: change the string to the real key set (`↑↓ select · ⇥ section · 1–9 agent · ⌫ remove · ⎋ close` — `⎋` only shown when `canCancel`).

**Verify**:

- Task 3 case 3 passes.
- Real interaction: ↓ walks into missing rows, the footer warns about missing, Enter does not open.

### Task 5: Two-column layout — rail

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)

**Depends on**: Task 2

**Decision**: grid `300px 1fr`; Open Folder is a solid-accent button pinned to the rail bottom; the 24px app logo sits at the rail top (re-homed from LogoPanel).

**Build**:

- `.open-board` changes `grid-template-columns: 1fr 520px` → `300px 1fr`; drop `<LogoPanel />` from the JSX; delete [logo-panel.tsx](../../src/open-board/logo-panel.tsx); import `logoDataUrl`, render a 24px `<img>` (DefaultMark SVG fallback moved into open-board.tsx) next to the "Workspace" title + count.
- Rail CSS per the mock: `.rail`, `.rail__head`, `.rail__scroll`, `.rail__foot`, `.row*`, `.gsep` — solid-accent selection: background `var(--accent)`, name `var(--bg)`, secondary `color-mix(in srgb, var(--bg) 82%, transparent)`, missing icon `var(--yellow)`.
- The old `.workspace-open-folder` button becomes the solid-accent `.openfolder` (text `var(--bg)`, border `color-mix(accent 72%, #000)`), gains `<kbd>⌘O</kbd>`.
- Check the settings file's "shown on the open board" desc ([logo-row.tsx](../../src/ui/controls/logo-row.tsx)) — still accurate since the logo stays on the board; no change.

**Verify**:

- `npm run build` green; dev screenshot against the mock: 300px rail, Open Folder pinned at the bottom, logo visible.
- `grep -n "logo-panel" src -r` → 0 hits.

### Task 6: Two-column layout — detail + terminal-mini thumbnails

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)
- [preset-thumb.tsx](../../src/presets/preset-thumb.tsx)

**Depends on**: Task 5

**Decision**: detail header = 19px name + mono ellipsized path (no meta count, no git chip); grid `repeat(auto-fill, minmax(148px, 1fr))`; 70px-tall thumbnails on `var(--bg)` with 3px gutters, panes drawing 2 bars + a green cursor via `background-image` layers.

**Build**:

- Detail JSX: `.wshead` (h1 name, path), Layout `.sect` (hint "Hover a card to rename or delete"), Agent `.sect` (hint "Runs in every pane"), footer keeping the existing notice/summary/actions logic intact.
- `PresetThumb`: leaf renders an extra class so CSS can draw the bar layers; keep the `ThumbNode` recursion intact (CSS + 1 class only).
- CSS: `.lcard*`, `.thumb`, `.pane` (3 `background-image` layers per the mock), `.builtin` dot, `.achip*` (digit kbd, agent logo, Shell `$`), `.is-selected` accent-ring states.
- Agent chips: keep the data intact (`agents.value`, `effectiveAgent`, digit pick) — reskin only.

**Verify**:

- `npm run build` green; screenshot against the mock: 3 card columns, thumbnails distinguishing `layout-test-1` vs `layout-test`, built-in cards with no hover buttons.

### Task 7: Hover ✎/× buttons on preset cards

**File(s)**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [styles.css](../../src/styles.css)

**Depends on**: Task 6

**Decision**: ✎ calls `startRename(preset)`, × sets `confirmDeleteId` (opens the existing delete/keep confirm); both `stopPropagation` so the card is not selected/opened; built-ins render no tools (already guarded by `isBuiltIn`).

**Build**:

- Add `.lcard__tools` (2 `<button>`s, shown on `:hover`) to non-built-in cards; keep the `onContextMenu` rename as-is (two entry points into one function).
- The delete/keep confirm keeps its old markup, reskinned for the new card only.
- `startRename` already clears `confirmDeleteId`; add the reverse: opening the delete confirm → `renamingId.value = null`.

**Verify**:

- `npm test` fully green.
- Real interaction: hovering a regular card shows ✎/×; clicking × → confirm; clicking ✎ → rename input focused; built-ins show nothing.

### Task 8: Cleanup + full verify

**File(s)**:

- [styles.css](../../src/styles.css)
- [open-board.tsx](../../src/open-board/open-board.tsx)

**Depends on**: Task 7

**Build**:

- Delete the old layout's orphaned CSS: `.board-logo*`, `.workspace-row*`, `.preset-chip*` (the unused parts), `.board-side*` if renamed.
- Grep `#0f1219\|#0b0b11` in `src/styles.css` → must be 0 (no hardcoded mock colors).
- Screenshot at the 1100×720 window and a narrow ~700px window — the rail stays 300px, the detail scrolls, the footer does not disappear.

**Verify**:

- `npm run build` + `npm test` fully green; paste the output.
- `grep -n "board-logo\|workspace-row\|preset-chip" src/styles.css` → 0 hits (or only deliberately reused names remain).
