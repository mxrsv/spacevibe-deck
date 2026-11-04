import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileStreamPiece } from "../host/mobile-host";
import { createMobileBridge, FLUSH_MS, type MobileBridgeDeps } from "./mobile-bridge";

function setup(over: Partial<MobileBridgeDeps> = {}) {
  const sent: MobileStreamPiece[] = [];
  const written: [number, string][] = [];
  const queries: unknown[] = [];
  let resolveSnapshot: (value: { data: string; cols: number; rows: number }) => void = () => {};
  let size = { cols: 80, rows: 24 };
  const panes = new Set([7]);
  const deps: MobileBridgeDeps = {
    tabs: () => [],
    activeIndex: () => 0,
    scans: () => new Map(),
    workspacePaths: () => [],
    scanRepository: async () => ({ kind: "plain", reason: "x" }),
    workspaceLabel: (p) => p,
    agentChoices: async () => [{ id: "claude", label: "Claude Code" }],
    agentLabel: () => null,
    screenText: () => "",
    hasPane: (id) => panes.has(id),
    paneSize: () => size,
    snapshot: () => new Promise((resolve) => (resolveSnapshot = resolve)),
    writePty: (id, data) => written.push([id, data]),
    reportQuery: (report) => queries.push(report),
    sendStream: (piece) => sent.push(piece),
    ...over,
  };
  return {
    bridge: createMobileBridge(deps),
    sent,
    written,
    queries,
    panes,
    takeSnapshot: (data: string) => resolveSnapshot({ data, cols: 80, rows: 24 }),
    resize: (cols: number, rows: number) => (size = { cols, rows }),
  };
}

describe("mobile bridge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the snapshot, then output buffered since the subscribe, then live output, in order", async () => {
    const t = setup();
    t.bridge.noteOutput(7, "before");
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.bridge.noteOutput(7, "during-1");
    t.bridge.noteOutput(7, "during-2");
    t.takeSnapshot("SCREEN");
    await Promise.resolve();
    expect(t.sent.map((p) => [p.kind, p.data])).toEqual([
      ["snapshot", "SCREEN"],
      ["data", "during-1during-2"],
    ]);
    t.bridge.noteOutput(7, "a");
    t.bridge.noteOutput(7, "b");
    expect(t.sent).toHaveLength(2);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.sent.at(-1)).toMatchObject({
      kind: "data",
      data: "ab",
      subscriptionId: "s1",
      paneId: 7,
    });
  });

  it("ignores output of other panes and panes it does not hold", async () => {
    const t = setup();
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.takeSnapshot("S");
    await Promise.resolve();
    t.bridge.noteOutput(8, "other");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.sent.map((p) => p.kind)).toEqual(["snapshot"]);
    t.bridge.handleSubscribe({ subscriptionId: "s2", paneId: 99 });
    expect(t.sent).toHaveLength(1);
  });

  it("types phone input through the pane client, and refuses malformed or foreign input", () => {
    const t = setup();
    t.bridge.handleInput({ paneId: 7, data: "ls\r" });
    t.bridge.handleInput({ paneId: 99, data: "x" });
    t.bridge.handleInput({ paneId: 7, data: "" });
    t.bridge.handleInput({ paneId: "7", data: "x" });
    t.bridge.handleInput(null);
    expect(t.written).toEqual([[7, "ls\r"]]);
  });

  it("ends the stream when the pane exits and flushes what was pending first", async () => {
    const t = setup();
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.takeSnapshot("S");
    await Promise.resolve();
    t.bridge.noteOutput(7, "last words");
    t.bridge.noteExit(7);
    expect(t.sent.slice(1).map((p) => [p.kind, p.data])).toEqual([
      ["data", "last words"],
      ["end", "closed"],
    ]);
    t.bridge.noteOutput(7, "ignored");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.sent).toHaveLength(3);
  });

  it("reports a resize it notices and ends a stream whose pane moved away, never resizing anything", async () => {
    const t = setup();
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.takeSnapshot("S");
    await Promise.resolve();
    t.resize(100, 30);
    vi.advanceTimersByTime(2_000);
    expect(t.sent.at(-1)).toMatchObject({ kind: "resize", cols: 100, rows: 30 });
    t.panes.delete(7);
    vi.advanceTimersByTime(2_000);
    expect(t.sent.at(-1)).toMatchObject({ kind: "end", data: "moved" });
  });

  it("sends a resize before the redraw that follows it, without waiting for the watch", async () => {
    const t = setup();
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.takeSnapshot("S");
    await Promise.resolve();
    t.bridge.noteOutput(7, "drawn at 80 columns");
    t.resize(100, 30);
    t.bridge.noteOutput(7, "redraw at 100 columns");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.sent.slice(1).map((p) => [p.kind, p.data, p.cols])).toEqual([
      ["data", "drawn at 80 columns", 80],
      ["resize", "", 100],
      ["data", "redraw at 100 columns", 100],
    ]);
  });

  it("stops quietly on unsubscribe", async () => {
    const t = setup();
    t.bridge.handleSubscribe({ subscriptionId: "s1", paneId: 7 });
    t.takeSnapshot("S");
    await Promise.resolve();
    t.bridge.handleUnsubscribe({ subscriptionId: "s1" });
    t.bridge.noteOutput(7, "x");
    vi.advanceTimersByTime(FLUSH_MS * 4);
    expect(t.sent.map((p) => p.kind)).toEqual(["snapshot"]);
  });

  it("answers queries with the request id and kind it was asked", async () => {
    vi.useRealTimers();
    const t = setup();
    t.bridge.handleQuery({ requestId: "q1", kind: "tree" });
    t.bridge.handleQuery({ requestId: "q2", kind: "agents" });
    t.bridge.handleQuery({ requestId: "q3", kind: "bogus" });
    t.bridge.handleQuery({ requestId: "", kind: "tree" });
    await vi.waitFor(() => expect(t.queries).toHaveLength(2));
    expect(t.queries).toEqual([
      { requestId: "q1", kind: "tree", payload: { projects: [] } },
      { requestId: "q2", kind: "agents", payload: [{ id: "claude", label: "Claude Code" }] },
    ]);
  });
});
