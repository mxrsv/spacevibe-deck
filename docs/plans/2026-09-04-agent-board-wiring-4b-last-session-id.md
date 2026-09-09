# Agent Board wiring — Task 10b (the session id Restart needs)

> Continuation of [`2026-09-04-agent-board-wiring.md`](2026-09-04-agent-board-wiring.md).
> Read that file's **Global Constraints**, **The test harness — the real one**, **Forks**
> and **Gates** first. Runs after Task 10 and **before Task 13**.

---

### Task 10b: `lastSessionId` — the id Restart needs, kept past the moment it is dropped

**This task exists because Restart is otherwise silently wrong.** Spec §11.10 says the
session id comes from `lastSessionId` (§11.11), **not** from `paneSessionIds`, and the
code says why: `session-tail-store.ts:404-407` calls `forget` whenever
`isNewGeneration` is true, and `isNewGeneration` (`:247-251`) is true the moment a pane's
agent changes — including **agent → shell**:

```ts
function isNewGeneration(pane: PaneView, previous: PaneGeneration | undefined): boolean {
  if (previous === undefined) return false;
  return previous.agent !== pane.agent || (previous.ran && !pane.hasRun);
}
```

and `forget` (`:363-371`) does `paneSessions.delete(paneId)`.

Restart is offered **only** on a card whose agent has left (`agent === null`) — which is
exactly when that delete has already run. So a Restart reading `paneSessionIds` always
finds nothing, always falls back to `{ kind: "latest" }`, and resumes whatever session
the CLI happened to touch last. It compiles, its tests pass, and it is wrong at runtime.

**Files:**

- Modify: `src/terminal/session-tail-store.ts` — `forget` (`:366`), **both** its call
  sites (`:399`, `:406` — grepped, there is no third), `resetSessionTailStore` (`:534`),
  one new map and one reader
- Modify: `src/terminal/tabs-store.ts` (`PaneView.lastSessionId`)
- Modify: `src/terminal/tab-manager.ts` (`syncViews` projects it)
- Test: `src/terminal/session-tail-store.test.ts`, `src/terminal/tab-manager.pane-views.test.ts`

**Interfaces:**

- Produces: `PaneView.lastSessionId?: string` — the session id this pane's agent was
  running when it left. Task 13 reads it.

- [x] **Step 1: Write the failing test**

Append to `src/terminal/session-tail-store.test.ts`, in that file's own idiom (read how it
drives `prune`/`syncViews` before writing):

```ts
describe("lastSessionId", () => {
  it("keeps the id when the agent leaves, and drops it when the pane does", () => {
    // agent → shell is a NEW GENERATION, so `forget` runs and
    // `paneSessions.delete` takes the live id. Restart is offered exactly
    // then, so the id has to survive that one transition.
    notePaneSession(7, "sess-abc");
    prunePanes([{ paneId: 7, agent: "claude", hasRun: true }]);
    prunePanes([{ paneId: 7, agent: null, hasRun: true }]);
    expect(paneSessionIds.value.get(7)).toBeUndefined();
    expect(lastSessionIdFor(7)).toBe("sess-abc");
    // The PANE closing is a different event: nothing about it survives.
    prunePanes([]);
    expect(lastSessionIdFor(7)).toBeUndefined();
  });

  it("clears it when a NEW agent starts, so it cannot inherit the old one's id", () => {
    notePaneSession(7, "sess-abc");
    prunePanes([{ paneId: 7, agent: "claude", hasRun: true }]);
    prunePanes([{ paneId: 7, agent: null, hasRun: true }]);
    expect(lastSessionIdFor(7)).toBe("sess-abc");
    // shell → agent is also a new generation, and `paneSessions` still holds
    // the OLD id at that instant. Keeping it would pin the new agent to the
    // previous conversation (spec §11.11: "overwritten by the next
    // shell→agent generation").
    prunePanes([{ paneId: 7, agent: "codex", hasRun: false }]);
    expect(lastSessionIdFor(7)).toBeUndefined();
  });

  it("is cleared by the store's own reset, which bypasses forget", () => {
    notePaneSession(7, "sess-abc");
    prunePanes([{ paneId: 7, agent: "claude", hasRun: true }]);
    prunePanes([{ paneId: 7, agent: null, hasRun: true }]);
    resetSessionTailStore();
    expect(lastSessionIdFor(7)).toBeUndefined();
  });
});
```

`notePaneSession` / `prunePanes` / `lastSessionIdFor` are illustrative names — use the
store's real internals and export only what the projection needs.

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/terminal/session-tail-store.test.ts`
Expected: FAIL — no such reader.

- [x] **Step 3: Remember the id in `forget`, and distinguish its two callers**

`forget` is the one place that knows both the id and that it is about to go. But its two
call sites mean different things and must behave differently:

```ts
/** Everything this store remembers about one pane, gone, from both maps. */
function forget(
  tails: Map<number, string>,
  models: Map<number, string>,
  paneId: number,
  // A pane that CLOSED takes its last id with it; a pane whose agent merely
  // left keeps it, because that is precisely when Restart needs it
  // (spec §11.10, §11.11).
  keepLastSessionId: boolean,
): void {
  tails.delete(paneId);
  models.delete(paneId);
  const going = paneSessions.get(paneId);
  if (keepLastSessionId && going !== undefined) {
    lastSessionIdByPane.set(paneId, going);
  }
  if (!keepLastSessionId) {
    lastSessionIdByPane.delete(paneId);
  }
  paneSessions.delete(paneId);
  resumedPaneIds.delete(paneId);
}
```

with

```ts
/**
 * The session id each pane's agent was running when it LEFT (spec §11.11).
 *
 * `paneSessions` cannot answer this: `forget` deletes from it at the exact
 * transition — agent → shell — at which Restart starts being offered. Written
 * only from `forget`, and only on that transition.
 */
const lastSessionIdByPane = new Map<number, string>();

export function lastSessionIdFor(paneId: number): string | undefined {
  return lastSessionIdByPane.get(paneId);
}
```

Both call sites, and **the generation one is a condition, not `true`**:

```ts
      // The pane is GONE: it takes its last id with it.
      forget(tails, models, paneId, false);
```

```ts
      if (isNewGeneration(pane, paneGenerations.get(pane.paneId))) {
        // Keep the id ONLY when the generation ends with no agent — spec
        // §11.11's own words. `isNewGeneration` is true for four transitions,
        // not one: agent→shell (keep), shell→agent, agentA→agentB, and
        // same-agent-`ran`-then-not. On the middle two, `paneSessions` still
        // holds the OLD agent's id at this instant, so an unconditional `true`
        // would PIN a freshly started agent to the previous conversation —
        // the 2026-08-22 one-sentence-on-three-rows failure, but worse,
        // because a pin does not self-correct. `false` there also delivers
        // §11.11's "overwritten by the next shell→agent generation", through
        // the `delete` branch below.
        forget(tails, models, pane.paneId, pane.agent === null);
      }
```

And clear it in **`resetSessionTailStore` (`:534-549`)**, which empties this state
DIRECTLY rather than through `forget` — add `lastSessionIdByPane.clear();` beside
`paneSessions.clear();` at `:544`. Without it the map leaks between tests in one file,
and between windows in one process.

- [x] **Step 4: Project it onto `PaneView`**

In `src/terminal/tabs-store.ts`, beside `lastAgent`:

```ts
  /**
   * The session id this pane's agent was running when it left (spec §11.11).
   * Restart resumes THAT conversation; `paneSessionIds` is empty by then.
   */
  readonly lastSessionId?: string;
```

and in `syncViews`'s pane literal: `lastSessionId: lastSessionIdFor(id),`.

Add one case to `src/terminal/tab-manager.pane-views.test.ts` proving a departed pane's
view carries it.

- [x] **Step 5: Run the tests**

Run: `npx vitest run src/terminal/session-tail-store.test.ts src/terminal/tab-manager.pane-views.test.ts src/terminal/session-restore.test.ts`
Expected: PASS.

- [x] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx prettier --check src/terminal/session-tail-store.ts src/terminal/tabs-store.ts src/terminal/tab-manager.ts
git add src/terminal/session-tail-store.ts src/terminal/session-tail-store.test.ts \
        src/terminal/tabs-store.ts src/terminal/tab-manager.ts \
        src/terminal/tab-manager.pane-views.test.ts
git commit -m "feat(board): keep the session id an agent was running when it left

Spec §11.10 and §11.11. session-tail-store's forget() deletes a pane's session
id at the exact transition Restart starts being offered — agent → shell is a
new generation, so isNewGeneration is true and paneSessions.delete runs. A
Restart reading paneSessionIds would therefore always find nothing, always
fall back to 'latest', and resume whatever conversation the CLI touched last:
code that compiles, passes, and is wrong.

forget is the one place that knows both the id and that it is going, so it
remembers it there — and its two callers are told apart, because a pane that
CLOSED must take the id with it while a pane whose agent merely left must not.

Claude-Session: https://claude.ai/code/session_011qWLu1K5tk83JuWeDnxTx2"
```
