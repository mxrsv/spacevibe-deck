# iTerm2 Parity Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six daily-driver gaps vs iTerm2: search in scrollback (Cmd+F), CWD inheritance for splits/tabs, confirm-close when busy, clear buffer (Cmd+K), directional pane navigation (Cmd+Option+Arrows), reopen closed tab (Cmd+Shift+T) — plus swapping Cmd+W (close pane) / Cmd+Shift+W (close tab).

**Architecture:** In-place extension of the existing pattern: new actions join `ShortcutAction` + `DEFAULT_KEYMAP`, handled in `tab-manager.ts`'s switch. New logic lives in small dedicated files (`close-guard.ts`, `search-bar.ts`, `pane-info.ts`, `closed-tabs.ts`, `lib/pane-geometry.ts`). Rust side gains one optional `cwd` param on `spawn_shell`.

**Tech Stack:** TypeScript + Preact signals (frontend), xterm 6 (`@xterm/xterm@^6.0.0`), new dep `@xterm/addon-search@^0.16.0`, Tauri v2 (Rust backend), Vitest for unit tests, `cargo test` for Rust.

**Spec:** `docs/superpowers/specs/2026-07-04-iterm2-parity-batch-design.md`

## Global Constraints

- All user-facing strings, code comments, and docs in **English** (project rule).
- Immutability: never mutate shared objects/arrays; return new copies (existing codebase style — see `split-tree.ts`).
- Files focused and small; follow existing file/naming conventions (`kebab-case.ts`, factory functions returning interface objects).
- macOS is the primary target (`meta` = Cmd).
- No keybinding-customization infrastructure in this batch.
- Reopen stack: in-memory only, **max 10 entries**, not persisted.
- Busy shell allowlist exactly: `"zsh", "bash", "fish", "sh", "dash", "nu", "pwsh"`.
- Search: case-insensitive, no regex, one bar open at a time.
- Verification commands: `npm test` (Vitest), `npm run build` (tsc + vite), `cargo test` (run inside `src-tauri/`). Run all applicable ones before each commit.
- Commit after every task; commit messages in imperative mood (`feat: …`, `test: …`), matching existing history.
- All paths below are relative to the `stackgrid/` project root.

## File Map (what gets created/modified)

| File                               | Change                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `src/terminal/keymap.ts`           | New actions + swapped/new bindings                                               |
| `src/terminal/keymap.test.ts`      | Updated + new binding tests                                                      |
| `src/terminal/pane.ts`             | `clear()` method; `SearchAddon` loaded + exposed                                 |
| `src/terminal/terminal-manager.ts` | `clearActive`, `focusDirection`, `openSearch`, cwd threading, search-bar cleanup |
| `src/terminal/tab-manager.ts`      | New switch cases, guarded close routing, reopen stack, cwd for new tabs          |
| `src/terminal/pane-info.ts`        | **New** — fresh single-shot `pty_info` helpers                                   |
| `src/terminal/close-guard.ts`      | **New** — busy detection + confirm dialog                                        |
| `src/terminal/close-guard.test.ts` | **New** — busy detection tests                                                   |
| `src/terminal/closed-tabs.ts`      | **New** — pure snapshot stack + cwd capture                                      |
| `src/terminal/closed-tabs.test.ts` | **New** — stack/zip tests                                                        |
| `src/terminal/search-bar.ts`       | **New** — floating search UI                                                     |
| `src/terminal/search-bar.test.ts`  | **New** — pure formatter test                                                    |
| `src/lib/pane-geometry.ts`         | **New** — pure nearest-in-direction                                              |
| `src/lib/pane-geometry.test.ts`    | **New** — geometry tests                                                         |
| `src/ui/tab-bar.tsx`               | Close-pane button tooltip ⌘⇧W → ⌘W                                               |
| `src/styles.css`                   | `.search-bar` styles                                                             |
| `src-tauri/src/pty.rs`             | `spawn_shell` gains `cwd: Option<String>` + `resolve_spawn_cwd` helper + tests   |
| `package.json`                     | `@xterm/addon-search@^0.16.0`                                                    |

Dependency order: Task 1 (keymap) unblocks 2, 4, 8, 9, 10. Task 5 (Rust cwd) unblocks 6. Task 6 unblocks 9. Task 7 unblocks 8. Task 3 unblocks 4. Tasks 2, 3, 5 are independent starters.

**Interim-behavior note:** after Task 1 the Cmd+W/Cmd+Shift+W swap is live but the last-pane→close-tab routing and busy guard only land in Task 8. In between, Cmd+W on a single-pane tab respawns a fresh shell (today's `closePane` behavior). The app stays fully usable at every commit.

---

### Task 1: Keymap — new actions + swapped close bindings

**Files:**

- Modify: `src/terminal/keymap.ts`
- Test: `src/terminal/keymap.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `ShortcutAction` union gains `"find" | "clear-buffer" | "focus-left" | "focus-right" | "focus-up" | "focus-down" | "reopen-tab"`. `DEFAULT_KEYMAP` swaps: Cmd+W → `close-pane`, Cmd+Shift+W → `close-tab`. Later tasks add switch cases for the new actions.

- [ ] **Step 1: Update the failing tests**

In `src/terminal/keymap.test.ts`, change the two existing expectations that pin the old close mappings, and add a new describe block. Replace inside `"keeps the existing pane bindings"`:

```ts
// Swapped to iTerm2 convention: Cmd+W closes the pane
expect(matchBinding(keyEvent("w", { metaKey: true }))).toBe("close-pane");
```

(remove the old `Cmd+Shift+W → close-pane` line from that test), and inside `"matches the new tab bindings"` replace the `close-tab` line with:

```ts
expect(matchBinding(keyEvent("w", { metaKey: true, shiftKey: true }))).toBe(
  "close-tab",
);
```

Then add at the end of the `matchBinding` describe:

```ts
it("matches the iTerm2-parity batch bindings", () => {
  expect(matchBinding(keyEvent("f", { metaKey: true }))).toBe("find");
  expect(matchBinding(keyEvent("k", { metaKey: true }))).toBe("clear-buffer");
  expect(matchBinding(keyEvent("t", { metaKey: true, shiftKey: true }))).toBe(
    "reopen-tab",
  );
});

it("matches Cmd+Option+Arrows to directional focus", () => {
  const mods = { metaKey: true, altKey: true };
  expect(matchBinding(keyEvent("ArrowLeft", mods))).toBe("focus-left");
  expect(matchBinding(keyEvent("ArrowRight", mods))).toBe("focus-right");
  expect(matchBinding(keyEvent("ArrowUp", mods))).toBe("focus-up");
  expect(matchBinding(keyEvent("ArrowDown", mods))).toBe("focus-down");
});

it("does not match arrows without both Cmd and Option", () => {
  expect(matchBinding(keyEvent("ArrowLeft", { metaKey: true }))).toBeNull();
  expect(matchBinding(keyEvent("ArrowLeft", { altKey: true }))).toBeNull();
  expect(matchBinding(keyEvent("ArrowLeft"))).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- keymap`
Expected: FAIL — swapped `close-pane`/`close-tab` expectations and new-action tests fail (actions don't exist yet).

- [ ] **Step 3: Implement keymap changes**

In `src/terminal/keymap.ts`, extend the union (after `"toggle-zoom-pane"`, before the template-literal member):

```ts
  | "toggle-zoom-pane"
  | "find"
  | "clear-buffer"
  | "focus-left"
  | "focus-right"
  | "focus-up"
  | "focus-down"
  | "reopen-tab"
  | `select-tab-${number}`;
```

In `DEFAULT_KEYMAP`, swap the two close bindings (iTerm2 convention) and add the new ones:

```ts
  // iTerm2 convention: Cmd+W closes the pane, Cmd+Shift+W the whole tab
  { key: "w", meta: true, action: "close-pane" },
  { key: "w", meta: true, shift: true, action: "close-tab" },
```

(replace the old `{ key: "w", meta: true, shift: true, action: "close-pane" }` and `{ key: "w", meta: true, action: "close-tab" }` lines), then append before `...TAB_SELECT_BINDINGS`:

```ts
  { key: "f", meta: true, action: "find" },
  { key: "k", meta: true, action: "clear-buffer" },
  { key: "t", meta: true, shift: true, action: "reopen-tab" },
  // event.key for arrows is "ArrowLeft" etc. — lowercased by matchBinding
  { key: "arrowleft", meta: true, alt: true, action: "focus-left" },
  { key: "arrowright", meta: true, alt: true, action: "focus-right" },
  { key: "arrowup", meta: true, alt: true, action: "focus-up" },
  { key: "arrowdown", meta: true, alt: true, action: "focus-down" },
```

No `handleShortcut` switch changes in this task — unmatched new actions fall through the switch as no-ops (`preventDefault` still fires, which is correct: the key is reserved now).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` then `npm run build`
Expected: all tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/keymap.ts src/terminal/keymap.test.ts
git commit -m "feat: swap Cmd+W/Cmd+Shift+W and reserve iTerm2-parity shortcuts"
```

---

### Task 2: Clear buffer (Cmd+K)

**Files:**

- Modify: `src/terminal/pane.ts`
- Modify: `src/terminal/terminal-manager.ts`
- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**

- Consumes: `"clear-buffer"` action from Task 1.
- Produces: `Pane.clear(): void`, `TerminalManager.clearActive(): void`.

- [ ] **Step 1: Add `clear()` to Pane**

In `src/terminal/pane.ts`, add to the `Pane` interface after `fit(): void;`:

```ts
  /** Drop scrollback and keep only the current prompt line (Cmd+K). */
  clear(): void;
```

and to the returned object after `fit,`:

```ts
    clear: () => term.clear(),
```

- [ ] **Step 2: Add `clearActive()` to TerminalManager**

In `src/terminal/terminal-manager.ts`, add to the `TerminalManager` interface after `focusActive(): void;`:

```ts
  /** Clear the active pane's buffer, keeping the prompt line (Cmd+K). */
  clearActive(): void;
```

and to the returned object after `focusActive() { … },`:

```ts
    clearActive() {
      if (activeId !== null) {
        panes.get(activeId)?.clear();
      }
    },
```

- [ ] **Step 3: Wire the switch case**

In `src/terminal/tab-manager.ts`, add to the `handleShortcut` switch (after the `"toggle-zoom-pane"` case):

```ts
      case "clear-buffer":
        activeManager()?.clearActive();
        break;
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: PASS (no new unit tests — thin delegation to `term.clear()`).
Manual: `npm run tauri dev` → produce output (`ls -la` a few times), press Cmd+K → screen clears to the prompt line, scrollback gone (scroll up shows nothing).

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane.ts src/terminal/terminal-manager.ts src/terminal/tab-manager.ts
git commit -m "feat: clear active pane buffer with Cmd+K"
```

---

### Task 3: Pane geometry — pure nearest-in-direction module

**Files:**

- Create: `src/lib/pane-geometry.ts`
- Test: `src/lib/pane-geometry.test.ts`

**Interfaces:**

- Consumes: nothing (pure module, no imports).
- Produces: `type FocusDirection = "left" | "right" | "up" | "down"`, `interface PaneRect { id, left, top, right, bottom }`, `nearestInDirection(panes: readonly PaneRect[], activeId: number, dir: FocusDirection): number | null`. Task 4 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/pane-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nearestInDirection, type PaneRect } from "./pane-geometry";

function rect(
  id: number,
  left: number,
  top: number,
  width: number,
  height: number,
): PaneRect {
  return { id, left, top, right: left + width, bottom: top + height };
}

// 2x2 grid with 8px divider gaps:
//  1 | 2
//  --+--
//  3 | 4
const GRID: PaneRect[] = [
  rect(1, 0, 0, 100, 100),
  rect(2, 108, 0, 100, 100),
  rect(3, 0, 108, 100, 100),
  rect(4, 108, 108, 100, 100),
];

describe("nearestInDirection", () => {
  it("moves along both axes in a 2x2 grid", () => {
    expect(nearestInDirection(GRID, 1, "right")).toBe(2);
    expect(nearestInDirection(GRID, 2, "left")).toBe(1);
    expect(nearestInDirection(GRID, 1, "down")).toBe(3);
    expect(nearestInDirection(GRID, 4, "up")).toBe(2);
  });

  it("returns null when no pane lies in that direction", () => {
    expect(nearestInDirection(GRID, 1, "left")).toBeNull();
    expect(nearestInDirection(GRID, 1, "up")).toBeNull();
    expect(nearestInDirection(GRID, 4, "right")).toBeNull();
    expect(nearestInDirection(GRID, 4, "down")).toBeNull();
  });

  it("prefers a pane overlapping on the perpendicular axis", () => {
    // Active 1 (tall left pane); 2 overlaps vertically, 3 does not.
    // 3's facing edge is nearer, but 2 must win on overlap.
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 300),
      rect(2, 400, 100, 100, 100),
      rect(3, 108, 400, 100, 100),
    ];
    expect(nearestInDirection(panes, 1, "right")).toBe(2);
  });

  it("falls back to non-overlapping candidates when none overlap", () => {
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 100),
      rect(2, 108, 200, 100, 100), // below-right, no vertical overlap
    ];
    expect(nearestInDirection(panes, 1, "right")).toBe(2);
  });

  it("picks the nearest of several overlapping candidates", () => {
    const panes: PaneRect[] = [
      rect(1, 0, 0, 100, 100),
      rect(2, 108, 0, 100, 100),
      rect(3, 216, 0, 100, 100),
    ];
    expect(nearestInDirection(panes, 1, "right")).toBe(2);
    expect(nearestInDirection(panes, 3, "left")).toBe(2);
  });

  it("returns null for an unknown active id or single pane", () => {
    expect(nearestInDirection(GRID, 99, "right")).toBeNull();
    expect(
      nearestInDirection([rect(1, 0, 0, 100, 100)], 1, "right"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- pane-geometry`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/pane-geometry.ts`:

```ts
/**
 * Pure directional pane navigation: given pane bounding boxes and the
 * active pane, find the nearest pane in a direction. Candidates must lie
 * fully beyond the active pane's facing edge; panes overlapping the
 * active pane on the perpendicular axis are preferred, then the smallest
 * facing-edge-center distance wins.
 */

export type FocusDirection = "left" | "right" | "up" | "down";

export interface PaneRect {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

// Dividers leave small gaps between slots; treat near-touching edges as beyond.
const EDGE_TOLERANCE_PX = 1;

function isBeyond(
  active: PaneRect,
  other: PaneRect,
  dir: FocusDirection,
): boolean {
  switch (dir) {
    case "left":
      return other.right <= active.left + EDGE_TOLERANCE_PX;
    case "right":
      return other.left >= active.right - EDGE_TOLERANCE_PX;
    case "up":
      return other.bottom <= active.top + EDGE_TOLERANCE_PX;
    case "down":
      return other.top >= active.bottom - EDGE_TOLERANCE_PX;
  }
}

/** Overlap length on the axis perpendicular to the move direction. */
function perpendicularOverlap(
  a: PaneRect,
  b: PaneRect,
  dir: FocusDirection,
): number {
  return dir === "left" || dir === "right"
    ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    : Math.min(a.right, b.right) - Math.max(a.left, b.left);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Center of the edge of `r` facing in `dir`. */
function edgeCenter(r: PaneRect, dir: FocusDirection): Point {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  switch (dir) {
    case "left":
      return { x: r.left, y: cy };
    case "right":
      return { x: r.right, y: cy };
    case "up":
      return { x: cx, y: r.top };
    case "down":
      return { x: cx, y: r.bottom };
  }
}

const OPPOSITE: Readonly<Record<FocusDirection, FocusDirection>> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};

/** Distance between the active pane's facing edge and the candidate's near edge. */
function edgeCenterDistance(
  active: PaneRect,
  other: PaneRect,
  dir: FocusDirection,
): number {
  const from = edgeCenter(active, dir);
  const to = edgeCenter(other, OPPOSITE[dir]);
  return Math.hypot(from.x - to.x, from.y - to.y);
}

/** Id of the nearest pane in `dir`, or null when none qualifies. */
export function nearestInDirection(
  panes: readonly PaneRect[],
  activeId: number,
  dir: FocusDirection,
): number | null {
  const active = panes.find((pane) => pane.id === activeId);
  if (active === undefined) {
    return null;
  }
  const beyond = panes.filter(
    (pane) => pane.id !== activeId && isBeyond(active, pane, dir),
  );
  if (beyond.length === 0) {
    return null;
  }
  const overlapping = beyond.filter(
    (pane) => perpendicularOverlap(active, pane, dir) > 0,
  );
  const pool = overlapping.length > 0 ? overlapping : beyond;
  let best = pool[0];
  let bestDistance = edgeCenterDistance(active, best, dir);
  for (const pane of pool.slice(1)) {
    const distance = edgeCenterDistance(active, pane, dir);
    if (distance < bestDistance) {
      best = pane;
      bestDistance = distance;
    }
  }
  return best.id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- pane-geometry`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pane-geometry.ts src/lib/pane-geometry.test.ts
git commit -m "feat: pure nearest-in-direction pane geometry"
```

---

### Task 4: Directional focus wiring (Cmd+Option+Arrows)

**Files:**

- Modify: `src/terminal/terminal-manager.ts`
- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**

- Consumes: `nearestInDirection`, `FocusDirection`, `PaneRect` from Task 3; `focus-left/right/up/down` actions from Task 1.
- Produces: `TerminalManager.focusDirection(dir: FocusDirection): void`.

- [ ] **Step 1: Add `focusDirection` to terminal-manager**

In `src/terminal/terminal-manager.ts`, add the import:

```ts
import {
  nearestInDirection,
  type FocusDirection,
  type PaneRect,
} from "../lib/pane-geometry";
```

Add to the `TerminalManager` interface after `cycleFocus(step: 1 | -1): void;`:

```ts
  /** Move focus to the nearest pane in a direction; no pane there → no-op. */
  focusDirection(dir: FocusDirection): void;
```

Add the implementation next to `cycleFocus` (module level):

```ts
function focusDirection(dir: FocusDirection): void {
  if (!tree || activeId === null) {
    return;
  }
  const rects: PaneRect[] = [];
  for (const slot of container.querySelectorAll<HTMLElement>(".pane-slot")) {
    const id = Number(slot.dataset.paneId);
    if (Number.isNaN(id)) {
      continue;
    }
    const r = slot.getBoundingClientRect();
    rects.push({
      id,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    });
  }
  const target = nearestInDirection(rects, activeId, dir);
  if (target === null) {
    return;
  }
  // Route through setActive so zoom restore, active classes and expand
  // ratios are inherited rather than re-derived.
  setActive(target);
  panes.get(target)?.focus();
}
```

and expose it in the returned object after `cycleFocus,`:

```ts
    focusDirection,
```

- [ ] **Step 2: Wire the switch cases**

In `src/terminal/tab-manager.ts`, add to the `handleShortcut` switch:

```ts
      case "focus-left":
        activeManager()?.focusDirection("left");
        break;
      case "focus-right":
        activeManager()?.focusDirection("right");
        break;
      case "focus-up":
        activeManager()?.focusDirection("up");
        break;
      case "focus-down":
        activeManager()?.focusDirection("down");
        break;
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`
Expected: PASS.
Manual: `npm run tauri dev` → split into a 2x2 grid (Cmd+D, Cmd+Shift+D on both), Cmd+Option+Arrows moves focus geometrically; at an edge it no-ops; while a pane is zoomed (Cmd+Shift+Enter), moving direction unzooms first (setActive behavior) then focuses.

- [ ] **Step 4: Commit**

```bash
git add src/terminal/terminal-manager.ts src/terminal/tab-manager.ts
git commit -m "feat: directional pane focus with Cmd+Option+Arrows"
```

---

### Task 5: Rust — `spawn_shell` gains an optional cwd

**Files:**

- Modify: `src-tauri/src/pty.rs`

**Interfaces:**

- Consumes: nothing new.
- Produces: `spawn_shell(app, state, cols, rows, cwd: Option<String>)` Tauri command — the JS side may pass `cwd` (string) or omit it (deserializes to `None`, preserving current behavior). Helper `resolve_spawn_cwd(cwd: Option<String>) -> Option<String>`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/pty.rs`, add inside the existing `mod tests` block:

```rust
    #[test]
    fn resolve_spawn_cwd_accepts_an_existing_dir() {
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(super::resolve_spawn_cwd(Some(dir.clone())), Some(dir));
    }

    #[test]
    fn resolve_spawn_cwd_falls_back_to_home() {
        let home = std::env::var("HOME").ok();
        assert_eq!(
            super::resolve_spawn_cwd(Some("/definitely/not/a/dir".into())),
            home
        );
        assert_eq!(super::resolve_spawn_cwd(None), home);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL to compile — `resolve_spawn_cwd` not defined.

- [ ] **Step 3: Implement**

In `src-tauri/src/pty.rs`, add above `spawn_shell`:

```rust
/// Working directory for a new shell: an existing directory passes through,
/// anything else (missing, deleted, not a dir, None) falls back to `$HOME`.
fn resolve_spawn_cwd(cwd: Option<String>) -> Option<String> {
    cwd.filter(|dir| std::path::Path::new(dir).is_dir())
        .or_else(|| std::env::var("HOME").ok())
}
```

Change the `spawn_shell` signature:

```rust
#[tauri::command]
pub fn spawn_shell(
    app: AppHandle,
    state: State<PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<u32, String> {
```

and replace the HOME block

```rust
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }
```

with:

```rust
    if let Some(dir) = resolve_spawn_cwd(cwd) {
        cmd.cwd(dir);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS (all existing + 2 new). Existing frontend calls omit `cwd` → `None` → `$HOME`, so nothing else changes yet.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat: spawn_shell accepts a validated optional cwd"
```

---

### Task 6: TS — CWD inheritance for splits and new tabs

**Files:**

- Create: `src/terminal/pane-info.ts`
- Modify: `src/terminal/terminal-manager.ts`
- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**

- Consumes: `spawn_shell` `cwd` param (Task 5); `PaneProcessInfo` from `src/lib/process-info.ts`.
- Produces:
  - `freshPaneInfo(ids: readonly number[]): Promise<PaneProcessInfo[]>` — `[]` on failure.
  - `freshCwd(id: number | null): Promise<string | null>`.
  - `TerminalManager.initFresh(cwd?: string | null)`, `initFromLayout(layout, cwds?: readonly (string | null)[])` — Task 9 passes snapshot cwds through `initFromLayout`.
  - Task 7's `confirmClose` reuses `freshPaneInfo`.

- [ ] **Step 1: Create the fresh-info helper**

Create `src/terminal/pane-info.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { PaneProcessInfo } from "../lib/process-info";

/**
 * Fresh (non-polled) pty_info for the given panes. The 2s poll cache can be
 * stale at decision points (spawn cwd, close guard) — this is the cheap
 * single-shot alternative. Failure degrades to [] (matches the poll loop's
 * degrade-to-None contract).
 */
export async function freshPaneInfo(
  ids: readonly number[],
): Promise<PaneProcessInfo[]> {
  if (ids.length === 0) {
    return [];
  }
  try {
    return await invoke<PaneProcessInfo[]>("pty_info", { ids: [...ids] });
  } catch (err) {
    console.warn("pty_info failed:", err);
    return [];
  }
}

/** Fresh cwd of one pane; null on failure (spawn then falls back to $HOME). */
export async function freshCwd(id: number | null): Promise<string | null> {
  if (id === null) {
    return null;
  }
  const infos = await freshPaneInfo([id]);
  return infos.find((info) => info.id === id)?.cwd ?? null;
}
```

- [ ] **Step 2: Thread cwd through terminal-manager**

In `src/terminal/terminal-manager.ts`:

Add the import:

```ts
import { freshCwd } from "./pane-info";
```

Change `spawnPane`:

```ts
async function spawnPane(cwd: string | null = null): Promise<Pane> {
  const id = await invoke<number>("spawn_shell", {
    cols: INITIAL_COLS,
    rows: INITIAL_ROWS,
    cwd,
  });
  const pane = createPane(id, settings.value, paneEvents);
  panes.set(id, pane);
  return pane;
}
```

Update the interface declarations:

```ts
  /** Spawn a single fresh shell (at `cwd` when given). Throws when the spawn fails. */
  initFresh(cwd?: string | null): Promise<void>;
  /**
   * Spawn one shell per leaf and rebuild the split structure. `cwds` maps to
   * leaves in left-to-right order (missing/null entries → $HOME). Throws when
   * any spawn fails.
   */
  initFromLayout(
    layout: SerializedNode,
    cwds?: readonly (string | null)[],
  ): Promise<void>;
```

Update the implementations:

```ts
  async function initFresh(cwd: string | null = null): Promise<void> {
    const pane = await spawnPane(cwd);
    tree = leaf(pane.id);
    activeId = pane.id;
    render();
    pane.focus();
  }

  async function initFromLayout(
    layout: SerializedNode,
    cwds: readonly (string | null)[] = [],
  ): Promise<void> {
    const total = countLeaves(layout);
    const spawned: Pane[] = [];
    try {
      for (let i = 0; i < total; i += 1) {
        spawned.push(await spawnPane(cwds[i] ?? null));
      }
    } catch (err) {
      for (const pane of spawned) {
        discardPane(pane);
      }
      throw err;
    }
    // … rest unchanged
```

In `splitActive`, fetch the focused pane's fresh cwd right before spawning:

```ts
  async function splitActive(dir: Direction): Promise<void> {
    if (!tree || activeId === null) {
      return;
    }
    const targetId = activeId;
    try {
      // Fresh lookup, not the 2s poll cache — the user may have just cd'd
      const cwd = await freshCwd(targetId);
      const pane = await spawnPane(cwd);
      // … rest unchanged
```

`respawn` and `openInitialPane` keep calling `spawnPane()` with no argument ($HOME) — unchanged behavior.

- [ ] **Step 3: New tabs inherit the active pane's cwd**

In `src/terminal/tab-manager.ts`:

Add the import:

```ts
import { freshCwd } from "./pane-info";
```

Change `addTab` to accept cwds and pass them through:

```ts
  /** Create + init a tab; false (and an error note) when spawning fails. */
  async function addTab(
    layout: SerializedNode | null,
    cwds: readonly (string | null)[] = [],
  ): Promise<boolean> {
    // … unchanged until the init call:
    try {
      if (layout === null) {
        await manager.initFresh(cwds[0] ?? null);
      } else {
        await manager.initFromLayout(layout, cwds);
      }
    } catch (err) {
```

Change `newTab`:

```ts
async function newTab(): Promise<void> {
  const cwd = await freshCwd(activeManager()?.activePaneId() ?? null);
  if (!(await addTab(null, [cwd]))) {
    return;
  }
  selectTab(tabs.length - 1);
}
```

Session restore in `init()` keeps calling `addTab(sessionTab.layout)` with no cwds → all `$HOME` (spec: restore behavior unchanged in this batch).

- [ ] **Step 4: Verify**

Run: `npm test && npm run build && (cd src-tauri && cargo check)`
Expected: PASS / clean.
Manual: `npm run tauri dev` → `cd /tmp`, then Cmd+D → new pane starts in `/tmp` (check with `pwd`); Cmd+T → new tab starts in `/tmp`; from a fresh pane sitting in `$HOME`, splits/tabs start in `$HOME`.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/pane-info.ts src/terminal/terminal-manager.ts src/terminal/tab-manager.ts
git commit -m "feat: splits and new tabs inherit the focused pane's cwd"
```

---

### Task 7: close-guard — busy detection + confirm dialog

**Files:**

- Create: `src/terminal/close-guard.ts`
- Test: `src/terminal/close-guard.test.ts`

**Interfaces:**

- Consumes: `freshPaneInfo` (Task 6), `PaneProcessInfo`, `ask` from `@tauri-apps/plugin-dialog` (same pattern as `src/lib/quit-guard.ts`).
- Produces: `isBusy(info): boolean`, `busyProcesses(infos): string[]`, `confirmMessage(names): string` (pure, tested), `confirmClose(paneIds: readonly number[]): Promise<boolean>` (Task 8 consumes).

- [ ] **Step 1: Write the failing tests**

Create `src/terminal/close-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { busyProcesses, confirmMessage, isBusy } from "./close-guard";
import type { PaneProcessInfo } from "../lib/process-info";

function info(id: number, process: string | null): PaneProcessInfo {
  return { id, cwd: null, process };
}

describe("isBusy", () => {
  it("treats idle shells as not busy", () => {
    for (const shell of ["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh"]) {
      expect(isBusy(info(1, shell))).toBe(false);
    }
  });

  it("treats agents and other foreground processes as busy", () => {
    expect(isBusy(info(1, "claude"))).toBe(true);
    expect(isBusy(info(1, "vim"))).toBe(true);
    expect(isBusy(info(1, "npm"))).toBe(true);
  });

  it("treats a pane without a process (session-ended limbo) as not busy", () => {
    expect(isBusy(info(1, null))).toBe(false);
  });
});

describe("busyProcesses", () => {
  it("collects busy names, deduplicated, in order", () => {
    const infos = [
      info(1, "zsh"),
      info(2, "claude"),
      info(3, "vim"),
      info(4, "claude"),
      info(5, null),
    ];
    expect(busyProcesses(infos)).toEqual(["claude", "vim"]);
  });

  it("is empty when every pane is idle", () => {
    expect(busyProcesses([info(1, "zsh"), info(2, null)])).toEqual([]);
  });
});

describe("confirmMessage", () => {
  it("names the single busy process", () => {
    expect(confirmMessage(["claude"])).toBe(
      "claude is still running. Close anyway?",
    );
  });

  it("lists multiple busy processes", () => {
    expect(confirmMessage(["claude", "vim"])).toBe(
      "These processes are still running: claude, vim. Close anyway?",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- close-guard`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/terminal/close-guard.ts`:

```ts
import { ask } from "@tauri-apps/plugin-dialog";
import type { PaneProcessInfo } from "../lib/process-info";
import { freshPaneInfo } from "./pane-info";

/**
 * Foreground process names that mean "idle shell". `pty_info` reports the
 * process-group leader's proc_name, so an idle prompt shows the shell itself.
 */
const SHELL_NAMES: ReadonlySet<string> = new Set([
  "zsh",
  "bash",
  "fish",
  "sh",
  "dash",
  "nu",
  "pwsh",
]);

/** Busy = a foreground process exists and it is not an idle shell. */
export function isBusy(info: PaneProcessInfo): boolean {
  return info.process !== null && !SHELL_NAMES.has(info.process);
}

/** Busy process names, deduplicated, in pane order. */
export function busyProcesses(infos: readonly PaneProcessInfo[]): string[] {
  const names: string[] = [];
  for (const info of infos) {
    if (
      isBusy(info) &&
      info.process !== null &&
      !names.includes(info.process)
    ) {
      names.push(info.process);
    }
  }
  return names;
}

export function confirmMessage(names: readonly string[]): string {
  return names.length === 1
    ? `${names[0]} is still running. Close anyway?`
    : `These processes are still running: ${names.join(", ")}. Close anyway?`;
}

/**
 * True when closing may proceed. Fetches fresh process info for the target
 * panes (the 2s poll can miss a just-launched process) and shows one native
 * dialog when anything is busy. Info failure → not busy (degrade contract);
 * dialog failure → false (fail safe: do not close).
 */
export async function confirmClose(
  paneIds: readonly number[],
): Promise<boolean> {
  const infos = await freshPaneInfo(paneIds);
  const names = busyProcesses(infos);
  if (names.length === 0) {
    return true;
  }
  try {
    return await ask(confirmMessage(names), {
      title: "Close Terminal",
      kind: "warning",
      okLabel: "Close",
      cancelLabel: "Cancel",
    });
  } catch (err: unknown) {
    console.error("Close prompt failed:", err);
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- close-guard`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/terminal/close-guard.ts src/terminal/close-guard.test.ts
git commit -m "feat: busy-pane detection and close confirmation guard"
```

---

### Task 8: Close routing — pane/tab semantics + guard wiring

**Files:**

- Modify: `src/terminal/tab-manager.ts`
- Modify: `src/ui/tab-bar.tsx`

**Interfaces:**

- Consumes: `confirmClose` (Task 7); swapped actions (Task 1).
- Produces: `TabManager.closePane()` and `TabManager.closeTab(index)` become the **guarded, routed** entry points (same signatures — `app.tsx` needs no change). The internal unguarded `closeTab` remains for post-guard execution; `handleExit`'s auto-close path in terminal-manager is untouched and never prompts.

- [ ] **Step 1: Add guarded routing functions**

In `src/terminal/tab-manager.ts`, add the import:

```ts
import { confirmClose } from "./close-guard";
```

Add below the existing `closePane` helper (near `splitActive`):

```ts
/**
 * Cmd+W routing (iTerm2 semantics): last pane in the tab → close the tab;
 * otherwise close the pane. The routing decision runs first, then the busy
 * guard runs once on the final target set — exactly one dialog.
 */
async function closePaneGuarded(): Promise<void> {
  const manager = activeManager();
  if (!manager) {
    return;
  }
  if (manager.paneCount() <= 1) {
    await closeTabGuarded(active);
    return;
  }
  const paneId = manager.activePaneId();
  if (paneId === null) {
    return;
  }
  if (!(await confirmClose([paneId]))) {
    return;
  }
  await manager.closeActive();
}

async function closeTabGuarded(index: number): Promise<void> {
  const entry = tabs[index];
  if (!entry) {
    return;
  }
  if (!(await confirmClose(entry.manager.paneIds()))) {
    return;
  }
  await closeTab(index);
}
```

- [ ] **Step 2: Route the switch and the public interface through the guards**

In `handleShortcut`, change the two cases:

```ts
      case "close-pane":
        void closePaneGuarded();
        break;
      case "close-tab":
        void closeTabGuarded(active);
        break;
```

In the returned object, point the public methods at the guarded versions (the tab-bar close button and toolbar close-pane button are user-initiated closes, so they get the same guard + routing):

```ts
    closeTab: closeTabGuarded,
    // …
    closePane: closePaneGuarded,
```

Update the interface doc comments on `TabManager`:

```ts
  /** Close a tab after the busy guard; every pane's process is checked. */
  closeTab(index: number): Promise<void>;
  // …
  /** Close the focused pane (busy-guarded); last pane in tab closes the tab. */
  closePane(): Promise<void>;
```

- [ ] **Step 3: Update the toolbar tooltip**

In `src/ui/tab-bar.tsx`, the close-pane button:

```ts
title = "Close pane (⌘W)";
```

(was `⌘⇧W`).

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: PASS.
Manual (`npm run tauri dev`):

1. Split a tab, run `sleep 100` in one pane, Cmd+W on it → one dialog "sleep is still running. Close anyway?"; Cancel keeps it, repeat + Close closes it.
2. Idle pane + Cmd+W → closes with no dialog.
3. Single-pane tab + Cmd+W → the whole tab closes (not a respawned shell).
4. Tab with a busy pane + Cmd+Shift+W → one dialog listing the process; multi-busy tab lists all names once.
5. Last remaining tab + Cmd+W → tab is replaced by a fresh tab (never zero tabs).
6. `exit` in a pane of a split → auto-close, no dialog.
7. Tab-bar × button on a busy tab → dialog appears.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/tab-manager.ts src/ui/tab-bar.tsx
git commit -m "feat: iTerm2 close routing with busy-pane confirmation"
```

---

### Task 9: Reopen closed tab (Cmd+Shift+T)

**Files:**

- Create: `src/terminal/closed-tabs.ts`
- Test: `src/terminal/closed-tabs.test.ts`
- Modify: `src/terminal/tab-manager.ts`

**Interfaces:**

- Consumes: `SerializedNode`, `TabDotColor`, `PaneProcessInfo`; `addTab(layout, cwds)` (Task 6); `reopen-tab` action (Task 1).
- Produces: `ClosedTabSnapshot`, `MAX_CLOSED_TABS = 10`, `pushClosedTab(stack, snapshot)`, `popClosedTab(stack)`, `captureCwds(paneIds, infoByPane)` — all pure. `cwds` is in `leafIds()` (left-to-right pre-order) order; `treeFromLayout` consumes pane ids in the same order, so the arrays line up on restore.

- [ ] **Step 1: Write the failing tests**

Create `src/terminal/closed-tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  captureCwds,
  MAX_CLOSED_TABS,
  popClosedTab,
  pushClosedTab,
  type ClosedTabSnapshot,
} from "./closed-tabs";
import type { PaneProcessInfo } from "../lib/process-info";

function snap(name: string): ClosedTabSnapshot {
  return { layout: { type: "leaf" }, name, dotColor: null, cwds: [null] };
}

describe("pushClosedTab / popClosedTab", () => {
  it("pops in LIFO order without mutating the input", () => {
    const stack = pushClosedTab(pushClosedTab([], snap("a")), snap("b"));
    const [top, rest] = popClosedTab(stack);
    expect(top?.name).toBe("b");
    expect(rest.map((s) => s.name)).toEqual(["a"]);
    expect(stack).toHaveLength(2); // no mutation
  });

  it("caps the stack at MAX_CLOSED_TABS, dropping the oldest", () => {
    let stack: readonly ClosedTabSnapshot[] = [];
    for (let i = 0; i < MAX_CLOSED_TABS + 3; i += 1) {
      stack = pushClosedTab(stack, snap(`t${i}`));
    }
    expect(stack).toHaveLength(MAX_CLOSED_TABS);
    expect(stack[0].name).toBe("t3"); // oldest three dropped
    expect(stack[stack.length - 1].name).toBe(`t${MAX_CLOSED_TABS + 2}`);
  });

  it("pops null from an empty stack", () => {
    const [top, rest] = popClosedTab([]);
    expect(top).toBeNull();
    expect(rest).toEqual([]);
  });
});

describe("captureCwds", () => {
  it("zips pane ids against the info map, null when unknown", () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [7, { id: 7, cwd: "/tmp", process: "zsh" }],
      [9, { id: 9, cwd: null, process: null }],
    ]);
    expect(captureCwds([7, 8, 9], infoByPane)).toEqual(["/tmp", null, null]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- closed-tabs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure module**

Create `src/terminal/closed-tabs.ts`:

```ts
import type { SerializedNode } from "../lib/split-tree";
import type { TabDotColor } from "../lib/tab-colors";
import type { PaneProcessInfo } from "../lib/process-info";

export const MAX_CLOSED_TABS = 10;

/**
 * Everything needed to reopen a closed tab with fresh shells: the layout
 * serialization intentionally drops pane ids and cwds, so cwds are carried
 * alongside in leafIds() (left-to-right) order — treeFromLayout assigns new
 * pane ids in the same order on restore.
 */
export interface ClosedTabSnapshot {
  readonly layout: SerializedNode;
  readonly name: string | null;
  readonly dotColor: TabDotColor | null;
  readonly cwds: readonly (string | null)[];
}

/** New stack with `snapshot` on top; oldest entries drop beyond the cap. */
export function pushClosedTab(
  stack: readonly ClosedTabSnapshot[],
  snapshot: ClosedTabSnapshot,
): readonly ClosedTabSnapshot[] {
  return [...stack, snapshot].slice(-MAX_CLOSED_TABS);
}

/** [top, rest] of the stack; [null, stack] when empty. */
export function popClosedTab(
  stack: readonly ClosedTabSnapshot[],
): readonly [ClosedTabSnapshot | null, readonly ClosedTabSnapshot[]] {
  if (stack.length === 0) {
    return [null, stack];
  }
  return [stack[stack.length - 1], stack.slice(0, -1)];
}

/** Cwd per pane id from the polled info map; null when unknown. */
export function captureCwds(
  paneIds: readonly number[],
  infoByPane: ReadonlyMap<number, PaneProcessInfo>,
): readonly (string | null)[] {
  return paneIds.map((id) => infoByPane.get(id)?.cwd ?? null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- closed-tabs`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into tab-manager**

In `src/terminal/tab-manager.ts`:

Add the import:

```ts
import {
  captureCwds,
  popClosedTab,
  pushClosedTab,
  type ClosedTabSnapshot,
} from "./closed-tabs";
```

Add state next to `overrides`:

```ts
// Recently closed tabs (Cmd+Shift+T), newest last; in-memory only.
let closedTabs: readonly ClosedTabSnapshot[] = [];
```

At the **top of `closeTab`** — before `entry.manager.dispose()` and before `overrides.delete(entry.key)` (capture ordering is a review-flagged contract: reading layout after dispose only works incidentally):

```ts
  async function closeTab(index: number): Promise<void> {
    const entry = tabs[index];
    if (!entry) {
      return;
    }
    // Snapshot BEFORE dispose/override-cleanup — every close path pushes one
    const layout = entry.manager.serializeLayout();
    if (layout !== null) {
      const override = overrides.get(entry.key);
      closedTabs = pushClosedTab(closedTabs, {
        layout,
        name: override?.name ?? null,
        dotColor: override?.dotColor ?? null,
        cwds: captureCwds(entry.manager.paneIds(), infoByPane),
      });
    }
    const closingActive = index === active;
    // … rest of closeTab unchanged
```

Add the reopen function next to `newTab`:

```ts
async function reopenTab(): Promise<void> {
  const [snapshot, rest] = popClosedTab(closedTabs);
  if (snapshot === null) {
    return;
  }
  if (!(await addTab(snapshot.layout, snapshot.cwds))) {
    return; // spawn failed — keep the snapshot for another attempt
  }
  closedTabs = rest;
  // Fresh tab key from addTab/nextKey — re-register overrides under it
  const key = tabs[tabs.length - 1].key;
  const override: TabOverride = {
    ...(snapshot.name !== null ? { name: snapshot.name } : {}),
    ...(snapshot.dotColor !== null ? { dotColor: snapshot.dotColor } : {}),
  };
  if (override.name !== undefined || override.dotColor !== undefined) {
    overrides.set(key, override);
  }
  selectTab(tabs.length - 1);
}
```

Add the switch case:

```ts
      case "reopen-tab":
        void reopenTab();
        break;
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: PASS.
Manual (`npm run tauri dev`):

1. Split a tab 2-3 ways with different cwds (`cd /tmp`, `cd ~`), rename it + set a dot color, wait ≥2s (poll), Cmd+Shift+W → Cmd+Shift+T → layout, ratios, name, color are back; each pane `pwd` shows its saved cwd; scrollback is empty (accepted).
2. Empty stack (fresh launch) + Cmd+Shift+T → no-op.
3. Close the last tab (auto-replaced by a fresh one) → Cmd+Shift+T restores the closed one.
4. Close a tab via the tab-bar × → reopen works too.

- [ ] **Step 7: Commit**

```bash
git add src/terminal/closed-tabs.ts src/terminal/closed-tabs.test.ts src/terminal/tab-manager.ts
git commit -m "feat: reopen closed tab with Cmd+Shift+T"
```

---

### Task 10: Search in scrollback (Cmd+F)

**Files:**

- Modify: `package.json` (+ lockfile, via npm install)
- Modify: `src/terminal/pane.ts`
- Create: `src/terminal/search-bar.ts`
- Test: `src/terminal/search-bar.test.ts`
- Modify: `src/terminal/terminal-manager.ts`
- Modify: `src/terminal/tab-manager.ts`
- Modify: `src/styles.css`

**Interfaces:**

- Consumes: `"find"` action (Task 1); `Pane` (gains `search`); `resolveTheme(settings)` from `src/settings/themes.ts`.
- Produces: `Pane.search: SearchAddon`; `openSearchBar(pane: Pane)`, `closeSearchBar()`, `closeSearchBarForPane(paneId: number)`, `formatMatchCount(resultIndex, resultCount): string`; `TerminalManager.openSearch(): void`.

- [ ] **Step 1: Install the addon**

Run: `npm install @xterm/addon-search@^0.16.0`
Expected: installs cleanly (0.16.0 is the xterm-6-era release, published alongside `@xterm/xterm@6.0.0`).

- [ ] **Step 2: Load SearchAddon per pane**

In `src/terminal/pane.ts`:

```ts
import { SearchAddon } from "@xterm/addon-search";
```

Add to the `Pane` interface after `readonly element: HTMLElement;`:

```ts
  /** Per-pane search addon (Cmd+F); disposed with the terminal. */
  readonly search: SearchAddon;
```

After `term.loadAddon(new WebLinksAddon());` add:

```ts
const searchAddon = new SearchAddon();
term.loadAddon(searchAddon);
```

and expose it in the returned object after `element,`:

```ts
    search: searchAddon,
```

- [ ] **Step 3: Write the failing formatter test**

Create `src/terminal/search-bar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMatchCount } from "./search-bar";

describe("formatMatchCount", () => {
  it("formats 1-based index over count", () => {
    expect(formatMatchCount(2, 17)).toBe("3/17");
    expect(formatMatchCount(0, 1)).toBe("1/1");
  });

  it("shows 0/0 when there are no matches", () => {
    expect(formatMatchCount(-1, 0)).toBe("0/0");
  });
});
```

Run: `npm test -- search-bar` → Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the search bar**

Create `src/terminal/search-bar.ts`:

```ts
import type { ISearchOptions } from "@xterm/addon-search";
import { settings } from "../settings/settings-store";
import { resolveTheme } from "../settings/themes";
import type { Pane } from "./pane";

/** "resultIndex/resultCount" for the bar counter; "0/0" when empty. */
export function formatMatchCount(
  resultIndex: number,
  resultCount: number,
): string {
  return resultCount === 0 ? "0/0" : `${resultIndex + 1}/${resultCount}`;
}

interface OpenBar {
  readonly pane: Pane;
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly disposeResults: () => void;
}

// One search bar at a time across all panes and tabs.
let current: OpenBar | null = null;

function searchOptions(incremental: boolean): ISearchOptions {
  const theme = resolveTheme(settings.value);
  const match = theme.selectionBackground ?? "#33467c";
  const activeMatch = theme.yellow ?? "#e0af68";
  return {
    incremental,
    decorations: {
      matchBackground: match,
      activeMatchBackground: activeMatch,
      // Required by ISearchDecorationOptions even though there is no
      // overview ruler — theme-derived placeholder colors.
      matchOverviewRuler: match,
      activeMatchColorOverviewRuler: activeMatch,
    },
  };
}

function barButton(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-bar__btn";
  button.textContent = label;
  button.title = title;
  // Keep the input focused while clicking the bar's buttons
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);
  return button;
}

/** Open (or refocus) the bar on `pane`; any bar on another pane closes. */
export function openSearchBar(pane: Pane): void {
  if (current?.pane.id === pane.id) {
    current.input.focus();
    current.input.select();
    return;
  }
  closeSearchBar();

  const element = document.createElement("div");
  element.className = "search-bar";
  const input = document.createElement("input");
  input.className = "search-bar__input";
  input.type = "text";
  input.placeholder = "Find";
  input.spellcheck = false;
  const counter = document.createElement("span");
  counter.className = "search-bar__count";

  const findNext = (): void => {
    if (input.value !== "") {
      pane.search.findNext(input.value, searchOptions(false));
    }
  };
  const findPrevious = (): void => {
    if (input.value !== "") {
      pane.search.findPrevious(input.value, searchOptions(false));
    }
  };

  element.append(
    input,
    counter,
    barButton("‹", "Previous match (⇧↩)", findPrevious),
    barButton("›", "Next match (↩)", findNext),
    barButton("×", "Close (Esc)", closeSearchBar),
  );

  const results = pane.search.onDidChangeResults(
    ({ resultIndex, resultCount }) => {
      counter.textContent = formatMatchCount(resultIndex, resultCount);
    },
  );

  input.addEventListener("input", () => {
    if (input.value === "") {
      pane.search.clearDecorations();
      counter.textContent = "";
      return;
    }
    // Incremental: the current selection expands instead of jumping ahead
    pane.search.findNext(input.value, searchOptions(true));
  });

  // The global shortcut handler skips inputs outside .pane__term, so the
  // bar handles its own keys — including Cmd+F to refocus/select-all.
  element.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchBar();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      findPrevious();
    } else if (event.key === "Enter") {
      event.preventDefault();
      findNext();
    } else if (event.metaKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  pane.element.appendChild(element);
  current = { pane, element, input, disposeResults: () => results.dispose() };
  input.focus();
}

/** Close the bar, clear highlights, refocus the terminal. */
export function closeSearchBar(): void {
  if (current === null) {
    return;
  }
  const { pane, element, disposeResults } = current;
  current = null;
  disposeResults();
  pane.search.clearDecorations();
  element.remove();
  pane.focus();
}

/** Drop the bar when its pane is being disposed — no decoration/focus calls. */
export function closeSearchBarForPane(paneId: number): void {
  if (current?.pane.id !== paneId) {
    return;
  }
  const { element, disposeResults } = current;
  current = null;
  disposeResults();
  element.remove();
}
```

Run: `npm test -- search-bar` → Expected: PASS.

- [ ] **Step 5: Wire terminal-manager and tab-manager**

In `src/terminal/terminal-manager.ts`:

```ts
import { closeSearchBarForPane, openSearchBar } from "./search-bar";
```

Add to the `TerminalManager` interface after `clearActive(): void;`:

```ts
  /** Open the search bar on the active pane (Cmd+F). */
  openSearch(): void;
```

In `closePane`, right before `pane.dispose();`:

```ts
closeSearchBarForPane(id);
```

In `dispose()`, inside the `for (const pane of panes.values())` loop before `pane.dispose();`:

```ts
closeSearchBarForPane(pane.id);
```

Add to the returned object after `clearActive() { … },`:

```ts
    openSearch() {
      if (activeId !== null) {
        const pane = panes.get(activeId);
        if (pane) {
          openSearchBar(pane);
        }
      }
    },
```

In `src/terminal/tab-manager.ts`, add the switch case:

```ts
      case "find":
        activeManager()?.openSearch();
        break;
```

- [ ] **Step 6: Style the bar**

In `src/styles.css`, append after the Pane section (near the `.pane__anchor` rules; `.pane` is already `position: relative`):

```css
/* ── Search bar (Cmd+F) ─────────────────────────────────── */

.search-bar {
  position: absolute;
  top: 34px;
  right: 10px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--hair-strong);
  border-radius: 7px;
  background: var(--chrome-2);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
  font: 12px var(--ui-font);
}

.search-bar__input {
  width: 160px;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: var(--input-bg);
  color: var(--text-primary);
  font: inherit;
  outline: none;
}

.search-bar__count {
  min-width: 34px;
  text-align: right;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.search-bar__btn {
  padding: 2px 5px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.search-bar__btn:hover {
  background: var(--tab-active-bg);
  color: var(--text-primary);
}
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run build`
Expected: PASS.
Manual (`npm run tauri dev`):

1. Generate output (`ls -R /usr/share | head -200`), Cmd+F → bar appears top-right of the focused pane, typing highlights all matches incrementally (case-insensitive), counter shows e.g. "3/17".
2. Enter/Shift+Enter cycle matches (active match uses the yellow highlight); Esc closes, clears highlights, refocuses the terminal.
3. Cmd+F while the bar is open → input refocuses and selects all.
4. Open the bar on pane A, focus pane B, Cmd+F → A's bar closes, B's opens (one bar at a time).
5. Empty buffer (fresh pane) + search → "0/0", Enter no-ops.
6. Close the pane hosting the bar (Cmd+W) → bar disappears, no console errors.
7. Highlight rendering looks right on the DOM renderer; Vietnamese IME in the input composes normally.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/terminal/pane.ts src/terminal/search-bar.ts src/terminal/search-bar.test.ts src/terminal/terminal-manager.ts src/terminal/tab-manager.ts src/styles.css
git commit -m "feat: scrollback search with Cmd+F"
```

---

## Final Verification (after all tasks)

- [ ] `npm test` — all suites green (keymap, pane-geometry, close-guard, closed-tabs, search-bar + pre-existing).
- [ ] `npm run build` — tsc + vite clean.
- [ ] `cd src-tauri && cargo test` — Rust green.
- [ ] Manual sweep in `npm run tauri dev`: the seven scenario groups listed in Tasks 2, 4, 6, 8, 9, 10, plus: zoom + directional focus interaction, Vietnamese IME unaffected by the new bindings (arrows/Cmd keys don't compose), quit guard (Cmd+Q) unchanged.
