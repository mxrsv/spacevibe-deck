# Agent Rail

> For maintainers. Using Deck? See [docs/user/](../user/).

The rail is the left column: a flat tree of project, checkout and session row, each row
saying what it is about, what its agent last said and in what state. This page states the invariants of the
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
  (`failed` 5, `asked` 4, `ended` 3, `working` 2, `done` 1, `idle` 0), then newest
  `changedAt`, then pane order. `tabTail` exports the same fold for the tab strip's chips, so the two surfaces
  cannot disagree.
- **At most one row in the whole rail is focused.** `RailPaneRow.focused` is
  `PaneView.focused` ANDed with the tab's `active`, in the model where it is assertable.
  A document or the browser on the stage does not clear the mark; the row then reads as
  where the keyboard returns to.

## State

`paneState` reads latched attention before live phase:

| Attention                           | Phase     | `hasRun` | Rail state | Mark                   |
| ----------------------------------- | --------- | -------- | ---------- | ---------------------- |
| `error`                             | any       | any      | `failed`   | red badge              |
| `requested`, `warning`, `completed` | any       | any      | `asked`    | yellow badge           |
| `none`                              | `working` | any      | `working`  | loading bars, no badge |
| `none`                              | other     | true     | `done`     | quiet gray badge       |
| `none`                              | other     | false    | `idle`     | nothing                |

The row's accessible name carries the lower-case words (`failed`, `needs you`, `working`, `done`,
`idle`); its second line carries a capitalised state word only until the agent has a sentence
(`stateWord` in [`agent-rail-card-model.ts`](../../src/ui/agent-rail-card-model.ts)). Where
attention and phase come from is in
[terminal.md](terminal.md#agent-phase-and-attention).

On a session row the badge is drawn on the corner of the row's own logo, never in the
trailing cell, which keeps only the working bars and close.
The same row quiets its logo unless `needsUser` holds (`asked` or `failed`), so the badge is
not what keeps a needs-you logo at full ink: a row's logo kind (colour image, ink mark, letter
avatar) decides how it goes quiet, and it never uses `filter`.

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

## The checkout tree

On Electron a cluster's checkouts are label lines with their session rows beneath
([`worktree-card.tsx`](../../src/ui/worktree-card.tsx), DL-27.28); Tauri stays on
[`RepositoryRail`](../../src/ui/repository-rail.tsx), whose git and session sources it lacks.
The checkout card, its disclosure and its folded strip retired on 2026-10-07; the project
header's caret is the only fold.

- **The label line names the checkout by its branch** (`checkoutLine`), tagged `worktree` for a
  linked worktree and `folder` for a folder git does not know. Accessible names, the actions
  menu and the Agent Board still name a checkout through `checkoutLabel` — a linked worktree
  there is its folder — so the line and the accessible name can differ by design.
- **A row's first line is its task label:** the tab name, else the session's first prompt,
  else the agent label (`buildCardEntries`). The first prompt is `SessionEntry.title`, Claude
  Code and Codex only, joined on the pane's contract `sessionId` (`sessionTitlesFor`), never
  on a tail pairing. The session list is scanned only when Sessions or the Open board opens,
  so the rail asks for a scan itself when an unnamed pane's session is unknown
  ([`requestSessionTitles`](../../src/sessions/sessions-store.ts)), at most once per 30s and
  only when `tabViews` changes. Until it lands the row reads the agent label.
- **The second line is never empty.** It is the agent label · the status, where the status is
  the newest sentence or, before one, the state word; with the agent label as the first line it
  is the status alone. `No signal` means an idle pane the tracker has seen nothing from
  (`unknown` confidence), which every agent without a contract-layer source stays until it
  works; the sentence beats a contract `detail`, which beats the `Needs you` word.
- **The second line carries the ordinal.** Two rows of one CLI in one checkout stay apart on
  their visible lines: the checkout-wide ordinal lands on the sentence, or on the agent label
  of a row that has said nothing yet, never on a task label.
- **The header counts who needs you** (DL-27.27, amended): the project's `asked` and `failed`
  panes, from the same `RailWorktreeGroup.panes` the rows come from, so it cannot disagree
  with them. Remembered headers carry none.
- **The model is a tooltip, not a pill, and is withheld in production.** The available
  pane → session pairing is heuristic, and a missing model is more truthful than a guessed one.
- **No frame marks the focused project.** The current checkout's label line and the focused
  row are the only "you are here" marks; rows have no fill at rest.

## The collapsed column

On Electron the sidebar's collapse is a column of project avatars, not an empty edge
(DL-27.29, amending DL-18.9); Tauri still hides it. There is one stored fact,
`settings.sidebarCollapsed`, written by the stage-strip toggle, the frame row's toggle, a drag
past the floor and the `toggle-sidebar` chord alike, so the four routes cannot disagree.

- **The shell attribute is `column`, not `true`.** [`applySidebarShell`](../../src/ui/sidebar-shell.ts)
  writes `data-sidebar-collapsed="column"` on Electron; every rule that hides the rail keys on
  `"true"` and still applies to Tauri. Reusing `"true"` would hide the column along with the
  tree. The width is [`SIDEBAR_COLUMN_WIDTH`](../../src/ui/panel-resize.ts) through
  [`sidebarPaintWidth`](../../src/ui/app-policy.ts), and an armed drag paints it too, so the
  column snaps under a pointer that has passed the floor.
- **The frame row is hidden in column mode.** Its 78px traffic-light reservation does not fit a
  52px cell, so [the column](../../src/ui/agent-rail-column.tsx) carries its own drag strip
  where the lights are painted and the stage strip insets by the remainder
  ([styles](../../src/styles/04e-rail-collapsed.css)). The expand control stays on the strip's
  leading edge, DL-18.9's second mount; the column draws no control of its own.
- **Avatars are a projection of the tree's view** ([`buildRailAvatars`](../../src/ui/agent-rail-collapsed-model.ts)),
  so the badge counts the same `asked` and `failed` panes the header does. Remembered projects
  have no avatar. A project without a favicon prints its initials rather than the shared
  folder glyph.
- **The flyout is the tree's `WorktreeCard`.** It restyles nothing, so a change to a row
  reaches it. Choosing a row or any `+` action closes it first, because each opens something on
  the stage. A checkout menu opened inside the flyout shares its capture-phase Escape listener,
  so one Esc closes both.
- **`AgentRail` unmounts the list while collapsed,** so the cluster drag controller is rebound
  whenever the rail expands again.
- **`toggle-sidebar` is ⌘B on macOS and Ctrl+Shift+L on Windows.** Bare Ctrl+B is readline's
  cursor-back and tmux's prefix, so Deck cannot consume it. The chord is performable only while
  a tab is open, and it returns focus to the stage because the control that held it unmounts.

## The tools row

The rail's foot is an icon row above the usage summary (DL-28), and the agent pane header
carries its pane's own actions (DL-32.8). What a maintainer would get wrong:

- **The row is Electron's, and `More` is its fallback.** [`App`](../../src/ui/app.tsx) mounts the
  [row](../../src/ui/sidebar-actions.tsx) only for `sidebar && railAvailable && !isTauriHost()`
  and tells [`DeckToolbar`](../../src/ui/toolbar/deck-toolbar.tsx) the same fact. Where it is
  false (top-tab mode, Tauri, a window with no tab) `More` keeps the global group, which is also
  the Prompt Board popover's only anchor there. Drop the `railAvailable` term and an empty
  Electron window loses its only pointer route to Settings.
- **The popover has exactly one anchor.** Expanded: the row's slot. Collapsed: the `Tools`
  button's slot. `More`: only when it holds the global group. Two at once would double-render it.
- **Collapsed, the footer rides the avatar column.** `AgentRail` hands `footer` to
  [`RailAvatarColumn`](../../src/ui/agent-rail-column.tsx) because the column returns before the
  tree's own footer slot; `SidebarActions` switches to one `Tools` button and a
  [popover of rows](../../src/ui/rail-tools-menu.tsx) on `collapsed`.
- **The icons open and report nothing** (DL-28.5). `ToolbarControl` is deliberately not reused:
  it emits `aria-expanded` for a dialog trigger, which a button that never reverses would be
  lying about.
- **Tooltips open above** (`placement: "above"`, [`action-tooltip.tsx`](../../src/ui/controls/action-tooltip.tsx)):
  a tooltip below a bottom-edge trigger is off the window. They are suppressed while the Prompt
  Board is open, since it flies up over the same space.
- **Header actions reach `App` through a registry.** The header renders in its own Preact root
  inside the pane bar, so [`pane-header-actions.ts`](../../src/terminal/pane-header-actions.ts)
  carries the handlers. A split and Focus expand act on the *active* pane, so they focus the
  pressed pane first and continue only if it took the focus; a refused focus (a preset draft is
  open) must not split whichever pane was active. Close is already pane-exact. No file on the
  PTY, layout or close seam changed for this (R4).
- **The narrow rule is measured, not a container query.** `container-type` is layout containment,
  which would make the pane bar the containing block of the actions' `fixed` tooltips and move
  them.

## One create control per checkout

A checkout's `+` on its label line opens the Electron
[agent launch page](../../src/launcher/agent-launch-page.tsx) on that checkout; a checkout with
nothing open is its label line alone, and the `+` is its way in. A press creates nothing.
[`resolveAgentLaunchTarget`](../../src/terminal/agent-launch-target.ts) captures `split` only
when the active tab belongs to that checkout, `new-space` when its tabs sit in the background,
and `first-pane` when it has none; the page's destination line says which before `Run`
(RAIL4). A captured new space is named for its folder and agent, as the `New space` button's
is. The page adds no task-strip item; Back and Escape restore the previous surface
([page state](../../src/launcher/agent-launch-page-store.ts)).

Right-click still raises the [checkout actions menu](../../src/ui/worktree-card-menus.tsx).
Its quick agents open new tabs, `Open shell` opens a new shell tab and `New split here`
creates a shell split, materializing one pane when no matching tab exists. The page and menu
use the same up-to-five [Quick agents selection](../../src/settings/quick-agents.ts): unset
uses defaults, an explicit empty selection stays empty, and unavailable choices are omitted
without replacement.

Cmd/Ctrl+T opens or dismisses the page for the active workspace; without a workspace it
opens the Open board. Frame New, dragging New onto a pane, and the Tauri menu fallback
retain their existing paths ([entry routing](../../src/ui/app.tsx)). The project header
carries no create button.

The native browser is obscured while the page or a rail menu covers its stage.
[App](../../src/ui/app.tsx) retains the underlying terminal DOM and makes covered stage
content inert, so opening the launcher neither resizes nor stops a terminal.

## Other surfaces in the column

- [`repository-rail.tsx`](../../src/ui/repository-rail.tsx) is the rail the tree replaced on
  Electron. It is still what `AgentRail` mounts on Tauri.
- Repository scans come from `git_repository` (Electron only) through
  [`repositories-store.ts`](../../src/repositories/repositories-store.ts): derived git facts
  are never persisted, only collapse state is, a scan failure degrades to a `plain` cluster,
  and a return to the window refreshes rather than invalidates so the sidebar does not jump.
  No `git status` is run anywhere.
