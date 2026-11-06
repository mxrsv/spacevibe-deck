import { describe, expect, it } from "vitest";
import { baseName, childPath, dirName, formatSize, isNormalPath, parentPath } from "./files-nav";

describe("files navigation", () => {
  it("descends and ascends one segment at a time", () => {
    expect(childPath("", "src")).toBe("src");
    expect(childPath("src", "ui")).toBe("src/ui");
    expect(parentPath("src/ui")).toBe("src");
    expect(parentPath("src")).toBe("");
    expect(parentPath("")).toBeNull();
  });

  it("never builds a path that leaves the root", () => {
    for (const name of ["..", ".", "", "a/b", "../x", "a\\b", "a\u0000b"]) {
      expect(childPath("src", name)).toBeNull();
    }
    expect(childPath("../etc", "passwd")).toBeNull();
    expect(childPath("/abs", "x")).toBeNull();
    expect(isNormalPath("a//b")).toBe(false);
    expect(isNormalPath("a/../b")).toBe(false);
    expect(isNormalPath("")).toBe(true);
  });

  it("splits a path into name and directory", () => {
    expect(baseName("src/ui/button.tsx")).toBe("button.tsx");
    expect(dirName("src/ui/button.tsx")).toBe("src/ui");
    expect(dirName("README.md")).toBe("");
  });

  it("formats sizes", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(340 * 1024)).toBe("340 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});
