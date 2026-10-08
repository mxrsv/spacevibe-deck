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
    expect(page.error.value).toBe("Folder unavailable");
    expect(page.request.value).not.toBeNull();
    expect(page.pending.value).toBe(false);
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
    expect(page.error.value).toBeNull();
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
    expect(page.error.value).toBe("Could not open the agent. Try again.");
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
