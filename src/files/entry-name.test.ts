import { describe, expect, it } from "vitest";
import { checkEntryName } from "./entry-name";

const reason = (name: unknown): string => {
  const result = checkEntryName(name);
  return result.ok ? "" : result.reason;
};

describe("checkEntryName", () => {
  it.each(["README.md", ".github", ".env", "a.b.c", "name with spaces", "Ünïcøde.ts"])(
    "accepts %j",
    (name) => {
      expect(checkEntryName(name)).toEqual({ ok: true });
    },
  );

  it("accepts a leading dot, which the task launcher's own validator refuses", () => {
    // Design §6.2: `createDirectory`'s `validName` rejects every name starting
    // with `.`, so `.github` could not be created through it. That is the
    // launcher's rule and it stays; this is the explorer's.
    expect(checkEntryName(".github").ok).toBe(true);
  });

  it.each([
    ["", "Type a name."],
    [" leading", "A name can't start or end with a space."],
    ["trailing ", "A name can't start or end with a space."],
    [".", "That name is reserved."],
    ["..", "That name is reserved."],
    ["a/b", "A name can't contain a path separator."],
    ["a\\b", "A name can't contain a path separator."],
    ["a\u0000b", "A name can't contain control characters."],
    ["a\tb", "A name can't contain control characters."],
    ["a\u001fb", "A name can't contain control characters."],
    ["a\u007fb", "A name can't contain control characters."],
    ["name.", "A name can't end with a dot."],
  ])("rejects %j", (name, expected) => {
    expect(reason(name)).toBe(expected);
  });

  it.each([
    "CON",
    "con",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "com9",
    "LPT1",
    "lpt9",
    "CON.txt",
    "com3.tsx",
  ])("rejects the Windows device name %j on every platform", (name) => {
    // Design §6.3: a repository is shared. A name macOS accepts and Windows
    // cannot check out is a defect the creating machine should refuse.
    expect(reason(name)).toBe("That name is reserved on Windows.");
  });

  it.each(["COM0", "LPT0", "COM10", "CONS", "NULL"])("accepts the near-miss %j", (name) => {
    expect(checkEntryName(name).ok).toBe(true);
  });

  it("rejects anything over 255 bytes, counted as UTF-8", () => {
    expect(checkEntryName("a".repeat(255)).ok).toBe(true);
    expect(reason("a".repeat(256))).toBe("That name is too long.");
    // 128 three-byte characters is 384 bytes but only 128 code units — the
    // limit is a filesystem limit, so it is counted in bytes.
    expect(reason("あ".repeat(128))).toBe("That name is too long.");
  });

  it("rejects a non-string, because main is the boundary and the renderer is not", () => {
    expect(checkEntryName(undefined).ok).toBe(false);
    expect(checkEntryName(42).ok).toBe(false);
  });
});
