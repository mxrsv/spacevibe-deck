# Changelog

User-facing release notes. The release workflow's `promote` job publishes the
`## <version>` section matching a stable tag verbatim (under the fixed
platform-limitations header), so each section is written for users, reviewed in
the release PR, and frozen at the tag — never an auto-generated commit list.

## 1.0.0

SpaceVibe Deck 1.0 — the first stable release: a desktop terminal for running
many AI agent CLIs side by side, now shipping for macOS (Apple Silicon) and
Windows (x64) with built-in auto-update.

**Highlights**

- **Run many agents at once** — tabs and split panes for Claude Code, Codex,
  Gemini, opencode, cursor-agent or any CLI, each in its own worktree-aware
  workspace.
- **The agent rail** — every pane shows what its agent just said and whether it
  is working, asking, or done, across all your projects.
- **Session restore** — relaunching Deck reopens your tabs and resumes
  supported agents' conversations (Claude Code, Codex, opencode exactly;
  Gemini and others best-effort).
- **Files, browser, and usage on the stage** — a file explorer with an editor,
  a browser tab, and a token-usage dashboard live beside your terminals;
  ⌘+click any path an agent prints to open it.
- **Light and Dark** — one switch in Settings, with the terminal as the deepest
  surface on dark.

**Upgrading**

- Windows preview installs (`Deck Electron`) are a separate app: this release
  installs as `SpaceVibe Deck` alongside it with fresh settings. Uninstall the
  preview manually after moving over.
- Tauri-era installs of SpaceVibe Deck do not migrate settings or workspaces;
  this is a clean install by design.
