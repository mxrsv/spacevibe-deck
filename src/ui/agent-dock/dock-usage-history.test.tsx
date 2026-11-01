// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dock's import graph reaches the host (settings, sessions, usage): stub it as the dock's own
// tests do, and replace what would start a real scan or poll with a spy.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../usage/usage-store", async () => {
  const actual =
    await vi.importActual<typeof import("../../usage/usage-store")>("../../usage/usage-store");
  return { ...actual, startUsagePolling: vi.fn(), stopUsagePolling: vi.fn() };
});
vi.mock("../../sessions/sessions-store", async () => {
  const actual = await vi.importActual<typeof import("../../sessions/sessions-store")>(
    "../../sessions/sessions-store",
  );
  return { ...actual, refreshSessions: vi.fn(async () => {}) };
});

import { activeWorkspace } from "../../files/file-surface-store";
import { LOAD_READY, loadError } from "../../lib/load-state";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import type { SessionEntry } from "../../lib/session-history";
import type { UsageBucket, UsageSnapshot } from "../../lib/usage-snapshot";
import {
  deadProjects,
  refreshSessions,
  sessionEntries,
  sessionsLoading,
  sessionsLoadState,
} from "../../sessions/sessions-store";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import {
  activeTabIndex,
  statusInfo,
  tabViews,
  type PaneView,
  type TabView,
} from "../../terminal/tabs-store";
import {
  startUsagePolling,
  stopUsagePolling,
  usageLoading,
  usageSnapshot,
  usageStale,
} from "../../usage/usage-store";
import { click, mount, settle, waitUntil } from "../controls/preset-test-kit";
import { AgentDock } from "./agent-dock";
import { resetAgentDockState, setDockSectionOpen } from "./agent-dock-state";
import { DockHistory } from "./dock-history";
import { DockUsage } from "./dock-usage";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const MINUTE = 60_000;
// A local midday, so "today" and "yesterday" are unambiguous in any time zone.
const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime();
const TODAY = new Date(2026, 9, 24, 9, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 23, 15, 0, 0).getTime();

const pane = (overrides: Partial<PaneView> = {}): PaneView => ({
  paneId: 11,
  agent: "claude",
  attention: "none",
  phase: "idle",
  hasRun: true,
  changedAt: NOW,
  startedAt: NOW - 42 * MINUTE,
  focused: true,
  ...overrides,
});
const tab = (panes: PaneView[]): TabView => ({
  key: 1,
  process: "node",
  name: "token refresh",
  dotColor: null,
  workspacePath: "/r/main",
  agents: [],
  agentBusy: false,
  unread: false,
  panes,
});

const counters = (inputUncached: number) => ({
  inputUncached,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheWrite: 0,
  output: 0,
});
const bucket = (over: Partial<UsageBucket> & Pick<UsageBucket, "agent">): UsageBucket => ({
  bucketStartMs: TODAY,
  model: over.agent === "claude" ? "claude-haiku-4-5" : "gpt-5",
  repo: "/r/main",
  counters: counters(1_000_000),
  ...over,
});
const snapshotOf = (buckets: UsageBucket[], codex: "ok" | "missing" = "ok"): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: codex, filesScanned: 1 },
  ],
  skippedLines: 0,
});

const onOpenDetails = vi.fn();
const onResume = vi.fn();

function dock() {
  return (
    <AgentDock
      entered
      onClose={() => {}}
      selection={{ onFocusPane: () => {}, onSelectTab: () => {} }}
      bodies={{
        changes: null,
        files: () => null,
        usage: ({ item, space }) => (
          <DockUsage item={item} space={space} onOpenDetails={onOpenDetails} />
        ),
        history: ({ item, cwd }) => <DockHistory item={item} cwd={cwd} onResume={onResume} />,
      }}
    />
  );
}

async function resizeTo(width: number): Promise<void> {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

const section = (title: string): HTMLElement | null =>
  document.body.querySelector(`section[aria-label="${title}"]`);
const usage = (): Record<string, string> =>
  Object.fromEntries(
    [...(section("Usage")?.querySelectorAll("dl > div") ?? [])].map((row) => [
      row.querySelector("dt")?.textContent ?? "",
      row.querySelector("dd")?.textContent ?? "",
    ]),
  );
const historyRows = (): HTMLElement[] => [
  ...(section("History")?.querySelectorAll<HTMLElement>("li button") ?? []),
];
const historyText = (): string => section("History")?.textContent ?? "";

const entry = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  agent: "claude",
  sessionId: "s1",
  cwd: "/r/main",
  lastActivityMs: NOW - 5 * MINUTE,
  title: "Fix the token refresh",
  sourcePath: "/x/s1.jsonl",
  ...over,
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  settings.value = DEFAULT_SETTINGS;
  tabViews.value = [tab([pane()])];
  activeTabIndex.value = 0;
  activeWorkspace.value = "/r/main";
  statusInfo.value = {
    branch: null,
    cwd: "/r/main",
    agent: null,
    paneCount: 1,
    home: "/home/test",
  };
  usageSnapshot.value = snapshotOf([bucket({ agent: "claude" })]);
  usageLoading.value = false;
  usageStale.value = false;
  sessionEntries.value = [];
  deadProjects.value = new Set();
  sessionsLoading.value = false;
  sessionsLoadState.value = LOAD_READY;
  resetAgentDockState();
  resetRevealDockTabForTests();
  vi.mocked(startUsagePolling).mockClear();
  vi.mocked(stopUsagePolling).mockClear();
  vi.mocked(refreshSessions).mockClear();
  onOpenDetails.mockClear();
  onResume.mockClear();
  await resizeTo(1440);
});

afterEach(async () => {
  await resizeTo(1024);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  tabViews.value = [];
  activeTabIndex.value = -1;
  activeWorkspace.value = null;
  usageSnapshot.value = null;
  sessionEntries.value = [];
  resetAgentDockState();
});

describe("the Usage section", () => {
  beforeEach(() => setDockSectionOpen("usage", true));

  it("says the repository's tokens and cost today for the focused agent, and how long it has run", async () => {
    usageSnapshot.value = snapshotOf([
      bucket({ agent: "claude" }),
      bucket({ agent: "claude", bucketStartMs: YESTERDAY }),
      bucket({ agent: "claude", repo: "/r/other" }),
      bucket({ agent: "codex" }),
    ]);
    const view = await mount(dock());
    expect(usage()).toEqual({
      "Tokens today": "1M",
      "Cost today": "$1.00",
      "Running for": "42m",
    });
    expect(section("Usage")?.textContent).toContain("Every Claude session in main today");
    await view.unmount();
  });

  it("shows a dash for an agent the scanner does not read, and says why", async () => {
    tabViews.value = [tab([pane({ agent: "gemini" })])];
    usageSnapshot.value = snapshotOf([bucket({ agent: "claude" })]);
    const view = await mount(dock());
    expect(usage()["Tokens today"]).toBe("—");
    expect(usage()["Cost today"]).toBe("—");
    expect(usage()["Running for"]).toBe("42m");
    expect(section("Usage")?.textContent).toContain("Claude Code and Codex only");
    await view.unmount();
  });

  it("adds the space's cost when it holds other agents, each kind once, and dashes it when none is read", async () => {
    tabViews.value = [
      tab([
        pane(),
        pane({ paneId: 12, agent: "codex", focused: false }),
        pane({ paneId: 13, agent: "claude", focused: false }),
      ]),
    ];
    usageSnapshot.value = snapshotOf([bucket({ agent: "claude" }), bucket({ agent: "codex" })]);
    const view = await mount(dock());
    expect(usage()["Cost today"]).toBe("$1.00");
    expect(usage()["Space cost today"]).toBe("$2.25");

    await act(async () => {
      tabViews.value = [
        tab([pane({ agent: "gemini" }), pane({ paneId: 12, agent: "aider", focused: false })]),
      ];
    });
    await settle();
    expect(usage()["Space cost today"]).toBe("—");
    await view.unmount();
  });

  it("has no space row for an agent that is alone", async () => {
    const view = await mount(dock());
    expect(Object.keys(usage())).not.toContain("Space cost today");
    await view.unmount();
  });

  it("dashes the figures before a snapshot and when the agent's transcripts are unreadable", async () => {
    usageSnapshot.value = null;
    const view = await mount(dock());
    expect(usage()["Tokens today"]).toBe("—");

    await act(async () => {
      tabViews.value = [tab([pane({ agent: "codex" })])];
      usageSnapshot.value = snapshotOf([bucket({ agent: "codex" })], "missing");
    });
    await settle();
    expect(usage()["Tokens today"]).toBe("—");
    await view.unmount();
  });

  it("says when it is reading and when what it shows is stale", async () => {
    usageSnapshot.value = null;
    usageLoading.value = true;
    const view = await mount(dock());
    expect(section("Usage")?.textContent).toContain("Reading this machine's usage…");
    await act(async () => {
      usageSnapshot.value = snapshotOf([bucket({ agent: "claude" })]);
      usageLoading.value = false;
      usageStale.value = true;
    });
    await settle();
    expect(section("Usage")?.textContent).toContain("Stale: showing the last good read.");
    await view.unmount();
  });

  it("tells a user with no focused agent to focus one", async () => {
    tabViews.value = [tab([pane({ focused: false })])];
    const view = await mount(dock());
    expect(section("Usage")?.textContent).toContain("Focus an agent to see its usage.");
    expect(Object.keys(usage())).toEqual([]);
    await view.unmount();
  });

  it("opens the full usage page from Details", async () => {
    const view = await mount(dock());
    const details = [...(section("Usage")?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Details"),
    ) as HTMLElement;
    await click(details);
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("polls only while unfolded", async () => {
    const view = await mount(dock());
    expect(startUsagePolling).toHaveBeenCalledTimes(1);
    expect(stopUsagePolling).not.toHaveBeenCalled();
    await click(
      section("Usage")?.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement,
    );
    await waitUntil(() => vi.mocked(stopUsagePolling).mock.calls.length === 1);
    await view.unmount();
  });
});

describe("the History section", () => {
  beforeEach(() => setDockSectionOpen("history", true));

  it("lists the focused agent's sessions in the exact folder its pane stands in", async () => {
    sessionEntries.value = [
      entry({ sessionId: "a", title: "Fix the token refresh" }),
      entry({
        sessionId: "b",
        title: "Rename the rail ids",
        lastActivityMs: NOW - 26 * 60 * MINUTE,
      }),
      entry({ sessionId: "c", title: "Other folder", cwd: "/r/main/src" }),
      entry({ sessionId: "d", title: "Another project", cwd: "/w/api" }),
      entry({ sessionId: "e", title: "A codex one", agent: "codex" }),
    ];
    const view = await mount(dock());
    const rows = historyRows();
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Resume Fix the token refresh",
      "Resume Rename the rail ids",
    ]);
    expect(rows[0].textContent).toContain("5 minutes ago");
    expect(rows[1].textContent).toContain("Yesterday");
    await view.unmount();
  });

  it("follows the focused agent's kind and the pane's folder", async () => {
    sessionEntries.value = [
      entry({ sessionId: "a", title: "A claude one" }),
      entry({ sessionId: "e", title: "A codex one", agent: "codex" }),
      entry({ sessionId: "f", title: "In src", cwd: "/r/main/src" }),
    ];
    const view = await mount(dock());
    expect(historyText()).toContain("A claude one");

    await act(async () => {
      tabViews.value = [tab([pane({ agent: "codex" })])];
    });
    await settle();
    expect(historyText()).toContain("A codex one");
    expect(historyText()).not.toContain("A claude one");

    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: "/r/main/src" };
    });
    await settle();
    expect(historyText()).toContain("No Codex sessions in /r/main/src.");
    await act(async () => {
      tabViews.value = [tab([pane({ agent: "claude" })])];
    });
    await settle();
    expect(historyText()).toContain("In src");
    expect(historyText()).not.toContain("A claude one");
    await view.unmount();
  });

  it("resumes the pressed session through the resume path it was given", async () => {
    const wanted = entry({ sessionId: "a", title: "Fix the token refresh" });
    sessionEntries.value = [wanted];
    const view = await mount(dock());
    await click(historyRows()[0]);
    expect(onResume).toHaveBeenCalledWith(wanted);
    await view.unmount();
  });

  it("scans when it opens", async () => {
    const view = await mount(dock());
    expect(refreshSessions).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("says plainly what is missing: nothing yet, no agent, an unrecorded agent, no folder", async () => {
    const view = await mount(dock());
    expect(historyText()).toContain("No Claude Code sessions in /r/main.");

    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: null };
    });
    await settle();
    expect(historyText()).toContain("This pane's folder is not known yet.");

    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: "/r/main" };
      tabViews.value = [tab([pane({ agent: "gemini" })])];
    });
    await settle();
    expect(historyText()).toContain("Sessions are recorded for Claude Code and Codex only.");

    await act(async () => {
      tabViews.value = [tab([pane({ focused: false })])];
    });
    await settle();
    expect(historyText()).toContain("Focus an agent to see its history.");
    await view.unmount();
  });

  it("says it is reading, offers a retry after a failed scan, and says a gone folder cannot resume", async () => {
    sessionsLoading.value = true;
    const view = await mount(dock());
    expect(historyText()).toContain("Reading this machine's recorded sessions…");

    sessionsLoading.value = false;
    sessionsLoadState.value = loadError("Couldn't read recorded sessions.");
    await settle();
    expect(historyText()).toContain("Couldn't read recorded sessions.");
    vi.mocked(refreshSessions).mockClear();
    await click(section("History")?.querySelector(".load-error__retry") as HTMLElement);
    expect(refreshSessions).toHaveBeenCalledTimes(1);

    sessionsLoadState.value = LOAD_READY;
    sessionEntries.value = [entry()];
    deadProjects.value = new Set(["/r/main"]);
    await settle();
    expect(historyText()).toContain("This folder is gone, so its sessions cannot resume.");
    await click(historyRows()[0]);
    expect(onResume).not.toHaveBeenCalled();
    await view.unmount();
  });
});
