# Getting started

SpaceVibe Deck is a desktop terminal for running several AI agent CLIs side by side. Each
agent runs in its own terminal pane; Deck shows which one is working, which one is asking
for you, and what each one just said, and brings you back to the pane that needs you.

## Install

Download the current release from
[github.com/mxrsv/spacevibe-deck/releases/latest](https://github.com/mxrsv/spacevibe-deck/releases/latest).

- **macOS, Apple Silicon (arm64).** The `.dmg` is signed and notarized. Intel Macs are not
  served.
- **Windows, x64.** The `-setup.exe` installer is unsigned, so SmartScreen warns on first
  install. It installs per user, without elevation. Windows ARM is not served, and the
  Windows build has not been verified on real hardware.

Deck checks for updates on its own, tells you when one is ready, and lets you choose when to
download, install and relaunch. See [Settings → About](settings.md#about).

If you ran the older Tauri-based Deck: its update check fails, and the last published Tauri
release does not contain the migration notice. Download and install the current Electron
release by hand using the link above. Settings and workspaces do not migrate; it is a clean
install. Your Tauri data remains in `~/Library/Application Support/dev.spacevibe.deck` on
macOS or `%APPDATA%\dev.spacevibe.deck` on Windows. Electron uses a separate
`SpaceVibe Deck` data folder; see [where Deck keeps its data](settings.md#where-deck-keeps-its-data).

## First launch

Deck opens on the **Open board**, the start surface. It offers:

- **Open workspace…** — pick a folder. A workspace is a local folder that becomes the working
  root for a tab.
- **Recent workspaces** — selecting a folder fills the workspace and agent choices.
  Review the selected agent, then choose **Open agent** to launch it. A folder that has
  disappeared from disk cannot be opened.
- **Create worktree…** — for a git repository, create a new git worktree on a new branch and
  open it. Worktree and branch are one choice: Deck never offers a branch without its
  worktree.
- **Resume a previous session…** — the session history, listing Claude Code and Codex
  conversations Deck found in those tools' own local logs; a row opens a tab in that
  session's directory and types the CLI's exact resume command.

If "Restore sessions on launch" is on (the default), Deck instead reopens the tabs that were
open when it quit and resumes each agent conversation it can resolve. Scrollback, unsaved
file edits and window placement are not restored.

## Launch an agent

Press **⌘T** (Windows: **Ctrl+Shift+T**) for the active checkout, or use `+` / **New agent**
on a checkout card in the Agent Rail. The menu lists the agents Deck found on your `PATH`;
choose one to launch it in that checkout using the command shown in
[Settings → Agents](agents.md). **Open another project…** lets you choose another workspace.
Use **New split here** for a plain shell.

## The window

- **Agent Rail** (left column). One cluster per project, one row per agent pane. The row
  shows what the agent last said, or its name if it has said nothing yet. A dot marks state:
  red for failed, yellow for asking you, neutral for working. Clicking a row focuses that
  pane. Each row's ✕ closes the thing it names: an agent row closes that pane, a project
  header closes every tab of that repository. Drag a project header to reorder clusters.
- **Stage** (centre). The terminal panes of the active tab, split as you like. Above them, one
  strip of chips: terminal tabs, open documents and the browser tab share one shape and are
  ordered by when they were opened.
- **Side panel** (right, **⌘⇧J**). Three tabs: **File explorer** (**⌘⇧B**), **Token usage**
  (**⌘⇧U**) and **Session history** (**⌘⇧Y**).
- **Browser tab** (**⌘⇧I**). A page beside your terminals, opening on the home address from
  Settings → Browser.

Drag the seam between the rail and the stage to resize it; drag it past its floor to hide the
rail completely. The toggle beside the traffic lights brings it back.

## Panes and tabs

- Split with **⌘D** (side by side) or **⌘⇧D** (stacked). Move between panes with **⌘⌥ arrows**;
  swap two panes with **⌘⌥⇧ arrows**.
- **⌘E** expands the focused pane; **⌘⇧Enter** zooms it over the whole tab.
- **⌘W** closes the focused pane; **⌘⇧W** closes the whole tab. Deck asks first if a process
  other than an idle shell is running there.
- **⌘⇧T** reopens the last closed tab with fresh shells at the same directories.
- **⌘⇧M** moves the focused pane into its own window.
- **⌘1**–**⌘8** select a chip by position; **⌘9** the last one; **⌘⇧]** / **⌘⇧[** cycle.
- **⌘⇧A** jumps to the pane that most needs you.

## Files

Open the file explorer (**⌘⇧B**) to browse the workspace. A file opens as a document on the
stage: an editor with **⌘S** to save. Markdown opens rendered; **⌘⇧V** flips it to source.

**⌘+click** (Windows: **Ctrl+click**) on a path an agent prints opens it. A path inside a
workspace this window has open lands in Deck's own editor at that line; anything else goes to
the app chosen in [Settings → Links & editor](settings.md#links--editor). On Windows only
the in-Deck half works in this release.

## Usage and privacy

The Token usage tab reads Claude Code's and Codex's own local session logs and groups tokens
and estimated cost by agent and day. It needs no account.

Starting with 1.1.0, Deck sends cumulative usage snapshots for each day. Analytics are
always on, with no opt-out, beginning on the first launch after upgrading; 1.0.0 and the
older Tauri releases send no analytics. Each snapshot contains a fresh random id for that day,
Deck's version, platform and architecture, launch counts per built-in agent, how often the
browser, explorer and usage surfaces were opened, the day's highest tab and pane counts,
and whether sessions were restored. It never contains code, paths, prompts, file names,
repository names or a permanent identifier.
[Settings → Privacy](settings.md#privacy) states exactly what is sent and has no switch.
The full field list is
[`src/telemetry/payload.ts`](../../src/telemetry/payload.ts).
