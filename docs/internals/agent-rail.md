# Agent Rail

> For maintainers. Using Deck? See [docs/user/](../user/).

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
  repository folds into one cluster. A folder git does not know is a `plain:<path>` cluster,
  and so is a folder inside a repository rooted above it: the
  [scan](../../electron/worktrees.ts) only answers `repository` for a checkout's own root,
  so an opened folder is never named after an ancestor repository.
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

Codex's [output-timing fallback](../../src/terminal/agent-attention.ts) is armed only
after genuine keyboard or paste [input](../../src/terminal/pane.ts) reaches the current
agent generation. Launch commands and terminal capability replies do not arm it; explicit
OSC and lifecycle reports remain authoritative.

## Agent usage and session re-entry

The [sidebar summary](../../src/ui/usage/agent-usage-summary.tsx) replaces Unread
below the project scrollport. Its [single badge row](../../src/styles/15-rail-footer.css)
fits its content and separator padding, with horizontal overflow in narrow sidebars.
Each agent badge shows only the logo and adjacent limit value; the name and unavailable
state are available through its tooltip and accessible label. A dash means missing,
expired or failed data, never zero quota. Selecting a badge opens the existing
[Usage dock](../../src/ui/usage/usage-dock-tab.tsx).

[Electron's limit service](../../electron/agent-limits/service.ts) reads Codex's
`account/rateLimits/read` using the installed CLI and its default login profile,
without starting a model turn. It shares one request per minute across windows.
The [normalizer](../../src/lib/agent-limits.ts) selects the `codex` bucket and
uses the returned window duration: `primary` is not necessarily five hours.

For Claude Code on macOS/Linux, the service installs a
[status-line collector](../../electron/agent-limits/claude-reader.ts) in the
configured Claude user settings, preserving the existing command and its options.
The original configuration stays in the private `agent-limits/statusline-owner.json`
under Electron userData; `restoreClaudeLimitCollector` restores only a still-owned
command and leaves newer user edits alone. If Deck's executable or script disappears,
the installed shell command falls back to the original status line. The
[collector](../../electron/agent-limits/claude-statusline.ts) forwards the original
stdin/output and records only five-hour/seven-day quota fields in bounded local
captures. It does not store prompts or authentication tokens.

Claude's source is a session-reported observation, not an on-demand account API.
Each status-line receipt renews its capture timestamp, even when the percentage
is unchanged. The newest capture with limit data wins across sessions; a session
without limits cannot hide another session's reading. No window is inferred when
the CLI omits it. Both providers expire at reset or after five minutes without a
new observation (a status-line receipt for Claude). The
[sidebar](../../src/ui/usage/agent-usage-summary.tsx) expires values even without an
IPC reply. Multiple login profiles are not aggregated. Tauri has no collector;
Claude collection on Windows and Codex `.cmd` shims currently return unavailable.

[Recent activity](../../src/ui/sessions/recent-session-activity.tsx) remains a
reusable component with its exact-session re-entry contract, but is no longer
mounted in the sidebar. The [Sessions dock](../../src/ui/sessions/sessions-dock-tab.tsx)
retains the full history and Resume action.

On click it rechecks
[the exact agent/session pairing](../../src/ui/sessions/live-session-state.ts)
on click before resuming. A contract-reported session id outranks a tail pairing;
a directory match alone cannot identify a conversation. An exited match may
still supply a status mark, but is never a focus destination. The lookup is
window-scoped; it does not discover running sessions in another Deck window or
another terminal. During a launch initiated by Recent activity,
`TabManager.materializePane` returns the exact created pane id and a validity check. The row retains
that destination until a confirmed match exists, the pane exits/closes, or a
conflicting identity appears. A readiness cancellation or rejected PTY write
invalidates the receipt so the row can retry. This receipt prevents another click from spawning
a duplicate during startup; it never supplies a live status or claims that the
CLI has resumed successfully. Do not infer this receipt from the active pane or
newest tab: concurrent launches can change both.

Opening is the materialization promise, not agent readiness. The synchronous
per-session pending guard covers repeated clicks until that promise settles;
agent-working feedback continues to come from the pane signal. The full Sessions
view still uses its explicit Resume action.

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
- **Codex panes are never ranked.** The [tail store](../../src/terminal/session-tail-store.ts)
  requires a session-id fact and sends `preferredId` with `exact: true`; without a fact it
  sends no request, even for a resumed pane. A missing rollout leaves the row blank.
  A new fact discards any previous guessed pairing and its text, including late replies.
- **Open writer locks identify Codex before its first prompt.** On Electron macOS/Linux,
  [one background `lsof` batch](../../electron/platform/codex-thread-locks.ts) reads each
  Codex foreground pid's open `~/.codex/thread-writer-locks/<thread-id>.lock` files.
  One unique lock supplies the id. A process can also hold subagent locks: multiple locks
  require exactly one matching rollout with an explicit interactive string `source`;
  object-valued subagent sources and `exec` are excluded. Missing tools, unreadable metadata
  or ambiguity yield no identity. This is an undocumented Codex internal; Windows supplies
  no lock identity and Tauri has no implementation. The
  [pty-info reader](../../electron/pty/info.ts) binds background results to the observed
  process generation; the [client's availability gate](../../src/terminal/pty-client.ts)
  and existing tracker carry the fact to the pane without inferring activity.
- **Other agents can still use transcript ranking.** The
  [store](../../src/terminal/session-tail-store.ts) asks after `hasRun`, a resume mark or an
  exact fact. Fresh generations carry `notBefore`; the
  [resolver](../../electron/resume/resolve.ts) drops older candidates. This floor only
  narrows a guess. Exact pins bypass ranking, and resume marks omit the floor. Requests
  are debounced 300ms on `tabViews`, never on a timer.
- **The pane→session pairing is remembered and pinned.** A request carries `preferredId`,
  and `resolveSessionTails` runs two passes: every pin is honoured through
  `findCandidateById` (no 30-day cutoff, no ranking) before any eligible, non-exact pane is ranked by
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

Recent/Unread rows must match a **contract session ID** before borrowing a pane's attention
or focusing it. A remembered tail pairing may still be a transcript-time guess; it is not
navigation authority. Without confirmed identity, Recent resumes the selected session.
Its own launch receipt can reuse the newly created pane until a confirmed ID is available;
a guessed pairing cannot redirect or invalidate that receipt. See
[`live-session-state.ts`](../../src/ui/sessions/live-session-state.ts).

## The needs-you chip

The strip's count of `asked` and `failed` panes (DL-27.26) lives in
[`src/ui/attention/`](../../src/ui/attention/). What a maintainer would get wrong:

- **It is a projection of this page's model, not a second reading of the tracker.**
  [`buildAttentionList`](../../src/ui/attention-list-model.ts) walks the same
  `buildAgentRail` panes the rows come from, so the count cannot disagree with the
  sidebar. `asked` folds a question, a warning and an unchecked finish, so an entry's
  reason says `Needs you` and cannot say which; telling them apart means carrying
  `PaneView.attention` through `RailPaneRow`.
- **A choice is `activateForAttention`, never `focusNextAttention`.** `App` passes the
  rail's own `focusRailPane`, so the overlay preflight runs first and only the chosen
  pane is acknowledged. ⌘⇧A is unchanged: the oldest pane of the highest severity.
- **The age is the tracker's `changedAt`:** the last time any visible field changed, not
  when the attention latched. A session id or a phase change after the latch moves it.
  The rail's own age is the same field.
- **A closed pane leaves no entry, and nothing retains one.** `disposeTab` prunes the
  tracker right after taking the ⌘⇧T snapshot, which keeps layout, name, colour, cwds and
  workspace — no agent, no session id, no attention — and closing a pane that is not its
  tab's last takes no snapshot at all. A stale entry with Resume and Dismiss needs a
  store written before that prune, which is on the close seam (R4).

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

## The checkout card, and its strip

On Electron a cluster's checkouts are drawn as disclosure cards
([`agent-rail-card-model.ts`](../../src/ui/agent-rail-card-model.ts),
[`worktree-card.tsx`](../../src/ui/worktree-card.tsx)); Tauri stays on `RepositoryRail`
rather than inheriting a surface whose git and session sources it lacks.

- **The head names the checkout once.** The primary checkout is named by its **branch**,
  every other by its folder, and the badge takes whichever fact the label did not
  (`Primary`, `Worktree`, or the branch). The primary sits at the repository root, so its
  basename is the word the cluster header already printed above it — and
  `git worktree add ../fix-login fix-login` makes folder and branch one word one tier down.
  `RailWorktreeGroup.name` stays a **fact**; the label is display.
- **Model pills are withheld in production.** The available pane → session pairing is
  heuristic, and a missing pill is more truthful than a guessed model.
- **A closed card's strip segment is one agent KIND**, ranked by `STATE_RANK`'s own
  `outranks`, with `×N` beside the glyph when several panes share it. The cost is stated
  rather than argued: a merged segment wears **one** state mark, its loudest pane's, which
  is why the hover menu is not a convenience.
- **Every segment is a `<button>`.** A single-pane segment focuses its pane. A merged `×N`
  segment and the `+N` tail **pin the menu open** on press instead of guessing a pane —
  pressing the loudest pane closed the hover menu under a pointer that could not re-raise
  it, which reads as "click only blinks". Hover or keyboard focus raises the panes behind a
  segment as ordinary rows.
- **The fold is by measured width.** `useStripMetrics` reads the stylesheet's own
  `max-width` back as the budget and the real segment boxes as their widths, so the room a
  strip has has one source of truth. The `+` is never what folds: a launcher that vanishes
  when a checkout gets busy is missing exactly when it is wanted.
- **A segment shape's width is learned once per session, never re-learned.** Two cards read
  the same shape one pixel apart — 47px behind a `×5` segment, 46px when it sits first — and a
  cache that let the second card overwrite the first re-rendered both cards forever inside one
  Preact `process()` call, which has no update-depth guard; the 1.1.0 build froze on exactly
  this. The shared cache in
  [`worktree-card-strip.tsx`](../../src/ui/worktree-card-strip.tsx) therefore keeps the first
  reading, keys a merged segment by its count's digits, drops everything on a
  `devicePixelRatio` change, and stops learning for the session past a bump ceiling. A fix
  that lets a strip re-learn a width has to explain why it terminates.

## One create control per checkout

The checkout create controls open the Electron
[agent launch page](../../src/launcher/agent-launch-page.tsx): the expanded `New agent`
row, collapsed `+` and bare checkout share this route; a folder git does not know renders
the same card and bare row, badged `Folder`. A press creates
nothing. `Run` splits right beside a captured pane in that checkout, or opens one first
pane when it has no live tab. The page adds no task-strip item; Back and Escape restore
the previous surface ([page state](../../src/launcher/agent-launch-page-store.ts)).

Right-click still raises the [checkout actions menu](../../src/ui/worktree-card-menus.tsx).
Its quick agents open new tabs, `Open shell` opens a new shell tab and `New split here`
creates a shell split, materializing one pane when no matching tab exists. The two menu
groups and single separator remain. The page and menu use the same up-to-five
[Quick agents selection](../../src/settings/quick-agents.ts): unset uses defaults, an
explicit empty selection stays empty, and unavailable choices are omitted without
replacement.

Cmd/Ctrl+T opens or dismisses the page for the active workspace; without a workspace it
opens the Open board. Frame New, dragging New onto a pane, and the Tauri menu fallback
retain their existing paths ([entry routing](../../src/ui/app.tsx)). The project-header
and task-strip create buttons remain absent.

The native browser is obscured while the page or a rail menu covers its stage.
[App](../../src/ui/app.tsx) retains the underlying terminal DOM and makes covered stage
content inert, so opening the launcher neither resizes nor stops a terminal. Right-click
menus keep their fixed placement beside the rail card.

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
