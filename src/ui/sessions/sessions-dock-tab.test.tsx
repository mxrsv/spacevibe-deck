// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../lib/session-history";

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: "claude",
    sessionId: "sid",
    cwd: "/Users/me/work/repo",
    lastActivityMs: 1,
    title: "make the thing work",
    sourcePath: "/p",
    ...over,
  };
}

// The store's real code path runs; only the host bridge is faked. That is what
// makes this a regression test for the wiring rather than for a spy.
vi.mock("../../sessions/sessions-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../sessions/sessions-client")>();
  return {
    ...actual,
    defaultSessionsClient: actual.createMemorySessionsClient({
      entries: [entry({ sessionId: "a" }), entry({ sessionId: "b" })],
      totals: { claude: 459, codex: 692 },
      limit: 500,
    }),
  };
});

const { SessionsDockTab } = await import("./sessions-dock-tab");
const {
  deadProjects,
  resetSessionFilters,
  sessionEntries,
  sessionsLoading,
  sessionTotals,
} = await import("../../sessions/sessions-store");

describe("SessionsDockTab", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    sessionEntries.value = [];
    sessionTotals.value = { claude: 0, codex: 0 };
    sessionsLoading.value = false;
    deadProjects.value = new Set();
    resetSessionFilters();
  });

  afterEach(() => {
    render(null, host);
  });

  it("scans on mount, so the tab does not open onto an empty store", async () => {
    await act(async () => {
      render(<SessionsDockTab onResume={() => {}} />, host);
    });
    await act(async () => {});

    expect(sessionEntries.value.map((row) => row.sessionId)).toEqual([
      "a",
      "b",
    ]);
    expect(sessionTotals.value).toEqual({ claude: 459, codex: 692 });
    expect(host.querySelector(".sessions-body--dock")).not.toBeNull();
  });

  it("re-scans when the tab is closed and opened again", async () => {
    await act(async () => {
      render(<SessionsDockTab onResume={() => {}} />, host);
    });
    await act(async () => {});
    render(null, host);
    sessionEntries.value = [];
    sessionTotals.value = { claude: 0, codex: 0 };

    await act(async () => {
      render(<SessionsDockTab onResume={() => {}} />, host);
    });
    await act(async () => {});

    expect(sessionEntries.value).toHaveLength(2);
  });
});
