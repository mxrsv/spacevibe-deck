<p align="center">
  <img src=".github/assets/icon.svg" width="112" alt="SpaceVibe Deck icon" />
</p>

<h1 align="center">SpaceVibe Deck</h1>

<p align="center">
  <a href="https://github.com/mxrsv/spacevibe-deck/releases/latest"><img src="https://img.shields.io/github/v/release/mxrsv/spacevibe-deck" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-5e7df0.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-252a30" alt="macOS: Apple Silicon">
  <img src="https://img.shields.io/badge/Windows-x64-252a30" alt="Windows: x64">
</p>

<h2 align="center">Know which agent needs you next.</h2>

<p align="center">
  An attention-first desktop terminal that runs CLI agents side by side, shows supported
  agents' latest words and attention state, and returns you to the pane that needs you.
</p>

<p align="center">
  <strong><a href="https://github.com/mxrsv/spacevibe-deck/releases/latest">Download SpaceVibe Deck 1.0 →</a></strong>
</p>

> **Windows:** the 1.0 installer is x64 and unsigned, so Microsoft SmartScreen will warn on
> first install. Windows 1.0 has shipped without a real-hardware runtime verification pass.

![SpaceVibe Deck 1.0 with the Agent Rail and multiple CLI agents](.github/assets/screenshot.png?v=1.0.0) `current`

## The attention loop

|            |                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Launch** | Press the quick picker, choose an agent and a worktree, and start it in a real terminal pane.                           |
| **Watch**  | Read working, asked, and failed states in the Agent Rail. Claude Code, Codex, and OpenCode also expose their latest words. |
| **Jump**   | Select the project or pane that needs intervention instead of hunting through terminal tabs.                           |
| **Resume** | Reopen Deck and restore its tabs, workspaces, and the agent conversations each CLI can resolve.                        |

Resume is exact for Claude Code, Codex, and OpenCode; Gemini CLI and Antigravity are
best-effort, while custom agents relaunch their declared command. The implementation is
documented in [session restore](src/terminal/session-restore.ts) `current` and
[resume resolution](electron/resume/resolve.ts) `current`.

## What ships in V1

### Attention-first Agent Rail

Every live project and pane stays visible in one rail. A short status mark distinguishes
working, asked, and failed work; supported session logs supply the agent's latest words, and
unsupported tails fall back to the agent name
([rail model](src/ui/agent-rail-model.ts) `current`).

### One project stage

Run real PTYs in split panes, move between git worktrees, edit files, and keep browser pages
beside terminals as tabs on the same stage. Cmd/Ctrl+click on a path from an agent opens the
file and line in a configured editor
([PTY host](electron/pty/spawn.ts) `current`, [stage strip](src/ui/stage-surface-strip.ts) `current`).

### Sessions that come back

Deck continuously journals open tabs and file surfaces, guards boot restoration against crash
loops, and resumes supported conversations without assigning the same session twice
([session journal](src/terminal/session-journal.ts) `current`). Pane scrollback and unsaved file
edits are not restored.

### Local usage accounting

The usage dashboard reads supported agents' existing local session logs and groups token use
and known model costs by agent and day
([usage aggregation](src/lib/usage-aggregate.ts) `current`). It needs no Deck account. Deck
sends first-party usage analytics — always on, with no code, file paths or prompts, and no way
to switch them off; Settings → Privacy states exactly what is sent
([what Deck sends](src/telemetry/payload.ts) `current`).

### Workflow-neutral agents

Deck includes six agent definitions and accepts user-declared CLI commands. Each agent runs in
its own terminal process; Deck coordinates the workspace and attention surface without
replacing the CLI's own workflow
([agent catalog](src/lib/agent-catalog.ts) `current`).

## Install

- **[macOS — Apple Silicon (arm64)](https://github.com/mxrsv/spacevibe-deck/releases/latest):** signed and notarized. Intel Macs are not served by V1.
- **[Windows — x64](https://github.com/mxrsv/spacevibe-deck/releases/latest):** unsigned; SmartScreen will warn. Windows ARM is not served, and V1 remains runtime-unverified on Windows hardware.

Deck checks for updates and tells you when one is ready; you choose when to download, install,
and relaunch. Both platforms use the moving
[latest release](https://github.com/mxrsv/spacevibe-deck/releases/latest), never a pinned asset.

**Trust:** MIT licensed · no Deck account · first-party usage analytics always on, with no code,
paths or prompts, and no opt-out; Settings → Privacy states what is sent
([what Deck sends](src/telemetry/payload.ts) `current`) · session and usage data read from
local agent storage.

## Built-in agents

- **[Claude Code](https://claude.com/claude-code):** `claude --dangerously-skip-permissions`
- **[Codex](https://developers.openai.com/codex/cli):** `codex --dangerously-bypass-approvals-and-sandbox`
- **[OpenCode](https://opencode.ai):** `opencode`
- **[Antigravity](https://antigravity.google):** `agy --dangerously-skip-permissions`
- **[Gemini CLI](https://github.com/google-gemini/gemini-cli):** `gemini --yolo`
- **[Cursor](https://cursor.com/cli):** `cursor-agent --force`

These are the commands Deck ships, not hidden defaults. Settings lets you disable a built-in,
replace its launch command, or add another CLI command.

## Essential shortcuts

| Action | macOS | Windows |
| ------ | ----- | ------- |
| Launch an agent | `⌘T` | `Ctrl+Shift+T` |
| Jump to attention | `⌘⇧A` | `Ctrl+Shift+A` |
| Next / previous surface | `⌘⇧]` / `⌘⇧[` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Split pane | `⌘D` / `⌘⇧D` | `Ctrl+Shift+D` / `Ctrl+Alt+Shift+D` |
| Toggle file explorer | `⌘⇧B` | `Ctrl+Shift+B` |
| Open usage | `⌘⇧U` | `Ctrl+Shift+U` |
| Open Settings | `⌘,` | `Ctrl+,` |

The complete bindings are listed in [keyboard shortcuts](docs/user/keyboard-shortcuts.md)
`current` and defined in [the platform keymaps](src/terminal/default-keymaps.ts) `current`.

## Build from source

Requires Node.js 20+ and the native build tools required by Electron and `node-pty` on your
platform.

```bash
npm install
npm run electron:dev
```

Create a local packaged macOS build with `npm run electron:package`. Release packaging is a
separate signed and notarized workflow.

Deck uses Electron, Preact, TypeScript, xterm.js, Monaco Editor, and `node-pty`. The host and
renderer boundary is mapped in [the architecture overview](docs/internals/overview.md)
`current`; the full documentation index is [docs/README.md](docs/README.md) `current`, with
user guides under [docs/user/](docs/user/getting-started.md) `current` and the build and
release runbooks under [docs/operations/](docs/operations/development.md) `current`.

## Contributing

Focused issues and pull requests are welcome. Please open an
[issue](https://github.com/mxrsv/spacevibe-deck/issues) before starting a substantial product
or architecture change, and keep each pull request to one concern.

## License

[MIT](LICENSE) `current` © 2026 mxrsv

## Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |
| The README and both marketing images are visually approved | `current` | Verified | Owner approved the GitHub-rendered page, [hero](.github/assets/screenshot.png) and [social preview](.github/assets/social-preview.png) on 2026-08-22. |
| SpaceVibe Deck 1.0 is runtime-verified on Windows | `building` | Unverified | The x64 installer ships unsigned by owner decision; the real-hardware Gate C remains open. |
