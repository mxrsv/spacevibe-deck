import { describe, expect, it, vi } from "vitest";
import type { AppEvent } from "@protocol/messages";
import {
  createTerminalBridge,
  createTerminalFeed,
  parsePageMessage,
  MAX_QUEUED_COMMANDS,
  type PageCommand,
} from "./terminal-bridge";

const INIT: Extract<PageCommand, { t: "init" }> = {
  t: "init",
  cols: 64,
  rows: 20,
  fontSize: 10,
  background: "#000",
  foreground: "#fff",
};

function bridgeWith() {
  const posted: PageCommand[] = [];
  const onNeedsReplay = vi.fn<() => void>();
  const inputs: string[] = [];
  const bridge = createTerminalBridge({
    post: (c) => posted.push(c),
    init: () => INIT,
    onInput: (d) => inputs.push(d),
    onPinch: () => {},
    onNeedsReplay,
  });
  return { bridge, posted, onNeedsReplay, inputs };
}

describe("terminal bridge gating", () => {
  it("holds commands until the page is ready and xterm is initialised, then flushes in order", () => {
    const { bridge, posted } = bridgeWith();
    bridge.send({ t: "write", d: "a" });
    bridge.send({ t: "write", d: "b" });
    expect(posted).toEqual([]);
    bridge.receive({ t: "ready" });
    expect(posted).toEqual([INIT]); // init goes out at once, the queue still waits
    bridge.send({ t: "write", d: "c" });
    expect(posted).toHaveLength(1);
    bridge.receive({ t: "inited" });
    expect(posted.map((c) => (c.t === "write" ? c.d : c.t))).toEqual(["init", "a", "b", "c"]);
    bridge.send({ t: "write", d: "d" });
    expect(posted.at(-1)).toEqual({ t: "write", d: "d" });
  });

  it("asks for a replay when the page reloads or the queue overflows", () => {
    const { bridge, onNeedsReplay } = bridgeWith();
    bridge.receive({ t: "ready" });
    bridge.receive({ t: "inited" });
    bridge.receive({ t: "ready" });
    expect(onNeedsReplay).toHaveBeenCalledTimes(1);
    expect(bridge.initialised).toBe(false);
    for (let i = 0; i <= MAX_QUEUED_COMMANDS; i++) bridge.send({ t: "write", d: "x" });
    expect(onNeedsReplay).toHaveBeenCalledTimes(2);
  });

  it("passes page input through", () => {
    const { bridge, inputs } = bridgeWith();
    bridge.receive({ t: "input", d: "ls\r" });
    expect(inputs).toEqual(["ls\r"]);
  });
});

const snap = (seq: number, data: string, last: boolean): AppEvent => ({
  ev: "term.snapshot",
  p: { sub: "s1", paneId: 1, cols: 80, rows: 24, data, seq, last },
});
const live = (data: string, sub = "s1"): AppEvent => ({ ev: "term.data", p: { sub, data } });

function feedWith() {
  const sent: PageCommand[] = [];
  const sizes: [number, number][] = [];
  const ends: string[] = [];
  const onGap = vi.fn<() => void>();
  const feed = createTerminalFeed({
    bridge: { send: (c) => sent.push(c as PageCommand) },
    onSize: (c, r) => sizes.push([c, r]),
    onEnd: (r) => ends.push(r),
    onGap,
  });
  const writes = () => sent.filter((c) => c.t === "write").map((c) => (c as { d: string }).d);
  return { feed, sent, sizes, ends, onGap, writes };
}

describe("terminal feed order", () => {
  it("writes the snapshot chunks in order, then live data", () => {
    const { feed, writes, sent, sizes } = feedWith();
    feed.expect();
    feed.begin("s1", 80, 24);
    feed.handle(snap(0, "A", false));
    feed.handle(snap(1, "B", false));
    feed.handle(snap(2, "C", true));
    feed.handle(live("D"));
    expect(writes()).toEqual(["A", "B", "C", "D"]);
    expect(sent[0]).toEqual({ t: "reset" });
    expect(sizes[0]).toEqual([80, 24]);
  });

  it("holds live data that arrives between snapshot chunks until the last one", () => {
    const { feed, writes } = feedWith();
    feed.expect();
    feed.begin("s1", 80, 24);
    feed.handle(snap(0, "A", false));
    feed.handle(live("X"));
    feed.handle(snap(1, "B", true));
    expect(writes()).toEqual(["A", "B", "X"]);
  });

  it("replays events that arrived before the subscribe answered", () => {
    const { feed, writes } = feedWith();
    feed.expect();
    feed.handle(snap(0, "A", true));
    feed.handle(live("B"));
    expect(writes()).toEqual([]);
    feed.begin("s1", 80, 24);
    expect(writes()).toEqual(["A", "B"]);
  });

  it("ignores another subscription's events and reports a missing chunk", () => {
    const { feed, writes, onGap } = feedWith();
    feed.expect();
    feed.begin("s1", 80, 24);
    feed.handle(live("other", "s2"));
    feed.handle(snap(0, "A", false));
    feed.handle(snap(2, "C", true));
    expect(writes()).toEqual(["A"]);
    expect(onGap).toHaveBeenCalledTimes(1);
  });

  it("applies the desktop's resize and reports the end", () => {
    const { feed, sent, sizes, ends } = feedWith();
    feed.expect();
    feed.begin("s1", 80, 24);
    feed.handle({ ev: "term.resize", p: { sub: "s1", cols: 100, rows: 30 } });
    feed.handle({ ev: "term.end", p: { sub: "s1", reason: "closed" } });
    expect(sent).toContainEqual({ t: "resize", cols: 100, rows: 30 });
    expect(sizes.at(-1)).toEqual([100, 30]);
    expect(ends).toEqual(["closed"]);
  });
});

describe("parsePageMessage", () => {
  it("accepts the page's messages and refuses anything else", () => {
    expect(parsePageMessage('{"t":"ready"}')).toEqual({ t: "ready" });
    expect(parsePageMessage('{"t":"input","d":"a"}')).toEqual({ t: "input", d: "a" });
    expect(parsePageMessage('{"t":"pinch","scale":1.5}')).toEqual({ t: "pinch", scale: 1.5 });
    expect(parsePageMessage('{"t":"pinch","scale":-1}')).toBeNull();
    expect(parsePageMessage('{"t":"input"}')).toBeNull();
    expect(parsePageMessage("nope")).toBeNull();
    expect(parsePageMessage('{"t":"other"}')).toBeNull();
  });
});
