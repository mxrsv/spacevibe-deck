import { describe, expect, it } from "vitest";
import {
  MAX_REPLY_TEXT_LENGTH,
  parseControlCommand,
  parseControlReply,
  type ControlReplyPayload,
} from "./control-command";

const COMMAND = {
  requestId: "0b6c0c3e-6f44-4d3e-9a43-0d3c5c9a2f10",
  command: "read",
  paneId: 12,
  cwd: null,
  agent: null,
  name: null,
  text: null,
  submit: null,
  expectedAgent: null,
  lines: 40,
  force: null,
};

const REPLY: Readonly<Record<keyof ControlReplyPayload, unknown>> = {
  requestId: "0b6c0c3e-6f44-4d3e-9a43-0d3c5c9a2f10",
  ok: true,
  paneId: null,
  text: null,
  outcome: null,
  error: null,
};

describe("parseControlCommand", () => {
  it("keeps every key of a command exactly as sent", () => {
    expect(parseControlCommand(COMMAND)).toEqual(COMMAND);
  });

  it.each([
    ["a line count of zero", { lines: 0 }],
    ["a fractional line count", { lines: 1.5 }],
    ["a string line count", { lines: "40" }],
    ["a command outside the closed set", { command: "exec" }],
    ["a pane id of zero", { paneId: 0 }],
    ["a request id with a control character", { requestId: "a\u0007b" }],
    ["a non-boolean force", { force: 1 }],
    ["a numeric agent", { agent: 5 }],
  ])("refuses %s", (_name, change) => {
    expect(parseControlCommand({ ...COMMAND, ...change })).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, "read", 7, []]) {
      expect(parseControlCommand(value)).toBeNull();
    }
  });
});

describe("parseControlReply", () => {
  it("keeps a reply that carries text, a pane id, an outcome and an error", () => {
    const full = { ...REPLY, ok: false, paneId: 31, text: "rows", outcome: "stale", error: "busy" };
    expect(parseControlReply(full)).toEqual(full);
  });

  it("refuses text longer than main is willing to hold", () => {
    expect(parseControlReply({ ...REPLY, text: "x".repeat(MAX_REPLY_TEXT_LENGTH) })).not.toBeNull();
    expect(parseControlReply({ ...REPLY, text: "x".repeat(MAX_REPLY_TEXT_LENGTH + 1) })).toBeNull();
  });

  it("refuses a code with an escape sequence, so no reply can write into the caller's terminal", () => {
    expect(parseControlReply({ ...REPLY, outcome: "\u001b[2J" })).toBeNull();
    expect(parseControlReply({ ...REPLY, error: "line\nbreak" })).toBeNull();
  });
});
