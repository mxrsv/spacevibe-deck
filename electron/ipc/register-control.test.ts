import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import { createPaneMirror, type PaneMirror } from "../control/pane-mirror";
import { registerControl } from "./register-control";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: { id: 7 } };
const REPORT = {
  paneId: 12,
  phase: "working",
  attention: "none",
  source: null,
  confidence: "explicit",
  agent: "claude",
  pid: 4242,
};

function report(payload: unknown): unknown {
  return mocks.handlers.get("pane_attention_report")!(EVENT, payload);
}

describe("registerControl — pane_attention_report", () => {
  let mirror: PaneMirror;
  const owned = new Set([12]);
  const labelOf = vi.fn(() => "deck-1");
  const settleReply = vi.fn<(fromWindow: string, reply: ControlReplyPayload) => boolean>();

  beforeEach(() => {
    mocks.handlers.clear();
    mirror = createPaneMirror({ now: () => 1000 });
    owned.clear();
    owned.add(12);
    registerControl({
      mirror,
      labelOf,
      assertOwner: (paneId, label) => {
        if (label !== "deck-1" || !owned.has(paneId)) throw new Error("not yours");
      },
      settleReply,
    });
  });

  it("keeps a report for a pane the sending window owns", () => {
    expect(report(REPORT)).toBe(true);
    expect(mirror.get(12)).toEqual({
      phase: "working",
      attention: "none",
      source: null,
      confidence: "explicit",
      agent: "claude",
      pid: 4242,
      reportedAt: 1000,
    });
  });

  it("refuses a pane the window does not own, and keeps nothing", () => {
    expect(report({ ...REPORT, paneId: 13 })).toBe(false);
    expect(mirror.get(13)).toBeNull();
  });

  it("refuses the report of a pane whose PTY just ended, so its mirror stays gone", () => {
    mirror.report(12, {
      phase: "idle",
      attention: "none",
      source: null,
      confidence: "explicit",
      agent: "claude",
      pid: 4242,
    });
    mirror.forget(12);
    owned.delete(12);
    expect(report(REPORT)).toBe(false);
    expect(mirror.get(12)).toBeNull();
  });

  it("refuses a sender whose window no longer exists", () => {
    labelOf.mockImplementationOnce(() => {
      throw new Error("IPC from a window that no longer exists");
    });
    expect(report(REPORT)).toBe(false);
    expect(mirror.get(12)).toBeNull();
  });

  it.each([
    ["an unknown phase", { phase: "sleeping" }],
    ["an unknown attention", { attention: "loud" }],
    ["an unknown confidence", { confidence: "certain" }],
    ["a zero pane id", { paneId: 0 }],
    ["a fractional pane id", { paneId: 1.5 }],
    ["a string pane id", { paneId: "12" }],
    ["a non-string agent", { agent: 5 }],
    ["an empty agent", { agent: "" }],
    ["an agent with a control character", { agent: "claude\u001b[2J" }],
    ["an over-long source", { source: "x".repeat(65) }],
    ["a fractional pid", { pid: 4.2 }],
    ["a negative pid", { pid: -1 }],
    ["a missing pid", { pid: undefined }],
  ])("throws on %s without touching the mirror", (_name, change) => {
    expect(() => report({ ...REPORT, ...change })).toThrow(TypeError);
    expect(mirror.get(12)).toBeNull();
  });

  it("accepts a shell pane: no agent, no pid", () => {
    expect(
      report({ ...REPORT, phase: "unknown", agent: null, pid: null, confidence: "unknown" }),
    ).toBe(true);
    expect(mirror.get(12)).toMatchObject({ agent: null, pid: null, confidence: "unknown" });
  });
});

const REPLY = {
  requestId: "0b6c0c3e-6f44-4d3e-9a43-0d3c5c9a2f10",
  ok: true,
  paneId: 12,
  text: null,
  outcome: null,
  error: null,
};

function replyControl(payload: unknown): unknown {
  return mocks.handlers.get("control_reply")!(EVENT, payload);
}

describe("registerControl — control_reply", () => {
  let mirror: PaneMirror;
  const labelOf = vi.fn(() => "deck-1");
  const settleReply = vi.fn<(fromWindow: string, reply: ControlReplyPayload) => boolean>();

  beforeEach(() => {
    mocks.handlers.clear();
    labelOf.mockClear();
    labelOf.mockImplementation(() => "deck-1");
    settleReply.mockReset();
    settleReply.mockReturnValue(true);
    mirror = createPaneMirror({ now: () => 1000 });
    registerControl({ mirror, labelOf, assertOwner: () => {}, settleReply });
  });

  it("hands the checked reply to the request it answers, naming the sending window", () => {
    expect(replyControl(REPLY)).toBe(true);
    expect(settleReply).toHaveBeenCalledWith("deck-1", REPLY);
  });

  it("answers what the router answered: false for a request that is gone or was not sent to this window", () => {
    settleReply.mockReturnValue(false);
    expect(replyControl(REPLY)).toBe(false);
  });

  it("takes the window from the sender, never from the payload", () => {
    labelOf.mockImplementation(() => "deck-2");
    replyControl({ ...REPLY, window: "deck-1" });
    expect(settleReply).toHaveBeenCalledWith("deck-2", REPLY);
  });

  it("refuses a sender whose window no longer exists, without settling anything", () => {
    labelOf.mockImplementationOnce(() => {
      throw new Error("IPC from a window that no longer exists");
    });
    expect(replyControl(REPLY)).toBe(false);
    expect(settleReply).not.toHaveBeenCalled();
  });

  it("keeps the shape of a reply whose keys carry text, an outcome or an error", () => {
    const full = {
      ...REPLY,
      ok: false,
      paneId: null,
      text: "screen\nrows",
      outcome: "stale",
      error: "busy",
    };
    replyControl(full);
    expect(settleReply).toHaveBeenCalledWith("deck-1", full);
  });

  it.each([
    ["a missing request id", { requestId: undefined }],
    ["an empty request id", { requestId: "" }],
    ["a request id with a control character", { requestId: "a\u001bb" }],
    ["a non-boolean ok", { ok: "yes" }],
    ["a string pane id", { paneId: "12" }],
    ["a zero pane id", { paneId: 0 }],
    ["a non-string text", { text: 5 }],
    ["an over-long outcome", { outcome: "x".repeat(65) }],
    ["an error with an escape sequence", { error: "\u001b[31mboom" }],
    ["a missing outcome key", { outcome: undefined }],
  ])("throws on %s without settling anything", (_name, change) => {
    expect(() => replyControl({ ...REPLY, ...change })).toThrow(TypeError);
    expect(settleReply).not.toHaveBeenCalled();
  });

  it("refuses every reply while the switch is off, when no router exists", () => {
    mocks.handlers.clear();
    registerControl({ mirror, labelOf, assertOwner: () => {}, settleReply: null });
    expect(replyControl(REPLY)).toBe(false);
  });
});
