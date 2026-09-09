import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegistryEntry, RegistrySnapshot } from "../lib/agent-registry";
import { createAgentRegistrySync, factOf, type RegistryFact } from "./agent-registry-sync";

function entry(pid: number, over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    pid,
    cwd: "/w",
    sessionId: `session-${pid}`,
    status: "idle",
    waitingFor: null,
    name: null,
    kind: "interactive",
    ...over,
  };
}

function snapshot(
  entries: readonly RegistryEntry[],
  over: Partial<RegistrySnapshot> = {},
): RegistrySnapshot {
  return { available: true, stale: false, polledAt: 1, entries, ...over };
}

function harness(snapshots: readonly RegistrySnapshot[]) {
  const facts: Array<[number, RegistryFact | null]> = [];
  const agents = new Map<number, string | null>([
    [1, "claude"],
    [2, "claude"],
    [3, "codex"],
  ]);
  const pids = new Map<number, number | null>([
    [1, 101],
    [2, 102],
    [3, 103],
  ]);
  let paneIds = [1, 2, 3];
  const fetch = vi.fn(
    async () => snapshots[Math.min(fetch.mock.calls.length - 1, snapshots.length - 1)],
  );
  const onApplied = vi.fn();
  const sync = createAgentRegistrySync({
    fetch,
    paneIds: () => paneIds,
    agentOf: (id) => agents.get(id) ?? null,
    processIdOf: (id) => pids.get(id) ?? null,
    onFact: (id, fact) => {
      facts.push([id, fact]);
    },
    onApplied,
    intervalMs: 5000,
  });
  return {
    sync,
    facts,
    fetch,
    onApplied,
    agents,
    pids,
    setPanes(ids: number[]) {
      paneIds = ids;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("factOf", () => {
  it("reads waiting and its detail off the entry, and nothing else", () => {
    expect(factOf(entry(1, { status: "waiting", waitingFor: "permission prompt" }))).toEqual({
      sessionId: "session-1",
      waiting: true,
      detail: "permission prompt",
    });
    expect(factOf(entry(1, { status: "idle", waitingFor: "leftover" }))).toEqual({
      sessionId: "session-1",
      waiting: false,
      detail: null,
    });
  });
});

describe("createAgentRegistrySync", () => {
  it("joins each Claude pane on its foreground pid and hands the tracker a fact", async () => {
    const { sync, facts, onApplied } = harness([
      snapshot([entry(101), entry(102, { status: "waiting", waitingFor: "input needed" })]),
    ]);
    await sync.poll();
    expect(facts).toEqual([
      [1, { sessionId: "session-101", waiting: false, detail: null }],
      [2, { sessionId: "session-102", waiting: true, detail: "input needed" }],
    ]);
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("never joins a non-Claude pane, and asks nothing when no Claude pane exists", async () => {
    const { sync, facts, fetch, agents } = harness([snapshot([entry(103)])]);
    agents.set(1, "codex");
    agents.set(2, null);
    await sync.poll();
    expect(fetch).not.toHaveBeenCalled();
    expect(facts).toEqual([]);
  });

  it("reports a pane absent only after two consecutive fresh polls without it", async () => {
    const { sync, facts } = harness([
      snapshot([entry(101), entry(102)]),
      snapshot([entry(101)]),
      snapshot([entry(101)]),
      snapshot([entry(101), entry(102)]),
    ]);
    await sync.poll();
    await sync.poll(); // one miss: nothing said about pane 2
    expect(facts.filter(([id]) => id === 2)).toHaveLength(1);
    await sync.poll(); // second miss: absent
    expect(facts.at(-1)).toEqual([2, null]);
    await sync.poll(); // back: the counter reset, a fact again
    expect(facts.at(-1)).toEqual([2, { sessionId: "session-102", waiting: false, detail: null }]);
  });

  it("a stale or unavailable snapshot counts for nothing — no fact, no miss", async () => {
    const { sync, facts, onApplied } = harness([
      snapshot([entry(101), entry(102)]),
      snapshot([entry(101)], { stale: true }),
      snapshot([], { available: false, stale: true }),
      snapshot([entry(101)]),
      snapshot([entry(101)]),
    ]);
    await sync.poll();
    await sync.poll();
    await sync.poll();
    expect(onApplied).toHaveBeenCalledOnce();
    expect(facts).toHaveLength(2);
    await sync.poll(); // first FRESH miss
    expect(facts).toHaveLength(3);
    await sync.poll(); // second fresh miss → absent
    expect(facts.at(-1)).toEqual([2, null]);
  });

  it("drops a pane that closed while the fetch was in flight", async () => {
    let resolveFetch: (value: RegistrySnapshot) => void = () => {};
    const fetch = () =>
      new Promise<RegistrySnapshot>((resolve) => {
        resolveFetch = resolve;
      });
    const facts: Array<[number, RegistryFact | null]> = [];
    let paneIds = [1];
    const sync = createAgentRegistrySync({
      fetch,
      paneIds: () => paneIds,
      agentOf: () => "claude",
      processIdOf: () => 101,
      onFact: (id, fact) => {
        facts.push([id, fact]);
      },
    });
    const pending = sync.poll();
    paneIds = [];
    resolveFetch(snapshot([entry(101)]));
    await pending;
    expect(facts).toEqual([]);
  });

  it("polls on its interval while started, and stops cleanly", async () => {
    const { sync, fetch } = harness([snapshot([entry(101)])]);
    sync.start();
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    sync.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a rejected fetch is logged and the loop survives it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const facts: Array<[number, RegistryFact | null]> = [];
    const sync = createAgentRegistrySync({
      fetch: async () => {
        throw new Error("ipc down");
      },
      paneIds: () => [1],
      agentOf: () => "claude",
      processIdOf: () => 101,
      onFact: (id, fact) => {
        facts.push([id, fact]);
      },
    });
    await sync.poll();
    expect(facts).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("prune forgets miss counters for closed panes", async () => {
    const { sync, facts, setPanes } = harness([
      snapshot([entry(101)]),
      snapshot([entry(101), entry(102)]),
    ]);
    await sync.poll(); // pane 2: one miss
    sync.prune([1, 3]);
    setPanes([1, 2, 3]);
    await sync.poll(); // listed again — and had it not been, the count restarts at one
    expect(facts.filter(([id, fact]) => id === 2 && fact === null)).toHaveLength(0);
  });
});
