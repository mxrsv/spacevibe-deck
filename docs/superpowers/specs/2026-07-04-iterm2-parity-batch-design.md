# iTerm2 Parity Batch — Design

**Date:** 2026-07-04
**Status:** Approved (design review by independent agent incorporated)

## Goal

Close the six highest-impact daily-driver gaps versus iTerm2/Terminal.app:

1. Search in scrollback (Cmd+F)
2. CWD inheritance for new splits and tabs
3. Confirm-close when a pane is running a process
4. Clear buffer (Cmd+K)
5. Directional pane navigation (Cmd+Option+Arrows)
6. Reopen closed tab (Cmd+Shift+T)

Plus one semantics change: Cmd+W closes the focused **pane** (iTerm2 convention), Cmd+Shift+W closes the **tab** — swapping the current mapping.

Approach: in-place, following existing patterns. Extend `DEFAULT_KEYMAP` and the `handleShortcut` switch; new logic goes into small dedicated files. No keybinding-customization infrastructure in this batch.

## 1. Keymap changes (`src/terminal/keymap.ts`)

| Key                  | Action                     | Note                                                        |
| -------------------- | -------------------------- | ----------------------------------------------------------- |
| `Cmd+W`              | `close-pane`               | Swapped. Last pane in tab → routes to close-tab (see below) |
| `Cmd+Shift+W`        | `close-tab`                | Swapped                                                     |
| `Cmd+F`              | `find`                     | New                                                         |
| `Cmd+K`              | `clear-buffer`             | New                                                         |
| `Cmd+Option+←/↑/↓/→` | `focus-left/up/down/right` | New; `Cmd+[` / `Cmd+]` cycle stays                          |
| `Cmd+Shift+T`        | `reopen-tab`               | New                                                         |

New actions join the `ShortcutAction` union; handled in the `tab-manager.ts` switch. No `menu.rs` change — the custom menu already leaves Cmd+W to the webview (`menu.rs:17-18`).

### Close routing (review finding — blocker)

Today, closing the last pane in a tab **respawns a fresh shell in place** (`terminal-manager.ts` `closePane` → `openInitialPane()`); it does not close the tab. The iTerm2 semantics therefore require explicit routing in `tab-manager.ts`:

```
close-pane action:
  if activeManager().paneCount() === 1 → treat as close-tab (below)
  else → busy-guard(active pane) → closeActive()

close-tab action:
  busy-guard(all panes in tab) → closeTab(active)
```

The routing decision (pane vs tab) happens **first**; the busy-guard runs **once** on the final target set, so exactly one dialog appears. The "never zero tabs" invariant in `closeTab` (last tab → fresh replacement tab) is unchanged.

## 2. Search in scrollback (Cmd+F)

- New dependency `@xterm/addon-search`; one `SearchAddon` per pane, loaded in `pane.ts`.
- New file `src/terminal/search-bar.ts`: floating bar in the top-right of the focused pane.
  - Text input; incremental search on input (case-insensitive, no regex).
  - Match counter "3/17" via `onDidChangeResults`.
  - Highlight all matches via search decorations. Note: `ISearchDecorationOptions` requires `matchOverviewRuler` and `activeMatchColorOverviewRuler` (non-optional) even though we have no overview ruler — pass theme-derived placeholder colors.
  - `Enter` = findNext, `Shift+Enter` = findPrevious, `Esc` = close, clear decorations, refocus terminal.
  - The bar's own keydown listener also handles `Cmd+F` (refocus/select-all) because the global `handleShortcut` guard skips events targeting inputs outside `.pane__term`.
- Opening the bar for a pane closes any bar open on another pane (one bar at a time).

## 3. CWD inheritance (splits + new tabs)

- `spawn_shell` (`pty.rs`) gains `cwd: Option<String>`. Rust side validates the path is an existing directory; invalid/missing → `$HOME` (current behavior).
- Signature threading (review finding): `spawnPane()` (`terminal-manager.ts`) gains an optional `cwd` param → `splitActive()` resolves the focused pane's cwd and passes it down; `newTab()` (`tab-manager.ts`) resolves the active pane's cwd before `addTab`.
- Freshness: immediately before spawn, call the existing `pty_info` command with just the focused pane's id (cheap single-id call) instead of using the 2s-stale polled cache. `null` cwd → `$HOME`.
- Reopen-tab (section 7) passes its stored cwd through the same parameter; session restore behavior is unchanged (`$HOME`) in this batch.

## 4. Confirm-close when busy

- New file `src/terminal/close-guard.ts`:
  - `SHELL_NAMES = ["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh"]` (foreground process names come from `proc_name` of the process-group leader; an idle shell reports e.g. `"zsh"`).
  - A pane is **busy** when its foreground process is non-null and not in `SHELL_NAMES`. A pane in the "session ended" limbo state has no process → not busy.
  - `confirmClose(paneIds)`: fetches **fresh** `pty_info` for the target panes (closes the 2s poll false-negative window — e.g. `claude` launched moments before Cmd+W), computes busy set, and if non-empty shows one native `ask()` dialog (same pattern as `quit-guard.ts`): single pane → _"claude is still running. Close anyway?"_; multiple → lists process names. Returns whether to proceed.
- Wired into the close routing of section 1 only. Natural shell exit (`handleExit`) never prompts. Dialog error → do not close (fail safe).
- Out of scope, noted for a later batch: reusing `close-guard` so `quit-guard` only prompts when something is busy.

## 5. Clear buffer (Cmd+K)

`term.clear()` on the active pane (keeps the current prompt line, drops scrollback). One switch case; no new files.

## 6. Directional pane navigation

- New file `src/lib/pane-geometry.ts` (pure, unit-tested): given `{id, rect}` entries and the active pane id, return the nearest pane in a direction (edge-center distance; overlap on the perpendicular axis preferred).
- `terminal-manager.ts` gains `focusDirection(dir)`: builds rects from pane elements, calls the pure function, and — review finding — routes the result through the existing `setActive()` so zoom-mode restore (`unzoom`), active-class updates, and ratio side effects are inherited rather than re-derived. No pane in that direction → no-op.

## 7. Reopen closed tab (Cmd+Shift+T)

- In-memory stack in `tab-manager.ts`, max 10 entries, not persisted across restarts.
- Snapshot shape (review finding — layout serialization intentionally drops pane ids/cwd):

```ts
interface ClosedTabSnapshot {
  readonly layout: SerializedNode; // structure + ratios
  readonly name: string | null; // override, if any
  readonly dotColor: string | null; // override, if any
  readonly cwds: readonly (string | null)[]; // per pane, leafIds() order
}
```

`cwds` is captured by zipping `leafIds(tree)` against the polled `infoByPane` cwd map; `treeFromLayout` consumes pane ids in the same left-to-right pre-order, so the arrays line up on restore.

- Capture ordering (review finding — major): the snapshot is built at the **top of `closeTab()`**, before `entry.manager.dispose()` and before `overrides.delete(entry.key)`. Reading layout after dispose only works incidentally today and is not a contract.
- `reopen-tab` pops the stack → creates a tab with the saved layout/name/color; each pane spawns a fresh shell at its saved cwd (via section 3). Scrollback is not restored (impossible after PTY death — accepted). Empty stack → no-op. The reopened tab gets a fresh tab key from `nextKey`; overrides are re-registered under the new key.
- Every `closeTab()` pushes a snapshot regardless of trigger (Cmd+Shift+W, Cmd+W on a single-pane tab, tab-bar close button), including the "last tab replaced by fresh tab" case.

## Error handling

- Deleted/invalid cwd → `$HOME` fallback (Rust side).
- `ask()` dialog failure → do not close.
- Search on empty buffer → "0/0", navigation no-ops.
- `pty_info` failure before spawn/close → treat as `null` cwd / not busy (matches existing degrade-to-None contract of `pty_info`).

## Testing

Vitest unit tests, following existing patterns:

- `keymap.test.ts`: new bindings, swapped Cmd+W/Cmd+Shift+W expectations.
- `pane-geometry.test.ts`: nearest-in-direction across grid layouts, no-candidate cases.
- `close-guard.test.ts`: busy detection (shell names, agents, null process, limbo pane).
- `tabs-store`/snapshot tests: `ClosedTabSnapshot` capture order (`leafIds` zip), stack cap at 10, reopened tab gets a fresh key.

Manual verification: search highlight rendering on the DOM renderer, dialog flows, zoom + directional focus interaction, Vietnamese IME unaffected (arrow keys don't compose).

## Explicit non-goals (this batch)

Keybinding customization UI, persisting the reopen stack, quit-guard busy-awareness, scrollback restore, right-click menu, copy-on-select, bell/activity indicators.
