# Agent Board wiring — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Task 1 is in this file. Tasks 2–4 are in `-2-model-and-store.md`, Task 5 in
> `-3-surface-and-toggle.md`, Tasks 6–7 in `-3b-toggle-and-sidebar.md`, Tasks 8–10 in
> `-4-seams-and-panel.md`, Task 10b in `-4b-last-session-id.md`, Tasks 11–13 in
> `-5-actions.md`, Task 11b in `-5b-snapshot-cadence.md`, Tasks 14–15 in
> `-6-close-docs-gates.md`. Read the Global Constraints and **The test harness — the real
> one** below before any task.

**Goal:** make the Agent Board a surface a user can actually open, use and leave in the
running app — the chip, the chord, the memory, the selection, the snapshot, the reply,
Stop, Restart and Close — without `TabManager` learning what the surface IS.

**Architecture:** the Board is a third `SurfaceStrip` slot beside files and the browser,
rendered as `.stage__surface` over the terminal grid. Its state stays in the
window-scoped `agent-board-store.ts` that plan A already built; a new binding module
turns that state plus `tabViews`/`repositoryScans`/`paneTails` into the `AgentBoardView`
the built component already consumes. Every effect leaves through named tab-layer seams
(`acknowledgePane`, `serializePane`, `paneAlive`, `restartPane`) and one
new flat IPC channel (`pty_kill_foreground`).

**Tech Stack:** Preact + signals renderer, Electron main for the one new channel, Vitest,
Playwright-driven gallery for measurement, `npm run electron:dev` for the acceptance pass.

**Spec:** [`docs/specs/2026-09-03-agent-board-design.md`](../specs/2026-09-03-agent-board-design.md)
`decided`. §4 the surface and the toggle, §5.5 selection, §5.6 actions, §7 the panel,
§11 the model work, §12 the forks. Executors read the spec section a task names before
writing its code.

**Base:** branch `mxrsv/add-board-agent`. The plan was WRITTEN against `4d8159a` (plan A
complete, its eye-pass findings fixed); Task 1 shipped as `73cd1b1` and this plan itself
as `10cdfb6`. **Task 15's gate diff runs from `4d8159a`**, which is the last commit
before any of this plan's work — not from the plan's own commit. Work in the worktree at
`/Users/kyantran/orca/workspaces/spacevibe-deck/add-board-agent`. Never `cd` to the main
checkout.

---

## Global Constraints

- **English only** — strings, comments, docs, commit messages (R1).
- **Electron only in effect** (spec §13). Tauri lacks `session_tail`, `git_repository`
  and the new kill channel. **Do not repeat this plan's original claim that "the host
  predicate hides the whole surface there" — it is FALSE**, and Task 6's implementer
  proved it: `hostHasAgentBoard` gates the KEYSTROKE only. `runAction` (the menu path)
  reaches `dispatchAction` without ever asking `isActionPerformable`; `menu_registry.rs`
  is Tauri's own menu and now carries View ▸ Agent Board; and `<AgentBoardSurface>`'s
  mount condition is `agentBoardSurfaceActive` alone, with no host gate. So on Tauri the
  menu item opens a Board with no tails and no worktree grouping. **`toggle-browser` has
  the identical exposure today**, so this is the repo's existing posture rather than a new
  class — but it is a named parity gap and Task 15 must state it, not paper over it.
  Never claim Tauri behaviour. **Windows is Gate C** — unverified, say so.
- **R4 stays intact:** `TabManager` learns that a surface EXISTS and can be activated,
  never what it holds. Every Board fact reaches it through `SurfaceStrip`.
- **R6:** IPC payloads are flat. `pty_kill_foreground` joins `CHANNELS` and
  `scripts/electron-ipc-contract.test.ts`.
- **R3:** the menu is generated. Edit `src/terminal/action-registry.ts`, run
  `npm run generate:menu`, prove with `npm run generate:menu:check`.
- **R5:** renderer state is Preact signals in window-scoped module stores.
- **R7:** shipping modules never import `src/gallery/`.
- **C9:** no hardcoded values — constants or tokens, with the derivation in a comment.
- **DL:** cite rules in comments (`DL-34.1`, `DL §34`). The design-language gate's
  baseline at this HEAD is **19 passed / 1 failed**, that one failure listing **exactly
  nine** unresolved citations from `main`'s uncommitted DESIGN-LANGUAGE (DL-19.9 ×4,
  DL-27.25 ×3, DL-13.7, DL-13.8). A tenth is yours.
- **Never `boardOpen`** — that signal in `src/chrome/events.ts` is the OPEN board's. The
  Board's three signals are `agentBoardOpen`, `agentBoardOpenedAt`,
  `agentBoardSurfaceActive` in `src/ui/agent-board-store.ts`.
- **Commit by explicit path** (`git add <paths>`), never `-A`: other sessions leave files
  staged in this repo's shared index.
- **Do not merge, do not push.** Merging waits for the daily-surfaces release
  (2026-09-02 direction).
- **Write a checkpoint** (skill `checkpoint`, W11) after each commit that touches a file
  outside `docs/daily/`, and whenever you stop mid-task.

## Line numbers in `app.tsx` are unreliable

That file is being edited by this plan's own tasks, so every `app.tsx:NNNN` below has
drifted. **Refer to identifiers** — `selectBrowserTab`, `sidebarPaintWidth`,
`effectiveSidebarCollapsed`, `dockState`, `openTaskLauncher` — and grep for them. Line
numbers cited for every OTHER file were verified at HEAD and are good.

## Two seams the first draft put in the wrong module

Verified against source in the 2026-09-04 plan review, and they change which file a task
edits:

- **The keyboard lives in `tab-manager.ts`, not `App`.** `performableContext()` is
  `tab-manager.ts:1995`, `handleShortcut` is `:2222`, and an action's handler is an entry
  in an object literal (`:1861` `"toggle-explorer": () => {`), not a `switch` case. That
  is also where `syncViews()` and `activeManager()` live, which the toggle needs.
- **`PtyClient` has ONE production implementation.** `createTauriPtyClient()`
  (`pty-client.ts:69`) is what BOTH hosts run — it goes through `invoke` from
  `host/bridge`, which is the Electron path. A no-op "for Tauri" placed there disables
  the feature on the only host that has it. Host absence is expressed by an **optional**
  member (`sessionCwds?` at `:30` is the precedent) and an optional call at the call site.

## Reviewing a task's diff — the one heuristic that would have caught these

Gate 2 blocked three defects in this plan. **Only one of them was a type error.** The
other two compiled, would have passed their own tests, and were wrong at runtime:

- Restart read `paneSessionIds`, a map another module **empties** at the exact transition
  after which Restart is offered.
- `autoSend: true` would have pressed Enter on a security dialog, because the gate it
  trusted has no `hasRun` input.

Both were invisible in the diff alone. They only appear when the diff is read against the
runtime state of a module it does not touch. So, for every task review:

> **When a diff READS a map, store or signal owned by another module, go find that
> module's write site AND its delete/clear site before accepting the read.** Ask when the
> value is populated relative to when this code runs, and who removes it.

That is the rule that finds this class. A reviewer who only reads the diff will not.

## The test harness — the real one

A plan review (2026-09-04) found the first draft citing helpers that do not exist. These
do, and every task's tests use THEM. Read the file before writing against it.

**Tab/terminal layer — `src/terminal/tab-manager.fixtures.ts`:**

```ts
export function setup(options: {
  infos?: ReadonlyMap<number, PaneProcessInfo>;
  dirs?: readonly string[];
  deps?: Partial<TabManagerDeps>;
  paneOverrides?: …;
}): { tm: TabManager; pty: ReturnType<typeof createMemoryPtyClient>; emitSignal: EmitSignal; focusPaneDirectly: FocusPaneDirectly };
export function setupControllable(infoByPane: Map<number, PaneProcessInfo>, deps?): { tm; pty; emitSignal };
export function flush(): Promise<void>;
```

- The manager's method is **`newTab(): Promise<void>`** (`tab-manager-types.ts:218`) —
  there is no `openTab()` and it takes no options.
- Attention is driven with **`emitSignal(id, signal)`**, which goes through the real
  `onAttentionSignal` wiring; focus with **`focusPaneDirectly(id)`**, which is a real
  `Pane.focus()`. **Do not add a `__test` backdoor to `TabManager`** — it is an R4 seam
  and this plan does not own that decision.
- A pane's classified process comes from `infos` / `setupControllable`, never from a
  setter.

**App layer — there is no `<App>` render harness in this repo, and this plan does not
build one.** `src/ui/app.test.tsx` renders `DesktopChrome` and tests the pure predicates
in `src/ui/app-policy.ts`; that file's own comment says so. So:

- Board **policy** (what is visible when) goes into `src/ui/app-policy.ts` beside
  `sidebarEffectivelyCollapsed` and `dockVisible`, and is tested there.
- Board **actions** (what a press does) go into a new `src/ui/agent-board-actions.ts`
  factory that takes its seams as injected dependencies, and is tested directly with
  fakes. `App` then calls the factory and passes the result down.

A task that cannot be tested without inventing a harness is a task whose CODE is in the
wrong place. Move the code, do not invent the harness.

## Forks this plan moves

Every one is resolved in spec §12 by the owner's "execute the spec"; this plan restates
each with the seam it moves and **widens the list by nothing**.

| Fork category (`AGENTS.md`) | What moves | Task |
| --- | --- | --- |
| Tab materialization | `acknowledgePane`, `serializePane`, `paneAlive`, `restartPane` on `TabManager` | 9, 10, 13 |
| Session/tail store | `lastSessionId` kept through `forget` — the id Restart needs | 10b |
| PTY ownership + IPC | `pty_kill_foreground` — a new flat channel, main resolves the pgid | 12 |
| Session schema | `agentBoardOpen` on `WindowRecord` **and `taskPrompt` on `SessionPane`** — both named in spec §12, both decided | 8 |
| Tab materialization, **widened during execution** | `MaterializeIntent.panePrompts` — see the note below | 8 |
| Layout | the sidebar goes to width 0 and the dock unpainted while the Board holds the stage, without writing `sidebarCollapsed` | 7 |
| A rule in `docs/DESIGN-LANGUAGE.md` | DL-34.1's sidebar clause becomes true rather than declared; no NEW rule is added by this plan | 7, 15 |
| Keymap | `toggle-agent-board`, ⌘⇧O / Ctrl+Shift+O, plus a `PerformableContext` field | 6 |

**NOT touched, and no task may:** process classification, the window coordinator, pane
mounting/layout geometry, close/quit coordination (not even `disposeTab`'s empty branch —
Task 5's zero-tab effect keeps `surfaces.total()` honest from the renderer instead), the
settings schema, release/updater configuration, any sibling repo.

**One seam this plan did not foresee, added in Task 8 and recorded here rather than
quietly.** Spec §11.2 requires the task prompt to survive a restart, and a restored
prompt has to reach a PANE. `session-restore.ts` cannot do it: `materialize` answers
`Promise<boolean>` and pane ids never leave `TabManager`. So `MaterializeIntent` gained
`panePrompts?: readonly (string | null)[]`, zipped to leaves left-to-right — **the exact
shape and the exact caller as `paneCommands`**, which was itself widened for session
restore (`AGENTS.md`, 2026-08-15). The alternative, a `(workspace, agent)` mark like
`noteResumedPane`, is the one `AGENTS.md` records as BUILT AND WITHDRAWN on 2026-08-22,
because a mark has no causal link to a pane and the wrong pane claims it. This is a
tab-materialization fork the plan's own table did not list; it is written into
`AGENTS.md`'s open queue by Task 15.

**A seam this plan deliberately does NOT add:** a tab-level selection seam. Spec §5.4
says selecting a card moves neither the tab nor the manager's active pane, and Task 9
proves the panel needs neither — `hide()` is `display: none`, so a hidden tab's xterm
buffer is still readable and still writable by pane id.

## Six DL amendments entered the spec without a separate owner read

The spec's own header names them — DL-1.2's fourth spinner exception, DL-3.4 and DL-4.4's
nav label size and tone, DL-21.7's card wash, the `hostHasAgentBoard` predicate and the
three-signal store. **They are resolved by the owner's "execute the spec" instruction
(2026-09-03, recorded in `AGENTS.md`'s open fork queue), and this plan does not re-ask
them.** All six are already built and shipped in plan A's commits; nothing in this plan
changes any of them.

## The freeze

`docs/CONTEXT.md`'s 2026-09-02 direction ships the daily surfaces before any new feature,
and spec §1 places the Board's MERGE after that release. **Building on this branch is
fine; merging is the owner's call.** No task merges, pushes, or edits release config.

## File structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/ui/agent-board-view.ts` | The binding: window stores + `tabViews`/`repositoryScans`/`paneTails` → `AgentBoardView`. Pure over its inputs, so it is unit-testable without a DOM. |
| `src/ui/agent-board-surface.tsx` | The mount condition and the `.stage__surface` frame — the `BrowserSurface`/`StageSurface` twin. Holds the container that binds actions to seams. |
| `src/terminal/board-task-prompts.ts` | Window-scoped store: the launch prompt per pane id (spec §11.2). |
| `src/terminal/pane-restart.ts` | The pure half of Restart — session id + launch command → the command to type. |

**Modified:**

| File | Change |
| --- | --- |
| `src/ui/stage-surface-strip.ts` | A third slot, described generically rather than by name. |
| `src/ui/tab-strip.tsx` | Renders a slot from its descriptor instead of assuming "not a file ⇒ browser". |
| `src/terminal/tabs-store.ts` | `PaneView.ordinal`, `startedAt`, `lastAgent`. |
| `src/terminal/tab-manager.ts` | `syncViews` fills the three fields and owns the ordinal allocation; four new seams. |
| `src/terminal/tab-manager-types.ts` | Those seams' signatures. |
| `src/terminal/terminal-manager.ts` / `-types.ts` | `serializePane(id, lines)`. |
| `src/terminal/action-registry.ts`, `default-keymaps.ts`, `action-performable.ts` | The toggle. |
| `src/lib/session-schema.ts`, `src/terminal/session-journal.ts`, `session-restore.ts` | `agentBoardOpen` and `SessionPane.taskPrompt`. |
| `electron/ipc/channels.ts`, `electron/main.ts`, `electron/pty/manager.ts`, `src/terminal/pty-client.ts`, `src/host/*` | `pty_kill_foreground`. |
| `src/ui/app.tsx` | Mount, exclusion effect, `browserPanelObscured`, sidebar width. |

## Task index

| # | Task | File |
| --- | --- | --- |
| 1 | A third surface kind in the strip — **done, `73cd1b1`** | this file |
| 2 | `PaneView.ordinal`, `startedAt`, `lastAgent` | `-2-model-and-store.md` |
| 3 | The task-prompt store | `-2-model-and-store.md` |
| 4 | `agent-board-view.ts` — stores to view | `-2-model-and-store.md` |
| 5 | `AgentBoardSurface`, the action factory and the mount | `-3-surface-and-toggle.md` |
| 6 | The toggle: action, chord, menu, host predicate | `-3b-toggle-and-sidebar.md` |
| 7 | The sidebar and the dock go while the Board holds the stage | `-3b-toggle-and-sidebar.md` |
| 8 | `agentBoardOpen` and `SessionPane.taskPrompt` | `-4-seams-and-panel.md` |
| 9 | `acknowledgePane`, and proving selection needs no seam | `-4-seams-and-panel.md` |
| 10 | `serializePane` and the panel's snapshot | `-4-seams-and-panel.md` |
| 10b | `lastSessionId` — the id Restart needs | `-4b-last-session-id.md` |
| 11 | The reply box through the inject gate | `-5-actions.md` |
| 11b | The snapshot's refresh cadence (spec §7.3) | `-5b-snapshot-cadence.md` |
| 12 | Stop — `pty_kill_foreground` | `-5-actions.md` |
| 13 | Restart — the resume composition | `-5-actions.md` |
| 14 | Close and Open in stage | `-6-close-docs-gates.md` |
| 15 | Docs, gates and the native pass | `-6-close-docs-gates.md` |

## Gates every task runs

- `npx vitest run <the suites the task touches>` — green.
- `npx tsc --noEmit`; add `npx tsc -p tsconfig.electron.json --noEmit` for any task
  touching `electron/`.
- `npx prettier --check <the code files the task touched>`.
- The design-language gate stays at 19/1 with exactly nine citations.

Task 15 runs the whole set: `npm test`, `npm run build`, `npm run electron:build`,
`npm run generate:menu:check`, and the `npm run electron:dev` acceptance walk.

---

### Task 1: A third surface kind in the strip — ✅ DONE (`73cd1b1`)

`composeSurfaceStrip` publishes an index space of "files, then the browser's one slot",
and `TabStrip` renders any slot whose file tab is missing as the browser chip. A third
surface needs the two of them to describe a slot instead of naming it — which is the R4
seam restated: `TabManager` still consumes only `SurfaceStrip`.

> **Executed 2026-09-04, commit `73cd1b1`.** Ten files, not the six listed below: the
> plan missed `src/ui/tab-bar.test.tsx`, `src/gallery/chrome-fixtures.tsx`,
> `src/ui/agent-rail.test.tsx` and `src/ui/repository-rail.test.tsx`, every one of which
> mounts `TabStrip`/`TabBar` and fails `tsc` without the new required props. **A later
> task copying a `git add` list from this plan must run `npx tsc --noEmit` before
> trusting it.** Deviations taken and reported: the chip gained `tabIndex={0}` and a
> `<span class="tab__glyph">` wrapper (`05-tab-bar-toolbar.css:87` anchors DL-18.6's 15px
> glyph slot on that class), `resetAgentBoardStore()` moved into `beforeEach`/`afterEach`
> because the store is a window-scoped singleton, and the "counts after the browser" case
> was made to actually open the browser. 7 suites / 225 passed, `tsc` clean, prettier
> clean, DL gate 19/1 with exactly nine baseline citations.

**Files:**

- Modify: `src/ui/stage-surface-strip.ts`
- Modify: `src/ui/tab-strip.tsx:116-130,275-290`
- Modify: `src/ui/tab-bar.tsx:25,47-56` — **the third call site**. `app.tsx` has ONE
  `<TabStrip>` (~2092) and one `<TabBar>` (~2026), and `tab-bar.tsx` renders `<TabStrip>`
  with every prop spelled out (no spread), so a required prop added to `TabStripProps`
  breaks it. Thread the pair through `TabBarProps` exactly as `onSelectBrowser` /
  `onCloseBrowser` are threaded.
- Test: `src/ui/stage-surface-strip.test.ts`, `src/ui/tab-strip.test.tsx`

**Interfaces:**

- Consumes: `SurfaceStrip` (`src/terminal/surface-strip.ts`), unchanged;
  `agentBoardOpen` / `agentBoardOpenedAt` / `agentBoardSurfaceActive` /
  `activateAgentBoard` / `stepAgentBoardBack` / `closeAgentBoard` from
  `src/ui/agent-board-store.ts`.
- Produces: `stageSurfaceDescriptors(fileController): readonly StageSlotDescriptor[]`
  exported from `src/ui/stage-surface-strip.ts`, where

  ```ts
  export interface StageSlotDescriptor {
    /** SurfaceStrip index this slot addresses. */
    readonly index: number;
    readonly kind: "file" | "browser" | "agent-board";
    readonly openedAt: number;
  }
  ```

  Task 5 consumes `agent-board` as the chip's kind.

- [x] **Step 1: Write the failing tests**

Append to `src/ui/stage-surface-strip.test.ts`:

```ts
describe("the agent board slot", () => {
  it("counts after the browser and answers its own order key", () => {
    resetAgentBoardStore();
    // `fakeFiles(overrides: Partial<SurfaceStrip>)` and `fakeClient(overrides)` are the
    // helpers this suite actually has.
    const files = fakeFiles({ count: () => 2, total: () => 2 });
    const strip = composeSurfaceStrip({ files, client: fakeClient(), onChanged: () => {} });
    expect(strip.count()).toBe(2);
    openAgentBoard();
    expect(strip.count()).toBe(3);
    expect(strip.orderKey?.(2)).toBe(agentBoardOpenedAt.value);
  });
  it("activates the board, and a terminal tab steps it back", () => {
    resetAgentBoardStore();
    const files = fakeFiles({ count: () => 1, total: () => 1 });
    const strip = composeSurfaceStrip({ files, client: fakeClient(), onChanged: () => {} });
    openAgentBoard();
    stepAgentBoardBack();
    strip.activate(1);
    expect(agentBoardSurfaceActive.value).toBe(true);
    expect(strip.activeIndex()).toBe(1);
    strip.deactivate();
    expect(agentBoardSurfaceActive.value).toBe(false);
  });
  it("closes the board tab, not just its stage turn", async () => {
    resetAgentBoardStore();
    const strip = composeSurfaceStrip({
      files: fakeFiles({ count: () => 0, total: () => 0 }),
      client: fakeClient(),
      onChanged: () => {},
    });
    openAgentBoard();
    await strip.close();
    expect(agentBoardOpen.value).toBe(false);
  });
  it("describes every slot by kind, in SurfaceStrip index order", () => {
    resetAgentBoardStore();
    openAgentBoard();
    const descriptors = stageSurfaceDescriptors(fakeFiles({ count: () => 1 }));
    expect(descriptors.map((slot) => slot.kind)).toEqual(["file", "agent-board"]);
  });
});
```

Append to `src/ui/tab-strip.test.tsx`:

```ts
it("draws an agent board chip that is neither a file nor the browser", () => {
  resetAgentBoardStore();
  openAgentBoard();
  const host = document.createElement("div");
  document.body.appendChild(host);
  // This suite has `tab()`, `pane()` and a `fileClient` const, and renders inline —
  // copy the shape of the render call the browser-chip case already uses.
  act(() => {
    render(<TabStrip {...stripProps()} />, host);
  });
  const chip = host.querySelector(".tab--agent-board");
  expect(chip).not.toBeNull();
  expect(chip!.textContent).toContain("Agents");
  expect(host.querySelectorAll(".tab--browser").length).toBe(0);
  render(null, host);
});
```

`stripProps()` is whatever prop bag that file already builds for its own `render` calls —
reuse it verbatim and add the two new members.

- [x] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/stage-surface-strip.test.ts src/ui/tab-strip.test.tsx`
Expected: FAIL — `stageSurfaceDescriptors` is not exported, `.tab--agent-board` is null.

- [x] **Step 3: Give the composer a third slot**

In `src/ui/stage-surface-strip.ts`, add the imports and the slot arithmetic. The board
sits AFTER the browser in the index space, for the same reason the browser sits after the
files: the merged strip places chips by `orderKey`, so index order is bookkeeping only.

```ts
import {
  activateAgentBoard,
  agentBoardOpen,
  agentBoardOpenedAt,
  agentBoardSurfaceActive,
  closeAgentBoard,
  stepAgentBoardBack as stepBoardOffStage,
} from "./agent-board-store";

/** One slot in the SurfaceStrip index space, described rather than named. */
export interface StageSlotDescriptor {
  readonly index: number;
  readonly kind: "file" | "browser" | "agent-board";
  readonly openedAt: number;
}
```

Inside `composeSurfaceStrip`, beside `browserSlot`:

```ts
  const boardSlot = (): number => (agentBoardOpen.value ? 1 : 0);
  /** Index of the board's own slot while it is open, else -1. */
  const boardIndex = (): number => (agentBoardOpen.value ? files.count() + browserSlot() : -1);
  /** Take the board off the stage if it holds it; report whether it did. */
  const stepBoardBack = (): boolean => {
    if (!agentBoardSurfaceActive.value) {
      return false;
    }
    stepBoardOffStage();
    return true;
  };
```

Then each method gains its board branch:

```ts
    count: () => files.count() + browserSlot() + boardSlot(),
    total: () => files.total() + browserSlot() + boardSlot(),
    activeIndex: () =>
      agentBoardSurfaceActive.value
        ? boardIndex()
        : browserSurfaceActive.value
          ? files.count()
          : files.activeIndex(),
    orderKey: (index) =>
      index === boardIndex()
        ? agentBoardOpenedAt.value
        : browserOpen.value && index === files.count()
          ? browserOpenedAt.value
          : (files.orderKey?.(index) ?? UNSEQUENCED),
```

`activate` takes the board first, since its index is the highest:

```ts
    activate(index) {
      if (index === boardIndex()) {
        if (agentBoardSurfaceActive.value) {
          return; // already on the stage
        }
        files.deactivate();
        stepBrowserBack();
        activateAgentBoard();
        onChanged();
        return;
      }
      const boardChanged = stepBoardBack();
      if (browserOpen.value && index === files.count()) {
        // …the existing browser branch, with `onChanged()` called once…
      }
      // …the existing terminal branch…
    },
```

Write the whole `activate` as one function rather than patching around it:

```ts
    activate(index) {
      if (index === boardIndex()) {
        if (agentBoardSurfaceActive.value) {
          return;
        }
        files.deactivate();
        stepBrowserBack();
        activateAgentBoard();
        onChanged();
        return;
      }
      const boardChanged = stepBoardBack();
      if (browserOpen.value && index === files.count()) {
        if (browserSurfaceActive.value) {
          return;
        }
        files.deactivate();
        activateBrowserSurface();
        onChanged();
        return;
      }
      const browserChanged = stepBrowserBack();
      files.activate(index);
      if (boardChanged || browserChanged) {
        onChanged();
      }
    },
    deactivate() {
      const boardChanged = stepBoardBack();
      const browserChanged = stepBrowserBack();
      files.deactivate();
      if (boardChanged || browserChanged) {
        onChanged();
      }
    },
    focus() {
      if (agentBoardSurfaceActive.value) {
        // The Board takes DOM focus through its own mount effect (Task 5):
        // focusing from here would fight the roving focus inside the grid.
        return;
      }
      if (browserSurfaceActive.value) {
        return;
      }
      files.focus();
    },
    async close() {
      if (agentBoardSurfaceActive.value) {
        closeAgentBoard();
        onChanged();
        return;
      }
      if (browserSurfaceActive.value) {
        await closeBrowser(client);
        onChanged();
        return;
      }
      await files.close();
    },
    async save() {
      if (agentBoardSurfaceActive.value || browserSurfaceActive.value) {
        return; // neither has anything Deck can save
      }
      await files.save();
    },
```

And the descriptor list, exported beside the composer:

```ts
/**
 * Every open surface slot, in the SurfaceStrip index space, described by KIND.
 *
 * `TabStrip` used to read "not a file tab ⇒ the browser", which was true while
 * there were exactly two kinds and silently wrong at three. Naming the kind
 * here keeps the strip's chip rendering a lookup rather than an inference, and
 * keeps `TabManager` on the same `SurfaceStrip` seam it had before (R4).
 */
export function stageSurfaceDescriptors(
  // The file side's own two methods, structurally — not `FileSurfaceController`,
  // which would drag the file layer's type into a module TabManager consumes.
  files: Pick<SurfaceStrip, "count" | "orderKey">,
): readonly StageSlotDescriptor[] {
  const slots: StageSlotDescriptor[] = [];
  for (let index = 0; index < files.count(); index += 1) {
    slots.push({ index, kind: "file", openedAt: files.orderKey?.(index) ?? UNSEQUENCED });
  }
  if (browserOpen.value) {
    slots.push({ index: slots.length, kind: "browser", openedAt: browserOpenedAt.value });
  }
  if (agentBoardOpen.value) {
    slots.push({ index: slots.length, kind: "agent-board", openedAt: agentBoardOpenedAt.value });
  }
  return slots;
}
```

- [x] **Step 4: Render the chip from the descriptor**

In `src/ui/tab-strip.tsx`, replace the merged surface list and the slot render. The
surface half of `mergeStripOrder` becomes the descriptor list, and the render switches on
`kind`:

```ts
  const surfaceSlots = stageSurfaceDescriptors(props.fileController);
  const surfaceActive =
    props.fileController.activeIndex() >= 0 ||
    browserSurfaceActive.value ||
    agentBoardSurfaceActive.value;
  const slots = mergeStripOrder(
    visibleTabs.map(({ tab }) => ({ openedAt: tab.openedAt ?? UNSEQUENCED })),
    surfaceSlots.map((slot) => ({ openedAt: slot.openedAt })),
  );
```

Add the chip beside `browserChip`:

```ts
  /**
   * The Agent Board chip (spec §4.1, DL-18.10's one chip shape). Its glyph is
   * `SquaresFour` — the grid the surface draws — and its label is the word
   * `Agents`, fixed: the chip says what is open, and nothing else (2026-08-16).
   */
  function agentBoardChip() {
    return (
      <div
        key="agent-board"
        role="tab"
        aria-selected={agentBoardSurfaceActive.value}
        class={`tab tab--agent-board ${agentBoardSurfaceActive.value ? "is-active" : ""}`}
        onClick={() => {
          if (!agentBoardSurfaceActive.value) {
            props.onSelectAgentBoard();
          }
        }}
      >
        <DeckIcon icon={SquaresFour} size={CHROME_ICON} />
        <span class="tab__label">Agents</span>
        <button
          type="button"
          class="tab__close"
          aria-label="Close the agent board tab"
          onClick={(event) => {
            event.stopPropagation();
            props.onCloseAgentBoard();
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    );
  }
```

and dispatch on the descriptor:

```ts
        {slots.map((slot) => {
          if (slot.kind === "tab") {
            const entry = visibleTabs[slot.index];
            return entry === undefined ? null : terminalChip(entry.tab, entry.index);
          }
          const surface = surfaceSlots[slot.index];
          if (surface === undefined) return null;
          if (surface.kind === "agent-board") return agentBoardChip();
          if (surface.kind === "browser") return browserChip();
          const fileTab = fileTabs[surface.index];
          return fileTab === undefined ? null : fileChip(fileTab, surface.index);
        })}
```

Add the two props to `TabStripProps`, beside the browser's pair:

```ts
  /** The Board chip's two actions, owned by `App` for the browser's reason. */
  onSelectAgentBoard(): void;
  onCloseAgentBoard(): void;
```

Wire them in `App` (`src/ui/app.tsx`, the `<TabStrip …>` mounts — there are two, top-tab
at ~2033 and sidebar at ~2098) as the exact analogue of `selectBrowserTab` /
`closeBrowserTab` (`app.tsx:1470-1483`), which read:

```ts
  const selectBrowserTab = (): void => {
    if (browserSurfaceActive.value) return;
    fileController.deactivate();
    activateBrowserSurface();
    tabsRef.current?.notifySurfacesChanged();
  };
```

so the Board's are:

```ts
  /** The Board chip: it takes the stage from whichever surface has it. */
  const selectAgentBoardTab = (): void => {
    if (agentBoardSurfaceActive.value) return;
    fileController.deactivate();
    if (browserSurfaceActive.value) {
      deactivateBrowserSurface(defaultBrowserClient);
    }
    activateAgentBoard();
    tabsRef.current?.notifySurfacesChanged();
  };
  /** The Board chip's ✕: the chip leaves the strip; the panes are untouched. */
  const closeAgentBoardTab = (): void => {
    closeAgentBoard();
    tabsRef.current?.notifySurfacesChanged();
    tabsRef.current?.focusActive();
  };
```

`notifySurfacesChanged()` is not optional: it is what makes `TabManager` re-derive
`tabViews` and the strip's status after a surface transition this closure caused.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/ui/stage-surface-strip.test.ts src/ui/tab-strip.test.tsx`
Expected: PASS.

- [x] **Step 6: Typecheck and format**

Run: `npx tsc --noEmit && npx prettier --check src/ui/stage-surface-strip.ts src/ui/tab-strip.tsx`
Expected: clean.

- [x] **Step 7: Commit**

```bash
git add src/ui/stage-surface-strip.ts src/ui/stage-surface-strip.test.ts \
        src/ui/tab-strip.tsx src/ui/tab-strip.test.tsx src/ui/tab-bar.tsx src/ui/app.tsx
git commit -m "feat(board): give the strip a third surface kind

`composeSurfaceStrip` published \"files, then the browser's one slot\" and
`TabStrip` read every non-file slot as the browser — true at two kinds,
silently wrong at three. Slots are described by kind now, so the chip render
is a lookup rather than an inference, and TabManager still consumes only
SurfaceStrip (R4).

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

