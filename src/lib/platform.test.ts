import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopEnvironment,
  hasPrimaryModifier,
  initializeDesktopEnvironment,
  initializeDesktopEnvironmentFromBackend,
  parseDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "./platform";

describe("desktop environment", () => {
  beforeEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it("accepts validated macOS, Windows, and unsupported values", () => {
    expect(
      parseDesktopEnvironment({
        platform: "macos",
        homeDir: "/Users/dev",
      }),
    ).toEqual({ platform: "macos", homeDir: "/Users/dev" });
    expect(
      parseDesktopEnvironment({
        platform: "windows",
        homeDir: String.raw`C:\Users\dev`,
      }),
    ).toEqual({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    expect(parseDesktopEnvironment({ platform: "unsupported", homeDir: "" })).toEqual({
      platform: "unsupported",
      homeDir: "",
    });
  });

  it("rejects unknown platforms and invalid home directories", () => {
    expect(() => parseDesktopEnvironment({ platform: "linux", homeDir: "/home/dev" })).toThrow(
      "platform",
    );
    expect(() => parseDesktopEnvironment({ platform: "macos", homeDir: "Users/dev" })).toThrow(
      "absolute",
    );
    expect(() =>
      parseDesktopEnvironment({
        platform: "windows",
        homeDir: String.raw`Users\dev`,
      }),
    ).toThrow("absolute");
    expect(() => parseDesktopEnvironment({ platform: "unsupported", homeDir: "/tmp" })).toThrow(
      "empty",
    );
  });

  it("initializes exactly once", () => {
    const first = initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });

    expect(getDesktopEnvironment()).toBe(first);
    expect(() =>
      initializeDesktopEnvironment({
        platform: "windows",
        homeDir: String.raw`C:\Users\dev`,
      }),
    ).toThrow("already initialized");
  });

  it("preserves the host development flag and rejects non-boolean flags", () => {
    for (const isDevelopment of [true, false]) {
      expect(
        parseDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev", isDevelopment }),
      ).toEqual({ platform: "macos", homeDir: "/Users/dev", isDevelopment });
    }
    expect(() =>
      parseDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev", isDevelopment: "true" }),
    ).toThrow("isDevelopment must be a boolean");
  });

  it("maps the primary modifier from the initialized platform", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });

    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("uses Ctrl as the primary modifier on Linux, which the host reports as unsupported", () => {
    initializeDesktopEnvironment({ platform: "unsupported", homeDir: "" });

    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("uses Cmd as the primary modifier on macOS", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });

    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(false);
  });

  it("falls back once when backend initialization fails", async () => {
    const warn = vi.fn();

    const environment = await initializeDesktopEnvironmentFromBackend(async () => {
      throw new Error("IPC unavailable");
    }, warn);

    expect(environment).toEqual({ platform: "unsupported", homeDir: "" });
    expect(getDesktopEnvironment()).toBe(environment);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reuses the initialized backend environment without loading twice", async () => {
    const load = vi.fn().mockResolvedValue({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const first = await initializeDesktopEnvironmentFromBackend(load);
    const second = await initializeDesktopEnvironmentFromBackend(load);

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
  });
});
