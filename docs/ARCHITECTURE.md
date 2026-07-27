> Generated from `~/.claude/templates/ARCHITECTURE.template.md` — LIVING doc, update in place (D1).

# SpaceVibe Deck — architecture

A macOS desktop terminal (Tauri 2) for running many AI agent CLIs side by side: Rust owns PTYs, windows and the native menu; a Preact + xterm.js frontend renders panes, tabs and the workspace board.

## Modules and boundaries

| Module                                                                                                                        | Responsibility                                               | In           | Out         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------ | ----------- |
| [src-tauri/src/pty.rs](../src-tauri/src/pty.rs) `current`                                                                     | PTY spawn/IO for agent CLIs                                  | commands     | shell procs |
| [src-tauri/src/coordinator.rs](../src-tauri/src/coordinator.rs) `current`                                                     | window/pane coordination (load-bearing seam)                 | frontend     | windows     |
| [src-tauri/src/menu.rs](../src-tauri/src/menu.rs) `current` + [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current` | native menu — generated, edit the registry                   | build script | macOS menu  |
| [src-tauri/src/migrate.rs](../src-tauri/src/migrate.rs) `current`                                                             | settings carry-over from the Stackgrid bundle id             | first launch | app dirs    |
| [src/terminal/](../src/terminal) `current`                                                                                    | xterm.js panes                                               | chrome       | Tauri IPC   |
| [src/chrome/](../src/chrome) `current`                                                                                        | window chrome, tabs                                          | main         | terminal    |
| [src/open-board/](../src/open-board) `current`                                                                                | workspace board: open, recents, workspaces store             | chrome       | lib         |
| [src/settings/](../src/settings) `current` + [src/presets/](../src/presets) `current`                                         | settings UI/stores, layout presets                           | chrome       | lib         |
| [marketing/](../marketing) `current`                                                                                          | marketing video stage — shares app components, virtual clock | video:render | dist        |

## Main flows

1. Open a pane → frontend asks Rust to spawn a PTY ([pty.rs](../src-tauri/src/pty.rs) `current`) → output streams into an xterm.js pane ([src/terminal/](../src/terminal) `current`).
2. Window/pane lifecycle (split, move, close) goes through the coordinator ([coordinator.rs](../src-tauri/src/coordinator.rs) `current`); state lives in window-scoped Preact signal stores.
3. Workspace board ([open-board.tsx](../src/open-board/open-board.tsx) `current`) lists workspaces/recents ([workspace-recents.ts](../src/lib/workspace-recents.ts) `current`); existence checks mirror input order.
4. Chrome UI styling is governed by the numbered DL rulebook ([DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) `current`), cited from code comments.

## Standing architecture decisions

- English only across strings/comments/docs — [AGENTS.md](../AGENTS.md) `current`.
- ADR pipeline removed 2026-07-27; decisions now live in dated specs/plans — [CONTEXT.md](CONTEXT.md) `current`.
- Menu is generated from a registry, never hand-edited — CI runs `generate:menu:check` — [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current`.
- Overlay guard ranks overlays by z-order — `pane`(0) < `settings`(20) < `board`(30) < `modal`(40) — and blocks an action while any open overlay's rank is `>=` its own tier; `>=` (not `>`) is deliberate so two `modal`-tier overlays exclude each other with no extra concept needed — [OverlayTier/TIER_RANK](../src/terminal/action-registry.ts#L8-L37) `current`, [overlayBlocksAction](../src/terminal/tab-manager.ts#L907-L938) `current`.
- An action with a macOS menu item binds its webview shortcut by character (`CharKeyBinding`), matching how Cocoa accelerators are declared — binding by physical position instead would point menu and webview at different keys on a non-QWERTY layout. An action with no menu item uses `PhysicalKeyBinding` when the produced character depends on Shift/layout (a known QWERTZ bracket-key collision is documented in code) — [key-vs-code rule](../src/terminal/action-registry.ts#L365-L392) `current`.
- The macOS menu path can't tell an accelerator from a mouse click (Tauri's `MenuEvent` carries only an id), so only `destructive: true` actions (`close-pane`/`close-tab`/`clear-buffer`) are suppressed while a chrome text field holds the caret — every other action still runs there — [ActionDefinition.destructive](../src/terminal/action-registry.ts#L82-L115) `current`, [runAction](../src/terminal/tab-manager.ts#L1008-L1030) `current`.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

Empty — every `current` claim above checked with ls/grep on 2026-07-27. Do not remove this section (D7).
