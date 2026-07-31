> Generated from `~/.claude/templates/ARCHITECTURE.template.md` — LIVING doc, update in place (D1).

# SpaceVibe Deck — architecture

A desktop terminal (Tauri 2) for running many AI agent CLIs side by side:
Rust owns PTYs and native platform integration; a Preact + xterm.js frontend
renders panes, tabs and the workspace board. macOS is the current public
release; Windows 11 x64 is an engineering preview whose runtime gates remain
open ([macOS release workflow](../.github/workflows/release.yml) `current`,
[Windows spec](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).

## Modules and boundaries

| Module                                                                                                                        | Responsibility                                               | In           | Out         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------ | ----------- |
| [src-tauri/src/pty.rs](../src-tauri/src/pty.rs) `current`                                                                     | PTY spawn/IO for agent CLIs                                  | commands     | shell procs |
| [src-tauri/src/coordinator.rs](../src-tauri/src/coordinator.rs) `current`                                                     | window/pane coordination (load-bearing seam)                 | frontend     | windows     |
| [src-tauri/src/menu.rs](../src-tauri/src/menu.rs) `current` + [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current` | native menu — generated, edit the registry                   | build script | macOS menu  |
| [src-tauri/src/migrate.rs](../src-tauri/src/migrate.rs) `current`                                                             | settings carry-over from the Stackgrid bundle id             | first launch | app dirs    |
| [src-tauri/src/platform/](../src-tauri/src/platform) `current`                                                               | platform shell, home, discovery and process lifecycle        | PTY state    | OS APIs     |
| [src-tauri/src/info.rs](../src-tauri/src/info.rs#L10-L34) `current`                                                          | explicit pane CWD/process kind/agent truth                    | PTY sessions | frontend    |
| [src-tauri/tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`                                          | native Windows chrome, WebView2 and NSIS-only bundle config   | Tauri build  | Windows app |
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
5. Windows shell creation prefers PowerShell 7, falls back to Windows
   PowerShell, and adds only session-local prompt/CWD integration
   ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L84-L113) `current`).
6. Each Windows pane owns a kill-on-close Job Object; one WMI snapshot maps
   descendants into `idle-shell`, `agent`, `busy`, or `unknown`
   ([session ownership](../src-tauri/src/platform/windows/mod.rs#L26-L41) `current`,
   [process mapping](../src-tauri/src/info.rs#L111-L165) `current`).
7. Terminal links send structured editor intent. Windows validates canonical
   paths, parses custom templates as argv, rejects shell syntax, and launches
   the executable directly
   ([links.rs](../src-tauri/src/links.rs#L187-L314) `current`).
8. The initialized desktop environment selects the platform keymap, visible
   labels, pointer modifier, and Windows clipboard chords. The chords dispatch
   through the shared action path, not a pane-local handler
   ([platform.ts](../src/lib/platform.ts#L76-L107) `current`,
   [WINDOWS_KEYMAP](../src/terminal/action-registry.ts#L670-L736) `current`,
   [commands table](../src/terminal/tab-manager.ts#L946-L1024) `current`,
   [Pane clipboard](../src/terminal/pane.ts#L332-L337) `current`,
   [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`).

## Standing architecture decisions

- English only across strings/comments/docs — [AGENTS.md](../AGENTS.md) `current`.
- ADR pipeline removed 2026-07-27; decisions now live in dated specs/plans — [CONTEXT.md](CONTEXT.md) `current`.
- Menu is generated from a registry, never hand-edited — CI runs `generate:menu:check` — [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current`.
- Overlay guard ranks overlays by z-order — `pane`(0) < `settings`(20) < `board`(30) < `modal`(40) — and blocks an action while any open overlay's rank is `>=` its own tier; `>=` (not `>`) is deliberate so two `modal`-tier overlays exclude each other with no extra concept needed — [OverlayTier/TIER_RANK](../src/terminal/action-registry.ts#L8-L37) `current`, [overlayBlocksAction](../src/terminal/tab-manager.ts#L931-L962) `current`.
- Action identity and scope are shared, but macOS and Windows keymaps are
  separate. Cocoa menu generation reads only the macOS map; the Windows map
  preserves bare Ctrl terminal controls, and its copy/paste chords resolve to
  real dispatch targets in the shared `commands` table — paste goes through
  xterm's `Terminal.paste()` so bracketed paste and CRLF normalization apply
  ([platform keymaps](../src/terminal/action-registry.ts#L513-L736) `current`,
  [commands table](../src/terminal/tab-manager.ts#L946-L1024) `current`,
  [menu generator](../scripts/generate-menu.ts) `current`).
- The macOS menu path can't tell an accelerator from a mouse click (Tauri's `MenuEvent` carries only an id), so only `destructive: true` actions (`close-pane`/`close-tab`/`clear-buffer`) are suppressed while a chrome text field holds the caret — every other action still runs there — [ActionDefinition.destructive](../src/terminal/action-registry.ts#L82-L115) `current`, [runAction](../src/terminal/tab-manager.ts#L1032-L1054) `current`.
- Windows uses native decorated system chrome; Preact renders only Deck's
  internal toolbar and omits synthetic minimize/maximize/close controls
  ([tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Pull requests compile the Windows desktop without bundling. An authorized
  manual run may build one unsigned NSIS setup and upload it for seven days,
  but the job fails before bundling unless the repository is private
  ([ci.yml](../.github/workflows/ci.yml#L65-L159) `current`). The tagged macOS
  release workflow is separate and unchanged
  ([release.yml](../.github/workflows/release.yml) `current`).

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

Empty — every `current` source/config claim above was checked on 2026-07-29.
Unpassed Windows delivery gates are tracked in
[CONTEXT.md](CONTEXT.md#windows-engineering-preview--2026-07-29) `current`.
Do not remove this section (D7).
