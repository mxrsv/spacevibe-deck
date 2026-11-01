// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import {
  AGENT_DOCK_EDGE_WIDTH,
  AGENT_DOCK_NARROW_BELOW,
  AGENT_DOCK_WIDTH,
  dockNarrow,
  dockStageWidth,
} from "./agent-dock-layout";

/** Pin the host the way `action-availability.test.ts` does; the switch follows `isDevelopment`. */
function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

const STORED = 420;

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

  it("is a fixed 320px with the switch on and room for it, whatever width is stored", () => {
    pinHost(true);
    expect(dockStageWidth(STORED)).toBe(AGENT_DOCK_WIDTH);
    expect(dockStageWidth(260)).toBe(AGENT_DOCK_WIDTH);
    expect(AGENT_DOCK_WIDTH).toBe(320);
  });

  it("shrinks to the 32px handle under 1360px and grows back at 1360px", () => {
    pinHost(true);
    resizeTo(AGENT_DOCK_NARROW_BELOW - 1);
    expect(dockNarrow.value).toBe(true);
    expect(dockStageWidth(STORED)).toBe(AGENT_DOCK_EDGE_WIDTH);
    expect(AGENT_DOCK_EDGE_WIDTH).toBe(32);

    resizeTo(AGENT_DOCK_NARROW_BELOW);
    expect(dockNarrow.value).toBe(false);
    expect(dockStageWidth(STORED)).toBe(AGENT_DOCK_WIDTH);
  });
});
