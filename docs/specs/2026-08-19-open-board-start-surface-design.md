# Open Board start surface — design

Date: 2026-08-19  
Status: `approved` (owner approved the direction in conversation on 2026-08-19)  
Target: shared renderer, both hosts; session history remains Electron-only

## 1. Signature concept

One surface starts work, one rail shows live work, and one dock holds history and
tools.

Open Board is a **start surface**, not a dashboard. It may open automatically
when Deck has no live tabs, or explicitly from the rail's `New` action. It must
never compete with the live rail or the Sessions dock by repeating their
information inline.

## 2. Surface ownership

### 2.1 Left rail: live work only

The Agent Rail answers "what is running now?" It contains live tabs, agent
turns, and agent state. Archived workspace rows leave the rail; history and
resume belong to the Sessions surface.

When there are no live tabs, Deck suppresses the rail without changing the
user's persisted sidebar preference. Once a tab materializes, the rail returns
at the user's stored width and collapsed state.

When Open Board is opened while live tabs exist, the rail remains available as
the escape route back to running work. Selecting a rail row closes Open Board,
as it does today.

### 2.2 Center stage: start or resume work

The Open Board home view contains:

- the Deck mark and the heading `Start a workspace`;
- one primary action, `Open workspace…`, with its platform shortcut;
- one secondary action, `Create worktree`, when supported;
- one tertiary action, `Resume a previous session…`, when session history is
  supported;
- recent workspace rows, capped by the existing persisted-recents limit.

Session rows do not appear below workspace rows. The tertiary resume action
opens a dedicated Sessions view inside Open Board, with a Back action and the
existing session filters/list. The docked Sessions surface is not mounted at
the same time, avoiding duplicate ids and two histories competing on screen.

### 2.3 Right dock: tools and history

The right dock retains Explorer, Usage, and Sessions. While Open Board is open,
the dock is visually suppressed without changing `dockOpen` or `dockTab`; it
returns after Open Board closes.

## 3. State rules

### 3.1 Cold start

If session restore produces no live tab, Open Board opens automatically. The
live rail and dock are suppressed. Open Board cannot be dismissed into a blank
stage; the user must open a workspace, create a worktree, or resume a session.

### 3.2 Start another workspace

If live tabs exist and the user invokes `New`, Open Board covers the stage but
leaves the live rail visible. Escape closes Open Board and returns focus to the
active pane.

A recent workspace that already has a live tab remains selectable because Deck
supports several sessions in one repository. It is visibly marked `Open`, and
its accessible action says `Start another session` rather than implying that it
will focus the existing tab.

### 3.3 Successful open or resume

Successful workspace open and successful session resume close Open Board. A
failed action leaves the board visible and announces an actionable error.

## 4. Workspace-row information

Every recent row exposes the consequence of its one-click action without a
hover-only tooltip:

- workspace name;
- abbreviated path;
- remembered preset and agent, when present;
- relative last-opened time;
- `Open` state when the same workspace currently has a live tab.

The whole primary row action is a real keyboard-operable control. The remove
action remains a separate control, so the DOM must not nest one button inside
another.

Missing workspaces are collapsed behind a count by default. Expanding reveals
the existing missing rows and removal controls. Missing rows do not silently
spawn in `$HOME`; they remain blocked with the existing notice.

## 5. Interaction and feedback

- Opening a workspace exposes a visible pending state and disables competing
  open actions until the attempt resolves.
- Folder-picker failure is announced on Open Board, not only written to the
  console.
- Escape moves from the Worktree or Sessions subview back to Home before it may
  close Open Board.
- Focus returns to the Open Board container after returning from a subview.
- Workspace rows support Tab plus Enter/Space; focus styling is visible.
- Existing host capability gates continue to omit unsupported Worktree and
  Sessions actions instead of rendering disabled promises.

## 6. Visual treatment

The approved composition is calm and task-first:

- the Deck mark is identity, not the dominant artifact;
- `Start a workspace` is the first read;
- `Open workspace…` is the only primary action;
- Worktree and Resume recede to secondary/tertiary treatment;
- workspace metadata is visibly subordinate but never hover-only;
- the current `--bg`, chrome ladder, typography tokens, icon system, radii, and
  motion timing remain authoritative; no new dependency or raw visual token is
  introduced.

Two gallery specimens are required before visual acceptance:

1. cold start, with no live rail;
2. Open Board invoked while live agents remain in the rail.

Automated checks can establish behavior and structure, not visual acceptance.

## 7. Explicitly out of scope

- The prompt composer concept (`type a task → launch an agent → send the
  prompt`) remains separate and unimplemented.
- Agent or preset selection does not return to Open Board; `AgentQuickPicker`
  remains the per-open choice surface.
- Session parsing and cleanup of titles such as `<local-command-caveat>` are a
  separate data-quality fix.
- PTY ownership, process classification, session scanning, tab materialization,
  and persisted sidebar/dock preferences do not change.
- No Tauri implementation of session history is added.

## 8. Done criteria

- Cold start paints Open Board without an empty Agent Rail or dock.
- Invoking `New` with live work preserves the Agent Rail and suppresses the
  dock.
- Agent Rail renders no archived workspace rows.
- Open Board renders recent workspaces but no inline recent sessions.
- `Resume a previous session…` opens the dedicated Sessions subview and a
  successful resume closes Open Board.
- Remembered preset/agent and already-open state are visible and accessible on
  each workspace row.
- Pending, failure, keyboard, missing-workspace, and capability states have
  targeted tests.
- The two gallery specimens exist; native eye approval remains required before
  the visual change is called complete.

