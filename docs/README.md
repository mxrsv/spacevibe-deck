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
  focus, the checkout tree and its first-prompt labels, close and order.
- [Spaces and Mission Control](internals/mission-control.md) — tabs as spaces, the slide,
  the overview, and why only the current space holds a live terminal.
- [Agent Board](internals/agent-board.md) — retired behind a live switch; the grid of agent
  cards, the seams it took, and what Restart resumes.
- [File surface, browser tab and path opening](internals/file-surface.md) — the explorer,
  editor, markdown policy, browser view and link routing.
- [Session restore](internals/session-restore.md) — the journal, the last-session offer, resume
  resolution and session history.
- [Analytics service](../backend/README.md) — independent Worker/D1 deployment and retention operations.
- [Usage analytics](internals/telemetry.md) — the payload, consent state and when a POST
  fires.
- [Known traps and live switches](internals/traps.md) — what has bitten this codebase, and
  the constants that currently switch behaviour off.

## `operations/` — building and shipping

- [Development](operations/development.md) — commands, CI, tests, what a green run proves.
- [Cutting a release](operations/release.md) — the tag, the four jobs, the gates, secrets,
  the updater client, the Tauri hotfix path.

## Elsewhere

- [Public user documentation website](https://linear.app/mxrsv/issue/DECK-126) — feature plan
  and acceptance criteria.
- [`DESIGN-LANGUAGE.md`](DESIGN-LANGUAGE.md) — visual invariants (a fork to change) and
  current surface patterns (replaced by a redesign). Code cites its numbers, and
  `scripts/design-language.test.ts` resolves them, so it stays at this path.
- [`../AGENTS.md`](../AGENTS.md) — repository rules for contributors and agents.
- [`../CHANGELOG.md`](../CHANGELOG.md) — user-facing release notes, read by the release
  workflow.
