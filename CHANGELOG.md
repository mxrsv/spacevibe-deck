# Changelog

User-facing release notes. The release workflow's `promote` job publishes the
`## <version>` section matching a stable tag verbatim (under the fixed
platform-limitations header), so each section is written for users, reviewed in
the release PR, and frozen at the tag — never an auto-generated commit list.

## Unreleased

## 1.1.1

This update fixes a freeze that could lock Deck right after it opened.

- **No more freeze on restore.** With several agents spread across more than one
  checkout, Deck could stop responding a few seconds after launch and had to be
  force-quit. The rail now settles on its first layout pass.

- **Clearer project breaks in the rail.** More space between projects, and each
  header sits closer to the card it names.

## 1.1.0

This update brings Agent Board, makes starting new work more deliberate,
and improves terminal startup on Windows.

### Highlights

- **Agent Board (⌘⇧O).** See your agents together in one overview. Select a
  card to jump to its terminal tab; the Board also has its own `Agents` tab.

- **Arrange and pin tabs.** Drag terminal, file, browser and Agents tabs into
  place; right-click to pin, unpin, close others or close tabs to the right.
  Pinned tabs keep their icon and name and are skipped by bulk closes.
  Preferences last for the current window session.

- **Focus worktrees from their cards.** Click a card's heading or empty space to
  focus its session; the heading also expands or collapses its agents. A persistent
  chevron shows that state, and the heading highlights on hover or keyboard focus.

- **Agent row messages and compact controls.**
  Agent rows show their latest message
  once available; names you set yourself take precedence.
  State and close share the row's trailing slot:
  hover or keyboard focus reveals close without shifting the message or model.

- **Return to Agent Board.** When session restore is enabled, quitting while viewing Agent
  Board now brings the Board back on screen at the next launch. Switching away before quitting
  keeps only its `Agents` tab open.

- **Return to unread conversations.** Recent activity now filters its latest
  sessions to unread questions, warnings and results from confirmed live sessions.
  Opening one focuses its pane and acknowledges it; View all keeps the complete
  history available. When a live session cannot be confirmed, selecting it resumes
  that conversation instead of focusing a pane guessed from transcript activity.
  Opening shows a loading ring and blocks repeated clicks; unopened sessions no longer carry
  a gray status dot. Time sits before the trailing state indicator.

- **More reliable worktree creation.** Checkouts have up to a minute to finish,
  failures explain invalid branches, access problems and disk space, and an
  interrupted checkout is inspected before suggesting another attempt. Deck
  preserves any branch or worktree left behind.

- **A color for each worktree.** Right-click it and choose **Worktree color**
  to color its dot, selected frame and badge. Choices survive reopening Deck;
  **Default** restores the original treatment.

- **Choose before launching.** Selecting a recent workspace on the Open Board
  fills the visible workspace and agent choices without starting a process.
  Review the selected agent, then open it.
- **Keep the window after the last tab.** Closing the last terminal tab returns
  to the Open Board instead of closing the window.
- ⚡ **Faster Windows terminal startup.** Deck no longer starts a PowerShell/WMI
  process census in front of a new shell, split or docked pane. Background
  inspection stays paused through shell startup and resumes on its normal
  interval after the prompt is ready.
- 📝 **Markdown opens rendered.** Markdown files now open as formatted
  documents; ⌘⇧V switches between the rendered view and source.
- 🎯 **A clearer agent rail.** The rail keeps each row paired with its own
  session, groups each checkout into a card without losing shell tabs, marks
  the pane holding the keyboard, and lets you reorder or close project groups.
- ➕ **One `+` per checkout, and it always asks which agent.** Every checkout
  card carries exactly one create control — the `+` on its strip, or its
  `New agent` row when the card is open — and pressing it lists the agents you
  can run there instead of silently opening a shell. The project header's `+`
  and the tab strip's `+` are gone; `⌘T` (`Ctrl+Shift+T`) opens the same list
  for the checkout you are working in, names that checkout at the top, and
  ends with `Open another project…`. A plain shell is `New split here`.
- 🧹 **The sidebar banner is gone.** The decorative artwork at the foot of the
  sidebar and its Appearance setting have been removed. The sidebar's action
  footer now closes the column, and any banner image you had chosen is no
  longer read.
- 📁 **The file explorer names its folder, and that row acts.** The tree now
  shows the folder it is rooted at as its first row, carrying New File, New
  Folder, Refresh and Collapse All. A new file or folder is created in the
  focused directory, falling back to the workspace root.
- 📊 **Usage analytics are always on, with no opt-out.** Deck reports limited
  daily usage counts — never code, paths, prompts or agent output.
  Settings → Privacy states exactly what is sent.
- 🔍 **The rail asks the agents instead of guessing, and says when it guessed.**
  A Claude pane's session and its "waiting for permission" now come from
  Claude's own session list and from hooks Deck installs for that pane alone
  (never in your `~/.claude`); an opencode pane reports busy, idle, errors and
  permission prompts from its own server; Codex rings its notification whether
  or not the pane is focused. Labels distinguish inferred status from signals
  reported by an agent. An agent whose process ended shows a small square
  instead of reading as a finished run, and Cursor panes count as agents. Each
  adapter can be switched off per agent under Settings → Agents.
- **Agent integration is set up at launch.** Deck adds per-pane hook settings
  and a session id to eligible new Claude launches, and configures a local
  reporting port for opencode. Your saved commands stay unchanged; settings
  supplied in your command are respected.
- **Clearer agent status and loading.** Working agents show three staggered
  loading bars, with a still version when reduced motion is enabled. Status
  dots on worktree cards use solid yellow or gray; inferred
  status is still named in tooltips and accessible labels. Ended agents keep
  their distinct square mark.
- **Quieter single-agent hover.** Only groups of two or more agents open a
  popover on hover or keyboard focus. A single agent stays a direct focus
  button; overflow menus still expose hidden agents.

### Upgrading

- **1.1.0 is the first release that sends usage analytics.** Analytics are
  always on, with no opt-out, starting on the first launch after upgrading.
  No code, paths, prompts or agent output are sent. Settings → Privacy states
  exactly what is sent; 1.0.0 and the older Tauri releases send no analytics.
- **Coming from a Tauri release?** Its update check fails and the published
  build has no migration notice. Download the Electron installer from
  [the releases page](https://github.com/mxrsv/spacevibe-deck/releases/latest)
  and install it manually. Settings and workspaces do not migrate. Old Tauri
  data remains in `~/Library/Application Support/dev.spacevibe.deck` on macOS
  or `%APPDATA%\dev.spacevibe.deck` on Windows, separate from Electron's
  `SpaceVibe Deck` data folder.
- The Windows installer remains unsigned. Windows installation and auto-update
  have not been runtime-verified for this release.
- Intel Macs are not served by this build (Apple Silicon only).

## 1.0.0

**SpaceVibe Deck 1.0 is here.** The terminal built for running many AI agents
at once — now stable, self-updating, on macOS (Apple Silicon) and Windows
(x64).

One window, every agent. Claude Code, Codex, Gemini, opencode, cursor-agent or
any CLI you throw at it — each in its own pane, each in its own worktree, all
visible at a glance.

### Highlights

- 🧠 **See your agents think.** The agent rail shows every pane's live state —
  working, asking, failed — and for Claude Code, Codex and opencode, the
  agent's own latest words. You always know who needs you next.
- ⚡ **An agent in one keystroke.** ⌘T opens the quick picker: pick an agent,
  pick a worktree, it's running. Split panes, drag an agent onto any pane to
  dock it, jump anywhere by number.
- 🔁 **Close Deck, not your conversations.** Relaunching reopens your tabs and
  resumes your agents' sessions — exact for Claude Code, Codex and opencode,
  best-effort for the rest.
- 📁 **The whole project on one stage.** File explorer with a real editor, a
  browser tab beside your terminals, and ⌘+click on any path an agent prints
  jumps straight to that file and line.
- 📊 **Know what you burn.** The token-usage dashboard reads your agents' own
  local session logs. No accounts, no telemetry — nothing ever leaves your
  machine.
- 🌗 **Light and Dark, one switch.** On dark, the terminal is the deepest
  surface in the window — your work sits below the chrome, where it belongs.
- 🚀 **It keeps itself current.** Auto-update ships with 1.0: Deck tells you
  when a release is out, and you choose when to download, install and
  relaunch.

### Upgrading

- Windows preview installs (`Deck Electron`) are a separate app: this release
  installs as `SpaceVibe Deck` alongside it with fresh settings. Uninstall the
  preview manually after moving over.
- Tauri-era installs of SpaceVibe Deck do not migrate settings or workspaces;
  this is a clean install by design.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention.
Only `## <version>` sections are published as release notes, so this one never
reaches a user.)_

Empty: each version section above is frozen at its tag and describes what that
release shipped.
