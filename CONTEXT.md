# Stackgrid

A minimal macOS terminal for AI agent CLIs. The UI hierarchy is Window → Tab → Pane.

## Language

**Window**:
A single Stackgrid OS window owning its own tabs and panes. Multi-window is in v1 scope: panes can move between windows; each window’s layout chrome participates in session restore.
_Avoid_: Tab, app, workspace (folder)

**Workspace**:
A local folder the user picks as the working root on the Open board (recent folders + Open Folder, Cursor-style). Supplies the default CWD when a layout preset pane has no CWD set. A tab carries exactly one workspace, fixed for the tab's life and held in memory for it (not persisted; the folder is remembered in `workspaces.json` recents and reopened by hand from the board) — but a workspace may own any number of tabs: opening one that already has a tab spawns another, so a repo can run several agent sessions side by side. A pane's live CWD is not the workspace: `cd` inside a terminal never changes it. Not an OS window.
_Avoid_: Window, session, folder-of-the-moment

**Pane**:
A single visible terminal region backed by exactly one PTY. Every tab has at least one pane; splitting adds more panes — it does not change what a pane is.
_Avoid_: Split, cell, terminal window

**Tab**:
A container holding one or more panes as a split layout tree, plus that tab's chrome (name, dot color) and the Workspace it belongs to. Closing a tab disposes every pane inside it.
_Avoid_: Window, session

**Focused pane**:
The pane that currently receives keyboard input and shortcut actions within a tab. One focused pane per tab at a time.
_Avoid_: Active pane, selected pane, cursor pane

**Layout**:
The split-tree structure of panes within a tab: nested row/column splits, each with a size ratio. Preserved across closed-tab reopen (Cmd+Shift+T); only pane IDs and PTY sessions are recreated fresh. On screen, a LayoutEngine maps the structural tree to the flex DOM (Focus Expand overlay, zoom, dividers) without changing what a Layout is.
_Avoid_: Grid, arrangement, split count

**Busy**:
A pane whose foreground process is something other than an idle shell (e.g. `claude`, `vim`). A pane at an idle shell prompt or in session-ended limbo (no foreground process) is not busy.
_Avoid_: Running, active, has output

**Agent phase**:
The per-pane runtime work signal for the Attention Rail: `unknown` (no signal yet), `idle` (recognized agent, not working), `working` (recognized agent producing output/progress), or `exited` (PTY gone). Explicit OSC 9;4/notification/bell signals and the sustained-output heuristic both feed phase, but only after the pane's foreground process is confirmed to be an agent. Distinct from **Busy**: Busy is the foreground-process guard for the close flow and covers any non-idle-shell process (e.g. `vim`), not just agents; a pane can be Busy without ever leaving `unknown` phase. Acknowledging a pane never changes its phase.
_Avoid_: Busy, running, active

**Attention**:
The latched, actionable per-pane state — `none`, `completed`, `requested`, `warning`, or `error` — layered on top of **Agent phase** as a separate axis; a pane can be `working` while still carrying a latched `warning`. Explicit signals (OSC 9;4 severity, OSC 9/777 notification, terminal bell) always outrank the sustained-output heuristic, which may only ever produce `completed`, never `warning`/`error`/`requested`. Drives the status mark precedence and `Cmd+Shift+A` navigation across panes.
_Avoid_: Busy, notification, unread

**Unread** (per-pane):
Whether a pane's output has been seen since it last changed, tracked independently per pane and cleared only when that specific pane gets real DOM focus while the window is foreground. Distinct from the legacy tab-level unread flag on `TabView`, which is unchanged: it still marks "this background tab has new output" and is cleared by public `selectTab()` regardless of which pane inside the tab gets focus.
_Avoid_: TabView unread, tab unread

**Acknowledge**:
Focusing a pane, which clears that pane's own **Attention** and per-pane **Unread**. Never clears **Agent phase** — a pane still `working` keeps showing working after being acknowledged. Distinct from opening/selecting a tab, which only clears the tab's legacy unread flag and does not by itself acknowledge any individual pane's attention.
_Avoid_: selectTab, tab focus, dismiss

**CWD**:
The current working directory of a pane's shell, as reported by the PTY. New panes and new tabs inherit the focused pane's CWD at spawn time; missing or invalid paths fall back to `$HOME`.
_Avoid_: Directory, path, folder

**Buffer**:
The scrollback history above the current prompt line in a pane. Clearing the buffer (Cmd+K) drops scrollback but keeps the current prompt line; the action is destructive with no undo.
_Avoid_: Screen, viewport, terminal output

**Materialize**:
Turning a Layout (plus optional per-pane CWDs) into a live Tab with fresh shells. Used by Open board confirm, Closed tab reopen, and Layout preset create. CWD policy is explicit: fresh, polled, none, or caller-given. On Open board confirm the chosen agent is typed into every new pane's shell once it is ready (see **Agent launch**).
_Avoid_: Restore, open, spawn (alone)

**Closed tab snapshot**:
An in-memory record captured when a tab closes: split layout, per-pane CWDs, tab name, and dot color. Reopening (Cmd+Shift+T) restores layout and spawns fresh shells at saved CWDs; scrollback and running processes are not restored. Max 10 entries, not persisted across restarts.
_Avoid_: Undo, session backup, history

**Session restore** (removed in 0.4.0):
Stackgrid no longer persists or restores tabs across launches. Quitting drops every tab and pane; the app always opens on the Open board, and the user reopens folders by hand from Recents (`workspaces.json`). `session.json`, `session-schema`, and `session-persistence` are gone. Only settings, layout presets, workspace recents, and the app logo persist across restarts; the closed-tab stack (Cmd+Shift+T) lives in memory for the session only.
_Avoid_: Closed tab snapshot, workspace, profile, layout preset

**Layout preset**:
A named, persisted template: split-tree layout plus optional per-pane CWDs. Edited via a mini layout mock (confirm → new tab) or saved from a live layout. Supports rename, delete, overwrite.
_Avoid_: Session, workspace, theme preset

**Open board**:
The sole entry point of the app (also shown for New Tab): two columns in the stage — a 300px rail (app logo + recent workspaces, each row removable by its × or Backspace, missing folders grouped last with a remove-all, Open Folder pinned at the bottom) and a detail column (workspace name + path, layout preset grid with hover rename/delete, agent CLI chips, footer). A recent row remembers its last layout + agent combo and preselects them; removing a recent rewrites `workspaces.json`. The app logo is set from Settings only — the drag-drop logo panel is gone. Confirm Open materializes the layout and launches the chosen agent on every pane.
_Avoid_: Settings, session restore

**Agent**:
An AI-agent CLI. For chrome: recognized by foreground process name (e.g. `claude`, `codex`, `gemini`) for pane-header styling. For launch: binaries discovered on the login shell's `PATH` and chosen on the board. Other processes are not agents.
_Avoid_: Process, CLI, bot

**Agent launch**:
Running the board's chosen agent in every new pane by typing `<agent>\r` into the pane's interactive shell once it prints its first byte (or after a 3s fallback), not by spawning it from Rust — the interactive shell inherits the correct `$PATH` that `$SHELL -lc` would strip. `Shell only` types nothing. Each pane is typed into exactly once; a failed write leaves the pane as a plain shell. Closed-tab reopen does not re-launch the agent.
_Avoid_: Spawn, agent picker

**Swap pane**:
Exchange the positions of two panes in a layout; each pane’s PTY/session moves with it. Distinct from drag-dock rearrange.
_Avoid_: Drag-dock, split, move to window

**Move to window**:
Detach a pane into another OS window (including a new window) or join it into a tab in another window. Bidirectional. Does not prompt when busy.
_Avoid_: Close pane, swap pane

**File sidebar**:
Right-hand read-only viewer opened by Cmd+click on a filepath in CLI output. Shows content preview (Markdown for `.md`) and git diff when available. Relative paths resolve against the source pane’s CWD; missing paths do not open the sidebar.
_Avoid_: Editor, embed agent UI

**Close pane**:
The action of closing the focused pane (Cmd+W). When the tab has only one pane, routes to close tab instead of respawning a shell.
_Avoid_: Close window, kill process

**Close tab**:
The action of closing an entire tab and all its panes (Cmd+Shift+W, or Cmd+W when the tab has a single pane). Prompts only when any pane is busy. Closing the last tab of a window closes that window; closing the last tab of the last window quits the app — no extra confirmation beyond the busy guard.
_Avoid_: Close window

**Quit**:
Exiting the Stackgrid application entirely. Triggered by Cmd+Q, closing the last window, or closing the last tab of the last window.
_Avoid_: Close tab, close pane

**Search**:
Incremental, case-insensitive find in the focused pane's scrollback (Cmd+F). Scoped to one pane at a time; only one search bar may be open across the app.
_Avoid_: Filter, grep, global search
