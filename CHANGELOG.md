# Changelog

User-facing release notes. The release workflow's `promote` job publishes the
`## <version>` section matching a stable tag verbatim (under the fixed
platform-limitations header), so each section is written for users, reviewed in
the release PR, and frozen at the tag — never an auto-generated commit list.

## Unreleased

- **More reliable worktree creation.** Checkouts have up to a minute to finish,
  failures explain invalid branches, access problems and disk space, and an
  interrupted checkout is inspected before suggesting another attempt. Deck
  preserves any branch or worktree left behind.
  [Worktree creation](electron/git/worktree.ts) `current`.

- **Focus worktrees from their cards.** Click a card's heading or empty space to
  focus its session; the heading also expands or collapses its agents. A persistent
  chevron shows that state, and the heading highlights on hover or keyboard focus
  ([worktree card](src/ui/worktree-card.tsx) `current`).

- **A color for each worktree.** Right-click it and choose **Worktree color**
  to color its dot, selected frame and badge. Choices survive reopening Deck;
  **Default** restores the original treatment.
  [Worktree colors](src/ui/worktree-color-picker.tsx) `current`.

- **Arrange and pin tabs.** Drag terminal, file, browser and Agents tabs into
  place; right-click to pin, unpin, close others or close tabs to the right.
  Pinned tabs keep their icon and name and are skipped by bulk closes.
  Preferences last for the current window session.
  [Tab strip](src/ui/tab-strip.tsx) `current`.

- **Agent row messages and compact controls.**
  [Agent rows show their latest message](src/ui/agent-rail-card-model.ts) `current`
  once available; names you set yourself take precedence.
  [State and close share the row's trailing slot](src/ui/worktree-card-row.tsx) `current`:
  hover or keyboard focus reveals close without shifting the message or model.

- **Return to Agent Board.** When session restore is enabled, quitting while viewing Agent
  Board now brings the Board back on screen at the next launch. Switching away before quitting
  keeps only its `Agents` tab open ([Board restore](src/terminal/session-restore.ts) `current`).

## 1.0.1

This update makes starting new work more deliberate and improves terminal
startup on Windows.

### Highlights

- **Return to unread conversations.** Recent activity now filters its latest
  sessions to unread questions, warnings and results. Opening one focuses its
  pane and acknowledges it; View all keeps the complete history available.
  A session whose pane has closed can still resume in a new tab. Opening shows a
  loading ring and blocks repeated clicks; unopened sessions no longer carry
  a gray status dot. Time sits before the trailing state indicator.
  [Recent activity](src/ui/sessions/recent-session-activity.tsx) `current`.

- ⚡ **Faster Windows terminal startup.** Deck no longer starts a PowerShell/WMI
  process census in front of a new shell, split or docked pane. Background
  inspection stays paused through shell startup and resumes on its normal
  interval after the prompt is ready.
- ✍️ **One task draft, wherever you start.** The Open Board and Quick Launch
  share the same prompt, workspace, agent, model and effort. Choosing a
  workspace fills the draft without starting a process; the launch action
  opens the agent with the task ready for you to review and submit.
- 📝 **Markdown opens rendered.** Markdown files now open as formatted
  documents; ⌘⇧V switches between the rendered view and source.
- 🎯 **A clearer agent rail.** The rail keeps each row paired with its own
  session, marks the pane holding the keyboard, and lets you reorder or close
  project groups.
- 🧹 **The sidebar banner is gone.** The decorative artwork at the foot of the
  sidebar and its Appearance setting have been removed. The sidebar's action
  footer now closes the column, and any banner image you had chosen is no
  longer read.
- 📊 **Usage analytics are on by default.** Deck reports limited daily usage
  counts — never code, paths, prompts or agent output. Turn it off at any time
  in Settings → Privacy.

### Upgrading

- The Windows installer remains unsigned, and Windows runtime behaviour still
  requires owner verification before this release is promoted.
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
