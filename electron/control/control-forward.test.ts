import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlReplyPayload } from "../../src/lib/control-command";
import {
  commandFields,
  createControlForwarder,
  LATE_REPLY_MS,
  type ForwardResult,
} from "./control-forward";

const reply = (
  requestId: string,
  over: Partial<ControlReplyPayload> = {},
): ControlReplyPayload => ({
  requestId,
  ok: true,
  paneId: null,
  text: null,
  outcome: null,
  error: null,
  ...over,
});

function setup(windows: Record<number, string | null> = { 7: "main", 8: "main", 9: "other" }) {
  const deliver = vi.fn<(paneId: number, event: string, payload: unknown) => void>();
  const log = vi.fn<(message: string) => void>();
  let counter = 0;
  const forwarder = createControlForwarder({
    deliver,
    windowOf: (paneId) => windows[paneId] ?? null,
    log,
    newRequestId: () => `req-${++counter}`,
  });
  const pushed = () => deliver.mock.calls.map(([, , payload]) => payload);
  return { forwarder, deliver, log, pushed };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("control forwarder", () => {
  it("pushes one control:command to the window of the routed pane and resolves with its reply", async () => {
    const { forwarder, deliver } = setup();
    const result = forwarder.forward({
      callerPaneId: 7,
      fields: commandFields("read", 8, { lines: 40 }),
      timeoutMs: 15_000,
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(8, "control:command", {
      requestId: "req-1",
      command: "read",
      paneId: 8,
      cwd: null,
      agent: null,
      name: null,
      text: null,
      submit: null,
      expectedAgent: null,
      lines: 40,
      force: null,
    });
    expect(forwarder.settle("main", reply("req-1", { text: "screen" }))).toBe(true);
    await expect(result).resolves.toEqual({ ok: true, reply: reply("req-1", { text: "screen" }) });
  });

  it("refuses a reply from a window the command was not pushed to, and keeps waiting for the right one", async () => {
    const { forwarder, log } = setup();
    const result = forwarder.forward({
      callerPaneId: 7,
      fields: commandFields("close", 8, { force: true }),
      timeoutMs: 15_000,
    });

    expect(forwarder.settle("other", reply("req-1"))).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not asked"));
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(false);

    expect(forwarder.settle("main", reply("req-1"))).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  it("answers renderer-timeout when the window stays silent, and refuses the reply that comes after", async () => {
    const { forwarder } = setup();
    const result = forwarder.forward({
      callerPaneId: 7,
      fields: commandFields("send", 8, { text: "go", submit: true, expectedAgent: "claude" }),
      timeoutMs: 15_000,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({ ok: false, error: "renderer-timeout" });
    expect(forwarder.settle("main", reply("req-1"))).toBe(false);
  });

  it("answers window-gone without pushing anything when the pane has no owner", async () => {
    const { forwarder, deliver } = setup({ 7: "main", 8: null });
    await expect(
      forwarder.forward({
        callerPaneId: 7,
        fields: commandFields("read", 8, { lines: 10 }),
        timeoutMs: 15_000,
      }),
    ).resolves.toEqual({ ok: false, error: "window-gone" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("answers window-gone, and logs, when the push itself throws", async () => {
    const { forwarder, deliver, log } = setup();
    deliver.mockImplementation(() => {
      throw new Error("window destroyed");
    });
    await expect(
      forwarder.forward({
        callerPaneId: 7,
        fields: commandFields("read", 8, { lines: 10 }),
        timeoutMs: 15_000,
      }),
    ).resolves.toEqual({ ok: false, error: "window-gone" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("window destroyed"));
    expect(forwarder.settle("main", reply("req-1"))).toBe(false);
  });

  it("pushes nothing for a caller that already hung up", async () => {
    const { forwarder, deliver } = setup();
    const hangup = new AbortController();
    hangup.abort();
    await expect(
      forwarder.forward({
        callerPaneId: 7,
        fields: commandFields("send", 8, { text: "go", submit: true, expectedAgent: "claude" }),
        timeoutMs: 15_000,
        signal: hangup.signal,
      }),
    ).resolves.toEqual({ ok: false, error: "aborted" });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("drops a request whose caller hangs up while it waits, so its late reply goes nowhere", async () => {
    const { forwarder } = setup();
    const hangup = new AbortController();
    const result = forwarder.forward({
      callerPaneId: 7,
      fields: commandFields("read", 8, { lines: 10 }),
      timeoutMs: 15_000,
      signal: hangup.signal,
    });
    hangup.abort();
    await expect(result).resolves.toEqual({ ok: false, error: "aborted" });
    expect(forwarder.settle("main", reply("req-1"))).toBe(false);
  });

  it("refuses a reply for a request it never pushed", () => {
    const { forwarder, log } = setup();
    expect(forwarder.settle("main", reply("made-up"))).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unknown or expired"));
  });

  it("forgets the held requests of a caller whose pane ended, and only those", async () => {
    const { forwarder } = setup();
    const gone = forwarder.forward({
      callerPaneId: 7,
      fields: commandFields("read", 8, { lines: 10 }),
      timeoutMs: 15_000,
    });
    const kept = forwarder.forward({
      callerPaneId: 9,
      fields: commandFields("read", 9, { lines: 10 }),
      timeoutMs: 15_000,
    });

    forwarder.forgetCaller(7);

    await expect(gone).resolves.toEqual({ ok: false, error: "window-gone" });
    expect(forwarder.settle("main", reply("req-1"))).toBe(false);
    expect(forwarder.settle("other", reply("req-2"))).toBe(true);
    await expect(kept).resolves.toMatchObject({ ok: true });
  });

  describe("a reply that outlives its call (open)", () => {
    const open = (
      forwarder: ReturnType<typeof setup>["forwarder"],
      onLate: (r: ControlReplyPayload) => void,
    ) =>
      forwarder.forward({
        callerPaneId: 7,
        fields: commandFields("open", 7, { cwd: "/work/a", agent: "codex" }),
        timeoutMs: 90_000,
        onLate,
      });

    it("hands a reply that arrives after the timeout to onLate, once", async () => {
      const { forwarder } = setup();
      const onLate = vi.fn<(r: ControlReplyPayload) => void>();
      const result = open(forwarder, onLate);

      await vi.advanceTimersByTimeAsync(90_000);
      await expect(result).resolves.toEqual({ ok: false, error: "renderer-timeout" });
      expect(onLate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(forwarder.settle("main", reply("req-1", { paneId: 12 }))).toBe(true);
      expect(onLate).toHaveBeenCalledWith(reply("req-1", { paneId: 12 }));
      expect(forwarder.settle("main", reply("req-1", { paneId: 12 }))).toBe(false);
      expect(onLate).toHaveBeenCalledTimes(1);
    });

    it("hands a reply that arrives after the caller hung up to onLate", async () => {
      const { forwarder } = setup();
      const onLate = vi.fn<(r: ControlReplyPayload) => void>();
      const hangup = new AbortController();
      const result: Promise<ForwardResult> = forwarder.forward({
        callerPaneId: 7,
        fields: commandFields("open", 7, { cwd: "/work/a", agent: "codex" }),
        timeoutMs: 90_000,
        signal: hangup.signal,
        onLate,
      });
      hangup.abort();
      await expect(result).resolves.toEqual({ ok: false, error: "aborted" });

      expect(forwarder.settle("main", reply("req-1", { paneId: 12 }))).toBe(true);
      expect(onLate).toHaveBeenCalledTimes(1);
    });

    it("still checks which window answers a late reply", async () => {
      const { forwarder } = setup();
      const onLate = vi.fn<(r: ControlReplyPayload) => void>();
      void open(forwarder, onLate);
      await vi.advanceTimersByTimeAsync(90_000);

      expect(forwarder.settle("other", reply("req-1", { paneId: 12 }))).toBe(false);
      expect(onLate).not.toHaveBeenCalled();
    });

    it("stops answering after the late-reply window", async () => {
      const { forwarder } = setup();
      const onLate = vi.fn<(r: ControlReplyPayload) => void>();
      void open(forwarder, onLate);
      await vi.advanceTimersByTimeAsync(90_000 + LATE_REPLY_MS);

      expect(forwarder.settle("main", reply("req-1", { paneId: 12 }))).toBe(false);
      expect(onLate).not.toHaveBeenCalled();
    });

    it("forgets a late reply when its caller's pane is gone", async () => {
      const { forwarder } = setup();
      const onLate = vi.fn<(r: ControlReplyPayload) => void>();
      void open(forwarder, onLate);
      await vi.advanceTimersByTimeAsync(90_000);

      forwarder.forgetCaller(7);

      expect(forwarder.settle("main", reply("req-1", { paneId: 12 }))).toBe(false);
      expect(onLate).not.toHaveBeenCalled();
    });
  });
});
