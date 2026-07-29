# Review — Windows desktop changeset, pre-ship check

- **Date:** 2026-07-30
- **Scope:** the full uncommitted Windows engineering-preview changeset
  (checkpointed in the commit that accompanies this record)
- **Spec:** [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
- **Plans:** [implementation](../plans/2026-07-29-windows-desktop.md),
  [delivery](../plans/2026-07-29-windows-desktop-delivery.md)
- **Process:** parallel precision + recall reviewers, findings adversarially
  verified and merged by an adjudicator
- **Verdict:** **BLOCK** for any production/release claim; mergeable as the
  engineering-preview scaffold it declares itself to be once H1/H2 land

Verification evidence at review time (macOS host): `npm test` 830/830,
`cargo test --locked` 61/61, `npm run build` pass, `npm run generate:menu:check`
clean, `node --test scripts/verify-windows-bundle.test.mjs` 5/5.

## Critical

### C1 — No Windows runtime behind the platform contract

`src-tauri/src/platform/mod.rs:3-4`, `src-tauri/src/platform/unsupported.rs:22-48`,
`src-tauri/src/pty.rs:160`. There is no `platform/windows/` module; a Windows
build compiles the `unsupported` fallback, where `shell_launch()` and
`user_home()` return errors and `discover_agents()` returns nothing. On real
Windows every pane spawn fails, `desktop_environment` fails, the frontend falls
back to platform `"unsupported"`, and none of the new Windows keymap/label/
gesture behavior activates. `open_editor` (`src-tauri/src/links.rs:96-97`) still
spawns `$SHELL -lc` with a `/bin/zsh` fallback while the frontend now emits
PowerShell-quoted paths — the new quoting has no capable consumer. Spec gates
W1–W4 are unimplemented and CI has no job that produces an installer.
**Resolution: complete implementation Tasks 5–19 and 25–26 plus delivery Tasks
33–34 and 37 before any release claim.**

## High

### H1 — Windows clipboard chords bound to unimplemented actions

`src/terminal/action-registry.ts:671-672`, `src/terminal/tab-manager.ts:1076-1082`.
`Ctrl+Shift+C/V` match, call `preventDefault`/`stopPropagation`, then dispatch
into a `commands` table with no `copy-selection`/`paste` entries — the chord is
swallowed. The clipboard plugin and capabilities are granted with zero call
sites. Fix: implement plan Task 26 handlers, or drop the bindings (and unused
plugin + permissions) from this slice.

### H2 — Windows Open Folder chord can never fire on real hardware

`src/open-board/open-board.tsx:407,429-437`. The handler switches on raw
`event.key`; physical `Ctrl+Shift+O` delivers `"O"`, so `case "o"` never
matches. The regression test passes only via a synthetic lowercase event
(`open-board.removal.test.tsx:232`). Fix: lowercase `event.key` (or route
through `matchBinding`) and send `key: "O"` in the shifted-chord test.

## Medium

### M1 — Dead `Ctrl+Shift+=` zoom-in binding

`src/terminal/action-registry.ts:716`. A physical `Ctrl+Shift+=` produces
`event.key === "+"`. The macOS map already works around this trap; bind
`{ key: "+", ctrl: true, shift: true }`.

### M2 — `kill_pty` failure path destroys retry state

`src-tauri/src/pty.rs:344-351`. The session is removed before
`terminate_session` can fail, and `?` on failure skips
`coordinator.unregister`. Violates spec §9 ("keep enough session state to
retry") at exactly the seam Windows Job Object teardown will plug into.

### M3 — Bundle-validator tests never run in CI

`package.json` excludes `scripts/verify-windows-bundle.test.mjs` from
`npm test` and no workflow step runs `node --test` for it. Add the step to the
`windows-check` job (delivery Task 32's verify command).

### M4 — Living docs stale on the new platform boundary

`docs/ARCHITECTURE.md` / `docs/CONTEXT.md` have no mention of the platform
module, `DesktopEnvironment`, dual keymaps, or the primary-modifier contract.
Delivery Task 35 covers this and remains outstanding (D9).

### M5 — Chrome UI restructuring lacks mandated screenshot approval

`src/ui/app.tsx` (`DesktopChrome`), `src/styles.css` (`.window--windows`,
`.deck-toolbar`). Spec §7.7 requires screenshot approval against
DESIGN-LANGUAGE at 1100×720 and 480×320 in both tab modes; no evidence exists
in the repo.

## Low

- **L1** — `src/open-board/open-board.tsx:88-94` fabricates a `KeyBinding` with
  `action: "new-tab"` purely for label formatting, disconnected from the real
  match logic in the same file.
- **L2** — `"unsupported"` platform silently receives the macOS keymap and Cmd
  labels while `hasPrimaryModifier` always returns false
  (`src/terminal/keymap.ts:31`, `src/lib/platform.ts:96-105`); displayed
  shortcuts can never fire. Needs an explicit decision.
- **L3** — `src-tauri/src/platform/unsupported.rs` has no tests; a green
  `windows-check` run structurally cannot detect "Windows can't spawn a shell".
- **L4** — latent double-throw in `initializeDesktopEnvironmentFromBackend`
  (`src/lib/platform.ts:92`): the catch-block fallback re-invokes
  `initializeDesktopEnvironment`, which re-throws "already initialized"
  unguarded on a second call. Single call site today.
- **L5** — `.deck-toolbar` uses `var(--bg)` where DESIGN-LANGUAGE assigns
  `--chrome-*` to bars/panels (`src/styles.css:97-99`); needs a DL ruling.

## Positives

- `platform/macos.rs` preserves prior `info.rs`/`pty.rs` semantics with tests
  carried over; macOS regression risk low (61/61 Rust tests).
- `src/lib/platform.ts` validates and freezes the environment before render and
  degrades to a logged fallback instead of crashing.
- Shared matcher lowercases keys and is protection-tested: bare
  `Ctrl+C/D/W/K/F/O` stay unbound; menu generation pinned to `MACOS_KEYMAP`.
- Config split matches spec §7.8 (NSIS-only Windows bundle, WebView2
  `downloadBootstrapper`, de-macified base description).
- `verify-windows-bundle.mjs` is a tight, side-effect-free validator with real
  fixture tests.

## Status at checkpoint

Checkpointed with all findings unfixed; fixes deferred deliberately. A separate
agent is implementing the missing Windows runtime (implementation Tasks 5+) in
an isolated worktree; H2/M1/M2 overlap its seams and should be fixed in or
after that merge, not in parallel. Re-run the full review on the unified tree
before any release decision.
