# Implement the rail's worktree card

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to run this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Spec**: [2026-08-25-rail-worktree-card-design.md](../specs/2026-08-25-rail-worktree-card-design.md) `proposed`
**Goal**: Turn the rail's worktree tier into a card that opens onto its agent panes, and remove
the tab tier from the rail.
**Architecture**: The change is renderer-shaped but needs one main-process extension. `buildAgentRail`
gains a card projection on `RailWorktreeGroup` — the checkout's basename as a field distinct from
`branch`, a flat pane list across the group's tabs, and a live flag — and a new `WorktreeCard`
component renders it. The model pill is sourced from the session transcript the rail already reads:
`SessionTailAnswer` gains a `model` field, so nothing touches tab materialization.
**Tech stack**: Preact + signals, plain CSS in `src/styles/`, Vitest, Electron main (`electron/resume/`).

## Global constraints

- **R1. English only** — strings, comments, docs and commit messages.
- **R2.** Chrome styling follows numbered DL rules and code comments cite them. Fixing or moving a
  rule also updates the ledger in `docs/DESIGN-LANGUAGE.md`.
- **R4.** No drive-by refactors in PTY/window/tab/layout/close modules. This plan touches none of them.
- **R5.** Renderer state uses Preact signals; module stores are window-scoped.
- **R6.** IPC payload shape is a contract — `scripts/electron-ipc-contract.test.ts` guards it. This
  plan adds one **field to an existing reply**, no new channel.
- **R7.** Gallery imports flow app → gallery only.
- **Host scope**: renderer code reaches both hosts; the **data** is Electron-only (`git_repository`
  and `session_tail` have no Tauri counterpart). Under Tauri a project stays one unlabelled implicit
  group with no branch and no model — today's behaviour preserved, named as a parity gap, never
  claimed as both-hosts.
- **Windows is Gate C.** No Windows claim in any completion note.
- **`src/styles.css` has no global `box-sizing` reset.** Declare `box-sizing: border-box` on any
  element given a percentage size and a padding.
- **`.iconbtn` never resets the UA button padding.** Any icon control added here declares `padding: 0`.
- **Edit over `sed`/`python`** for every source edit — see §16 of the spec and the repo's own note.
  This checkout is shared with other sessions: re-diff before trusting a summary, and commit with an
  explicit pathspec (`git commit -m "…" -- <paths>`) so a peer's staged files are not swept in. A
  NEW file needs `git add <path>` first — a pathspec alone cannot reach an untracked file — and the
  `--` on the commit still scopes it, so anything a peer left staged stays staged and out.
- **D14**: do not `git commit` any documentation until the owner has approved its content.

---

## 1. Expected outcomes

- A checkout renders as a card whose head is `mark · basename · branch badge` — verify with
  `WorktreeCard draws the head without a caret or an age`.
- An open card lists **every agent pane in that checkout**, across tabs, as peer rows — verify with
  `buildAgentRail flattens panes across a worktree's tabs`.
- An agent row states the model recorded by the session it is **paired to** — verify with
  `claudeModelFromLines`, `codexModelFromLines`, `opencodeModel` and the store test.
- The tab tier is gone from the rail and DL-27.19's frame with it — verify with
  `agent-rail.test.tsx` asserting no `.asr-item[data-headless]` frame and no tab row.
- Pressing an agent row focuses that pane through the shipped seam — verify with the App wiring suite.
- One hue means one thing: `--green` is the active checkout only, busy is one hue, `--accent` is the
  `+N` count — verify with the design-language gate's new colour-rule assertion.
- Motion is added only under `prefers-reduced-motion: no-preference` and is bound to a state whose
  removal ends it — verify with the DL gate and a Playwright media-emulation pass.

## 2. Canonical data source

**Canonical data**: `RepositoryScan`'s worktrees (already cached for the rail), `TabView.panes`
for the pane list, and `session_tail` for both the pairing id and — new here — the model string.

**Taken from**: the shipped rail input. `AgentRailInput` gains one optional map; no new scan, no
new channel, no new poll.

**Not taken from**: `agentRuntimeDefaults` (a default per agent, not a fact about a live pane),
`agentModels` (the user's declared list of names), a launcher-threaded model (reaches tab
materialization and is absent on every restored pane), or a new git invocation per worktree.

## 3. Fixed decisions

These close the spec's open questions. Each carries what it costs.

| Spec | Decision | Why |
| --- | --- | --- |
| §11.2 model pill | **Read the model off the session transcript.** `SessionTailAnswer` becomes `{ id, tail, model }` | Measured on this machine 2026-08-26: Claude assistant records carry `message.model` (`claude-opus-5`), Codex `turn_context` carries `payload.model` (`gpt-5.6-sol`), opencode's `message.data` carries `modelID` + `providerID` (`gpt-5.6-sol`, `openai`). The rail already resolves pane → session and reads that file. **No new IPC channel, no tab materialization, no settings field** — §9.10 survives intact |
| §11.3 `thinking` | **Dropped.** `RailState` is unchanged | The spec's own and only recommendation. Nothing in Deck distinguishes thinking from working at any layer |
| §7.3 busy hue | **Owner picks by eye** at Task 10's gate; the three candidates are already drawn | Collapses to a pure hue pick once `thinking` is dropped — there is one busy state, so one hue is trivially enough |
| §11.4 `+N` | **Loudest-wins fold** (`failed > asked > working > done > idle`), ties newest-first | `STATE_RANK` and `outranks` already express this precedence once — including the `changedAt` tie-break, which is NOT open order (Task 5) |
| §11.5 `New agent` | `onNewTabIn(worktree.path)` | Off-the-shelf: `quickPickerWorkspace` already pins it and `openQuickAgent` already takes a destination |
| §11.6 / §13.7 card open state | **Window-local**, keyed by worktree path, like `toggleGroup` — owner-decided 2026-08-26 | Settings are app-level, so persisting would make every window share one open/closed state and would add a settings-schema fork to a change that already moves eight DL rules |
| §12 what selects a checkout | **Derived, not gestured.** The active card is the one holding the focused pane's worktree | `--green` means "a place, not a state" (§7.1), and where the keyboard is *is* that place. The head stays toggle-only |
| §12 agent row press | `onFocusPane(tabIndex, paneId)` | The shipped seam; needs no change |

## 4. Scope

**Build**:

- `model` on the session-tail answer, end to end (main → wire → store → model → row).
- The card projection on `RailWorktreeGroup` and the pane flattening.
- `WorktreeCard` component, its stylesheet, and its removal of the tab tier.
- DL rule edits, gate assertions, gallery re-point, `AGENTS.md` and `docs/CONTEXT.md`.

**Do not build**:

- A worktree-scoped ✕, card dragging, branch metadata (ahead/behind/dirty), creating a worktree
  from the card, tab-strip changes, or Tauri support — all §17.
- A `thinking` state, a per-pane model in settings or on `PaneView`, or persisted card state.

## 5. Risks and accepted regressions

- **A tab is no longer addressable from the rail.** For a tab holding one agent this is invisible
  (focusing the pane activates the tab). **For a plain shell pane beside an agent, or a shell-only
  tab, the rail has no row and no way in** — the tab strip remains the way to reach a shell. Named
  here so the owner sees it before implementation, not after.
- **`session-tail`'s consumer changes, it does not disappear.** The sentence leaves the rail (§9.1)
  but `tabTail` still prints it on the chips, so the two-pass pairing and `preferredId` pinning stay
  load-bearing. Do not delete any of it.
- **False model authority is the biggest under-weighted risk.** The pill is only ever as true as the
  pane→session pairing, and that pairing is **heuristic on a pane's FIRST resolve** — the plan's own
  §3 notes `birthtime` is the honest anchor and is unread, a limit inherited from 2026-08-22. A
  polished pill naming the wrong model is worse than no pill, so: never write "is running" in UI
  copy, an accessible name or a doc line — write what is true, that this is the paired session's
  newest recorded model. It is also not a live setting (a mid-session switch shows on the next
  turn), and an unpaired pane or a tail-less agent (`gemini`, `agy`, `cursor-agent`, custom) draws
  **no pill**; the right edge still aligns on the fixed 12px track.
- **Eight DL rules move, two broken for the first time** (DL-1.3's `box-shadow` clause, DL-20.1's
  radius scale) and the loop budget scales with agent count. All three are live trade-offs, not
  settled costs — they are rows 2, 3 and 5 of **Task 10's decision table**, each with its revert.
- **This checkout is shared.** The specimen files were silently reverted three times during the
  session that built them. Diff before quoting.

## 6. Tasks

### Task 1: Read the model out of each transcript (main process)

**Files**:

- Modify: [electron/resume/session-tail.ts](../../electron/resume/session-tail.ts)
- Modify: [electron/resume/opencode-db.ts](../../electron/resume/opencode-db.ts)
- Test: [electron/resume/session-tail.test.ts](../../electron/resume/session-tail.test.ts),
  [electron/resume/opencode-db.test.ts](../../electron/resume/opencode-db.test.ts)

**Interfaces produced**:

```ts
export interface SessionTailAnswer {
  readonly id: string;
  readonly tail: string | null;
  /** The model the newest recorded turn ran on, or null when the transcript names none. */
  readonly model: string | null;
}

export function claudeModelFromLines(lines: readonly string[]): string | null;
export function codexModelFromLines(lines: readonly string[]): string | null;
```

**Decision**: A second newest-first walk over the same lines the tail walk already holds. Claude's
model sits on the same assistant record as the sentence (`node.message.model`); Codex's does **not**
— it is on `turn_context` records, so that walk has its own predicate. opencode answers from SQL.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads the model off the newest Claude assistant record", () => {
  const lines = [
    JSON.stringify({ type: "assistant", message: { model: "claude-opus-4", content: [{ type: "text", text: "old" }] } }),
    JSON.stringify({ type: "assistant", message: { model: "claude-opus-5", content: [{ type: "text", text: "new" }] } }),
  ];
  expect(claudeModelFromLines(lines)).toBe("claude-opus-5");
});

it("answers null when no Claude record names a model", () => {
  const lines = [JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } })];
  expect(claudeModelFromLines(lines)).toBeNull();
});

it("reads the Codex model off turn_context, not off the message", () => {
  // The nesting is NOT the tail parser's: `type` sits at the TOP level and the
  // model inside `payload`. Measured against a real rollout, 2026-08-26.
  const lines = [
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "done" }] } }),
  ];
  expect(codexModelFromLines(lines)).toBe("gpt-5.6-sol");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run electron/resume/session-tail.test.ts`
Expected: FAIL — `claudeModelFromLines is not a function`.

- [ ] **Step 3: Implement both walks**

```ts
/**
 * The newest Claude turn that names a model. Same record as the sentence, read
 * separately: a tool-only turn carries a model and no text.
 */
export function claudeModelFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      if (node?.type !== "assistant") continue;
      const model = node.message?.model;
      if (typeof model === "string" && model !== "") return model;
    } catch {
      /* an unparseable line is just skipped */
    }
  }
  return null;
}

/**
 * Codex names its model on `turn_context`, never on the assistant message.
 *
 * The nesting differs from `codexTailFromLines`' and getting it wrong returns
 * null forever: a `turn_context` record carries `type` at the TOP level with the
 * model inside `payload`, where a `response_item` carries `payload.type`. This
 * is the shape `electron/usage/codex.ts#L79-L85` already reads for cost
 * attribution — follow it rather than the tail parser's `payload?.type` idiom.
 */
export function codexModelFromLines(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const node = JSON.parse(lines[i]);
      if (node?.type !== "turn_context") continue;
      const model = node.payload?.model;
      if (typeof model === "string" && model !== "") return model;
    } catch {
      /* skip */
    }
  }
  return null;
}
```

- [ ] **Step 4: Add the model to opencode's tail statement**

Extend the existing tail query to select `json_extract(m.data, '$.modelID')` beside the text, and
return it on the answer. Keep both `json_extract` predicates (`role = 'assistant'`,
`type = 'text'`) exactly as they are — they are the file walk's rules in SQL, and matching
`reasoning`'s own `text` field would print private thinking.

Two limits, both accepted and both stated in the code: the SQL answers the newest **text-bearing**
assistant message, so a turn that switched model and then only used tools reports the previous
model until it speaks; and [`opencode.ts`](../../electron/resume/opencode.ts) still merges the
**legacy JSON tree** beside the database, where no model is recorded — a session resolved from
that layout answers `null` and draws no pill, exactly like `gemini`.

- [ ] **Step 5: Thread `model` onto `SessionTailAnswer` in `resolveSessionTails`**

The two-pass allocation, the `preferredId` pins, the growing read window and the positional reply
contract are **unchanged**. Only the answer object grows a third field, `null` for every agent that
produces no model.

- [ ] **Step 6: Run the resume suites**

Run: `npx vitest run electron/resume`
Expected: PASS, including the existing pairing tests untouched.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(resume): answer the running model beside the session tail" \
  -- electron/resume/session-tail.ts electron/resume/opencode-db.ts \
     electron/resume/session-tail.test.ts electron/resume/opencode-db.test.ts
```

---

### Task 2: Carry the model across the wire

**Files**:

- Modify: [src/lib/agent-resume.ts](../../src/lib/agent-resume.ts) (the wire mirror)
- Modify: [src/host/session-tail-host.ts](../../src/host/session-tail-host.ts)
- Test: [src/host/session-tail-host.test.ts](../../src/host/session-tail-host.test.ts),
  [scripts/electron-ipc-contract.test.ts](../../scripts/electron-ipc-contract.test.ts)

**Interfaces consumed**: Task 1's `SessionTailAnswer`.

**Decision**: Additive on an existing channel, so R6 holds — but `parseAnswer` stays defensive per
field, exactly as it is for `tail`: a malformed `model` degrades that one field to `null` and never
nulls the whole answer, or a pane would lose its pairing over a cosmetic string.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps the answer when only the model is malformed", async () => {
  invoke.mockResolvedValue([{ id: "abc", tail: "hello", model: 7 }]);
  const answers = await sessionTails([REQUEST]);
  expect(answers[0]).toEqual({ id: "abc", tail: "hello", model: null });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/host/session-tail-host.test.ts`
Expected: FAIL — received object has no `model` key.

- [ ] **Step 3: Widen `parseAnswer` and the mirror type**

```ts
return {
  id: node.id,
  tail: typeof node.tail === "string" ? node.tail : null,
  model: typeof node.model === "string" && node.model !== "" ? node.model : null,
};
```

- [ ] **Step 4: Run the host and contract suites**

Run: `npx vitest run src/host/session-tail-host.test.ts scripts/electron-ipc-contract.test.ts`
Expected: PASS. If the contract test pins the reply shape, extend its expectation rather than
loosening it — the shape is the contract.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(host): carry the running model on the session tail reply" \
  -- src/lib/agent-resume.ts src/host/session-tail-host.ts \
     src/host/session-tail-host.test.ts scripts/electron-ipc-contract.test.ts
```

---

### Task 3: Keep a per-pane model in the tail store

**Files**:

- Modify: [src/terminal/session-tail-store.ts](../../src/terminal/session-tail-store.ts)
- Test: [src/terminal/session-tail-store.test.ts](../../src/terminal/session-tail-store.test.ts)

**Interfaces produced**:

```ts
/** Model per pane id, by the same pairing that produces `paneTails`. */
export const paneModels: Signal<ReadonlyMap<number, string>> = signal(new Map());
```

**Decision**: `paneModels` is written in the same merge as `paneTails`, under the same rules, so the
two can never describe different sessions. Specifically: a **different `id` drops the model** the way
it drops the sentence; a **same `id` with a null model keeps** the last known one (a tool-only turn
names no model and is not a model change); the **epoch check** in `resetSessionTailStore` guards it;
and a **pane generation change** (agent label changed, or `hasRun` went true → false) forgets it with
the pairing.

- [ ] **Step 1: Write the failing tests**

```ts
it("drops the model when the pairing moves to another session", () => { /* … */ });
it("keeps the last model when the same session answers with none", () => { /* … */ });
it("forgets the model when the pane's agent generation changes", () => { /* … */ });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/terminal/session-tail-store.test.ts`
Expected: FAIL — `paneModels` is not exported.

- [ ] **Step 3: Implement the parallel map inside the existing merge**

No second request, no second debounce, no timer. The same answers array feeds both maps.

- [ ] **Step 4: Run the suite and commit**

Run: `npx vitest run src/terminal/session-tail-store.test.ts` → PASS

```bash
git commit -m "feat(terminal): track the running model per pane" \
  -- src/terminal/session-tail-store.ts src/terminal/session-tail-store.test.ts
```

---

### Task 4: Give `RailWorktreeGroup` a card shape

**Files**:

- Modify: [src/ui/agent-rail-model.ts](../../src/ui/agent-rail-model.ts)
- Test: [src/ui/agent-rail-model.test.ts](../../src/ui/agent-rail-model.test.ts)

**Interfaces produced**:

```ts
export interface RailWorktreeGroup {
  readonly key: string;
  /** The BRANCH (WorktreeRow.name, basename-fallback intact) — the badge. */
  readonly branch: string;
  /**
   * The checkout's DIRECTORY BASENAME — the card's name, and a different fact
   * from `branch`, whose fallback only reaches the basename when git reports
   * no branch at all (spec §11.1).
   */
  readonly name: string;
  readonly path: string;
  readonly primary: boolean;
  readonly labelled: boolean;
  /** Every agent pane in this checkout, across its tabs (spec §3). */
  readonly panes: readonly RailCardPane[];
  /** Any pane here is `working` — the head mark's busy state. */
  readonly live: boolean;
  /** The meta line: `formatShortAge` of the newest `changedAt` across `panes`,
   *  empty when nothing here has changed yet. Folded in the model, not the view. */
  readonly age: string;
  /** This checkout holds the window's focused pane (spec §12, §7.1's `--green`). */
  readonly active: boolean;
  /** Still walked to find panes; nothing on screen corresponds to one (spec §3). */
  readonly rows: readonly RailTabRow[];
}

export interface RailCardPane extends RailPaneRow {
  /** The tab this pane lives in — the coordinate `onFocusPane` takes. */
  readonly tabIndex: number;
  /** The model its session is running, or empty when unknown (spec §11.2). */
  readonly model: string;
  /**
   * What the row is CALLED — spec §3's load-bearing evidence, the mockup's own
   * `Claude (Split)`. Two panes of `claude` in one checkout are told apart by
   * nothing else once the turn text leaves the rail (§9.1), so this is not
   * decoration. Precedence: the tab's own name when a PERSON typed it
   * (`RailTabRow.named`), else the agent's display name, with ` (Split)`
   * appended when the pane is not its tab's first — a split is where a second
   * pane of one agent comes from. **A third pane collides** (two rows reading
   * `Claude (Split)`); that is gate row 9, not a silent default.
   */
  readonly label: string;
}
```

**Decision**: `rows` stays so the model can walk tabs; `panes` is the flattening. Pane order is the
**open order of the holding tab, then pane order within it** — `sortByOpenOrder` orders tabs and
the panes inside one tab are already ordered, so the composition is stated once here rather than
invented at the component. `active` is derived (`panes.some((p) => p.focused)`), never gestured.

- [ ] **Step 1: Write the failing tests**

```ts
it("flattens panes across a worktree's tabs in open order", () => { /* two tabs, three panes */ });
it("names the checkout by basename and badges it by branch", () => {
  // path /repo/.wt/api, branch feature/api → name "api", branch "feature/api"
});
it("marks exactly one worktree active — the focused pane's", () => { /* … */ });
it("reports live only while a pane is working", () => { /* … */ });
it("ages the card by its newest pane, not by its first tab", () => { /* … */ });
it("labels a split pane so two claude rows are not identical", () => {
  // one tab, two claude panes → ["Claude", "Claude (Split)"]
});
it("lets a tab name a person typed win over the agent name", () => { /* … */ });
it("carries the model from the tails input onto its pane", () => { /* … */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/ui/agent-rail-model.test.ts`
Expected: FAIL — `name`, `panes`, `live`, `active` do not exist.

- [ ] **Step 3: Widen `AgentRailInput` with the model map**

```ts
/** Model per pane id. Optional for the same reason `tails` is: a caller that
 *  reads no sessions (the gallery, most tests) is the shape this shipped with. */
readonly models?: ReadonlyMap<number, string>;
```

- [ ] **Step 4: Implement the projection in `buildAgentRail`**

Keep `tabTail` and `loudestPane` exactly as they are — the strip still needs them.

- [ ] **Step 5: Run the model suite and commit**

Run: `npx vitest run src/ui/agent-rail-model.test.ts` → PASS

```bash
git commit -m "feat(rail): project a card shape onto the worktree group" \
  -- src/ui/agent-rail-model.ts src/ui/agent-rail-model.test.ts
```

---

### Task 5: The strip's visible three, by precedence

**Files**:

- Modify: [src/ui/agent-rail-model.ts](../../src/ui/agent-rail-model.ts)
- Test: [src/ui/agent-rail-model.test.ts](../../src/ui/agent-rail-model.test.ts)

**Interfaces produced**:

```ts
/** DL-27.3's own fold decides which three a closed card shows (spec §11.4). */
export const STRIP_VISIBLE = 3;
export function stripSegments(
  panes: readonly RailCardPane[],
): { readonly shown: readonly RailCardPane[]; readonly overflow: number };
```

**Decision**: The three worth seeing are the three loudest, not the first three in source order.
`STATE_RANK` and `outranks` already express that precedence; reuse them **verbatim** rather than
restating it.

Read [`outranks`](../../src/ui/agent-rail-model.ts#L423-L426) before writing the test: equal states
tie on **`changedAt`, newest first** — not on open order. The consequence is real and is accepted
rather than papered over: two `working` panes swap places in a closed card's strip whenever the
quieter one speaks. The alternative is a card-local comparator, which is a second precedence to
keep in sync with DL-27.3's — the exact duplication `loudestPane` exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
it("shows the three loudest panes and counts the rest", () => {
  const panes = [idle, working, failed, asked, done];
  const { shown, overflow } = stripSegments(panes);
  expect(shown.map((p) => p.state)).toEqual(["failed", "asked", "working"]);
  expect(overflow).toBe(2);
});

it("breaks an equal-state tie by changedAt, newest first", () => {
  // pins `outranks`' actual rule, so a later reader does not assume open order
});
```

- [ ] **Step 2: Run, fail, implement, run** — `npx vitest run src/ui/agent-rail-model.test.ts`

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(rail): pick a closed card's visible agents by loudness" \
  -- src/ui/agent-rail-model.ts src/ui/agent-rail-model.test.ts
```

---

### Task 6: The `WorktreeCard` component

**Files**:

- Create: `src/ui/worktree-card.tsx`
- Create: `src/ui/worktree-card.test.tsx`
- Modify: [src/ui/agent-rail.tsx](../../src/ui/agent-rail.tsx) — replace the sub-header block and
  delete the tab-row render

**Interfaces consumed**: Task 4's `RailWorktreeGroup` / `RailCardPane`, Task 5's `stripSegments`.

**Interfaces produced**:

```ts
export interface WorktreeCardProps {
  readonly group: RailWorktreeGroup;
  readonly open: boolean;
  readonly onToggle: (key: string) => void;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  /**
   * DL-27.21, kept: **every agent row closes its own pane.** The shipped rail
   * has this on both its leaf and its single-agent row
   * ([agent-rail.tsx#L378](../../src/ui/agent-rail.tsx#L378),
   * [#L446](../../src/ui/agent-rail.tsx#L446)); dropping it with the tab tier
   * would delete a mandated affordance and make this a NINTH rule change.
   */
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onNewTabIn?: (workspacePath: string) => void;
}
export function WorktreeCard(props: WorktreeCardProps): JSX.Element;
```

**Decision**: A new file rather than more of `agent-rail.tsx`, which is already 811 lines (F8/C2).
Open state is **window-local**, held in `AgentRail` as a signal keyed by worktree path — the
`toggleGroup` precedent, and per the owner's 2026-08-26 answer it does not persist.

- [ ] **Step 1: Write the failing component tests**

```tsx
it("draws the head as mark, basename and branch badge, with no caret and no age", () => { /* … */ });
it("lists every pane of the checkout when open, with no tab row between them", () => { /* … */ });
it("reserves the loading track on an idle row so the pills share one right edge", () => { /* … */ });
it("focuses the pane's own tab when a row is pressed", () => {
  // onFocusPane called with (pane.tabIndex, pane.paneId)
});
it("opens the launcher pinned to this checkout from New agent", () => {
  // onNewTabIn called with group.path
});
it("marks the focused row with aria-current and washes exactly one row", () => { /* … */ });
it("closes THAT pane from its own row, never the tab", () => {
  // DL-27.21: onClosePane called with (pane.tabIndex, pane.paneId)
});
it("renders the bare row — mark, name, badge — for a checkout with no panes", () => { /* … */ });
it("keeps a bare row reachable: pressing it opens the launcher for that checkout", () => {
  // spec §6 — "stays reachable with nothing running" is behaviour, not a label
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/ui/worktree-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the component**

Head (`mark · name · badge`), meta line (age, indented 22px to align under the name), the segmented
strip when closed, the count header + rows + `New agent` when open. The whole card head is the
toggle; the whole agent row is the button. Every state word reaches `title` beside the agent name —
DL-27.2's rule that the mark is the fast read and never the only read.

- [ ] **Step 4: Delete the tab tier from `agent-rail.tsx`**

The sub-header block becomes `<WorktreeCard>`; the tab-row render and its leaf list go. `RailTabRow`
is **not** deleted — the model still walks tabs. Neither is `tabTail`.

- [ ] **Step 5: Run the rail suites**

Run: `npx vitest run src/ui/worktree-card.test.tsx src/ui/agent-rail.test.tsx
src/ui/agent-rail-model.test.ts src/ui/rail-order.test.ts src/ui/rail-cluster-drag.test.ts`
Expected: PASS. Existing assertions about tab rows are **inverted, not deleted**, so the reversal is
pinned the way the close model's was. Cluster drag is **verified untouched, not assumed**: its
controller reads only `.asr-cluster`, `.asr-cluster__head`, `.asr-cluster__name`,
`.asr-cluster__add/__remove` and `data-order-key` — all project-header elements the card sits
below — so a press on a card cannot start a drag and DL-27.20 keeps working.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rail): render a checkout as a card and drop the tab tier" \
  -- src/ui/worktree-card.tsx src/ui/worktree-card.test.tsx \
     src/ui/agent-rail.tsx src/ui/agent-rail.test.tsx
```

---

### Task 7: The card's stylesheet

**Files**:

- Create: `src/styles/04c-rail-worktree-card.css`
- Modify: [src/styles/04b-agent-rail-rows.css](../../src/styles/04b-agent-rail-rows.css) — delete
  DL-27.19's `data-headless` frame
- Modify: [src/styles.css](../../src/styles.css) — import the new sheet
- Test: [scripts/design-language.test.ts](../../scripts/design-language.test.ts)

**Decision**: Port the specimen sheet, keeping its two radius values pinned to **one variable each**
so §9.8's cheapest revert stays a two-line edit. The static rim glow's second `box-shadow` line
(`inset 0 0 9px`) is likewise **its own declaration on its own line** — it is the DL-1.3 break and
its revert is deleting that line.

- [ ] **Step 1: Diff the specimen before porting**

```bash
git status --porcelain src/gallery/rail-worktree-cards.css
wc -l src/gallery/rail-worktree-cards.css   # expect ~879
```

Spec §16: these files were silently reverted three times. Confirm the sheet still holds the meta
line's spans, the `Agents`-less head grid, and exactly two radius values before copying anything.

- [ ] **Step 2: Port the sheet under production class names**

Rename `gxwc-` → the production prefix. Motion is **added** under
`@media (prefers-reduced-motion: no-preference)` and never switched off below it, so reduced motion
keeps the static glow and legible marks. `@property --beam { syntax: "<angle>" }` is required or the
custom property interpolates discretely and the beam steps rather than sweeps.

- [ ] **Step 3: Delete DL-27.19's frame**

Remove `.asr-stream .asr-item[data-headless="true"]` and its child rule. **Amended 2026-08-26 after
Task 6:** the seam is gone, not untouched — `PANE_TREE_HIDDEN`'s only consumer was the tab tier's
`TabItem`, so Task 6 deleted the constant and nothing emits `data-headless` any more. These rules are
unreachable dead CSS; delete them outright rather than preserving a seam behind them.

- [ ] **Step 4: Prove no overflow and no `box-sizing` trap**

Run `npm run prototype:gallery` and measure: the card's content box at `--sidebar-w`, the head's
213px run, zero horizontal overflow on `.asr-rail__list`. `overflow-x: hidden` **clips a left
overflow and never reports it** — measure, do not eyeball.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(rail): draw the worktree card and retire the multi-agent frame" \
  -- src/styles/04c-rail-worktree-card.css src/styles/04b-agent-rail-rows.css src/styles.css
```

---

### Task 8: Feed the rail its models, and prove the focus contract held

**Files**:

- Modify: [src/ui/agent-rail.tsx](../../src/ui/agent-rail.tsx#L491-L500) — the `buildAgentRail` call
- Test: [src/ui/app.test.tsx](../../src/ui/app.test.tsx)

**Decision**: The rail reads the store **itself** — `paneTails` is imported at
[agent-rail.tsx:15](../../src/ui/agent-rail.tsx#L15) and passed at line 500 — so `paneModels` goes
in beside it and `App` is not touched at all. `onFocusPane(index, paneId)` keeps its exact
signature: the card supplies each pane's own `tabIndex`, which is what a tab row used to supply as
`row.index`.

- [ ] **Step 1: Write the failing test for THIS task's deliverable** — a model written to
      `paneModels` reaches the card row's pill. Scope it there: the *focus routing* assertion belongs
      to Task 6, where the component decides what it hands back, and no amount of `models:` wiring
      can turn a focus test green.
- [ ] **Step 2: Run it, watch it fail, add `models: paneModels.value`, run again.**
- [ ] **Step 3: Re-run Task 6's focus test through `App`** — `npx vitest run src/ui/app.test.tsx` —
      to prove the end-to-end coordinate survives the wiring, not to introduce it.
- [ ] **Step 4: Commit** — `feat(rail): read the per-pane models into the rail view`

---

### Task 9: Re-point the gallery at the production component

**Files**:

- Modify: [src/gallery/rail-worktree-cards.tsx](../../src/gallery/rail-worktree-cards.tsx)
- Modify: [src/gallery/sections/navigation-section.tsx](../../src/gallery/sections/navigation-section.tsx)
- Modify: [src/gallery/seed-data.ts](../../src/gallery/seed-data.ts)
- Delete: `src/gallery/rail-worktree-cards.css` once the production sheet covers it

**Decision**: R7 — imports flow app → gallery. The specimen keeps its fixtures as **data** and mounts
the real `WorktreeCard`, so a later change to the component cannot leave the gallery drawing a
picture the app no longer renders. The local `CardStatus` / `CardPane` / `WorktreeCard` /
`BareWorktree` types are deleted and replaced by the production ones. **This runs BEFORE the owner
gate**: Task 10 picks against the production component, and until this task the gallery is still
drawing a hand-built fixture.

- [ ] **Step 1: Replace the local component with the production import.**
- [ ] **Step 2: Rewrite the SHIPPED-rail specimen's blurb.**
      [navigation-section.tsx:19](../../src/gallery/sections/navigation-section.tsx#L19) currently
      describes *"a chip on single-agent tabs and flat full-width agent rows for multi-agent tabs,
      those rows standing inside a neutral frame since 2026-08-20 (DL-27.19)"* — every clause of
      that is false after Task 6. The `RecentSessionActivity` specimen mounts the same real rail and
      changes with it.
- [ ] **Step 3: Seed a checkout with agents in TWO tabs.** The card's load-bearing claim — panes
      flattened across tabs (§3) — is invisible in a fixture where every worktree has one tab.
- [ ] **Step 4: Keep the colour-rule specimen** — it is still how a hue is picked, now driven by
      the production tokens.
- [ ] **Step 5: Verify no gallery module is imported by a shipping module** —
      `npx vitest run scripts/gallery-entry.test.ts`
- [ ] **Step 6: Commit** — `refactor(gallery): mount the production worktree card`

---

### Task 10: The owner's gallery gate — nine drawn choices

**Files**: none changed until the owner answers.

**Decision**: These are judgements about a rendered picture. Per the repo's own record the owner
declines written option prompts for this class — the candidates are **drawn** and picked by eye.
Every row below is a live trade-off this plan does **not** settle; each names its cheapest revert
so a later pick costs one edit.

| # | Choice | Options | What it costs |
| --- | --- | --- | --- |
| 1 | **Busy hue** (§7.3) | A neutral `--tone` 62% · B `--magenta` · C `--cyan` | A adds no rule but makes the commonest state the quietest ink; B reopens a hue retired from chrome by DL-3.6; C sits nearest `--accent`. With `thinking` dropped the two-hues fault cannot recur whichever wins |
| 2 | **Loop budget** (§8.3, §9.6) | Keep 4/agent (beam + 3 bars) · bars → one pulse (2) · drop the beam, keep bars (3) | The spec calls this *"the thing to decide rather than a detail"* — it is the only DL-1.2 exception that scales with agent count. The beam is the one that re-rasterizes; the bars are `transform`-only |
| 3 | **Radius** (§9.8) | Ship 6px/3px and amend DL-20.1 · add a rung to the scale · snap to `--radius-tight` 8px + `--radius-flat` 2px | The plan assumes *amend*. Snapping keeps DL-20.1 untouched at the cost of the owner's own picked values; both are one variable each |
| 4 | **Active-card frame** (§9.5) | `--green` accent border · neutral `--hair-strong` | Accent breaks DL-21.1 on the banned property **and** the banned colour, inside a list. Neutral keeps the rule and matches the tab chip's own exception. One `color-mix` |
| 5 | **The rim glow** (§9.7, §13.3) | Inset `0 0 9px` · outer · no blur at all | Any blur is DL-1.3's **first break in the app's history**. Outer now costs only a bigger row gap; no-blur restores the rule and leaves a travelling highlight on a 1px frame |
| 6 | **Sibling cards when one opens** (§13.2) | Compact to the head · keep all three lines | Both mockups exist and both are drawn; may be a mockup inconsistency rather than a decision |
| 7 | **Long checkout names** (§13.5) | Shorten against the project header's word · drop the name for the badge · accept truncation | `bench.ai-terminal` + `feature/ai-terminal` truncates **both** at 213px, and that is the reference's own shape |
| 8 | **Tail-less agents** (§11.2) | No pill · the agent's runtime default · a placeholder dash | The plan assumes *no pill*. A default would print a model the pane may not be running — the exact dishonesty that ruled `agentRuntimeDefaults` out as the source |
| 9 | **Three panes of one agent** (§3) | ` (Split)` on every non-first pane · an ordinal (`Claude 2`, `Claude 3`) · the holding tab's name | The plan assumes *(Split)*, which is the mockup's own string but **collides at three panes** — two rows then read `Claude (Split)`. An ordinal never collides and is not what the reference shows |

- [ ] **Step 1: Run `npm run prototype:gallery` against the production component**, both themes,
      both motion modes.
- [ ] **Step 2: Walk the owner through rows 1–9 on screen** and record each pick in this table.
- [ ] **Step 3: Apply the picks and commit** — `style(rail): apply the owner's card colour and motion picks`

---

### Task 11: Move the design-language rules the gate left standing

**Files**:

- Modify: [docs/DESIGN-LANGUAGE.md](../../docs/DESIGN-LANGUAGE.md)
- Modify: [scripts/design-language.test.ts](../../scripts/design-language.test.ts)

**Decision**: The card's own rules are **new numbers under §27** — the highest today is DL-27.24, so
the card starts at **DL-27.25**; §33 is the highest section and no new section is needed. Each moved
rule carries its cost and its cheapest revert in the rule text, per the house convention. **This
task runs AFTER Task 10**: rows 2, 3, 4 and 5 of that table decide what DL-1.2, DL-20.1, DL-21.1 and
DL-1.3 are amended TO, and writing the rule before the pick would record a decision nobody made.

- [ ] **Step 1: Write the gate assertions first**

```ts
describe("DL-27.25+ the worktree card", () => {
  it("declares the card rules and draws one hue per meaning", () => {
    // --green appears only on the active card's frame and its branch badge
    // the busy hue appears on head mark, row badge, bars, glow and beam — and nowhere else
    // --accent appears only on the +N segment
  });
  it("adds motion only under no-preference and binds every loop to a busy state", () => { /* … */ });
});
```

- [ ] **Step 2: Run and watch them fail** — `npx vitest run scripts/design-language.test.ts`

- [ ] **Step 3: Edit the rules**

| Rule | Edit |
| --- | --- |
| DL-27.15 | **Reversed** — the row's line is the pane label and its model, not the turn. Record that `tabTail` keeps the sentence on the strip's chips, so `session-tail` is not dead |
| DL-27.19 | **Retired** with a banner, and its CSS deleted. The `data-headless` seam does NOT survive — `PANE_TREE_HIDDEN` went with the tab tier in Task 6, so restoring the frame means restoring the tier first |
| DL-27.23 / DL-27.24 | **Amended** — the tiers are project → worktree → agent, and a worktree group collapses **and** is marked active. §14's "collapsing is out of scope" is reversed |
| DL-27.3 | **Amended on four clauses** — `working` is bars + glow + beam, `idle` paints nothing, marks are no longer one 14px box, and the `asked` halo has nowhere to land on a 5px corner badge. The loudest-wins fold survives at the head mark, which distinguishes busy from not |
| DL-21.1 | **Scoped exception, only if gate row 4 picked accent** — the active card takes an accent border. Record the cost (hue re-enters selection) and the one-`color-mix` revert. If the gate picked neutral `--hair-strong`, DL-21.1 does **not** move and this row disappears |
| DL-1.2 | **New exceptions, as many as gate row 2 left standing** — the rim beam (1 loop/agent) and/or the bars (3). Record that these scale with agent count, unlike both existing exceptions. Dropping the beam leaves ONE new exception, not two |
| DL-1.3 | **Touched only if gate row 5 kept a blur** — `inset 0 0 9px` would be the clause's first break ever. If the gate picked no-blur, DL-1.3 is **untouched** and the eight rule moves become seven |
| DL-20.1 | **Amended, in whichever form gate row 3 picked** — 6px/3px as an amendment, as two new named compact roles, or not at all if the gate snapped to `--radius-tight` / `--radius-flat`. Record that 6px was `--radius-control`'s own value until 2026-08-14 |

- [ ] **Step 4: Update the DL-1.3 violation ledger** with the rim glow's row.
- [ ] **Step 5: Run the gate** — `npx vitest run scripts/design-language.test.ts` → PASS, including
      the citation resolver (every cited rule resolves to a declared rule or section).
- [ ] **Step 6: Do NOT commit yet** — D14: documentation waits for the owner's approval.

---

### Task 12: Record the change

**Files**:

- Modify: [AGENTS.md](../../AGENTS.md) — a "Current direction" entry, a **Forks** queue entry, and
  the drift-table rows
- Modify: [docs/CONTEXT.md](../../docs/CONTEXT.md) — the decision trail
- Modify: [CHANGELOG.md](../../CHANGELOG.md) if the behaviour is user-visible in the next release

**Decision**: The fork entry names **four** fork-listed categories: rules in
`docs/DESIGN-LANGUAGE.md` (up to eight, fewer if Task 10's picks spare DL-1.3, DL-20.1 or DL-21.1 —
and **DL-27.21 is KEPT, not a ninth**: the agent row's own ✕ survives the tab tier), a frozen
decision reversed (DL-27.15's own 2026-08-17
override, and the tier spec's §14 scope line), an R4-adjacent seam (`RailWorktreeGroup`'s shape,
which both the rail and the gallery read), and an IPC **payload** widening on an existing channel.
It also names what is NOT touched: PTY, process classification, the window coordinator, tab
materialization, layout, close/quit coordination, the settings schema, the keymap, sibling repos.

- [ ] **Step 1: Write the drift-table rows.** Two claims flip to **false** — "a rail row shows the
      agent's newest turn" and "a rail row names a tab" — and the card's own row lands
      `building` / `unverified` until the native pass and the eye review happen.
- [ ] **Step 2: Run the docs gates**

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

- [ ] **Step 3: Do NOT commit** until the owner approves the wording (D14).

---

### Task 13: Verification

**Decision**: Nothing here is optional and no claim is made without its output pasted (W4/L5).

- [ ] `npx tsc --noEmit`
- [ ] `npm run electron:build`
- [ ] `npm test` — attribute any failure against a **pristine `HEAD` worktree** before blaming this
      work; this checkout is shared and peers commit under you
- [ ] `npm run build`
- [ ] `npm run generate:menu:check`
- [ ] `npm run lint` — the baseline **exits 1 on a clean tree** (41 pre-existing oxlint errors), so
      only NEW findings count; diff against the baseline rather than reading the exit code
- [ ] `npx vitest run scripts/design-language.test.ts` — the gate, with the new assertions
- [ ] Gallery pass in **both themes** and **both motion modes**, with computed-style audits: every
      radius is one of the two pinned values or `50%`; the busy hue resolves identically on every
      mark that means busy; the static glow is present under `reduce` while the beam is absent;
      the model pills share one right edge; exactly one row is washed; nothing overflows
- [ ] **`npm run electron:dev`** — the native pass. No card has ever rendered from real data
- [ ] **Owner eye review (DL §9.6)** of the **running app**, not a gallery specimen
- [ ] Windows stays **unverified** (Gate C) and Tauri a **named parity gap** — say so in the note

## 7. Self-review against the spec

| Spec section | Covered by |
| --- | --- |
| §3 the unit (card = checkout, rows = panes) | Task 4 |
| §4 the card, closed | Tasks 5, 6, 7 |
| §5 the card, open | Tasks 6, 7 |
| §6 the bare row | Task 6 (last test) |
| §7 the colour rule | Tasks 7, 10, 11 |
| §8 motion | Tasks 7, 10, 11 |
| §9 the eight DL forks | Task 11 |
| §10 measurements | Task 7 step 4, Task 13 |
| §3 the pane label (`Claude (Split)`) | Task 4 — `RailCardPane.label`; the three-pane collision is gate row 9 |
| §6 a bare row stays reachable | Task 6 — pressing it opens the launcher, so it is behaviour and not a dead label |
| §11.1 group has no card shape | Task 4 |
| §11.2 no per-pane model | Tasks 1, 2, 3, 8 — **resolved by transcript, not by settings** |
| §11.3 `thinking` | Fixed decision: dropped |
| §11.4 `+N` | Task 5 |
| §11.5 `New agent` | Task 6 |
| §11.6 collapse state | Task 6 — window-local, owner-decided |
| §12 selecting | Fixed decisions + Task 6; the shell-pane regression is in §5 of this plan |
| §13 open questions | 1/2/3/5 → Task 10's decision table (rows 1, 6, 5, 7); 4 → Task 5; 6/7/8 → fixed decisions |
| §14 host scope | Global constraints |
| §15 verification state | Task 13 |
| §16 shared-checkout risk | Global constraints, Task 7 step 1 |
| §17 out of scope | §4 of this plan |

**Nothing in the spec is unaccounted for, and nothing is silently settled.** Every remaining
multi-way trade-off — including three the spec presented as settled costs (the loop budget, the
radius break, the DL-1.3 blur) — is a numbered row in Task 10's table with its options and its
cheapest revert, so the owner picks against a drawing rather than against this prose.
