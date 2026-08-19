import { describe, expect, it } from "vitest";
import {
  ACTION_REGISTRY,
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  isActionId,
  type KeyBinding,
} from "./action-registry";

describe("ACTION_REGISTRY", () => {
  it("has no two rows with the same id", () => {
    const ids = ACTION_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every platform binding's action is a real action id", () => {
    for (const keymap of [MACOS_KEYMAP, WINDOWS_KEYMAP]) {
      for (const binding of keymap) {
        expect(isActionId(binding.action)).toBe(true);
      }
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
  // 25→27 correction). 38 = 28 + swap-left/right/up/down (Task 1) +
  // open-tab-options (Task 2) + copy-cwd (Task 3) + scroll-page-up/down,
  // scroll-to-top/bottom (Task 4) — docs/plans/2026-07-27-keyboard-parity.md.
  it("binds toggle-prompts on both platforms without colliding", () => {
    const mac = MACOS_KEYMAP.filter((binding) => binding.action === "toggle-prompts");
    const win = WINDOWS_KEYMAP.filter((binding) => binding.action === "toggle-prompts");
    expect(mac).toEqual([{ key: "p", meta: true, shift: true, action: "toggle-prompts" }]);
    expect(win).toEqual([{ key: "p", ctrl: true, shift: true, action: "toggle-prompts" }]);
    // It has a menu item, so the RULE above CharKeyBinding requires `key`.
    expect(mac[0]).not.toHaveProperty("code");
  });

  it("binds toggle-usage on both platforms without colliding", () => {
    const mac = MACOS_KEYMAP.filter((binding) => binding.action === "toggle-usage");
    const win = WINDOWS_KEYMAP.filter((binding) => binding.action === "toggle-usage");
    expect(mac).toEqual([{ key: "u", meta: true, shift: true, action: "toggle-usage" }]);
    expect(win).toEqual([{ key: "u", ctrl: true, shift: true, action: "toggle-usage" }]);
    // It has a menu item, so the RULE above CharKeyBinding requires `key`.
    expect(mac[0]).not.toHaveProperty("code");
  });

  it("binds toggle-explorer on both platforms without colliding", () => {
    const mac = MACOS_KEYMAP.filter((binding) => binding.action === "toggle-explorer");
    const win = WINDOWS_KEYMAP.filter((binding) => binding.action === "toggle-explorer");
    expect(mac).toEqual([{ key: "b", meta: true, shift: true, action: "toggle-explorer" }]);
    expect(win).toEqual([{ key: "b", ctrl: true, shift: true, action: "toggle-explorer" }]);
    // It has a menu item, so the RULE above CharKeyBinding requires `key`.
    expect(mac[0]).not.toHaveProperty("code");
  });

  it("binds save-file on macOS, and leaves bare Ctrl+S unbound on Windows (PTY-reserved)", () => {
    const mac = MACOS_KEYMAP.filter((binding) => binding.action === "save-file");
    const win = WINDOWS_KEYMAP.filter((binding) => binding.action === "save-file");
    expect(mac).toEqual([{ key: "s", meta: true, action: "save-file" }]);
    // Bare Ctrl+S stays PTY-reserved on Windows until an explicit binding
    // decision says otherwise (task-6 brief; spec
    // docs/specs/2026-08-12-file-explorer-design.md §4.3 only commits to
    // ⌘S) — asserting `[]` locks that deliberate absence in, so a future
    // add is a conscious edit here, not a silent gap.
    expect(win).toEqual([]);
    // It has a menu item, so the RULE above CharKeyBinding requires `key`.
    expect(mac[0]).not.toHaveProperty("code");
  });

  it("binds move-pane-to-new-window on both platforms without colliding", () => {
    const mac = MACOS_KEYMAP.filter((binding) => binding.action === "move-pane-to-new-window");
    const win = WINDOWS_KEYMAP.filter((binding) => binding.action === "move-pane-to-new-window");
    expect(mac).toEqual([{ key: "m", meta: true, shift: true, action: "move-pane-to-new-window" }]);
    expect(win).toEqual([{ key: "m", ctrl: true, shift: true, action: "move-pane-to-new-window" }]);
    // It has a menu item, so the RULE above CharKeyBinding requires `key`.
    expect(mac[0]).not.toHaveProperty("code");
  });

  // 51 = the 48 rows verified passing after Task 6's "save-file", plus the
  // Edit menu's "select-all"/"undo"/"redo" (2026-08-19) — routed through the
  // renderer because their native Cocoa roles cannot reach Monaco.
  it("has exactly the 52 action ids including updater menu actions", () => {
    const ids = new Set(ACTION_REGISTRY.map((a) => a.id));
    expect(ids).toEqual(
      new Set([
        "check-for-updates",
        "open-release-notes",
        "select-all",
        "undo",
        "redo",
        "toggle-settings",
        "toggle-prompts",
        "toggle-usage",
        "toggle-sessions",
        "move-pane-to-new-window",
        "new-tab",
        "reopen-tab",
        "close-pane",
        "close-tab",
        "find",
        "find-next",
        "find-previous",
        "clear-buffer",
        "copy-cwd",
        "copy-selection",
        "paste",
        "split-row",
        "split-column",
        "toggle-zoom-pane",
        "toggle-browser",
        "toggle-dock",
        "toggle-explorer",
        "toggle-expand",
        "zoom-in",
        "zoom-out",
        "zoom-reset",
        "focus-next-attention",
        "new-preset",
        "save-preset",
        "save-file",
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
        "scroll-page-up",
        "scroll-page-down",
        "scroll-to-top",
        "scroll-to-bottom",
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
  it.each([
    ["macOS", MACOS_KEYMAP],
    ["Windows", WINDOWS_KEYMAP],
  ] as const)("has no two same-kind bindings matching the same %s chord", (_, keymap) => {
    const seen = new Set<string>();
    for (const binding of keymap) {
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
