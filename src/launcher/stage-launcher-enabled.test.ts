// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";

const pinned = vi.hoisted(() => ({ switches: null as Readonly<Record<string, boolean>> | null }));

// Real switch resolution unless a test pins a snapshot; `isRegisteredActionAvailable` keeps using
// the module's own, unmocked reader.
vi.mock("../terminal/action-availability", async (original) => {
  const actual = await original<typeof import("../terminal/action-availability")>();
  return {
    ...actual,
    rendererReleaseSwitches: () => pinned.switches ?? actual.rendererReleaseSwitches(),
  };
});

import { isRegisteredActionAvailable } from "../terminal/action-availability";
import { stageLauncherEnabled } from "./stage-launcher-enabled";

function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

afterEach(() => {
  pinned.switches = null;
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("stageLauncherEnabled", () => {
  it("is on only when stageLauncher and projectRail are both on", () => {
    pinned.switches = { stageLauncher: true, projectRail: true };
    expect(stageLauncherEnabled()).toBe(true);
  });

  it("is off with stageLauncher on and projectRail off: the launcher needs the rail beside it", () => {
    pinned.switches = { stageLauncher: true, projectRail: false };
    expect(stageLauncherEnabled()).toBe(false);
  });

  it("is off with stageLauncher off", () => {
    pinned.switches = { stageLauncher: false, projectRail: true };
    expect(stageLauncherEnabled()).toBe(false);
  });
});

describe("the open-folder action's availability", () => {
  it("is unavailable with the stageLauncher switch off (packaged build)", () => {
    pinHost(false);
    expect(isRegisteredActionAvailable("open-folder")).toBe(false);
  });

  it("is available with the stageLauncher switch on (development build)", () => {
    pinHost(true);
    expect(isRegisteredActionAvailable("open-folder")).toBe(true);
  });
});
