import { describe, expect, it } from "vitest";
import { unescapeInput } from "./input-escapes";

describe("unescapeInput", () => {
  it("turns the documented escapes into the keystrokes they name", () => {
    expect(unescapeInput("ls\\r")).toBe("ls\r");
    expect(unescapeInput("a\\tb\\nc")).toBe("a\tb\nc");
    expect(unescapeInput("\\e[A")).toBe(String.fromCharCode(0x1b) + "[A");
    expect(unescapeInput("\\x03")).toBe(String.fromCharCode(3));
    expect(unescapeInput("back\\\\slash")).toBe("back\\slash");
  });

  it("leaves everything else alone", () => {
    expect(unescapeInput("plain text")).toBe("plain text");
    expect(unescapeInput("\\q and \\x4")).toBe("\\q and \\x4");
  });
});
