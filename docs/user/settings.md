# Settings

Open Settings with **⌘,** (Windows: **Ctrl+,**). It covers the whole window; leave with
**Back** or Escape. Settings are stored per machine in Deck's data folder as `settings.json`
and apply to every Deck window.

## Appearance

- **Theme** — Light or Dark. Dark is the default. On Dark, the terminal is the deepest surface
  in the window and the chrome stands above it.
- **Font size** — the terminal font size (default 13).
- **Tab bar position** — the chips live in the sidebar layout (default) or along the top.
- **Show pane bar** — a name bar inside each split (off by default).
- **Show status bar** — branch, path and window readout along the bottom (off by default).

## Browser

- **Home address** — the page the browser tab opens on when it has no page yet (default
  `http://localhost:3000`).

## Terminal

- **Scrollback** — lines kept per pane: 1,000 / 5,000 / 10,000 (default) / 50,000 / 100,000.

## Agents

The agent catalog: installed and available built-ins, per-agent launch commands, the default
agent, the enable switch, and declared custom agents. See [Agents](agents.md).

## Links & editor

- **Open with** — the app that opens a path when you ⌘+click one that no open workspace
  holds. The list is what Deck found installed among VS Code, Cursor, Zed, GitHub Desktop,
  GitKraken, Finder, Terminal, iTerm2, Ghostty and Hyper. Paths inside an open workspace
  always open in Deck's own editor. Detection looks for macOS application bundles, so on
  Windows no external app is offered in this release.

## Shortcuts

Every action with its current key. Click a row to record a new chord; a conflict with another
action is called out on the row, and the reset control returns the shipped default. Recording
a chord temporarily suspends the menu accelerators so the key reaches the recorder.

## Notifications

- **Agent notifications** — a native alert when a background agent finishes or needs you
  (off by default).
- **Restore sessions on launch** — reopen the last session's tabs and resume agent
  conversations (on by default). Turning it off is the kill switch for session restore.

## About

Deck's version, **Check for updates**, and **Release notes**. An update is never downloaded or
installed without your choice; Deck asks before closing panes to install.

## Privacy

- **Share usage stats** — on by default. Off stops counting immediately, and an "off" choice
  is never inferred away. The row states exactly what a daily snapshot contains.

This switch is deliberately not part of `settings.json`: it is stored in `telemetry.json` in
Deck's data folder so that a copied settings file never carries a consent choice. If that
file exists but cannot be read, sharing stays off and Deck says so here.

## Reset

**Restore defaults** returns every preference (theme, font, colours, behaviour, agents,
prompts) to a fresh install's state, after a confirmation. It does not touch your agents' own
session logs.

## Where Deck keeps its data

| File or folder        | Contents                                                             |
| --------------------- | -------------------------------------------------------------------- |
| `settings.json`       | Every setting above except the usage-stats choice                    |
| `workspaces.json`     | Recent workspaces and the layout and agent each was last opened with |
| `presets.json`        | Layout presets                                                       |
| `repositories.json`   | Cached git repository and worktree scans for the rail                |
| `session.json`        | The live tab journal used by session restore                         |
| `update-attempt.json` | The last update install attempt, so a failed relaunch is reported    |
| `telemetry.json`      | The usage-stats choice and the current day's counters                |
| `usage-cache.json`    | Parsed token-usage results, keyed by log file                        |
| `themes/`             | Imported theme files                                                 |

On macOS the folder is `~/Library/Application Support/SpaceVibe Deck`; on Windows it is
`%APPDATA%\SpaceVibe Deck`.
