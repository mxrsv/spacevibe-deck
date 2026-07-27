import { describe, expect, it } from "vitest";
import {
  ACTION_REGISTRY,
  DEFAULT_KEYMAP,
  isActionId,
  type KeyBinding,
} from "./action-registry";

describe("ACTION_REGISTRY", () => {
  it("has no two rows with the same id", () => {
    const ids = ACTION_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every DEFAULT_KEYMAP binding's action is a real action id", () => {
    for (const binding of DEFAULT_KEYMAP) {
      expect(isActionId(binding.action)).toBe(true);
    }
  });

  it("every action with a menu entry has a non-empty label", () => {
    for (const action of ACTION_REGISTRY) {
      if ("menu" in action) {
        expect(action.label.length).toBeGreaterThan(0);
      }
    }
  });

  // Proves the lift/growth of the action set is exactly what's intended, not
  // an accidental drop or add. 28 = the 27 that keymap.ts's ShortcutAction
  // union declared as of Task 3, plus "new-preset" (Task 4 — unifies the
  // menu's "New Layout Preset…" into the same action:/runAction path as
  // every other item; see docs/plans/2026-07-27-action-registry.md Task 4
  // and the NOTE above ACTION_REGISTRY in action-registry.ts for the earlier
  // 25→27 correction). 33 = 28 + swap-left/right/up/down (FR-032, Task 1) +
  // open-tab-options (Task 2) — docs/plans/2026-07-27-keyboard-parity.md.
  it("has exactly the 33 action ids the registry declares as of keyboard-parity Task 2", () => {
    const ids = new Set(ACTION_REGISTRY.map((a) => a.id));
    expect(ids).toEqual(
      new Set([
        "toggle-settings",
        "new-tab",
        "reopen-tab",
        "open-tab-options",
        "close-pane",
        "close-tab",
        "find",
        "find-next",
        "find-previous",
        "clear-buffer",
        "split-row",
        "split-column",
        "toggle-zoom-pane",
        "toggle-expand",
        "zoom-in",
        "zoom-out",
        "zoom-reset",
        "focus-next-attention",
        "new-preset",
        "save-preset",
        "focus-next",
        "focus-prev",
        "focus-left",
        "focus-right",
        "focus-up",
        "focus-down",
        "swap-left",
        "swap-right",
        "swap-up",
        "swap-down",
        "next-tab",
        "prev-tab",
        "select-last-tab",
      ]),
    );
  });

  function chordKey(b: KeyBinding): string {
    const base = "code" in b ? `code:${b.code}` : `key:${b.key}`;
    return `${base}|${!!b.meta}|${!!b.shift}|${!!b.alt}|${!!b.ctrl}`;
  }

  // Same-kind only: every pair of CharKeyBindings compared by `key`, every
  // pair of PhysicalKeyBindings compared by `code`, plus the four modifiers.
  // Does NOT claim to catch a cross-kind collision (one `code` and one `key`
  // binding matching the same real keydown) — with today's binding set that
  // cannot happen (no letter/digit key shares a `code` with `BracketLeft`/
  // `BracketRight`), so that broader claim would overstate this test's
  // coverage.
  it("has no two same-kind bindings matching the same chord", () => {
    const seen = new Set<string>();
    for (const binding of DEFAULT_KEYMAP) {
      const k = chordKey(binding);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
});

describe("isActionId", () => {
  it("accepts select-tab-1..8, rejects select-tab-9 (that's select-last-tab now) and select-tab-0", () => {
    expect(isActionId("select-tab-5")).toBe(true);
    expect(isActionId("select-tab-8")).toBe(true);
    expect(isActionId("select-tab-9")).toBe(false);
    expect(isActionId("select-tab-0")).toBe(false);
  });

  it("accepts select-last-tab", () => {
    expect(isActionId("select-last-tab")).toBe(true);
  });

  it("rejects a non-string and an unknown id", () => {
    expect(isActionId(undefined)).toBe(false);
    expect(isActionId(42)).toBe(false);
    expect(isActionId("split-diagonal")).toBe(false);
  });

  // Decoupled from any particular registry instance — same pattern as
  // matchBinding's `keymap` override parameter.
  it("accepts any id present in the given registry set, whether or not it has a binding", () => {
    const registryIds = new Set(["menu-only-action"]);
    expect(isActionId("menu-only-action", registryIds)).toBe(true);
    expect(isActionId("not-in-registry", registryIds)).toBe(false);
  });
});
