# Agent Board wiring — Tasks 2–4 (model inputs and the view binding)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **Forks** and **Gates** first; they bind every
> task here.

---

### Task 2: `PaneView.ordinal`, `startedAt` and `lastAgent`

Spec §11.1 and §11.11. The Board's card needs a stable per-pane number, an uptime anchor
and the agent a pane most recently ran; `PaneView` carries none of the three, which is why
`AgentBoardInput` takes them as maps today. This task puts them on `PaneView` and fills
them in `syncViews`, where every pane the window holds is already walked.

**Files:**

- Modify: `src/terminal/tabs-store.ts:25-53`
- Modify: `src/terminal/tab-manager.ts` (`syncViews`)
- Test: `src/terminal/tabs-store.test.ts`, `src/terminal/tab-manager.pane-views.test.ts` (create)

**Interfaces:**

- Consumes: `nextOpenSequence()` from `src/lib/open-sequence.ts`, which
  `tab-manager.ts:11` already imports.
- **Retires:** `notePaneIds` and `paneOrdinals` in `src/ui/agent-board-store.ts`. Plan A
  built them as "a pure seam the wiring plan calls from `syncViews`" — but
  `src/terminal/` imports nothing from `src/ui/` except `search-bar.ts`, and the tab
  layer has no business importing the BOARD's store. The allocation belongs in the same
  closure as `paneGenerations` below, and `PaneView.ordinal` is what the model reads.

  **Delete, exhaustively — these are every call site (grepped):**
  `src/ui/agent-board-store.ts:21-35` (the signal, `notePaneIds`, and their comments),
  its `paneOrdinals.value = new Map();` line inside `resetAgentBoardStore`, and the
  block in `src/ui/agent-board-store.test.ts` that covers them. **Nothing in `src/`
  reads them otherwise**, so this leaves no orphan (F7) and breaks no caller. Task 4 is
  amended in step with it: it stops importing `paneOrdinals` and passes an empty map.
- Produces: four optional `PaneView` fields —

  ```ts
  readonly ordinal?: number;      // window open-order rank, stable for the pane's life
  readonly startedAt?: number;    // epoch ms this pane's CURRENT agent generation began
  readonly lastAgent?: PaneAgent; // the agent this pane most recently ran, kept after it leaves
  readonly confidence?: "explicit" | "inferred"; // the tracker's own trust bit, projected
  ```

  Task 4 reads all four.

- [x] **Step 1: Write the failing test**

Create `src/terminal/tab-manager.pane-views.test.ts`, on the repo's REAL harness
(`src/terminal/tab-manager.fixtures.ts` — `setup`, `setupControllable`, `flush`; the
manager's method is `newTab()`, which takes no options):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { flush, processInfo, setup, setupControllable } from "./tab-manager.fixtures";
import { tabViews } from "./tabs-store";

// `processInfo(id, cwd, process, kind, agent)` is the fixtures file's own
// exported builder (`tab-manager.fixtures.ts:22-30`). Do NOT hand-write the
// literal: `explicitAgent` returns null unless `kind === "agent"`
// (`process-info.ts:108-110`), so a fixture missing it can never produce a
// `lastAgent`, and the field is `process`, not `name`.
const CWD = "/Users/deck/deck";
const agentInfo = (id: number, agent: string): PaneProcessInfo =>
  processInfo(id, CWD, agent, "agent", agent);
const shellInfo = (id: number): PaneProcessInfo => processInfo(id, CWD, "zsh", "shell", null);

describe("PaneView ordinals, start time and last agent", () => {
  it("numbers each pane once and keeps the number across a split", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await flush();
    const first = tabViews.value[0].panes[0].ordinal;
    expect(first).toBeGreaterThan(0);
    await tm.splitActive("row");
    await flush();
    const [a, b] = tabViews.value[0].panes;
    expect(a.ordinal).toBe(first);
    expect(b.ordinal).toBeGreaterThan(first!);
  });

  it("does not renumber the survivors when a pane closes", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await tm.splitActive("row");
    await flush();
    const kept = tabViews.value[0].panes[0].ordinal;
    const doomed = tabViews.value[0].panes[1].paneId;
    await tm.closePaneAt(0, doomed);
    await flush();
    // Spec §5.2: the printed number is a RANK the model computes from these
    // ordinals; the ordinal itself never moves.
    expect(tabViews.value[0].panes[0].ordinal).toBe(kept);
  });

  it("keeps the agent that left as lastAgent, and restarts startedAt for a new one", async () => {
    // `setupControllable` reads each pane's process live from the map on every
    // poll, which is how a test moves a pane from claude → shell → codex.
    const infos = new Map<number, PaneProcessInfo>();
    const { tm } = setupControllable(infos);
    await tm.newTab();
    await flush();
    const paneId = tabViews.value[0].panes[0].paneId;

    infos.set(paneId, agentInfo(paneId, "claude"));
    await flush();
    const born = tabViews.value[0].panes[0].startedAt;
    expect(born).toBeGreaterThan(0);

    infos.set(paneId, shellInfo(paneId)); // the agent left; the shell is back
    await flush();
    const gone = tabViews.value[0].panes[0];
    expect(gone.agent).toBeNull();
    expect(gone.lastAgent).toBe("claude");
    // A DEPARTURE is not a new generation — the card must not reset its uptime.
    expect(gone.startedAt).toBe(born);

    infos.set(paneId, agentInfo(paneId, "codex"));
    await flush();
    const next = tabViews.value[0].panes[0];
    expect(next.lastAgent).toBe("codex");
    expect(next.startedAt!).toBeGreaterThan(born!);
  });

  it("carries the tracker's own confidence, never a guess", async () => {
    const { tm } = setup({ infos: new Map([[1, agentInfo(1, "claude")]]) });
    await tm.newTab();
    await flush();
    // `AttentionKind` has no `idle` member — the trust tier is the tracker's
    // `confidence` field (agent-attention.ts:37), projected, not re-derived.
    expect(tabViews.value[0].panes[0].confidence).toBe("explicit");
  });
});
```

Read whichever suite already uses `setupControllable` for the poll-advance idiom before
writing this — if it advances fake timers rather than awaiting `flush()`, do the same.

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/terminal/tab-manager.pane-views.test.ts`
Expected: FAIL — `ordinal` is `undefined`.

- [x] **Step 3: Declare the fields**

In `src/terminal/tabs-store.ts`, after `focused`:

```ts
  /**
   * This pane's rank in the window's open order (spec §11.1) — allocated from
   * the same `lib/open-sequence.ts` clock the tab strip orders by, the first
   * time the tab layer lists the pane, and stable for its life. `TabView`'s own
   * `openedAt` exists once per TAB and cannot number the panes inside one.
   *
   * Optional for the reason `panes` itself is: a `PaneView` built by a test or
   * a seed fixture predates the field.
   */
  readonly ordinal?: number;
  /**
   * Epoch ms at which this pane's CURRENT agent generation began — what an
   * uptime is measured from (spec §11.1). A pane whose agent LEAVES keeps the
   * value (the generation has not restarted); a pane that starts a different
   * agent takes a new one, which is the same generation boundary
   * `agent-attention.ts` already detects.
   */
  readonly startedAt?: number;
  /**
   * The agent this pane most recently ran, kept after it leaves (spec §11.11).
   * A Board card exists iff `agent !== null || lastAgent !== null`, which is
   * what lets Stop leave a card standing with Restart on it.
   */
  readonly lastAgent?: PaneAgent;
  /**
   * Whether the pane's current state was ANNOUNCED by the agent or inferred by
   * Deck (spec §11.8) — the trust audit's own bit, reaching one pixel: the
   * panel's `State` row (`WORKING · inferred`).
   *
   * Projected straight from the attention tracker's snapshot
   * (`agent-attention.ts:37`, `confidence: "explicit" | "inferred"`). It is NOT
   * derivable from `attention`: that union is
   * `"none" | "completed" | "requested" | "warning" | "error"` and carries no
   * such distinction.
   */
  readonly confidence?: "explicit" | "inferred";
```

Import `PaneAgent` at the top if the file does not already (it does — `agent` uses it).

- [x] **Step 4: Fill them in `syncViews`**

`syncViews` in `src/terminal/tab-manager.ts` builds every `PaneView`. Add a module-level
generation map beside the other per-window maps (near `injectingPanes`):

```ts
  // Per-pane agent generation (spec §11.1, §11.11). `startedAt` is when the
  // CURRENT agent generation began and `lastAgent` is the agent it runs (or
  // ran); both are keyed by pane id and dropped with the pane. Kept here
  // rather than on the tracker because the tracker's own generation boundary
  // is about attention latches, and reading it would couple the Board's
  // uptime to when a pane last got someone's attention.
  interface PaneGeneration {
    readonly agent: PaneAgent;
    readonly startedAt: number;
  }
  const paneGenerations = new Map<number, PaneGeneration>();
```

Inside `syncViews`, where each pane's view object is built, resolve the three fields
first. Find the loop that produces `panes:` and add, before the map:

```ts
      // One pass per sync, over exactly the panes this window holds.
      const livePaneIds: number[] = [];
```

then per pane (`id` is the pane id, `agent` the classified agent for that pane):

```ts
        livePaneIds.push(id);
        const generation = paneGenerations.get(id);
        if (agent !== null && generation?.agent !== agent) {
          // A different agent in the same pane is a new generation; the FIRST
          // agent in a fresh pane is one too. An agent LEAVING is not: the
          // card keeps counting from when the agent started.
          paneGenerations.set(id, { agent, startedAt: now() });
        }
        const resolved = paneGenerations.get(id);
```

and in the object literal — `confidence` comes from the SAME tracker snapshot the loop
already reads for `attention` and `phase`, so no new lookup:

```ts
          ordinal: paneOrdinalById.get(id),
          startedAt: resolved?.startedAt,
          lastAgent: resolved?.agent,
          confidence: snapshot?.confidence,
```

(`snapshot` is whatever local the existing literal reads `attention:` and `phase:` from —
read the loop before writing, and use its name.)

The ordinal map is a **plain Map in `createTabManager`'s closure**, beside
`paneGenerations` — no signal, so there is no write to schedule and no ordering trap:

```ts
  // Per-pane ordinal (spec §11.1) — the window's open-order rank, allocated
  // once and never reused. `TabView.openedAt` exists once per TAB and cannot
  // number the panes inside one, so this is a second reader of the same clock,
  // not a second clock. Named `…ById` because `allPaneIds()` is already a
  // function in this closure and the two must not read alike.
  const paneOrdinalById = new Map<number, number>();
```

Declare it beside `paneGenerations`. At the TOP of `syncViews`, before any pane view is
built — a pane split in this very sync must already have its number, or the first render
after a split ships `ordinal: undefined`. **`allPaneIds()` already exists** at
`tab-manager.ts:350-352`
(`function allPaneIds(): number[] { return tabs.flatMap((tab) => tab.manager.paneIds()); }`)
— call it, never shadow it:

```ts
    const live = allPaneIds();
    for (const id of live) {
      if (!paneOrdinalById.has(id)) {
        paneOrdinalById.set(id, nextOpenSequence());
      }
    }
```

and at the BOTTOM of `syncViews`, one prune for every per-pane map:

```ts
    for (const id of [...paneOrdinalById.keys()]) {
      if (!live.includes(id)) {
        paneOrdinalById.delete(id);
        paneGenerations.delete(id);
        forgetTaskPrompt(id); // Task 3
      }
    }
```

`nextOpenSequence` is already imported (`tab-manager.ts:11`). There is no `sameIds`
helper and no signal write: a plain Map has nothing to debounce.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/terminal/tab-manager.pane-views.test.ts src/terminal/tabs-store.test.ts`
Expected: PASS.

- [x] **Step 6: Run every suite that reads `PaneView`**

Run: `npx vitest run src/terminal/ src/ui/agent-rail-model.test.ts src/ui/agent-board-model.test.ts`
Expected: PASS. The three fields are optional, so no existing fixture breaks; if one does,
it is asserting an exact object shape — widen the assertion, never the type.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/tabs-store.ts src/terminal/tab-manager.ts
git add src/terminal/tabs-store.ts src/terminal/tab-manager.ts src/terminal/tab-manager.pane-views.test.ts
git commit -m "feat(board): number every pane and remember the agent it ran

Spec §11.1 and §11.11. A card needs a stable number, an uptime anchor and the
agent a pane most recently ran; PaneView carried none, so the Board model took
all three as input maps. syncViews fills them now: the ordinal comes from the
window's own open-order clock through the board store's allocator, and the
generation map treats a DIFFERENT agent as a new start while an agent leaving
keeps the old one — a stopped agent's card must not reset its uptime.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 3: The task-prompt store

Spec §11.2: a card prints the launch prompt as its `Task` line, and Deck keeps that prompt
nowhere. `TabManager.launchTask` receives it, delivers it, and forgets it. (§11.8's
`explicit | inferred` bit is Task 4's — it is derived from `PaneView`, not stored.)

**Files:**

- Create: `src/terminal/board-task-prompts.ts`
- Create: `src/terminal/board-task-prompts.test.ts`
- Modify: `src/terminal/tab-manager.ts` (`launchTask`'s delivery, both outcomes)

**Interfaces:**

- Produces:

  ```ts
  export const paneTaskPrompts: Signal<ReadonlyMap<number, string>>;
  export function noteTaskPrompt(paneId: number, prompt: string): void;
  export function forgetTaskPrompt(paneId: number): void;
  export function resetTaskPrompts(): void;
  ```

  Task 4 reads `paneTaskPrompts` as the model's `tasks` map.

- [x] **Step 1: Write the failing test**

Create `src/terminal/board-task-prompts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetTaskPrompt,
  noteTaskPrompt,
  paneTaskPrompts,
  resetTaskPrompts,
} from "./board-task-prompts";

describe("board task prompts", () => {
  beforeEach(() => resetTaskPrompts());

  it("keeps the prompt a pane was launched with", () => {
    noteTaskPrompt(7, "Refactor the rail model");
    expect(paneTaskPrompts.value.get(7)).toBe("Refactor the rail model");
  });

  it("writes a new map rather than mutating the old one (C1)", () => {
    noteTaskPrompt(7, "one");
    const before = paneTaskPrompts.value;
    noteTaskPrompt(8, "two");
    expect(before.has(8)).toBe(false);
    expect(paneTaskPrompts.value.size).toBe(2);
  });

  it("ignores a blank prompt — a card must not print an empty Task line", () => {
    noteTaskPrompt(7, "   ");
    expect(paneTaskPrompts.value.has(7)).toBe(false);
  });

  it("forgets a pane's prompt when the pane goes", () => {
    noteTaskPrompt(7, "one");
    forgetTaskPrompt(7);
    expect(paneTaskPrompts.value.has(7)).toBe(false);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/terminal/board-task-prompts.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write the store**

Create `src/terminal/board-task-prompts.ts`:

```ts
import { signal, type Signal } from "@preact/signals";

/**
 * The launch prompt each pane was started with (spec §11.2), keyed by pane id.
 *
 * Window-scoped module state (R5). It is NOT on `PaneView`: the prompt is
 * written by `launchTask` at one moment and read by one surface, and putting a
 * user's whole first message on the view every sync would carry it through the
 * journal, the strip and the rail — three places that have no use for it.
 *
 * Written on BOTH delivery outcomes, deliberately. `TASK_PROMPT_AUTOSEND` is
 * false, so the normal result of a launch is `pasted` — the text sits in the
 * agent's composer unsent. The Board still has to be able to say what the pane
 * was opened FOR; the card's own rule (spec §5.3 row 4) is what keeps a placed
 * prompt from printing as `Task` before the pane has run a turn.
 */
export const paneTaskPrompts: Signal<ReadonlyMap<number, string>> = signal(new Map());

export function noteTaskPrompt(paneId: number, prompt: string): void {
  if (prompt.trim() === "") {
    return;
  }
  const next = new Map(paneTaskPrompts.value);
  next.set(paneId, prompt);
  paneTaskPrompts.value = next;
}

export function forgetTaskPrompt(paneId: number): void {
  if (!paneTaskPrompts.value.has(paneId)) {
    return;
  }
  const next = new Map(paneTaskPrompts.value);
  next.delete(paneId);
  paneTaskPrompts.value = next;
}

export function resetTaskPrompts(): void {
  paneTaskPrompts.value = new Map();
}
```

- [x] **Step 4: Record the prompt where `launchTask` delivers it**

In `src/terminal/tab-manager.ts`, `launchTask` (around `:1023-1057`) holds
`const text = prompt?.trim() ?? "";` and `const delivery = await deliverTaskPrompt(paneId, text, expectedAgent);`.
**There is no `target` variable** — the earlier draft invented one. Record straight after
that `delivery` line:

```ts
      // Spec §11.2: the Board is the only surface that can say what a pane was
      // opened for, and this is the one moment the text exists in this layer.
      // BOTH successful outcomes record, because `TASK_PROMPT_AUTOSEND` is
      // false and `prompt-pending` is therefore the NORMAL result — a store
      // that only knew `sent` would be empty for almost every launch. The
      // outcome check is what keeps a readiness FAILURE out: that path still
      // answers with a target, so a target-only condition would record a
      // prompt the pane never received.
      if (delivery.outcome === "sent" || delivery.outcome === "prompt-pending") {
        noteTaskPrompt(paneId, text);
      }
```

`retryTaskPrompt` (`:1125`) delivers too, and a retry that lands is the same fact — add
the same two lines after its own `deliverTaskPrompt` call.

and drop it where the pane's ordinal is dropped. **Task 2 shipped that loop and
deliberately left this call out** (it is this task's): at the bottom of `syncViews` there
is already a walk over `paneOrdinalById.keys()` filtered against `live`. Add
`forgetTaskPrompt(id)` INSIDE that existing loop — do not build a second walk over the
same set.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/terminal/board-task-prompts.test.ts src/terminal/tab-manager.task-launcher.test.ts`
Expected: PASS. (If the launcher suite has a different file name, run
`npx vitest run src/terminal/ -t "launchTask"`.)

- [x] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/board-task-prompts.ts src/terminal/board-task-prompts.test.ts src/terminal/tab-manager.ts
git add src/terminal/board-task-prompts.ts src/terminal/board-task-prompts.test.ts src/terminal/tab-manager.ts
git commit -m "feat(board): keep the launch prompt a pane was started with

Spec §11.2. launchTask received the prompt, delivered it and forgot it, so a
card had nothing to print on its Task line. A window-scoped store keyed by pane
id holds it, written on BOTH delivery outcomes — TASK_PROMPT_AUTOSEND is false,
so 'pasted' is the normal result and a store that only knew 'sent' would be
empty for almost every launch. The card's own rule still keeps a placed prompt
from printing as Task before the pane has run a turn.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 4: `agent-board-view.ts` — from the window's stores to the view

The component and the projection both exist and neither reads a store. This is the module
that joins them: it collects what the window knows and calls `buildAgentBoard`.

**Files:**

- Create: `src/ui/agent-board-view.ts`
- Create: `src/ui/agent-board-view.test.ts`

**Interfaces:**

- Consumes: `buildAgentBoard`, `AgentBoardInput`, `AgentBoardView` from
  `./agent-board-model`; `tabViews` / `activeTabIndex` from `../terminal/tabs-store`;
  `repositoryScans` from `../repositories/repositories-store`; `paneTails` from
  `../terminal/session-tail-store`; `workspacesData` from `../open-board/workspaces-store`
  (**not** `../workspaces/`, which does not exist);
  `settings` from `../settings/settings-store`; `boardSelectedPaneId`,
  `boardStatusFilter`, `boardProjectFilter`, `boardHeldOrder` from `./agent-board-store`;
  `paneTaskPrompts` from `../terminal/board-task-prompts` (Task 3); `PaneView.ordinal` /
  `startedAt` / `lastAgent` (Task 2). **Read `AgentRail`'s own `buildAgentRail({…})` call
  in `src/ui/agent-rail.tsx` before writing this** — the store names and the exact input
  field names come from there, and a renamed field is a compile error, not a silent gap.
- Produces:

  ```ts
  export interface BoardViewSources { /* every AgentRailInput field, plus the Board's own */ }
  export function boardInputFrom(sources: BoardViewSources): AgentBoardInput;
  export function useAgentBoardView(): AgentBoardView;
  ```

  Task 5 calls `useAgentBoardView()`.

- [x] **Step 1: Write the failing test**

Create `src/ui/agent-board-view.test.ts` — the PURE half only; the hook is covered by the
surface's own test in Task 5.

```ts
import { describe, expect, it } from "vitest";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { boardInputFrom, type BoardViewSources } from "./agent-board-view";

const NOW = 1_760_000_000_000;

function pane(over: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    confidence: "explicit",
    changedAt: NOW - 60_000,
    ordinal: 3,
    startedAt: NOW - 600_000,
    lastAgent: "claude",
    ...over,
  } as PaneView;
}
function tab(panes: readonly PaneView[]): TabView {
  return {
    key: 1,
    title: "claude",
    process: "claude",
    active: true,
    workspacePath: "/Users/deck/deck",
    panes,
  } as unknown as TabView;
}
function base(): BoardViewSources {
  return {
    tabs: [],
    activeIndex: 0,
    scans: new Map(),
    workspaceHistoryPaths: [],
    tails: new Map(),
    tasks: new Map(),
    ordinals: new Map(),
    railOrder: [],
    selectedPaneId: null,
    statusFilter: "all",
    projectFilter: null,
    heldOrder: null,
    now: NOW,
  };
}

describe("boardInputFrom", () => {
  it("prefers the pane's own ordinal over the store's map", () => {
    const withField = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ ordinal: 5 })])],
      ordinals: new Map([[11, 9]]),
    });
    expect(withField.ordinals.get(11)).toBe(5);
    const withoutField = boardInputFrom({
      ...base(),
      tabs: [tab([pane({ ordinal: undefined })])],
      ordinals: new Map([[11, 9]]),
    });
    expect(withoutField.ordinals.get(11)).toBe(9);
  });

  it("carries startedAt and lastAgent through as maps", () => {
    const input = boardInputFrom({ ...base(), tabs: [tab([pane()])] });
    expect(input.startedAt?.get(11)).toBe(NOW - 600_000);
    expect(input.lastAgents?.get(11)).toBe("claude");
  });

  it("carries the tracker's own trust bit, and claims nothing without one", () => {
    const explicit = boardInputFrom({ ...base(), tabs: [tab([pane({ confidence: "explicit" })])] });
    expect(explicit.confidence?.get(11)).toBe("explicit");
    const inferred = boardInputFrom({ ...base(), tabs: [tab([pane({ confidence: "inferred" })])] });
    expect(inferred.confidence?.get(11)).toBe("inferred");
    // `undefined` is a REAL case, not just a fixture one: `tracker.snapshot(id)`
    // answers null until a poll has classified the pane, so an unclassified
    // pane has no tier. It must stay OUT of the map — the model reads
    // `input.confidence?.get(id) ?? null` (`agent-board-model.ts:303`), so
    // absence becomes `null`, which is "claims nothing".
    const silent = boardInputFrom({ ...base(), tabs: [tab([pane({ confidence: undefined })])] });
    expect(silent.confidence?.has(11)).toBe(false);
  });

  it("passes the selection, both filters and the held order straight through", () => {
    const input = boardInputFrom({
      ...base(),
      tabs: [tab([pane()])],
      selectedPaneId: 11,
      statusFilter: "asked",
      projectFilter: "deck",
      heldOrder: [11, 12],
    });
    expect(input.selectedPaneId).toBe(11);
    expect(input.statusFilter).toBe("asked");
    expect(input.projectFilter).toBe("deck");
    expect(input.heldOrder).toEqual([11, 12]);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-board-view.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write the binding**

Create `src/ui/agent-board-view.ts`:

```ts
import type { PaneAgent } from "../lib/process-info";
import type { RepositoryScan } from "../repositories/repository-client";
import { repositoryScans } from "../repositories/repositories-store";
import { settings } from "../settings/settings-store";
import { paneTaskPrompts } from "../terminal/board-task-prompts";
import { paneTails } from "../terminal/session-tail-store";
import { activeTabIndex, tabViews, type TabView } from "../terminal/tabs-store";
import { workspacesData } from "../open-board/workspaces-store";
import {
  buildAgentBoard,
  type AgentBoardInput,
  type AgentBoardView,
  type BoardConfidence,
  type BoardStatusFilter,
} from "./agent-board-model";
import {
  boardHeldOrder,
  boardProjectFilter,
  boardSelectedPaneId,
  boardStatusFilter,
} from "./agent-board-store";

/**
 * Everything the Board's projection needs, in one bag (spec §11.9).
 *
 * A record rather than a set of signal reads, so the assembly is testable
 * without a renderer: `useAgentBoardView` reads the signals and hands them
 * here, and every rule about HOW a window fact becomes model input lives in
 * one pure function.
 */
export interface BoardViewSources {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  readonly workspaceHistoryPaths: readonly string[];
  readonly tails: ReadonlyMap<number, string>;
  readonly tasks: ReadonlyMap<number, string>;
  /**
   * Kept as an input for the gallery and for tests, which build a view with no
   * `PaneView.ordinal` at all. In the app it is EMPTY: `syncViews` writes the
   * field, and `boardInputFrom` prefers the field.
   */
  readonly ordinals: ReadonlyMap<number, number>;
  readonly railOrder: readonly string[];
  /**
   * The user's home directory, so `tildePath` can shorten a checkout to `~/…`
   * (`agent-board-model.ts:131-137`). READ PER RENDER from
   * `getDesktopEnvironment().homeDir` — the environment is initialized
   * asynchronously from the backend, so a module-level read would capture the
   * fallback. The unsupported fallback is `""`, which `tildePath` already
   * declines to match, so no extra guard is needed.
   */
  readonly home?: string;
  readonly selectedPaneId: number | null;
  readonly statusFilter: BoardStatusFilter;
  readonly projectFilter: string | null;
  readonly heldOrder: readonly number[] | null;
  readonly now: number;
}

/**
 * The trust tier a card claims (spec §11.8) — the one place the trust audit's
 * `explicit | inferred` bit reaches a pixel, as the panel's `State` suffix.
 *
 * READ off the pane, never re-derived: the tracker already decides this
 * (`agent-attention.ts:37`), and `AttentionKind` —
 * `"none" | "completed" | "requested" | "warning" | "error"` — carries no such
 * distinction, so any rule written here from `attention` would be a second,
 * disagreeing answer. A pane whose view predates the field (a fixture) has no
 * claim to make, and gets none.
 */
function confidenceOf(pane: PaneView): BoardConfidence | undefined {
  return pane.confidence;
}

export function boardInputFrom(sources: BoardViewSources): AgentBoardInput {
  const ordinals = new Map(sources.ordinals);
  const startedAt = new Map<number, number>();
  const lastAgents = new Map<number, PaneAgent>();
  const confidence = new Map<number, BoardConfidence>();
  for (const tab of sources.tabs) {
    for (const pane of tab.panes ?? []) {
      // The FIELD wins over the map: `syncViews` allocated it from the same
      // clock in the same pass that produced this `PaneView`, so a map read a
      // render later cannot lag a split by a frame.
      if (pane.ordinal !== undefined) ordinals.set(pane.paneId, pane.ordinal);
      if (pane.startedAt !== undefined) startedAt.set(pane.paneId, pane.startedAt);
      if (pane.lastAgent !== undefined) lastAgents.set(pane.paneId, pane.lastAgent);
      const tier = confidenceOf(pane);
      if (tier !== undefined) {
        confidence.set(pane.paneId, tier);
      }
    }
  }
  return {
    tabs: sources.tabs,
    activeIndex: sources.activeIndex,
    scans: sources.scans,
    workspaceHistoryPaths: sources.workspaceHistoryPaths,
    tails: sources.tails,
    railOrder: sources.railOrder,
    now: sources.now,
    ordinals,
    startedAt,
    lastAgents,
    confidence,
    tasks: sources.tasks,
    home: sources.home,
    selectedPaneId: sources.selectedPaneId,
    statusFilter: sources.statusFilter,
    projectFilter: sources.projectFilter,
    heldOrder: sources.heldOrder,
  };
}

/** Every pane's ordinal reaches the model on `PaneView` now; see `BoardViewSources`. */
const EMPTY_ORDINALS: ReadonlyMap<number, number> = new Map();

/**
 * The Board's view for this render.
 *
 * `now` is read once per render and injected, exactly as `AgentRail` does: the
 * model never calls the clock, so a test can place a card's uptime anywhere.
 */
export function useAgentBoardView(): AgentBoardView {
  return buildAgentBoard(
    boardInputFrom({
      tabs: tabViews.value,
      activeIndex: activeTabIndex.value,
      scans: repositoryScans.value,
      workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
      tails: paneTails.value,
      tasks: paneTaskPrompts.value,
      // Task 2 retired the store's map: every ordinal reaches the model on
      // `PaneView` now, and `boardInputFrom` fills `ordinals` FROM that field.
      // The empty map is the seed, not the answer — passing it straight to
      // `buildAgentBoard` without going through `boardInputFrom` would rank
      // every card at `UNSEQUENCED` (`agent-board-model.ts:255-256`).
      ordinals: EMPTY_ORDINALS,
      railOrder: settings.value.railOrder,
      selectedPaneId: boardSelectedPaneId.value,
      statusFilter: boardStatusFilter.value,
      projectFilter: boardProjectFilter.value,
      heldOrder: boardHeldOrder.value,
      now: Date.now(),
    }),
  );
}
```

Import `PaneView` as a type from `../terminal/tabs-store` for `confidenceOf`.

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/ui/agent-board-view.test.ts src/ui/agent-board-model.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/agent-board-view.ts src/ui/agent-board-view.test.ts
git add src/ui/agent-board-view.ts src/ui/agent-board-view.test.ts
git commit -m "feat(board): bind the window's stores to the board projection

The component and the projection both existed and neither read a store; this
is the join. One pure function turns the window's tabs, scans, tails, prompts
and ordinals plus the Board's own four signals into AgentBoardInput, and one
hook reads the signals and calls it. The pane's own ordinal/startedAt/lastAgent
win over the input maps: syncViews wrote them in the same pass that produced
the PaneView, and a map read a render later can lag a split by a frame.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
