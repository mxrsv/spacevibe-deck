# Performable Keybindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows, Ctrl+C copies the terminal selection when there is one and reaches the PTY as an interrupt when there is not.

**Architecture:** A pure predicate module answers "can this action do anything right now" from a context value. `handleShortcut` consults it before `preventDefault()`, so a binding that cannot perform behaves as if it did not exist and the key continues to whatever holds focus. Two clipboard actions register predicates: `copy-selection` (stage-conditional) and a new `copy-or-interrupt` (stage- and selection-conditional, and it clears the selection).

**Tech Stack:** TypeScript, Preact signals, xterm.js, Vitest.

**Spec:** [docs/specs/2026-08-20-performable-keybindings-design.md](../specs/2026-08-20-performable-keybindings-design.md)

## Global Constraints

- **English only** for strings, comments, docs and commit messages (AGENTS.md R1).
- **Renderer-only.** No IPC channel, no main-process change, no `electron/menu.ts` edit. The change reaches both hosts.
- **macOS keymap is untouched.** ⌘C stays the native Cocoa Copy role. Every new binding lands in `WINDOWS_KEYMAP` only.
- **Fail toward the PTY.** Any unresolvable context answers `false` from the predicate, so the key is not consumed.
- **`dispatchAction` keeps `overlayBlocksAction` unchanged.** It still guards the macOS menu path, which never passes through `handleShortcut`.
- **No commit of `docs/`** without the owner approving the content (D14). Task 6 writes docs; do not commit them until told.
- **Do not run `git add .`.** The working tree carries other sessions' uncommitted work. Always `git commit -- <explicit paths>`.

---

### Task 1: Selection queries on the pane and manager seam

**Files:**

- Modify: `src/terminal/pane.ts` (the `Pane` interface near line 76, and the returned object near line 468)
- Modify: `src/terminal/terminal-manager.ts` (near `copyActiveSelection` at line 711)
- Test: `src/terminal/terminal-manager.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `Pane.hasSelection(): boolean`, `Pane.clearSelection(): void`, `TerminalManager.activeHasSelection(): boolean`, `TerminalManager.clearActiveSelection(): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/terminal/terminal-manager.test.ts`, inside the existing top-level `describe` for the manager:

```ts
it("reports and clears the active pane's selection", () => {
  const manager = createManagerForTest();
  const pane = manager.__testPane();
  pane.selection = "hello";

  expect(manager.activeHasSelection()).toBe(true);
  manager.clearActiveSelection();
  expect(manager.activeHasSelection()).toBe(false);
});

it("answers false for a selection when there is no active pane", () => {
  const manager = createManagerForTest({ activePane: null });
  expect(manager.activeHasSelection()).toBe(false);
});
```

Adapt `createManagerForTest` / `__testPane` to whatever fixture helper the file already uses — read the top of `terminal-manager.test.ts` first and follow it exactly rather than introducing a new helper.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/terminal-manager.test.ts -t "selection"`
Expected: FAIL with `manager.activeHasSelection is not a function`.

- [ ] **Step 3: Add the two methods to the `Pane` interface**

In `src/terminal/pane.ts`, beside `copySelection(): void;` at line 76:

```ts
  /** Whether the terminal currently holds a selection. */
  hasSelection(): boolean;
  /**
   * Drop the selection. Separate from `copySelection` because only
   * `copy-or-interrupt` clears — a plain copy keeps the highlight
   * (spec D3).
   */
  clearSelection(): void;
```

- [ ] **Step 4: Implement them on the returned pane object**

In the same file, beside the existing `copySelection()` implementation near line 468:

```ts
    hasSelection: () => term.hasSelection(),
    clearSelection: () => term.clearSelection(),
```

- [ ] **Step 5: Add the manager-level queries**

In `src/terminal/terminal-manager.ts`, directly after `copyActiveSelection()` (line 711):

```ts
    activeHasSelection() {
      return (
        activeId !== null && (life.panes.get(activeId)?.hasSelection() ?? false)
      );
    },
    clearActiveSelection() {
      if (activeId !== null) {
        life.panes.get(activeId)?.clearSelection();
      }
    },
```

Add both to the manager's exported interface/type in the same file, matching how `copyActiveSelection` is declared there.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/terminal/terminal-manager.test.ts src/terminal/pane-renderer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -- src/terminal/pane.ts src/terminal/terminal-manager.ts src/terminal/terminal-manager.test.ts -m "feat(terminal): expose selection state on the pane and manager seam"
```

---

### Task 2: The performable predicate module

**Files:**

- Create: `src/terminal/action-performable.ts`
- Test: `src/terminal/action-performable.test.ts`

**Interfaces:**

- Consumes: `ShortcutAction` from `./action-registry`.
- Produces: `StageOwner`, `PerformableContext`, `isActionPerformable(action, context): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/action-performable.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isActionPerformable,
  type PerformableContext,
} from "./action-performable";

const context = (
  overrides: Partial<PerformableContext> = {},
): PerformableContext => ({
  stageOwner: "terminal",
  hasSelection: false,
  ...overrides,
});

describe("isActionPerformable", () => {
  it("answers true for an action with no predicate", () => {
    expect(isActionPerformable("split-row", context())).toBe(true);
    expect(
      isActionPerformable("split-row", context({ stageOwner: "surface" })),
    ).toBe(true);
  });

  it("lets copy-selection consume inside a terminal with no selection", () => {
    expect(isActionPerformable("copy-selection", context())).toBe(true);
  });

  it.each(["surface", "overlay"] as const)(
    "refuses copy-selection while %s owns the stage",
    (stageOwner) => {
      expect(
        isActionPerformable(
          "copy-selection",
          context({ stageOwner, hasSelection: true }),
        ),
      ).toBe(false);
    },
  );

  it("refuses copy-or-interrupt with no selection so the PTY gets the key", () => {
    expect(isActionPerformable("copy-or-interrupt", context())).toBe(false);
  });

  it("performs copy-or-interrupt with a selection in a terminal", () => {
    expect(
      isActionPerformable("copy-or-interrupt", context({ hasSelection: true })),
    ).toBe(true);
  });

  it("refuses copy-or-interrupt over a surface even with a selection", () => {
    expect(
      isActionPerformable(
        "copy-or-interrupt",
        context({ stageOwner: "surface", hasSelection: true }),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/action-performable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `src/terminal/action-performable.ts`:

```ts
/**
 * Whether a matched binding may CONSUME its keystroke.
 *
 * `handleShortcut` (tab-manager.ts) asks this before `preventDefault()`. A
 * false answer means the binding behaves as if it did not exist and the key
 * continues to whatever holds focus — Ghostty's `performable:` principle,
 * carried on the action rather than on the binding because Deck stores user
 * overrides per action and replaces an action's whole chord set
 * (`resolveKeymap`, src/lib/keybindings.ts), so two chords of one action
 * cannot differ in conditionality. See
 * docs/specs/2026-08-20-performable-keybindings-design.md D1.
 *
 * Deliberately pure: it reads a context value, never a signal, so the rules
 * are testable without mounting a tab manager.
 */
import type { ShortcutAction } from "./action-registry";

/** Which kind of thing currently owns the stage. */
export type StageOwner = "terminal" | "surface" | "overlay";

export interface PerformableContext {
  readonly stageOwner: StageOwner;
  /** Whether the ACTIVE TERMINAL PANE holds a selection. */
  readonly hasSelection: boolean;
}

type Predicate = (context: PerformableContext) => boolean;

/**
 * Only the clipboard actions so far. Every other action answers true, so this
 * table can take the remaining pane-scoped actions later as a data change
 * rather than a rework (spec, Non-goals).
 */
const PREDICATES: ReadonlyMap<ShortcutAction, Predicate> = new Map<
  ShortcutAction,
  Predicate
>([
  // Stage-conditional only: inside a terminal it keeps consuming even with no
  // selection, because nothing else wants Ctrl+Shift+C and leaking it into an
  // agent TUI has unspecified behaviour (spec D2).
  ["copy-selection", (context) => context.stageOwner === "terminal"],
  // Stage AND selection conditional: with no selection the key must reach the
  // PTY as the interrupt (spec D5).
  [
    "copy-or-interrupt",
    (context) => context.stageOwner === "terminal" && context.hasSelection,
  ],
]);

export function isActionPerformable(
  action: ShortcutAction,
  context: PerformableContext,
): boolean {
  const predicate = PREDICATES.get(action);
  return predicate === undefined ? true : predicate(context);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/terminal/action-performable.test.ts`
Expected: the `copy-or-interrupt` cases FAIL to typecheck until Task 3 adds the id. If `tsc` rejects `"copy-or-interrupt"`, do Task 3 Step 3 first, then return here. Every other case: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -- src/terminal/action-performable.ts src/terminal/action-performable.test.ts -m "feat(terminal): add the performable predicate for keybindings"
```

---

### Task 3: The `copy-or-interrupt` action

**Files:**

- Modify: `src/terminal/action-registry.ts` (after the `copy-selection` entry near line 299)
- Modify: `src/ui/settings/shortcut-groups.ts` (the `PLACEMENT` map, beside `"copy-selection": "text"` near line 85)
- Modify: `src/terminal/tab-manager.ts` (the `commands` table, beside `"copy-selection"` near line 1432)
- Test: `src/terminal/action-registry.test.ts`, `src/ui/settings/shortcut-groups.test.ts`

**Interfaces:**

- Consumes: `TerminalManager.copyActiveSelection()` and `clearActiveSelection()` from Task 1.
- Produces: the `copy-or-interrupt` `ActionId`, usable by Task 2's predicate table and Task 4's keymap.

- [ ] **Step 1: Write the failing test**

In `src/terminal/action-registry.test.ts`, add beside the other per-action lock-in tests:

```ts
it("ships copy-or-interrupt unbound on macOS and on Ctrl+C on Windows", () => {
  const mac = MACOS_KEYMAP.filter(
    (binding) => binding.action === "copy-or-interrupt",
  );
  const win = WINDOWS_KEYMAP.filter(
    (binding) => binding.action === "copy-or-interrupt",
  );
  // macOS has no conflict to solve: Cmd+C copies and Ctrl+C interrupts are
  // already two different keys, so binding here would invent a problem.
  expect(mac).toEqual([]);
  expect(win).toEqual([{ key: "c", ctrl: true, action: "copy-or-interrupt" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/action-registry.test.ts -t "copy-or-interrupt"`
Expected: FAIL — `win` is `[]`.

- [ ] **Step 3: Add the registry entry**

In `src/terminal/action-registry.ts`, immediately after the `copy-selection` entry:

```ts
  {
    id: "copy-or-interrupt",
    label: "Copy Selection or Interrupt",
    scope: "pane",
    // No `menu` field on purpose. A Cocoa menu accelerator is consumed before
    // the webview and would force the action regardless of whether it can be
    // performed — the reason Ghostty excludes performable binds from menus.
  },
```

- [ ] **Step 4: Bump the action-count assertion**

In `src/terminal/action-registry.test.ts`, find the test titled `has exactly the 52 action ids including updater menu actions`. Change `52` to `53` in both the title and the assertion, and extend the comment above it with:

```
// 53 = 52 + copy-or-interrupt (2026-08-20), the conditional Ctrl+C twin of
// copy-selection — docs/plans/2026-08-20-performable-keybindings.md.
```

- [ ] **Step 5: Place it in the Shortcuts section**

In `src/ui/settings/shortcut-groups.ts`, beside `"copy-selection": "text",`:

```ts
  "copy-or-interrupt": "text",
```

Without this, `shortcut-groups.test.ts` fails on its empty-`other` assertion.

- [ ] **Step 6: Add the command**

In `src/terminal/tab-manager.ts`, in the `commands` table beside `"copy-selection"`:

```ts
    // Only ever reached when the predicate said a selection exists, so this
    // never has to decide between copying and interrupting — the interrupt
    // branch is the KEY not being consumed, so xterm encodes it (spec).
    // The clear is synchronous after the text is read: `copyTerminalSelection`
    // writes the clipboard asynchronously, and clearing in its callback could
    // erase a selection the user made in the meantime (spec D4).
    "copy-or-interrupt": () => {
      const manager = activeManager();
      manager?.copyActiveSelection();
      manager?.clearActiveSelection();
    },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/terminal/action-registry.test.ts src/ui/settings/shortcut-groups.test.ts src/terminal/action-performable.test.ts`
Expected: `action-registry` still fails its new binding test (Task 4 adds the binding); everything else PASSES. `shortcut-groups.test.ts` must be green here — if `other` is non-empty for any id other than `copy-or-interrupt`, that is another session's work, not yours; leave it and say so.

- [ ] **Step 8: Commit**

```bash
git commit -- src/terminal/action-registry.ts src/ui/settings/shortcut-groups.ts src/terminal/tab-manager.ts src/terminal/action-registry.test.ts -m "feat(terminal): add the copy-or-interrupt action"
```

---

### Task 4: Bind Ctrl+C on Windows

**Files:**

- Modify: `src/terminal/default-keymaps.ts` (`WINDOWS_KEYMAP`, beside the `copy-selection` entry near line 306, and the doc comment above the keymap)
- Test: `src/terminal/keymap.test.ts`

**Interfaces:**

- Consumes: the `copy-or-interrupt` `ActionId` from Task 3.
- Produces: nothing later tasks read.

- [ ] **Step 1: Write the failing test**

In `src/terminal/keymap.test.ts`, add to the `WINDOWS_KEYMAP` `it.each` block that maps character chords:

```ts
    ["c", { ctrlKey: true }, "copy-or-interrupt"],
```

And add to the macOS `leaves Windows clipboard chords unbound on macOS` test:

```ts
expect(matchBinding(keyEvent("c", { ctrlKey: true }))).toBeNull();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/keymap.test.ts -t "fixed Windows modifiers"`
Expected: FAIL — `matchBinding` returns `null` for Ctrl+C.

- [ ] **Step 3: Add the binding**

In `src/terminal/default-keymaps.ts`, in `WINDOWS_KEYMAP` directly after the `copy-selection` entry:

```ts
  { key: "c", ctrl: true, action: "copy-or-interrupt" },
```

- [ ] **Step 4: Replace the keymap's clipboard paragraph**

The doc comment above `WINDOWS_KEYMAP` currently says bare Ctrl sequences stay available to the PTY except Ctrl+V. Replace that first paragraph with:

```
 * Windows Terminal-style chords keep conventional bare Ctrl sequences
 * available to the PTY, with two exceptions. Ctrl+V: Deck owns standard text
 * paste through Ctrl+V, Ctrl+Shift+V, and physical Shift+Insert; Alt+V remains
 * unbound so the active agent can handle it if that CLI supports the chord.
 * Ctrl+C: bound to `copy-or-interrupt`, which is PERFORMABLE — it consumes the
 * key only while a terminal pane owns the stage AND holds a selection, so with
 * nothing selected the key is never preventDefault()ed and xterm encodes the
 * interrupt itself. Deck writes no interrupt byte of its own; hardcoding
 * `\x03` would pin one encoding a different keyboard protocol does not use.
 * See action-performable.ts and
 * docs/specs/2026-08-20-performable-keybindings-design.md.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/terminal/keymap.test.ts src/terminal/action-registry.test.ts`
Expected: PASS, including Task 3's `ships copy-or-interrupt unbound on macOS` test.

- [ ] **Step 6: Commit**

```bash
git commit -- src/terminal/default-keymaps.ts src/terminal/keymap.test.ts -m "feat(terminal): bind Ctrl+C to copy-or-interrupt on Windows"
```

---

### Task 5: Consult the predicate before consuming the key

**Files:**

- Modify: `src/terminal/tab-manager.ts` (`handleShortcut` near line 1852; a new `performableContext` helper beside `openOverlayRanks` near line 1610)
- Test: `src/terminal/tab-manager.chord-actions.test.ts`

**Interfaces:**

- Consumes: `isActionPerformable` and `PerformableContext` from Task 2; `activeHasSelection()` from Task 1.
- Produces: nothing later tasks read. This is the task that makes the feature real — until it lands, Ctrl+C is bound but always consumed.

- [ ] **Step 1: Write the failing test**

Add to `src/terminal/tab-manager.chord-actions.test.ts`, following that file's existing mount/dispatch helpers:

```ts
it("does not consume Ctrl+C when the terminal has no selection", () => {
  const tm = mountWindowsTabManager();
  const event = ctrlKeyEvent("c");

  window.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  expect(pty.writes).toEqual([]);
  tm.dispose();
});

it("consumes Ctrl+C and clears the selection when there is one", () => {
  const tm = mountWindowsTabManager({ selection: "picked text" });
  const event = ctrlKeyEvent("c");

  window.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(clipboard.written).toEqual(["picked text"]);
  expect(manager.activeHasSelection()).toBe(false);
  tm.dispose();
});

it("does not consume Ctrl+Shift+C while a file surface owns the stage", () => {
  const tm = mountWindowsTabManager({ selection: "picked text" });
  openFileSurface();
  const event = ctrlShiftKeyEvent("c");

  window.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(false);
  tm.dispose();
});
```

Read the top of `tab-manager.chord-actions.test.ts` and reuse its real helper names; the three above are placeholders for whatever that file already calls them. Do NOT invent a second mounting helper.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/tab-manager.chord-actions.test.ts -t "Ctrl+C"`
Expected: FAIL — `defaultPrevented` is `true` in the first case, because the key is consumed unconditionally today.

- [ ] **Step 3: Add the context helper**

In `src/terminal/tab-manager.ts`, directly after `openOverlayRanks()`:

```ts
/**
 * Which kind of thing owns the stage, for `isActionPerformable`.
 *
 * `browserSurfaceActive` is read beside `surfaces.activeIndex()` rather than
 * trusted to be folded into it: the browser tab is a `SurfaceStrip` member,
 * but `openOverlayRanks` above does not mention it, and answering "terminal"
 * while a web view covers the stage would consume a key the page wanted.
 * Reading both fails toward not consuming, which is the safe direction.
 */
function stageOwner(): StageOwner {
  if (openOverlayRanks().length > 0) {
    return "overlay";
  }
  if (surfaces.activeIndex() >= 0 || browserSurfaceActive.value) {
    return "surface";
  }
  return "terminal";
}

function performableContext(): PerformableContext {
  return {
    stageOwner: stageOwner(),
    // `?? false` is the fail-toward-the-PTY rule (spec D5): no manager means
    // no selection means the key is not consumed.
    hasSelection: activeManager()?.activeHasSelection() ?? false,
  };
}
```

Add the imports at the top of the file:

```ts
import {
  isActionPerformable,
  type PerformableContext,
  type StageOwner,
} from "./action-performable";
```

`browserSurfaceActive` is already imported at line 70 — do not add it twice.

- [ ] **Step 4: Consult the predicate before consuming**

In `handleShortcut`, replace:

```ts
const action = matchBinding(event);
if (action === null) {
  return;
}
event.preventDefault();
event.stopPropagation();
dispatchAction(action);
```

with:

```ts
const action = matchBinding(event);
if (action === null) {
  return;
}
// BEFORE preventDefault, never after. `dispatchAction`'s own
// `overlayBlocksAction` runs too late to stop the key being swallowed, and
// that ordering is what made a matched-but-blocked chord a dead key over an
// open document. Returning here leaves the event alone so it reaches
// whatever holds focus — Monaco, a modal, or the pane's own xterm.
if (!isActionPerformable(action, performableContext())) {
  return;
}
event.preventDefault();
event.stopPropagation();
dispatchAction(action);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/terminal/tab-manager.chord-actions.test.ts src/terminal/tab-manager.overlay-guard.test.ts`
Expected: PASS. If `tab-manager.overlay-guard.test.ts` asserts that a blocked chord IS consumed, that assertion encodes the defect — update it and say so in the commit body.

- [ ] **Step 6: Run the full gate**

```bash
date "+GATE %Y-%m-%d %H:%M:%S"
npm test
npx tsc --noEmit
npx tsc -p tsconfig.electron.json --noEmit
npm run build
npm run generate:menu:check
```

Expected: green. The working tree carries other sessions' in-flight work, so a red file that you did not touch must be attributed by `git diff --stat <file>` and file mtime before you claim or deny it — never fix it, and never report it as yours.

- [ ] **Step 7: Commit**

```bash
git commit -- src/terminal/tab-manager.ts src/terminal/tab-manager.chord-actions.test.ts -m "fix(terminal): decide performability before consuming a chord"
```

---

### Task 6: Documentation

**Files:**

- Modify: `AGENTS.md` (the "Current direction" list)
- Modify: `docs/CONTEXT.md` (a new dated section, and the verification-state ledger)

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the CONTEXT.md section**

Add a section titled `### Performable keybindings and Ctrl+C — 2026-08-20` covering: the ordering defect and what it cost; why the predicate sits on the action and not on the binding; why Deck writes no interrupt byte; the two-press cost of cancelling after a selection; and that Gate C means renderer-verified, never Windows-verified.

- [ ] **Step 2: Add the AGENTS.md bullet**

One bullet in "Current direction" naming the behaviour, the host reach (both — renderer only), the evidence class actually obtained, and the known gap that macOS menu-bound chords still die over a file surface.

- [ ] **Step 3: Add the ledger row**

In the `Chưa khớp thực tế` table, add:

| Claim                                  | Intent     | Status     | Evidence                                                                          |
| -------------------------------------- | ---------- | ---------- | --------------------------------------------------------------------------------- |
| Ctrl+C copies or interrupts on Windows | `building` | unverified | Landed 2026-08-20; suite, typecheck and build only — no Windows hardware (Gate C) |

- [ ] **Step 4: Run the documentation gate**

```bash
bash ~/.claude/scripts/docs-compliance.sh
bash ~/.claude/scripts/docs-anchors.sh
```

- [ ] **Step 5: STOP — do not commit**

Per D14, the owner reviews documentation content before it is committed. Report that Tasks 1–5 are committed and Task 6 is written but uncommitted, and wait.

---

## Self-review

**Spec coverage.** D1 → Task 2's action-keyed table. D2 → Task 2's `copy-selection` predicate. D3 → Task 3 Step 6. D4 → the comment and synchronous ordering in Task 3 Step 6. D5 → Task 5 Step 3's `?? false`. D6 → Task 4. The spec's "interrupt comes from xterm, not from Deck" → Task 4 Step 4's comment plus the absence of any `writePty` call anywhere in this plan. The spec's browser-surface risk → Task 5 Step 3.

**Type consistency.** `hasSelection()` / `clearSelection()` on `Pane`; `activeHasSelection()` / `clearActiveSelection()` on `TerminalManager`; `isActionPerformable(action, context)`, `PerformableContext`, `StageOwner` from `action-performable.ts`. The same names are used in Tasks 1, 2, 3 and 5.

**Known ordering wrinkle.** Task 2's test references `"copy-or-interrupt"` before Task 3 creates the id. Task 2 Step 4 says so and points at the fix. Executing Task 3 before Task 2 also works.

**Not covered, on purpose.** The macOS menu-accelerator half, Ctrl+Insert, and the remaining ~18 pane-scoped actions. Each is named in the spec's Non-goals or Known gap.
