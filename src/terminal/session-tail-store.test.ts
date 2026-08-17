import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeRequest } from "../lib/agent-resume";
import { tabViews, type PaneView, type TabView } from "./tabs-store";
import {
  installSessionTailSync,
  noteResumedPane,
  paneTails,
  resetSessionTailStore,
} from "./session-tail-store";

/**
 * Both hosts are mocked through one hoisted record: the factory runs while
 * this file's imports are evaluated, so a plain top-level `let` would still be
 * in its temporal dead zone there. `available` is exposed as a getter because
 * the store reads it at call time (inside `installSessionTailSync`), which is
 * what lets a single test flip the host off.
 */
const hosts = vi.hoisted(() => ({
  available: true,
  sessionTails:
    vi.fn<
      (
        requests: readonly ResumeRequest[],
      ) => Promise<readonly (string | null)[]>
    >(),
}));

vi.mock("../host/worktree-host", () => ({
  get available() {
    return hosts.available;
  },
}));

vi.mock("../host/session-tail-host", () => ({
  sessionTails: (requests: readonly ResumeRequest[]) =>
    hosts.sessionTails(requests),
}));

const DEBOUNCE_MS = 300;
/** A round clock, so a fixture's `changedAt` reads as an absolute moment. */
const NOW = 1_700_000_000_000;

const IDLE = {
  kind: "idle",
  actionableCount: 0,
  workingCount: 0,
  unreadCount: 0,
} as const;

function pane(paneId: number, over: Partial<PaneView> = {}): PaneView {
  return {
    paneId,
    agent: "claude",
    attention: "none",
    phase: "idle",
    // The default fixture pane has run something — the only kind that earns a
    // request. Tests that want a never-run pane say `hasRun: false`.
    hasRun: true,
    changedAt: NOW,
    ...over,
  };
}

function tab(
  key: number,
  workspacePath: string | null,
  panes: readonly PaneView[],
): TabView {
  return {
    key,
    process: "zsh",
    name: null,
    dotColor: null,
    workspacePath,
    agents: [],
    agentBusy: false,
    unread: false,
    attention: IDLE,
    panes,
  };
}

/** Same content, new array identity — what the 2s process poll produces. */
function pokeTabViews(): void {
  tabViews.value = [...tabViews.value];
}

/** The one batch the store sent, as plain requests. */
function batchAt(call: number): readonly ResumeRequest[] {
  return hosts.sessionTails.mock.calls[call][0];
}

describe("session tail store", () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetSessionTailStore();
    tabViews.value = [];
    hosts.available = true;
    hosts.sessionTails.mockReset();
    hosts.sessionTails.mockResolvedValue([]);
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    resetSessionTailStore();
    tabViews.value = [];
    vi.useRealTimers();
  });

  it("1. fetches one tail per agent pane and publishes the answers by pane id", async () => {
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["writing the tests"]);

    dispose = installSessionTailSync();
    expect(hosts.sessionTails).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(1);
    expect(batchAt(0)).toEqual([
      { agent: "claude", cwd: "/w", lastSeenAt: NOW },
    ]);
    expect(paneTails.value.get(101)).toBe("writing the tests");
  });

  it("2. does not refetch when nothing changed", async () => {
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["first"]);
    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(hosts.sessionTails).toHaveBeenCalledTimes(1);

    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(1);
    expect(paneTails.value.get(101)).toBe("first");
  });

  it("3. refetches when a pane's changedAt moves, carrying the new lastSeenAt", async () => {
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["first"]);
    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    hosts.sessionTails.mockResolvedValue(["second"]);
    tabViews.value = [tab(1, "/w", [pane(101, { changedAt: NOW + 5_000 })])];
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(2);
    expect(batchAt(1)).toEqual([
      { agent: "claude", cwd: "/w", lastSeenAt: NOW + 5_000 },
    ]);
    expect(paneTails.value.get(101)).toBe("second");
  });

  it("4. keeps the last known tail when a later answer is null", async () => {
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["what the agent said"]);
    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(paneTails.value.get(101)).toBe("what the agent said");

    hosts.sessionTails.mockResolvedValue([null]);
    tabViews.value = [tab(1, "/w", [pane(101, { changedAt: NOW + 1_000 })])];
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(2);
    expect(paneTails.value.get(101)).toBe("what the agent said");
  });

  it("5. asks only for panes that have run — a never-run pane and a shell pane are skipped", async () => {
    tabViews.value = [
      tab(1, "/w", [
        pane(101),
        pane(102, { hasRun: false }),
        pane(103, { agent: null }),
      ]),
    ];
    hosts.sessionTails.mockResolvedValue(["only mine"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)).toEqual([
      { agent: "claude", cwd: "/w", lastSeenAt: NOW },
    ]);
    expect([...paneTails.value.keys()]).toEqual([101]);
  });

  it("6. maps positional answers back to the right pane across tabs", async () => {
    tabViews.value = [
      tab(1, "/a", [pane(101), pane(102, { agent: "codex" })]),
      tab(2, "/b", [pane(201, { agent: "gemini" })]),
    ];
    hosts.sessionTails.mockResolvedValue(["one", "two", "three"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)).toEqual([
      { agent: "claude", cwd: "/a", lastSeenAt: NOW },
      { agent: "codex", cwd: "/a", lastSeenAt: NOW },
      { agent: "gemini", cwd: "/b", lastSeenAt: NOW },
    ]);
    expect([...paneTails.value.entries()]).toEqual([
      [101, "one"],
      [102, "two"],
      [201, "three"],
    ]);
  });

  it("7. never asks with an empty batch", async () => {
    tabViews.value = [
      tab(1, "/w", [pane(101, { agent: null }), pane(102, { hasRun: false })]),
    ];

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(hosts.sessionTails).not.toHaveBeenCalled();
    expect(paneTails.value.size).toBe(0);
  });

  it("8. is inert without the Electron host", async () => {
    hosts.available = false;
    tabViews.value = [tab(1, "/w", [pane(101)])];

    dispose = installSessionTailSync();
    expect(typeof dispose).toBe("function");
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(hosts.sessionTails).not.toHaveBeenCalled();
    expect(paneTails.value.size).toBe(0);
  });

  it("9. survives a failed fetch, keeping the tails it already has", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["kept"]);
    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    hosts.sessionTails.mockRejectedValue(new Error("no handler"));
    tabViews.value = [tab(1, "/w", [pane(101, { changedAt: NOW + 1_000 })])];
    await expect(
      vi.advanceTimersByTimeAsync(DEBOUNCE_MS),
    ).resolves.not.toThrow();

    expect(warn).toHaveBeenCalled();
    expect(paneTails.value.get(101)).toBe("kept");
    warn.mockRestore();
  });

  it("10. stops fetching once disposed", async () => {
    tabViews.value = [tab(1, "/w", [pane(101)])];
    hosts.sessionTails.mockResolvedValue(["first"]);
    const stop = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(hosts.sessionTails).toHaveBeenCalledTimes(1);

    stop();
    tabViews.value = [tab(1, "/w", [pane(101, { changedAt: NOW + 2_000 })])];
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(1);
  });

  it("11. falls back to now for a pane that has never changed", async () => {
    tabViews.value = [tab(1, "/w", [pane(101, { changedAt: 0 })])];
    hosts.sessionTails.mockResolvedValue(["fresh"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)[0].lastSeenAt).toBe(Date.now());
  });

  it("12. asks for a never-run pane that was resumed into an existing session", async () => {
    noteResumedPane("/w", "claude");
    tabViews.value = [tab(1, "/w", [pane(101, { hasRun: false })])];
    hosts.sessionTails.mockResolvedValue(["what it said before the quit"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)).toEqual([
      { agent: "claude", cwd: "/w", lastSeenAt: NOW },
    ]);
    expect(paneTails.value.get(101)).toBe("what it said before the quit");
  });

  it("13. spends one mark on one pane — a second never-run pane stays skipped", async () => {
    noteResumedPane("/w", "claude");
    tabViews.value = [
      tab(1, "/w", [
        pane(101, { hasRun: false }),
        pane(102, { hasRun: false }),
      ]),
    ];
    hosts.sessionTails.mockResolvedValue(["the resumed one"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)).toHaveLength(1);
    expect([...paneTails.value.keys()]).toEqual([101]);
  });

  it("14. keeps asking for that pane after the mark is spent", async () => {
    noteResumedPane("/w", "claude");
    tabViews.value = [tab(1, "/w", [pane(101, { hasRun: false })])];
    hosts.sessionTails.mockResolvedValue(["first"]);
    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    hosts.sessionTails.mockResolvedValue(["second"]);
    tabViews.value = [
      tab(1, "/w", [pane(101, { hasRun: false, changedAt: NOW + 1_000 })]),
    ];
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(hosts.sessionTails).toHaveBeenCalledTimes(2);
    expect(paneTails.value.get(101)).toBe("second");
  });

  it("15. gives the mark to the never-run pane, not to the live one beside it", async () => {
    noteResumedPane("/w", "claude");
    // The order that used to break it: an already-running pane of the same
    // agent sits FIRST in the list, and the resumed one is behind it.
    tabViews.value = [tab(1, "/w", [pane(101), pane(102, { hasRun: false })])];
    hosts.sessionTails.mockResolvedValue(["the live one", "the resumed one"]);

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(batchAt(0)).toHaveLength(2);
    expect([...paneTails.value.entries()]).toEqual([
      [101, "the live one"],
      [102, "the resumed one"],
    ]);
  });

  it("16. ignores a mark left for another workspace", async () => {
    noteResumedPane("/other", "claude");
    tabViews.value = [tab(1, "/w", [pane(101, { hasRun: false })])];

    dispose = installSessionTailSync();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(hosts.sessionTails).not.toHaveBeenCalled();
  });
});
