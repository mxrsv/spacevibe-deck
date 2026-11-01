// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { mount } from "../controls/preset-test-kit";
import { DockSlot } from "./dock-slot";

/** What `app.tsx` mounts: both columns offered, the switch decides. */
function Entrance() {
  return (
    <DockSlot legacy={<aside data-column="legacy" />} stacked={<aside data-column="stacked" />} />
  );
}

/** Pin the host the way `action-availability.test.ts` does; the switch follows `isDevelopment`. */
function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

const columns = (): (string | null)[] =>
  [...document.body.querySelectorAll("[data-column]")].map((column) =>
    column.getAttribute("data-column"),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("the dock entrance with the agentDock switch off", () => {
  it.each([
    ["no host (a unit test)", false],
    ["a packaged host", true],
  ])("keeps the tabbed column with %s", async (_label, pinned) => {
    if (pinned) pinHost(false);
    await mount(<Entrance />);
    expect(columns()).toEqual(["legacy"]);
  });
});

describe("the dock entrance with the agentDock switch on", () => {
  it("shows the stacked dock in place of the tabbed column", async () => {
    pinHost(true);
    await mount(<Entrance />);
    expect(columns()).toEqual(["stacked"]);
  });
});
