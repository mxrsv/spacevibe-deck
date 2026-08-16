import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionsClient } from "./sessions-client";
import {
  deadProjects,
  probeSessionsSupport,
  refreshSessions,
  resetSessionFilters,
  sessionAgentFilter,
  sessionEntries,
  sessionsLoading,
  sessionsSupported,
  sessionTotals,
} from "./sessions-store";
import type { SessionEntry } from "../lib/session-history";

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
  });

  it("marks the host unsupported when the probe throws", async () => {
    await probeSessionsSupport(
      createMemorySessionsClient(null, { fail: true }),
    );
    expect(sessionsSupported.value).toBe(false);
  });
});
