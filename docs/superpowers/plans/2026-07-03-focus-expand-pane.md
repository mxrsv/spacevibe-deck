# Focus Expand Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Focus Expand mode (⌘E + tab-bar button): the active pane expands to ≥65% on every split along its path; switching focus animates the old pane back to its original ratio and expands the new one.

**Architecture:** The split tree stays the single source of truth. Expansion is a display-time overlay: a pure function `expandForPane` returns a ratio-overridden copy of the tree, and `applyRatios` writes those ratios into the existing DOM's `flex-grow` (no rebuild) so the CSS transition animates. Persistence, serialization, and divider commits always use the original tree.

**Tech Stack:** TypeScript, Preact + @preact/signals, xterm.js, Tauri 2, vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-focus-expand-pane-design.md`

## Global Constraints

- All strings, comments, and docs in English (project rule).
- `EXPAND_RATIO = 0.65`; transition `flex-grow 150ms ease`; resize debounce ~90ms trailing.
- Setting key `focusExpand: boolean`, default `false`, stored in `settings.json`, applies to all tabs.
- Keybinding: ⌘E → action `toggle-expand`.
- All split-tree functions immutable; unchanged subtrees returned by reference (pattern of `removeLeaf`).
- `render()` always builds DOM from the ORIGINAL tree, never from the display tree (divider commit baseline must be the original ratio).
- Never call `applyRatios` across an `await` after a structural change — DOM must match the tree at call time.
- `serializeLayout()` unchanged — sessions never store expanded ratios.
- Run all commands from `stackgrid/`. Tests: `npx vitest run <file>`. Full suite: `npm test`.
- Commit on the current branch (`main`); no new branches.

---

### Task 1: Smoke test — flex-grow transition in WKWebView (GATE)

The whole design assumes `transition: flex-grow` animates in macOS WKWebView. Verify this FIRST. If it does not animate, STOP and report back — the fallback direction (transition on `flex-basis` percentages) changes Tasks 3 and 7.

**Files:**

- Modify: `src/styles.css` (after the `.split__child > *` rule, around line 314)

**Interfaces:**

- Produces: CSS classes later tasks rely on: `.split__child` transitions `flex-grow`; `.split.is-resizing > .split__child` disables it during divider drags.

- [ ] **Step 1: Add the transition CSS**

In `src/styles.css`, insert after the `.split__child > *` block (line 310–314):

```css
.split__child {
  transition: flex-grow 150ms ease;
}

/* No animation while dragging a divider — ratios must track the pointer */
.split.is-resizing > .split__child {
  transition: none;
}
```

Note: `.split__child` already has a rule at line 303 (`flex: 1 1 0; ...`) — add a separate rule block rather than editing that one, so the diff stays minimal.

- [ ] **Step 2: Run the app and verify the animation manually**

Run: `npm run tauri dev`

In the app: press ⌘D to get two panes. Right-click a pane → Inspect Element (WKWebView inspector; if unavailable, enable Develop menu in Safari and attach to the app). In the console run:

```js
document.querySelectorAll(".split__child")[0].style.flexGrow = "0.8";
```

Expected: the left pane grows smoothly over ~150ms. Then set it back to `"0.5"` — it shrinks smoothly.

**If the change snaps instantly (no animation): STOP. Do not proceed to any other task. Report the failure — the spec's fallback is transitioning `flex-basis` percentages instead, which must be re-planned.**

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat: add flex-grow transition for pane resize animation"
```

---

### Task 2: `expandForPane` pure function

**Files:**

- Modify: `src/lib/split-tree.ts` (append after `setRatio`, before the serialization section)
- Test: `src/lib/split-tree.test.ts`

**Interfaces:**

- Consumes: existing `TreeNode`, `leafIds` from `split-tree.ts`.
- Produces: `expandForPane(node: TreeNode, paneId: number, minRatio: number): TreeNode` — used by Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/split-tree.test.ts` (add `expandForPane` to the existing import from `./split-tree`):

```ts
describe("expandForPane", () => {
  it("returns a single leaf unchanged by reference", () => {
    const tree = leaf(1);
    expect(expandForPane(tree, 1, 0.65)).toBe(tree);
  });

  it("expands branch a to minRatio when the pane is in a", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row"); // ratio 0.5, pane 1 in a
    const result = expandForPane(tree, 1, 0.65);
    expect(result).toMatchObject({ kind: "split", ratio: 0.65 });
  });

  it("shrinks branch a to 1 - minRatio when the pane is in b", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row"); // pane 2 in b
    const result = expandForPane(tree, 2, 0.65);
    expect(result).toMatchObject({ kind: "split", ratio: 1 - 0.65 });
  });

  it("overrides ratios along the whole path in a nested tree", () => {
    // root(row): a = leaf(1), b = split(column): a = leaf(2), b = leaf(3)
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 2, 3, "column");
    const result = expandForPane(tree, 3, 0.65);
    if (result.kind !== "split" || result.b.kind !== "split") {
      throw new Error("expected nested split");
    }
    expect(result.ratio).toBeCloseTo(0.35); // pane 3 in b of root
    expect(result.b.ratio).toBeCloseTo(0.35); // pane 3 in b of inner split
    expect(result.a).toBe(tree.kind === "split" ? tree.a : tree); // off-path branch by reference
  });

  it("keeps a ratio that already satisfies minRatio", () => {
    const base = splitLeaf(leaf(1), 1, 2, "row");
    const tree = setRatio(base, [], 0.8); // branch a already at 0.8 ≥ 0.65
    expect(expandForPane(tree, 1, 0.65)).toBe(tree); // nothing changes → same reference
  });

  it("returns the same reference when paneId is not in the tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    expect(expandForPane(tree, 99, 0.65)).toBe(tree);
  });

  it("never mutates the input tree", () => {
    const tree = splitLeaf(leaf(1), 1, 2, "row");
    const before = JSON.stringify(tree);
    expandForPane(tree, 1, 0.65);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
```

Also add `setRatio` and `expandForPane` to the import list at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: FAIL — `expandForPane` is not exported.

- [ ] **Step 3: Implement `expandForPane`**

Append to `src/lib/split-tree.ts` after `setRatio` (line 161):

```ts
/**
 * Display-time overlay: return a copy of the tree where every split on the
 * path to leaf `paneId` gives that branch at least `minRatio`. Ratios that
 * already satisfy the minimum are kept (the active pane never shrinks).
 * Returns the node by reference when nothing changes or when `paneId` is
 * not in the tree.
 */
export function expandForPane(
  node: TreeNode,
  paneId: number,
  minRatio: number,
): TreeNode {
  if (node.kind === "leaf") {
    return node;
  }
  const inA = leafIds(node.a).includes(paneId);
  const inB = !inA && leafIds(node.b).includes(paneId);
  if (!inA && !inB) {
    return node;
  }
  const ratio = inA
    ? Math.max(node.ratio, minRatio)
    : Math.min(node.ratio, 1 - minRatio);
  const a = inA ? expandForPane(node.a, paneId, minRatio) : node.a;
  const b = inB ? expandForPane(node.b, paneId, minRatio) : node.b;
  if (a === node.a && b === node.b && ratio === node.ratio) {
    return node;
  }
  return { ...node, ratio, a, b };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/split-tree.ts src/lib/split-tree.test.ts
git commit -m "feat: add expandForPane ratio overlay to split tree"
```

---

### Task 3: `ratioEntries` + `applyRatios`

`ratioEntries` is the pure, node-testable part (lives in `split-tree.ts`); `applyRatios` in `layout.ts` only maps paths to DOM elements and writes `flex-grow` — no DOM rebuild, so the CSS transition from Task 1 animates.

**Files:**

- Modify: `src/lib/split-tree.ts` (append after `expandForPane`)
- Modify: `src/terminal/layout.ts` (append at end)
- Test: `src/lib/split-tree.test.ts`

**Interfaces:**

- Consumes: `TreeNode`, `Path` from `split-tree.ts`.
- Produces:
  - `ratioEntries(node: TreeNode): RatioEntry[]` where `RatioEntry = { readonly path: Path; readonly ratio: number }` — pre-order, root first.
  - `applyRatios(container: HTMLElement, root: TreeNode | null): void` (exported from `layout.ts`) — no-op when `root` is null or the container is empty. Used by Task 7.

- [ ] **Step 1: Write the failing tests for `ratioEntries`**

Append to `src/lib/split-tree.test.ts` (add `ratioEntries` to the import):

```ts
describe("ratioEntries", () => {
  it("returns an empty list for a single leaf", () => {
    expect(ratioEntries(leaf(1))).toEqual([]);
  });

  it("lists path and ratio for every split, root first", () => {
    // root(row, 0.3): a = leaf(1), b = split(column, 0.7): a = leaf(2), b = leaf(3)
    const tree = treeFromLayout(
      {
        type: "split",
        direction: "row",
        ratio: 0.3,
        first: { type: "leaf" },
        second: {
          type: "split",
          direction: "column",
          ratio: 0.7,
          first: { type: "leaf" },
          second: { type: "leaf" },
        },
      },
      [1, 2, 3],
    );
    expect(ratioEntries(tree)).toEqual([
      { path: [], ratio: 0.3 },
      { path: ["b"], ratio: 0.7 },
    ]);
  });

  it("prefixes nested paths on both branches", () => {
    // root: a = split, b = split
    let tree = splitLeaf(leaf(1), 1, 2, "row");
    tree = splitLeaf(tree, 1, 3, "column"); // splits leaf 1 inside branch a
    tree = splitLeaf(tree, 2, 4, "column"); // splits leaf 2 inside branch b
    expect(ratioEntries(tree)).toEqual([
      { path: [], ratio: 0.5 },
      { path: ["a"], ratio: 0.5 },
      { path: ["b"], ratio: 0.5 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: FAIL — `ratioEntries` is not exported.

- [ ] **Step 3: Implement `ratioEntries`**

Append to `src/lib/split-tree.ts` after `expandForPane`:

```ts
export interface RatioEntry {
  readonly path: Path;
  readonly ratio: number;
}

/** Every split's path and ratio, pre-order (root first). Pure — used by applyRatios. */
export function ratioEntries(node: TreeNode): RatioEntry[] {
  if (node.kind === "leaf") {
    return [];
  }
  return [
    { path: [], ratio: node.ratio },
    ...ratioEntries(node.a).map(
      (entry): RatioEntry => ({ ...entry, path: ["a", ...entry.path] }),
    ),
    ...ratioEntries(node.b).map(
      (entry): RatioEntry => ({ ...entry, path: ["b", ...entry.path] }),
    ),
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/split-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `applyRatios` in `layout.ts`**

Append to `src/terminal/layout.ts`. Add `ratioEntries` to the existing import (note: it becomes a value import, so split it from the type-only import):

```ts
import { ratioEntries } from "../lib/split-tree";
import type { LeafNode, Path, SplitNode, TreeNode } from "../lib/split-tree";
```

Then append:

```ts
/**
 * Write the tree's ratios into the existing DOM without rebuilding it, so
 * the flex-grow CSS transition animates. The DOM must match the tree's
 * structure at call time (every structural change renders synchronously).
 * No-op when root is null (manager not initialized) or the container is empty.
 *
 * A `.split` element has three children: [child a, divider, child b] — the
 * walk selects `:scope > .split__child` (indexes 0 and 1 of that query) to
 * skip the divider, then descends through each child's firstElementChild.
 */
export function applyRatios(
  container: HTMLElement,
  root: TreeNode | null,
): void {
  if (!root) {
    return;
  }
  const rootEl = container.firstElementChild;
  if (!rootEl) {
    return;
  }
  for (const entry of ratioEntries(root)) {
    const splitEl = resolveSplitElement(rootEl, entry.path);
    if (!splitEl) {
      continue;
    }
    const children = splitEl.querySelectorAll<HTMLElement>(
      ":scope > .split__child",
    );
    if (children.length !== 2) {
      continue;
    }
    children[0].style.flexGrow = String(entry.ratio);
    children[1].style.flexGrow = String(1 - entry.ratio);
  }
}

/** Follow an a/b path from the tree root's element to a split element. */
function resolveSplitElement(rootEl: Element, path: Path): Element | null {
  let current: Element | null = rootEl;
  for (const branch of path) {
    const children = current.querySelectorAll(":scope > .split__child");
    current = children[branch === "a" ? 0 : 1]?.firstElementChild ?? null;
    if (!current) {
      return null;
    }
  }
  return current;
}
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/split-tree.ts src/lib/split-tree.test.ts src/terminal/layout.ts
git commit -m "feat: add ratioEntries and applyRatios for in-place ratio updates"
```

---

### Task 4: `focusExpand` setting

**Files:**

- Modify: `src/settings/settings-schema.ts`
- Test: `src/settings/settings-schema.test.ts`

**Interfaces:**

- Produces: `Settings.focusExpand: boolean`, default `false`, validated with boolean-type fallback (same pattern as `restoreTabs`). Used by Tasks 7 and 8.

- [ ] **Step 1: Write the failing tests**

Append to `src/settings/settings-schema.test.ts` (follow the file's existing style — it tests `validateSettings` and `DEFAULT_SETTINGS`; read the file first to place these inside or alongside the existing `describe`):

```ts
describe("focusExpand", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.focusExpand).toBe(false);
  });

  it("accepts a valid boolean", () => {
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: true }).focusExpand,
    ).toBe(true);
  });

  it("falls back to false when missing or not a boolean", () => {
    expect(validateSettings({}).focusExpand).toBe(false);
    expect(
      validateSettings({ ...DEFAULT_SETTINGS, focusExpand: "yes" }).focusExpand,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/settings/settings-schema.test.ts`
Expected: FAIL — `focusExpand` does not exist on `Settings`.

- [ ] **Step 3: Add the field to schema, defaults, and validation**

In `src/settings/settings-schema.ts`:

Add to the `Settings` interface (after `restoreTabs: boolean;`):

```ts
focusExpand: boolean;
```

Add to `DEFAULT_SETTINGS` (after `restoreTabs: true,`):

```ts
  focusExpand: false,
```

Add to the object returned by `validateSettings` (after the `restoreTabs` entry):

```ts
    focusExpand:
      typeof source.focusExpand === "boolean"
        ? source.focusExpand
        : DEFAULT_SETTINGS.focusExpand,
```

- [ ] **Step 4: Run tests and type-check**

Run: `npx vitest run src/settings/settings-schema.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/settings/settings-schema.ts src/settings/settings-schema.test.ts
git commit -m "feat: add focusExpand setting (default off)"
```

---

### Task 5: `toggle-expand` keybinding (⌘E)

**Files:**

- Modify: `src/terminal/keymap.ts`
- Test: `src/terminal/keymap.test.ts`

**Interfaces:**

- Produces: `ShortcutAction` union gains `"toggle-expand"`; `DEFAULT_KEYMAP` gains `{ key: "e", meta: true, action: "toggle-expand" }`. Handled in Task 8.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("matchBinding", ...)` in `src/terminal/keymap.test.ts` (the `keyEvent` helper already exists there):

```ts
it("matches Cmd+E to toggle-expand", () => {
  expect(matchBinding(keyEvent("e", { metaKey: true }))).toBe("toggle-expand");
});

it("does not match E with other modifiers to toggle-expand", () => {
  expect(matchBinding(keyEvent("e"))).toBeNull();
  expect(
    matchBinding(keyEvent("e", { metaKey: true, shiftKey: true })),
  ).toBeNull();
  expect(matchBinding(keyEvent("e", { ctrlKey: true }))).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/terminal/keymap.test.ts`
Expected: FAIL — `matchBinding` returns null for ⌘E.

- [ ] **Step 3: Add the action and binding**

In `src/terminal/keymap.ts`, extend the `ShortcutAction` union (after `"focus-prev"`):

```ts
  | "toggle-expand"
```

Add to `DEFAULT_KEYMAP` (after the `focus-prev` entry):

```ts
  { key: "e", meta: true, action: "toggle-expand" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/terminal/keymap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/terminal/keymap.ts src/terminal/keymap.test.ts
git commit -m "feat: bind Cmd+E to toggle-expand action"
```

---

### Task 6: Debounce pane ResizeObserver

The 150ms transition makes ResizeObserver fire every frame → `fit()` + `resize_pty` spam (SIGWINCH storms for running TUI apps). Debounce ONLY the observer callback (~90ms trailing) — direct `fit()` calls (mount, show, applySettings) must stay synchronous.

**Files:**

- Modify: `src/terminal/pane.ts:84` (observer) and `dispose` (line 124–128)

**Interfaces:**

- Consumes/Produces: no API change — `Pane` interface is untouched.

- [ ] **Step 1: Replace the observer callback with a debounced one**

In `src/terminal/pane.ts`, replace line 84:

```ts
const observer = new ResizeObserver(() => fit());
```

with:

```ts
// The flex-grow transition fires ResizeObserver every frame for ~150ms;
// debouncing here keeps fit()/resize_pty to one call after the dust
// settles. Direct fit() calls (mount, show, applySettings) stay immediate.
const RESIZE_DEBOUNCE_MS = 90;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const observer = new ResizeObserver(() => {
  if (resizeTimer !== null) {
    clearTimeout(resizeTimer);
  }
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    fit();
  }, RESIZE_DEBOUNCE_MS);
});
```

- [ ] **Step 2: Clear the timer on dispose**

In the same file, update `dispose()`:

```ts
function dispose(): void {
  if (resizeTimer !== null) {
    clearTimeout(resizeTimer);
  }
  observer.disconnect();
  term.dispose();
  element.remove();
}
```

- [ ] **Step 3: Type-check and manually verify resizing still works**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run tauri dev` — split into two panes, drag the divider, resize the window. Expected: terminal content refits ~90ms after you stop (slight delay is the accepted trade-off), no broken reflow.

- [ ] **Step 4: Commit**

```bash
git add src/terminal/pane.ts
git commit -m "perf: debounce pane ResizeObserver to avoid resize spam"
```

---

### Task 7: Terminal manager wiring (`displayTree` + `applyRatios` overlay)

The core integration. Rules that must hold (all from the spec — each guards a real bug):

1. `render()` builds DOM from the ORIGINAL `tree`, then overlays `applyRatios(container, displayTree())`. Building from the display tree would make `buildDivider` capture the expanded ratio (0.65) as its baseline, and since `onUp` fires even on a click without dragging, a mere divider click would commit 0.65 into the original tree and persist it.
2. `splitActive` assigns `activeId = pane.id` DIRECTLY (not via `setActive`) before `render()` — the new `setActive` calls `applyRatios` and the DOM does not yet match the just-split tree at that point. Same pattern as `closePane`/`respawn`.
3. `applySettings` always calls `applyRatios(container, displayTree())` — idempotent: mode off → display tree equals the original tree.
4. `serializeLayout()` is untouched.

**Files:**

- Modify: `src/terminal/terminal-manager.ts`

**Interfaces:**

- Consumes: `expandForPane` (Task 2), `applyRatios` (Task 3), `settings.value.focusExpand` (Task 4).
- Produces: no public API change — `TerminalManager` interface is untouched. Behavior: `applySettings` re-applies display ratios (Task 8's toggle relies on this).

- [ ] **Step 1: Add imports and constant**

In `src/terminal/terminal-manager.ts`:

Add `expandForPane` to the import from `../lib/split-tree` (line 4–19). Add `applyRatios` to the import from `./layout` (line 21):

```ts
import { applyRatios, renderTree } from "./layout";
```

Add below `INITIAL_ROWS` (line 27):

```ts
// Minimum share the active pane gets on each split along its path (Focus Expand)
const EXPAND_RATIO = 0.65;
```

- [ ] **Step 2: Add `displayTree()`**

Insert after `isInTree` (line 119):

```ts
/** Tree used for display: expand overlay when the mode is on, else the original. */
function displayTree(): TreeNode | null {
  if (!tree) {
    return null;
  }
  if (!settings.value.focusExpand || panes.size <= 1 || activeId === null) {
    return tree;
  }
  return expandForPane(tree, activeId, EXPAND_RATIO);
}
```

(`TreeNode` is already imported as a type.)

- [ ] **Step 3: Overlay in `render()` and re-apply after ratio commits**

Replace the current `render()` (lines 121–140) with:

```ts
function render(): void {
  if (!tree) {
    return;
  }
  container.classList.toggle("has-multiple-panes", panes.size > 1);
  // Build from the ORIGINAL tree so dividers capture original ratios as
  // their commit baseline (onUp fires even on a click without dragging).
  renderTree(container, tree, {
    getPaneElement: (id) => panes.get(id)?.element,
    isActive: (id) => id === activeId,
    highlightActive: panes.size > 1,
    onRatioCommit(path, ratio) {
      if (tree) {
        tree = setRatio(tree, path, ratio);
        // Re-apply the expand overlay on top of the new committed ratio
        applyRatios(container, displayTree());
        callbacks.onLayoutChange();
      }
    },
  });
  for (const id of leafIds(tree)) {
    panes.get(id)?.mount();
  }
  // Overlay the expand ratios without rebuilding (animates via CSS)
  applyRatios(container, displayTree());
}
```

- [ ] **Step 4: Apply ratios on focus change**

Replace `setActive` (lines 142–148) with:

```ts
function setActive(id: number): void {
  if (activeId === id) {
    return;
  }
  activeId = id;
  updateActiveClasses();
  applyRatios(container, displayTree());
}
```

- [ ] **Step 5: Fix `splitActive` ordering**

In `splitActive` (lines 254–276), replace:

```ts
tree = splitLeaf(tree, targetId, pane.id, dir);
render();
setActive(pane.id);
pane.focus();
```

with:

```ts
tree = splitLeaf(tree, targetId, pane.id, dir);
// Assign directly instead of setActive: setActive applies ratios to the
// DOM, which does not match the just-split tree until render() runs.
activeId = pane.id;
render();
pane.focus();
```

(`render()` sets the `is-active` classes itself via its `isActive` callback, and the subsequent `pane.focus()` → `focusin` → `setActive(pane.id)` is an early-return no-op.)

- [ ] **Step 6: Re-apply ratios in `applySettings`**

Replace the manager's `applySettings` (lines 362–366) with:

```ts
    applySettings(next) {
      for (const pane of panes.values()) {
        pane.applySettings(next);
      }
      // Idempotent: mode off → displayTree() is the original tree, so this
      // also restores the original layout when the toggle turns off.
      applyRatios(container, displayTree());
    },
```

(`applyRatios` no-ops when `displayTree()` returns null — settings can change before `initFresh`, e.g. via `useSignalEffect` in `app.tsx`.)

- [ ] **Step 7: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 8: Manual sanity check in the app**

Run: `npm run tauri dev`. Focus Expand cannot be toggled from the UI yet — flip it by editing the settings file, from a separate terminal:

```bash
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home() / "Library/Application Support/com.stackgrid.app/settings.json"
data = json.loads(p.read_text())
data["settings"]["focusExpand"] = True
p.write_text(json.dumps(data))
print("focusExpand -> True")
EOF
```

(If the path does not exist, find it: `find ~/Library/Application\ Support -name "settings.json" -path "*stackgrid*" 2>/dev/null` — the identifier is in `src-tauri/tauri.conf.json`. Restart the app after editing since the file is only read at startup.)

Expected with 3 panes and mode on: active pane is visibly larger; clicking another pane animates the swap; ⌘] / ⌘[ also swap; clicking a divider without dragging does NOT change the original ratios (verify: toggle the setting back to false, restart — layout matches what you had before expanding).

- [ ] **Step 9: Commit**

```bash
git add src/terminal/terminal-manager.ts
git commit -m "feat: overlay focus-expand ratios in terminal manager"
```

---

### Task 8: Toggle wiring — shortcut handler, tab-bar button, app glue

**Files:**

- Modify: `src/terminal/tab-manager.ts` (handleShortcut, line 272–300)
- Modify: `src/ui/tab-bar.tsx` (props + icon + button)
- Modify: `src/ui/app.tsx` (pass props)

**Interfaces:**

- Consumes: `"toggle-expand"` action (Task 5), `focusExpand` setting (Task 4), `updateSettings` from `settings-store.ts`. The settings change propagates to every manager through the existing `useSignalEffect` → `tabsRef.applySettings` path in `app.tsx` (Task 7 made `applySettings` re-apply ratios).
- Produces: `TabBarProps` gains `expandActive: boolean` and `onToggleExpand(): void`.

- [ ] **Step 1: Handle the shortcut in `tab-manager.ts`**

`tab-manager.ts` already imports `settings` from `../settings/settings-store`; also import `updateSettings`:

```ts
import { settings, updateSettings } from "../settings/settings-store";
```

Add a case to the `switch` in `handleShortcut` (after `"focus-prev"`):

```ts
      case "toggle-expand":
        updateSettings({ focusExpand: !settings.value.focusExpand });
        break;
```

- [ ] **Step 2: Add the button to `tab-bar.tsx`**

Add to `TabBarProps`:

```ts
  expandActive: boolean;
  onToggleExpand(): void;
```

Add an icon component next to the existing ones (rectangle with outward arrows — "expand" motif, consistent 24×24 outline style):

```tsx
function ExpandIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4.5H6a1.5 1.5 0 0 0-1.5 1.5v3" />
      <path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v3" />
      <path d="M9 19.5H6A1.5 1.5 0 0 1 4.5 18v-3" />
      <path d="M15 19.5h3a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </svg>
  );
}
```

Add the button in `tabbar__actions`, after the Close-pane button and before the `tabbar__sep`:

```tsx
<button
  type="button"
  class={`iconbtn ${props.expandActive ? "is-active" : ""}`}
  title="Focus expand (⌘E)"
  aria-label="Toggle focus expand"
  aria-pressed={props.expandActive}
  onClick={props.onToggleExpand}
>
  <ExpandIcon />
</button>
```

- [ ] **Step 3: Wire the props in `app.tsx`**

`app.tsx` already imports `settings` and `updateSettings`. Add to the `<TabBar ...>` element (after `onClosePane`):

```tsx
        expandActive={settings.value.focusExpand}
        onToggleExpand={() =>
          updateSettings({ focusExpand: !settings.value.focusExpand })
        }
```

(Reading `settings.value` in JSX subscribes the component to the signal, so the button state updates on ⌘E too.)

- [ ] **Step 4: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests PASS.

- [ ] **Step 5: Quick manual check**

Run: `npm run tauri dev`. With 2+ panes: press ⌘E → button lights up and the active pane expands; press again → layout returns to the original. Clicking the button does the same.

- [ ] **Step 6: Commit**

```bash
git add src/terminal/tab-manager.ts src/ui/tab-bar.tsx src/ui/app.tsx
git commit -m "feat: wire focus-expand toggle to Cmd+E and tab bar button"
```

---

### Task 9: Full manual verification (spec checklist)

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 2: Walk the spec's manual checklist**

Run: `npm run tauri dev` and verify each item:

1. Create 3+ panes mixing row and column splits (⌘D, ⌘⇧D). Turn on ⌘E. Click panes and use ⌘] / ⌘[ — the focused pane expands smoothly (~150ms) on BOTH axes when its path has both directions; the previous one shrinks back to its original share.
2. **Divider click regression (review blocker #1):** with the mode ON, click a divider on the active pane's path WITHOUT dragging. Then toggle the mode OFF — the layout must return to the exact pre-expand ratios (the click must not have committed 0.65).
3. Drag a divider with the mode on — no animation lag while dragging (transition disabled via `is-resizing`); on release the expand re-applies on top of the new committed ratio.
4. Single pane + mode on: nothing changes.
5. Close the active pane (⌘⇧W) while expanded — the next pane becomes active and expands; no stale layout.
6. Type `exit` in an expanded pane (with 2+ panes) — pane auto-closes, layout stays correct.
7. Open the settings panel while a pane is expanded — the pane stays expanded (accepted behavior).
8. Quit and relaunch with the mode on — the mode is still on (persisted) and the restored layout uses ORIGINAL ratios as its base (session never stored 0.65).
9. Toggle the mode off — immediate (animated) return to the original layout.

- [ ] **Step 3: Report results**

Report any failing item with what was observed; do not mark the feature done until every item passes.
