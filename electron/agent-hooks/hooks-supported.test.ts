import { describe, expect, it } from "vitest";
import { hooksSupported } from "./hooks-supported";

describe("hooksSupported", () => {
  it.each(["darwin", "linux", "freebsd"] as const)("is true on %s", (platform) => {
    expect(hooksSupported(platform)).toBe(true);
  });

  it("is false on win32, where no hook script is written yet", () => {
    expect(hooksSupported("win32")).toBe(false);
  });

  it("reads the running platform by default", () => {
    expect(hooksSupported()).toBe(process.platform !== "win32");
  });
});
