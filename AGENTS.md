# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app — unrelated to the SpaceVibe web/backend repos, no shared DB or API.
> Never edit sibling repos from this session. Workspace map: [`../AGENTS.md`](../AGENTS.md) `current`.

A minimal macOS terminal for running many AI agent CLIs side by side. Formerly Stackgrid. Stack: Tauri 2 + Rust backend, Preact + xterm.js frontend, Vite 6, Vitest. All strings, comments and docs in this repo are **English only**.

## Direction & forks

**Where this is going.** A minimal macOS terminal for running many agent CLIs side by
side. Standalone desktop app — no shared DB, no API, no dependency on the web repos.

**In flight — already decided, do not reopen:**

- v0.8.0 release is waiting on a pushed `v0.8.0` tag; CI builds from there.
- Landing download links resolve from the releases API at load (2026-08-01): the
  hand-bumped Windows prerelease pin is gone — publishing a release is the act
  that points the landing at it, so links never rot between releases.
- The `deck.spacevibe.dev` landing has no host chosen yet (domain parked).
- Four code comments still cite `FR-`/`ADR` against the claim in `docs/CONTEXT.md`
  (`agents.rs`, `open-board.tsx`, `migrate.rs`) — logged in that file's drift ledger,
  awaiting a human call: strip the comments or soften the claim.
- The marketing video renders from the DOM stage shared with the app — breaking app
  components silently breaks the video.
- Cross-platform auto-update for macOS and Windows is approved (2026-08-02), with
  the no-fee B2 Windows preview channel chosen on 2026-08-03: use free Tauri updater
  signing and GitHub Releases; auto-check only, then expose an explicit chrome
  `Update` → `Install & Relaunch` action beside Settings. Windows remains an unsigned,
  separately labelled prerelease until paid Authenticode signing is chosen later.
- Production builds minify with Terser, not esbuild (PR #9, merged 2026-08-04): esbuild
  0.25 drops xterm 6's function-local enum in `InputHandler.requestMode` but keeps a
  renamed reference, so the DECRQM query OpenCode sends at startup throws and stops
  xterm's write queue for good — a blank pane. `scripts/vite-config.test.ts` locks it.
- User-declared agents (`M2`) are approved (2026-08-04): an agent is a label plus a full
  command line, declared in a new Settings category, and `AgentChoice` stays a string id
  whose built-in ids equal their binary names — so every `lastAgent` already on disk
  keeps resolving and no migration exists to get wrong. The editable list needs a new
  design-language rule (§12), approved with it. See
  [spec](docs/specs/2026-08-04-user-declared-agents-design.md) `decided`.

**Forks → STOP and ask before writing code.** Collect them into ONE round at the start
of the task; if there are none, say "no forks" and just go.

- The load-bearing `src-tauri` seams: PTY, window coordinator, tab materialize, layout
  engine, close coordinator (R4).
- Bundle, signing, release or version config.
- Changes to the design language rules in `docs/DESIGN-LANGUAGE.md` (R2).
- Adding a dependency, or anything that changes what ships in the app bundle.

Not a fork: renaming internals, adding tests, styling within the existing DL rules,
editing the menu registry (never the generated output — R3).

**Write the answer down.** When the user resolves a fork, it MUST be recorded in the
"In flight" list within the same task, with a one-line reason; until it is written, the
work is not done. This list is a QUEUE, not an archive: once a thread closes, move the
decision down into `docs/ARCHITECTURE.md`.

**Prove it with commands** (L5/W4 — no output, no "done"): `npm test` ·
`npm run build` (this is `tsc && vite build`, so it covers typecheck). No separate
`lint` script in this repo. Note this repo uses **npm**, not pnpm like the web repos.

## Common commands

| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server (web-only preview)                                  |
| `npm run tauri dev`     | full desktop app                                                    |
| `npm test`              | Vitest unit tests                                                   |
| `npm run build`         | typecheck + production build                                        |
| `npm run generate:menu` | regenerate menu from registry — never hand-edit generated menu code |
| `npm run video:render`  | render the marketing video from the DOM stage                       |

## Layout

```
src/                 # Preact UI
├─ chrome/           #   window chrome, tabs
├─ terminal/         #   xterm.js panes
├─ open-board/       #   workspace board (open/recents)
├─ presets/          #   layout presets
├─ settings/         #   settings UI + stores
└─ lib/              #   pure helpers
src-tauri/src/       # Rust: pty, window coordinator, menu, migrate…
marketing/           # marketing video stage (shares components with the app)
docs/                # DESIGN-LANGUAGE.md (DL rulebook), CONTEXT.md, specs/, plans/, review/
```

## Repo rules (R-rules — delta from the global standard)

- **R1.** English only for every string, comment and doc — no Vietnamese in this repo.
- **R2.** Chrome UI styling follows `docs/DESIGN-LANGUAGE.md`; rules are numbered (`DL-3.2`) and cited from code comments. Fix a violation → update the ledger at the bottom of that doc.
- **R3.** Menu code is generated (`npm run generate:menu`, checked by `generate:menu:check` in CI) — edit the registry, not the output.
- **R4.** The Rust PTY/window coordinator, tab materialize, layout engine and close-coordinator paths are load-bearing seams — treat `src-tauri` module boundaries as in-flight when planning changes there.
- **R5.** State is Preact signals; module stores are window-scoped.

## Known traps

- The ADR pipeline (`docs/decisions/`, PIPELINE.lock, derived docs) was removed on 2026-07-27 — old plans/reviews still reference it; they are point-in-time records, leave them as written.
- Marketing video renders from the DOM through a virtual clock and shares the app stage — breaking app components can silently break the video.

## Language

- Docs/comments: **English only**. Commit messages: English, conventional commits.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                                            | Intent    | Status         | Evidence                                                                          |
| ---------------------------------------------------------------- | --------- | -------------- | --------------------------------------------------------------------------------- |
| "v0.8.0 release is waiting on a pushed `v0.8.0` tag" (In flight) | `current` | `contradicted` | No `v0.8.0` was ever tagged; releases jumped v0.7.0 → v0.9.0 (Latest, 2026-07-27) |

Drift recorded by the [2026-08-01 audit](docs/review/2026-08-01-doc-drift.md) `current`. Do not remove this section (D7).
