import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStreamHub,
  DATA_PACE_MS,
  MAX_BACKLOG_CHARS,
  PANE_GONE_GRACE_MS,
  type StreamMessage,
  type StreamSink,
} from "./phone-streams";

function setup(ownerOf: (pane: number) => string | null = () => "w1") {
  const started: [number, string][] = [];
  const stopped: [string, string][] = [];
  const hub = createStreamHub({
    ownerOf,
    startStream: (pane, sub) => started.push([pane, sub]),
    stopStream: (label, sub) => stopped.push([label, sub]),
    newId: (() => {
      let n = 0;
      return () => `sub${++n}`;
    })(),
  });
  const log: string[] = [];
  const sink: StreamSink = {
    snapshot: (p) => log.push(`snapshot:${p.data}:${p.cols}x${p.rows}:${p.seq}/${p.last}`),
    data: (_s, d) => log.push(`data:${d}`),
    resize: (_s, c, r) => log.push(`resize:${c}x${r}`),
    end: (_s, reason) => log.push(`end:${reason}`),
  };
  const msg = (
    kind: StreamMessage["kind"],
    data = "",
    extra: Partial<StreamMessage> = {},
  ): StreamMessage => ({
    subscriptionId: "sub1",
    paneId: 7,
    kind,
    data,
    cols: 80,
    rows: 24,
    ...extra,
  });
  return { hub, started, stopped, log, sink, msg };
}

describe("stream hub", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the snapshot first and then buffered and live output in order", async () => {
    const t = setup();
    const pending = t.hub.subscribe("phone", 7, t.sink);
    expect(t.started).toEqual([[7, "sub1"]]);
    // Output that races the response is queued behind the snapshot.
    expect(t.hub.fromRenderer("w1", t.msg("snapshot", "SCREEN"))).toBe(true);
    expect(t.hub.fromRenderer("w1", t.msg("data", "a"))).toBe(true);
    const result = await pending;
    if (!result.ok) throw new Error("expected a stream");
    expect(result).toMatchObject({ sub: "sub1", cols: 80, rows: 24 });
    expect(t.log).toEqual([]);
    result.begin();
    t.hub.fromRenderer("w1", t.msg("data", "b"));
    t.hub.fromRenderer("w1", t.msg("resize", "", { cols: 100, rows: 30 }));
    // The first data goes at once; the next waits out the pace, and the resize stays behind it.
    expect(t.log).toEqual(["snapshot:SCREEN:80x24:0/true", "data:a"]);
    vi.advanceTimersByTime(DATA_PACE_MS);
    expect(t.log).toEqual(["snapshot:SCREEN:80x24:0/true", "data:a", "data:b", "resize:100x30"]);
  });

  it("ignores messages from the wrong window, the wrong pane or an unknown sub", async () => {
    const t = setup();
    const pending = t.hub.subscribe("phone", 7, t.sink);
    expect(t.hub.fromRenderer("w2", t.msg("snapshot", "x"))).toBe(false);
    expect(t.hub.fromRenderer("w1", t.msg("snapshot", "x", { paneId: 8 }))).toBe(false);
    expect(t.hub.fromRenderer("w1", t.msg("snapshot", "x", { subscriptionId: "nope" }))).toBe(
      false,
    );
    expect(t.hub.fromRenderer("w1", t.msg("data", "early"))).toBe(false);
    t.hub.fromRenderer("w1", t.msg("snapshot", "x"));
    await pending;
  });

  it("answers no-target for a pane nobody owns and unavailable when the window never answers", async () => {
    vi.useFakeTimers();
    try {
      const none = setup(() => null);
      expect(await none.hub.subscribe("phone", 7, none.sink)).toEqual({
        ok: false,
        code: "no-target",
      });
      const t = setup();
      const pending = t.hub.subscribe("phone", 7, t.sink);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual({ ok: false, code: "unavailable" });
      expect(t.stopped).toEqual([["w1", "sub1"]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the stream when the pane closes, and tells the window when the phone leaves", async () => {
    const t = setup();
    const pending = t.hub.subscribe("phone", 7, t.sink);
    t.hub.fromRenderer("w1", t.msg("snapshot", "S"));
    const result = await pending;
    if (!result.ok) throw new Error("expected a stream");
    result.begin();
    t.hub.paneGone(7);
    vi.advanceTimersByTime(PANE_GONE_GRACE_MS);
    expect(t.log.at(-1)).toBe("end:closed");
    expect(t.hub.fromRenderer("w1", t.msg("data", "late"))).toBe(false);

    const again = setup();
    const second = again.hub.subscribe("p", 7, again.sink);
    again.hub.fromRenderer("w1", again.msg("snapshot", "S"));
    ((await second) as { begin(): void }).begin();
    again.hub.closeOwner("p");
    expect(again.stopped).toEqual([["w1", "sub1"]]);
    expect(again.log).toEqual(["snapshot:S:80x24:0/true"]);
  });

  it("lets only the owner unsubscribe, with an unsubscribed end", async () => {
    const t = setup();
    const pending = t.hub.subscribe("phone", 7, t.sink);
    t.hub.fromRenderer("w1", t.msg("snapshot", "S"));
    ((await pending) as { begin(): void }).begin();
    expect(t.hub.unsubscribe("other", "sub1")).toBe(false);
    expect(t.hub.unsubscribe("phone", "sub1")).toBe(true);
    expect(t.log.at(-1)).toBe("end:unsubscribed");
    expect(t.stopped).toEqual([["w1", "sub1"]]);
  });

  async function begun(t: ReturnType<typeof setup>) {
    const pending = t.hub.subscribe("phone", 7, t.sink);
    t.hub.fromRenderer("w1", t.msg("snapshot", "S"));
    ((await pending) as { begin(): void }).begin();
  }

  it("coalesces a burst into at most one data message per pace interval", async () => {
    const t = setup();
    await begun(t);
    // 2000 small chunks arrive within one second of simulated time.
    for (let i = 0; i < 2_000; i += 1) {
      t.hub.fromRenderer("w1", t.msg("data", "x"));
      if (i % 2 === 0) vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(DATA_PACE_MS * 2);
    const messages = t.log.filter((line) => line.startsWith("data:"));
    expect(messages.length).toBeLessThanOrEqual(1_000 / DATA_PACE_MS + 3);
    // Nothing was lost or reordered.
    expect(messages.join("").replaceAll("data:", "").length).toBe(2_000);
  });

  it("ends a stream with overflow when the phone falls too far behind, without touching others", async () => {
    const t = setup();
    await begun(t);
    t.hub.fromRenderer("w1", t.msg("data", "y".repeat(MAX_BACKLOG_CHARS / 2)));
    expect(t.log.at(-1)).not.toBe("end:overflow");
    t.hub.fromRenderer("w1", t.msg("data", "y".repeat(MAX_BACKLOG_CHARS)));
    expect(t.log.at(-1)).toBe("end:overflow");
    expect(t.stopped).toEqual([["w1", "sub1"]]);
    expect(t.hub.fromRenderer("w1", t.msg("data", "late"))).toBe(false);
  });

  it("keeps the last output before a pane exits: it waits for the renderer's tail and end", async () => {
    const t = setup();
    await begun(t);
    t.hub.paneGone(7);
    expect(t.log.at(-1)).not.toBe("end:closed");
    expect(t.hub.fromRenderer("w1", t.msg("data", "bye\n"))).toBe(true);
    t.hub.fromRenderer("w1", t.msg("end", "closed"));
    vi.advanceTimersByTime(DATA_PACE_MS);
    expect(t.log.slice(-2)).toEqual(["data:bye\n", "end:closed"]);
    // The fallback does not end it twice.
    vi.advanceTimersByTime(PANE_GONE_GRACE_MS);
    expect(t.log.filter((line) => line.startsWith("end:"))).toHaveLength(1);
  });
});
