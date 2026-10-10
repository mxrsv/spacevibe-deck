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

When Deck quit with tabs open, the board shows **Last session** at the top. **Reopen** brings
back those tabs and resumes each agent conversation it can resolve; dismiss it, or open
anything else, and Deck starts clean. Scrollback, unsaved file edits and window placement are
not restored.

## Launch an agent

Press **⌘T** (Windows: **Ctrl+Shift+T**) for the active checkout, or **Agent** above the
Agent Rail (to start one in a checkout that has nothing open, press its name). If you are working in that checkout, the new agent opens
beside your current pane; otherwise it opens in a new space there, and the launcher says which
before you press Run. Right-click a checkout for the menu, which lists your
[quick agents](agents.md#quick-agents); choose one to launch it in that checkout
using the command shown in [Settings → Agents](agents.md#settings--agents). **Open shell**
opens a plain shell in a new tab, and **New split here** opens one beside the current tab.
The ⌘T menu also offers **Open another project…** to choose another workspace
([checkout actions](../../src/ui/worktree-card-menus.tsx)).

## The window

- **Agent Rail** (left column). One cluster per project, one row per agent pane. The row
  shows what the agent last said, or its name if it has said nothing yet. A dot on the agent's
  logo marks state: red for failed, yellow for asking you, grey once a run is done; a working
  agent shows a small spinning dot pattern instead. Only the agents that need you keep their logo in full
  colour, so those rows stand out as you scan the column. Clicking a row focuses that
  pane. Each row's ✕ closes the thing it names: an agent row closes that pane, a project
  header closes every tab of that repository. Drag a project header to reorder clusters.
- **Stage** (centre). The terminal panes of the active tab, split as you like. Above them, one
  strip of chips: terminal tabs, open documents and the browser tab share one shape and are
  ordered by when they were opened.
- **Side panel** (right, **⌘⇧J**). Three tabs: **File explorer** (**⌘⇧B**), **Token usage**
  (**⌘⇧U**) and **Session history** (**⌘⇧Y**).
- **Browser tab** (**⌘⇧I**). A page beside your terminals, opening on the home address from
  Settings → Browser.
- **Dev servers** (macOS, at the end of the tab strip). A chip counts the servers running in the
  project you are on; press it for the list. It finds servers started from Deck or from any other
  terminal or editor. Each one can be opened in Deck or in your browser, or copied. The chip
  does not appear where Deck cannot look for servers.

Drag the seam between the rail and the stage to resize it. Drag it past its floor, press
**⌘B** or use the toggle beside the traffic lights to collapse the rail to a column of project
avatars. A badge on an avatar counts the agents waiting on you, and pressing one opens that
project's sessions beside the column. **⌘B** or the toggle at the start of the tab strip
expands it again.

## Panes and tabs

- Split with **⌘D** (side by side) or **⌘⇧D** (stacked). Move between panes with **⌘⌥ arrows**;
  swap two panes with **⌘⌥⇧ arrows**.
- A plain shell pane in a split tab has a header with your pinned agents' logos. Press one to run
  that agent in the pane's shell. The header also holds the split, expand and close buttons.
- **⌘E** expands the focused pane; **⌘⇧Enter** zooms it over the whole tab.
- **⌘W** closes the focused pane; **⌘⇧W** closes the whole tab. Deck asks first if a process
  other than an idle shell is running there.
- **⌘⇧T** reopens the last closed tab with fresh shells at the same directories.
- **⌘⇧M** moves the focused pane into its own window.
- **⌘1**–**⌘8** select a chip by position; **⌘9** the last one; **⌘⇧]** / **⌘⇧[** cycle.
- **⌘⇧A** jumps to the pane that most needs you.

## Files

Open the file explorer (**⌘⇧B**) to browse the workspace. Opening a file splits the
sidebar: the list stays against the right edge and the document appears to its left, while the
terminal remains visible. Use **Open files** to return to a retained document; unsaved
files carry a dot. With the document focused, **⌘S** (Windows: **Ctrl+S**) saves and
**⌘W** closes it. Markdown opens rendered; **⌘⇧V** flips it to source.
See the [file panel](../../src/files/ui/file-panel.tsx).

The eye button on the folder's row shows or hides dot-files such as `.env` and `.github`;
`.git` and `node_modules` stay hidden. The row of the document beside the list is highlighted,
and switching documents opens the folders above it and scrolls it into view.

In a git checkout, switch the explorer from **Files** to **Changes** to see what has changed since the last commit: each file with its status and added and removed lines. Click one to open it.

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
