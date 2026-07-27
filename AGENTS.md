# AGENTS.md — SpaceVibe Deck

A minimal macOS terminal for running many AI agent CLIs side by side. Formerly Stackgrid. Stack: Tauri 2 + Rust backend, Preact + xterm.js frontend, Vite 6, Vitest. All strings, comments and docs in this repo are **English only**.

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

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

Empty — verified 2026-07-27. Do not remove this section (D7).
