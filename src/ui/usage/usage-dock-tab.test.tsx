// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_COUNTERS, type UsageSnapshot } from "../../lib/usage-snapshot";
const mocks = vi.hoisted(() => ({ limits: vi.fn(), tokens: vi.fn() }));
vi.mock("../../host/agent-limits-host", () => ({ available: true, readAgentLimits: mocks.limits }));
vi.mock("../../usage/usage-client", () => ({ defaultUsageClient: { snapshot: mocks.tokens } }));
const { UsageDockTab } = await import("./usage-dock-tab");
const { RailAgentLimits } = await import("./agent-usage-summary");
const { activeUsageRange } = await import("./active-usage-view-store");
const { usageSnapshot, usageLoading, usageStale } = await import("../../usage/usage-store");
const now = new Date(2026, 8, 14, 14).getTime();
const snapshot: UsageSnapshot = {
  scannedAtMs: now,
  sources: [],
  skippedLines: 0,
  buckets: [
    {
      agent: "claude",
      model: "gpt-5",
      bucketStartMs: now,
      counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
    },
  ],
};
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.tokens.mockReset();
  mocks.limits.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  activeUsageRange.value = "all";
  usageSnapshot.value = null;
  usageLoading.value = false;
  usageStale.value = false;
  mocks.tokens.mockResolvedValue(snapshot);
  mocks.limits.mockResolvedValue([
    {
      agent: "claude",
      state: "ready",
      observedAtMs: now,
      windows: [{ durationMinutes: 300, usedPercent: 32, resetsAtMs: now + 600_000 }],
    },
  ]);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
});
it.each([false, true])(
  "dock owns token polling and shares allowance when sidebar=%s",
  async (sidebar) => {
    await act(async () => {
      render(
        <>
          {sidebar && <RailAgentLimits onOpenUsage={() => undefined} />}
          <UsageDockTab />
        </>,
        host,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.tokens).toHaveBeenCalledTimes(1);
    expect(mocks.limits).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".usage-allowance")?.textContent).toContain("68%");
    const order = [...host.querySelector(".usage-overview")!.children].map(
      (node) => node.className,
    );
    expect(order.slice(0, 3)).toEqual(["usage-allowance", "usage-range", "usage-timeline"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.limits).toHaveBeenCalledTimes(2);
    expect(mocks.tokens).toHaveBeenCalledTimes(4);
    act(() => render(null, host));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.tokens).toHaveBeenCalledTimes(4);
  },
);
it("keeps valid allowance through token loading/error and history through limit errors", async () => {
  mocks.tokens.mockImplementationOnce(() => new Promise(() => undefined));
  await act(async () => {
    render(<UsageDockTab />, host);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(host.querySelector(".usage-allowance")?.textContent).toContain("68%");
  expect(host.textContent).toContain("Reading recorded token history");
  act(() => {
    usageSnapshot.value = snapshot;
    usageStale.value = true;
  });
  expect(host.querySelector(".usage-hero__figure")?.textContent).toBe("$1.25");
  expect(host.querySelector(".usage-allowance")?.textContent).toContain("68%");
  mocks.limits.mockResolvedValue([
    { agent: "claude", state: "error", observedAtMs: now, windows: [] },
  ]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(host.querySelector(".usage-allowance")?.textContent).toContain("Could not refresh limits");
  expect(host.querySelector(".usage-hero__figure")?.textContent).toBe("$1.25");
});
it("cost-period changes leave current limits and reset text untouched", async () => {
  mocks.tokens.mockResolvedValue({
    ...snapshot,
    buckets: [
      ...snapshot.buckets,
      { ...snapshot.buckets[0], bucketStartMs: new Date(2026, 7, 1).getTime() },
    ],
  });
  await act(async () => {
    render(<UsageDockTab />, host);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const allowance = host.querySelector(".usage-allowance")?.textContent;
  expect(host.querySelector(".usage-hero__figure")?.textContent).toBe("$2.50");
  act(() => {
    activeUsageRange.value = "today";
  });
  expect(host.querySelector(".usage-hero__figure")?.textContent).toBe("$1.25");
  expect(host.querySelector(".usage-allowance")?.textContent).toBe(allowance);
  expect(mocks.limits).toHaveBeenCalledTimes(1);
});
