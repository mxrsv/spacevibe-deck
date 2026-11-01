// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";

vi.mock("../lib/release-switches", async (original) => {
  const actual = await original<typeof import("../lib/release-switches")>();
  return {
    ...actual,
    resolveReleaseSwitches: (development: boolean) =>
      actual.resolveReleaseSwitches(development, {
        preview: { enabled: false, createdOn: "2026-10-03" },
      }),
  };
});
vi.mock("./action-registry", async (original) => {
  const actual = await original<typeof import("./action-registry")>();
  return {
    ...actual,
    ACTION_REGISTRY: actual.ACTION_REGISTRY.map((action) =>
      action.id === "find"
        ? { ...action, releaseSwitch: "preview", capability: "electron" }
        : action,
    ),
  };
});
import {
  createMenuActionHandler,
  isRegisteredActionAvailable,
  rendererReleaseSwitches,
} from "./action-availability";
import { isActionPerformable } from "./action-performable";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});
describe("feature action entrances share host-owned development identity", () => {
  it.each([false, true])("resolves packaged/dev-once identity development=%s", (isDevelopment) => {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
    expect(rendererReleaseSwitches().preview).toBe(isDevelopment);
    expect(isRegisteredActionAvailable("find")).toBe(isDevelopment);
    expect(
      isActionPerformable("find", {
        stageOwner: "terminal",
        hasSelection: false,
        keymapPlatform: "macos",
        actionAvailable: isRegisteredActionAvailable("find"),
      }),
    ).toBe(isDevelopment);
  });
  it.each([false, true])(
    "guards the actual App menu-event callback with development=%s",
    (isDevelopment) => {
      vi.stubGlobal("__deckHost", {});
      initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
      const dispatch = vi.fn();
      const handler = createMenuActionHandler(dispatch);
      handler({ payload: "find" });
      expect(dispatch.mock.calls).toEqual(isDevelopment ? [["find"]] : []);
      handler({ payload: { action: "find", enabled: true } });
      handler({ payload: "unknown" });
      expect(dispatch.mock.calls).toEqual(isDevelopment ? [["find"]] : []);
    },
  );
  it("keeps every switch off in a unit test that pins no host, so unfinished regions stay out of unrelated suites", () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(rendererReleaseSwitches().preview).toBe(false);
  });
  it("does not capture a development value at import time", () => {
    vi.stubGlobal("__deckHost", {});
    expect(isRegisteredActionAvailable("find")).toBe(false);
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
    expect(isRegisteredActionAvailable("find")).toBe(true);
  });
  it("keeps the validated synthetic tab-selection family available", () => {
    for (let index = 1; index <= 8; index += 1)
      expect(isRegisteredActionAvailable(`select-tab-${index}`)).toBe(true);
    for (const id of ["select-tab-0", "select-tab-9", "select-tab-99", "unknown"])
      expect(isRegisteredActionAvailable(id)).toBe(false);
  });
  it("requires host capability even when a switch is enabled", () => {
    vi.stubGlobal("__TAURI_INTERNALS", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
    expect(isRegisteredActionAvailable("find")).toBe(false);
    expect(isRegisteredActionAvailable("unknown")).toBe(false);
  });
});
