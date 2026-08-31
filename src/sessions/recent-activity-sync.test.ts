// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshRecentSessions = vi.fn(async () => {});

vi.mock("./sessions-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sessions-store")>();
  return { ...actual, refreshRecentSessions };
});

const { installRecentActivitySync, resetRecentActivitySync } =
  await import("./recent-activity-sync");
const { sessionsSupported } = await import("./sessions-store");
const { paneTails } = await import("../terminal/session-tail-store");
const { tabViews } = await import("../terminal/tabs-store");

describe("installRecentActivitySync", () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    resetRecentActivitySync();
    refreshRecentSessions.mockClear();
    sessionsSupported.value = true;
    paneTails.value = new Map();
    tabViews.value = [];
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    resetRecentActivitySync();
    vi.useRealTimers();
  });

  /** Let a scheduled run and its awaited refresh both settle. */
  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("loads once on install and does not schedule a second scan on its own", async () => {
    dispose = installRecentActivitySync();

    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);

    // The effect's subscription pass is not a change: a quiet app stays quiet.
    await advance(60_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
  });

  it("re-reads the block when a pane's newest turn changes", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();

    paneTails.value = new Map([[1, "Done — the spec is written"]]);

    // Nothing before the interval floor, exactly one refresh after it.
    await advance(1_000);
    expect(refreshRecentSessions).not.toHaveBeenCalled();
    await advance(5_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst of signals into one scan", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();

    paneTails.value = new Map([[1, "one"]]);
    paneTails.value = new Map([[1, "two"]]);
    tabViews.value = [];
    paneTails.value = new Map([[1, "three"]]);

    await advance(10_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
  });

  it("keeps a minimum interval between two scans", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();

    paneTails.value = new Map([[1, "first"]]);
    await advance(5_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);

    paneTails.value = new Map([[1, "second"]]);
    await advance(1_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(2);
  });

  it("re-reads on window focus, which is the only signal for work done elsewhere", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();

    window.dispatchEvent(new Event("focus"));

    await advance(10_000);
    expect(refreshRecentSessions).toHaveBeenCalledTimes(1);
  });

  it("stops asking a host that has answered no sessions", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();
    sessionsSupported.value = false;

    paneTails.value = new Map([[1, "anything"]]);

    await advance(10_000);
    expect(refreshRecentSessions).not.toHaveBeenCalled();
  });

  it("disposes its listener and its pending timer", async () => {
    dispose = installRecentActivitySync();
    refreshRecentSessions.mockClear();

    paneTails.value = new Map([[1, "pending"]]);
    dispose();
    dispose = null;

    await advance(30_000);
    expect(refreshRecentSessions).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("focus"));
    await advance(30_000);
    expect(refreshRecentSessions).not.toHaveBeenCalled();
  });
});
