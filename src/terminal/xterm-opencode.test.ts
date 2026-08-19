// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

/** The first control sequences emitted by OpenTUI 0.4.5 / OpenCode 1.18.11. */
const OPENCODE_STARTUP =
  "\x1b[?2031h" +
  "\x1b[?1016$p" +
  "\x1b[?2027$p" +
  "\x1b[?2031$p" +
  "\x1b[?1004$p" +
  "\x1b[?2004$p" +
  "\x1b[?2026$p";

describe("OpenCode terminal compatibility", () => {
  it("answers OpenTUI mode queries and continues parsing the first frame", async () => {
    const terminal = new Terminal({ cols: 80, rows: 24 });
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));

    await new Promise<void>((resolve) => {
      terminal.write(`${OPENCODE_STARTUP}\x1b[?2026h\x1b[HOpenCode\x1b[?2026l`, resolve);
    });

    expect(replies).toContain("\x1b[?1016;2$y");
    expect(replies).toContain("\x1b[?2026;2$y");
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe("OpenCode");
    terminal.dispose();
  });
});
