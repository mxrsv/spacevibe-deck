# Glossary

The words Deck's code, tests and documents use, each with the terms to avoid. The UI
hierarchy is Window → Tab → Pane; documents and the browser are surfaces beside tabs.

## Window and stage

**Window** — One Deck OS window owning its own tabs, panes and surfaces. Panes move between
windows; each window's tabs are journaled for session restore. Not: tab, app, workspace.

**Workspace** — A local folder chosen on the Open board as a tab's working root. A tab
carries exactly one workspace, fixed for its life; a workspace may own any number of tabs.
Recents live in `workspaces.json` with the layout and agent each was last opened with, and
the session journal records every open tab's workspace so it comes back at launch. A pane's
live cwd is not the workspace: `cd` never changes it. Not: window, session, folder.

**Stage** — The centre column. Exactly one of the terminal grid, a document or the browser
owns it at a time. Not: pane, tab.

**Surface** — A document or the browser tab: something on the stage that is not a terminal
tab. Surfaces sit beside `TabManager` behind the `SurfaceStrip` seam, are addressed by index,
and share the strip with tabs. Not: overlay, panel.

**Surface strip** — The one row of chips on the stage's frame row: terminal tabs, open
documents and the browser tab share one chip shape, differ only by glyph, and are ordered by
when they were opened. ⌘1–9 and tab cycling count chips. Not: tab bar, dock, toolbar.

**Dock** (side panel) — The docked right column with three tabs: file explorer, token usage,
session history. It displaces the terminal grid rather than covering it. Not: sidebar, rail.

**Agent Rail** — The left column: one cluster per project, one row per agent pane, each
showing the agent's newest sentence or its name, and a dot for failed, asked or working.
Every row keeps full legibility. Clicking a row focuses the pane; each row's ✕ closes what
the row names. Not: repository rail, attention rail, task list, sidebar.

## Tabs, panes, layout

**Tab** — A container holding one or more panes as a split layout tree, plus its chrome
(name, dot colour) and its workspace. Closing a tab disposes every pane inside it.
Not: window, session.

**Pane** — One visible terminal region backed by exactly one PTY. Every tab has at least one;
splitting adds more. Not: split, cell, terminal window.

**Focused pane** — The pane receiving keyboard input in a tab; one per tab. The rail marks the
focused pane of the active tab. Not: active pane, selected pane.

**Layout** — The split tree of a tab: nested row/column splits with ratios. Preserved across
a closed-tab reopen; pane ids and PTYs are recreated. The layout engine maps it to the DOM.
Not: grid, arrangement.

**Layout preset** — A named, persisted split tree with optional per-pane cwds, created from
the live layout (⌘⇧N) or overwritten (⌘⇧S). A preset can no longer be renamed or deleted in
the app. Not: session, workspace, launch profile, theme.

**Closed tab snapshot** — An in-memory record taken when a tab closes: layout, cwds, name,
colour. ⌘⇧T reopens with fresh shells at the saved cwds; at most 10, not persisted.
Not: undo, session backup, history.

**Swap pane** — Exchange two panes' positions; each pane's PTY moves with it. Not: drag-dock.

**Move to window** — Detach a pane into another or a new OS window, through the coordinator's
transfer protocol. Does not prompt when busy. Not: close pane, swap.

**Buffer** — A pane's scrollback above the current prompt. Clear Buffer (⌘K) drops it with no
undo; the action is `destructive`. Not: screen, viewport.

**Search** — Incremental, case-insensitive find in one pane's scrollback (⌘F). One search bar
across the app; the last term is app-wide so find-next works after the bar closed.
Not: filter, grep.

**CWD** — A pane's shell working directory as the PTY reports it. New panes inherit the
focused pane's cwd; missing paths fall back to `$HOME`. Not: directory, folder.

## Processes and agents

**Agent** — An AI-agent CLI. For chrome, recognised by foreground process name; for launch,
a binary discovered on the login shell's `PATH` or a command the user declared.
Not: process, bot.

**Built-in agent** — One of the six Deck ships: `claude`, `codex`, `opencode`, `agy`,
`gemini`, `cursor-agent`. Its id, binary name and bare command are the same string.

**Custom agent** — A user-declared name plus a full command line, id `custom:<slug>`, matched
to processes by its label. Not: preset, launch profile.

**Launch profile** (preset, in the UI) — A command line the user wrote for an agent, stored as
a string and typed verbatim; the agent is derived from its first word. Not: layout preset.

**Agent launch** — Typing `<command>\r` into a new pane's interactive shell once it is ready,
rather than spawning the agent from main, so the shell's real `PATH` applies. Each pane is
typed into exactly once. Not: spawn, agent picker.

**Materialize** — Turning a `MaterializeIntent` (layout, cwds, agent or per-pane commands,
chrome, workspace) into a live tab with fresh shells. One seam behind the Open board, the
quick picker, reopen, presets, rail drop and session restore. Not: restore, open.

**Quick picker** (AgentQuickPicker) — The ⌘T modal: a destination row naming the worktree,
then agents as rows picked by click or digit. Spawns one pane in the active tab's live cwd.
Not: Open board.

**Busy** — A pane whose foreground process was classified as something other than an idle
shell (an agent, `vim`, any known non-shell process). The close and quit census asks about
busy panes. A pane whose process could not be classified is `unknown`, which is neither busy
nor idle, so the census refuses rather than guesses.
Not: running, working.

**Agent phase** — The live per-pane work signal: `unknown`, `idle`, `working`, `exited`, from
OSC 9;4 progress or the sustained-output heuristic, only after the pane's process is
classified as an agent. Not: busy, attention.

**Attention** — The latched, actionable per-pane state: `none`, `completed`, `requested`,
`warning`, `error`. Explicit signals outrank the heuristic, which produces only `completed`.
Never downgraded until acknowledged; the UI reads it before phase. Not: notification, unread.

**Acknowledge** — Focusing a pane, which clears its attention and unread. Never clears phase.
Not: selectTab, dismiss.

**Unread** — Per pane, whether output has been seen since it last changed; cleared only on
real DOM focus while the window is foreground. Distinct from the tab-level unread flag.

**Rail state** — What the rail draws from attention and phase: `failed`, `asked`, `working`,
`done`, `idle`. `done` means the pane has run something and is quiet; `idle` means it never
ran. Not: attention kind.

**Turn** (session tail) — The agent's newest assistant sentence, read off its own session
log by `session_tail` and shown on the rail row and the strip chip. Only Claude Code, Codex
and OpenCode produce one. Not: title, status.

**Census** — Main's answer to "what would this close or quit kill": busy process names, busy
pane count, and every unsaved document. A reading that fails is refused, never treated as
empty. Not: busy check.

## Files and browser

**File explorer** — The dock's tree of the workspace root. A click opens a preview tab, a
double-click a kept tab; the document renders on the stage. Electron only.
Not: editor, file sidebar.

**Preview tab** — A workspace's one italic file tab, replaced in place by the next single
click; promoted to a kept tab by a double-click or the first edit. Not: temporary file.

**Rendered view** — A markdown document shown as a read-only picture of its live buffer;
⌘⇧V flips it to source. Not: preview.

**Browser tab** — A chip on the strip whose surface is a native `WebContentsView`, hidden
whenever DOM chrome paints over the stage. Electron only. Not: panel, webview.

**Grab** — A snippet react-grab copied from the browser page. It stops at the clipboard today;
the paste path never submits. Not: paste, prompt.

## Sessions

**Session journal** — `session.json`, continuously written from every window's live tabs,
debounced one second, plus a per-workspace archive. Not: closed tab snapshot.

**Session restore** — At launch, reopening the journaled tabs and typing each built-in
pane's exact resume command, behind a crash-loop marker and a liveness pass.
`Settings.restoreSessions` is the kill switch. Not: closed tab snapshot, history.

**Session history** — The dock's third tab and the board's "Resume a previous session…":
Claude Code and Codex conversations found on disk, each resumable into a new tab.
Not: session restore.

**Remembered cluster** — A rail header for a workspace with nothing open, kept from the
workspace history so its `+` can launch into it. Not: archived session.

## Chrome

**Open board** — The start surface: recent workspaces, Open workspace…, Create worktree…,
Resume a previous session…. One click opens a workspace with its last combo; choosing an
agent per open is the quick picker's job. Not: settings, quick picker.

**Worktree** — A git worktree: a separate directory checked out on exactly one branch. Deck
never offers a branch without its worktree. Not: branch, clone.

**Modal** — The one dialog shell (scrim, frame, focus-on-mount, Escape at the document, scrim
press-and-release) that the quick picker, save-preset dialog, preset editor and consent
dialog mount into. Not: popup, overlay, full-window screen.

**Overlay guard** — The rank order `pane` < `settings` < `board` < `modal` that decides which
actions may run while something covers the stage. Not: z-index.

**Performable** — Whether a matched chord may consume its keystroke where the user is; a
declined chord reaches whatever holds focus. Not: enabled.

**Prompt Board** — The ⌘⇧P popover that pastes a saved template into the pane captured when it
opened, optionally with Claude Code or Codex skills and subagents referenced, and submits
only behind a triple gate. Not: quick launch, composer.

**Theme mode** — Light or Dark, the whole of Appearance's theme choice. The theme gallery,
colour overrides and file import still build and resolve stored ids but mount nowhere.
Not: theme gallery.

**Quit** — Exiting Deck: ⌘Q, or the last window closing on Windows. Closing the last tab does
not quit and does not close the window; it raises the Open board. Not: close tab.
