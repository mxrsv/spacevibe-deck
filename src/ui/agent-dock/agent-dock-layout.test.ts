// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { AGENT_DOCK_WIDTH, dockStageWidth } from "./agent-dock-layout";

/** Pin the host the way `action-availability.test.ts` does; the switch follows `isDevelopment`. */
function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

const STORED = 400;

beforeEach(() => resizeTo(1440));

afterEach(() => {
  resizeTo(1024);
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("the width the stage leaves for the dock", () => {
  it.each([
    ["no host (a unit test)", () => undefined],
    ["a packaged host", () => pinHost(false)],
  ])("is the stored width, untouched, with the switch off: %s", (_label, setUp) => {
    setUp();
    expect(dockStageWidth(STORED)).toBe(STORED);
    resizeTo(1000);
    expect(dockStageWidth(STORED)).toBe(STORED);
  });

  it("rests at 320px with the switch on while the stored width is still the default", () => {
    pinHost(true);
    expect(dockStageWidth(DEFAULT_SETTINGS.dockWidth)).toBe(AGENT_DOCK_WIDTH);
    expect(AGENT_DOCK_WIDTH).toBe(320);
  });

  it("honours a width the user dragged to, and follows the pointer during a drag", () => {
    pinHost(true);
    expect(dockStageWidth(480)).toBe(480);
    expect(dockStageWidth(DEFAULT_SETTINGS.dockWidth, 520)).toBe(520);
  });

  it("keeps a wide width on a big window and trims it when the window is smaller", () => {
    pinHost(true);
    resizeTo(1920);
    expect(dockStageWidth(1100)).toBe(1100);
    resizeTo(1440);
    expect(dockStageWidth(1100)).toBe(840);
  });

  it("follows the pointer in the legacy dock too, with the switch off", () => {
    pinHost(false);
    expect(dockStageWidth(STORED, 520)).toBe(520);
  });

  it("keeps the 320px column in a narrow window instead of shrinking to a handle", () => {
    pinHost(true);
    resizeTo(1000);
    expect(dockStageWidth(DEFAULT_SETTINGS.dockWidth)).toBe(AGENT_DOCK_WIDTH);
  });
});
