# Contributing

## Where things are

- Setup, commands, tests and what a green run proves:
  [docs/operations/development.md](docs/operations/development.md).
- How Deck is built: [docs/internals/](docs/internals/overview.md), starting with the
  overview and the [glossary](docs/internals/glossary.md).
- Repository rules for contributors and agents, including the
  [documentation rules](AGENTS.md#documentation): [AGENTS.md](AGENTS.md).
- Visual rules: [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md). They are numbered,
  cited from code comments, and parsed by a test.

## Where the project is

SpaceVibe Deck 1.0 shipped on 2026-08-20 for macOS on Apple Silicon (signed and notarized)
and for Windows x64 (unsigned, and not yet verified on real Windows hardware). Since then
the surfaces around the Agent Rail, session restore and the sidebar have been reshaped and
are being finished for the next release. Most of that work has suite and build evidence but
no pass in a running app yet. The Tauri host under `src-tauri/` is feature-frozen; new
features land on Electron only.

## What is most likely to be accepted

- Small, focused bug fixes, with a test where the behaviour is testable.
- Evidence from a running app on macOS or Windows for a surface that shipped with suite
  evidence only, and fixes for what that evidence finds.
- Documentation corrections where a page disagrees with the code.

## What needs an issue first

- Anything in a fork-listed area of [AGENTS.md](AGENTS.md#forks): PTY ownership, process
  classification, the window coordinator, tab materialization, layout, close and quit,
  release, updater, signing or dependency configuration, or a design-language rule.
- New product surfaces or product scope. Describe the problem before the solution.

## Pull requests

- One concern per pull request. If the description says "also", split it.
- Say what changed and why, and name the class of evidence: suite and build, an
  `electron:dev` run on macOS, or Windows hardware. Green unit tests are not native
  evidence.
- A UI change needs before and after screenshots; motion or timing needs a short video.
  Upload them to the pull request; never commit them.
- Follow the documentation rules: internal pages hold decisions and hard-to-discover
  constraints, user guides change when how to use a feature changes, and a cosmetic change
  needs no documentation entry. Plans and research notes are not committed.
- Commit subjects are conventional commits with a scope, for example `fix(rail): …` or
  `docs(deck): …`.
- Everything in the repository is English: strings, comments, docs and commit messages.
- CI runs the menu check, lint, the test suite, both builds and the Rust checks on every
  pull request. Run the smallest local proof for your change before opening it.
