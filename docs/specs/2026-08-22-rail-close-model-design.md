# The rail's close model — design

Date: 2026-08-22
Status: `decided` (owner supplied the settled table in chat, 2026-08-22)
Scope: renderer, plus one branch of `disposeTab`. Both hosts.

## 1. The settled model

The owner handed this table over as decided. It is the whole requirement; the
rest of this document is what it implies.

| Gesture | Behaviour |
| --- | --- |
| ✕ on an agent row / ⌘W | Close exactly that pane |
| A tab's last agent | The tab disappears from the rail |
| The window's last agent | The window STAYS; the rail keeps its project headers; the stage shows the Open board |
| ✕ on a project header | Close every tab of that repository, secondary worktrees included, and remove the project from the rail |
| ⌘⇧W | Unchanged — closes the whole agent group of one tab |

## 2. What was wrong

The rail drew **agents** and closed **tabs**. Three different answers to one
gesture had accumulated:

- A row carrying one agent wore that agent's glyph and printed that agent's
  turn, and its ✕ said `Close tab`.
- A multi-agent tab had no ✕ anywhere. DL-27.13's parent row is behind
  `PANE_TREE_HIDDEN`, so its rows are the tab, and the rail's own comment
  admitted the gap: "the rail deliberately offers no close for such a tab (the
  strip's ✕ and ⌘W do)". Closing one of three agents from the rail was
  impossible.
- A project header's ✕ existed only on a REMEMBERED cluster, where it forgot a
  folder — a completely different verb from every other ✕ in the column.

And closing the last tab of a window closed the **window**. Losing your last
agent and losing the place you work were one gesture.

## 3. Rows 1 and 2 — the close follows the row

**The control closes the thing its row names.** That is the single rule; every
row below is an application of it.

| Rail row | Its ✕ closes | Why |
| --- | --- | --- |
| A leaf (one of several agents in a tab) | that pane | it names one agent |
| A tab row carrying ONE agent | that pane | it names one agent — glyph, turn and all |
| A tab row carrying NO agent | the tab | a plain shell has no agent to name |

Row 2 of the table is then a **consequence**, not a second behaviour: a pane
that was its tab's last takes the tab with it. `CloseCoordinator.closePaneAt`
decides that from `manager.paneCount()`, the tab's real pane count — never from
how many agent rows the rail drew, since `RailTabRow.panes` holds agent panes
only (agent-status-rail spec §9).

The knowing consequence, stated at build time: **a tab holding one agent beside
a plain shell now survives that agent's close.** The tab stays and re-draws as a
shell row. Read literally, "đóng đúng pane đó" says exactly this; the alternative
— killing a shell nobody asked about because an agent beside it closed — is not
something any row of the table asks for.

`closePaneAt(index, paneId)` is a new coordinator entry point rather than a
widening of `closePane()`. `closePane()` is ⌘W's, and can only ever mean the
focused pane of the ACTIVE tab; the rail points at a pane in a tab that is not
selected. The two share the contract, not the code path.

**Membership is checked before the routing, not after.** `index` is a
coordinate the rail read at render time, and a `pty:exit` closing an earlier tab
in between shifts every later one down — so an unvalidated `index` can name a
different single-pane tab, and routing on ITS pane count would close a tab the
user never pressed, silently, since `confirmClose` answers true when nothing is
busy. The pane id is the half of the gesture that cannot go stale, so it is
asked first: no match, no close.

## 4. Row 3 — the window stays

`disposeTab`'s empty branch stops calling `closeWindow()` and raises
`boardOpen` instead.

- The `surfaces.total() > 0` branch above it is untouched. A window holding a
  document shows the document, not the board — "last surface, not last tab"
  (file-explorer spec §7) still decides that, and it decides it first.
- `flushSettingsSave()` goes with the close. It existed to get settings to disk
  before the process could lose them; nothing here is dying any more.
- `boardOpen` is raised in `disposeTab` rather than reacted to in `App`, because
  `disposeTab` is the one place that knows the last tab just went. `App` already
  makes the board uncancellable while no tab is open
  (`canCancel={tabViews.value.length > 0}`), so the surface this raises cannot
  be dismissed into an empty stage.
- **`removeEmptyTab` keeps its `closeWindow()`.** That is the pane-MOVED path —
  a window that gave its last pane to another window. The table governs closing
  agents, not moving them; a donor window left sitting on a board would be
  worse than one that closes.
- Nothing else reaches `disposeTab` on a pty exit. A tab's last pane exiting
  prints `[Session ended — press Enter to start a new one]`
  ([`handleExit`](../../src/terminal/terminal-manager.ts) `current`) and removes
  no tab at all, so there is no second path to keep in step.

## 5. Row 4 — the project header

Two halves, one act.

**Close every tab.** `CloseCoordinator.closeTabs(indexes)` asks the busy guard
ONCE, over the union of every pane of every tab. N calls to `closeTab` would
raise N dialogs — the user pressed one control, and answering the same question
five times is how a confirmation stops being read — and would walk stale
indexes, since every dispose shifts the list. The entries are pinned by identity
before the first dispose and re-found with `indexOf` for each one. It returns
`boolean`: a declined dialog disposes nothing and answers `false`.

**Take the project off the rail.** Closing the tabs alone would only demote the
cluster to the remembered tier — the header would stay exactly where it was and
the ✕ would read as broken. So the persisted history entries the cluster stands
for go too, and only if the first half actually happened.

`RailStreamGroup.historyPaths` is therefore populated for a LIVE cluster now.
The set is the entries `rememberedClusters` currently SUPPRESSES for this
cluster, by both of its rules:

- **prefix attach** — a history entry under one of this cluster's open
  worktrees, which is the test that suppresses it today;
- **same project key** — a worktree of this repository with nothing open in it.
  That one is not prefix-attached to any live path, so it would build its own
  remembered cluster carrying this project's own `orderKey`, and the header the
  user just pressed would reappear under the same name.

`RailStreamGroup.tabIndexes` is the other new field: every open tab index the
cluster holds, ascending — a reading order, not a safety one. `closeTabs`
resolves each index to its tab entry before the first dispose and re-pins by
identity afterwards, so no order of this list can hand it a stale coordinate. It
is derived in the model rather than re-read from `rows` by the component so the
"one project, one close" unit is stated where the folding rule that makes a
secondary worktree part of this project already lives.

**File surfaces.** `workspaceOrphanedByClose` answers "does this workspace
survive the loss of ONE tab", which is the wrong question when every tab of the
project is going: a project with two tabs in one workspace would answer "the
sibling survives" twice and strand both. `workspacesOrphanedByClose` computes
the survivor set once, against everything that is closing, and keeps the
singular's two carve-outs (no workspace → nothing; empty remainder → nothing,
which is §4's territory).

## 6. Row 5 — ⌘⇧W

Untouched. `close-tab` is the whole agent group of one tab, and nothing in the
rail duplicates it: the rail closes agents and projects, never a tab-as-a-group.

## 7. Design language

One new rule, **DL-27.21**, covering all of §3 and §5. Its geometry is DL-27.5's
swap in both places:

- a leaf's close takes the agent glyph's trailing slot, exactly as the tab row's
  already does;
- the header's close takes the CARET's slot — which is that same 17px trailing
  column, restated by the header's grid (DL-27.18's own comment: "the last track
  is the rows' own 17px glyph slot"). No fourth track opens, so no control
  leaves the rows' edge.

The caret gives that slot up only while the close is up — pointer over the
cluster, or a keyboard focus already on the close — including the collapsed
state that otherwise pins it visible. At rest, which is when "folded, not empty"
has to be readable, the caret is unchanged.

A leaf stops being a `<button>` and becomes DL-27.1's container plus full-bleed
hit layer, the shape `.asr-row--tab` has always had. A button cannot hold a
button.

The hover wash stays neutral (DL-21.2), including on the project close. The busy
dialog is what guards a running process; `--red` would spend DL-3.2's danger ink
on an everyday act.

## 8. Files

| File | Change |
| --- | --- |
| [`agent-rail-model.ts`](../../src/ui/agent-rail-model.ts) | `historyPaths` for live clusters (`coveredHistoryPaths`), new `tabIndexes` |
| [`close-coordinator.ts`](../../src/terminal/close-coordinator.ts) | `closePaneAt`, `closeTabs` |
| [`tab-manager.ts`](../../src/terminal/tab-manager.ts) | `disposeTab`'s empty branch; two handle methods |
| [`tab-manager-types.ts`](../../src/terminal/tab-manager-types.ts) | the two methods on the handle contract |
| [`agent-rail.tsx`](../../src/ui/agent-rail.tsx) | leaf container + hit layer + close, tab-row close routing, live header close |
| [`app-policy.ts`](../../src/ui/app-policy.ts) | `workspacesOrphanedByClose` |
| [`app.tsx`](../../src/ui/app.tsx) | `closePaneAt`, `closeProject`, two rail props |
| [`04a-agent-rail.css`](../../src/styles/04a-agent-rail.css) | the live header close and the caret it displaces |
| [`04b-agent-rail-rows.css`](../../src/styles/04b-agent-rail-rows.css) | the leaf's hit layer, inert text, and the close over the glyph |
| [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) | DL-27.21 |

No IPC channel, no settings field, no keymap action and no menu registry entry
moved, so `generate:menu` does not run.

## 9. The fork

Four fork-listed categories, resolved by the owner's table itself:

- **close/quit coordination** — §4 reverses "the last surface closes this
  window" (electron migration spec §9.5). This is the substantive one.
- **tab materialization / layout** — untouched; `closeTabs` and `closePaneAt`
  are new entry points on the existing coordinator, and no R4 seam moved.
- **a rule in `DESIGN-LANGUAGE.md`** — DL-27.21 is new.
- **pane ownership** — not touched: `closePaneById` is the same call ⌘W makes.

## 10. Unverified at design time

- No host has run. The window-stays branch has never been seen; the board it
  raises has never been seen raised this way.
- No agent has been closed from a leaf, and no project has been closed from a
  header.
- Windows is Gate C as always.

## 11. Out of scope

- A close for a whole multi-agent TAB from the rail. ⌘⇧W is that (§6).
- Any undo for the project close beyond ⌘⇧T's per-tab reopen, which
  `disposeTab` still takes a snapshot for on every tab it disposes.
- The remembered header's ✕, which keeps its 2026-08-20 meaning exactly:
  nothing is open there, so it forgets and never closes.
