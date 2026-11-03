import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlReplyPayload } from "../lib/control-command";
import type { PaneAttentionReport } from "../lib/pane-attention-report";

const REPORT: PaneAttentionReport = {
  paneId: 12,
  phase: "working",
  attention: "none",
  source: null,
  confidence: "explicit",
  agent: "claude",
  pid: 4242,
};

describe("control-host", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    warn.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the flat pane_attention_report payload through the bridge", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { reportPaneAttention } = await import("./control-host");
    reportPaneAttention({ ...REPORT, source: "hook", pid: null, agent: null });
    expect(invoke).toHaveBeenCalledWith("pane_attention_report", {
      paneId: 12,
      phase: "working",
      attention: "none",
      source: "hook",
      confidence: "explicit",
      agent: null,
      pid: null,
    });
  });

  it("does not throw and warns once per session when the host bridge is absent", async () => {
    vi.stubGlobal("__deckHost", undefined);
    const { reportPaneAttention } = await import("./control-host");
    expect(() => reportPaneAttention(REPORT)).not.toThrow();
    expect(() => reportPaneAttention(REPORT)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("swallows a refused or failed report and logs it, without an unhandled rejection", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("pane_attention_report is refused"));
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { reportPaneAttention } = await import("./control-host");
    expect(() => reportPaneAttention(REPORT)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls[0]?.[0]).toContain("pane_attention_report failed");
  });

  it("swallows a bridge that throws on invoke itself", async () => {
    const invoke = vi.fn(() => {
      throw new Error("bridge is gone");
    });
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { reportPaneAttention } = await import("./control-host");
    expect(() => reportPaneAttention(REPORT)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

const REPLY: ControlReplyPayload = {
  requestId: "0b6c0c3e-6f44-4d3e-9a43-0d3c5c9a2f10",
  ok: true,
  paneId: 31,
  text: null,
  outcome: null,
  error: null,
};

describe("control-host — replyControl", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    warn.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the flat control_reply payload, every key, through the bridge", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { replyControl } = await import("./control-host");
    replyControl({
      ...REPLY,
      ok: false,
      paneId: null,
      text: "rows",
      outcome: "stale",
      error: "busy",
    });
    expect(invoke).toHaveBeenCalledWith("control_reply", {
      requestId: REPLY.requestId,
      ok: false,
      paneId: null,
      text: "rows",
      outcome: "stale",
      error: "busy",
    });
  });

  it("logs a reply main did not accept, since its call has long moved on", async () => {
    const invoke = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { replyControl } = await import("./control-host");
    replyControl(REPLY);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn.mock.calls[0]?.[0]).toContain("control_reply was not accepted");
  });

  it("swallows a rejected reply, and a bridge that throws, without an unhandled rejection", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockImplementationOnce(() => {
        throw new Error("bridge is gone");
      });
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const { replyControl } = await import("./control-host");
    expect(() => replyControl(REPLY)).not.toThrow();
    expect(() => replyControl(REPLY)).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  });

  it("does not throw and warns once when the host bridge is absent", async () => {
    vi.stubGlobal("__deckHost", undefined);
    const { replyControl } = await import("./control-host");
    expect(() => replyControl(REPLY)).not.toThrow();
    expect(() => replyControl(REPLY)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("control-host — listenControlCommands", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands each control:command payload to the handler as it came, and unsubscribes on request", async () => {
    const unlisten = vi.fn();
    const listen = vi.fn((_event: string, _handler: (payload: unknown) => void) => unlisten);
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen });
    const { listenControlCommands } = await import("./control-host");
    const handler = vi.fn();

    const stop = await listenControlCommands(handler);

    expect(listen).toHaveBeenCalledWith("control:command", expect.any(Function));
    listen.mock.calls[0][1]({ requestId: "r-1", command: "read" });
    expect(handler).toHaveBeenCalledWith({ requestId: "r-1", command: "read" });
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("listens to nothing where the host bridge is absent", async () => {
    vi.stubGlobal("__deckHost", undefined);
    const { listenControlCommands } = await import("./control-host");
    const stop = await listenControlCommands(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});
