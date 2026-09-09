# Agent Board wiring — Tasks 14–15 (close, tier 3, docs, gates)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **Forks** and **Gates** first.

---

### Task 14: Close and Open in stage

Spec §5.5 tier 3 and §5.6's `Close`. Both reach seams that already exist — this task is
the routing and the two decisions that go with it.

**Files:**

- Modify: `src/ui/agent-board-actions.ts` (`onOpenInStage`, `onClose`)
- Test: `src/ui/agent-board-actions.test.ts`

**Interfaces:**

- Consumes: `TabManager.activateForAttention(index, paneId)` (exists — it deactivates the
  surface, activates the tab, focuses the pane and acks, which is exactly tier 3), plus
  `deps.notifySurfacesChanged` and `deps.focusActive`, which `onEscape` already uses for
  the same reason;
  `TabManager.closePaneAt(index, paneId): Promise<void>` (exists, DL-27.21);
  `BoardCard.tabIndex` (the model already carries it).
- Produces: nothing new.

- [x] **Step 1: Write the failing test**

Append to `src/ui/agent-board-actions.test.ts`, using its `fakeDeps(overrides)`:

```ts
describe("tier 3 and Close", () => {
  const card = (over: Partial<BoardCard> = {}): BoardCard =>
    ({ paneId: 11, tabIndex: 0, ...over }) as BoardCard;

  it("hands the stage to the pane, and the chip survives", () => {
    resetAgentBoardStore();
    openAgentBoard();
    const activateForAttention = vi.fn();
    createBoardActions(fakeDeps({ manager: { activateForAttention } })).onOpenInStage(card());
    expect(activateForAttention).toHaveBeenCalledWith(0, 11);
    // Without these two the strip goes stale and the caret drops to <body> —
    // exactly what `onEscape` pairs them for.
    expect(deps.notifySurfacesChanged).toHaveBeenCalled();
    expect(deps.focusActive).toHaveBeenCalled();
    // `activateForAttention` calls `surfaces.deactivate()`, which is what steps
    // the Board off the stage; the CHIP is untouched, so ⌘⇧O brings it back.
    expect(agentBoardOpen.value).toBe(true);
  });

  it("closes the pane and clears a selection that named it", async () => {
    const closePaneAt = vi.fn().mockResolvedValue(undefined);
    const deps = fakeDeps({ manager: { closePaneAt }, selectedPaneId: () => 11 });
    createBoardActions(deps).onClose(card());
    await flushMicrotasks();
    expect(closePaneAt).toHaveBeenCalledWith(0, 11);
    // A panel about a pane that is gone is a panel about nothing.
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("leaves a selection alone when a DIFFERENT card is closed", async () => {
    const closePaneAt = vi.fn().mockResolvedValue(undefined);
    const deps = fakeDeps({ manager: { closePaneAt }, selectedPaneId: () => 11 });
    createBoardActions(deps).onClose(card({ paneId: 12 }));
    await flushMicrotasks();
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-board-actions.test.ts -t "tier 3"`
Expected: FAIL — both handlers are no-ops.

- [x] **Step 3: Wire both**

In `src/ui/agent-board-actions.ts`:

```ts
    /**
     * Tier 3 (spec §5.5): `activateForAttention` is the whole act — it
     * deactivates the surface (which steps the Board off the stage), activates
     * the tab, focuses the pane and acknowledges it. The chip STAYS open, so
     * ⌘⇧O brings the Board straight back; only its turn on the stage ended.
     *
     * The ack is the one this path is supposed to make: the user is now
     * looking at the pane.
     */
    onOpenInStage: (card) => {
      deps.manager?.activateForAttention(card.tabIndex, card.paneId);
      // The same three steps `onEscape` takes (Task 5 shipped it at
      // `agent-board-actions.ts`): `activateForAttention` calls
      // `surfaces.deactivate()`, which steps the Board off the stage — but the
      // TAB layer's derived views cannot see a store-signal transition on their
      // own, and the Board's root held DOM focus, so without these two the
      // strip is stale and the caret lands on <body>.
      deps.notifySurfacesChanged();
      deps.focusActive();
    },
    /**
     * Close (spec §5.6, DL-27.21): the pane goes, and its tab follows only
     * when it was the last one — `closePaneAt`'s own contract, decided from
     * `paneCount()`, never from the Board's card count.
     *
     * The selection is cleared only when it NAMED this pane: a panel about a
     * pane that is gone is a panel about nothing, and clearing it
     * unconditionally would close a panel the user is reading about another
     * card.
     */
    onClose: (card) => {
      void deps.manager?.closePaneAt(card.tabIndex, card.paneId).then(() => {
        if (deps.selectedPaneId() === card.paneId) {
          deps.clearSelection();
        }
      });
    },
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/ui/agent-board-actions.test.ts src/ui/agent-board-surface.test.tsx src/terminal/close-coordinator.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts
git add src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts
git commit -m "feat(board): step to the full stage, and close a pane from the card

Spec §5.5 tier 3 and §5.6. activateForAttention is the whole of tier 3 — it
deactivates the surface, activates the tab, focuses the pane and acks — and
the ack is the one this path is supposed to make, because the user is now
looking at the pane. The chip stays open, so the chord brings the Board back.

Close routes through closePaneAt, whose own contract decides whether the tab
follows from paneCount(), never from the Board's card count. The selection is
cleared only when it named that pane.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 15: Docs, gates and the native pass

Nothing here changes behaviour. It states what was built, what was verified and what was
not, and runs the gates the whole plan is judged by.

**Files:**

- Modify: `AGENTS.md` (the current-direction entry, the fork queue, the drift table)
- Modify: `docs/CONTEXT.md` (a dated section)
- Modify: `docs/DESIGN-LANGUAGE.md` (the §34 drift row)
- Modify: `docs/specs/2026-09-03-agent-board-design.md` (the header's build state)
- Modify: `docs/plans/2026-09-04-agent-board-wiring*.md` (mark the tasks done)

- [x] **Step 1: Run every automated gate and paste the output**

```bash
npx tsc --noEmit
npx tsc -p tsconfig.electron.json --noEmit
npm test
npm run build
npm run electron:build
npm run generate:menu:check
npx prettier --check $(git diff --name-only 4d8159a..HEAD -- '*.ts' '*.tsx' '*.css')
```

**Before believing a red typecheck, check the PATHS.** An untracked or in-flight test file
from another task in this plan can make `npx tsc --noEmit` non-clean for a reason that
belongs to no committed diff. Run it, read every path it names, and only then decide whose
it is.

**Attribution rules.** Known-not-yours at this base: the design-language citation gate
(**19 passed / 1 failed**, that one listing exactly nine citations from `main`'s
uncommitted DESIGN-LANGUAGE) and three `marketing/landing-prototype` suites that fail at
COLLECTION because `install-command.js` is untracked in `main`. Anything else is yours
until proven otherwise — reproduce it on a pristine `HEAD` worktree before attributing
it to another session, and say which.

- [x] **Step 2: Run the native pass — the point of this plan**

Green suites are not this gate.

```bash
npm run electron:dev
```

**Isolate the `userData` first, and do NOT edit `main.ts` to do it.**
`electron/main.ts` never calls `app.setPath("userData", …)` — line 81 is
`const stores = new StoreRegistry(app.getPath("userData"));` — so every Electron run
reads and writes the SAME `~/Library/Application Support/Electron` the owner's real
sessions use. Chromium's `--user-data-dir` switch does not move it.

Launch through a wrapper in the SESSION SCRATCHPAD (F4 — never inside the repo) that sets
the path before requiring the compiled main:

```js
// /tmp/deck-board-dev/launch.cjs
const { app } = require("electron");
app.setPath("userData", "/tmp/deck-board-dev/userdata");
require("<worktree>/dist-electron/electron/main.cjs");
```

```bash
npm run build && npm run electron:build
npx electron /tmp/deck-board-dev/launch.cjs
```

Two instances coexist — `main.ts` has no `requestSingleInstanceLock` — so this does not
collide with an `electron:dev` the owner already has open. **Never seed
`lastAgent: "claude"` into that userData**: it spawns a real, unattended Claude Code
session in the test PTY. After the run, prove the isolation held by checking that the
real `~/Library/Application Support/Electron/workspaces.json` mtime did not change, and
paste that check.

**The three steps most likely to fail, in order** — everything up to here rests on suites
and typechecks, and this walk is the first evidence of a different class:

- **Step 6, Restart resuming the RIGHT conversation.** Check the id in the agent's own
  session list, not in Deck. This is where `lastSessionId` either works or silently
  degrades to "latest", and a wrong-but-plausible conversation looks like success.
- **Step 5, Stop leaving the pane alive.** The card must stay, turn `ended`, and only
  offer Restart once the classifier's poll has seen the shell — not immediately.
- **Step 2, leaving the Board restoring the sidebar the user actually had.** Test it with
  the sidebar already collapsed BEFORE opening the Board: the surface must give back that
  state, not an expanded one.

Walk, and record each result with a screenshot:

1. **⌘⇧O opens the Board.** The chip appears in the strip in open order; the surface
   covers the terminal grid.
2. **The sidebar goes to width 0** and `SidebarToggle` is not drawn; leaving the Board
   restores exactly what was there, and Settings still reports the user's own
   `sidebarCollapsed`.
3. **Select a card.** The panel opens, the snapshot shows that pane's real scrollback,
   **no terminal steals DOM focus**, and the tab strip's active terminal chip is
   unchanged.
4. **`Open in stage`** hands the stage to that pane; ⌘⇧O brings the Board back with the
   same selection.
5. **Stop a real agent.** The shell prompt returns in that pane, the pane stays, the card
   stays and turns `ended`, and Restart appears on it within the classifier's poll.
6. **Restart.** The agent's own session list names the same conversation id it had
   before — check in the agent's UI, not in Deck's.
7. **Reply.** To a `working` pane it sends; to a pane that has not run a turn it lands as
   _placed_ and the panel says so.
8. **Quit and relaunch.** The Board comes back open, and a window with zero tabs does not.

- [x] **Step 3: Write the documentation**

`AGENTS.md` — replace the Agent Board bullet's "Not built: every seam" list with what now
exists, keep the verification state honest, and add one line to the open fork queue
naming this plan's seams. **`MaterializeIntent.panePrompts` must be named there
explicitly**: it is a tab-materialization widening the plan's own fork table did not
foresee, taken in Task 8 because spec §11.2's persisted prompt has to reach a pane and
`session-restore.ts` never learns a pane id. Say that it mirrors `paneCommands` exactly,
and that the `(workspace, agent)` mark alternative is the one withdrawn on 2026-08-22.

**The Tauri exposure must be stated, not papered over.** `hostHasAgentBoard` gates the
KEYSTROKE only: the menu path never asks it, `menu_registry.rs` is Tauri's own menu and
carries View ▸ Agent Board, and the surface mounts on `agentBoardSurfaceActive` with no
host gate. On Tauri that menu item opens a Board with no tails and no worktree grouping.
`toggle-browser` has the identical exposure today, so record it as the repo's existing
posture and a named parity gap — do NOT write that the predicate hides the surface.

Three things Task 8 left for this step to state honestly:
- **`agentBoardSurfaceActive` is not persisted**, so the schema cannot express "the Board
  was ON the stage" — a boot restores the chip, not the surface. Confirm against spec
  §4.2's "opens itself at boot" during the native pass and record which reading shipped.
- **`resumeWorkspace` restores prompts too**, because the archive carries `SessionTab`.
  Wider than "boot restore"; benign, but say it.
- **The archive's size bound moved**: 24 workspaces × 32 tabs × panes × up to 4 KiB of
  prompt. Nobody has measured a real `session.json` against it. `docs/CONTEXT.md` — a new dated section, `## The agent board is
wired — 2026-09-04`, linking the spec and both plans. `docs/DESIGN-LANGUAGE.md` — update
§34's drift row from `gallery-only`. The spec header — replace "nothing is wired" with
the built state and the evidence class.

Every claim states its evidence class: suite/build, browser measurement, or a native
run. **Windows is Gate C — unverified.**

- [x] **Step 4: Mark the plan done**

Tick every `- [ ]` in all six plan files, and add a one-line result under each task that
deviated from its written code.

- [x] **Step 5: Commit the docs, then checkpoint**

```bash
git add AGENTS.md docs/CONTEXT.md docs/DESIGN-LANGUAGE.md \
        docs/specs/2026-09-03-agent-board-design.md docs/plans/2026-09-04-agent-board-wiring*.md
git commit -m "docs(context): record the agent board's wiring and its evidence

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

Then run the `checkpoint` skill (W11).

**Do not merge and do not push.** The merge waits for the daily-surfaces release; that is
the owner's call, not this plan's.

---

## Self-review against the spec

Run before dispatching Task 1, and again after Task 14.

| Spec section | Task | Note |
| --- | --- | --- |
| §4.1 the surface | 1, 5 | third strip kind + `.stage__surface` mount |
| §4.2 the toggle | 6 | action, chord, host predicate |
| §4.2 memory | 8 | `agentBoardOpen`, main record only, zero tabs → false |
| §4.2 / DL-34.1 sidebar | 7 | width 0, no settings write, toggle omitted |
| §4.4 empty states | — | already built in plan A; Task 5's mount is what makes them reachable |
| §5.2 held sort | 5 | `selectBoardCard` freezes the order the user is looking at |
| §5.5 selection | 9 | Board-local; Task 9 PROVES no tab-layer seam is needed |
| §5.5 tier 3 | 14 | `activateForAttention` |
| §11.8 confidence is the tracker's | 2, 4 | `PaneView.confidence`, projected not derived |
| §5.6 Stop | 12 | `pty_kill_foreground` |
| §5.6 Restart | 13 | the resume composition, reading Task 10b's id |
| §11.11 `lastSessionId` | 10b | kept in `forget`, past the delete that empties `paneSessionIds` |
| §4.2 focus after the chord | 6 | `syncViews()` + `activeManager()?.focusActive()`, copied from `toggle-browser` |
| §4.4 the empty-state control | 5 | `openTaskLauncher(activeWorkspacePath())`, not a bare new tab |
| §5.6 Close | 14 | `closePaneAt` |
| §5.7 the fold | — | **built 2026-09-04** on plan A's branch (`98e092a`); measured in §14.5 |
| §6 the nav | — | built in plan A; Task 5 binds its two filters |
| §7.2 the panel's rows | 4 | `confidence` reaches the `State` row |
| §7.3 the snapshot | 10 | `serializePane` |
| §7.3 its refresh cadence | 11b | added after Task 10 found the plan had dropped it |
| §7.4 the reply | 11 | `injectIntoPane`, only `sent` acks |
| §11.1 ordinal + uptime | 2 | `ordinal`, `startedAt` |
| §11.2 the task prompt | 3, 8 | `board-task-prompts.ts` at runtime, `SessionPane.taskPrompt` across a restart |
| §11.3 board state per window | — | built in plan A (`agent-board-store.ts`) |
| §11.4 acknowledge without focus | 9 | `acknowledgePane` |
| §7.5 disabled actions on a dead pane | 10 | `paneAlive` off `life.exited` |
| DL-34.1 the dock | 7 | `dockPaintedOpen` AND `dockVisible` gain the Board — the first is what paints |
| §4.2 zero tabs = no Board | 5, 8 | an App effect at runtime, the journal rewrite at rest |
| §11.8 confidence | 4 | `confidenceOf` |
| §11.11 the departed agent | 2 | `lastAgent` |
| §13 host scope | 6 | `hostHasAgentBoard` |

**Not in this plan, on purpose:** cross-window behaviour (the Board is window-scoped and
each window has its own), a Tauri implementation (§13), Windows verification (Gate C),
and anything in spec §16's out-of-scope list.
