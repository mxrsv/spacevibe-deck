# Launch actions: one launcher and one create row

Date: 2026-10-08
Status: Active — every decision taken 2026-10-08 (1–9 from the mock, 10–13 as recommended);
slice 1's plan is drafted and awaits approval ([Delivery slices](#delivery-slices)).
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: written against `origin/main` at `ae395a9e` (2026-10-08), after the navigation rail's
slice 3c moved `+ New` onto the identity row.
Host: Electron. Tauri is feature-frozen and keeps today's rail and Open board (see
[Forks and constraints](#forks-and-constraints)).
Parent: [Deck product improvements](2026-10-06-deck-product-improvements.md), rank 3 (clear
launch context and placement, LAUNCH1–3). This record owns the requirements of the
launch-actions slice. It amends RAIL4 of the
[navigation rail refresh](2026-10-06-navigation-rail-refresh.md).

## Purpose

Give each create verb — add an agent, create a worktree, open a folder — one control, in one
place, that always does the same thing. Today the three verbs are spread over four surfaces
and nine controls whose labels and destinations depend on host and state:

- The small `+ New` on the sidebar identity row (accessible name `New Workspace`, DL-27.14
  amended 2026-10-07) opens the Open board, while dragging the same button docks an agent
  pane ([`SidebarNewButton`](../../src/ui/sidebar-toggle.tsx)).
- ⌘T (`new-tab`, labelled `New Agent…`) opens the launch page, the Open board when no
  workspace is active, or a free-standing actions menu on Tauri
  ([`openTaskLauncher`](../../src/ui/app.tsx)).
- One verb has three labels that all reach the Open board: `Open workspace`,
  `Open another project…` and `Open folder…`.
- Create worktree lives only in the Open board's form. Two older routes remain in code:
  the `launcher-fields` option and the deliberately unwired `Create branch from here` row in
  [`worktree-card-menus.tsx`](../../src/ui/worktree-card-menus.tsx).
- The legacy Quick Launch popover mounts only in the gallery, yet its `quickLaunchOpen`
  state is still read by app policy and the tab manager's fallback
  ([`launcher-store.ts`](../../src/launcher/launcher-store.ts)).

## Decisions (owner, 2026-10-08)

The owner chose these from the HTML mock (see [Evidence](#evidence)). Each entry names the
alternatives the owner turned down.

1. **One launcher (Q1).** Every add-agent control opens the launch page on a checkout. The
   page's own dropdowns change the workspace and checkout, open a folder and create a
   worktree. Turned down: today's split between the launch page and the Open board.
2. **No tab open → the launcher (Q2).** A window with no tab shows the launch page with no
   workspace selected and recent workspaces below it. The Open board is retired from that
   role on Electron. Turned down: keeping the Open board as the start screen (the agent's
   recommendation); the owner preferred one screen fewer.
3. **One create row in the sidebar (Q6).** Three buttons sit side by side under the rail's
   top row: `Agent · Worktree · Folder`. Project and checkout rows carry no create control,
   which withdraws RAIL4's per-checkout `+`. Turned down:
   - one `New` button plus a `+` per checkout, both into the page (the mock's starting
     point);
   - a `New ▾` menu (it gives worktree and folder two routes);
   - each tier creating its child (its controls appear only on hover).
4. **Agent keeps the drag (Q3).** Dragging `Agent` onto a pane docks an agent there, the verb
   DL-27.14 gives `New Workspace` today. Turned down: click only.
5. **The command preview is monospace (P1).** It shows the exact command the shell will run.
   This requires a DL-4.1 exception. Turned down: the UI font.
6. **The profile chip opens a popover (P2).** It lists each agent's launch profiles. A pick
   applies to launches from that page visit only (DL-32.6's no-state rule). Turned down: a
   chip that only links to Settings.
7. **Failure feedback stops at what Deck knows before the pane exists (P3).** Turned down:
   showing the exit code, which needs the PTY watched after spawn — a fork.
8. **The page drops its eyebrow and heading, the `Add agent` card and editor, and the
   footer with its gear (P4).** Adding a custom agent stays in Settings → Agents.
9. **Kept:** a card press means Split and ⊕ means New space (2026-10-03, option D).

The owner took the agent's recommendation on the four questions the mock could not draw
(2026-10-08, "follow your rec"):

10. **Retire the legacy pieces (Q4).** These go:
    - the Quick Launch popover (`QuickLaunch`);
    - its `quickLaunchOpen` state and DL-32.4;
    - the `Create worktree…` option in `launcher-fields`;
    - the unwired `Create branch from here` row.

    Nothing in the app reaches them. Turned down: keeping them as dormant code.
11. **Work happens in a worktree (Q5)**, at `../../spacevibe-deck-worktrees/launch-actions`,
    because the primary checkout carries another session's uncommitted rail changes. Plans
    stay in the primary checkout's `docs/plans/`.
12. **The Open board's own features get new homes (EMPTY2):**
    - the last-session offer, folder drop and recent removal move onto the no-tab launch
      page;
    - Resume stays in the Sessions tool (TOOLS1);
    - the staged-prompt composer stays behind its flag on the Open board, which remains in
      code for Tauri.

    Turned down: dropping any of them.
13. **The collapsed rail shows the three verbs as stacked icons** above the avatar column,
    with tooltips. Turned down: one `+` into the page; hiding them while collapsed.

## Requirements and acceptance criteria

IDs map to the parent's LAUNCH1–2 where noted. LAUNCH3 (prompt delivery) is out of scope.

### Sidebar create row

- **ROW-C1**: The expanded rail shows `Agent`, `Worktree` and `Folder` side by side, below
  the top row and outside the scrolling list. The row is always visible, with no hover to
  reveal it. The tooltips name the target: `Agent` names the focused project and branch, and
  `Worktree` names the focused project.
- **ROW-C2**: Project headers and checkout rows offer no create control (RAIL4's `+` goes).
  Row selection, close and the context actions that exist today are unchanged.
- **ROW-C3** (LAUNCH1): `Agent`, ⌘T (`new-tab`) and the Agent Board's `New agent` all open
  the launch page on the checkout of the focused pane, or on the active workspace when no
  pane is focused. None of them opens the Open board. A second ⌘T while the page is up
  closes it, as today. With no workspace at all, EMPTY1 applies; until slice 4 ships, that
  case keeps today's Open board.
- **ROW-C4**: Dragging `Agent` onto a visible pane docks that workspace's last-used agent at
  the nearest edge, with today's threshold, ghost and overlay
  ([`new-pane-drag.ts`](../../src/ui/new-pane-drag.ts)). The drag goes inert when no pane is
  visible.
- **ROW-C5** (LAUNCH2): `Worktree` opens a form inside the sidebar with a repository choice
  (the focused project by default), a branch name and the existing destination and
  validation rules. Create adds the checkout to the rail and starts nothing; the success
  message says so. Cancel and Esc close the form without creating anything.
- **ROW-C6**: `Folder` opens the native folder dialog. A chosen folder joins the rail as a
  project and starts nothing. Cancel leaves everything unchanged, and a failure is shown.

### Launch page

- **PAGE1** (LAUNCH1): A context row without field labels shows three things:
  - a workspace dropdown, with `Open folder…` first, a separator, then known workspaces;
  - a checkout dropdown, with the selected repository's checkouts, a separator, then
    `New worktree…`. The dropdown is omitted for a folder git does not know (DL-19.7);
  - a placement chip that reads `Split beside <agent>` only when the focused pane belongs
    to the selected checkout, and `New space` otherwise. The launch does what the chip says
    (RAIL4's placement rule, kept).
- **PAGE2** (LAUNCH2): `Open folder…` and `New worktree…` behave like ROW-C6 and ROW-C5.
  Each selects the result as the page's context and never starts a process.
- **PAGE3** (LAUNCH1): Hovering or focusing a card shows the exact command in monospace,
  with the chosen profile applied, followed by the folder and the placement. With nothing
  hovered, the line says how to see the command. An agent that is not installed is dimmed,
  reads `Not installed` and has no press.
- **PAGE4**: The profile chip opens a popover listing each agent's launch commands, with the
  default marked, plus a row to edit profiles in Settings. A pick changes the preview and the
  next launch from this visit. Leaving the page forgets it.
- **PAGE5** (LAUNCH2): A launch that fails before its pane exists shows that failure's
  message on the page, with Retry repeating the same agent and placement. No exit code is
  shown.
- **PAGE6**: The page has no eyebrow or heading, no `Add agent` card or editor, and no
  footer or gear. The empty-agents state still offers its route to Settings.
- **PAGE7**: Card = Split, ⊕ = New space, Back/Esc and focus return behave as DL-32.6
  states today.

### No tab open

- **EMPTY1**: With no tab open, the stage shows the launch page with no workspace selected
  and recent workspaces listed below the cards. Cards stay disabled until a workspace is
  chosen. Choosing a recent row or `Open folder…` sets the context and never launches. There
  is no Back control, because there is nothing to return to.
- **EMPTY2** (decision 12): Before the Open board stops appearing on Electron, the no-tab
  launch page carries three things from it:
  - the last-session offer, with Reopen and Dismiss;
  - folder drop, with the same validation (one existing folder, never a launch);
  - recent-workspace removal.

  Resume a past session is reached through the Sessions tool. The Open board stays in code
  for Tauri and for the flag-gated staged-prompt composer.

### Collapsed rail and retirement

- **ROW-C7** (decision 13): In the collapsed avatar column, `Agent`, `Worktree` and `Folder`
  are three stacked icon buttons above the avatars, with the same targets and tooltips as
  ROW-C1. `Agent` keeps its drag.
- **RETIRE1** (decision 10): The `QuickLaunch` popover, `quickLaunchOpen` and its readers,
  the `launcher-fields` `Create worktree…` option and the `Create branch from here` row are
  deleted with their tests and gallery specimens. DL-32.4 is withdrawn. No user-visible
  behaviour changes.

## Delivery slices

The slices run in order, one plan and one session each. The first row not `Done` is the next
work. Its plan carries an Operating contract: once the owner approves that plan, the contract
is the agent's authorization. A session that finishes a slice sets its row to `Done` with the
date and commits, then drafts the next slice's plan for approval. It does not start that
slice's code in the same session.

| Slice | Requirements | Plan | Status |
| --- | --- | --- | --- |
| 1. Sidebar create row and entry routing | ROW-C1–C7 | [launch-create-row](../plans/2026-10-08-launch-create-row.md) | Plan drafted 2026-10-08, awaiting approval |
| 2. Launch page context row | PAGE1, PAGE2, PAGE7 | — | Not started |
| 3. Launch page details | PAGE3–PAGE6 | — | Not started |
| 4. No tab open → launcher | EMPTY1, EMPTY2 (R4 seam) | — | Not started |
| 5. Retire the legacy pieces | RETIRE1 | — | Not started |

## Open decisions

None. Questions 1–4 were answered on 2026-10-08 as decisions 10–13.

## Forks and constraints

- **Design-language rules touched**, each a fork under [AGENTS.md](../../AGENTS.md):
  - DL-27.14 (`New Workspace` becomes the create row);
  - DL-27.26 as amended 2026-10-07 (the per-checkout `+` goes);
  - DL-32.1 (the Open board loses its no-tab role on Electron);
  - DL-32.4 (withdrawn by decision 10);
  - DL-32.6 (the page composition: context row, no heading, no `Add agent`);
  - DL-4.1 (the monospace exception for the command preview).

  The owner chose the direction on 2026-10-08. Each plan carries the rule text for approval.
- **Reversals of earlier owner decisions:**
  - RAIL4's per-checkout launch (navigation rail refresh, slice 3, shipped 2026-10-07);
  - DL-32.6's `Add agent` card (2.4.0).
- **EMPTY1 crosses a load-bearing seam (R4).** It needs a launch target before a workspace
  exists, and today `captureAgentLaunchTarget` requires one. That slice needs its own plan
  and cross-boundary verification.
- **Tauri** (feature-frozen) keeps
  [`RepositoryRail`](../../src/ui/repository-rail.tsx), its `New Workspace` and the Open
  board. The launch page is unavailable there (`agentLaunchPageAvailable`), so nothing in
  this spec reaches it.
- **Worktree creation is Electron-only** ([`worktree-host`](../../src/host/worktree-host.ts)).
  The plan confirms whether ROW-C5 and PAGE2 need any IPC payload change (R6) before any
  code is written.
- **Not touched:** PTY ownership, process classification, close/quit coordination and the
  updater. Showing an exit code (decision 7) stays out because it would touch PTY ownership.

## Evidence

- **HTML mock** (not committed): `docs/plans/2026-10-06-navigation-rail-mock/index.html` in
  the primary checkout (gitignored). In tab 3 `Launch`, the chosen options are
  `Q1 One launcher`, `Q2 Launcher`, `Q3 Click + drag`, `Q6 One row of three`, `P1 Mono`,
  `P2 Popover`, `P3 Before start` and `P4 Removed`. Q1, Q3 and Q6 also show in tab 1. The
  mock is a static specimen: it proves no runtime behaviour or data source.
- **The inventory in [Purpose](#purpose)** comes from a read-only pass over `main` at the
  baseline: [`app.tsx`](../../src/ui/app.tsx),
  [`agent-launch-page.tsx`](../../src/launcher/agent-launch-page.tsx),
  [`open-board.tsx`](../../src/open-board/open-board.tsx),
  [`worktree-card.tsx`](../../src/ui/worktree-card.tsx) and
  [`action-registry.ts`](../../src/terminal/action-registry.ts).

## Out of scope

Out of scope:

- prompt-at-launch (LAUNCH3);
- exit-code feedback;
- the session journal's format;
- unified search;
- the Changes view;
- any new execution capability.
