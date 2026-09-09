# Agent Board wiring — Task 5 (the surface and its action factory)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **Forks** and **Gates** first; they bind every
> task here.

---

### Task 5: `AgentBoardSurface` and its mount

Spec §4.1: the Board covers `.stage__surface` as the document and the browser do — over
the terminal grid, never replacing it, so taking the stage back costs no xterm reflow and
no PTY resize round-trip.

**Files:**

- Create: `src/ui/agent-board-surface.tsx`
- Create: `src/ui/agent-board-surface.test.tsx`
- Create: `src/ui/agent-board-actions.ts` — the injectable action factory (see Step 5)
- Create: `src/ui/agent-board-actions.test.ts`
- Modify: `src/ui/app.tsx` (the mount beside `<BrowserSurface …>`, the exclusion effect,
  the deps bag)
- Modify: `src/ui/app-policy.ts` — `browserPanelObscured` lives THERE
  (`app-policy.ts:18`), not in `app.tsx`; `app.tsx` only passes it a state object
- Modify: `src/styles/19-agent-board.css` (the surface frame)

**Interfaces:**

- Consumes: `AgentBoardView` as a PROP (`App` calls `useAgentBoardView()` once and shares
  the result with `boardPanelState`, so the panel and the grid cannot disagree);
  `agentBoardSurfaceActive`, `selectBoardCard`,
  `boardStatusFilter`, `boardProjectFilter`, `closeAgentBoard` from `./agent-board-store`;
  `AgentBoard`, `AgentBoardActions` from `./agent-board`; `BoardPanelState` from
  `./agent-board-panel`.
- Produces:

  ```ts
  export interface AgentBoardSurfaceProps {
    readonly view: AgentBoardView;
    readonly actions: BoardHostActions;
    readonly panel: BoardPanelState;
  }
  export function AgentBoardSurface(props: AgentBoardSurfaceProps): JSX.Element | null;
  ```

  Tasks 9–14 fill the remaining `actions` members from `App`.

- [x] **Step 1: Write the failing test**

Create `src/ui/agent-board-surface.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBoardSurface } from "./agent-board-surface";
import {
  agentBoardSurfaceActive,
  boardSelectedPaneId,
  boardStatusFilter,
  openAgentBoard,
  resetAgentBoardStore,
  stepAgentBoardBack,
} from "./agent-board-store";

const NOOP = {
  onOpenInStage: vi.fn(),
  onStop: vi.fn(),
  onRestart: vi.fn(),
  onClose: vi.fn(),
  onReply: vi.fn(),
  onNewAgent: vi.fn(),
};
const PANEL = {
  snapshot: null,
  replyEnabled: false,
  replyNotice: null,
  sending: false,
  paneExited: false,
};

// `view` is REQUIRED — there is no empty-input constant in this repo. `someView()`
// is a local helper in this file that calls `buildAgentBoard` with the fixture
// shape `src/ui/agent-board-model.test.ts` already builds (copy its `tab()`/`pane()`
// and its BASE input); import `buildAgentBoard` and the `AgentBoardView` type.
function mount(view: AgentBoardView) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(<AgentBoardSurface view={view} actions={NOOP} panel={PANEL} />, host);
  });
  return host;
}

describe("AgentBoardSurface", () => {
  beforeEach(() => resetAgentBoardStore());

  it("draws nothing while a terminal tab or another surface holds the stage", () => {
    expect(mount(someView()).querySelector(".agent-board")).toBeNull();
    openAgentBoard();
    stepAgentBoardBack();
    expect(mount(someView()).querySelector(".agent-board")).toBeNull();
  });

  it("covers the stage while the board holds it", () => {
    openAgentBoard();
    const host = mount(someView());
    expect(host.querySelector(".stage__surface--agent-board")).not.toBeNull();
    expect(host.querySelector(".agent-board")).not.toBeNull();
    expect(agentBoardSurfaceActive.value).toBe(true);
  });

  it("routes a nav press into the board's own filter signal", () => {
    openAgentBoard();
    const host = mount(someView());
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".board-nav__row")];
    const asked = rows.find((row) => row.textContent?.startsWith("Asked"));
    act(() => asked?.click());
    expect(boardStatusFilter.value).toBe("asked");
  });

  it("steps the board off the stage on Escape with no panel open", () => {
    // ONE Escape, not two. `agent-board.tsx`'s handler branches on
    // `view.selected`, and this suite's fixture view has no cards — so the
    // first press already takes the `else` arm and calls `onEscape`. The
    // two-press sequence (panel first, then the Board) belongs in
    // `agent-board.test.tsx`, where a view with a selected card is injected
    // directly; do not try to reproduce it here with an empty fixture.
    openAgentBoard();
    const host = mount(someView());
    act(() => {
      host
        .querySelector(".agent-board")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(agentBoardSurfaceActive.value).toBe(false);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-board-surface.test.tsx`
Expected: FAIL — module not found.

- [x] **Step 3: Write the surface**

Create `src/ui/agent-board-surface.tsx`:

```tsx
/**
 * The Agent Board ON the stage — the twin of `BrowserSurface`
 * (src/browser/browser-surface.tsx) and `StageSurface` (src/files/ui/).
 *
 * Same reasoning as those two: `App` has no render harness in this repo, so
 * the mount condition ("the Board holds the stage") lives in a component of
 * its own to be assertable. And the same geometry: the surface COVERS
 * `.stage__tabs` instead of unmounting it, so the terminal grid keeps its
 * measured size and taking the stage back costs no xterm reflow and no PTY
 * resize round-trip (spec §4.1).
 *
 * The three Board-local actions — select, both filters, Escape — are bound
 * here, because they move nothing outside the Board's own store. Everything
 * that reaches a pane (`onStop`, `onRestart`, `onClose`, `onOpenInStage`,
 * `onReply`, `onNewAgent`) is handed in by `App`, which owns the seams.
 */
import { AgentBoard, type AgentBoardActions } from "./agent-board";
import type { BoardPanelState } from "./agent-board-panel";
import {
  agentBoardSurfaceActive,
  boardProjectFilter,
  boardStatusFilter,
  selectBoardCard,
  stepAgentBoardBack,
} from "./agent-board-store";
import type { AgentBoardView } from "./agent-board-model";

/** The actions `App` owns — every one of them touches a pane or a tab. */
export type BoardHostActions = Pick<
  AgentBoardActions,
  "onOpenInStage" | "onStop" | "onRestart" | "onClose" | "onReply" | "onNewAgent"
>;

export interface AgentBoardSurfaceProps {
  /** Built by `App` (one call, shared with the panel state) — never here. */
  readonly view: AgentBoardView;
  readonly actions: BoardHostActions;
  readonly panel: BoardPanelState;
}

export function AgentBoardSurface(props: AgentBoardSurfaceProps) {
  if (!agentBoardSurfaceActive.value) {
    return null; // a terminal tab, a document or the browser holds the stage
  }
  const view = props.view;
  const actions: AgentBoardActions = {
    ...props.actions,
    onSelect: (card) => {
      // The held order is the order the user is LOOKING at (spec §5.2): a live
      // re-sort while a panel is open would move the card under the pointer.
      selectBoardCard(
        card?.paneId ?? null,
        view.cards.map((entry) => entry.paneId),
      );
    },
    onStatusFilter: (filter) => {
      boardStatusFilter.value = filter;
    },
    onProjectFilter: (key) => {
      boardProjectFilter.value = key;
    },
    // DL-34.9: the panel first, then the Board itself. The component sends
    // `onSelect(null)` for the first press and this only for the second.
    onEscape: () => stepAgentBoardBack(),
  };
  return (
    <div class="stage__surface stage__surface--agent-board">
      <AgentBoard view={view} actions={actions} panel={props.panel} />
    </div>
  );
}
```

**The surface never calls `useAgentBoardView`.** `App` calls it once and passes the same
`AgentBoardView` object to both this component and `boardPanelState`, so the panel and
the grid cannot disagree about which card is selected. That is also why the early return
above is unconditionally safe: there is no hook in this component at all.

- [x] **Step 4: Add the surface's own frame rule**

In `src/styles/19-agent-board.css`, at the top of the sheet under the header comment:

```css
/* The Board's rectangle on the stage (spec §4.1). `.stage__surface` already
   carries the position and insets the document uses; the Board only zeroes the
   padding, because its own nav and panel meet the surface's edges. */
.stage__surface--agent-board {
  padding: 0;
}
```

- [x] **Step 5: Mount it in `App`**

In `src/ui/app.tsx`, beside `<BrowserSurface …>`:

```tsx
          <AgentBoardSurface view={boardView} actions={boardActions} panel={boardPanel} />
```

`boardActions` and `boardPanel` come from a **new injectable module**, not from a literal
inside `App`. That is not decoration: **this repo has no `<App>` render harness** —
`src/ui/app.test.tsx` renders `DesktopChrome` and tests the pure predicates in
`app-policy.ts`, and `app-policy.ts` says so in its own comment. Behaviour written inline
in `App` is behaviour no test can reach, so every Board action lives in a factory that
takes its seams as arguments.

Create `src/ui/agent-board-actions.ts`:

```ts
import type { InjectOutcome } from "../prompts/inject";
import type { PtyClient } from "../terminal/pty-client";
import type { BoardHostActions } from "./agent-board-surface";
import type { BoardPanelState } from "./agent-board-panel";
import type { BoardCard } from "./agent-board-model";

/**
 * Everything the Board's actions reach, injected (spec §5.6, §7).
 *
 * `App` owns the instances; this module owns the RULES. Every member is the
 * narrowest slice of its seam that the Board actually calls, so a test hands
 * in four functions instead of a TabManager.
 */
/**
 * The tab-layer methods the Board calls, declared STRUCTURALLY rather than as
 * `Pick<TabManager, …>`.
 *
 * `Pick<T, K>` requires `K extends keyof T`, and four of these do not exist on
 * `TabManager` yet — `acknowledgePane` arrives in Task 9, `serializePane` and
 * `paneAlive` in Task 10, `restartPane` in Task 13. A `Pick` written here would
 * not compile in THIS task. Declared structurally, `TabManager` satisfies it as
 * each seam lands, and `App` can keep passing `tabsRef.current`.
 *
 * **Task 5 declares only the three that exist today.** Every later task adds
 * exactly the method it implements — the addition is part of that task, and
 * `tsc` proves the seam arrived.
 */
export interface BoardManagerSeams {
  activateForAttention(index: number, paneId: number): void;
  closePaneAt(index: number, paneId: number): Promise<void>;
  injectIntoPane(
    paneId: number,
    text: string,
    opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
  ): Promise<InjectOutcome>;
  // Task 9 adds `acknowledgePane`, Task 10 `serializePane` and `paneAlive`,
  // Task 13 `restartPane`. Do not declare them before their task.
}

export interface BoardActionDeps {
  readonly manager: BoardManagerSeams | null;
  /** `killForeground` is OPTIONAL on `PtyClient` — see Task 12. */
  readonly pty: Pick<PtyClient, "killForeground">;
  /**
   * Spec §4.4's empty-state control: it raises the TASK LAUNCHER for the active
   * workspace, not a bare new tab. `App` binds it to its own
   * `openTaskLauncher(workspacePath)` (`app.tsx`, near `toggleQuickLaunch`)
   * with `tabsRef.current?.activeWorkspacePath() ?? null`.
   */
  readonly openTaskLauncher: () => void;
  /** Notice + in-flight state; `App` holds the signals, this writes them. */
  readonly setNotice: (notice: string | null) => void;
  readonly setSending: (sending: boolean) => void;
  readonly isSending: () => boolean;
  readonly clearSelection: () => void;
  readonly selectedPaneId: () => number | null;
}

export function createBoardActions(deps: BoardActionDeps): BoardHostActions {
  // Every member but `onNewAgent` is a no-op here and is filled by the task
  // that owns its seam: reply (11), Stop (12), Restart (13), stage/Close (14).
  return {
    onOpenInStage: () => {},
    onStop: () => {},
    onRestart: () => {},
    onClose: () => {},
    onReply: () => {},
    onNewAgent: () => deps.openTaskLauncher(),
  };
}

/**
 * The panel's live state for the selected card (spec §7). Task 10 fills the
 * snapshot, Task 11 the reply fields; a null card is the closed panel.
 */
export function boardPanelState(deps: BoardActionDeps, card: BoardCard | null): BoardPanelState {
  return {
    snapshot: null,
    replyEnabled: false,
    replyNotice: null,
    sending: card === null ? false : deps.isSending(),
    paneExited: false,
  };
}
```

with one test in `src/ui/agent-board-actions.test.ts` proving the only member this task
implements:

```ts
it("routes New agent to the task launcher, not to a bare new tab", () => {
  const openTaskLauncher = vi.fn();
  createBoardActions(fakeDeps({ openTaskLauncher })).onNewAgent();
  expect(openTaskLauncher).toHaveBeenCalledTimes(1);
});
```

where `fakeDeps(overrides)` is a local helper in that new test file returning a full
`BoardActionDeps` of `vi.fn()`s — write it once here; Tasks 11–14 extend it.

and in `App`:

```tsx
  const boardNotice = useSignal<string | null>(null);
  const boardSending = useSignal(false);
  const boardView = useAgentBoardView();
  const boardDeps: BoardActionDeps = {
    manager: tabsRef.current,
    pty: defaultPtyClient,
    openTaskLauncher: () => openTaskLauncher(tabsRef.current?.activeWorkspacePath() ?? null),
    setNotice: (notice) => (boardNotice.value = notice),
    setSending: (sending) => (boardSending.value = sending),
    isSending: () => boardSending.value,
    clearSelection: () => selectBoardCard(null, []),
    selectedPaneId: () => boardSelectedPaneId.value,
  };
  const boardActions = createBoardActions(boardDeps);
  const boardPanel = boardPanelState(boardDeps, boardView.selected);
```

The surface takes `view` as a prop from here rather than calling the hook itself, so the
panel state and the rendered grid can never disagree about which card is selected. Adjust
`AgentBoardSurfaceProps` accordingly: `{ view, actions, panel }`.

Add the exclusion effect beside the file/browser one (`App`'s existing
`activeFileTab.value !== null && browserSurfaceActive.value` guard — find it by that
expression, not by line number). That effect exists because a click reaching one store
directly — an explorer row, a chip — never goes through `composeSurfaceStrip`'s mutual
exclusion, and the Board needs the same backstop.

**One effect, and the Board yields.** The winner is stated rather than left to whichever
signal moved last: a document and the browser are opened by naming a THING (a file, a
page) and the Board by naming a VIEW, so the Board is the one that steps back. Do not
write the mirror image — a Board that won here would close the document the user just
opened.



```ts
  useSignalEffect(() => {
    if (!agentBoardSurfaceActive.value) return;
    // The Board yields to a document or the browser, because those two are
    // opened by naming a THING (a file, a page) and the Board is opened by
    // naming a view. Both stores are read here and neither imports the other.
    if (browserSurfaceActive.value || activeFileTab.value !== null) {
      stepAgentBoardBack();
    }
  });
```

and let `composeSurfaceStrip.activate()` (Task 1) go on doing the other direction, which
it already does for every path that speaks the strip's index space.

Add the zero-tab rule as its own effect (spec §4.2, and what makes Task 8's journal rule
true at runtime):

```ts
  useSignalEffect(() => {
    // Zero tabs = no Board. `disposeTab`'s empty branch activates surface 0
    // when `surfaces.total() > 0`, so a Board left open would take the stage
    // where the Open board belongs — and the chord is `scope: "pane"`, so
    // nothing could leave it. Closing the chip here keeps `total()` honest
    // WITHOUT touching close coordination, which is a fork this plan does not
    // open.
    if (tabViews.value.length === 0 && agentBoardOpen.value) {
      closeAgentBoard();
    }
  });
```

and add the Board to `browserPanelObscured`'s call, so the native `WebContentsView` can
never paint over it:

```ts
      // A DOM surface cannot cover a native view: with the Board on the stage
      // the browser's view must go, or the Board draws underneath it.
      agentBoardActive: agentBoardSurfaceActive.value,
```

Add the field to `browserPanelObscured`'s input type in its own module and OR it into the
result there — one predicate, one place.

- [x] **Step 5b: Close the exclusion hole Task 1 left in `selectBrowserTab`**

Task 1 shipped `selectAgentBoardTab` clearing both other surfaces, but left
`selectBrowserTab` (`app.tsx`, near `closeBrowserTab`) as it was:

```ts
  const selectBrowserTab = (): void => {
    if (browserSurfaceActive.value) return;
    fileController.deactivate();
    activateBrowserSurface();
    tabsRef.current?.notifySurfacesChanged();
  };
```

That asymmetry goes live the moment the chord exists, and it is not cosmetic. With the
Board on the stage, a click on the browser chip leaves **both** `agentBoardSurfaceActive`
and `browserSurfaceActive` true, and `composeSurfaceStrip` tests the board FIRST in both
`activeIndex()` and `close()` (as shipped) — so the strip highlights the Board's chip
while the browser is on screen, and **⌘W closes the Board's chip while the user is
looking at the browser**. Once Step 5 teaches `browserPanelObscured` about the Board, the
native view is hidden too and the click yields a blank stage.

The effect above is a backstop that fixes it one frame late. Make the synchronous path
symmetric instead:

```ts
  const selectBrowserTab = (): void => {
    if (browserSurfaceActive.value) return;
    fileController.deactivate();
    // Symmetric with `selectAgentBoardTab`: exactly one surface owns the
    // stage, and a chip press is a synchronous path that must keep it so.
    stepAgentBoardBack();
    activateBrowserSurface();
    tabsRef.current?.notifySurfacesChanged();
  };
```

widening `app.tsx`'s `agent-board-store` import to include `stepAgentBoardBack`. Pin it
with one case in `src/ui/stage-surface-strip.test.ts` proving the two flags are never
both true after either chip's press.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/ui/agent-board-surface.test.tsx src/ui/app.test.tsx src/ui/agent-board.test.tsx`
Expected: PASS.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/agent-board-surface.tsx src/ui/agent-board-surface.test.tsx src/ui/app.tsx src/styles/19-agent-board.css
git add src/ui/agent-board-surface.tsx src/ui/agent-board-surface.test.tsx src/ui/app.tsx src/styles/19-agent-board.css
git commit -m "feat(board): mount the board on the stage

Spec §4.1: the Board covers .stage__surface the way the document and the
browser do, over the terminal grid rather than replacing it, so taking the
stage back costs no xterm reflow and no PTY resize round-trip. The mount
condition lives in a component because App has no render harness here.

The three Board-local actions — select, both filters, the second Escape — bind
here; everything that reaches a pane stays App's. The exclusion effect and
browserPanelObscured gain the Board for the reason the browser needed both: a
DOM surface cannot cover a native WebContentsView.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
