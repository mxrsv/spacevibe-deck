import { describe, expect, it, vi } from "vitest";
import type { AgentLaunchReceipt, AgentLaunchResult } from "../terminal/agent-launch-target";
import type { AgentsLaunchResult } from "../terminal/tab-manager-types";
import {
  createStageLauncherActions,
  missingPaths,
  settleLaunchMany,
  startFreshInWorkspace,
  type RecentHead,
  type StageLauncherActionDeps,
} from "./stage-launcher-actions";

const receipt = (tabKey: number, paneId = 1): AgentLaunchReceipt => ({
  tabKey,
  paneId,
  canFocus: () => true,
});

function harness(over: Partial<StageLauncherActionDeps> = {}) {
  const calls: string[] = [];
  const deps: StageLauncherActionDeps = {
    setNotice: vi.fn(),
    hasRequest: () => false,
    residentPath: () => "/repo",
    requestPath: () => null,
    beginRequest: vi.fn((path: string) => calls.push(`begin:${path}`)),
    runMany: vi.fn(),
    shownPaths: () => ["/repo"],
    rememberOnRail: vi.fn((path: string) => calls.push(`remember:${path}`)),
    aim: vi.fn((path: string) => calls.push(`aim:${path}`)),
    addFolder: async () => null,
    recentHead: () => undefined,
    barMode: () => "resident",
    openLauncher: vi.fn((path: string) => calls.push(`open:${path}`)),
    closeForm: vi.fn(() => calls.push("closeForm")),
    focusBar: vi.fn(() => calls.push("focusBar")),
    repoRootOf: (path) => path,
    railVisible: () => true,
    requestRailWorktreeForm: vi.fn(),
    openStageWorktreeForm: vi.fn(),
    ...over,
  };
  return { deps, calls, actions: createStageLauncherActions(deps) };
}

describe("openFolder", () => {
  /** A history whose head the fake picker moves, as `recordWorkspaceOpen` does. */
  function history(initial: RecentHead | undefined) {
    let head = initial;
    return {
      recentHead: () => head,
      set: (next: RecentHead) => {
        head = next;
      },
    };
  }

  it("aims nothing when the picker was cancelled", async () => {
    const recents = history({ path: "/repo", lastOpenedAt: 1 });
    const { actions, calls, deps } = harness({
      recentHead: recents.recentHead,
      addFolder: async () => null,
    });
    await actions.openFolder();
    expect(calls).toEqual([]);
    expect(deps.setNotice).toHaveBeenLastCalledWith(null);
  });

  it("aims the bar at a folder the rail just gained, and passes the notice through", async () => {
    const recents = history({ path: "/repo", lastOpenedAt: 1 });
    const { actions, calls, deps } = harness({
      recentHead: recents.recentHead,
      addFolder: async () => {
        recents.set({ path: "/new", lastOpenedAt: 2 });
        return "note";
      },
    });
    await actions.openFolder();
    expect(calls).toEqual(["aim:/new"]);
    expect(deps.setNotice).toHaveBeenLastCalledWith("note");
  });

  it("aims at the folder again when it is the one already at the head", async () => {
    const recents = history({ path: "/repo", lastOpenedAt: 1 });
    const { actions, calls } = harness({
      recentHead: recents.recentHead,
      addFolder: async () => {
        // A re-add rewrites the entry as a new object with a fresh timestamp.
        recents.set({ path: "/repo", lastOpenedAt: 2 });
        return null;
      },
    });
    await actions.openFolder();
    expect(calls).toEqual(["aim:/repo"]);
  });

  it("aims at the first folder ever added to an empty history", async () => {
    const recents = history(undefined);
    const { actions, calls } = harness({
      recentHead: recents.recentHead,
      addFolder: async () => {
        recents.set({ path: "/first", lastOpenedAt: 5 });
        return null;
      },
    });
    await actions.openFolder();
    expect(calls).toEqual(["aim:/first"]);
  });

  it("opens the launcher over a live space when no bar is up", async () => {
    const recents = history(undefined);
    const { actions, calls } = harness({
      barMode: () => "none",
      recentHead: recents.recentHead,
      addFolder: async () => {
        recents.set({ path: "/first", lastOpenedAt: 5 });
        return null;
      },
    });
    await actions.openFolder();
    expect(calls).toEqual(["aim:/first", "open:/first"]);
  });
});

describe("pickProject", () => {
  it("lets a project the rail does not list join it before the bar aims at it", () => {
    const { actions, calls, deps } = harness({ shownPaths: () => ["/repo"] });
    actions.pickProject("/far");
    expect(calls).toEqual(["remember:/far", "aim:/far"]);
    expect(deps.setNotice).toHaveBeenCalledWith(null);
  });

  it("only aims at a project the rail already lists", () => {
    const { actions, calls } = harness({ shownPaths: () => ["/repo", "/other"] });
    actions.pickProject("/other");
    expect(calls).toEqual(["aim:/other"]);
  });
});

describe("retarget", () => {
  it("returns false and aims nothing when no bar is up", () => {
    const { actions, calls } = harness({ barMode: () => "none" });
    expect(actions.retarget("/other")).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each(["resident", "floating"] as const)("aims a %s bar and returns true", (mode) => {
    const { actions, calls } = harness({ barMode: () => mode });
    expect(actions.retarget("/other")).toBe(true);
    expect(calls).toEqual(["aim:/other"]);
  });
});

describe("run", () => {
  it("opens the request on the resident project first, then starts every pick", () => {
    const { actions, calls, deps } = harness();
    actions.run(["claude", "codex"], { codex: { kind: "profile", command: "codex --x" } });
    expect(calls).toEqual(["begin:/repo"]);
    expect(deps.runMany).toHaveBeenCalledWith([
      { agentId: "claude" },
      { agentId: "codex", override: { kind: "profile", command: "codex --x" } },
    ]);
  });

  it("starts nothing when there is no project to aim at", () => {
    const { actions, deps } = harness({ residentPath: () => null });
    actions.run(["claude"], {});
    expect(deps.beginRequest).not.toHaveBeenCalled();
    expect(deps.runMany).not.toHaveBeenCalled();
  });

  it("reuses an open request instead of beginning another", () => {
    const { actions, deps } = harness({ hasRequest: () => true });
    actions.run(["claude"], {});
    expect(deps.beginRequest).not.toHaveBeenCalled();
    expect(deps.runMany).toHaveBeenCalledOnce();
  });
});

describe("leaving a stage form", () => {
  it("closes it and shows the launcher at the workspace it made", () => {
    const { actions, calls } = harness({ barMode: () => "none" });
    actions.leaveForm("/made");
    expect(calls).toEqual(["closeForm", "aim:/made", "open:/made"]);
  });

  it("goes back to the bar on a cancel", () => {
    const { actions, calls } = harness();
    actions.leaveForm(null);
    expect(calls).toEqual(["closeForm", "focusBar"]);
  });
});

describe("newWorktree", () => {
  it("uses the rail's popover on the open request's repository while the rail is up", () => {
    const { actions, deps } = harness({
      requestPath: () => "/req",
      repoRootOf: (path) => `${path}-root`,
    });
    actions.newWorktree();
    expect(deps.requestRailWorktreeForm).toHaveBeenCalledWith("/req-root");
    expect(deps.openStageWorktreeForm).not.toHaveBeenCalled();
  });

  it("falls back to the resident project, in the stage form when the rail is hidden", () => {
    const { actions, deps } = harness({ railVisible: () => false });
    actions.newWorktree();
    expect(deps.openStageWorktreeForm).toHaveBeenCalledWith("/repo");
    expect(deps.requestRailWorktreeForm).not.toHaveBeenCalled();
  });
});

describe("settleLaunchMany", () => {
  function settle(result: AgentsLaunchResult, target: Parameters<typeof settleLaunchMany>[2]) {
    const clearChoice = vi.fn();
    const recordOpen = vi.fn();
    const nameNewSpace = vi.fn();
    const out = settleLaunchMany(result, [{ agentId: "claude" }, { agentId: "codex" }], target, {
      clearChoice,
      recordOpen,
      nameNewSpace,
    });
    return { out, clearChoice, recordOpen, nameNewSpace };
  }
  const newSpace = { kind: "new-space", workspacePath: "/repo" } as const;

  it("clears the choice and records the first agent on the first receipt, naming the new space", () => {
    const result: AgentsLaunchResult = { kind: "spawned", receipts: [receipt(7), receipt(7, 2)] };
    const { out, clearChoice, recordOpen, nameNewSpace } = settle(result, newSpace);
    expect(out).toBe(result);
    expect(clearChoice).toHaveBeenCalledOnce();
    expect(recordOpen).toHaveBeenCalledWith("/repo", "claude");
    expect(nameNewSpace).toHaveBeenCalledWith(7, "/repo", "claude");
  });

  it("still names the new space when a later agent failed", () => {
    const { nameNewSpace, recordOpen } = settle(
      { kind: "failed", message: "boom", receipts: [receipt(7)] },
      newSpace,
    );
    expect(nameNewSpace).toHaveBeenCalledWith(7, "/repo", "claude");
    expect(recordOpen).toHaveBeenCalledWith("/repo", "claude");
  });

  it("names no space for a split", () => {
    const split = { kind: "split", workspacePath: "/repo", tabKey: 3, paneId: 9 } as const;
    const { nameNewSpace, clearChoice, recordOpen } = settle(
      { kind: "spawned", receipts: [receipt(3, 10)] },
      split,
    );
    expect(nameNewSpace).not.toHaveBeenCalled();
    expect(clearChoice).toHaveBeenCalledOnce();
    expect(recordOpen).toHaveBeenCalledWith("/repo", "claude");
  });

  it("changes nothing when no pane opened", () => {
    const { clearChoice, recordOpen, nameNewSpace } = settle(
      { kind: "failed", message: "nope", receipts: [] },
      newSpace,
    );
    expect(clearChoice).not.toHaveBeenCalled();
    expect(recordOpen).not.toHaveBeenCalled();
    expect(nameNewSpace).not.toHaveBeenCalled();
  });
});

describe("startFreshInWorkspace", () => {
  const entry = { workspacePath: "/workspace", cwd: "/workspace/wt" };

  function start(result: AgentLaunchResult) {
    const launch = vi.fn(async () => result);
    const nameNewSpace = vi.fn();
    const reveal = vi.fn();
    const done = startFreshInWorkspace(
      entry,
      { agentId: "claude", override: { kind: "profile", command: "claude -p" } },
      { launch, nameNewSpace, reveal },
    );
    return { done, launch, nameNewSpace, reveal };
  }

  it("opens a new space in the row's workspace, not the pane's cwd, and names and reveals it", async () => {
    const spawned = receipt(4);
    const { done, launch, nameNewSpace, reveal } = start({ kind: "spawned", receipt: spawned });
    expect(await done).toEqual({ ok: true });
    expect(launch).toHaveBeenCalledWith(
      { kind: "new-space", workspacePath: "/workspace" },
      "claude",
      { kind: "profile", command: "claude -p" },
    );
    expect(nameNewSpace).toHaveBeenCalledWith(4, "/workspace", "claude");
    expect(reveal).toHaveBeenCalledWith(spawned);
  });

  it("carries a failure message and names nothing", async () => {
    const { done, nameNewSpace } = start({ kind: "failed", message: "no shell" });
    expect(await done).toEqual({ ok: false, message: "no shell" });
    expect(nameNewSpace).not.toHaveBeenCalled();
  });

  it("reports a cancelled launch as not started, with no message", async () => {
    const { done } = start({ kind: "cancelled" });
    expect(await done).toEqual({ ok: false, message: undefined });
  });
});

describe("missingPaths", () => {
  it("lists the paths the probe said are gone", () => {
    expect([...missingPaths(["/a", "/b"], [true, false])]).toEqual(["/b"]);
  });

  it("treats a short answer as missing, so a probe that cannot answer fails closed", () => {
    expect([...missingPaths(["/a", "/b"], [true])]).toEqual(["/b"]);
    expect([...missingPaths(["/a", "/b"], [])]).toEqual(["/a", "/b"]);
  });

  it("treats an undefined answer as everything missing", () => {
    expect([...missingPaths(["/a"], undefined)]).toEqual(["/a"]);
  });
});
