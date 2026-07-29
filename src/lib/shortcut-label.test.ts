import { describe, expect, it } from "vitest";
import type { KeyBinding } from "../terminal/action-registry";
import {
  formatShortcutBinding,
  shortcutLabel,
} from "./shortcut-label";

describe("shortcutLabel", () => {
  it("preserves the preferred macOS labels", () => {
    expect({
      splitRow: shortcutLabel("split-row", "macos"),
      splitColumn: shortcutLabel("split-column", "macos"),
      closePane: shortcutLabel("close-pane", "macos"),
      expand: shortcutLabel("toggle-expand", "macos"),
      settings: shortcutLabel("toggle-settings", "macos"),
      zoom: shortcutLabel("zoom-in", "macos"),
    }).toEqual({
      splitRow: "⌘D",
      splitColumn: "⌘⇧D",
      closePane: "⌘W",
      expand: "⌘E",
      settings: "⌘,",
      zoom: "⌘=",
    });
  });

  it("formats the preferred Windows labels from WINDOWS_KEYMAP", () => {
    expect({
      splitRow: shortcutLabel("split-row", "windows"),
      splitColumn: shortcutLabel("split-column", "windows"),
      closePane: shortcutLabel("close-pane", "windows"),
      copyCwd: shortcutLabel("copy-cwd", "windows"),
      findNext: shortcutLabel("find-next", "windows"),
      nextTab: shortcutLabel("next-tab", "windows"),
      zoom: shortcutLabel("zoom-in", "windows"),
    }).toEqual({
      splitRow: "Ctrl+Shift+D",
      splitColumn: "Ctrl+Alt+Shift+D",
      closePane: "Ctrl+Shift+W",
      copyCwd: "Ctrl+Alt+Shift+C",
      findNext: "F3",
      nextTab: "Ctrl+Tab",
      zoom: "Ctrl+=",
    });
  });

  it("formats non-registry pointer gestures with the same platform rules", () => {
    const macOpen: KeyBinding = { key: "o", meta: true, action: "new-tab" };
    const windowsOpen: KeyBinding = {
      key: "o",
      ctrl: true,
      shift: true,
      action: "new-tab",
    };

    expect(formatShortcutBinding(macOpen, "macos")).toBe("⌘O");
    expect(formatShortcutBinding(windowsOpen, "windows")).toBe(
      "Ctrl+Shift+O",
    );
  });
});
