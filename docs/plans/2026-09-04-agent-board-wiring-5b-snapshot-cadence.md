# Agent Board wiring — Task 11b (the snapshot's refresh cadence)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **The test harness — the real one**, **Forks**
> and **Gates** first. Runs after Task 11.

---

### Task 11b: the snapshot refreshes while the agent works

**This task exists because the plan dropped a spec requirement, and Task 10's implementer
found it.** Spec §7.3, in its own words: the snapshot is

> refreshed on a throttle while the pane is `working` (the specimen sets it; ~500 ms is
> the working figure) and on every `changedAt` otherwise.

Nothing in this plan builds that. `boardPanelState` reads the buffer during `App`'s
render, so the cadence is whatever re-renders `App` — which is **incidental in both
directions**:

- It re-reads while the Board is **off the stage**, because `stepAgentBoardBack`
  deliberately keeps the selection so ⌘⇧O returns to the same panel. Work for nothing.
- It does **not** re-read when the selected pane is in the **active tab** and streams
  output — `unread` marking is background-only, so that output fires no `syncViews` and
  no signal the render reads changes.

The second one is the Board's own core case: select a card, watch the agent work. A
snapshot frozen there is the feature failing at exactly the thing it exists for.

**Files:**

- Modify: `src/ui/agent-board-store.ts` — one signal, one tick
- Modify: `src/ui/agent-board-actions.ts` — `boardPanelState` reads it
- Modify: `src/ui/app.tsx` — install the effect that drives the tick
- Test: `src/ui/agent-board-store.test.ts`, `src/ui/agent-board-actions.test.ts`

**Interfaces:**

- Produces:

  ```ts
  /** Bumped whenever the panel's snapshot should be re-read (spec §7.3). */
  export const boardSnapshotTick: Signal<number>;
  export function installSnapshotRefresh(deps: SnapshotRefreshDeps): () => void;
  ```

- [x] **Step 1: Write the failing test**

In `src/ui/agent-board-store.test.ts`:

```ts
describe("the snapshot's refresh cadence", () => {
  it("ticks on a throttle while the selected pane is working", () => {
    vi.useFakeTimers();
    try {
      const stop = installSnapshotRefresh({
        selectedPaneId: () => 11,
        paneState: () => "working",
        onStage: () => true,
      });
      const first = boardSnapshotTick.value;
      vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 2);
      expect(boardSnapshotTick.value).toBeGreaterThan(first);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT tick while the board is off the stage", () => {
    // `stepAgentBoardBack` keeps the selection so the chord returns to the
    // same panel — so a selection alone must not keep a timer running for a
    // panel nobody can see. DL-1.2 bans a loop while the user is idle.
    vi.useFakeTimers();
    try {
      const stop = installSnapshotRefresh({
        selectedPaneId: () => 11,
        paneState: () => "working",
        onStage: () => false,
      });
      const first = boardSnapshotTick.value;
      vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
      expect(boardSnapshotTick.value).toBe(first);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT tick on a throttle for a pane that is not working", () => {
    // Spec §7.3: `changedAt` drives a quiet pane, not a timer. A `done` pane
    // that ticked twice a second would be a loop with nothing to show.
    vi.useFakeTimers();
    try {
      const stop = installSnapshotRefresh({
        selectedPaneId: () => 11,
        paneState: () => "done",
        onStage: () => true,
      });
      const first = boardSnapshotTick.value;
      vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
      expect(boardSnapshotTick.value).toBe(first);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops when disposed", () => {
    vi.useFakeTimers();
    try {
      const stop = installSnapshotRefresh({
        selectedPaneId: () => 11,
        paneState: () => "working",
        onStage: () => true,
      });
      stop();
      const first = boardSnapshotTick.value;
      vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
      expect(boardSnapshotTick.value).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-board-store.test.ts`
Expected: FAIL — `installSnapshotRefresh` is not exported.

- [x] **Step 3: Write the tick**

In `src/ui/agent-board-store.ts`:

```ts
/**
 * How often the panel re-reads a WORKING pane's scrollback (spec §7.3).
 *
 * 500ms is the spec's own working figure. It is a read of an in-memory xterm
 * buffer plus a string strip — no IPC, no PTY — so the cost is a render, and
 * the alternative is a panel that lies about what the agent is doing.
 */
export const SNAPSHOT_THROTTLE_MS = 500;

/**
 * Bumped whenever the panel's snapshot should be re-read.
 *
 * A tick rather than the text itself: the buffer lives in the terminal layer
 * and `boardPanelState` already knows how to ask for it, so this signal only
 * has to say WHEN. Reading it inside `boardPanelState` is what makes the
 * render depend on it.
 */
export const boardSnapshotTick = signal(0);

export interface SnapshotRefreshDeps {
  readonly selectedPaneId: () => number | null;
  /** The selected card's state — only `working` earns the timer. */
  readonly paneState: () => string | null;
  /** Whether the Board actually holds the stage. */
  readonly onStage: () => boolean;
}

/**
 * Drive the snapshot's cadence, and return a disposer.
 *
 * Three conditions, all required, and each one is a rule rather than a
 * precaution: a pane must be SELECTED (there is no snapshot otherwise), the
 * Board must be ON THE STAGE (`stepAgentBoardBack` keeps the selection so the
 * chord returns to the same panel, and a timer for a panel nobody can see is
 * DL-1.2's banned idle loop), and the pane must be WORKING (a quiet pane
 * changes on `changedAt`, which the render already sees).
 */
export function installSnapshotRefresh(deps: SnapshotRefreshDeps): () => void {
  const timer = setInterval(() => {
    if (deps.selectedPaneId() === null) return;
    if (!deps.onStage()) return;
    if (deps.paneState() !== "working") return;
    boardSnapshotTick.value += 1;
  }, SNAPSHOT_THROTTLE_MS);
  return () => clearInterval(timer);
}
```

Reset `boardSnapshotTick` in `resetAgentBoardStore`.

- [x] **Step 4: Make the render depend on it**

In `boardPanelState` (`src/ui/agent-board-actions.ts`), read the tick beside the snapshot
so the value is a render dependency rather than a coincidence:

```ts
  // Spec §7.3's cadence. Read, deliberately unused: `boardPanelState` runs
  // inside `App`'s render, so touching the signal is what subscribes the
  // render to it. Without this the snapshot re-reads only when something ELSE
  // moved — and the case that matters most, a selected pane streaming in the
  // ACTIVE tab, moves nothing: `unread` marking is background-only, so its
  // output fires no `syncViews`.
  void boardSnapshotTick.value;
```

Add a case in `agent-board-actions.test.ts` proving a bumped tick produces a fresh read
(give `serializePane` a `vi.fn()` that answers different text on successive calls, and
assert `boardPanelState` returns the second).

- [x] **Step 5: Install it in `App`**

Beside the other effects, disposed on unmount:

```ts
  useEffect(
    () =>
      installSnapshotRefresh({
        selectedPaneId: () => boardSelectedPaneId.value,
        paneState: () => boardView.selected?.state ?? null,
        onStage: () => agentBoardSurfaceActive.value,
      }),
    [],
  );
```

Read how `App` installs its other interval-driven syncs (`installRecentActivitySync` is
the nearest precedent) and match that shape, including its dependency list.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/ui/`
Expected: PASS.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/agent-board-store.ts src/ui/agent-board-store.test.ts src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts src/ui/app.tsx
git add src/ui/agent-board-store.ts src/ui/agent-board-store.test.ts \
        src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts src/ui/app.tsx
git commit -m "feat(board): refresh the panel's snapshot while the agent works

Spec §7.3 asks for a throttled re-read while the pane is working and a
`changedAt`-driven one otherwise. No task in this plan built it, and the
cadence it left behind was incidental in both directions: the snapshot
re-read while the Board was OFF the stage, because stepping back keeps the
selection so the chord returns to the same panel — and it did NOT re-read for
a selected pane streaming in the ACTIVE tab, because unread marking is
background-only and that output fires no syncViews. That second case is the
Board's own core case.

One signal says WHEN, and `boardPanelState` reads it so the render depends on
it. The timer needs all three of a selection, the Board on the stage, and a
working pane: a quiet pane changes on `changedAt`, which the render already
sees, and a timer for a panel nobody can see is the idle loop DL-1.2 bans.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
