// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { activeTabIndex, tabViews } from "./tabs-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { freshWindowFocusController, wire, processInfo } from "./tab-manager.fixtures";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

vi.mock("../telemetry/usage-counters", () => ({
  countAgentLaunch: vi.fn(),
}));

let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

import { detectedAgents } from "./agent-detection-store";
import { countAgentLaunch } from "../telemetry/usage-counters";
import { agentLaunchCommand } from "../lib/launch-command";

/** What a plain (no override) launch of the agent types under the current settings. */
function defaultCommand(agentId: string): string {
  const { launchProfiles, defaultLaunchProfiles, customAgents } = settings.value;
  const command = agentLaunchCommand(agentId, launchProfiles, defaultLaunchProfiles, customAgents);
  if (command === null) throw new Error(`No default command for ${agentId}`);
  return command;
}

const PLAN = "claude --permission-mode plan";
const OTHER = "claude --model sonnet";
const NEW_SPACE = { kind: "new-space", workspacePath: "/repo" } as const;

function shellPty(...ids: number[]) {
  return createMemoryPtyClient({
    nextId: 1,
    infos: new Map(ids.map((id) => [id, processInfo(id, "/repo", "zsh", "idle-shell", null)])),
  });
}

describe("several agents in one space (LCH-6)", () => {
  beforeEach(() => {
    windowFocus = freshWindowFocusController();
    vi.useFakeTimers();
    vi.mocked(countAgentLaunch).mockClear();
    settings.value = {
      ...DEFAULT_SETTINGS,
      launchProfiles: [
        { id: "lp:plan", command: PLAN },
        { id: "lp:other", command: OTHER },
      ],
      defaultLaunchProfiles: { claude: "lp:plan" },
    };
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    tabViews.value = [];
    activeTabIndex.value = -1;
    detectedAgents.value = [
      { name: "claude", path: "/bin/claude" },
      { name: "codex", path: "/bin/codex" },
      { name: "gemini", path: "/bin/gemini" },
      { name: "amp", path: "/bin/amp" },
    ];
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopEnvironmentForTests();
  });

  it("opens two agents as two equal panes in one new tab, each typing its own command", async () => {
    const pty = shellPty(1, 2, 3);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentsAtTarget(
      NEW_SPACE,
      [{ agentId: "claude", override: { kind: "profile", command: OTHER } }, { agentId: "codex" }],
      () => true,
    );
    if (result.kind !== "spawned") throw new Error("Expected spawned panes");
    // The seed tab plus ONE new tab holding both panes.
    expect(tabViews.value.map((tab) => tab.panes?.length)).toEqual([1, 2]);
    expect(result.receipts.map((r) => r.tabKey)).toEqual([
      tabViews.value[1]?.key,
      tabViews.value[1]?.key,
    ]);
    const [first, second] = result.receipts.map((r) => r.paneId);
    expect(first).not.toBe(second);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes.find((w) => w.id === first)?.data).toBe(`${OTHER}\r`);
    expect(pty.writes.find((w) => w.id === second)?.data).toBe(`${defaultCommand("codex")}\r`);
    expect(pty.writes).toHaveLength(2);
    tm.dispose();
  });

  it("journals each pane with its own agent command and counts one launch each", async () => {
    const pty = shellPty(1, 2, 3);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentsAtTarget(
      NEW_SPACE,
      [{ agentId: "claude", override: { kind: "profile", command: OTHER } }, { agentId: "codex" }],
      () => true,
    );
    if (result.kind !== "spawned") throw new Error("Expected spawned panes");
    await vi.advanceTimersByTimeAsync(3000);
    expect(result.receipts.map((r) => tm.launchCommandFor(r.paneId))).toEqual([
      OTHER,
      defaultCommand("codex"),
    ]);
    const journaled = tm.captureSession().find((tab) => tab.panes.length === 2);
    expect(journaled?.panes.map((pane) => pane.launchCommand)).toEqual([
      OTHER,
      defaultCommand("codex"),
    ]);
    expect(countAgentLaunch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(countAgentLaunch).mock.calls.map(([id]) => id)).toEqual(["claude", "codex"]);
    tm.dispose();
  });

  it("splits a live space of the same project instead of opening a new one", async () => {
    const pty = shellPty(1, 2, 3);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const target = tm.captureAgentLaunchTarget("/repo")!;
    expect(target.kind).toBe("split");
    const result = await tm.launchAgentsAtTarget(
      target,
      [{ agentId: "claude" }, { agentId: "codex" }],
      () => true,
    );
    expect(result.kind).toBe("spawned");
    expect(tabViews.value).toHaveLength(1);
    expect(tm.allPaneIds()).toHaveLength(3);
    tm.dispose();
  });

  it("keeps the first pane and reports the failure when the second agent cannot launch", async () => {
    const pty = shellPty(1, 2, 3);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentsAtTarget(
      NEW_SPACE,
      [{ agentId: "claude" }, { agentId: "not-an-agent" }],
      () => true,
    );
    if (result.kind !== "failed") throw new Error("Expected a failure");
    expect(result.message).toMatch(/no longer available/);
    expect(result.receipts).toHaveLength(1);
    expect(tabViews.value.map((tab) => tab.panes?.length)).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes).toEqual([
      { id: result.receipts[0]!.paneId, data: `${defaultCommand("claude")}\r` },
    ]);
    expect(countAgentLaunch).toHaveBeenCalledExactlyOnceWith("claude");
    tm.dispose();
  });

  it("stops when canCommit turns false midway and reports the panes already made", async () => {
    const pty = shellPty(1, 2, 3, 4);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    // The page closes once the first agent has been counted; the next step must not start.
    const result = await tm.launchAgentsAtTarget(
      NEW_SPACE,
      [{ agentId: "claude" }, { agentId: "codex" }, { agentId: "gemini" }],
      () => vi.mocked(countAgentLaunch).mock.calls.length === 0,
    );
    expect(result.kind).toBe("cancelled");
    expect(result.receipts).toHaveLength(1);
    expect(tabViews.value.map((tab) => tab.panes?.length)).toEqual([1, 1]);
    expect(countAgentLaunch).toHaveBeenCalledExactlyOnceWith("claude");
    tm.dispose();
  });

  it("cancels before any pane when the gate is already shut", async () => {
    const pty = shellPty(1);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentsAtTarget(NEW_SPACE, [{ agentId: "claude" }], () => false);
    expect(result).toEqual({ kind: "cancelled", receipts: [] });
    expect(tabViews.value).toHaveLength(1);
    tm.dispose();
  });

  const leaf = { type: "leaf" } as const;
  const stack = { type: "split", direction: "column", ratio: 0.5, first: leaf, second: leaf };

  // The split path takes no ratio or direction: the tab's geometry picks the slot
  // (`chooseTilePlacement`), and the target pane only fixes the folder. On the 1024x768 stage
  // jsdom stands in for, N = 2 is two equal columns, but N = 3 and 4 tile into a 2-column grid,
  // not three or four equal columns. LCH-6 asks for side by side; see the report.
  it.each([
    [2, { type: "split", direction: "row", ratio: 0.5, first: leaf, second: leaf }],
    [3, { type: "split", direction: "row", ratio: 0.5, first: stack, second: leaf }],
    [4, { type: "split", direction: "row", ratio: 0.5, first: stack, second: stack }],
  ] as const)("lays %i agents out as one tab, one command per pane", async (count, layout) => {
    const pty = shellPty(1, 2, 3, 4, 5);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const ids = ["claude", "codex", "gemini", "amp"].slice(0, count);
    const result = await tm.launchAgentsAtTarget(
      NEW_SPACE,
      ids.map((agentId) => ({ agentId })),
      () => true,
    );
    if (result.kind !== "spawned") throw new Error("Expected spawned panes");
    expect(tabViews.value[1]?.panes).toHaveLength(count);
    expect(new Set(result.receipts.map((r) => r.paneId)).size).toBe(count);
    await vi.advanceTimersByTimeAsync(3000);
    expect(result.receipts.map((r) => tm.launchCommandFor(r.paneId))).toEqual(
      ids.map(defaultCommand),
    );
    expect(countAgentLaunch).toHaveBeenCalledTimes(count);
    expect(tm.captureSession().find((tab) => tab.panes.length === count)?.layout).toEqual(layout);
    tm.dispose();
  });
});
