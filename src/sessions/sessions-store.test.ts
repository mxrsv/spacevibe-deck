import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionsClient } from "./sessions-client";
import {
  deadProjects,
  probeSessionsSupport,
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
  sessionsSupported.value = true;
  sessionsLoadState.value = { status: "idle" };
  deadProjects.value = new Set();
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
    await probeSessionsSupport(
      createMemorySessionsClient(null, { fail: true }),
    );
    expect(sessionsSupported.value).toBe(true);
    expect(sessionsLoadState.value.status).toBe("error");
  });

  it("ignores an older probe failure after a full refresh succeeds", async () => {
    const oldProbe = deferred<never>();
    const probe = probeSessionsSupport({
      list: () => oldProbe.promise,
      dirsExist: async () => [],
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
