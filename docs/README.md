# SpaceVibe Deck documentation

Three tiers, split by reader. Every page describes the shipped Electron host in the present
tense; anything about the frozen Tauri host says so.

## `user/` — using Deck

- [Getting started](user/getting-started.md) — install, first launch, the window, panes and
  files.
- [Agents](user/agents.md) — the built-in commands, custom agents, what Deck knows about each
  tool.
- [Keyboard shortcuts](user/keyboard-shortcuts.md) — every shipped chord on macOS and Windows.
- [Settings](user/settings.md) — each category, the privacy switch, where data lives.

## `internals/` — how Deck is built

- [Overview](internals/overview.md) — the Electron boundary, the bridge and its contract,
  persistence, the load-bearing seams.
- [Glossary](internals/glossary.md) — the words the code and docs use.
- [Terminal, panes and tabs](internals/terminal.md) — PTY ownership, classification, layout,
  materialization and launch, phase and attention, actions and menu, close, quit and
  transfer.
- [Agent Rail](internals/agent-rail.md) — the rail model, state, the session-tail pairing,
  focus, close and order.
- [File surface, browser tab and path opening](internals/file-surface.md) — the explorer,
  editor, markdown policy, browser view and link routing.
- [Session restore](internals/session-restore.md) — the journal, boot restore, resume
  resolution and session history.
- [Usage analytics](internals/telemetry.md) — the payload, consent state and when a POST
  fires.
- [Known traps and live switches](internals/traps.md) — what has bitten this codebase, and
  the constants that currently switch behaviour off.

## `operations/` — building and shipping

- [Development](operations/development.md) — commands, CI, tests, what a green run proves.
- [Cutting a release](operations/release.md) — the tag, the four jobs, the gates, secrets,
  the updater client, the Tauri hotfix path.

## Elsewhere

- [`DESIGN-LANGUAGE.md`](DESIGN-LANGUAGE.md) — the numbered visual rules cited from code and
  enforced by `scripts/design-language.test.ts`. It stays at this path because the test
  reads it.
- [`../AGENTS.md`](../AGENTS.md) — repository rules for contributors and agents.
- [`../CHANGELOG.md`](../CHANGELOG.md) — user-facing release notes, read by the release
  workflow.

`ARCHITECTURE.md`, `CONTEXT.md`, `CONTEXT-archive.md`, `intent/`, `plans/`, `specs/` and
`review/` are the earlier documentation set. They describe decisions as they were made and
are superseded by the pages above wherever the two disagree.
