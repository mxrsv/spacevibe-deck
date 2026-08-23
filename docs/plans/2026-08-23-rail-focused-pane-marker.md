# Rail Focused-Pane Marker Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark the one agent row in the rail whose pane currently holds the
window's keyboard focus, so a multi-agent tab stops rendering with no active
item at all.

**Architecture:** `TerminalManager` already owns `activeId` and already has a
single writer for it (`setActive`); it gains one callback so the tab layer
learns that focus moved. `syncViews` projects `activePaneId()` onto each
`PaneView` as `focused`, the rail model ANDs that with the tab's own `active`
so at most ONE row in the whole rail is focused, and the component renders
DL-21.1's existing wash on that leaf. No new signifier, no new colour.

**Tech Stack:** Preact signals, TypeScript, Vitest, plain CSS tokens.

**Spec:** none — this is an owner decision taken in conversation on
2026-08-23 ("option B"), from a screenshot of the shipped rail showing a
multi-agent tab's rows carrying no selection.

## Global Constraints

- **English only** in strings, comments, docs and commits (R1).
- **DL-21.1**: selection is a full wash on `--tab-active-bg` at
  `--radius-control` **and nothing else** — no accent bar (DL-21.6), no
  border beside the wash, no shadow.
- **DL-3.2 / DL-18.11**: `--yellow` is reserved for activity and the 1500ms
  rail locator. Focus state may not spend it.
- **DL-21.2**: selection outranks hover, and the two are different values.
- **R4**: `terminal-manager.ts` / `tab-manager.ts` are load-bearing seams —
  the callback added here is additive and optional, and nothing reorders.
- **R6**: no IPC payload changes at all.
- Every rule cited in a code comment must exist in `docs/DESIGN-LANGUAGE.md`
  or `scripts/design-language.test.ts` fails.

## Decisions locked before implementation

1. **Only the active tab's focused pane is marked.** Every tab has an
   `activePaneId`; marking all of them would light one row per tab and mean
   nothing. The model performs the AND so the invariant — at most one focused
   row in the whole rail — is stated once and is unit-testable.
2. **A non-terminal surface on the stage does not clear the mark.** Opening a
   document or the browser leaves `activePaneId` untouched, and the mark then
   reads as "where the keyboard returns to". Clearing it would make the rail
   blink on every file open. (Owner was asked and did not object; recorded
   here as an assumption, reversible in one line.)
3. **Single-agent and shell tabs are unchanged** — they render a tab row, not
   a leaf, and DL-27.8's row wash already answers for them. The leaf wash is
   the same value, so the rail keeps ONE selection signifier.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/terminal/terminal-manager-types.ts` | declares the new optional `onActivePaneChange` callback |
| `src/terminal/terminal-manager.ts` | fires it from `setActive`, the single writer of `activeId` |
| `src/terminal/tabs-store.ts` | `PaneView.focused?: boolean` — the projection the rail reads |
| `src/terminal/tab-manager.ts` | writes `focused` in `syncViews`; re-syncs on the new callback |
| `src/ui/agent-rail-model.ts` | `RailPaneRow.focused`, ANDed with the tab's `active` |
| `src/ui/agent-rail.tsx` | `data-focused` + `aria-current` on the leaf |
| `src/styles/04b-agent-rail-rows.css` | the wash, declared after the hover rule |
| `docs/DESIGN-LANGUAGE.md` | new DL-27.22 |

---

### Task 1: The focused pane reaches the rail model

**Files:**
- Modify: `src/terminal/tabs-store.ts` (`PaneView`)
- Modify: `src/terminal/tab-manager.ts` (`syncViews`'s pane projection)
- Modify: `src/ui/agent-rail-model.ts` (`RailPaneRow`, `paneRows`, `tabRow`)
- Test: `src/ui/agent-rail-model.test.ts`

**Interfaces:**
- Produces: `PaneView.focused?: boolean` — "this pane holds its TAB's focus",
  optional so fixtures predating the field stay valid (the `panes?` /
  `attention?` precedent).
- Produces: `RailPaneRow.focused: boolean` — "this pane holds the WINDOW's
  keyboard focus"; true for at most one row across the whole rail.

- [ ] **Step 1: Write the failing tests**

```ts
it("marks the focused pane of the ACTIVE tab and no other", () => {
  const view = buildAgentRail({
    tabs: [
      tab(1, "/repo", {
        panes: [pane(1, { focused: false }), pane(2, { focused: true })],
      }),
      tab(2, "/repo", { panes: [pane(3, { focused: true })] }),
    ],
    activeIndex: 0,
    scans: new Map(),
    workspaceHistoryPaths: [],
    now: NOW,
  });
  const focused = streamRows(view).flatMap((row) =>
    row.panes.filter((p) => p.focused).map((p) => p.paneId),
  );
  expect(focused).toEqual([2]);
});

it("marks nothing when the focused pane's tab is not active", () => {
  const view = buildAgentRail({
    tabs: [tab(1, "/repo", { panes: [pane(1, { focused: true })] })],
    activeIndex: -1,
    scans: new Map(),
    workspaceHistoryPaths: [],
    now: NOW,
  });
  expect(streamRows(view).flatMap((r) => r.panes).every((p) => !p.focused)).toBe(true);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/agent-rail-model.test.ts -t "focused"`
Expected: FAIL — `focused` is not a property of `RailPaneRow`.

- [ ] **Step 3: Implement**

`tabs-store.ts`, on `PaneView`:

```ts
  /**
   * This pane holds its TAB's keyboard focus — `activePaneId()` projected per
   * pane. Optional for the same reason `panes` itself is: a `PaneView` built
   * by a fixture predates the field. Whether the WINDOW is looking at that tab
   * is the rail model's AND, not this flag's (DL-27.22).
   */
  readonly focused?: boolean;
```

`tab-manager.ts`, inside `syncViews`'s `panes` projection (`paneId` is already
read above it):

```ts
          focused: id === paneId,
```

`agent-rail-model.ts`: add `readonly focused: boolean` to `RailPaneRow`, give
`paneRows` a fourth parameter `active: boolean`, and set
`focused: active && (pane.focused ?? false)`. `tabRow` passes `railTab.active`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/agent-rail-model.test.ts`
Expected: PASS, including the pre-existing cases.

---

### Task 2: Focus movement re-syncs the views

**Files:**
- Modify: `src/terminal/terminal-manager-types.ts`
- Modify: `src/terminal/terminal-manager.ts:145` (`setActive`)
- Modify: `src/terminal/tab-manager.ts` (the `ManagerCallbacks` literal)
- Test: `src/terminal/terminal-manager.test.ts`

**Why a new callback rather than patching call sites:** `onPaneFocus` is
suppressed while `inProgrammaticFocus` (so a rail click never reaches it),
gated on `windowFocused`, and only calls `syncViews()` when
`tracker.acknowledge` returns a CHANGED snapshot — which is `null` for a pane
with no pending attention. `activateForAttention`'s same-tab branch returns
before its own `syncViews()`. `setActive` is the one function every path goes
through and it already early-returns when the id is unchanged.

**Interfaces:**
- Produces: `ManagerCallbacks.onActivePaneChange?(id: number): void` — fired
  after `activeId` actually changes, never on a repeat.

- [ ] **Step 1: Write the failing test**

```ts
it("reports an active-pane change once per change", async () => {
  const { tm, onActivePaneChange } = setup();
  await tm.initFresh();
  const first = tm.activePaneId()!;
  onActivePaneChange.mockClear();
  await tm.splitPane("right");
  const second = tm.activePaneId()!;
  expect(second).not.toBe(first);
  expect(onActivePaneChange).toHaveBeenLastCalledWith(second);
  onActivePaneChange.mockClear();
  tm.focusPane(second);
  expect(onActivePaneChange).not.toHaveBeenCalled();
});
```

Add `onActivePaneChange` to `setup()`'s spies and to the `callbacks` literal,
and return it from `setup()`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/terminal/terminal-manager.test.ts -t "active-pane change"`
Expected: FAIL — the spy is never called.

- [ ] **Step 3: Implement**

`terminal-manager-types.ts`:

```ts
  /**
   * The manager's focused pane changed. Optional, and fired only on a real
   * change: the tab layer projects `activePaneId()` into `PaneView.focused`
   * and has no other way to learn that focus moved — `onPaneFocus` is
   * suppressed during programmatic focus and acks nothing when there is no
   * attention to clear (DL-27.22).
   */
  onActivePaneChange?(id: number): void;
```

`terminal-manager.ts`, at the end of `setActive` (after the overlay refresh):

```ts
    callbacks.onActivePaneChange?.(id);
```

`tab-manager.ts`, in the callbacks literal beside `onPaneFocus`:

```ts
    onActivePaneChange(): void {
      syncViews(); // the rail's focused row is a projection of activePaneId()
    },
```

- [ ] **Step 4: Run the suites**

Run: `npx vitest run src/terminal/terminal-manager.test.ts src/terminal/tab-manager.attention-focus.test.ts`
Expected: PASS.

---

### Task 3: The leaf wears the wash

**Files:**
- Modify: `src/ui/agent-rail.tsx` (the leaf render, ~line 370)
- Modify: `src/styles/04b-agent-rail-rows.css` (after `.asr-leaf:hover`)
- Modify: `docs/DESIGN-LANGUAGE.md` (new DL-27.22)
- Test: `src/ui/agent-rail.test.tsx`

**Interfaces:**
- Consumes: `RailPaneRow.focused` from Task 1.
- Produces: `.asr-leaf[data-focused="true"]`, and `aria-current="true"` on
  that leaf's `.asr-leaf__hit`.

- [ ] **Step 1: Write the failing test**

```tsx
it("washes the leaf of the focused pane and marks it aria-current", () => {
  render(<AgentRail {...props({ activeIndex: 0, panes: [1, 2], focusedPaneId: 2 })} />);
  const leaves = document.querySelectorAll(".asr-leaf");
  expect(leaves[0].getAttribute("data-focused")).toBe("false");
  expect(leaves[1].getAttribute("data-focused")).toBe("true");
  expect(leaves[1].querySelector(".asr-leaf__hit")?.getAttribute("aria-current")).toBe("true");
});
```

(Use the file's own existing fixture helper; the shape above is illustrative
of the assertions, not of the helper's name.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-rail.test.tsx -t "focused"`
Expected: FAIL — no `data-focused` attribute exists.

- [ ] **Step 3: Implement**

Component — on the `.asr-leaf` container add `data-focused={pane.focused}`,
and on its `.asr-leaf__hit` button `aria-current={pane.focused ? "true" : undefined}`.

CSS, declared AFTER `.asr-leaf:hover` so selection outranks hover (DL-21.2 —
equal specificity, so source order is what decides):

```css
/* DL-27.22 (owner, 2026-08-23): the row whose pane holds the keyboard carries
   DL-21.1's own wash. A multi-agent tab renders headless (DL-27.13), so its
   selection had nowhere to land and such a tab drew NO active row at all. The
   value is `--tab-active-bg` — the same one a tab row wears — because a tab
   with one agent marks the row and a tab with several marks the leaf: one
   signifier, at most one washed row in the rail. */
.asr-leaf[data-focused="true"] {
  background: var(--tab-active-bg);
}
```

`docs/DESIGN-LANGUAGE.md` — add DL-27.22 stating: the focused pane's row
carries DL-21.1's wash; it is the same value as the tab row's, never a second
signifier; at most one row in the rail carries it; a non-terminal surface on
the stage does not clear it.

- [ ] **Step 4: Run the gates**

Run: `npx vitest run src/ui/agent-rail.test.tsx scripts/design-language.test.ts`
Expected: PASS (the citation test resolves DL-27.22 to the new rule).

---

### Task 4: Records

**Files:**
- Modify: `AGENTS.md` (fork queue entry + drift row)
- Modify: `docs/CONTEXT.md` (one section)

- [ ] **Step 1: Fork entry** — DL-27.22 is new and `ManagerCallbacks` gained a
  member, so the change is fork-listed twice ("a rule in
  `docs/DESIGN-LANGUAGE.md`" and an R4 seam). Record the owner's decision, the
  rejected alternatives (patching `onPaneFocus` + `activateForAttention`; a
  second signifier for tab-vs-pane), and what was NOT touched (PTY, IPC,
  materialization, close coordination).
- [ ] **Step 2: Drift row** — "The rail marks the focused agent" →
  `building` / unverified until a host pass and the owner's eye review.
- [ ] **Step 3: `docs/CONTEXT.md`** — a dated section, in the file's own voice.

---

## Verification before claiming completion

```bash
npx tsc --noEmit
npx vitest run src/ui/agent-rail-model.test.ts src/ui/agent-rail.test.tsx \
  src/terminal/terminal-manager.test.ts src/terminal/tab-manager.attention-focus.test.ts \
  src/terminal/tabs-store.test.ts scripts/design-language.test.ts
npm run build
```

Concurrent sessions share this checkout: attribute any failure that does not
touch these files against a pristine `HEAD` worktree before reporting it.

**Owed after the code is green:** a native `npm run electron:dev` pass (nobody
has watched the mark follow focus in a running app) and the owner's eye review
of the wash on a leaf beside DL-27.19's frame.
