// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardOpen } from "../chrome/events";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { tabViews, type TabView } from "../terminal/tabs-store";
import { installStageLauncherCloseGuard } from "./stage-launcher-close-guard";

const oneTab = [{ key: "t1" }] as unknown as readonly TabView[];
let dispose: () => void = () => {};

function pinSwitches(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

/** The order `disposeTab` writes in: the board first, then the views. */
function closeLastTab(): void {
  boardOpen.value = true;
  tabViews.value = [];
}

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  boardOpen.value = false;
  tabViews.value = [];
});

describe("closing the last tab with stageLauncher on", () => {
  beforeEach(() => {
    pinSwitches(true);
    tabViews.value = oneTab;
    boardOpen.value = false;
    dispose = installStageLauncherCloseGuard();
  });

  it("leaves no Open board up, before any render can mount it", () => {
    closeLastTab();
    expect(boardOpen.value).toBe(false);
  });

  it("keeps the board while another tab is still live", () => {
    tabViews.value = [...oneTab, { key: "t2" } as unknown as TabView];
    boardOpen.value = true;
    tabViews.value = oneTab;
    expect(boardOpen.value).toBe(true);
  });

  it("keeps a board opened on an already-empty window", () => {
    closeLastTab();
    boardOpen.value = true;
    expect(boardOpen.value).toBe(true);
  });
});

describe("closing the last tab with stageLauncher off", () => {
  it("raises the Open board as before", () => {
    pinSwitches(false);
    tabViews.value = oneTab;
    dispose = installStageLauncherCloseGuard();
    closeLastTab();
    expect(boardOpen.value).toBe(true);
  });
});
