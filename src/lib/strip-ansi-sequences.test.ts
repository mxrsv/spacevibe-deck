import { describe, expect, it } from "vitest";
import { lastRows, stripAnsiSequences } from "./strip-ansi-sequences";

describe("stripAnsiSequences", () => {
  it("drops SGR colour and cursor sequences", () => {
    expect(stripAnsiSequences("\x1b[32mok\x1b[0m \x1b[2Kline")).toBe("ok line");
  });
  it("drops OSC sequences ended by BEL or ST", () => {
    expect(stripAnsiSequences("\x1b]0;title\x07text\x1b]8;;url\x1b\\link")).toBe("textlink");
  });
  it("drops carriage returns and bare escapes, keeps newlines and tabs", () => {
    expect(stripAnsiSequences("a\r\nb\tc\x1b(B")).toBe("a\nb\tc");
  });
});

describe("lastRows", () => {
  it("keeps the last N rows and trims trailing blank rows", () => {
    expect(lastRows("1\n2\n3\n4\n\n\n", 2)).toBe("3\n4");
  });
  it("returns everything when there are fewer rows than asked", () => {
    expect(lastRows("only", 40)).toBe("only");
  });
});
