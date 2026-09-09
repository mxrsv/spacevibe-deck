# Agent Board wiring — Tasks 8–10 (memory, selection, snapshot)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **Forks** and **Gates** first.

---

### Task 8: `agentBoardOpen` on `WindowRecord`, and `taskPrompt` on `SessionPane`

Spec §4.2: the Board is remembered and opens itself only at boot — it never opens itself
otherwise (§17 Q2). **Session schema is a fork category; spec §12 resolves it**, and it
resolves TWO fields, not one.

**The second field was missing from this plan until Task 3's implementer found it.**
Spec §11.2 closes with: "**It persists** (§17, Q21): `SessionPane` gains `taskPrompt`,
capped at 4 KiB (longer text is cut at the cap and the cut marked), so a restored pane —
which resumes its own conversation — keeps the task its card was started with." Without
it, session restore brings back the pane and its conversation but its card says nothing
about what it was opened for, which is the one thing the Board exists to show.

**Files:**

- Modify: `src/lib/session-schema.ts:46-53` (the record and its validation)
- Modify: `src/terminal/session-journal.ts:182-190,264-290` (`buildRecord`, the effect deps)
- Modify: `src/terminal/session-restore.ts`
- Test: `src/lib/session-schema.test.ts`, `src/terminal/session-journal.test.ts`,
  `src/terminal/session-restore.test.ts`

**Interfaces:**

- Produces: `WindowRecord.agentBoardOpen: boolean` and `SessionPane.taskPrompt: string | null`
  — both required in their types and defaulted in their validators, so a file written
  before either validates to `false` / `null` and no `SESSION_VERSION` bump is needed.

- [x] **Step 1: Write the failing tests**

Append to `src/lib/session-schema.test.ts`. The real export is
**`validateWindowRecord(raw: unknown): WindowRecord | null`** (`session-schema.ts:171`)
— note the `| null`, so every assertion needs a non-null check or `!`:

```ts
describe("agentBoardOpen", () => {
  // `savedAt` is mandatory: the envelope returns null without a finite number
  // (`session-schema.ts:157-159`), so a payload missing it asserts nothing.
  const base = { savedAt: 1, activeTabIndex: 0, tabs: [], files: [], activeFileTab: null };
  it("defaults to false for a record written before the field existed", () => {
    expect(validateWindowRecord(base)?.agentBoardOpen).toBe(false);
  });
  it("takes only a real boolean — never a truthy string", () => {
    expect(validateWindowRecord({ ...base, agentBoardOpen: true })?.agentBoardOpen).toBe(true);
    expect(validateWindowRecord({ ...base, agentBoardOpen: "yes" })?.agentBoardOpen).toBe(false);
    expect(validateWindowRecord({ ...base, agentBoardOpen: 1 })?.agentBoardOpen).toBe(false);
  });
});
```

Append to `src/terminal/session-journal.test.ts`:

**The record's tabs come from `deps.capture()`, not from `tabViews`** —
`session-journal.ts:186` is `tabs: cappedTabs(deps),` and `:171-172` is
`function cappedTabs(deps) { const tabs = deps.capture();`. So the zero-tab case is
expressed by the injected `capture`, and assigning `tabViews.value` proves nothing. The
suite's real helpers are `deps(overrides?: Partial<SessionJournalDeps>)` (`:65`),
`createFakeStore()` (`:50`) and `tab(workspacePath)` (`:27`):

```ts
it("writes the board's open state while the window holds tabs", async () => {
  resetAgentBoardStore();
  const store = createFakeStore();
  await initSessionJournal(deps({ isMain: true, store, capture: () => [tab("/w")] }));
  openAgentBoard();
  await flushSessionJournal();
  expect(store.data.get("window:main")?.agentBoardOpen).toBe(true);
});

it("rewrites it false with no tabs", async () => {
  resetAgentBoardStore();
  const store = createFakeStore();
  await initSessionJournal(deps({ isMain: true, store, capture: () => [] }));
  openAgentBoard();
  await flushSessionJournal();
  // Zero tabs = no Board: the chip cannot render and the action is scope
  // "pane", so a remembered `true` would restore a surface with no way out.
  expect(store.data.get("window:main")?.agentBoardOpen).toBe(false);
});
```

Read `createFakeStore`'s own shape for the accessor (`data` and the key spelling) before
writing — `windowKey(deps.windowLabel)` is what the journal writes under.

Append to `src/terminal/session-restore.test.ts`:

The entry point takes **two** arguments — `session-restore.ts:353`
`export async function restoreSession(deps: RestoreDeps, mainLabel: string): Promise<boolean>`
— and the suite's helpers are `createFakeDeps({ records })`, `record(overrides?)` and
`tab(overrides?)`, with a `records: new Map([["main", record({…})]])` pattern already in
the file:

```ts
it("reopens the board from a main record that restored tabs", async () => {
  resetAgentBoardStore();
  const deps = createFakeDeps({ records: new Map([["main", record({ tabs: [tab()], agentBoardOpen: true })]]) });
  await restoreSession(deps, "main");
  expect(agentBoardOpen.value).toBe(true);
});

it("does not reopen it from a record with no tabs", async () => {
  resetAgentBoardStore();
  const deps = createFakeDeps({ records: new Map([["main", record({ tabs: [], agentBoardOpen: true })]]) });
  await restoreSession(deps, "main");
  expect(agentBoardOpen.value).toBe(false);
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/session-schema.test.ts src/terminal/session-journal.test.ts src/terminal/session-restore.test.ts`
Expected: FAIL — the field does not exist.

- [x] **Step 3: Add the field and validate it**

In `src/lib/session-schema.ts`:

```ts
export interface WindowRecord {
  readonly savedAt: number;
  readonly activeTabIndex: number;
  readonly tabs: readonly SessionTab[];
  /** Main window only; secondary windows write []. */
  readonly files: readonly SessionFileSurface[];
  readonly activeFileTab: string | null;
  /**
   * The Agent Board's chip was open when this window was last written (spec
   * §4.2). Restored from the MAIN record only, the way `files` is: boot
   * restore folds secondary windows into the main one, so a secondary
   * record's value would raise a Board in a window that never had one.
   *
   * No `SESSION_VERSION` bump: a file written before the field existed
   * validates to `false`, which is exactly the old behaviour.
   */
  readonly agentBoardOpen: boolean;
}
```

and in the record validator, beside `activeFileTab`:

```ts
    // A real boolean only. `Boolean(source.agentBoardOpen)` would resurrect
    // the Board from the string "false", which is what a hand-edited or
    // half-migrated file contains.
    agentBoardOpen: source.agentBoardOpen === true,
```

- [x] **Step 4: Write it from the journal**

In `session-journal.ts`, `buildRecord`:

```ts
function buildRecord(deps: SessionJournalDeps): WindowRecord {
  const tabs = cappedTabs(deps);
  return {
    savedAt: Date.now(),
    activeTabIndex: activeTabIndex.value,
    tabs,
    files: deps.isMain ? fileSurfacesToRecords() : [],
    activeFileTab: deps.isMain ? activeFileTab.value : null,
    // Zero tabs = no Board (spec §4.2): the chip cannot render and
    // `toggle-agent-board` is scope "pane", so a remembered `true` would
    // restore a surface with nothing to show and no way out. Written false
    // rather than left alone, so the next launch does not retry it.
    agentBoardOpen: tabs.length > 0 && agentBoardOpen.value,
  };
}
```

and add the signal to the effect's dependency reads in `initSessionJournal`:

```ts
    void tabViews.value;
    void activeTabIndex.value;
    void fileSurfaces.value;
    void activeFileTab.value;
    // Opening or closing the chip is a change a write must react to; without
    // this read the effect never re-runs for it, and the state is saved only
    // when something else happens to move.
    void agentBoardOpen.value;
```

- [x] **Step 5: Read it on restore**

In `session-restore.ts`, immediately before `return restored > 0;` (`:387`) — after
`deps.manager.selectTab(...)`, so the tabs are in place and the count is known. **The
locals are `mainRecord` (`:367`) and `restored` (`:370`)**; there is no `record` or
`restoredTabCount` in that scope:

```ts
  // Spec §4.2: the Board opens itself at boot and never otherwise. The MAIN
  // record only, like `files`: boot restore folds secondary windows into this
  // one, and a secondary record's flag would raise a Board in a window that
  // never had one.
  if (mainRecord?.agentBoardOpen === true && restored > 0) {
    openAgentBoard();
  }
```

- [x] **Step 5b: Persist the task prompt with its pane**

`SessionPane` (`session-schema.ts:11-23`) already carries `cwd`, `agent` and
`launchCommand`. Add the fourth:

```ts
  /**
   * The launch prompt this pane was started with (spec §11.2), or null.
   *
   * Capped at `MAX_TASK_PROMPT_BYTES`: a prompt is arbitrary user text and the
   * journal is rewritten on a debounce, so an unbounded field would let one
   * paste dominate every write. A cut prompt is MARKED rather than silently
   * shortened — a card that quietly truncated its task would be lying about
   * what the pane was asked to do.
   */
  readonly taskPrompt: string | null;
```

with, beside `MAX_JOURNAL_TABS` (`session-schema.ts:9`):

```ts
/** Spec §11.2's 4 KiB cap on a persisted task prompt. */
export const MAX_TASK_PROMPT_BYTES = 4096;
/** Appended to a prompt cut at the cap, so a card never claims the whole text. */
export const TASK_PROMPT_CUT_MARK = "…";
```

In `validateSessionPane`, beside `launchCommand` — same drop-not-repair shape, and the
cap is applied on READ as well as on write, because a hand-edited file is untrusted
input (C7):

```ts
    taskPrompt: typeof source.taskPrompt === "string" ? capTaskPrompt(source.taskPrompt) : null,
```

```ts
/**
 * A prompt at or under the cap, unchanged; anything longer cut to the cap and
 * marked. Measured in BYTES, not characters: the cap exists to bound what the
 * journal writes, and one emoji is four bytes.
 */
export function capTaskPrompt(prompt: string): string {
  const bytes = new TextEncoder().encode(prompt);
  if (bytes.length <= MAX_TASK_PROMPT_BYTES) {
    return prompt;
  }
  // `TextDecoder` with `fatal: false` replaces a split code point rather than
  // throwing, which is what makes a byte cap safe on UTF-8.
  const cut = new TextDecoder().decode(bytes.slice(0, MAX_TASK_PROMPT_BYTES));
  return `${cut}${TASK_PROMPT_CUT_MARK}`;
}
```

Write it in the journal's pane capture — find where `launchCommand` is read for a
`SessionPane` and read `paneTaskPrompts.value.get(paneId) ?? null` beside it, through
`capTaskPrompt`. Restore it by calling `noteTaskPrompt(paneId, pane.taskPrompt)` for each
restored pane that has one, at the point where the restored pane's id is known.

Tests, in `src/lib/session-schema.test.ts`:

```ts
it("keeps a short task prompt and caps a long one with a mark", () => {
  expect(capTaskPrompt("short")).toBe("short");
  const long = "x".repeat(MAX_TASK_PROMPT_BYTES + 100);
  const capped = capTaskPrompt(long);
  expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(
    MAX_TASK_PROMPT_BYTES + TASK_PROMPT_CUT_MARK.length * 3,
  );
  expect(capped.endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
});
it("counts BYTES, not characters", () => {
  // Four bytes each, so a quarter of the cap in characters is the whole cap.
  const emoji = "🙂".repeat(MAX_TASK_PROMPT_BYTES / 4);
  expect(capTaskPrompt(emoji)).toBe(emoji);
  expect(capTaskPrompt(`${emoji}🙂`).endsWith(TASK_PROMPT_CUT_MARK)).toBe(true);
});
it("reads a missing or non-string taskPrompt as null", () => {
  expect(validateSessionPane({ cwd: null, agent: null }).taskPrompt).toBeNull();
  expect(validateSessionPane({ taskPrompt: 42 }).taskPrompt).toBeNull();
});
```

and one round-trip case in `session-restore.test.ts` proving a restored pane's prompt
reaches `paneTaskPrompts`.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/lib/session-schema.test.ts src/terminal/session-journal.test.ts src/terminal/session-restore.test.ts src/terminal/board-task-prompts.test.ts`
Expected: PASS.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/lib/session-schema.ts src/terminal/session-journal.ts src/terminal/session-restore.ts
git add src/lib/session-schema.ts src/lib/session-schema.test.ts \
        src/terminal/session-journal.ts src/terminal/session-journal.test.ts \
        src/terminal/session-restore.ts src/terminal/session-restore.test.ts
git commit -m "feat(board): remember the board, and each pane's task prompt

Spec §4.2: the Board is remembered and opens itself only at boot. One boolean
on WindowRecord, defaulted in the validator so no SESSION_VERSION bump is
needed and a pre-field file reads false. Zero tabs rewrites it false — the
chip cannot render and the action is scope 'pane', so a remembered true would
restore a surface with no way out. Restored from the MAIN record only, like
files: boot restore folds secondary windows into the main one.

And spec §11.2's second half, which this plan had dropped until Task 3's
implementer found it: SessionPane.taskPrompt, capped at 4 KiB in BYTES and
marked when cut, so a restored pane — which resumes its own conversation —
keeps the task its card was started with instead of coming back blank.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 9: `acknowledgePane` — and proving selection needs nothing else

Spec §5.4 and §5.5: selecting a card **neither switches the tab nor moves the manager's
active pane**. Board-local, one signal, no seam.

An earlier draft of this plan added a `selectPaneUnderSurface(index, paneId)` that showed
the owning tab and moved the active pane, on the theory that the panel's snapshot needs
the pane mounted. **That is false, and the draft contradicted the spec** — it would also
have cleared the target tab's `unread`, moved the strip's active chip and moved the
rail's DL-27.22 wash, all on a mere selection. Two facts settle it, both read at HEAD:

- `TerminalManager.hide()` is `container.style.display = "none"`
  (`src/terminal/terminal-manager.ts:614-616`) — every xterm instance stays alive, so a
  hidden tab's buffer is still readable.
- `pasteIntoPane` resolves through `life.panes.get(id)` and `pane.pasteText(text)`, which
  goes out through xterm's `onData` to the PTY. Neither reads the active tab.

So Step 1 of this task is the EXPERIMENT that proves it, and the only seam it adds is the
one that genuinely does not exist: an explicit acknowledge.

**Files:**

- Modify: `src/terminal/tab-manager.ts`, `src/terminal/tab-manager-types.ts`
- Test: `src/terminal/tab-manager.board-seams.test.ts` (create)

**Interfaces:**

- Produces:

  ```ts
  /** Acknowledge one pane's attention explicitly (spec §11.4). */
  acknowledgePane(paneId: number): void;
  ```

  Tasks 11 and 14 call it. **No `selectPaneUnderSurface`, and no `setActivePane`.**
- **`BoardManagerSeams` is widened by Task 10, not here.** Task 9 ships the seam on
  `TabManager`; the interface in `src/ui/agent-board-actions.ts` is held by another
  implementer while Task 9 runs, so Task 10 adds all three of `acknowledgePane`,
  `serializePane` and `paneAlive` in one edit. Nothing calls `acknowledgePane` until Task
  11's `onReply`, and only on a `sent` outcome.

- [x] **Step 1: Prove a hidden tab's pane can still be read and written**

Create `src/terminal/tab-manager.board-seams.test.ts` on the REAL harness
(`setup`/`flush` from `./tab-manager.fixtures`; the manager's method is `newTab()`):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { flush, setup } from "./tab-manager.fixtures";
import { tabViews } from "./tabs-store";

describe("a pane in a tab that is not on the stage", () => {
  it("still answers its scrollback", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await flush();
    const hidden = tabViews.value[0].panes[0].paneId;
    pty.emitOutput(hidden, "from the hidden tab\r\n");
    await tm.newTab(); // tab 2 takes the stage
    await flush();
    expect(tm.serializePane(hidden, 20)).toContain("from the hidden tab");
  });

  it("still accepts an injected reply", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await flush();
    const hidden = tabViews.value[0].panes[0].paneId;
    await tm.newTab();
    await flush();
    await expect(
      tm.injectIntoPane(hidden, "hello", { autoSend: false, expectedAgent: null }),
    ).resolves.not.toBe("no-target");
  });
});
```

**`handleOutput` and `handleExit` are `TerminalManager` methods and `TabManager` exposes
NEITHER** (`terminal-manager-types.ts:207,209`). Drive both through the memory PTY client
`setup` returns — `pty.emitOutput(id, data)` / `pty.emitExit(id)` — which is also the
route that goes through the real listener `init()` registers. In the
`terminal-manager.test.ts` case below, `handleOutput` IS correct: that suite holds a
`TerminalManager` directly.

This step depends on Task 10's `serializePane`. **Run Task 10 first if the executor
prefers**; the two are independent otherwise, and the plan's numbering is not a
dependency order here. If either assertion fails, STOP and report: the spec's selection
model would then need an amendment, which is the owner's call, not an executor's.

- [x] **Step 2: Write the failing test for the one real seam**

```ts
describe("acknowledgePane", () => {
  it("clears one pane's attention and syncs the views", async () => {
    // `emitSignal` goes through the real `onAttentionSignal` wiring, and the
    // tracker's process gate only opens for a pane a poll recognised as an
    // agent — so `infos` must name one.
    const { tm, emitSignal } = setup({ infos: agentInfos(1, "claude") });
    await tm.newTab();
    await flush();
    const target = tabViews.value[0].panes[0].paneId;
    emitSignal(target, { kind: "requested", source: "osc" });
    await flush();
    // `AttentionKind` is "none" | "completed" | "requested" | "warning" |
    // "error" — `"idle"` is the RAIL's word, not this layer's, and
    // `acknowledge` sets `"none"` (`agent-attention.ts:432-444`).
    expect(tabViews.value[0].panes[0].attention).toBe("requested");
    tm.acknowledgePane(target);
    await flush();
    expect(tabViews.value[0].panes[0].attention).toBe("none");
  });
  it("is a no-op for a pane this window does not hold", async () => {
    const { tm } = setup({});
    expect(() => tm.acknowledgePane(9999)).not.toThrow();
  });
  it("does not change the active tab", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await tm.newTab();
    await flush();
    const other = tabViews.value[0].panes[0].paneId;
    tm.acknowledgePane(other);
    await flush();
    expect(activeTabIndex.value).toBe(1);
  });
});
```

`agentInfos` and the exact `PaneAttentionSignal` literal come from whichever attention
suite already drives `emitSignal` — copy its shape rather than guessing at `source`.
**The cleared value is `"none"`, not `"idle"`:** `AttentionKind` is
`"none" | "completed" | "requested" | "warning" | "error"` (`agent-attention.ts:22`).

- [x] **Step 3: Run them and watch the acknowledge one fail**

Run: `npx vitest run src/terminal/tab-manager.board-seams.test.ts`
Expected: the hidden-tab cases PASS (they assert today's behaviour); `acknowledgePane`
FAILs as not a function.

- [x] **Step 4: Write it**

In `src/terminal/tab-manager.ts`, beside `activateForAttention`:

```ts
  /**
   * Acknowledge one pane explicitly (spec §11.4).
   *
   * `tracker.acknowledge` lives inside `onPaneFocus` today, so the only way to
   * clear a latch was to FOCUS the pane. The Board acknowledges on two events
   * that are not a focus — a `sent` reply (§7.4) and a step to the full stage
   * — so the call needs a door of its own.
   *
   * Selection is deliberately NOT one of them: an ack on select would drop an
   * `asked` card out of the top group the moment the user opened its panel
   * (spec §5.5).
   */
  function acknowledgePane(paneId: number): void {
    if (!tabs.some((entry) => entry.manager.paneIds().includes(paneId))) {
      return;
    }
    if (tracker.acknowledge(paneId) !== null) {
      syncViews();
    }
  }
```

Export it on the manager object and declare it in `tab-manager-types.ts` with that
comment.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/terminal/tab-manager.board-seams.test.ts src/terminal/tab-manager.tab-lifecycle.test.ts src/ui/agent-rail.test.tsx`
Expected: PASS.

- [x] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/tab-manager.ts src/terminal/tab-manager-types.ts
git add src/terminal/tab-manager.ts src/terminal/tab-manager-types.ts src/terminal/tab-manager.board-seams.test.ts
git commit -m "feat(board): acknowledge a pane without focusing it

Spec §11.4. tracker.acknowledge lives inside onPaneFocus, so the only way to
clear a latch was to focus the pane — and the Board acknowledges on two events
that are not a focus: a sent reply, and a step to the full stage. Selection is
deliberately not one of them; an ack there would drop an asked card out of the
top group the moment its panel opened.

No selection seam was needed at all. hide() is display:none, so a hidden tab's
xterm buffer is still readable, and pasteIntoPane resolves by pane id through
life.panes — both pinned by tests here. Spec §5.4's 'selecting moves neither
the tab nor the active pane' therefore holds with no tab-layer change.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 10: `serializePane` and the panel's snapshot

Spec §7.3 and DL-34.6: the panel's terminal is a snapshot of the pane's own scrollback —
plain text, colour stripped, the last rows of the real buffer. No element moves, no PTY
resizes, no second renderer exists.

**Files:**

- Modify: `src/terminal/terminal-manager.ts`, `src/terminal/terminal-manager-types.ts`
- Modify: `src/terminal/tab-manager.ts`, `src/terminal/tab-manager-types.ts`
- Modify: `src/ui/app.tsx` (the `boardPanel` computation from Task 5)
- Modify: `src/ui/agent-board-panel.tsx` (export the line count)
- Test: `src/terminal/terminal-manager.test.ts`, `src/terminal/tab-manager.board-seams.test.ts`

**Interfaces:**

- Consumes: `Pane.serializeScrollback(lines: number): string` (exists,
  `src/terminal/pane.ts:63`); the pure stripper in `src/lib/strip-ansi-sequences.ts`
  (exists — read its export name before importing).
- Produces:

  ```ts
  // TerminalManager
  serializePane(id: number, lines: number): string | null;
  // TabManager — the same, with the escapes stripped
  serializePane(paneId: number, lines: number): string | null;
  // TerminalManager + TabManager: is this pane's PTY still alive?
  paneAlive(id: number): boolean;
  // …and both are added to `BoardManagerSeams` in `agent-board-actions.ts`.
  // agent-board-panel.tsx
  export const BOARD_SNAPSHOT_LINES = 40;
  ```

- [x] **Step 1: Write the failing test**

Append to `src/terminal/terminal-manager.test.ts`:

```ts
it("serializes one pane's scrollback and answers null for a dead one", async () => {
  // Use this suite's OWN manager construction — read the top of the file; it
  // builds a TerminalManager over a memory PTY with a fake pane factory whose
  // `serializeScrollback` you have just made real (see the note below).
  const tm = makeManagerForThisSuite();
  await tm.initFresh();
  const id = tm.paneIds()[0];
  tm.handleOutput(id, "hello\r\n");
  expect(tm.serializePane(id, 10)).toContain("hello");
  expect(tm.serializePane(9999, 10)).toBeNull();
});
```

**The fake pane returns the empty string and its `write` is a no-op** —
`tab-manager.fixtures.ts:73-81` and `terminal-manager.test.ts:42,48-50` both read
`write() {}` / `serializeScrollback() { return ""; }`. Every `toContain(...)` assertion
in this task AND in Task 9's experiment fails against that. Fix the fakes first, in both
files, by letting them accumulate:

```ts
  let buffer = "";
  …
    write(data) {
      buffer += data;
    },
    serializeScrollback() {
      return buffer;
    },
```

That is cheaper than widening `fakePane`'s `overrides` (which today accepts only
`search`/`copySelection`/`paste`/`pasteText`/`selection`) and it makes both tests mean
something instead of passing vacuously.

Append to `src/terminal/tab-manager.board-seams.test.ts`:

```ts
describe("serializePane", () => {
  it("strips colour out of the snapshot", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await flush();
    const id = tabViews.value[0].panes[0].paneId;
    // A red word followed by a plain one. The escape is written as a JS
    // escape on purpose — a literal control byte in a test file is invisible
    // in a diff and unsearchable.
    pty.emitOutput(id, "\x1b[31mred\x1b[0m plain\r\n");
    const snapshot = tm.serializePane(id, 10)!;
    expect(snapshot).toContain("red plain");
    expect(snapshot).not.toContain("\x1b");
  });
  it("answers null for a pane no tab holds", async () => {
    const { tm } = setup({});
    expect(tm.serializePane(9999, 10)).toBeNull();
  });
  it("still answers for a pane whose PTY exited, and paneAlive says it is gone", async () => {
    const { tm } = setup({});
    await tm.newTab();
    await flush();
    const id = tabViews.value[0].panes[0].paneId;
    pty.emitOutput(id, "last words\r\n");
    pty.emitExit(id); // the real pty:exit path, through the listener `init()` registers
    // The panel's whole job is showing what the agent last said — an exited
    // pane keeps its buffer.
    expect(tm.serializePane(id, 10)).toContain("last words");
    expect(tm.paneAlive(id)).toBe(false);
  });
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/terminal/terminal-manager.test.ts src/terminal/tab-manager.board-seams.test.ts`
Expected: FAIL — `serializePane` is not a function.

- [x] **Step 3: Add the passthrough**

In `src/terminal/terminal-manager.ts`, beside `pasteIntoPane`:

```ts
    /**
     * The last `lines` rows of one pane's scrollback, as text (spec §7.3).
     *
     * A read-only passthrough to the pane's own `serializeScrollback` — the
     * same call `pane-detach.ts` makes when a pane travels. It moves no
     * element, resizes no PTY and builds no second renderer (DL-34.6).
     */
    serializePane(id, lines) {
      const pane = life.panes.get(id);
      if (!pane) {
        return null;
      }
      // Deliberately NOT gated on `life.exited`: a pane whose PTY has gone
      // still holds the last thing the agent said, which is exactly what the
      // panel is for. `paneAlive` below answers the other question.
      return pane.serializeScrollback(lines);
    },
    /**
     * Whether this pane's PTY is still running (spec §7.5's disabled actions).
     *
     * `pasteIntoPane` and `submitPane` already read `life.exited` for the same
     * reason; this exposes that fact rather than letting a caller infer it
     * from an empty snapshot.
     */
    paneAlive(id) {
      return life.panes.has(id) && !life.exited.has(id);
    },
```

In `src/terminal/tab-manager.ts`, the manager-level twin — which is where the escapes are
stripped, so the terminal layer keeps returning what the buffer actually holds:

```ts
  function paneAlive(paneId: number): boolean {
    return ownerOf(paneId)?.manager.paneAlive(paneId) ?? false;
  }

  function serializePane(paneId: number, lines: number): string | null {
    const owner = ownerOf(paneId);
    const raw = owner?.manager.serializePane(paneId, lines) ?? null;
    // The panel prints plain text (DL-34.6). Stripping HERE rather than in the
    // terminal layer keeps `serializeScrollback` answering what the buffer
    // holds — `pane-detach.ts` needs the escapes.
    return raw === null ? null : stripAnsiSequences(raw);
  }
```

- [x] **Step 4: Feed the panel**

Export the line count from `src/ui/agent-board-panel.tsx`:

```ts
/**
 * Rows of scrollback the panel shows (spec §7.3). Forty reads as activity
 * without becoming a second terminal; the panel's own `max-height: 40vh`
 * scrolls whatever does not fit.
 */
export const BOARD_SNAPSHOT_LINES = 40;
```

and in `src/ui/app.tsx`, replace Task 5's placeholder `boardPanel`:

```ts
  /**
   * The panel's live state (spec §7). Recomputed each render: the snapshot is
   * read from the selected pane's own buffer, which is why selection has to
   * make that pane the manager's active one first (Task 9).
   */
  const boardPanel: BoardPanelState = (() => {
    const paneId = boardSelectedPaneId.value;
    if (paneId === null) {
      return {
        snapshot: null,
        replyEnabled: false,
        replyNotice: null,
        sending: false,
        paneExited: false,
      };
    }
    const snapshot = manager?.serializePane(paneId, BOARD_SNAPSHOT_LINES) ?? null;
    return {
      snapshot,
      replyEnabled: false, // Task 11
      replyNotice: null,
      sending: false,
      // NOT `snapshot === null`: an EXITED pane still holds its buffer and
      // still answers, which is the point — the panel shows what the agent
      // last said. `paneAlive` is the separate question, and `life.exited` is
      // where its answer lives (`pasteIntoPane` already reads it).
      paneExited: manager?.paneAlive(paneId) === false,
    };
  })();
```

- [x] **Step 5c: Close Task 9's experiment literally**

`tab-manager.board-seams.test.ts` already has a
`describe("a pane in a tab that is not on the stage")` block proving the hidden pane is
alive and current — Task 9 could not prove the READ half because this seam did not exist.
Add the one line that does, to the existing case:

```ts
    expect(tm.serializePane(hidden, 20)).toContain("from the hidden tab");
```

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/terminal/terminal-manager.test.ts src/terminal/tab-manager.board-seams.test.ts src/ui/agent-board-panel.test.tsx src/ui/agent-board-actions.test.ts`
Expected: PASS.

- [x] **Step 5b: Close the hole Task 14 had to leave open**

Task 14 shipped `onClose` as the plan wrote it, and reported the gap honestly:
`closePaneAt` answers `Promise<void>` and resolves IDENTICALLY for a completed close, a
DECLINED busy dialog, a stale index, and a pane that is not a member of that tab
(`close-coordinator.ts:99-113` — three early `return`s, none distinguishable). So
`.then(clearSelection)` fires even when the user cancelled: the panel shuts and the held
sort releases under a card that is still on screen.

`paneAlive` — which this task adds — closes it without touching close coordination, which
is a fork this plan does not own. In `src/ui/agent-board-actions.ts`:

```ts
    onClose: (card) => {
      void deps.manager?.closePaneAt(card.tabIndex, card.paneId).then(() => {
        // `closePaneAt` cannot say whether it closed anything — a declined
        // busy dialog and a completed close both resolve void. Ask the pane
        // instead: clearing a panel about a card the user just KEPT is the
        // failure this guards, and it is the one a cancelled close produces.
        if (deps.selectedPaneId() !== card.paneId) return;
        if (deps.manager?.paneAlive(card.paneId) === true) return;
        deps.clearSelection();
      });
    },
```

with a case in `agent-board-actions.test.ts` where `paneAlive` answers `true` after the
close and `clearSelection` is NOT called.

- [x] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/terminal-manager.ts src/terminal/tab-manager.ts src/ui/app.tsx src/ui/agent-board-panel.tsx
git add src/terminal/terminal-manager.ts src/terminal/terminal-manager-types.ts \
        src/terminal/terminal-manager.test.ts src/terminal/tab-manager.ts \
        src/terminal/tab-manager-types.ts src/terminal/tab-manager.board-seams.test.ts \
        src/ui/app.tsx src/ui/agent-board-panel.tsx \
        src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts
git commit -m "feat(board): show the pane's own scrollback in the panel

Spec §7.3, DL-34.6. A read-only passthrough to the pane's serializeScrollback
— the same call pane-detach already makes — so no element moves, no PTY
resizes and no second renderer exists. The escapes are stripped at the TAB
layer, not the terminal one: serializeScrollback must keep answering what the
buffer holds, because pane transfer needs them.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
