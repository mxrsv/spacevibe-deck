# Agent Board wiring — Tasks 6–7 (the toggle, the sidebar and the dock)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **The test harness — the real one**, **Forks**
> and **Gates** first.

---

### Task 6: The toggle — action, chord, menu, host predicate

Spec §4.2. `⌘⇧O` / `Ctrl+Shift+O`; `o` is unbound in BOTH keymaps at this HEAD (verified
2026-09-04 — `b` is `toggle-explorer`, `y` is `toggle-sessions`, `j` is `toggle-dock`).

**Files:**

- Modify: `src/terminal/action-registry.ts`
- Modify: `src/terminal/default-keymaps.ts`
- Modify: `src/terminal/action-performable.ts`
- Modify: `src/terminal/tab-manager.ts` — **not `app.tsx`**. `performableContext()` is
  `tab-manager.ts:1995` and `handleShortcut` is `:2222`; an action's handler is an entry
  in an object literal (`:1861` `"toggle-explorer": () => {`), not a `switch` case. It
  has to live there anyway: the toggle needs `syncViews()` and `activeManager()`, both
  closure-local.
- Modify: `src/terminal/tab-action-scope.ts:39` — `COMMAND_ACTIONS`, which feeds
  `DISPATCHABLE_ACTIONS`. **A chord bound to an action that is not in that list fails
  `src/terminal/dispatch-coverage.test.ts:18`**, which filters every keymap action by
  `!DISPATCHABLE_ACTIONS.has(action)`.
- Modify: `src/terminal/action-registry.test.ts:105` — the count assertion reads
  `it("has exactly the 54 action ids including updater menu actions")` with a hardcoded
  `expect(ids).toEqual(new Set([…]))`. **Adding an action turns it red**: update the
  count to 55, add `"toggle-agent-board"` to the set, and change the sentence.
- Modify: **`src-tauri/src/menu_registry.rs`** — that is what `npm run generate:menu`
  writes. **`electron/menu.ts` is NOT generated** and must not be staged: its own header
  says Electron's main process imports `ACTION_REGISTRY` and derives the menu at RUNTIME,
  because it can import TypeScript where Rust could not. R3 still holds — one source of
  truth, one fewer generated artifact.
- Modify: `src/ui/settings/shortcut-groups.ts` — its `PLACEMENT` map has no fallback and
  `shortcut-groups.test.ts` asserts the `other` group is empty, so a new registry id turns
  it red. Add `"toggle-agent-board": "app"` beside `toggle-browser`.
- Modify: `src/terminal/tab-manager.ts`'s `isSurfaceRoutedAction` — see the step below;
  without it the chord is ONE-WAY.
- Test: `src/terminal/action-registry.test.ts`, `src/terminal/action-performable.test.ts`,
  `src/terminal/dispatch-coverage.test.ts`, `src/ui/settings/shortcut-groups.test.ts`,
  `src/terminal/tab-manager.file-surfaces.test.ts` (the only suite with `fakeSurfaces`).
  **`src/terminal/default-keymaps.test.ts` does not exist** — the keymap assertions live
  in `action-registry.test.ts`, which re-exports both maps and already holds
  `binds toggle-explorer on both platforms without colliding`. Put yours there, in that
  sibling's exact shape.

**Interfaces:**

- Produces: the `ShortcutAction` member `"toggle-agent-board"`; a new optional
  `PerformableContext` field `hostHasAgentBoard?: boolean`.

- [x] **Step 1: Write the failing tests**

Append to `src/terminal/action-performable.test.ts`:

```ts
describe("toggle-agent-board", () => {
  it("consumes the chord on a host that has the Board", () => {
    expect(
      isActionPerformable("toggle-agent-board", {
        stageOwner: "terminal",
        hasSelection: false,
        hostHasAgentBoard: true,
      }),
    ).toBe(true);
  });
  it("leaves the keystroke alone on a host that does not (Tauri)", () => {
    expect(
      isActionPerformable("toggle-agent-board", {
        stageOwner: "terminal",
        hasSelection: false,
        hostHasAgentBoard: false,
      }),
    ).toBe(false);
    // Absent reads as absent: a context literal written before this field
    // must not start consuming a chord it never claimed.
    expect(
      isActionPerformable("toggle-agent-board", { stageOwner: "terminal", hasSelection: false }),
    ).toBe(false);
  });
});
```

Append to `src/terminal/action-registry.test.ts`, beside its existing
`binds toggle-explorer on both platforms without colliding`:

```ts
it("binds the agent board to Cmd+Shift+O and Ctrl+Shift+O, and to nothing else", () => {
  const mac = MACOS_KEYMAP.filter((binding) => binding.action === "toggle-agent-board");
  expect(mac).toEqual([{ key: "o", meta: true, shift: true, action: "toggle-agent-board" }]);
  const windows = WINDOWS_KEYMAP.filter((binding) => binding.action === "toggle-agent-board");
  expect(windows).toEqual([{ key: "o", ctrl: true, shift: true, action: "toggle-agent-board" }]);
  // `o` was free in both maps when this landed; a second claimant is a conflict.
  expect(MACOS_KEYMAP.filter((b) => b.key === "o" && b.meta && b.shift).length).toBe(1);
  expect(WINDOWS_KEYMAP.filter((b) => b.key === "o" && b.ctrl && b.shift).length).toBe(1);
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/terminal/action-performable.test.ts src/terminal/action-registry.test.ts`
Expected: FAIL — `"toggle-agent-board"` is not a `ShortcutAction`.

- [x] **Step 3: Register the action**

In `src/terminal/action-registry.ts`, beside `toggle-explorer`:

```ts
  {
    id: "toggle-agent-board",
    label: "Agent Board",
    // Tier "pane", the same reasoning `toggle-browser` and `toggle-explorer`
    // carry: the Board is a stage surface, and every overlay covers the stage.
    scope: "pane",
    menu: { submenu: "View", group: "explorer" },
  },
```

- [x] **Step 4: Bind the chord**

In `src/terminal/default-keymaps.ts`, in each map beside its `toggle-explorer` line:

```ts
  { key: "o", meta: true, shift: true, action: "toggle-agent-board" },
```

```ts
  { key: "o", ctrl: true, shift: true, action: "toggle-agent-board" },
```

- [x] **Step 5: Gate it on the host**

In `src/terminal/action-performable.ts`, add the field and the predicate:

```ts
  /**
   * Whether THIS host can show the Agent Board (spec §4.2, §13).
   *
   * The Board needs `session_tail`, `git_repository` and the new
   * `pty_kill_foreground` channel, none of which exist under Tauri — so the
   * chord must not be consumed there, or ⌘⇧O would die in the renderer
   * instead of reaching the terminal. Optional so every context literal
   * written before this keeps compiling; absent reads as "no Board", the
   * direction that does not consume.
   */
  readonly hostHasAgentBoard?: boolean;
```

```ts
  ["toggle-agent-board", (context) => context.hostHasAgentBoard === true],
```

- [x] **Step 6: Answer the predicate and handle the action, both in `tab-manager.ts`**

In `performableContext()` (`:1995`), beside the line that already reads
`surfaceCanToggleView: surfaces.canToggleView?.() ?? false,`:

```ts
      // `__deckHost` presence — the same one-line tell five modules in
      // `src/host/` already use (e.g. `worktree-host.ts:19`). An unanswered
      // host is a third state, and here it means "no Board", which is the
      // direction that does not consume the chord.
      hostHasAgentBoard: (globalThis as { __deckHost?: unknown }).__deckHost !== undefined,
```

(`hasDeckHost()` is private to `src/updater/electron-updater-adapter.ts:46` — do not
import it.)

Add the handler to the command table beside `"toggle-browser"` (`:1818`), copying its
three closing lines exactly — **the chord must return focus to the terminal** (spec §4.2:
"it steps back to the terminal — `toggle-browser`'s own behaviour, deactivate then
`focusActive()`"):

```ts
    "toggle-agent-board": () => {
      if (agentBoardSurfaceActive.value) {
        stepAgentBoardBack();
        // `syncViews()` because TabManager's derived views cannot see a
        // store-signal transition on their own; `focusActive()` because the
        // keyboard has to land somewhere, and the terminal is where it came
        // from. Both copied from `toggle-browser`'s own close branch.
        syncViews();
        activeManager()?.focusActive();
        return;
      }
      // Exactly one surface owns the stage, and this is a synchronous path
      // that keeps it so: the chord reaches the store directly, never through
      // `composeSurfaceStrip.activate`, so it must clear the others itself.
      //
      // `surfaces.deactivate()` alone — it already steps the browser back
      // through the client the strip was INJECTED with, and calling
      // `deactivateBrowserSurface(defaultBrowserClient)` here as well would
      // reach past that injection to the real client, which a test cannot
      // stand in for.
      //
      // Two separate reasons the order is deactivate-THEN-open, and they are
      // not the same reason (proven by mutation, Task 6):
      //
      // 1. The deactivate cannot be OMITTED. Without it a document keeps
      //    `activeFileTab`, two surfaces read active, and App's "the Board
      //    yields" backstop steps the Board straight off again.
      // 2. The deactivate cannot come SECOND — but not because of that
      //    effect. `useSignalEffect` defers to an animation frame
      //    (`app.tsx`'s own comment says so), and `files.deactivate()` clears
      //    `activeFileTab` synchronously, so by the time the effect runs its
      //    guard is false either way and the order is invisible to it. What
      //    the order breaks is `composeSurfaceStrip.deactivate()` itself: it
      //    runs `stepBoardBack()` FIRST, so open-then-deactivate raises the
      //    Board and takes it down again inside this one dispatch.
      //
      // A test against a bare `FileSurfaceController` catches (1) only; one
      // through the composed strip catches (2). Both are needed.
      surfaces.deactivate();
      openAgentBoard();
      syncViews();
    },
```

- [x] **Step 6a: Route the chord to the surface, or it only opens**

`isSurfaceRoutedAction` in `tab-manager.ts` is what `overlayBlocksAction` consults, and
`composeSurfaceStrip.activeIndex()` answers `boardIndex()` — a NON-NEGATIVE index —
while the Board holds the stage. So without an entry there, the surface guard blocks the
CLOSE branch: **⌘⇧O would open the Board and never close it**, and would also be blocked
from opening over a document. Add `"toggle-agent-board"` beside the others and update the
function's own "exactly these N" doc comment.

This is the single most important line in the task. Pin it with a case that sets the fake
surface's `activeIndexValue` to `0` **after** `init()` — `materialize()` calls
`surfaces.deactivate()`, which resets the fake to `-1`, so a case that sets it earlier is
not reproducing production at all.

- [x] **Step 6b: Make the action dispatchable, and fix the count**

Add `"toggle-agent-board"` to `COMMAND_ACTIONS` in `src/terminal/tab-action-scope.ts`
beside the other view toggles, and update `src/terminal/action-registry.test.ts:105` —
the count 54 → 55 and the id into its hardcoded set. Both are gates that go red the
moment the registry grows; neither is optional and neither is "someone else's failure".

- [x] **Step 7: Regenerate the menu (R3)**

Run: `npm run generate:menu && npm run generate:menu:check`
Expected: the second command exits 0, and the diff is in **`src-tauri/src/menu_registry.rs`**
(View gains `Agent Board` / `CmdOrCtrl+Shift+O`). Never hand-edit that file.

- [x] **Step 8: Run the tests**

Run: `npx vitest run src/terminal/action-registry.test.ts src/terminal/action-performable.test.ts src/terminal/dispatch-coverage.test.ts src/ui/settings/shortcut-groups.test.ts src/terminal/tab-manager.file-surfaces.test.ts src/ui/app.test.tsx`
Expected: PASS. (`app.test.tsx` asserts the registry's tier ranks, so it reads the new
row too.)

- [x] **Step 9: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx tsc -p tsconfig.electron.json --noEmit
npx prettier --check src/terminal/action-registry.ts src/terminal/default-keymaps.ts src/terminal/action-performable.ts src/terminal/tab-manager.ts src/ui/settings/shortcut-groups.ts
git add src/terminal/action-registry.ts src/terminal/action-registry.test.ts \
        src/terminal/tab-action-scope.ts src/terminal/default-keymaps.ts \
        src/terminal/action-performable.ts src/terminal/action-performable.test.ts \
        src/terminal/tab-manager.ts src/terminal/tab-manager.file-surfaces.test.ts \
        src/ui/settings/shortcut-groups.ts src-tauri/src/menu_registry.rs
git commit -m "feat(board): open the board with Cmd+Shift+O

Spec §4.2. 'o' was unbound in both keymaps; the action is scope 'pane' like
every other stage-surface toggle, and it is performable-gated on
hostHasAgentBoard so Tauri — which has neither session_tail nor
git_repository nor the kill channel — never consumes the keystroke and it
reaches the terminal instead. Menu regenerated (R3).

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 7: The sidebar and the dock go while the Board holds the stage

DL-34.1 and spec §4.2: the Board produces DL-18.9's hidden sidebar **transiently** —
never writing `sidebarCollapsed`, and omitting the strip-mounted `SidebarToggle`
meanwhile. Leaving the Board restores whatever the user had.

**Files:**

- Modify: `src/ui/app-policy.ts:111-168` (`SidebarVisibilityState`,
  `sidebarEffectivelyCollapsed`, `DockVisibilityState`, `dockVisible`, `dockPaintedOpen`)
- Modify: `src/ui/app.tsx` — `effectiveSidebarCollapsed`'s literal, `sidebarPaintWidth`,
  and the `dockState` literal (by identifier: this file's line numbers have drifted)
- Test: `src/ui/app.test.tsx` — which already imports both predicates

**Interfaces:**

- Consumes: `agentBoardSurfaceActive`; `SIDEBAR_HIDDEN_WIDTH` from `./panel-resize`.
- Produces: one more field on **both** `SidebarVisibilityState` and
  `DockVisibilityState` — `agentBoardActive: boolean`. Every existing caller of either
  predicate must pass it; `tsc` finds them all.

**Decision this task records (spec §15 leaves it open):** while the Board holds the
stage, `SidebarToggle` is **not drawn at all**. It is the control that un-hides the
sidebar, and the Board's hiding is not the user's — offering the control would let one
click produce a state neither the user nor the Board asked for, and DL-34.1 already says
the toggle is omitted. Leaving the Board brings both back in one step.

**The seam is the spec's, not a new one.** Spec §4.2 names it: `SidebarVisibilityState`
gains one field beside `liveTabCount`. That matters because
`sidebarEffectivelyCollapsed` has three readers in `app.tsx` — the paint width, the frame
row's `SidebarFrameActions` (`app.tsx:1950`, `railAvailable && !effectiveSidebarCollapsed()`)
and the rail mount — and branching only the WIDTH would leave the frame row drawn over a
sidebar that is not there.

- [x] **Step 1: Write the failing test**

Append to `src/ui/app.test.tsx`, beside its existing `sidebarEffectivelyCollapsed` cases
(this repo tests App behaviour as pure policy — there is no `<App>` render harness, and
`app-policy.ts` says so in its own comment):

```ts
describe("the sidebar under the agent board", () => {
  it("collapses while the board holds the stage, whatever the user's own state", () => {
    expect(
      sidebarEffectivelyCollapsed({
        liveTabCount: 3,
        savedCollapsed: false,
        dragCollapsed: null,
        agentBoardActive: true,
      }),
    ).toBe(true);
  });
  it("gives the user's own state straight back when the board leaves", () => {
    expect(
      sidebarEffectivelyCollapsed({
        liveTabCount: 3,
        savedCollapsed: false,
        dragCollapsed: null,
        agentBoardActive: false,
      }),
    ).toBe(false);
  });
  it("does not let the board's hiding outrank a drag the user is making", () => {
    // A drag in flight is the user's hand on the seam; the Board is not on the
    // stage during one, but the ordering is stated rather than left to luck.
    expect(
      sidebarEffectivelyCollapsed({
        liveTabCount: 3,
        savedCollapsed: false,
        dragCollapsed: false,
        agentBoardActive: true,
      }),
    ).toBe(true);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/app.test.tsx -t "agent board"`
Expected: FAIL — `agentBoardActive` is not a field of `SidebarVisibilityState`.

- [x] **Step 3: Add the field to the policy**

In `src/ui/app-policy.ts`:

```ts
interface SidebarVisibilityState {
  readonly liveTabCount: number;
  readonly savedCollapsed: boolean;
  readonly dragCollapsed: boolean | null;
  /**
   * The Agent Board holds the stage (DL-34.1). A SURFACE's doing, never the
   * user's — which is why it is read here and never written to
   * `sidebarCollapsed`: the hiding must not survive the surface.
   */
  readonly agentBoardActive: boolean;
}
```

```ts
export function sidebarEffectivelyCollapsed(state: SidebarVisibilityState): boolean {
  if (!liveRailAvailable(state.liveTabCount)) {
    return true;
  }
  // DL-34.1, and it outranks the drag: the column is not on screen to drag.
  if (state.agentBoardActive) {
    return true;
  }
  return state.dragCollapsed ?? state.savedCollapsed;
}
```

Pass `agentBoardActive: agentBoardSurfaceActive.value` at the ONE call site — `App`'s
`const effectiveSidebarCollapsed = () => sidebarEffectivelyCollapsed({…})`. That single
change reaches all three readers: the rail mount, the frame-row `SidebarFrameActions`
branch (`railAvailable && !effectiveSidebarCollapsed()`) and the `SidebarToggle` branch
(`railAvailable && effectiveSidebarCollapsed()`).

`sidebarPaintWidth` does NOT call the predicate — it reads `settings.value.sidebarCollapsed`
directly — so it needs its own early return:

```ts
  const sidebarPaintWidth = (): number => {
    // DL-34.1: the Board's hiding is the SURFACE's, never written to
    // `sidebarCollapsed`. Reading it as a branch here rather than as a
    // settings write is the whole difference between "the Board hid it" and
    // "the user collapsed it".
    if (agentBoardSurfaceActive.value) {
      return SIDEBAR_HIDDEN_WIDTH;
    }
    return … // the existing expression, unchanged
  };
```

**And the toggle now needs a guard it did not before — the predicate change is what
creates the problem.** `app.tsx:2112` is
`railAvailable && effectiveSidebarCollapsed() ? <SidebarToggle collapsed …>`, so making
the predicate answer `true` turns that branch ON and RENDERS the control DL-34.1 says to
omit. Guard it:

```tsx
              {railAvailable && effectiveSidebarCollapsed() && !agentBoardSurfaceActive.value ? (
                <SidebarToggle collapsed onToggle={toggleSidebarCollapsed} />
              ) : null}
```

The frame row's other arm needs nothing: `railAvailable && !effectiveSidebarCollapsed()`
goes false on its own, which is what removes `SidebarFrameActions`. **Verify both in the
browser during Task 15's native pass** rather than asserting them from the plan.

- [x] **Step 4: Leave the dock unpainted**

DL-34.1: "leaving the dock unpainted as the Open Board does". **Two predicates, and the
one that actually paints is `dockPaintedOpen`** — `dockVisible` is read twice in `App`
for a different question, while `dockPaintedOpen` feeds `useDockPresence`, the
`stage--dock` inset class and `<DockPanel>` itself. Patch both; the field only has to be
declared once, because `DockPaintState extends DockVisibilityState`
(`app-policy.ts:165`).

```ts
interface DockVisibilityState {
  readonly boardOpen: boolean;
  readonly dockOpen: boolean;
  /** The Agent Board holds the stage (DL-34.1) — same argument as `boardOpen`. */
  readonly agentBoardActive: boolean;
}
```

```ts
export function dockVisible(state: DockVisibilityState): boolean {
  return state.dockOpen && !state.boardOpen && !state.agentBoardActive;
}
```

```ts
export function dockPaintedOpen(state: DockPaintState): boolean {
  // DL-34.1: the Agent Board leaves the dock unpainted exactly as the Open
  // Board does — both cover the stage, and a docked column beside a covering
  // surface is a column about a thing nobody can see.
  if (state.boardOpen || state.agentBoardActive) {
    return false;
  }
  return state.dragCollapsed === null ? state.dockOpen : !state.dragCollapsed;
}
```

**`dockToggleOnStage` needs its own term too** — this plan omitted it, and Task 7's
implementer found why it matters. The function is
`!state.boardOpen && !dockVisible(state)`, so suppressing the column through `dockVisible`
alone flips `!dockVisible` TRUE, which raises `stripDockToggle` the moment
`dockPresence.mounted` drops: a live `DockToggle` in a strip that is still visible over
`.stage__surface`. Pressing it runs `toggle-dock`, which **writes `dockOpen`** — a settings
write caused by a surface state, the one thing this task exists to forbid. Its own docblock
already makes that argument for `boardOpen`; extend it rather than adding a second one:

```ts
export function dockToggleOnStage(state: DockVisibilityState): boolean {
  return !state.boardOpen && !state.agentBoardActive && !dockVisible(state);
}
```

Then add `agentBoardActive: agentBoardSurfaceActive.value` to the `dockState` literal in
`App` that feeds `dockPaintedOpen` and `dockToggleOnStage`, and to the two `dockVisible`
calls. `tsc` finds every one. Assertions in `src/ui/app.test.tsx`, which already imports
both predicates:

```ts
it("leaves the dock unpainted while the agent board holds the stage", () => {
  const base = { dockOpen: true, boardOpen: false, dragCollapsed: null };
  expect(dockPaintedOpen({ ...base, agentBoardActive: true })).toBe(false);
  expect(dockPaintedOpen({ ...base, agentBoardActive: false })).toBe(true);
  expect(dockVisible({ dockOpen: true, boardOpen: false, agentBoardActive: true })).toBe(false);
});
```

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/ui/app.test.tsx src/ui/agent-board-surface.test.tsx`
Expected: PASS.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/app.tsx src/ui/app-policy.ts src/ui/app.test.tsx
git add src/ui/app.tsx src/ui/app-policy.ts src/ui/app.test.tsx
git commit -m "feat(board): hide the sidebar and the dock while the board holds the stage

DL-34.1. The width is a branch, not a settings write: the hiding belongs to
the surface and must not survive it, which is the whole difference between
'the Board hid it' and 'the user collapsed it'. SidebarToggle is omitted
meanwhile rather than drawn — it is the control that un-hides, and one click
would otherwise produce a state neither the user nor the Board asked for.
Spec §15's open question, answered.

The dock joins dockVisible's existing predicate rather than getting a second
one: DL-34.1 points at the Open Board as the precedent, and that is the branch
already in there.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
