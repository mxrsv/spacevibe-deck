import { beforeEach, describe, expect, it, vi } from "vitest";
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
