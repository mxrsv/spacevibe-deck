// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
  isPrimaryModifierHeld,
  onPrimaryModifierChange,
  syncPrimaryModifierHeld,
} from "./primary-modifier";

describe("primary modifier held state", () => {
  afterEach(() => {
    syncPrimaryModifierHeld({ metaKey: false, ctrlKey: false });
    resetDesktopEnvironmentForTests();
  });

  it("tracks Cmd on macOS and Ctrl on Windows", () => {
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    syncPrimaryModifierHeld({ metaKey: true, ctrlKey: false });
    expect(isPrimaryModifierHeld()).toBe(true);

    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    syncPrimaryModifierHeld({ metaKey: true, ctrlKey: false });
    expect(isPrimaryModifierHeld()).toBe(false);
    syncPrimaryModifierHeld({ metaKey: false, ctrlKey: true });
    expect(isPrimaryModifierHeld()).toBe(true);
  });

  it("notifies subscribers only when held state changes", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const changes: boolean[] = [];
    const unsubscribe = onPrimaryModifierChange((held) => changes.push(held));

    syncPrimaryModifierHeld({ metaKey: false, ctrlKey: true });
    syncPrimaryModifierHeld({ metaKey: true, ctrlKey: true });
    syncPrimaryModifierHeld({ metaKey: false, ctrlKey: false });
    unsubscribe();

    expect(changes).toEqual([true, false]);
  });
});
