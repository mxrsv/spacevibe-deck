import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createPaneInfoPoller } from "./pane-info-poller";

function info(
  id: number,
  cwd: string | null,
  process: string | null = "zsh",
): PaneProcessInfo {
  return { id, cwd, process, kind: "idle-shell", agent: null };
}

describe("createPaneInfoPoller", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches infos, fetches the branch and fires onUpdate", async () => {
    const gitBranch = vi.fn().mockResolvedValue("main");
    const onUpdate = vi.fn();
    const poller = createPaneInfoPoller({
      pty: { ptyInfo: async () => [info(1, "/repo")], gitBranch },
      targets: () => [1],
      activePaneId: () => 1,
      onUpdate,
    });

    await poller.poll();

    expect(poller.infoFor(1)?.cwd).toBe("/repo");
    expect(poller.branch()).toBe("main");
    expect(onUpdate).toHaveBeenCalledWith([info(1, "/repo")]);
  });

  it("prune forgets panes that are gone and keeps the live ones", async () => {
    const poller = createPaneInfoPoller({
      pty: {
        ptyInfo: async () => [info(1, "/a"), info(2, "/b"), info(3, "/c")],
        gitBranch: async () => null,
      },
      targets: () => [1, 2, 3],
      activePaneId: () => 1,
      onUpdate: () => {},
    });
    await poller.poll();

    poller.prune([1, 3]);

    expect(poller.infoFor(1)?.cwd).toBe("/a");
    expect(poller.infoFor(2)).toBeUndefined();
    expect(poller.infoFor(3)?.cwd).toBe("/c");
  });

  it("skips the git call when the focused pane's CWD is unchanged", async () => {
    const gitBranch = vi.fn().mockResolvedValue("main");
    const poller = createPaneInfoPoller({
      pty: { ptyInfo: async () => [info(1, "/repo")], gitBranch },
      targets: () => [1],
      activePaneId: () => 1,
      onUpdate: () => {},
    });

    await poller.poll();
    await poller.poll();

    expect(gitBranch).toHaveBeenCalledTimes(1);
  });

  it("degrades on pty_info failure: keeps last-known info, warns once, no onUpdate", async () => {
    let fail = false;
    const onUpdate = vi.fn();
    const poller = createPaneInfoPoller({
      pty: {
        async ptyInfo() {
          if (fail) {
            throw new Error("ipc down");
          }
          return [info(1, "/repo")];
        },
        gitBranch: async () => "main",
      },
      targets: () => [1],
      activePaneId: () => 1,
      onUpdate,
    });

    await poller.poll();
    fail = true;
    await poller.poll();
    await poller.poll();

    expect(poller.infoFor(1)?.cwd).toBe("/repo"); // last known survives
    expect(poller.branch()).toBe("main");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1); // warn-once
  });

  it("warns again after a recovery (warn flag resets on success)", async () => {
    let fail = true;
    const poller = createPaneInfoPoller({
      pty: {
        async ptyInfo() {
          if (fail) {
            throw new Error("ipc down");
          }
          return [info(1, "/repo")];
        },
        gitBranch: async () => null,
      },
      targets: () => [1],
      activePaneId: () => null,
      onUpdate: () => {},
    });

    await poller.poll(); // warns
    fail = false;
    await poller.poll(); // recovers, resets flag
    fail = true;
    await poller.poll(); // warns again

    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps the last branch when git_branch fails, then retries next poll", async () => {
    let fail = false;
    const gitBranch = vi.fn().mockImplementation(async () => {
      if (fail) {
        throw new Error("git gone");
      }
      return "main";
    });
    let cwd = "/repo";
    const poller = createPaneInfoPoller({
      pty: { ptyInfo: async () => [info(1, cwd)], gitBranch },
      targets: () => [1],
      activePaneId: () => 1,
      onUpdate: () => {},
    });

    await poller.poll();
    cwd = "/other";
    fail = true;
    await poller.poll();
    expect(poller.branch()).toBe("main"); // last known survives the failure

    fail = false;
    await poller.poll(); // CWD still differs from lastBranchCwd → retried
    expect(gitBranch).toHaveBeenCalledTimes(3);
  });

  it("clears the branch when no pane is focused", async () => {
    let paneId: number | null = 1;
    const poller = createPaneInfoPoller({
      pty: {
        ptyInfo: async () => [info(1, "/repo")],
        gitBranch: async () => "main",
      },
      targets: () => [1],
      activePaneId: () => paneId,
      onUpdate: () => {},
    });

    await poller.poll();
    expect(poller.branch()).toBe("main");

    paneId = null;
    await poller.poll();
    expect(poller.branch()).toBeNull();
  });

  it("does nothing when there are no targets", async () => {
    const ptyInfo = vi.fn();
    const poller = createPaneInfoPoller({
      pty: { ptyInfo, gitBranch: async () => null },
      targets: () => [],
      activePaneId: () => null,
      onUpdate: () => {},
    });

    await poller.poll();

    expect(ptyInfo).not.toHaveBeenCalled();
  });

  it("sends the live declared-agent matchers with each process snapshot", async () => {
    const ptyInfo = vi.fn().mockResolvedValue([info(1, "/repo")]);
    const matchers = [{ binary: "aider", agent: "Aider" }];
    const poller = createPaneInfoPoller({
      pty: { ptyInfo, gitBranch: async () => null },
      targets: () => [1],
      activePaneId: () => null,
      agentMatchers: () => matchers,
      onUpdate: () => {},
    });

    await poller.poll();

    expect(ptyInfo).toHaveBeenCalledWith([1], matchers, false);
  });

  it("polls on the interval after start() and stops on stop()", async () => {
    vi.useFakeTimers();
    const ptyInfo = vi.fn().mockResolvedValue([info(1, "/repo")]);
    const poller = createPaneInfoPoller({
      pty: { ptyInfo, gitBranch: async () => null },
      targets: () => [1],
      activePaneId: () => null,
      onUpdate: () => {},
      intervalMs: 100,
    });

    poller.start();
    poller.start(); // idempotent — no second timer
    await vi.advanceTimersByTimeAsync(250);
    expect(ptyInfo).toHaveBeenCalledTimes(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(250);
    expect(ptyInfo).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("serializes overlapping polls and coalesces them into one trailing refresh", async () => {
    const pending: Array<(infos: PaneProcessInfo[]) => void> = [];
    const ptyInfo = vi.fn(
      () =>
        new Promise<PaneProcessInfo[]>((resolve) => {
          pending.push(resolve);
        }),
    );
    let ids = [1];
    const poller = createPaneInfoPoller({
      pty: { ptyInfo, gitBranch: async () => null },
      targets: () => ids,
      activePaneId: () => null,
      onUpdate: () => {},
    });

    const first = poller.poll();
    ids = [2];
    const second = poller.poll();

    expect(ptyInfo).toHaveBeenCalledTimes(1);
    expect(ptyInfo).toHaveBeenNthCalledWith(1, [1], [], false);

    pending[0]([info(1, "/first")]);
    await vi.waitFor(() => expect(ptyInfo).toHaveBeenCalledTimes(2));
    expect(ptyInfo).toHaveBeenNthCalledWith(2, [2], [], false);

    pending[1]([info(2, "/second")]);
    await Promise.all([first, second]);

    expect(poller.infoFor(1)?.cwd).toBe("/first");
    expect(poller.infoFor(2)?.cwd).toBe("/second");
  });
});
