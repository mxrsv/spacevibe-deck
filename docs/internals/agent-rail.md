# Agent Rail

The rail is the left column: one cluster per project, one row per agent pane, each row
saying what its agent last said and in what state. This page states the invariants of the
model, the state derivation, the pairing that reads a sentence off the agent's own session
log, and the close and order rules. Visual rules are in
[`DESIGN-LANGUAGE.md` §27](../DESIGN-LANGUAGE.md).

## Model

[`src/ui/agent-rail-model.ts`](../../src/ui/agent-rail-model.ts) is a pure projection over
`tabViews`, the active tab index, the repository scans, the workspace history, the tails and
the stored `railOrder`. The clock is injected; nothing in it calls `Date.now`. It reuses
`buildRail` from [`repository-model.ts`](../../src/repositories/repository-model.ts) for
grouping rather than regrouping on its own.

- **Every open tab produces a row.** The rail is the sidebar's only list. Shell panes and
  panes with no recognised agent are dropped from a tab's agent rows in `paneRows` and
  nowhere else.
- **A cluster is a repository, keyed by its `--git-common-dir`,** so every worktree of one
  repository folds into one cluster. A folder git does not know is a `plain:<path>` cluster.
  `RailStreamGroup.orderKey` is produced, never derived by stripping a prefix off `key`: it is
  the repository key or `plain:<path>`, and it is what the stored order is written against.
- **Clusters sit where their oldest tab put them,** then remembered clusters follow: a
  workspace-history folder with nothing open keeps a rowless header, deduplicated against
  every live worktree path and folded per repository. `historyPaths` is populated for live
  clusters too, so a header's ✕ can remove the project instead of demoting it to the
  remembered tier.
- **Rows are in open order, not recency.** `sortByOpenOrder` sorts by `openedAt` then index.
- **A tab row's sentence and state are its loudest pane's:** highest `STATE_RANK`
  (`failed` 4, `asked` 3, `working` 2, `done` 1, `idle` 0), then newest `changedAt`, then pane
  order. `tabTail` exports the same fold for the tab strip's chips, so the two surfaces
  cannot disagree.
- **At most one row in the whole rail is focused.** `RailPaneRow.focused` is
  `PaneView.focused` ANDed with the tab's `active`, in the model where it is assertable.
  A document or the browser on the stage does not clear the mark; the row then reads as
  where the keyboard returns to.

## State

`paneState` reads latched attention before live phase:

| Attention                              | Phase     | `hasRun` | Rail state | Mark                  |
| -------------------------------------- | --------- | -------- | ---------- | --------------------- |
| `error`                                | any       | any      | `failed`   | red dot               |
| `requested`, `warning`, `completed`    | any       | any      | `asked`    | yellow dot            |
| `none`                                 | `working` | any      | `working`  | spinner, no dot       |
| `none`                                 | other     | true     | `done`     | nothing               |
| `none`                                 | other     | false    | `idle`     | nothing               |

The words (`failed`, `needs you`, `working`, `done`, `idle`) live only in the row's title and
accessible name. Where attention and phase come from is in
[terminal.md](terminal.md#agent-phase-and-attention).

## The sentence, and the pairing behind it

The rail's sentence is the newest assistant text in the agent's own session log, read by
[`electron/resume/session-tail.ts`](../../electron/resume/session-tail.ts) over the
`session_tail` channel and requested by
[`session-tail-store.ts`](../../src/terminal/session-tail-store.ts). Electron only: on Tauri
and in the browser preview the channel does not exist, `installSessionTailSync` returns a
no-op, and the rail falls back to agent names.

- **Only Claude Code, Codex and OpenCode produce a tail.** Gemini has no candidate scan,
  Antigravity's store is an undocumented protobuf, and custom agents are unknown. Those rows
  keep their agent name.
- **A pane is asked about only once it has run something** (`hasRun`, or it was resumed), so a
  fresh pane cannot wear a previous session's sentence. Requests are debounced 300ms on
  `tabViews`, never on a timer.
- **The pane→session pairing is remembered and pinned.** A request carries `preferredId`,
  and `resolveSessionTails` runs two passes: every pin is honoured through
  `findCandidateById` (no 30-day cutoff, no ranking) before any unpinned pane is ranked by
  mtime proximity through the same `selectCandidate` that session restore uses. The two
  passes exist because the earlier one-pass version let an unpinned pane earlier in the
  request take a later pane's pinned session, which is how three rows once printed the same
  sentence; reserving every pin first is what rules that out.
- **The answer is `{ id, tail }`.** Only the id separates "same conversation, nothing new to
  quote" (keep the row's text) from "different conversation" (take the new pairing and the
  new text, even when empty).
- **A pairing does not outlive its agent generation.** The store forgets a pane's pairing when
  its agent label changes or `hasRun` goes true → false, and its fingerprint covers every
  pane so a generation change cannot be skipped as a repeat.
- **The read window grows.** 64 KiB, then 256 KiB, then 1 MiB from the end of the file, each
  a fresh read; a working agent's tool traffic fills the last 64 KiB with `tool_result`
  records. A short `readSync` is not EOF, so no step exits early.
- **Reasoning is never quoted.** OpenCode parts match `type === "text"` exactly, not the
  presence of a `text` field, because `reasoning` parts carry one too. OpenCode's store is
  read through `node:sqlite` first, then the legacy JSON tree, deduplicated by id; sub-agent
  sessions (`parent_id IS NOT NULL`) are excluded because they share their parent's
  directory.
- Every scanner caps at 300 files, and the request carries the tab's cwd, not the pane's.

## Focus

`onFocusPane` from a row runs the attention-focus coordinator, which activates the tab and
pane and clears that pane's latched attention. The keyboard mark itself comes from
`PaneView.focused`, projected from `TerminalManager.activePaneId()` and reported through
`ManagerCallbacks.onActivePaneChange`, which fires from `setActive` because every focus path
converges there. Split, close, respawn and adoption assign the active id directly and are
covered by `onLayoutChange` and the pane poller, so the projection self-heals.

## Close model

The control closes the thing its row names ([`close-coordinator.ts`](../../src/terminal/close-coordinator.ts)):

- An agent row's ✕ closes that **pane**, with ⌘W's own contract: the tab follows only when
  the pane was its last, decided from `manager.paneCount()`, never from the rail's agent-row
  count. A tab holding one agent beside a plain shell survives that agent's close.
- A row with no agent is a shell tab and closes the **tab**.
- A live project header's ✕ closes **every tab of the repository**, secondary worktrees
  included, under one busy dialog, and only then drops the project's history entries.
  `closeTabs` pins entries by identity before the first dispose and answers `false` on a
  decline, so a cancelled close cannot forget a project whose tabs are all still open.
- A remembered header's ✕ forgets every history entry it folds.
- The window outlives its last agent: the last tab closing raises the Open board and leaves
  the window standing. Only the pane-moved path (`removeEmptyTab`) still closes a window.

## Order

A project cluster goes where the user drags it and stays there
([`rail-order.ts`](../../src/ui/rail-order.ts),
[`rail-cluster-drag.ts`](../../src/ui/rail-cluster-drag.ts)).

- The header is the whole cluster's drag handle; only clusters drag, never rows or panes.
  One pointer controller is delegated on the list, because a header re-renders whenever an
  agent speaks and a per-element controller would be disposed mid-drag.
- `railOrder` is a settings field: pinned cluster keys first in stored order, everything else
  in today's assembled order. An empty `railOrder` returns the assembled array itself.
- A drop pins every cluster above it, or slot 1's open order would push slot 2 around. A
  pinned cluster ignores the live/remembered boundary, because the position survives the
  cluster's last tab closing. `pinAt` refuses a drag whose `orderKey` is not unique on screen.
- `plain:<path>` entries written before a scan lands are rewritten to the repository key on
  the next write, so the list canonicalizes instead of holding two spellings. The cap is
  200 entries; entries naming no visible project are kept, since that is how a parked
  project returns to its slot.
- Settings are app-level, so a drag reorders every window's rail. There is no keyboard
  equivalent.

## Other surfaces in the column

- Each project header carries `+`, which opens the quick picker with
  `quickPickerWorkspace` pinned to that project; `newTab()` clears the signal so the next ⌘T
  does not inherit the rail's target.
- `PANE_TREE_HIDDEN` in [`agent-rail.tsx`](../../src/ui/agent-rail.tsx) renders a
  multi-agent tab as flat agent rows inside a hairline frame (the `data-headless` CSS seam in
  [`04b-agent-rail-rows.css`](../../src/styles/04b-agent-rail-rows.css)) instead of a parent
  row with elbow guides. Flipping the constant restores the tree.
- [`repository-rail.tsx`](../../src/ui/repository-rail.tsx) is the rail this one replaced.
  It still builds and is mounted only in the gallery.
- Repository scans come from `git_repository` (Electron only) through
  [`repositories-store.ts`](../../src/repositories/repositories-store.ts): derived git facts
  are never persisted, only collapse state is, a scan failure degrades to a `plain` cluster,
  and a return to the window refreshes rather than invalidates so the sidebar does not jump.
  No `git status` is run anywhere.
