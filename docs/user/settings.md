# Settings

Open Settings with **⌘,** (Windows: **Ctrl+,**). It covers the whole window; leave with
**Back** or Escape. Settings are stored per machine in Deck's data folder as `settings.json`
and apply to every Deck window.

## Appearance

[Appearance](../../src/ui/settings/sections/appearance-section.tsx) groups the theme,
terminal text, workspace chrome and identity.

- **Theme** — pick a card under Light or Dark: Deck Light, Paper and Mist, or Deck Dark, Graphite,
  Midnight, Forest and Dusk. It applies at once. Deck Dark is the default.
- **Import theme** — add an iTerm2, Windows Terminal, Ghostty or Alacritty file; it appears under
  Custom and changes the terminal colors only. Delete its file from **Themes folder** to remove it.
- **Font and size** — shared by terminals and the built-in editor (default size 13). Zooming the
  window scales the app around them and leaves this text size alone.
- **Tab bar position** — the chips live in the sidebar layout (default) or along the top.
- **Show pane bar** — a name bar inside each split (off by default).
- **Show status bar** — branch, path and window readout along the bottom (off by default).
- **App logo** — under Identity, choose an image to show on the Open board, or remove it.

## Browser

- **Home address** — the page the browser tab opens on when there is no previous page to restore (default
  `http://localhost:3000`).

## Terminal

- **Scrollback** — lines kept per pane: 1,000 / 5,000 / 10,000 (default) / 50,000 / 100,000.

## Agents

The agent catalog: installed and available built-ins, per-agent launch commands, the enable switch, quick-launch choices, and declared custom agents. See [Agents](agents.md).

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

- **Agent notifications** — on by default. A window in the background alerts when an agent
  finishes, asks for input or approval, or fails. Click the alert to return to that pane.
  If the pane has closed or moved to another window, the alert opens its original window.
  An older off setting is enabled once by this update; turning it off afterward is remembered.
  See [agent alerts](../../src/terminal/agent-notifier.ts).
- **Open System Settings** opens the notifications settings on macOS or Windows, where the OS
  controls delivery. On macOS, allow notifications when the first alert prompts, and use the
  system's **Badges** switch to control the Dock count.
  See [notification settings](../../src/ui/settings/sections/notifications-section.tsx).
- **Dock badge (macOS)** — a number on the Dock icon: the panes that need you across open
  windows, including finished panes you have not looked at yet. It clears at zero and stays independent of Deck's alert
  toggle. Windows has alerts but no Dock badge.
  See [attention count](../../src/ui/attention/attention-badge-sync.ts).

## Mobile

Shown only while the mobile companion is turned on (it is not in release builds yet). See
[Mobile](mobile.md) for the whole flow.

- **Pair a phone** shows a QR code for the SpaceVibe Deck iPhone app. It works for five minutes and
  only once; **Copy code** copies it as text for the phone's code field, and **Show a new code**
  replaces an expired one.
- **Paired phones** lists each phone with its model, when it was paired and when it was last seen.
  **Revoke** removes a phone; within seconds it can no longer reach Deck.
  See [the Mobile section](../../src/ui/settings/sections/mobile-section.tsx).

## About

Deck's version, **Check for updates**, **Release notes** and **Feedback**, which opens the
feedback page in your browser for reporting a bug or suggesting an idea. An update is never downloaded or
installed without your choice; Deck asks before closing panes to install.
That confirmation includes busy work and unsaved files in every open window, as checked by
the [update census](../../electron/ipc/register-updater.ts).

## Privacy

From release 1.1.0, usage analytics are always on, with no opt-out. This page states exactly
what is sent and links to the privacy notice; it has no switch. Snapshots contain daily
usage counts, never code, paths, prompts or agent output. Release 1.0.0 and the older
Tauri releases send no analytics. See the [payload contract](../../src/telemetry/payload.ts).

Analytics state and pending daily counters live in `telemetry.json` in Deck's data folder,
separate from `settings.json`. A stored off choice from a development build becomes enabled
on launch. If `telemetry.json` cannot be read, Deck counts for that run in memory and leaves
the file untouched; the day's counts are lost when you quit.

The page also states that packaged builds send crash and error reports to Sentry
automatically, with no opt-out: error messages, stack traces, Deck source lines and app and
runtime details, with the home-directory part of paths replaced by `~`. Breadcrumbs, local
variables, native crash dumps, console and request events are never included. See the
[Privacy page copy](../../src/ui/settings/sections/privacy-section.tsx).

## Search and changed marks

The field at the top of the Settings list finds a setting by the name printed on its row. Each
page shows how many matches it holds, and matching rows are highlighted. **Esc** clears the
search before it closes Settings.

A dot after a setting's name means it differs from its default. The dot marks exactly what a
page's **reset page** action would restore: preferences. Declared agents, launch configurations
and layout have their own rows under [Reset](#reset), so they carry no dot.

## Reset

The [Reset page](../../src/ui/settings/sections/reset-section.tsx) has three rows: preferences,
layout, and custom agents with launch configurations and prompt templates. Each asks first and
lists the settings it will change and what it keeps. A row is disabled while nothing in its
group differs from the defaults. Pages that hold preferences also show how many differ and a
**reset page** action that touches only that page. Resetting agents and templates also
unpins the deleted agents from quick launch. Your custom logo, workspaces and agents’ own
session logs stay.

## Where Deck keeps its data

| File or folder        | Contents                                                             |
| --------------------- | -------------------------------------------------------------------- |
| `settings.json`       | App preferences; analytics state is stored separately                |
| `workspaces.json`     | Recent workspaces and the layout and agent each was last opened with |
| `presets.json`        | Layout presets                                                       |
| `repositories.json`   | Cached git repository and worktree scans for the rail                |
| `session.json`        | The live tab journal used by session restore                         |
| `update-attempt.json` | The last update install attempt, so a failed relaunch is reported    |
| `telemetry.json`      | Analytics state and pending daily counters                           |
| `usage-cache.json`    | Parsed token-usage results and the project folders they ran in       |
| `themes/`             | Imported theme files, listed under Custom in Appearance              |

On macOS the folder is `~/Library/Application Support/SpaceVibe Deck`; on Windows it is
`%APPDATA%\SpaceVibe Deck`.
