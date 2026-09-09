# Agent Board wiring — Tasks 11–13 (reply, Stop, Restart)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **Forks** and **Gates** first.

---

### Task 11: The reply box through the inject gate

Spec §7.4 and DL-34.7: text is placed; Enter follows only when `submitAllowed` allows it
AND the pane has reached `working` once. A real question gets the text placed and not
sent, and the panel says so. **Only a `sent` outcome acknowledges the pane.**

`TabManager.injectIntoPane` already IS half that gate — it pastes, re-reads fresh pane
info, requires the attention revision to be unchanged across the await, and calls
`submitAllowed`. This task does not re-implement any of it.

**The other half is this task's own, and it is the dangerous one.**
`submitAllowed({ expectedAgent, info, attention, alive })` has **no `hasRun` input**, so
it cannot enforce DL-34.7's second condition — "the pane has reached `working` once". A
fresh `claude` sitting on its trust-this-folder menu reads `idle` and PASSES that gate
(recorded: a first-run dialog reads idle), so `autoSend: true` there would press Enter on
a security prompt nobody read. `autoSend` is therefore the CARD's `hasRun`, and a pane
that has never run a turn comes back `pasted`.

**Files:**

- Modify: `src/ui/agent-board-actions.ts` (`onReply`, and `boardPanelState`'s reply fields)
- Modify: `src/ui/agent-board-model.ts` (`BoardCard.hasRun`)
- Test: `src/ui/agent-board-actions.test.ts`, `src/ui/agent-board-model.test.ts`

**Not `app.tsx`, and not `app.test.tsx`.** This repo has no `<App>` render harness (see
the plan header's harness section), which is exactly why Task 5 put the actions in an
injectable factory. `App` only supplies the deps.

**Interfaces:**

- Consumes: `injectIntoPane(paneId, text, { autoSend, expectedAgent }): Promise<InjectOutcome>`
  where `InjectOutcome = "sent" | "pasted" | "failed" | "busy" | "no-target"`;
  `acknowledgePane(paneId)` (Task 9); `BoardPanelState` from `./agent-board-panel`.
- Produces: `BoardCard.hasRun: boolean` — one field on the model, projected straight from
  `PaneView.hasRun` (which `agent-board-model.ts` already reads for row 4's task rule),
  plus one handler and two signals in `App`.

- [x] **Step 1: Write the failing test**

Append to `src/ui/agent-board-actions.test.ts`, using the `fakeDeps(overrides)` helper
Task 5 created there:

```ts
describe("onReply", () => {
  const card = (over: Partial<BoardCard> = {}): BoardCard =>
    ({ paneId: 11, agent: "claude", hasRun: true, ...over }) as BoardCard;

  it("does not press Enter in a pane that has never run a turn", async () => {
    // A fresh claude on its trust-this-folder menu reads no attention at all
    // and passes `submitAllowed`; DL-34.7's second condition is what stops it.
    const injectIntoPane = vi.fn().mockResolvedValue("pasted");
    const deps = fakeDeps({ manager: { injectIntoPane } });
    createBoardActions(deps).onReply(card({ hasRun: false }), "1");
    await flushMicrotasks();
    expect(injectIntoPane).toHaveBeenCalledWith(11, "1", {
      autoSend: false,
      expectedAgent: "claude",
    });
  });

  it("acknowledges the pane only when the reply was actually sent", async () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const acknowledgePane = vi.fn();
    const deps = fakeDeps({ manager: { injectIntoPane, acknowledgePane } });
    createBoardActions(deps).onReply(card(), "yes please");
    await flushMicrotasks();
    expect(injectIntoPane).toHaveBeenCalledWith(11, "yes please", {
      autoSend: true,
      expectedAgent: "claude",
    });
    expect(acknowledgePane).toHaveBeenCalledWith(11);
    expect(deps.setNotice).toHaveBeenLastCalledWith(null);
  });

  it("says the text was placed when the gate refused to press Enter", async () => {
    const acknowledgePane = vi.fn();
    const deps = fakeDeps({
      manager: { injectIntoPane: vi.fn().mockResolvedValue("pasted"), acknowledgePane },
    });
    createBoardActions(deps).onReply(card(), "maybe");
    await flushMicrotasks();
    expect(acknowledgePane).not.toHaveBeenCalled();
    expect(deps.setNotice).toHaveBeenLastCalledWith("placed — confirm in the terminal");
  });

  it("reports a failed delivery instead of pretending it landed", async () => {
    const deps = fakeDeps({ manager: { injectIntoPane: vi.fn().mockResolvedValue("failed") } });
    createBoardActions(deps).onReply(card(), "nope");
    await flushMicrotasks();
    expect(deps.setNotice).toHaveBeenLastCalledWith(expect.stringContaining("could not"));
  });

  it("refuses an empty reply and a second press while one is in flight", async () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const deps = fakeDeps({ manager: { injectIntoPane }, isSending: () => true });
    createBoardActions(deps).onReply(card(), "   ");
    createBoardActions(deps).onReply(card(), "hello");
    await flushMicrotasks();
    expect(injectIntoPane).not.toHaveBeenCalled();
  });
});
```

`flushMicrotasks` is `() => new Promise((r) => setTimeout(r, 0))` — one local helper in
that file, matching `tab-manager.fixtures.ts`'s own `flush()`.

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/agent-board-actions.test.ts`
Expected: FAIL — `onReply` is a no-op, so `injectIntoPane` is never called.

- [x] **Step 3: Carry `hasRun` onto the card**

In `src/ui/agent-board-model.ts`, add the field to `BoardCard`:

```ts
  /**
   * This pane's agent has reached `working` at least once (`PaneView.hasRun`).
   *
   * On the card because the REPLY needs it (DL-34.7): `submitAllowed` has no
   * `hasRun` input, so nothing downstream could enforce "and the pane has
   * reached working once" without it. Row 4's task rule already read the same
   * fact off `PaneView` — this is the same bit, projected.
   */
  readonly hasRun: boolean;
```

and set it where the card is built: `hasRun: draft.located.pane.hasRun`. Add one model
assertion:

```ts
it("carries hasRun onto the card", () => {
  const view = buildAgentBoard({ ...BASE, tabs: [tab(1, DECK, [pane(101, "claude", "none", "idle", NOW, false)])] });
  expect(view.cards[0].hasRun).toBe(false);
});
```

matching the fixture helpers that file already has. Update the card, panel and surface
test fixtures that build a `BoardCard` literal.

- [x] **Step 4: Wire the handler**

In `src/ui/agent-board-actions.ts`, replace the `onReply` stub (the notice and
in-flight signals already reach it through `deps.setNotice` / `deps.setSending`, which
`App` wired in Task 5):

```ts
    /**
     * Spec §7.4 / DL-34.7. `injectIntoPane` IS the gate — it pastes, re-reads
     * fresh pane info, requires the attention revision to be unchanged across
     * the await, and asks `submitAllowed`. Nothing here re-decides any of
     * that; the outcome is mapped onto what the panel says.
     *
     * `requested` attention is refused on purpose inside that gate, so a REAL
     * question gets `pasted` — the text is in the agent's composer and the
     * user presses Enter themselves. That is the "placed" notice, not a
     * failure.
     */
    onReply: (card, text) => {
      if (text.trim() === "" || deps.isSending()) return;
      deps.setSending(true);
      deps.setNotice(null);
      void deps.manager
        ?.injectIntoPane(card.paneId, text, {
          // DL-34.7's second condition, which `submitAllowed` cannot see: a
          // pane that has not reached `working` once gets the text PLACED and
          // nothing pressed. Its dialog reads `idle` and would otherwise pass.
          autoSend: card.hasRun,
          expectedAgent: card.agent,
        })
        .then((outcome) => {
          if (outcome === "sent") {
            // The ONLY acknowledging path from the Board besides tier 3
            // (spec §5.5): the user answered, so the question is answered.
            deps.manager?.acknowledgePane(card.paneId);
            deps.setNotice(null);
            return;
          }
          deps.setNotice(
            outcome === "pasted"
              ? "placed — confirm in the terminal"
              : "could not reach the agent — open it in stage",
          );
        })
        .finally(() => {
          deps.setSending(false);
        });
    },
```

and finish `boardPanelState`'s reply fields in the same module:

```ts
  return {
    snapshot: deps.manager?.serializePane(card.paneId, BOARD_SNAPSHOT_LINES) ?? null,
    // A departed pane has no agent to answer (spec §7.4); a dead one has no
    // PTY at all.
    replyEnabled: !card.departed && deps.manager?.paneAlive(card.paneId) === true,
    replyNotice: deps.notice(),
    sending: deps.isSending(),
    paneExited: deps.manager?.paneAlive(card.paneId) === false,
  };
```

adding `readonly notice: () => string | null;` to `BoardActionDeps` beside `isSending`.
`App` already passes the selected `BoardCard` in — it holds the one `useAgentBoardView()`
result and hands the same object to both the surface and this function, so the panel
state and the rendered grid can never disagree about which card is selected.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/ui/agent-board-actions.test.ts src/ui/agent-board-panel.test.tsx src/ui/agent-board-surface.test.tsx src/ui/agent-board-model.test.ts src/ui/agent-board-card.test.tsx`
Expected: PASS.

- [x] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts src/ui/agent-board-model.ts
git add src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts \
        src/ui/agent-board-model.ts src/ui/agent-board-model.test.ts
git commit -m "feat(board): send a reply through the inject gate

Spec §7.4, DL-34.7. injectIntoPane already IS the gate — paste, re-read fresh
pane info, require an unchanged attention revision across the await, then ask
submitAllowed — so this maps its outcome rather than re-deciding it. A real
question is refused by that gate on purpose and comes back 'pasted': the text
sits in the agent's composer and the panel says 'placed — confirm in the
terminal'. Only 'sent' acknowledges.

DL-34.7's SECOND condition is enforced here rather than there: submitAllowed
has no hasRun input, and a fresh claude on its trust-this-folder menu reads
idle and passes it — so autoSend is the card's own hasRun, and a pane that has
never run a turn can only ever be pasted into.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 12: Stop — the `pty_kill_foreground` channel

Spec §5.6 and §11.6: Stop ends the agent PROCESS; the pane stays, its shell returns, and
the card stays as `idle` wearing the agent's name. `PtyClient` has only `killPty`, which
ends the whole session. **PTY ownership AND an R6 contract — a fork, resolved in spec §12.**

**Files:**

- Modify: `electron/ipc/channels.ts`
- Modify: `electron/main.ts`
- Modify: `electron/pty/manager.ts`
- Modify: `electron/preload.ts` (if it enumerates channels — read it)
- Modify: `src/ui/agent-board-actions.ts` — **this task adds `pty` to `BoardActionDeps`
  as well.** Task 5 could not: `Pick<PtyClient, "killForeground">` is `TS2344` while the
  member does not exist, and the structural alternative `{ killForeground?(): … }` is a
  weak type that rejects `defaultPtyClient` outright ("no properties in common"). Same
  rule as `BoardManagerSeams` — the task that implements a seam declares it. Add the
  optional `PtyClient` member and the deps field in ONE commit, or neither compiles.
- **Do NOT modify** `createMemoryPtyClient`: an absent optional member is the correct
  shape for a client with no channel.
- Modify: `src/terminal/pty-client.ts`
- Modify: `src/ui/agent-board-actions.ts` (`onStop`)
- Test: `electron/pty/manager.test.ts`, `scripts/electron-ipc-contract.test.ts`,
  `src/ui/agent-board-actions.test.ts`

**Interfaces:**

- Consumes: `platform().foregroundProcess(rows, ttyName, shellPid)` and
  `platform().terminateProcessGroups(foregroundGroup, shellGroup, graceMs)` — both exist
  in `electron/platform/macos.ts`.
- Produces:

  ```ts
  // electron/ipc/channels.ts
  ptyKillForeground: "pty_kill_foreground";
  // electron/pty/manager.ts
  async killForeground(windowLabel: string, id: number): Promise<void>;
  // src/terminal/pty-client.ts — OPTIONAL, and implemented once
  killForeground?(id: number): Promise<void>;
  ```

- [x] **Step 1: Write the failing tests**

Append to `electron/pty/manager.test.ts`:

**The two fixtures below replace the ones an earlier draft carried, which tested the wrong
thing.** `foregroundProcess` returns the SHELL's own row when nothing else holds the tty
(`tpgid` is the shell's pgid, so the leader IS the shell), which means "bare shell" is
`group === shellPid`, not `null` — `null` means the tty was missing from the table
altogether. The old "signals" case used `{ pid: 4242, group: 4242 }`, which equals the fake
pty's pid and would have hit the implementation's own shell-is-foreground guard; the old
"bare shell" case used `null` and never exercised that guard at all. Use a group DIFFERENT
from the pty's pid for the signal case, `group === pty.pid` for bare shell, and add a
third case for a reaped leader (`group: null`).

**`PtyManagerDeps` has no `platform` seam** — `electron/pty/manager.ts:49-57` is
`emitToOwner` / `register` / `unregister` / `assertOwner`, and `platform()` is a private
function at `:24-26`. Adding a seam there is a PTY-ownership fork this plan does not
open. The suite already mocks the platform module at module scope with a FIXED foreground
process (`manager.test.ts:31-37`):

```ts
const terminateSpy = vi.hoisted(() => vi.fn());
vi.mock("../platform/macos", async (importOriginal) => ({
  …,
  foregroundProcess: () => ({ pid: 4242, group: 4242, name: "claude" }),
  terminateProcessGroups: terminateSpy,
}));
```

Make that literal a mutable local so one case can say "bare shell", and note that
`manager.spawn(...)` is **synchronous** (`manager.test.ts:74`
`const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });`):

```ts
// beside the existing hoisted spy, and read by the mock factory:
//   foregroundProcess: () => foreground,
let foreground: { pid: number; group: number; name: string } | null = {
  pid: 4242,
  group: 4242,
  name: "claude",
};

describe("killForeground", () => {
  it("signals the foreground GROUP and spares the shell's own", async () => {
    // A group DIFFERENT from the pty's own pid: a real foreground job.
    foreground = { pid: 5150, group: 5150, name: "claude" };
    const manager = /* this suite's own construction — see the top of the file */;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    await manager.killForeground("main", id);
    // The pgid is resolved in MAIN: a pgid never crosses IPC, and signalling a
    // group MEMBER's pid would hit nothing. `null` is the shell's own group,
    // deliberately spared — that is the whole difference from `kill`.
    expect(terminateSpy).toHaveBeenCalledWith(5150, null);
  });

  it("leaves the pane itself alive — Stop is not close", async () => {
    // Without this, an implementation that copy-pasted `terminate()` passes on
    // the `null` second argument alone: it would signal the right group AND
    // kill the pty.
    foreground = { pid: 5150, group: 5150, name: "claude" };
    const manager = /* … */;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    await manager.killForeground("main", id);
    expect(fakePty.kill).not.toHaveBeenCalled();
  });

  it("signals nothing when the leader was reaped and members still hold the tty", async () => {
    // `group: null` is NOT a bare shell — it is an unresolvable group, and a
    // member's pid is not a group id.
    foreground = { pid: 5150, group: null, name: "claude" };
    const manager = /* … */;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    await manager.killForeground("main", id);
    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the pane is already a bare shell", async () => {
    // The shell IS the foreground group — that is what a bare shell looks
    // like, not a null group.
    foreground = { pid: FAKE_PTY_PID, group: FAKE_PTY_PID, name: "zsh" };
    const manager = /* … */;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    await manager.killForeground("main", id);
    expect(terminateSpy).not.toHaveBeenCalled();
  });

  it("refuses a pane another window owns", async () => {
    const manager = /* … */;
    const id = manager.spawn("main", { cols: 80, rows: 24, cwd: null });
    await expect(manager.killForeground("other", id)).rejects.toThrow();
  });

  it("is a no-op for an id with no session", async () => {
    const manager = /* … */;
    await expect(manager.killForeground("main", 9999)).resolves.toBeUndefined();
  });
});
```

Fill each `/* … */` from that file's own manager construction — do NOT invent a
`makeManager({ platform })` helper; there is none, and the seam it implies does not exist.

Append the channel to `scripts/electron-ipc-contract.test.ts` the way that file already
asserts every other channel (read it: it checks the flat payload shape and that main
registers a handler for each name).

Append to `src/ui/agent-board-actions.test.ts`:

```ts
it("stops the agent without killing the pane", () => {
  const killForeground = vi.fn().mockResolvedValue(undefined);
  const closePaneAt = vi.fn();
  const deps = fakeDeps({ pty: { killForeground }, manager: { closePaneAt } });
  createBoardActions(deps).onStop({ paneId: 11 } as BoardCard);
  expect(killForeground).toHaveBeenCalledWith(11);
  expect(closePaneAt).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run them and watch them fail**

Run: `npx vitest run electron/pty/manager.test.ts scripts/electron-ipc-contract.test.ts src/ui/app.test.tsx`
Expected: FAIL — `killForeground` is not a function.

- [x] **Step 3: Add the channel**

In `electron/ipc/channels.ts`, in the Electron-only block beside `createDirectory`:

```ts
  // Agent Board Stop (spec §5.6, §11.6). Electron-only like the block above:
  // no `#[tauri::command]` counterpart, and Tauri is feature-frozen. Flat
  // `{ id }` — main resolves the foreground process GROUP itself, because a
  // pgid does not cross IPC and signalling a group member's pid hits nothing.
  ptyKillForeground: "pty_kill_foreground",
```

- [x] **Step 4: Implement it in the manager**

In `electron/pty/manager.ts`, beside `kill`:

```ts
  /**
   * End the agent running in a pane and leave the pane alive (spec §5.6).
   *
   * The first half of `terminate` — the foreground group's SIGHUP, then
   * SIGKILL after `KILL_GRACE_MS` — with the shell's own group deliberately
   * spared, which is the whole difference between Stop and `kill`. That
   * split is exactly how `terminateProcessGroups` is already parameterised,
   * so this is a reuse, not a second signal choice.
   *
   * A pane with no foreground job (a bare shell) signals nothing rather than
   * falling back to the shell: Stop on a shell must not close the pane.
   */
  async killForeground(windowLabel: string, id: number): Promise<void> {
    const session = this.store.get(id);
    if (session === undefined) {
      return;
    }
    this.deps.assertOwner(id, windowLabel);
    let rows: readonly PsRow[] = [];
    try {
      rows = await platform().readProcessTable();
    } catch {
      return; // no table, no group to signal — never guess at a pid
    }
    const foreground = platform().foregroundProcess(rows, session.ttyName, session.pty.pid);
    if (foreground?.group == null || foreground.group === session.pty.pid) {
      // No job, or the shell IS the foreground group: nothing to stop.
      return;
    }
    platform().terminateProcessGroups(foreground.group, null);
  }
```

Register it in `electron/main.ts` beside `killPty`:

```ts
ipcMain.handle(CHANNELS.ptyKillForeground, (event, { id }) =>
  pty.killForeground(labelOf(event), id),
);
```

- [x] **Step 5: Add the renderer facade**

**There is exactly ONE production client.** `createTauriPtyClient()`
(`pty-client.ts:69`) is what both hosts run — it goes through `invoke` from
`host/bridge`, which IS the Electron path (`bridge.ts:18` reads
`globalThis.__deckHost`). Its name is historical. A no-op "for Tauri" written there would
disable Stop on the only host that has it. `createMemoryPtyClient` (`:165`) is the test
double.

Host absence is expressed by an **optional member**, which is also load-bearing for
compilation: three other `PtyClient` literals exist (`src/files/monaco-smoke-main.tsx:59`,
`src/terminal/tab-manager.launch-task.test.ts:51` and `:364`) and a required member breaks
all three. The precedent is two lines above, at `pty-client.ts:29-30`:

```ts
  /** Electron-only cheap session CWDs; absent on the feature-frozen Tauri host. */
  sessionCwds?(ids: readonly number[]): Promise<readonly PtySessionCwd[]>;
```

So, in the interface:

```ts
  /**
   * End the agent process in a pane, leaving the pane's shell alive
   * (spec §5.6). Electron-only — no `#[tauri::command]` counterpart exists and
   * Tauri is feature-frozen, so the member is ABSENT there and every call site
   * uses `?.()`. That optional call is how "this host cannot do it" is said.
   */
  killForeground?(id: number): Promise<void>;
```

and one implementation, in `createTauriPtyClient` beside `killPty` (`:108-110`):

```ts
    killForeground(id) {
      return invoke("pty_kill_foreground", { id });
    },
```

`createMemoryPtyClient` gets nothing: an absent optional member is exactly what a client
without the channel should look like, and a test that needs it stubs it.

- [x] **Step 6: Wire the action**

In `src/ui/agent-board-actions.ts`:

```ts
    /**
     * Spec §5.6: Stop ends the AGENT and leaves the pane. The card stays,
     * turns `idle` wearing the agent's name (`lastAgent`), and offers Restart
     * once the classifier's poll has seen the shell — which is why nothing
     * here touches the card or the tab.
     */
    onStop: (card) => {
      // `?.()` because the member is optional (H8): a host without the channel
      // simply has nothing there, and the Board does not render on one anyway.
      void deps.pty.killForeground?.(card.paneId);
    },
```

- [x] **Step 7: Run the tests**

Run: `npx vitest run electron/pty/manager.test.ts scripts/electron-ipc-contract.test.ts src/terminal/pty-client.test.ts src/ui/agent-board-actions.test.ts`
Expected: PASS.

- [x] **Step 8: Typecheck both projects, format, commit**

```bash
npx tsc --noEmit && npx tsc -p tsconfig.electron.json --noEmit
npx prettier --check electron/ipc/channels.ts electron/main.ts electron/pty/manager.ts src/terminal/pty-client.ts src/ui/agent-board-actions.ts
git add electron/ipc/channels.ts electron/main.ts electron/pty/manager.ts \
        electron/pty/manager.test.ts scripts/electron-ipc-contract.test.ts \
        src/terminal/pty-client.ts src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts
git commit -m "feat(board): stop the agent and leave the pane

Spec §5.6, §11.6. PtyClient had only killPty, which ends the whole session.
pty_kill_foreground signals the foreground process GROUP — SIGHUP then SIGKILL
after KILL_GRACE_MS, the first half of terminateProcessGroups — and spares the
shell's own group, which is the entire difference between Stop and kill.

Main resolves the pgid: a pgid does not cross IPC, and signalling a group
member's pid hits nothing. A pane with no foreground job signals nothing
rather than falling back to the shell — Stop on a shell must not close a pane.
Electron-only; Windows is Gate C and unverified.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```

---

### Task 13: Restart — the resume composition

Spec §5.6 and §11.10: Restart **resumes** the conversation the pane was having. Every
piece exists; none of them is composed. `pane-lifecycle.ts`'s respawn is a bare shell and
is **not** this.

**One decision this task owns, surfaced by Task 2's implementer.** `PaneView.startedAt`
moves on agent IDENTITY only (`agent !== null && paneGenerations.get(id)?.agent !== agent`),
so claude → shell → **claude** keeps the FIRST `startedAt`. Restart resumes the SAME
agent, so a restarted card counts uptime from the original launch rather than from the
restart.

**Default: leave it.** Restart RESUMES a conversation — §17 Q4 refused a fresh relaunch,
and §17 Q18 keeps the ordinal, the selection and the task line for the same reason. An
uptime that continues across a resume describes the conversation, which is what the card
is about; resetting it would make Restart look like a new agent, which is precisely the
reading the grilling rejected. **If the owner's eye pass reads it the other way**, the
change is to add `hasRun` going true→false as a second boundary tell in Task 2's
generation check — the shape `session-tail-store.ts`'s own `isNewGeneration` already uses
(`:247-251`). Do not make that change on a hunch; note it and move on.

**Files:**

- Create: `src/terminal/pane-restart.ts`
- Create: `src/terminal/pane-restart.test.ts`
- Modify: `src/terminal/tab-manager.ts`, `src/terminal/tab-manager-types.ts` (`restartPane`)
- Modify: `src/ui/agent-board-actions.ts` (`onRestart`)

**Interfaces:**

- Consumes: **`PaneView.lastSessionId`** (Task 10b) — **never `paneSessionIds`**, which
  is empty by the time Restart is offered; `TabManager.launchCommandFor(paneId): string | null`,
  `buildResumeCommand(agent, ref, customAgents): string | null` (`src/lib/agent-resume.ts`),
  `applyResumeFlags(resumeCommand, launchCommand): string` (`src/lib/launch-command.ts`).
- Produces:

  ```ts
  export interface RestartInput {
    readonly agent: string;
    readonly sessionId: string | null;
    readonly launchCommand: string | null;
    readonly customAgents: readonly CustomAgent[];
  }
  export function restartCommandFor(input: RestartInput): string | null;
  // TabManager — and added to `BoardManagerSeams` in `agent-board-actions.ts`
  restartPane(paneId: number): Promise<boolean>;
  ```

- [x] **Step 1: Write the failing test**

Create `src/terminal/pane-restart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { restartCommandFor } from "./pane-restart";

const NO_CUSTOM: never[] = [];

describe("restartCommandFor", () => {
  it("resumes the exact session when one is known", () => {
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: "abc123",
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --resume abc123");
  });

  it("asks for the LATEST session when no id is known — never a bare relaunch", () => {
    // `buildResumeCommand` answers a null ref with `forms.bare`, which is the
    // fresh relaunch §17 Q4 refused. `{ kind: "latest" }` is the honest ask.
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: null,
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --continue");
  });

  it("folds the pane's own launch flags back in", () => {
    expect(
      restartCommandFor({
        agent: "claude",
        sessionId: "abc123",
        launchCommand: "claude --dangerously-skip-permissions",
        customAgents: NO_CUSTOM,
      }),
    ).toBe("claude --resume abc123 --dangerously-skip-permissions");
  });

  it("answers null for an agent with no resume form", () => {
    expect(
      restartCommandFor({
        agent: "not-an-agent",
        sessionId: null,
        launchCommand: null,
        customAgents: NO_CUSTOM,
      }),
    ).toBeNull();
  });
});
```

Check the exact expected strings against `COMMAND_TABLE` in `src/lib/agent-resume.ts`
before running — `latest` for claude is whatever that table says, not a guess.

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/terminal/pane-restart.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write the pure half**

Create `src/terminal/pane-restart.ts`:

```ts
import { buildResumeCommand } from "../lib/agent-resume";
import { applyResumeFlags } from "../lib/launch-command";
// `CustomAgent` lives in `lib/agent-catalog`. `settings-schema.ts` IMPORTS it
// (`:7`) and never re-exports it, so the obvious-looking path does not compile;
// `lib/agent-resume.ts:7` — the module right beside this one — takes it from
// the catalog for the same reason.
import type { CustomAgent } from "../lib/agent-catalog";

export interface RestartInput {
  /** The agent that was running — `PaneView.lastAgent`, not the live one. */
  readonly agent: string;
  /** The session the tail store confirmed for this pane, or null. */
  readonly sessionId: string | null;
  /** The command this pane launched with, flags included, or null. */
  readonly launchCommand: string | null;
  readonly customAgents: readonly CustomAgent[];
}

/**
 * The command Restart types into a pane whose agent has left (spec §11.10).
 *
 * A composition of four things that already exist and were never composed:
 * the pane's confirmed session id, its launch command, the CLI's own resume
 * form, and the flag fold session restore uses.
 *
 * **A null session id asks for the LATEST session, never a bare relaunch.**
 * `buildResumeCommand` answers a null ref with `forms.bare`, which is the
 * fresh start the grilling refused (§17 Q4) — Restart that quietly began a
 * new conversation would be a destructive act wearing a soft label.
 */
export function restartCommandFor(input: RestartInput): string | null {
  const ref = input.sessionId === null ? ({ kind: "latest" } as const) : { id: input.sessionId };
  const resume = buildResumeCommand(input.agent, ref, input.customAgents);
  if (resume === null) {
    return null;
  }
  return applyResumeFlags(resume, input.launchCommand);
}
```

`ResumeRef` is `{ kind: "id"; id: string } | { kind: "latest" } | null`
(`agent-resume.ts:10-11`) — import the type and use the tagged form; a bare `{ id }` does
not compile.

- [x] **Step 4: Add the tab-manager seam**

In `src/terminal/tab-manager.ts`:

```ts
  /**
   * Restart the agent a pane was running, resuming its conversation
   * (spec §5.6, §11.10).
   *
   * The write is what `AgentLauncher.arm` does — `writePty(command + "\r")`
   * into the pane's live shell — but `arm` itself fires once per pane id and
   * cannot be reused. The task prompt is deliberately NOT re-sent, and the
   * ordinal, the selection and the task line are all kept, because the pane
   * never goes away.
   *
   * Answers false when the pane is unknown, still running an agent, or its
   * agent has no resume form.
   */
  async function restartPane(paneId: number): Promise<boolean> {
    const owner = ownerOf(paneId);
    if (owner === undefined) {
      return false;
    }
    const view = tabViews.value
      .flatMap((tab) => tab.panes ?? [])
      .find((pane) => pane.paneId === paneId);
    const agent = view?.lastAgent ?? null;
    if (view === undefined || agent === null || view.agent !== null) {
      return false; // no agent to restart, or one is still running
    }
    const command = restartCommandFor({
      agent,
      // Task 10b's field, not `paneSessionIds`: that map is emptied by
      // `forget` at the exact agent→shell transition after which Restart is
      // offered, so reading it would silently degrade every Restart to
      // "latest".
      sessionId: view.lastSessionId ?? null,
      launchCommand: launchCommandFor(paneId),
      customAgents: settings.value.customAgents,
    });
    if (command === null) {
      return false;
    }
    // `paneIo`, not `pty` (`tab-manager.ts:204-210`): its `writePty` calls
    // `activity.noteInput(id)` first, which is what keeps the echoed command
    // out of the working spinner. `AgentLauncher` is built on it for exactly
    // this reason (`:225-229`).
    await paneIo.writePty(paneId, `${command}\r`);
    return true;
  }
```

Declare it in `tab-manager-types.ts` with that comment.

- [x] **Step 5: Wire the action**

In `src/ui/agent-board-actions.ts`:

```ts
    onRestart: (card) => {
      void deps.manager?.restartPane(card.paneId);
    },
```

with one assertion in `src/ui/agent-board-actions.test.ts`:

```ts
it("restarts through the tab layer, never by respawning a pane", () => {
  const restartPane = vi.fn().mockResolvedValue(true);
  createBoardActions(fakeDeps({ manager: { restartPane } })).onRestart({ paneId: 11 } as BoardCard);
  expect(restartPane).toHaveBeenCalledWith(11);
});
```

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/terminal/pane-restart.test.ts src/terminal/tab-manager.board-seams.test.ts src/ui/agent-board-actions.test.ts`
Expected: PASS.

- [x] **Step 7: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/pane-restart.ts src/terminal/pane-restart.test.ts src/terminal/tab-manager.ts src/ui/agent-board-actions.ts
git add src/terminal/pane-restart.ts src/terminal/pane-restart.test.ts \
        src/terminal/tab-manager.ts src/terminal/tab-manager-types.ts \
        src/ui/agent-board-actions.ts src/ui/agent-board-actions.test.ts
git commit -m "feat(board): restart a departed agent by resuming its conversation

Spec §5.6, §11.10. Every piece existed and none was composed: the pane's
confirmed session id, its launch command, the CLI's own resume form and the
flag fold session restore uses. A null session id asks for the LATEST session
rather than passing a null ref — buildResumeCommand answers null with
forms.bare, which is the fresh relaunch the grilling refused, and a Restart
that quietly started a new conversation would be a destructive act wearing a
soft label.

The write is what AgentLauncher.arm does, but arm fires once per pane id and
cannot be reused. pane-lifecycle's respawn is a bare shell and is not this.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
