# Stackgrid — UI redesign: tab bar, status bar, chrome refresh

**Date:** 2026-07-03
**Status:** Approved direction (visual demo signed off); spec pending user review

## Context

Stackgrid currently has a 46px icon sidebar (left/top), a settings panel that pushes
the terminal area, and a single split-tree of panes. The user approved a Warp-style
redesign via an interactive localhost demo (`stackgrid-demo.html`, reviewed 2026-07-03):

- **Tab bar** on top — tabs on the left, all action buttons merged on the right.
  The sidebar is removed entirely.
- **Status bar** at the bottom.
- **Flat chrome** — no box-shadows anywhere; active tab is indicated by background
  color only (user feedback during review).
- **Multi-session tabs** — each tab owns its own split tree and PTY sessions.
- **Persistence** — tab/split structure is restored on launch (shells restart fresh).

Out of scope (explicitly deferred): command palette, tab rename, tab drag-reorder.

## 1. Layout & visual design

### Window shell

CSS grid, 3 rows: tab bar (44px) / terminal stage / status bar (28px).

macOS window chrome: `titleBarStyle: "Overlay"` + `hiddenTitle: true` in
`tauri.conf.json` so the native traffic lights float over the tab bar (the demo used
fake ones). The tab bar carries `data-tauri-drag-region` and reserves ~80px left
padding for the traffic lights. Buttons/tabs inside it must not be drag regions.

### Chrome tones

All chrome colors derive from the active terminal theme via `color-mix` (same
approach as today, extended). CSS vars set from JS on theme change: `--bg`, `--fg`,
`--accent`, plus the theme's `magenta/green/cyan/red/yellow` for agent dots and
status accents. Derived (in CSS): `--chrome-1` (bars), `--chrome-2` (panel),
`--hair`/`--hair-strong` (borders), `--text-muted`/`--text-faint`.

**Flat design rule: no `box-shadow` in any chrome CSS.** Depth comes from
background steps and 1px hairline borders only.

### Tab bar

- Tab item: agent dot + label + close `×` (visible on hover/active).
  - Active tab: lighter background (`color-mix(bg 55%, white)`), no other indicator.
  - Dot color by detected foreground process: `claude` → magenta, `codex` → green,
    `gemini` → cyan, anything else → faint gray.
  - Label = detected foreground process name (`zsh`, `claude`, …), auto-updating.
- `+` button after the tabs → new tab.
- Right-side action cluster: split vertical, split horizontal, close pane,
  separator, theme swatch (conic gradient button; click cycles theme presets),
  settings gear (active state while panel is open).

### Terminal stage

- 8px padding; panes are rounded (10px), 1px hairline border, terminal background
  slightly darker than chrome.
- Active pane (only when >1 pane): border switches to accent tint. No glow.
- Per-pane header bar: colored process dot, `cwd` (mono font), process badge on the
  right (accent tint for known agents, green tint for plain shell).
- Split dividers: keep current drag-resize behavior; hairline color, accent on
  hover/drag.

### Status bar

Mono font, 11px. Segments separated by hairline dividers.

- Left: git branch of active pane's cwd (green dot + name; hidden when not a repo)
  · active pane cwd · active agent name (accent color).
- Right: pane count of active tab · theme name · shortcut hints
  (`split ⌘D · new tab ⌘T` as small kbd chips).

### Settings panel

Slide-over anchored to the right edge of the stage (overlays terminals, does not
push them), rounded, hairline border, spring-ish ease-out transition. Sections:

1. **Theme** — 2-column grid of preset chips (background swatch outlined with the
   preset accent + label). Replaces the `<select>`.
2. **Font** — existing `FontSelect` + size stepper (unchanged behavior).
3. **Colors** — existing per-color override `ColorField` rows (unchanged behavior).
4. **Tabs** — "Restore on launch" On/Off segmented toggle.

The "Sidebar position" section is removed. "Restore defaults" footer stays.

## 2. Architecture

### Frontend

Current: one `TerminalManager` owning one split tree, panes map, window-level
shortcut listener. New shape:

- **`src/terminal/terminal-manager.ts`** (refactored, per-tab unit)
  - Loses its window `keydown` listener (moves up to the tab manager; integrates
    with `keymap.ts` from the 2026-07-02 keymap spec by extending `ShortcutAction`).
  - Keeps: pane spawn/close/split/respawn, render, PTY event routing (each manager
    ignores pane ids it does not own — managers share the global `pty:output`
    listener via the tab manager instead of each subscribing).
  - New methods: `show()` / `hide()` (toggle its container's `display`, refit +
    focus on show), `serializeLayout(): SerializedNode`,
    `initFromLayout(layout)` (spawns one PTY per leaf, restores ratios).
- **`src/terminal/tab-manager.ts`** (new)
  - Owns `tabs: TabState[]` + `activeTabId`, exposed to UI as signals
    (`tabs`, `activeTab`) from a small `src/terminal/tabs-store.ts`.
  - One container `<div class="tab-stage">` per tab inside the stage; only the
    active one is visible (`display: none` for the rest — xterm instances and PTYs
    stay alive in background tabs).
  - Registers the single window `keydown` listener; pane actions are forwarded to
    the active tab's manager, tab actions handled locally.
  - Subscribes once to `pty:output` / `pty:exit` and routes payloads to the owning
    tab's manager (session id → tab index map).
  - Persists/restores session structure (see §3).
- **UI components**
  - `src/ui/tab-bar.tsx` (new) — renders from tab signals; delete `sidebar.tsx`.
  - `src/ui/status-bar.tsx` (new) — renders from a `session-info` signal (see
    polling below).
  - `src/ui/app.tsx` — new grid layout; settings panel becomes an overlay inside
    the stage.
- **`src/lib/split-tree.ts`** — add pure `serializeTree(tree)` /
  layout shape for restore: `{type:"split", direction, ratio, first, second}` |
  `{type:"leaf"}` (leaf pane ids are not persisted).

### Backend (Rust, `src-tauri/src/pty.rs`)

Two new commands:

- `pty_info(ids: Vec<u32>) -> Vec<PtyInfo>` where
  `PtyInfo { id, cwd: Option<String>, process: Option<String> }`.
  Foreground process of each PTY (macOS: `tcgetpgrp` on the master fd → pgid, then
  `libproc` for name + cwd via `PROC_PIDVNODEPATHINFO`). Falls back to the spawned
  child pid when the fg lookup fails; any error → `None` fields, never an `Err`
  that would break the polling loop.
- `git_branch(cwd: String) -> Option<String>` — runs
  `git -C <cwd> rev-parse --abbrev-ref HEAD` (std::process, no shell); non-zero
  exit or non-repo → `None`.

### Info polling (frontend)

Every 2s (single `setInterval` in tab-manager): call `pty_info` with — the active
pane id of every tab (for tab dots/labels) + all pane ids of the active tab (for
pane header bars). Then `git_branch` for the active pane's cwd only, skipped when
cwd is unchanged since the last poll. Results land in a signal consumed by tab bar,
pane headers, and status bar. Poll failures are logged once and skipped — UI keeps
the last known values.

## 3. Persistence

- **`settings.json`** — remove `sidebarPosition` (validation simply drops it);
  add `restoreTabs: boolean` (default `true`).
- **`session.json`** (new `tauri-plugin-store` file):

```json
{
  "version": 1,
  "activeTab": 0,
  "tabs": [
    {
      "layout": {
        "type": "split",
        "direction": "row",
        "ratio": 0.5,
        "first": { "type": "leaf" },
        "second": { "type": "leaf" }
      }
    }
  ]
}
```

- Saved debounced (500ms) after any structural change: tab create/close/switch,
  pane split/close, divider ratio commit.
- On launch: `restoreTabs` on + valid file → rebuild tabs (fresh shell per leaf);
  anything invalid/corrupt → single fresh tab + `console.warn`. Version mismatch →
  discard.

## 4. Keyboard shortcuts

Extends `DEFAULT_KEYMAP` from the keymap spec with new `ShortcutAction` values.
Existing pane bindings unchanged (⌘D, ⌘⇧D, ⌘⇧W, ⌘], ⌘[).

| Keys      | Action                                               |
| --------- | ---------------------------------------------------- |
| ⌘T        | `new-tab`                                            |
| ⌘W        | `close-tab` (kills all PTYs in the tab)              |
| ⌘⇧] / ⌘⇧[ | `next-tab` / `prev-tab` (wraps)                      |
| ⌘1 … ⌘9   | `select-tab-n` (no-op when the index does not exist) |

Closing the last remaining tab replaces it with a fresh tab — the app never shows
zero tabs (app quit itself is covered by the 2026-07-02 quit-confirm spec).

## 5. Error handling

- New-tab / split spawn failure → error line written into the currently active
  pane (existing pattern); tab list unchanged.
- `pty_info` / `git_branch` failures → segments render from last known values or
  hide (git segment); polling loop never throws.
- Corrupt `session.json` → fresh single tab, warning logged.
- A PTY exit in a background tab follows existing rules within that tab (auto-close
  pane, or "press Enter to restart" when it is the tab's last pane).

## 6. Testing

- Unit (pure, no DOM): `serializeTree`/restore round-trip incl. ratios;
  `session.json` validation (corrupt/missing/version-mismatch cases); keymap
  matching for the new bindings.
- Manual eye-check on `npm run tauri dev` (per frontend-design-bar): tab
  create/close/switch/restore flows, theme cycling across all 4 presets, settings
  panel overlay, traffic-light overlay spacing, status bar values while `claude`
  runs in one pane and plain `zsh` in another.

## Open follow-ups (not in this spec)

Command palette (⌘K), tab rename, tab drag-reorder, Linux/Windows title-bar
treatment (overlay config is macOS-only; other platforms keep native decorations
for now).
