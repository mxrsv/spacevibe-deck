import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_SNAPSHOT,
  createClaudeRegistry,
  parseClaudeAgents,
  type CommandResult,
} from "./claude-registry";

/** The shape `claude agents --json` printed on the owner's machine, 2026-09-03. */
const SAMPLE = JSON.stringify([
  {
    id: "6c4430ef",
    cwd: "/Users/dev/tokentools",
    kind: "background",
    startedAt: 1778551375528,
    sessionId: "6c4430ef-0e78-4675-9db7-6c1ac4554b98",
    name: "multilingual greeting handler",
    state: "blocked",
  },
  {
    pid: 82931,
    cwd: "/Users/dev/deck",
    kind: "interactive",
    startedAt: 1787644469915,
    sessionId: "a79dbead-d71b-445b-b328-86f9952b1d84",
    name: "deck-26",
    status: "idle",
  },
  {
    pid: 62249,
    cwd: "/Users/dev",
    kind: "interactive",
    startedAt: 1788336495928,
    sessionId: "cfa4f705-0bab-43fb-bf39-c0c4732c92c7",
    name: "dev-6b",
    status: "waiting",
    waitingFor: "dialog open",
  },
]);

describe("parseClaudeAgents", () => {
  it("keeps every entry with a pid and a safe session id, and skips the rest", () => {
    const entries = parseClaudeAgents(SAMPLE);
    expect(entries).toEqual([
      {
        pid: 82931,
        cwd: "/Users/dev/deck",
        sessionId: "a79dbead-d71b-445b-b328-86f9952b1d84",
        status: "idle",
        waitingFor: null,
        name: "deck-26",
        kind: "interactive",
      },
      {
        pid: 62249,
        cwd: "/Users/dev",
        sessionId: "cfa4f705-0bab-43fb-bf39-c0c4732c92c7",
        status: "waiting",
        waitingFor: "dialog open",
        name: "dev-6b",
        kind: "interactive",
      },
    ]);
  });

  it("skips a malformed entry without dropping its siblings", () => {
    const entries = parseClaudeAgents(
      JSON.stringify([
        null,
        "text",
        { pid: "82931", sessionId: "a" },
        { pid: 1, sessionId: "../../etc/passwd" },
        { pid: 2, sessionId: "ok-session" },
      ]),
    );
    expect(entries.map((entry) => entry.pid)).toEqual([2]);
    expect(entries[0]?.status).toBe("unknown");
  });

  it("throws on anything that is not a JSON array, so the poller can flag it stale", () => {
    expect(() => parseClaudeAgents("not json")).toThrow(SyntaxError);
    expect(() => parseClaudeAgents('{"pid":1}')).toThrow("registry output is not an array");
    expect(() => parseClaudeAgents("x".repeat(1024 * 1024 + 1))).toThrow(/size cap/);
  });
});

describe("createClaudeRegistry", () => {
  function harness(results: readonly CommandResult[], binary: string | null = "/opt/bin/claude") {
    const clock = { t: 100_000 };
    const timers = new Map<number, { fn: () => void; at: number }>();
    let nextTimer = 1;
    const run = vi.fn(async () => results[Math.min(run.mock.calls.length - 1, results.length - 1)]);
    const resolveBinary = vi.fn(async () => binary);
    const registry = createClaudeRegistry({
      resolveBinary,
      run,
      now: () => clock.t,
      intervalMs: 5000,
      idleAfterMs: 15_000,
      setTimer: (fn, ms) => {
        const id = nextTimer;
        nextTimer += 1;
        timers.set(id, { fn, at: clock.t + ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (timer) => {
        timers.delete(timer as unknown as number);
      },
    });
    /** Advance the clock and fire every timer that came due, in order. */
    async function advance(ms: number): Promise<void> {
      clock.t += ms;
      for (const [id, entry] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at <= clock.t) {
          timers.delete(id);
          entry.fn();
          await flush();
        }
      }
    }
    async function flush(): Promise<void> {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    }
    return { registry, run, resolveBinary, advance, flush, timers, clock };
  }

  it("answers the empty snapshot at once and the parsed list once the first poll lands", async () => {
    const { registry, run, flush } = harness([{ stdout: SAMPLE, ok: true }]);
    expect(registry.read()).toBe(EMPTY_SNAPSHOT);
    await flush();
    const snapshot = registry.read();
    expect(snapshot.available).toBe(true);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.polledAt).toBe(100_000);
    expect(snapshot.entries.map((entry) => entry.pid)).toEqual([82931, 62249]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps polling on its own clock while a renderer keeps asking, and stops when nobody does", async () => {
    const { registry, run, advance, flush, timers } = harness([{ stdout: SAMPLE, ok: true }]);
    registry.read();
    await flush();
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(2);
    registry.read(); // still asking
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(3);
    // 15 s with no ask: the loop lets itself lapse.
    await advance(5000);
    await advance(5000);
    await advance(5000);
    await advance(5000);
    expect(timers.size).toBe(0);
    const before = run.mock.calls.length;
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(before);
    // The next ask restarts it.
    registry.read();
    await flush();
    expect(run).toHaveBeenCalledTimes(before + 1);
  });

  it("answers the previous list flagged stale on a failed or unparseable poll", async () => {
    const { registry, advance, flush } = harness([
      { stdout: SAMPLE, ok: true },
      { stdout: "", ok: false },
      { stdout: "garbage", ok: true },
      { stdout: "[]", ok: true },
    ]);
    registry.read();
    await flush();
    expect(registry.read().entries).toHaveLength(2);

    await advance(5000); // non-zero exit
    let snapshot = registry.read();
    expect(snapshot.stale).toBe(true);
    expect(snapshot.available).toBe(true);
    expect(snapshot.entries).toHaveLength(2);

    await advance(5000); // parse failure
    snapshot = registry.read();
    expect(snapshot.stale).toBe(true);
    expect(snapshot.entries).toHaveLength(2);

    await advance(5000); // recovered: an honest empty list replaces the stale one
    snapshot = registry.read();
    expect(snapshot.stale).toBe(false);
    expect(snapshot.entries).toEqual([]);
  });

  it("stays unavailable and never runs the command when claude is not installed", async () => {
    const { registry, run, flush, advance } = harness([{ stdout: SAMPLE, ok: true }], null);
    registry.read();
    await flush();
    await advance(5000);
    expect(run).not.toHaveBeenCalled();
    expect(registry.read().available).toBe(false);
  });

  it("re-resolves the binary after a launch failure", async () => {
    const { registry, resolveBinary, flush, advance } = harness([
      { stdout: "", ok: false },
      { stdout: SAMPLE, ok: true },
    ]);
    registry.read();
    await flush();
    await advance(5000);
    expect(resolveBinary).toHaveBeenCalledTimes(2);
    expect(registry.read().available).toBe(true);
  });

  it("dispose stops the loop", async () => {
    const { registry, run, flush, advance, timers } = harness([{ stdout: SAMPLE, ok: true }]);
    registry.read();
    await flush();
    registry.dispose();
    expect(timers.size).toBe(0);
    await advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
