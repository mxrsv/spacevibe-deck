// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardOpen } from "../chrome/events";
import { installStageLauncherCloseGuard } from "../launcher/stage-launcher-close-guard";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { freshWindowFocusController, processInfo, setup } from "./tab-manager.fixtures";
import { activeTabIndex, tabViews } from "./tabs-store";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

/** One idle shell, so closing its tab asks nothing. */
const idleShell = new Map([[1, processInfo(1, null, "zsh", "idle-shell", null)]]);

let disposeGuard: () => void = () => {};

/** A desktop host whose dev flag decides whether the unfinished `stageLauncher` region is on. */
function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev", isDevelopment });
}

beforeEach(() => {
  windowFocus = freshWindowFocusController();
  settings.value = DEFAULT_SETTINGS;
  tabViews.value = [];
  activeTabIndex.value = -1;
  boardOpen.value = false;
});

afterEach(() => {
  disposeGuard();
  disposeGuard = () => {};
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  boardOpen.value = false;
  tabViews.value = [];
});

describe("closing the last tab through the real TabManager (AC-1)", () => {
  it("leaves no Open board up with stageLauncher on and the close guard installed", async () => {
    pinHost(true);
    const { tm } = setup({ infos: idleShell });
    await tm.materialize({ layout: null, cwds: [] });
    expect(tabViews.value).toHaveLength(1);
    disposeGuard = installStageLauncherCloseGuard();
    await tm.closeTab(0);
    expect(tabViews.value).toHaveLength(0);
    expect(boardOpen.value).toBe(false);
    tm.dispose();
  });

  it("raises the Open board as before with stageLauncher off", async () => {
    pinHost(false);
    const { tm } = setup({ infos: idleShell });
    await tm.materialize({ layout: null, cwds: [] });
    disposeGuard = installStageLauncherCloseGuard();
    await tm.closeTab(0);
    expect(boardOpen.value).toBe(true);
    tm.dispose();
  });
});

describe("the open-folder action through TabManager", () => {
  it("calls deps.onOpenFolder once with stageLauncher on", () => {
    pinHost(true);
    const onOpenFolder = vi.fn();
    const { tm } = setup({ deps: { onOpenFolder } });
    tm.runAction("open-folder");
    expect(onOpenFolder).toHaveBeenCalledOnce();
    tm.dispose();
  });

  it("does nothing with stageLauncher off", () => {
    pinHost(false);
    const onOpenFolder = vi.fn();
    const { tm } = setup({ deps: { onOpenFolder } });
    tm.runAction("open-folder");
    expect(onOpenFolder).not.toHaveBeenCalled();
    tm.dispose();
  });
});
