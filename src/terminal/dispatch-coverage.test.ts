import { describe, expect, it } from "vitest";
import { MACOS_KEYMAP, WINDOWS_KEYMAP } from "./keymap";
import { DISPATCHABLE_ACTIONS } from "./tab-action-scope";

/**
 * Prior review H1 and pre-ship audit A4 were the same defect twice: a chord
 * resolved in the keymap to an action with no dispatch target, and
 * `commands[action]?.()` swallowed it silently. Both times the suite passed
 * because it only asserted that the binding and the action id existed.
 */
describe("keymap dispatch coverage", () => {
  it.each([
    ["MACOS_KEYMAP", MACOS_KEYMAP],
    ["WINDOWS_KEYMAP", WINDOWS_KEYMAP],
  ] as const)("every %s action has a dispatch target", (_name, keymap) => {
    const orphans = keymap
      .map((binding) => binding.action)
      .filter((action) => !DISPATCHABLE_ACTIONS.has(action));

    expect(orphans).toEqual([]);
  });
});
