import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
