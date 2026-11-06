import { describe, expect, it } from "vitest";
import { displayText } from "./display-text";

const chars = (...codes: number[]) => String.fromCharCode(...codes);

describe("displayText", () => {
  it("strips terminal escapes and other control characters", () => {
    expect(displayText(chars(0x1b) + "[31mred" + chars(0x1b) + "[0m", 50)).toBe("[31mred[0m");
    expect(displayText("a" + chars(0, 7, 8, 0x7f, 0x85) + "b", 50)).toBe("ab");
  });

  it("turns tabs and line breaks into spaces so words do not fuse", () => {
    expect(displayText("one\ttwo\nthree\r\nfour", 50)).toBe("one two three  four");
    expect(displayText("a" + chars(0x2028) + "b", 50)).toBe("a b");
  });

  it("removes characters that reorder or hide text", () => {
    expect(displayText("evil" + chars(0x202e) + "gnp.exe", 50)).toBe("evilgnp.exe");
    expect(displayText("a" + chars(0x200b, 0x2066, 0xfeff) + "b", 50)).toBe("ab");
  });

  it("cuts at the limit by code point and never splits a surrogate pair", () => {
    expect(displayText("abcdef", 3)).toBe("abc");
    expect(displayText("🚀🚀🚀", 2)).toBe("🚀🚀");
    expect(displayText("short", 50)).toBe("short");
  });

  it("trims and can return an empty string", () => {
    expect(displayText("  hi  ", 10)).toBe("hi");
    expect(displayText(chars(0, 1, 2), 10)).toBe("");
  });
});
