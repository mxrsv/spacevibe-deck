import { describe, expect, it, vi } from "vitest";
import {
  createAgentLaunchPageStore,
  type AgentLaunchPageRequest as AgentLaunchRequest,
} from "./agent-launch-page-store";
import type { AgentLaunchPlacement, AgentLaunchResult } from "../terminal/agent-launch-target";

const target = { kind: "first-pane", workspacePath: "/repo" } as const;
describe("agent launch page state", () => {
  it("invalidates a deferred Back focus when navigation supersedes it", () => {
    const page = createAgentLaunchPageStore();
    const restoreFocus = vi.fn();
    page.open({ target, launch: vi.fn(), restoreFocus, reveal: vi.fn() });
    page.close(true);
    const canRestore = restoreFocus.mock.calls[0][0];
    expect(canRestore()).toBe(true);
    page.close();
    expect(canRestore()).toBe(false);
  });
  it("opens and cancels without starting an agent", () => {
    const page = createAgentLaunchPageStore();
    const launch = vi.fn();
    const restoreFocus = vi.fn();
    page.open({ target, launch, restoreFocus, reveal: vi.fn() });
    page.close(true);
    expect(launch).not.toHaveBeenCalled();
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it("hands a profile override to the launch, and none when a Run carries none", async () => {
    const page = createAgentLaunchPageStore();
    const launch = vi.fn<AgentLaunchRequest["launch"]>(async () => ({ kind: "cancelled" }));
    page.open({ target, launch, restoreFocus: vi.fn(), reveal: vi.fn() });
    const pick = { kind: "profile", command: "claude --plan" } as const;
    await page.run("claude", "new-space", pick);
    await page.run("claude");
    expect(launch.mock.calls.map((call) => call[4])).toEqual([pick, undefined]);
  });

  it("serializes Run and prevents stale completion from closing a newer page", async () => {
    const page = createAgentLaunchPageStore();
    let resolve!: (result: AgentLaunchResult) => void;
    const launch = vi.fn(
      (_agent: string, _valid: () => boolean) =>
        new Promise<AgentLaunchResult>((done) => {
          resolve = done;
        }),
    );
    const reveal = vi.fn();
    const request = { target, launch, restoreFocus: vi.fn(), reveal };
    page.open(request);
    const first = page.run("claude");
    await page.run("claude");
    expect(launch).toHaveBeenCalledTimes(1);
    const valid = launch.mock.calls[0][1];
    page.close();
    page.open(request);
    expect(valid()).toBe(false);
    resolve({ kind: "spawned", receipt: { tabKey: 1, paneId: 1, canFocus: () => true } });
    await first;
    expect(page.request.value).not.toBeNull();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("keeps an error actionable and reveals only a live successful receipt", async () => {
    const page = createAgentLaunchPageStore();
    const reveal = vi.fn();
    page.open({
      target,
      launch: async () => ({ kind: "failed", message: "Folder unavailable" }),
      restoreFocus: vi.fn(),
      reveal,
    });
    await page.run("claude");
    expect(page.failure.value?.message).toBe("Folder unavailable");
    expect(page.request.value).not.toBeNull();
    expect(page.pending.value).toBe(false);
  });

  describe("failure and Retry (PAGE5)", () => {
    const pick = { kind: "profile", command: "claude --plan" } as const;
    const failing = () =>
      vi.fn<AgentLaunchRequest["launch"]>(async () => ({ kind: "failed", message: "No folder" }));

    it("records the attempt, and Retry repeats the same agent, placement and pick", async () => {
      const page = createAgentLaunchPageStore();
      const launch = failing();
      page.open({ target, launch, restoreFocus: vi.fn(), reveal: vi.fn() });
      await page.run("claude", "new-space", pick);
      expect(page.failure.value).toEqual({
        message: "No folder",
        agentId: "claude",
        placement: "new-space",
        override: pick,
      });
      await page.retry();
      expect(launch).toHaveBeenCalledTimes(2);
      expect(launch.mock.calls[1][0]).toBe("claude");
      expect(launch.mock.calls[1][2]).toBe("new-space");
      expect(launch.mock.calls[1][4]).toBe(pick);
    });

    it("clears the failure when Retry starts, and on success leaves none", async () => {
      const page = createAgentLaunchPageStore();
      const launch = failing();
      page.open({ target, launch, restoreFocus: vi.fn(), reveal: vi.fn() });
      await page.run("claude");
      launch.mockImplementationOnce(async () => ({
        kind: "spawned",
        receipt: { tabKey: 1, paneId: 1, canFocus: () => true },
      }));
      await page.retry();
      expect(page.failure.value).toBeNull();
      expect(page.request.value).toBeNull();
    });

    it("does nothing without a failure, and nothing while a launch is pending", async () => {
      const page = createAgentLaunchPageStore();
      const launch = failing();
      page.open({ target, launch, restoreFocus: vi.fn(), reveal: vi.fn() });
      await page.retry();
      expect(launch).not.toHaveBeenCalled();
      await page.run("claude");
      launch.mockImplementationOnce(() => new Promise(() => {}));
      void page.run("codex");
      expect(page.failure.value).toBeNull();
      await page.retry();
      expect(launch).toHaveBeenCalledTimes(2);
    });

    it("is cleared by a new open, a close, a re-target and a newer run", async () => {
      const retarget = vi.fn((_path: string) => ({ ...target, workspacePath: "/other" }));
      const page = createAgentLaunchPageStore();
      const request = {
        target,
        launch: failing(),
        retarget,
        restoreFocus: vi.fn(),
        reveal: vi.fn(),
      };
      page.open(request);
      await page.run("claude");
      expect(page.failure.value).not.toBeNull();
      page.open(request);
      expect(page.failure.value).toBeNull();
      await page.run("claude");
      page.close();
      expect(page.failure.value).toBeNull();
      page.open(request);
      await page.run("claude");
      expect(page.retarget("/other")).toBe(true);
      expect(page.failure.value).toBeNull();
      await page.run("claude");
      request.launch.mockImplementationOnce(async () => ({ kind: "cancelled" }));
      await page.run("codex");
      expect(page.failure.value).toBeNull();
    });
  });

  it("leaves the page usable when a launch is cancelled", async () => {
    const page = createAgentLaunchPageStore();
    const reveal = vi.fn();
    const releaseStage = vi.fn();
    page.open({
      target,
      launch: async () => ({ kind: "cancelled" }),
      restoreFocus: vi.fn(),
      reveal,
      releaseStage,
    });
    await page.run("claude");
    // Cancelled is not a failure: no message to show, and nothing was created,
    // so the page keeps the stage and stays ready for another choice.
    expect(page.failure.value).toBeNull();
    expect(page.request.value).not.toBeNull();
    expect(page.pending.value).toBe(false);
    expect(reveal).not.toHaveBeenCalled();
    expect(releaseStage).not.toHaveBeenCalled();
  });

  it("hands the chosen placement to the launch, defaulting to the page's own target", async () => {
    const page = createAgentLaunchPageStore();
    const launch = vi.fn(
      async (
        _agent: string,
        _valid: () => boolean,
        _placement: AgentLaunchPlacement,
      ): Promise<AgentLaunchResult> => ({ kind: "cancelled" }),
    );
    page.open({ target, launch, restoreFocus: vi.fn(), reveal: vi.fn() });
    await page.run("claude");
    await page.run("claude", "new-space");
    expect(launch.mock.calls.map((call) => call[2])).toEqual(["target", "new-space"]);
  });

  it("reports a thrown launch without stranding the page", async () => {
    const page = createAgentLaunchPageStore();
    page.open({
      target,
      launch: async () => {
        throw new Error("host went away");
      },
      restoreFocus: vi.fn(),
      reveal: vi.fn(),
    });
    await page.run("claude");
    // A thrown launch keeps the generic message and still records the attempt for Retry.
    expect(page.failure.value).toEqual({
      message: "Could not open the agent. Try again.",
      agentId: "claude",
      placement: "target",
    });
    expect(page.request.value).not.toBeNull();
    expect(page.pending.value).toBe(false);
  });

  it("releases the stage exactly once, on close and on a spawned run", async () => {
    const onClose = vi.fn();
    const closing = createAgentLaunchPageStore();
    closing.open({
      target,
      launch: vi.fn(),
      restoreFocus: vi.fn(),
      reveal: vi.fn(),
      releaseStage: onClose,
    });
    closing.close();
    expect(onClose).toHaveBeenCalledOnce();

    const onSpawn = vi.fn();
    const spawning = createAgentLaunchPageStore();
    spawning.open({
      target,
      launch: async () => ({
        kind: "spawned",
        receipt: { tabKey: 1, paneId: 1, canFocus: () => true },
      }),
      restoreFocus: vi.fn(),
      reveal: vi.fn(),
      releaseStage: onSpawn,
    });
    await spawning.run("claude");
    expect(onSpawn).toHaveBeenCalledOnce();
  });

  it("frees the Run guard when the page closes mid-launch", async () => {
    const page = createAgentLaunchPageStore();
    let resolve!: (result: AgentLaunchResult) => void;
    page.open({
      target,
      launch: () =>
        new Promise<AgentLaunchResult>((done) => {
          resolve = done;
        }),
      restoreFocus: vi.fn(),
      reveal: vi.fn(),
    });
    void page.run("claude");
    expect(page.pending.value).toBe(true);
    page.close();
    // Reopening must not inherit the abandoned launch's disabled Run.
    expect(page.pending.value).toBe(false);
    page.open({ target, launch: vi.fn(), restoreFocus: vi.fn(), reveal: vi.fn() });
    resolve({ kind: "cancelled" });
    await Promise.resolve();
    expect(page.pending.value).toBe(false);
  });

  describe("re-target", () => {
    const other = { kind: "split", workspacePath: "/other", tabKey: 3, paneId: 4 } as const;
    const cancelled: AgentLaunchRequest["launch"] = async () => ({ kind: "cancelled" });

    it("replaces the target in place, starts nothing and bumps the epoch", () => {
      const page = createAgentLaunchPageStore();
      const launch = vi.fn();
      const retarget = vi.fn((_path: string) => other);
      const restoreFocus = vi.fn();
      page.open({ target, launch, retarget, restoreFocus, reveal: vi.fn() });
      page.close(true);
      const canRestore = restoreFocus.mock.calls[0][0];
      page.open({ target, launch, retarget, restoreFocus, reveal: vi.fn() });
      expect(page.retarget("/other")).toBe(true);
      expect(retarget).toHaveBeenCalledWith("/other");
      expect(page.request.value?.target).toBe(other);
      expect(launch).not.toHaveBeenCalled();
      // The deferred focus of the earlier close is stale either way; the new
      // request is a different object, so a launch bound to the old one is too.
      expect(canRestore()).toBe(false);
    });

    it("keeps the request's other fields", () => {
      const page = createAgentLaunchPageStore();
      const releaseStage = vi.fn();
      page.open({
        target,
        launch: vi.fn(),
        retarget: () => other,
        restoreFocus: vi.fn(),
        reveal: vi.fn(),
        releaseStage,
        returnToBoard: true,
      });
      page.retarget("/other");
      expect(page.request.value?.returnToBoard).toBe(true);
      page.close();
      expect(releaseStage).toHaveBeenCalledOnce();
    });

    it("stops a launch that began before it from committing", async () => {
      const page = createAgentLaunchPageStore();
      const launch = vi.fn(cancelled);
      page.open({ target, launch, retarget: () => other, restoreFocus: vi.fn(), reveal: vi.fn() });
      await page.run("claude");
      const canCommit = launch.mock.calls[0][1];
      expect(canCommit()).toBe(true);
      page.retarget("/other");
      expect(canCommit()).toBe(false);
    });

    it("is refused while a launch is pending", async () => {
      const page = createAgentLaunchPageStore();
      let resolve!: (result: AgentLaunchResult) => void;
      const retarget = vi.fn(() => other);
      page.open({
        target,
        launch: () =>
          new Promise<AgentLaunchResult>((done) => {
            resolve = done;
          }),
        retarget,
        restoreFocus: vi.fn(),
        reveal: vi.fn(),
      });
      const running = page.run("claude");
      expect(page.retarget("/other")).toBe(false);
      expect(retarget).not.toHaveBeenCalled();
      expect(page.request.value?.target).toBe(target);
      resolve({ kind: "cancelled" });
      await running;
    });

    it("changes nothing when no target can be made, or the request has no retarget", () => {
      const page = createAgentLaunchPageStore();
      page.open({
        target,
        launch: vi.fn(),
        retarget: () => null,
        restoreFocus: vi.fn(),
        reveal: vi.fn(),
      });
      const before = page.request.value;
      expect(page.retarget("/nowhere")).toBe(false);
      expect(page.request.value).toBe(before);
      page.open({ target, launch: vi.fn(), restoreFocus: vi.fn(), reveal: vi.fn() });
      expect(page.retarget("/other")).toBe(false);
    });

    it("makes run launch at the new target", async () => {
      const page = createAgentLaunchPageStore();
      const launch = vi.fn(cancelled);
      page.open({ target, launch, retarget: () => other, restoreFocus: vi.fn(), reveal: vi.fn() });
      page.retarget("/other");
      await page.run("claude");
      expect(launch.mock.calls[0][3]).toBe(other);
    });
  });
});

describe("running several agents (the command bar's Run N)", () => {
  type Many = NonNullable<AgentLaunchRequest["launchMany"]>;
  const receipt = (paneId: number) => ({ tabKey: 1, paneId, canFocus: () => true });
  const two = [
    { agentId: "claude" },
    { agentId: "codex", override: { kind: "profile", command: "codex --full-auto" } as const },
  ] as const;

  it("starts both agents with one call carrying two requests, and reveals the first pane", async () => {
    const page = createAgentLaunchPageStore();
    const launchMany = vi.fn<Many>(async () => ({
      kind: "spawned",
      receipts: [receipt(10), receipt(11)],
    }));
    const reveal = vi.fn();
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal });
    await page.runMany(two);
    expect(launchMany).toHaveBeenCalledOnce();
    expect(launchMany.mock.calls[0][0]).toEqual(two);
    expect(launchMany.mock.calls[0][2]).toBe(target);
    expect(reveal.mock.calls[0][0].paneId).toBe(10);
    expect(page.request.value).toBeNull();
  });

  it("drops the result of a run that a close and reopen superseded", async () => {
    const page = createAgentLaunchPageStore();
    let finish!: (result: Awaited<ReturnType<Many>>) => void;
    const launchMany = vi.fn<Many>(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const reveal = vi.fn();
    const other = { kind: "first-pane", workspacePath: "/other" } as const;
    page.open({
      target,
      launch: vi.fn(),
      launchMany,
      retarget: () => other,
      restoreFocus: vi.fn(),
      reveal,
    });
    const running = page.runMany(two);
    // A re-target is refused while the run is pending; a navigation that closes the page is not.
    expect(page.retarget("/other")).toBe(false);
    const canCommit = launchMany.mock.calls[0][1];
    page.close();
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal });
    expect(canCommit()).toBe(false);
    finish({ kind: "spawned", receipts: [receipt(10), receipt(11)] });
    await running;
    expect(reveal).not.toHaveBeenCalled();
    expect(page.request.value).not.toBeNull();
    expect(page.failure.value).toBeNull();
  });

  it("retries only the agents that did not open, split beside the last pane that did", async () => {
    const page = createAgentLaunchPageStore();
    const launchMany = vi
      .fn<Many>()
      .mockResolvedValueOnce({ kind: "failed", message: "boom", receipts: [receipt(10)] })
      .mockResolvedValueOnce({ kind: "spawned", receipts: [receipt(11)] });
    const reveal = vi.fn();
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal });
    await page.runMany(two);
    expect(page.failure.value?.message).toBe("boom");
    expect(page.failure.value?.agents).toEqual([two[1]]);
    await page.retry();
    expect(launchMany.mock.calls[1][0]).toEqual([two[1]]);
    expect(launchMany.mock.calls[1][2]).toEqual({
      kind: "split",
      workspacePath: "/repo",
      tabKey: 1,
      paneId: 10,
    });
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("retries a failure that opened nothing with the whole set at the same target", async () => {
    const page = createAgentLaunchPageStore();
    const launchMany = vi
      .fn<Many>()
      .mockResolvedValueOnce({ kind: "failed", message: "nope", receipts: [] })
      .mockResolvedValueOnce({ kind: "cancelled", receipts: [] });
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal: vi.fn() });
    await page.runMany(two);
    await page.retry();
    expect(launchMany.mock.calls[1][0]).toEqual(two);
    expect(launchMany.mock.calls[1][2]).toBe(target);
  });

  it("keeps the split beside the opened pane across two consecutive retries", async () => {
    const page = createAgentLaunchPageStore();
    const three = [...two, { agentId: "gemini" }] as const;
    const beside = (paneId: number) => ({
      kind: "split",
      workspacePath: "/repo",
      tabKey: 1,
      paneId,
    });
    const launchMany = vi
      .fn<Many>()
      .mockResolvedValueOnce({ kind: "failed", message: "one", receipts: [receipt(10)] })
      // The first Retry opens nothing: the second must still split beside pane 10.
      .mockResolvedValueOnce({ kind: "failed", message: "two", receipts: [] })
      // The second Retry opens one more pane, then fails: the third resumes beside pane 11.
      .mockResolvedValueOnce({ kind: "failed", message: "three", receipts: [receipt(11)] })
      .mockResolvedValueOnce({ kind: "spawned", receipts: [receipt(12)] });
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal: vi.fn() });
    await page.runMany(three);
    await page.retry();
    expect(launchMany.mock.calls[1][2]).toEqual(beside(10));
    expect(page.failure.value?.agents).toEqual([three[1], three[2]]);
    await page.retry();
    expect(launchMany.mock.calls[2][0]).toEqual([three[1], three[2]]);
    expect(launchMany.mock.calls[2][2]).toEqual(beside(10));
    await page.retry();
    expect(launchMany.mock.calls[3][0]).toEqual([three[2]]);
    expect(launchMany.mock.calls[3][2]).toEqual(beside(11));
  });

  it("keeps the split target when a retry throws", async () => {
    const page = createAgentLaunchPageStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const launchMany = vi
      .fn<Many>()
      .mockResolvedValueOnce({ kind: "failed", message: "one", receipts: [receipt(10)] })
      .mockRejectedValueOnce(new Error("bridge down"))
      .mockResolvedValueOnce({ kind: "spawned", receipts: [receipt(11)] });
    page.open({ target, launch: vi.fn(), launchMany, restoreFocus: vi.fn(), reveal: vi.fn() });
    await page.runMany(two);
    await page.retry();
    await page.retry();
    expect(launchMany.mock.calls[2][2]).toEqual({
      kind: "split",
      workspacePath: "/repo",
      tabKey: 1,
      paneId: 10,
    });
    error.mockRestore();
  });

  it("says so, without stranding the page, when the request cannot start several", async () => {
    const page = createAgentLaunchPageStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    page.open({ target, launch: vi.fn(), restoreFocus: vi.fn(), reveal: vi.fn() });
    await page.runMany(two);
    expect(page.failure.value?.message).toBe("Could not open the agent. Try again.");
    expect(page.pending.value).toBe(false);
    error.mockRestore();
  });
});
