import { afterEach, describe, expect, it } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { monoFontFallback } from "./mono-font-fallback";

const MACOS_FALLBACK = "Menlo, Monaco, monospace";
const WINDOWS_FALLBACK = 'Menlo, Monaco, "Cascadia Mono", Consolas, monospace';

describe("monoFontFallback", () => {
  afterEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it("is the original list byte for byte on macOS", () => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    expect(monoFontFallback()).toBe(MACOS_FALLBACK);
  });

  it("is the original list where the platform is unsupported or not yet known", () => {
    expect(monoFontFallback()).toBe(MACOS_FALLBACK);
    initializeDesktopEnvironment({ platform: "unsupported", homeDir: "" });
    expect(monoFontFallback()).toBe(MACOS_FALLBACK);
  });

  it("puts the Windows faces between Monaco and the generic family on Windows", () => {
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    expect(monoFontFallback()).toBe(WINDOWS_FALLBACK);
  });

  it("reads the platform at call time, not at import", () => {
    // The module is already imported above, before any environment exists.
    expect(monoFontFallback()).toBe(MACOS_FALLBACK);
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:\\Users\\Deck" });
    expect(monoFontFallback()).toBe(WINDOWS_FALLBACK);
  });
});
