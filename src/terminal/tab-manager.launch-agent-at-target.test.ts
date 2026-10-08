// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { activeTabIndex, tabViews } from "./tabs-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { TERMINAL_LAUNCH_ID } from "./agent-launch-target";
import { freshWindowFocusController, wire, processInfo } from "./tab-manager.fixtures";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
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
import { persistError } from "../chrome/events";
import { createMemoryTransferClient } from "./transfer-client";

describe("explicit agent launch target", () => {
  beforeEach(() => {
    persistError.value = null;
    vi.useFakeTimers();
    settings.value = DEFAULT_SETTINGS;
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    tabViews.value = [];
    activeTabIndex.value = -1;
    detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopEnvironmentForTests();
  });

  it("captures without creating and runs exactly one agent beside the captured pane", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]),
    });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const target = tm.captureAgentLaunchTarget("/repo");
    expect(tm.allPaneIds()).toEqual([1]);
    const result = await tm.launchAgentAtTarget(target!, "claude", () => true);
    expect(result.kind).toBe("spawned");
    expect(tabViews.value).toHaveLength(1);
    expect(tm.allPaneIds()).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes).toHaveLength(1);
    expect(pty.writes[0].id).toBe(2);
    tm.dispose();
  });

  it("opens a bare shell for the Terminal card without arming a command", async () => {
    detectedAgents.value = [];
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]),
    });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const target = tm.captureAgentLaunchTarget("/repo");
    const result = await tm.launchAgentAtTarget(target!, TERMINAL_LAUNCH_ID, () => true);
    expect(result.kind).toBe("spawned");
    expect(tm.allPaneIds()).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes).toHaveLength(0);
    tm.dispose();
  });

  it("tiles the second agent into the roomiest pane instead of another column", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map(
        [1, 2, 3].map((id) => [id, processInfo(id, "/repo", "zsh", "idle-shell", null)]),
      ),
    });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    for (const _ of [0, 1]) {
      const target = tm.captureAgentLaunchTarget("/repo")!;
      expect((await tm.launchAgentAtTarget(target, "claude", () => true)).kind).toBe("spawned");
    }
    // Leaf order, not spawn order: pane 3 landed UNDER pane 1.
    expect(tm.allPaneIds()).toEqual([1, 3, 2]);
    // Columns only for the first split; the second cuts the left column across
    // (jsdom's 1024x768 window stands in for the stage).
    expect((await tm.captureActiveLayout())?.layout).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.5,
      first: {
        type: "split",
        direction: "column",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      second: { type: "leaf" },
    });
    tm.dispose();
  });

  it("opens a new space in a folder that already has one, instead of splitting it", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([1, 2].map((id) => [id, processInfo(id, "/repo", "zsh", "idle-shell", null)])),
    });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    // The page would offer a split here; the user chose a new space instead.
    expect(tm.captureAgentLaunchTarget("/repo")?.kind).toBe("split");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "claude",
      () => true,
    );
    expect(result.kind).toBe("spawned");
    expect(tabViews.value.map((tab) => tab.workspacePath)).toEqual(["/repo", "/repo"]);
    expect(tabViews.value.map((tab) => tab.panes?.length)).toEqual([1, 1]);
    if (result.kind === "spawned") {
      expect(result.receipt.tabKey).toBe(tabViews.value[1]?.key);
    }
    tm.dispose();
  });

  it("does not open a new space once the page has been closed", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "claude",
      () => false,
    );
    expect(result.kind).toBe("cancelled");
    expect(tabViews.value).toHaveLength(1);
    tm.dispose();
  });

  it("rejects a captured destination later identified as another checkout", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo/.worktrees/feature");
    const target = tm.captureAgentLaunchTarget("/repo")!;
    expect(target.kind).toBe("split");
    const result = await tm.launchAgentAtTarget(
      target,
      "claude",
      () => true,
      () => ["/repo", "/repo/.worktrees/feature"],
    );
    expect(result.kind).toBe("failed");
    expect(pty.sessions.size).toBe(1);
    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it("rechecks checkout ownership after a pending cwd read", async () => {
    const base = createMemoryPtyClient({ nextId: 1 });
    let release!: () => void;
    const wait = new Promise<void>((done) => {
      release = done;
    });
    const pty = {
      ...base,
      ptyInfo: async () => {
        await wait;
        return [processInfo(1, "/repo/.worktrees/feature", "zsh", "idle-shell", null)];
      },
    };
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo/.worktrees/feature");
    let roots: readonly string[] = [];
    const target = tm.captureAgentLaunchTarget("/repo")!;
    const pending = tm.launchAgentAtTarget(
      target,
      "claude",
      () => true,
      () => roots,
    );
    roots = ["/repo", "/repo/.worktrees/feature"];
    release();
    expect((await pending).kind).toBe("failed");
    expect(base.sessions.size).toBe(1);
    expect(base.writes).toEqual([]);
    tm.dispose();
  });

  it("does not defer Windows polling again after early first-pane prompt readiness", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "windows", homeDir: "C:/Users/dev" });
    const base = createMemoryPtyClient({ nextId: 1 });
    const pty = {
      ...base,
      async spawnShell(opts: Parameters<typeof base.spawnShell>[0]) {
        const id = await base.spawnShell(opts);
        base.emitPromptReady(id);
        return id;
      },
    };
    const inspect = vi.spyOn(pty, "ptyInfo");
    const { tm } = wire(pty);
    await tm.init();
    await tm.launchAgentAtTarget(tm.captureAgentLaunchTarget("C:/repo")!, "claude", () => true);
    inspect.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(inspect).toHaveBeenCalled();
    tm.dispose();
  });

  it.each(["committed", "aborted"] as const)(
    "reports a cancelled command when delayed preparation overlaps a %s transfer",
    async (kind) => {
      detectedAgents.value = [{ name: "opencode", path: "/bin/opencode" }];
      settings.value = {
        ...DEFAULT_SETTINGS,
        agentSignalAdapters: { ...DEFAULT_SETTINGS.agentSignalAdapters, opencode: true },
      };
      const pty = createMemoryPtyClient({ nextId: 1 });
      const transfer = createMemoryTransferClient();
      let release!: (port: number) => void;
      const { tm } = wire(pty, {
        transfer,
        signalConfig: async () => ({
          claudeSettingsPath: "/settings",
          hookPort: 1,
          hooksSupported: true,
        }),
        opencodeAttach: () =>
          new Promise<number>((done) => {
            release = done;
          }),
      });
      await tm.openQuickAgent(null, "/other");
      const result = await tm.launchAgentAtTarget(
        tm.captureAgentLaunchTarget("/repo")!,
        "opencode",
        () => true,
      );
      expect(result.kind).toBe("spawned");
      if (result.kind !== "spawned") throw new Error("Expected spawned pane");
      tm.focusAgentLaunch(result.receipt);
      const moving = tm.movePaneToNewWindow();
      await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
      release(45123);
      await vi.advanceTimersByTimeAsync(0);
      expect(persistError.value).toContain("agent did not start");
      transfer.settle(
        "xfer-1",
        kind === "committed" ? { kind } : { kind, reason: "Destination closed" },
      );
      await moving;
      await vi.advanceTimersByTimeAsync(3000);
      expect(pty.writes).toEqual([]);
      expect(tm.allPaneIds().includes(2)).toBe(kind === "aborted");
      tm.dispose();
    },
  );

  it("creates one first pane, and refuses a stale first-pane request", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]),
    });
    const { tm } = wire(pty);
    const target = tm.captureAgentLaunchTarget("/repo")!;
    expect(target.kind).toBe("first-pane");
    expect((await tm.launchAgentAtTarget(target, "claude", () => true)).kind).toBe("spawned");
    expect((await tm.launchAgentAtTarget(target, "claude", () => true)).kind).toBe("failed");
    expect(tm.allPaneIds()).toEqual([1]);
    tm.dispose();
  });

  it("cancels before spawn and refuses disabled agents", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]),
    });
    const { tm } = wire(pty);
    const target = tm.captureAgentLaunchTarget("/repo")!;
    expect((await tm.launchAgentAtTarget(target, "claude", () => false)).kind).toBe("cancelled");
    settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["claude"] };
    expect((await tm.launchAgentAtTarget(target, "claude", () => true)).kind).toBe("failed");
    expect(tm.allPaneIds()).toEqual([]);
    tm.dispose();
  });
  it("discards a first pane cancelled while spawn is pending", async () => {
    const base = createMemoryPtyClient({ nextId: 1 });
    let release!: () => void;
    const wait = new Promise<void>((done) => {
      release = done;
    });
    const pty = {
      ...base,
      spawnShell: async (...args: Parameters<typeof base.spawnShell>) => {
        await wait;
        return base.spawnShell(...args);
      },
    };
    const { tm } = wire(pty);
    let valid = true;
    const pending = tm.launchAgentAtTarget(
      tm.captureAgentLaunchTarget("/repo")!,
      "claude",
      () => valid,
    );
    valid = false;
    release();
    expect((await pending).kind).toBe("cancelled");
    expect(base.sessions.size).toBe(0);
    expect(tabViews.value).toHaveLength(0);
    expect(base.writes).toEqual([]);
    tm.dispose();
  });

  it("fails closed when the target cwd cannot be read", async () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    expect(
      (await tm.launchAgentAtTarget(tm.captureAgentLaunchTarget("/repo")!, "claude", () => true))
        .kind,
    ).toBe("failed");
    expect(pty.sessions.size).toBe(1);
    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it("does not arm an OpenCode command after disposal during adapter preparation", async () => {
    detectedAgents.value = [{ name: "opencode", path: "/bin/opencode" }];
    settings.value = {
      ...DEFAULT_SETTINGS,
      agentSignalAdapters: { ...DEFAULT_SETTINGS.agentSignalAdapters, opencode: true },
    };
    const pty = createMemoryPtyClient({ nextId: 1 });
    let release!: (port: number) => void;
    const attach = vi.fn(
      () =>
        new Promise<number>((done) => {
          release = done;
        }),
    );
    const { tm } = wire(pty, {
      signalConfig: async () => ({
        claudeSettingsPath: "/settings",
        hookPort: 1,
        hooksSupported: true,
      }),
      opencodeAttach: attach,
    });
    expect(
      (await tm.launchAgentAtTarget(tm.captureAgentLaunchTarget("/repo")!, "opencode", () => true))
        .kind,
    ).toBe("spawned");
    expect(attach).toHaveBeenCalledOnce();
    tm.dispose();
    release(45123);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes).toEqual([]);
  });

  // The page stays up while the rail is live, so the tab it captured can be
  // closed under it. The split must fail rather than dock beside a dead owner.
  it("fails a split whose captured tab closed while the page was open", async () => {
    const pty = createMemoryPtyClient({
      nextId: 1,
      infos: new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]),
    });
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const target = tm.captureAgentLaunchTarget("/repo")!;
    expect(target.kind).toBe("split");

    tm.runAction("close-tab");
    await vi.advanceTimersByTimeAsync(0);
    expect(tabViews.value).toHaveLength(0);
    // The captured pane went with its tab; the launch must add nothing back.
    const sessionsBefore = pty.sessions.size;

    expect((await tm.launchAgentAtTarget(target, "claude", () => true)).kind).toBe("failed");
    expect(pty.sessions.size).toBe(sessionsBefore);
    expect(pty.writes).toEqual([]);
    tm.dispose();
  });
});
