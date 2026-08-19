# Open Board start surface implementation plan

**Spec**: [2026-08-19-open-board-start-surface-design.md](../specs/2026-08-19-open-board-start-surface-design.md)
**Goal**: Separate starting work, live work, and historical work across Open Board, Agent Rail, and the right dock.
**Architecture**: Keep the existing Open Board home/worktree controller and add a Sessions subview that reuses the existing session body. Derive transient shell visibility from live-tab and board state without changing persisted sidebar or dock settings. Remove archived rows from the Agent Rail model and renderer so the rail has one live-work responsibility.

## 1. Expected outcomes

- Open Board contains recent workspaces and explicit Start actions, but no inline session rows — verified by `OpenBoardHome` tests.
- The Agent Rail contains only live tabs and agents — verified by `buildAgentRail` and `AgentRail` tests.
- Cold start suppresses the empty rail and dock; invoking Open Board during live work preserves the rail — verified by `app-policy` tests.
- Sessions remain reachable from a dedicated Open Board subview — verified by Open Board view tests.
- The approved cold-start and active-work compositions are represented in the existing gallery section — verified by `npm run build` and owner eye review after permission to run the gallery.

## 2. Canonical data

**Canonical data**: `tabViews` for live work, `workspacesData.recents` for recent workspaces, and the existing Sessions store for historical sessions.

**Read from**: the existing renderer stores and host capability signals.

**Do not read from**: transcript files in Open Board, Agent Rail archived state, or inferred DOM state. Transcript access remains behind the Sessions store, and shell policy remains pure and testable.

## 3. Business rules and invariants

- **Live rail**: only `tabViews` may produce Agent Rail rows — verified by `buildAgentRail` returning no archived collection.
- **Transient suppression**: zero live tabs may suppress the rail, but must not write `sidebarCollapsed` — verified by an app-policy unit test and diff inspection.
- **Dock preservation**: Open Board may unmount the dock visually, but must not write `dockOpen` or `dockTab` — verified by an app-policy unit test and Settings-store assertions.
- **One history surface**: Open Board Sessions and Dock Sessions never mount together — verified by an App render-policy test.
- **Visible consequence**: remembered agent/preset and `Open` state are DOM text, not title-only content — verified by `OpenBoardHome` tests.
- **No blank escape**: Open Board cannot close when there are no live tabs — existing `canCancel` behavior remains covered.

## 4. Scope

**Build**:

- Reshape Open Board home content and row semantics.
- Add a dedicated Sessions subview inside Open Board.
- Remove archived workspace rows from Agent Rail.
- Add transient rail/dock visibility policy.
- Extend the existing Open Board gallery section with cold-start and active-work specimens.
- Update Design Language, Architecture, and Context after implementation evidence exists.

**Do not build**:

- Prompt composer behavior.
- New PTY, materialization, session-scanner, or persistence behavior.
- Session-title parsing fixes.
- New dependencies, new visual-token values, or a Tauri Sessions backend.

## 5. Risks and resolved decisions

**Resolved with risk**:

- Removing archived rail rows reverses Agent Rail spec §8. The owner approved the role separation on 2026-08-19; the implementation must record the resolved fork in `docs/ARCHITECTURE.md` and amend DL §27.
- Reusing `SessionsBody` inside Open Board requires the dock to be unmounted while the board is visible, otherwise its tab and panel ids duplicate. The persisted dock choice remains untouched.
- The visual treatment cannot be accepted from code or tests. The implementation can stop at a reviewable gallery specimen until the owner allows the gallery to run and approves the screenshots.

## 6. Tasks

### Task 1: Lock Open Board home behavior with failing tests

**Files**:

- [open-board-home.test.tsx](../../src/open-board/open-board-home.test.tsx)
- [open-board.views.test.tsx](../../src/open-board/open-board.views.test.tsx)

**Decision**: Home shows Start actions and workspace recents only; Sessions is a separate subview.

**Build**:

- Add a failing test proving inline `Recent sessions` content is absent.
- Add failing tests for the `Start a workspace` heading, primary/secondary/tertiary action hierarchy, and the Sessions capability gate.
- Add failing tests proving a workspace row exposes remembered combo text and `Open` state in the DOM.
- Add failing keyboard tests for Tab-focusable workspace activation with Enter and Space.
- Add a failing test for visible pending state and competing-action disablement.

**Verify**:

- `npx vitest run src/open-board/open-board-home.test.tsx src/open-board/open-board.views.test.tsx` exits non-zero for the newly asserted behavior before production edits.

---

### Task 2: Reshape Open Board home and workspace rows

**Files**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [open-board-home.tsx](../../src/open-board/open-board-home.tsx)

**Depends on**: Task 1.

**Decision**: Keep a two-line workspace row, make the one-click consequence visible, collapse missing rows, and expose pending/error state in the DOM.

**Build**:

- Replace the inline recent-session props and markup with heading plus Start actions.
- Pass the current live workspace paths into Open Board and mark matching recents as `Open`.
- Turn each workspace activation layer into a keyboard-operable control without nesting the remove button.
- Render remembered preset/agent text visibly and name already-open activation as `Start another session`.
- Add a collapsed missing-workspace disclosure and retain the existing removal path.
- Route folder-picker failure into the existing Open Board notice and render pending state while `opening` is true.

**Verify**:

- `npx vitest run src/open-board/` exits 0.
- `rg -n "Recent sessions" src/open-board/open-board-home.tsx` returns no match.

---

### Task 3: Apply the approved Open Board treatment

**Files**:

- [09-open-board.css](../../src/styles/09-open-board.css)
- [app.test.tsx](../../src/ui/app.test.tsx)

**Depends on**: Task 2.

**Decision**: Heading first, one primary action, secondary Worktree, tertiary Resume, visible metadata, and existing semantic tokens only.

**Build**:

- Add the heading/action hierarchy without new raw color, radius, spacing, or motion values outside existing Open Board conventions.
- Add visible focus, pending, open-workspace badge, and missing-disclosure states.
- Preserve the responsive single-column action layout and existing reduced-motion behavior.
- Extend the CSS contract assertions only where a structural selector must remain stable.

**Verify**:

- `npx vitest run src/open-board/ src/ui/app.test.tsx` exits 0.
- `git diff --check -- src/styles/09-open-board.css` exits 0.

---

### Task 4: Add the dedicated Sessions subview

**Files**:

- [open-board.tsx](../../src/open-board/open-board.tsx)
- [open-board-home.tsx](../../src/open-board/open-board-home.tsx)
- [open-board.views.test.tsx](../../src/open-board/open-board.views.test.tsx)

**Depends on**: Tasks 2 and 3.

**Decision**: `Resume a previous session…` opens a Back-navigable Sessions view inside Open Board and reuses the existing Sessions store/list.

**Build**:

- Extend `BoardView` with `sessions`.
- Mount the existing `SessionsBody` in the board-width compact variant behind the Sessions capability gate.
- Make Escape and Back return to Home before Open Board may close.
- Keep scan lifecycle on board open and close Open Board only after a resume succeeds.
- Preserve failure feedback when resume returns false.

**Verify**:

- `npx vitest run src/open-board/open-board.views.test.tsx src/ui/sessions/` exits 0.
- Test `Escape returns the Sessions subview to Home` passes.
- Test `successful board resume closes Open Board` passes at the App policy/callback seam.

---

### Task 5: Remove archived rows from the Agent Rail model

**Files**:

- [agent-rail-model.ts](../../src/ui/agent-rail-model.ts)
- [agent-rail-model.test.ts](../../src/ui/agent-rail-model.test.ts)

**Decision**: History-only workspaces produce no Agent Rail model output; live stream behavior remains unchanged.

**Build**:

- First replace archived-row tests with a failing invariant that history-only workspaces produce no rail row.
- Remove `RailArchivedRow`, archived inputs, ranking helpers, and the `archived` output collection.

**Verify**:

- `npx vitest run src/ui/agent-rail-model.test.ts` exits 0.
- `rg -n "RailArchivedRow|archivedRows|archivedPaths" src/ui/agent-rail-model.ts` returns no match.

---

### Task 6: Remove archived rows from the Agent Rail renderer

**Files**:

- [agent-rail.tsx](../../src/ui/agent-rail.tsx)
- [agent-rail.test.tsx](../../src/ui/agent-rail.test.tsx)

**Depends on**: Task 5.

**Decision**: Agent Rail renders the live model only and exposes no archived resume callback.

**Build**:

- Replace archived renderer tests with a failing assertion that history-only data paints no row.
- Remove `ArchivedRow`, archived markup, and `onResumeWorktree` from `AgentRailProps`.
- Preserve the live cluster, pane-focus, New action, footer, and banner behavior.

**Verify**:

- `npx vitest run src/ui/agent-rail.test.tsx` exits 0.
- `rg -n "ArchivedRow|onResumeWorktree|view\.archived" src/ui/agent-rail.tsx` returns no match.

---

### Task 7: Remove archived-only Agent Rail styling

**Files**:

- [04a-agent-rail.css](../../src/styles/04a-agent-rail.css)
- [04b-agent-rail-rows.css](../../src/styles/04b-agent-rail-rows.css)

**Depends on**: Task 6.

**Decision**: Delete selectors that can no longer match while preserving the quiet live-row tone and compact-sidebar rules.

**Build**:

- Remove `.asr-archive` and `.asr-row--archived` selectors and comments.
- Rewrite any live-row comment that described its tone through the deleted archived genre without changing the live values.

**Verify**:

- `rg -n "asr-archive|asr-row--archived" src/styles` returns no match.
- `npx vitest run src/ui/agent-rail.test.tsx src/ui/agent-rail-model.test.ts` exits 0.

---

### Task 8: Lock transient shell visibility with pure policy

**Files**:

- [app-policy.ts](../../src/ui/app-policy.ts)
- [app.test.tsx](../../src/ui/app.test.tsx)

**Depends on**: Task 6.

**Decision**: Live-tab count controls rail availability and `boardOpen` controls dock mounting; policy returns values and performs no Settings write.

**Build**:

- Write failing policy tests for cold start, active-work board, persisted collapsed state, and dock restoration.
- Add pure helpers that derive live-rail availability, effective collapsed state, and dock visibility.
- Keep existing strip and overlay policies unchanged.

**Verify**:

- `npx vitest run src/ui/app.test.tsx` exits 0.
- Tests prove policy evaluation does not mutate Settings signals.

---

### Task 9: Wire transient shell visibility into App

**Files**:

- [app.tsx](../../src/ui/app.tsx)
- [desktop-chrome.tsx](../../src/ui/desktop-chrome.tsx)

**Depends on**: Tasks 4 and 8.

**Decision**: Suppress empty rail chrome and the dock while Open Board is visible without changing persisted preferences.

**Build**:

- Derive rail availability separately from sidebar layout and collapsed preference.
- Suppress the sidebar toggle and resize grip when there is no live rail to reveal.
- Gate `DockPanel` mounting on Open Board being closed while leaving `dockOpen` and `dockTab` unchanged.
- Remove the archived-resume callback deleted in Task 6.
- Close Open Board only after a board-originated session resume succeeds.

**Verify**:

- `npx vitest run src/ui/app.test.tsx src/ui/sidebar-shell.test.ts` exits 0.
- Diff inspection shows no `updateSettings` call in transient visibility derivation.

---

### Task 10: Build the two approved gallery specimens

**Files**:

- [board-section.tsx](../../src/gallery/sections/board-section.tsx)
- [chrome-fixtures.tsx](../../src/gallery/chrome-fixtures.tsx)

**Depends on**: Tasks 3 through 9.

**Decision**: The existing Open Board gallery section shows cold start without a rail and active work with a live rail; no new gallery section or registry entry is created.

**Build**:

- Update the current specimen props for the new Open Board contract.
- Add the cold-start and active-work compositions using real Open Board and Agent Rail components.
- Keep gallery imports out of shipping modules.

**Verify**:

- `npm run build` exits 0 and the shipping bundle imports no `src/gallery/` module.
- `npm run prototype:gallery` is not run without explicit owner permission.
- Owner screenshot approval remains pending until the gallery is allowed to run.

---

### Task 11: Update living documentation

**Files**:

- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [CONTEXT.md](../CONTEXT.md)

**Depends on**: Tasks 1 through 10.

**Decision**: Record the owner-approved role separation, the resolved Agent Rail fork, both-host renderer scope, Electron-only Sessions capability, and the missing native eye review.

**Build**:

- Amend DL §27 so the rail is explicitly live-only and add the Open Board start-surface behavior to the applicable Open Board/shell rules.
- Add the resolved fork to Architecture with relative current anchors.
- Add implementation evidence and outstanding native/gallery review to Context.
- Keep the reality-drift sections accurate.

**Verify**:

- `npm run generate:menu:check` exits 0.
- `git diff --check -- docs/DESIGN-LANGUAGE.md docs/ARCHITECTURE.md docs/CONTEXT.md` exits 0.
- Every new living-doc claim has a relative `current` anchor and each reality-drift section remains present.

---

### Task 12: Run fresh implementation verification

**Files**:

- [package.json](../../package.json)

**Depends on**: Tasks 1 through 11.

**Decision**: Automated evidence covers behavior and bundle integrity; native and visual evidence remain separate.

**Build**:

- Inspect the final diff for scope, generated artifacts, temporary files, and newly orphaned files.
- Run the focused suite, renderer build, menu-generation check, and whitespace check from the final tree.

**Verify**:

- `npx vitest run src/open-board/ src/ui/agent-rail-model.test.ts src/ui/agent-rail.test.tsx src/ui/app.test.tsx src/ui/sessions/` exits 0.
- `npm run build` exits 0.
- `npm run generate:menu:check` exits 0.
- `git diff --check` exits 0.
- Native Electron/Tauri behavior and visual acceptance are reported as unverified until explicit permission and owner review.
