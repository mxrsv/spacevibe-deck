import { describe, expect, it, vi } from "vitest";
import { createPaneMirror } from "../control/pane-mirror";
import { createQueryBroker } from "./phone-queries";
import { createTreeHub, TREE_POLL_MS } from "./phone-tree";

const pane = (paneId: number) => ({
  paneId,
  title: "Claude",
  agent: "claude",
  agentLabel: "Claude Code",
  phase: "idle",
  attention: "none",
  attentionSince: null,
  lastLine: "hi",
  lastOutputAt: null,
});
const tree = (path: string, paneId: number) => ({
  projects: [
    {
      name: "deck",
      path: "/w/deck",
      checkouts: [{ name: "main", path, branch: "main", panes: [pane(paneId)] }],
    },
  ],
});

function setup(answers: Record<string, unknown>) {
  const sent: [string, string, string][] = [];
  const mirror = createPaneMirror({ now: () => 100 });
  let broker: ReturnType<typeof createQueryBroker>;
  broker = createQueryBroker({
    windows: () => Object.keys(answers),
    send: (label, requestId, kind) => {
      sent.push([label, requestId, kind]);
      queueMicrotask(() => broker.settle(label, requestId, kind as "tree", answers[label]));
    },
    timeoutMs: 50,
    newId: (() => {
      let n = 0;
      return () => `q${++n}`;
    })(),
  });
  return { hub: createTreeHub({ broker, mirror }), mirror, sent };
}

describe("tree hub with custom agents", () => {
  it("keeps a window's tree and known roots when a pane's agent label has a space", async () => {
    const t = setup({
      a: {
        projects: [
          {
            name: "deck",
            path: "/w/deck",
            checkouts: [
              {
                name: "main",
                path: "/w/deck",
                branch: "main",
                panes: [
                  { ...pane(1), agent: "My Aider", agentLabel: "My Aider" },
                  { ...pane(2), agent: "custom:x" },
                  { ...pane(3), phase: "nonsense" },
                ],
              },
            ],
          },
        ],
      },
    });
    const snapshot = await t.hub.snapshot();
    expect(snapshot.projects[0]?.checkouts[0]?.panes.map((p) => p.paneId)).toEqual([1, 2]);
    expect(await t.hub.isKnownRoot("/w/deck")).toBe(true);
  });
});

describe("query broker", () => {
  it("accepts an answer only from a window it asked, for the kind it asked, once", async () => {
    const broker = createQueryBroker({
      windows: () => ["a"],
      send: () => {},
      timeoutMs: 20,
      newId: () => "q",
    });
    const pending = broker.query("tree");
    expect(broker.settle("b", "q", "tree", {})).toBe(false);
    expect(broker.settle("a", "q", "agents", {})).toBe(false);
    expect(broker.settle("a", "nope", "tree", {})).toBe(false);
    expect(broker.settle("a", "q", "tree", { ok: 1 })).toBe(true);
    expect(await pending).toEqual([{ label: "a", payload: { ok: 1 } }]);
    expect(broker.settle("a", "q", "tree", {})).toBe(false);
  });

  it("answers with whoever replied when a window never does", async () => {
    vi.useFakeTimers();
    try {
      const broker = createQueryBroker({
        windows: () => ["a", "b"],
        send: () => {},
        timeoutMs: 100,
        newId: () => "q",
      });
      const pending = broker.query("tree");
      broker.settle("a", "q", "tree", 1);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toEqual([{ label: "a", payload: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tree hub", () => {
  it("merges windows by project and checkout path and overlays the mirror's phase and attention", async () => {
    const t = setup({ w1: tree("/w/deck", 1), w2: tree("/w/deck", 2) });
    t.mirror.report(1, {
      phase: "working",
      attention: "requested",
      source: "hook",
      confidence: "explicit",
      agent: "claude",
      pid: 4,
    });
    const merged = await t.hub.snapshot();
    expect(merged.projects).toHaveLength(1);
    const panes = merged.projects[0]!.checkouts[0]!.panes;
    expect(panes.map((p) => p.paneId)).toEqual([1, 2]);
    expect(panes[0]).toMatchObject({
      phase: "working",
      attention: "requested",
      attentionSince: 100,
    });
    expect(panes[1]).toMatchObject({ phase: "idle", attention: "none" });
  });

  it("knows which window holds a path and drops a window's malformed tree", async () => {
    const t = setup({ w1: tree("/w/deck", 1), w2: { projects: "nope" } });
    await t.hub.snapshot();
    expect(t.hub.windowHolding("/w/deck")).toBe("w1");
    expect(t.hub.windowHolding("/elsewhere")).toBeNull();
  });

  it("pushes only changes, and polls only while someone listens", async () => {
    vi.useFakeTimers();
    try {
      let answer: unknown = tree("/w/deck", 1);
      const sent: string[] = [];
      let broker: ReturnType<typeof createQueryBroker>;
      broker = createQueryBroker({
        windows: () => ["w1"],
        send: (label, requestId, kind) => {
          sent.push(requestId);
          queueMicrotask(() => broker.settle(label, requestId, kind as "tree", answer));
        },
        timeoutMs: 50,
      });
      const hub = createTreeHub({ broker, mirror: createPaneMirror({ now: () => 1 }) });
      const listener = vi.fn();
      const first = await (async () => {
        const promise = hub.snapshot();
        await vi.advanceTimersByTimeAsync(0);
        return promise;
      })();
      const stop = hub.subscribe(listener, first);
      await vi.advanceTimersByTimeAsync(TREE_POLL_MS);
      expect(listener).not.toHaveBeenCalled();
      answer = tree("/w/deck", 2);
      await vi.advanceTimersByTimeAsync(TREE_POLL_MS);
      expect(listener).toHaveBeenCalledOnce();
      stop();
      const polls = sent.length;
      await vi.advanceTimersByTimeAsync(TREE_POLL_MS * 3);
      expect(sent).toHaveLength(polls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats only reported projects and checkouts as known roots", async () => {
    const t = setup({ w1: tree("/w/deck-side", 1) });
    await t.hub.snapshot();
    expect(await t.hub.isKnownRoot("/w/deck-side")).toBe(true);
    expect(await t.hub.isKnownRoot("/etc")).toBe(false);
  });
});
