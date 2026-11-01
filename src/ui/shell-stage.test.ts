// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { shellStageEnabled } from "./shell-stage";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

describe("the flush stage switch", () => {
  it("is off in a unit test, where no host says it is a development build", () => {
    expect(shellStageEnabled()).toBe(false);
  });

  it.each([
    ["a packaged host", false],
    ["a development host", true],
  ])("follows the host's identity: %s", (_label, isDevelopment) => {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
    expect(shellStageEnabled()).toBe(isDevelopment);
  });
});
