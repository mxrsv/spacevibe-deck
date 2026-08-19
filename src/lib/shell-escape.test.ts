import { describe, expect, it } from "vitest";
import { shellEscapePath, shellEscapePaths } from "./shell-escape";

describe("shellEscapePath", () => {
  it("leaves a clean path untouched", () => {
    expect(shellEscapePath("/Users/me/dev/file.txt", "macos")).toBe("/Users/me/dev/file.txt");
  });

  it("escapes spaces", () => {
    expect(shellEscapePath("/Users/me/My File.txt", "macos")).toBe("/Users/me/My\\ File.txt");
  });

  it("escapes quotes, $ and &", () => {
    expect(shellEscapePath("a'b", "macos")).toBe("a\\'b");
    expect(shellEscapePath('a"b', "macos")).toBe('a\\"b');
    expect(shellEscapePath("a$b", "macos")).toBe("a\\$b");
    expect(shellEscapePath("a&b", "macos")).toBe("a\\&b");
  });

  it("escapes parentheses", () => {
    expect(shellEscapePath("a(b)c", "macos")).toBe("a\\(b\\)c");
  });

  it("keeps unicode (Vietnamese) but still escapes the space", () => {
    expect(shellEscapePath("/Users/me/Tài liệu", "macos")).toBe("/Users/me/Tài\\ liệu");
  });

  it("returns empty string for empty input", () => {
    expect(shellEscapePath("", "macos")).toBe("");
  });

  it("quotes Windows paths as PowerShell literals", () => {
    expect(shellEscapePath(String.raw`C:\My Files\Tài liệu.txt`, "windows")).toBe(
      String.raw`'C:\My Files\Tài liệu.txt'`,
    );
    expect(shellEscapePath(String.raw`\\server\share\file.txt`, "windows")).toBe(
      String.raw`'\\server\share\file.txt'`,
    );
  });

  it("doubles a PowerShell single quote", () => {
    expect(shellEscapePath(String.raw`C:\Users\O'Brien\a.txt`, "windows")).toBe(
      String.raw`'C:\Users\O''Brien\a.txt'`,
    );
  });
});

describe("shellEscapePaths", () => {
  it("joins escaped paths with spaces and adds a trailing space", () => {
    expect(shellEscapePaths(["/a b", "/c"], "macos")).toBe("/a\\ b /c ");
    expect(shellEscapePaths([String.raw`C:\a b`, String.raw`\\server\share\c`], "windows")).toBe(
      String.raw`'C:\a b' '\\server\share\c' `,
    );
  });

  it("returns empty string for an empty array", () => {
    expect(shellEscapePaths([], "windows")).toBe("");
  });
});
