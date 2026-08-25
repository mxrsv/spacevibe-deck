import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionsClient } from "./sessions-client";
import {
  deadProjects,
  probeSessionsSupport,
  recentDeadProjects,
  recentSessionEntries,
  recentSessionsLoading,
  recentSessionsLoadState,
  refreshRecentSessions,
  refreshSessions,
  resetSessionFilters,
  sessionAgentFilter,
  sessionEntries,
  sessionsLoadState,
  sessionsLoading,
  sessionsSupported,
  sessionTotals,
} from "./sessions-store";
import type { SessionEntry } from "../lib/session-history";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function entry(over: Partial<SessionEntry>): SessionEntry {
  return {
    agent: "claude",
    sessionId: "id",
    cwd: "/work/a",
    lastActivityMs: 1,
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

beforeEach(() => {
  sessionEntries.value = [];
  recentSessionEntries.value = [];
  sessionsLoading.value = false;
  recentSessionsLoading.value = false;
  sessionsSupported.value = true;
  sessionsLoadState.value = { status: "idle" };
  recentSessionsLoadState.value = { status: "idle" };
  deadProjects.value = new Set();
  recentDeadProjects.value = new Set();
  resetSessionFilters();
});

describe("refreshSessions", () => {
  it("stores entries and totals from one scan", async () => {
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "a" })],
        totals: { claude: 900, codex: 3 },
        limit: 500,
      }),
    );
    expect(sessionEntries.value.map((e) => e.sessionId)).toEqual(["a"]);
    expect(sessionTotals.value.claude).toBe(900);
    expect(sessionsLoading.value).toBe(false);
  });

  it("marks the host unsupported when the facade answers null", async () => {
    await refreshSessions(createMemorySessionsClient(null));
    expect(sessionsSupported.value).toBe(false);
    expect(sessionEntries.value).toEqual([]);
  });

  it("records the cwds that no longer exist", async () => {
    await refreshSessions(
      createMemorySessionsClient(
        {
          entries: [
            entry({ sessionId: "a", cwd: "/gone" }),
            entry({ sessionId: "b", cwd: "/here" }),
          ],
          totals: { claude: 2, codex: 0 },
          limit: 500,
        },
        { alive: (path) => path === "/here" },
      ),
    );
    expect([...deadProjects.value]).toEqual(["/gone"]);
  });

  it("keeps the previous list when a scan throws", async () => {
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "a" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );
    await refreshSessions(createMemorySessionsClient(null, { fail: true }));
    expect(sessionEntries.value.map((e) => e.sessionId)).toEqual(["a"]);
    expect(sessionsLoadState.value).toEqual({
      status: "error",
      message: "Couldn't read recorded sessions.",
    });
  });

  it("keeps the whole last-good snapshot when directory liveness fails", async () => {
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "old" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );

    await refreshSessions({
      async list() {
        return {
          entries: [entry({ sessionId: "new", cwd: "/work/new" })],
          totals: { claude: 2, codex: 0 },
          limit: 500,
        };
      },
      async dirsExist() {
        throw new Error("dirs_exist failed");
      },
      async tails(requests) {
        return requests.map(() => null);
      },
    });

    expect(sessionEntries.value.map((item) => item.sessionId)).toEqual(["old"]);
    expect(sessionTotals.value).toEqual({ claude: 1, codex: 0 });
    expect(sessionsLoadState.value.status).toBe("error");
  });

  it("ignores an older refresh failure after a retry succeeds", async () => {
    const oldList = deferred<never>();
    const first = refreshSessions({
      list: () => oldList.promise,
      dirsExist: async () => [],
      tails: async (requests) => requests.map(() => null),
    });
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "new" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );
    oldList.reject(new Error("stale scan failure"));
    await first;

    expect(sessionEntries.value.map((item) => item.sessionId)).toEqual(["new"]);
    expect(sessionsLoadState.value).toEqual({ status: "ready" });
  });

  it("lets a pending refresh finish when the support probe starts later", async () => {
    const snapshot = {
      entries: [entry({ sessionId: "new" })],
      totals: { claude: 1, codex: 0 },
      limit: 500,
    };
    const pendingList = deferred<typeof snapshot>();
    const refresh = refreshSessions({
      list: () => pendingList.promise,
      dirsExist: async () => [true],
      tails: async (requests) => requests.map(() => null),
    });

    await probeSessionsSupport(createMemorySessionsClient(snapshot));
    pendingList.resolve(snapshot);
    await refresh;

    expect(sessionsLoading.value).toBe(false);
    expect(sessionEntries.value.map((item) => item.sessionId)).toEqual(["new"]);
    expect(sessionsLoadState.value).toEqual({ status: "ready" });
  });

  it("resets filters that no longer match anything", () => {
    sessionAgentFilter.value = "codex";
    resetSessionFilters();
    expect(sessionAgentFilter.value).toBe("all");
  });
});

describe("probeSessionsSupport", () => {
  it("marks the host unsupported when the facade answers null", async () => {
    await probeSessionsSupport(createMemorySessionsClient(null));
    expect(sessionsSupported.value).toBe(false);
    expect(sessionEntries.value).toEqual([]);
  });

  it("marks the host supported without storing the reply", async () => {
    const totalsBefore = sessionTotals.value;
    await probeSessionsSupport(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "a" })],
        totals: { claude: 900, codex: 3 },
        limit: 1,
      }),
    );
    expect(sessionsSupported.value).toBe(true);
    // The probe asks for one entry to learn whether a handler exists. Keeping
    // that entry would paint a one-row history over an unscanned list.
    expect(sessionEntries.value).toEqual([]);
    expect(sessionTotals.value).toBe(totalsBefore);
    expect(sessionsLoadState.value.status).toBe("idle");
  });

  it("keeps the host available for retry when the probe throws", async () => {
    await probeSessionsSupport(createMemorySessionsClient(null, { fail: true }));
    expect(sessionsSupported.value).toBe(true);
    expect(sessionsLoadState.value.status).toBe("error");
  });

  it("ignores an older probe failure after a full refresh succeeds", async () => {
    const oldProbe = deferred<never>();
    const probe = probeSessionsSupport({
      list: () => oldProbe.promise,
      dirsExist: async () => [],
      tails: async (requests) => requests.map(() => null),
    });
    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "new" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );
    oldProbe.reject(new Error("stale probe failure"));
    await probe;

    expect(sessionsLoadState.value).toEqual({ status: "ready" });
  });
});

describe("refreshRecentSessions", () => {
  it("stores only the globally newest five mixed-agent sessions with exact tails", async () => {
    const source = [
      entry({ agent: "claude", sessionId: "one", cwd: "/work/a", lastActivityMs: 10 }),
      entry({ agent: "codex", sessionId: "six", cwd: "/gone", lastActivityMs: 60 }),
      entry({ agent: "claude", sessionId: "three", cwd: "/work/a", lastActivityMs: 30 }),
      entry({ agent: "codex", sessionId: "five", cwd: "/work/b", lastActivityMs: 50 }),
      entry({ agent: "claude", sessionId: "two", cwd: "/work/c", lastActivityMs: 20 }),
      entry({ agent: "codex", sessionId: "four", cwd: "/gone", lastActivityMs: 40 }),
    ];
    let requestedLimit = 0;
    let requestedIds: readonly string[] = [];
    let probedCwds: readonly string[] = [];

    await refreshRecentSessions({
      async list(limit) {
        requestedLimit = limit;
        return { entries: source, totals: { claude: 3, codex: 3 }, limit };
      },
      async tails(requests) {
        requestedIds = requests.map((request) => request.preferredId ?? "");
        return requests.map((request) => ({
          id: request.preferredId ?? "",
          tail: `tail ${request.preferredId}`,
        }));
      },
      async dirsExist(paths) {
        probedCwds = paths;
        return paths.map((path) => path !== "/gone");
      },
    });

    expect(requestedLimit).toBe(5);
    expect(recentSessionEntries.value.map((item) => item.sessionId)).toEqual([
      "six",
      "five",
      "four",
      "three",
      "two",
    ]);
    expect(recentSessionEntries.value.map((item) => item.summary)).toEqual([
      "tail six",
      "tail five",
      "tail four",
      "tail three",
      "tail two",
    ]);
    expect(requestedIds).toEqual(["six", "five", "four", "three", "two"]);
    expect(probedCwds).toEqual(["/gone", "/work/b", "/work/a", "/work/c"]);
    expect([...recentDeadProjects.value]).toEqual(["/gone"]);
    expect(source.map((item) => item.sessionId)).toEqual([
      "one",
      "six",
      "three",
      "five",
      "two",
      "four",
    ]);
  });

  it("uses only an exact-id tail and otherwise falls back to title then id", async () => {
    await refreshRecentSessions(
      createMemorySessionsClient(
        {
          entries: [
            entry({ sessionId: "a", title: "Title A", lastActivityMs: 3 }),
            entry({ sessionId: "b", title: null, lastActivityMs: 2 }),
            entry({ sessionId: "c", title: "Title C", lastActivityMs: 1 }),
          ],
          totals: { claude: 3, codex: 0 },
          limit: 5,
        },
        {
          tails: [
            { id: "a", tail: "Exact A" },
            { id: "another-session", tail: "Must not leak" },
            { id: "c", tail: null },
          ],
        },
      ),
    );

    expect(recentSessionEntries.value.map((item) => item.summary)).toEqual([
      "Exact A",
      "b",
      "Title C",
    ]);
  });

  it("reports a cold load until the complete recent snapshot is ready", async () => {
    const pending = deferred<{
      entries: readonly SessionEntry[];
      totals: { claude: number; codex: number };
      limit: number;
    }>();
    const refresh = refreshRecentSessions({
      list: () => pending.promise,
      tails: async (requests) => requests.map(() => null),
      dirsExist: async (paths) => paths.map(() => true),
    });

    expect(recentSessionsLoading.value).toBe(true);
    expect(recentSessionsLoadState.value).toEqual({ status: "loading" });

    pending.resolve({ entries: [], totals: { claude: 0, codex: 0 }, limit: 5 });
    await refresh;

    expect(recentSessionsLoading.value).toBe(false);
    expect(recentSessionsLoadState.value).toEqual({ status: "ready" });
  });

  it("marks an unsupported host and clears stale recent state", async () => {
    recentSessionEntries.value = [{ ...entry({ sessionId: "old" }), summary: "Old summary" }];
    recentDeadProjects.value = new Set(["/work/a"]);

    await refreshRecentSessions(createMemorySessionsClient(null));

    expect(sessionsSupported.value).toBe(false);
    expect(recentSessionEntries.value).toEqual([]);
    expect([...recentDeadProjects.value]).toEqual([]);
    expect(recentSessionsLoadState.value).toEqual({ status: "ready" });
  });

  it("keeps the whole last-good recent snapshot when enrichment fails", async () => {
    await refreshRecentSessions(
      createMemorySessionsClient(
        {
          entries: [entry({ sessionId: "old", title: "Old", cwd: "/gone" })],
          totals: { claude: 1, codex: 0 },
          limit: 5,
        },
        { alive: () => false, tails: [{ id: "old", tail: "Old summary" }] },
      ),
    );

    await refreshRecentSessions({
      async list() {
        return {
          entries: [entry({ sessionId: "new", title: "New", cwd: "/work/new" })],
          totals: { claude: 1, codex: 0 },
          limit: 5,
        };
      },
      async tails() {
        throw new Error("session_tail failed");
      },
      async dirsExist(paths) {
        return paths.map(() => true);
      },
    });

    expect(recentSessionEntries.value.map((item) => item.sessionId)).toEqual(["old"]);
    expect([...recentDeadProjects.value]).toEqual(["/gone"]);
    expect(recentSessionsLoadState.value).toEqual({
      status: "error",
      message: "Couldn't read recent activity.",
    });
  });

  it("keeps support and the last-good recent snapshot when listing fails transiently", async () => {
    await refreshRecentSessions(
      createMemorySessionsClient(
        {
          entries: [entry({ sessionId: "old", cwd: "/gone" })],
          totals: { claude: 1, codex: 0 },
          limit: 5,
        },
        { alive: () => false, tails: [{ id: "old", tail: "Last good summary" }] },
      ),
    );

    await refreshRecentSessions(createMemorySessionsClient(null, { fail: true }));

    expect(sessionsSupported.value).toBe(true);
    expect(recentSessionEntries.value.map((item) => [item.sessionId, item.summary])).toEqual([
      ["old", "Last good summary"],
    ]);
    expect([...recentDeadProjects.value]).toEqual(["/gone"]);
    expect(recentSessionsLoadState.value).toEqual({
      status: "error",
      message: "Couldn't read recent activity.",
    });
  });

  it("ignores an older recent result after a retry succeeds", async () => {
    const oldList = deferred<{
      entries: readonly SessionEntry[];
      totals: { claude: number; codex: number };
      limit: number;
    }>();
    const first = refreshRecentSessions({
      list: () => oldList.promise,
      tails: async (requests) => requests.map(() => null),
      dirsExist: async (paths) => paths.map(() => true),
    });

    await refreshRecentSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "new", title: "New" })],
        totals: { claude: 1, codex: 0 },
        limit: 5,
      }),
    );
    oldList.resolve({
      entries: [entry({ sessionId: "old", title: "Old" })],
      totals: { claude: 1, codex: 0 },
      limit: 5,
    });
    await first;

    expect(recentSessionEntries.value.map((item) => item.sessionId)).toEqual(["new"]);
    expect(recentSessionsLoadState.value).toEqual({ status: "ready" });
  });

  it("cannot override a newer full refresh support decision", async () => {
    const oldRecent = deferred<null>();
    const recent = refreshRecentSessions({
      list: () => oldRecent.promise,
      tails: async (requests) => requests.map(() => null),
      dirsExist: async (paths) => paths.map(() => true),
    });

    await refreshSessions(
      createMemorySessionsClient({
        entries: [entry({ sessionId: "full" })],
        totals: { claude: 1, codex: 0 },
        limit: 500,
      }),
    );
    oldRecent.resolve(null);
    await recent;

    expect(sessionsSupported.value).toBe(true);
    expect(sessionEntries.value.map((item) => item.sessionId)).toEqual(["full"]);
  });
});
