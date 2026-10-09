import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChangesScheduler,
  DEBOUNCE_MS,
  MAX_WAIT_MS,
  MIN_INTERVAL_MS,
} from "./changes-scheduler";

/** A read whose duration the test controls. */
function harness(readMs = 0) {
  const starts: number[] = [];
  let release: (() => void) | null = null;
  const read = vi.fn(async () => {
    starts.push(Date.now());
    if (readMs === Infinity) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    } else if (readMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, readMs));
    }
  });
  const scheduler = createChangesScheduler({ read });
  return {
    scheduler,
    read,
    starts,
    finish: () => release?.(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("debounce and max wait", () => {
  it("reads once, 150 ms after the last of a burst", async () => {
    const { scheduler, read } = harness();
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1); // the list appearing
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);

    scheduler.trigger("watch");
    await vi.advanceTimersByTimeAsync(100);
    scheduler.trigger("watch");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads at the max wait while a writer never pauses", async () => {
    const { scheduler, starts } = harness();
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    const burstStart = Date.now();
    for (let tick = 0; tick < 100; tick += 1) {
      scheduler.trigger("watch");
      await vi.advanceTimersByTimeAsync(20);
    }
    const inBurst = starts.filter((at) => at > burstStart);
    expect(inBurst[0] - burstStart).toBeLessThanOrEqual(MAX_WAIT_MS);
    expect(inBurst[0] - burstStart).toBeGreaterThanOrEqual(MAX_WAIT_MS - 20);
  });

  it("turns 500 triggers over one second into at most three reads", async () => {
    const { scheduler, read } = harness();
    scheduler.setActive(true); // read 1 at t = 0
    for (let tick = 0; tick < 500; tick += 1) {
      scheduler.trigger(tick % 2 === 0 ? "watch" : "turn-end");
      await vi.advanceTimersByTimeAsync(2);
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("spacing and the in-flight rule", () => {
  it("starts no sooner than 1,000 ms after the previous start", async () => {
    const { scheduler, starts } = harness();
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.trigger("watch");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it("waits one previous-duration after a slow read ends", async () => {
    const { scheduler, starts } = harness(3000);
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(3000); // read 1 ends at t = 3000, duration 3000
    scheduler.trigger("watch");
    await vi.advanceTimersByTimeAsync(2900);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(starts).toHaveLength(2);
    expect(starts[1] - (starts[0] + 3000)).toBeGreaterThanOrEqual(3000);
  });

  it("never runs two reads at once and runs exactly one more after a burst", async () => {
    const { scheduler, read, finish } = harness(Infinity);
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 20; index += 1) {
      scheduler.trigger("watch");
      scheduler.trigger("refresh");
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("survives a read that rejects", async () => {
    const read = vi.fn(async () => {
      throw new Error("boom");
    });
    const scheduler = createChangesScheduler({ read });
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.trigger("refresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("immediate triggers", () => {
  it.each(["focus", "refresh", "shown"] as const)(
    "%s skips the debounce and the spacing",
    async (kind) => {
      const { scheduler, read } = harness();
      scheduler.setActive(true);
      await vi.advanceTimersByTimeAsync(0);
      scheduler.trigger(kind);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it("an immediate trigger upgrades a pending debounced one", async () => {
    const { scheduler, read } = harness();
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.trigger("watch");
    scheduler.trigger("focus");
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("inactive means nothing runs", () => {
  it("starts no read, drops triggers, and cancels a pending timer", async () => {
    const { scheduler, read } = harness();
    scheduler.trigger("refresh");
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).not.toHaveBeenCalled();

    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    scheduler.trigger("watch");
    scheduler.setActive(false);
    scheduler.trigger("watch");
    scheduler.trigger("focus");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads once on return", async () => {
    const { scheduler, read } = harness();
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    scheduler.setActive(false);
    await vi.advanceTimersByTimeAsync(60_000);
    scheduler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
