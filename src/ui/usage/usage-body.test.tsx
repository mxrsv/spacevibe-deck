// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same idiom as usage-screen.test.tsx: replace the store wholesale with real
// signals, so the sections underneath still render off them, and Tauri's
// `invoke` never enters the tree.
vi.mock("../../usage/usage-store", async () => {
  const { signal } = await import("@preact/signals");
  return {
    usageSnapshot: signal(null),
    usageStale: signal(false),
    usageLoading: signal(false),
    startUsagePolling: vi.fn(),
    stopUsagePolling: vi.fn(),
  };
});

import type { UsageSnapshot } from "../../lib/usage-snapshot";
import { UsageBody } from "./usage-body";
import { activeUsageView, type UsageViewId } from "./active-usage-view-store";
import { usageSnapshot } from "../../usage/usage-store";

// Two agents, two models each, so the breakdown table has more than one row
// and the daily table stacks more than one agent inside its cell (DL-15.9) —
// a variant that dropped a row or a stacked line would go undetected on a
// single-row fixture.
const SEEDED_SNAPSHOT: UsageSnapshot = {
  scannedAtMs: 1_754_800_000_000,
  buckets: [
    {
      bucketStartMs: 1_754_800_000_000,
      agent: "claude",
      model: "claude-opus-4-5-20251101",
      counters: {
        inputUncached: 1_000_000,
        cacheRead: 200_000,
        cacheCreate5m: 10_000,
        cacheCreate1h: 5_000,
        cacheWrite: 1_000,
        output: 50_000,
      },
    },
    {
      bucketStartMs: 1_754_800_000_000,
      agent: "codex",
      model: "gpt-5-codex",
      counters: {
        inputUncached: 400_000,
        cacheRead: 0,
        cacheCreate5m: 0,
        cacheCreate1h: 0,
        cacheWrite: 0,
        output: 20_000,
      },
    },
  ],
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: "ok", filesScanned: 1 },
  ],
  skippedLines: 0,
};

describe("UsageBody", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    activeUsageView.value = "overview";
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    activeUsageView.value = "overview";
    usageSnapshot.value = null;
  });

  const mount = (variant?: "screen" | "dock"): void => {
    act(() => {
      render(variant === undefined ? <UsageBody /> : <UsageBody variant={variant} />, host);
    });
  };

  it("defaults to the screen variant's own class names", () => {
    mount();
    expect(host.querySelector(".usage-screen__grid")).not.toBeNull();
    expect(host.querySelector(".usage-screen__section")).not.toBeNull();
    expect(host.querySelector(".usage-dock__grid")).toBeNull();
    expect(host.querySelector(".usage-dock__section")).toBeNull();
  });

  it("variant=dock uses dock class names instead of the screen shell's", () => {
    mount("dock");
    expect(host.querySelector(".usage-dock__grid")).not.toBeNull();
    expect(host.querySelector(".usage-dock__section")).not.toBeNull();
    expect(host.querySelector(".usage-screen__grid")).toBeNull();
    expect(host.querySelector(".usage-screen__section")).toBeNull();
  });

  it("renders as a fragment: status and grid are direct siblings, no wrapper element", () => {
    mount("screen");
    // A wrapper div would put both one level deeper than the host's own
    // children; the screen variant must keep them exactly where
    // `UsageScreen` used to render them itself.
    expect(host.children).toHaveLength(2);
    expect(host.children[0]?.classList.contains("usage-status")).toBe(true);
    expect(host.children[1]?.classList.contains("usage-screen__grid")).toBe(true);
  });

  it("renders the rail and a tabpanel in both variants", () => {
    for (const variant of ["screen", "dock"] as const) {
      mount(variant);
      expect(host.querySelectorAll('.usage-nav [role="tab"]')).toHaveLength(3);
      expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
    }
  });

  it("the status strip renders identically regardless of variant", () => {
    act(() => {
      usageSnapshot.value = null;
    });
    mount("screen");
    // No source loaded yet, but the loading flag can still fire a note —
    // exercise it identically under both variants.
    const screenText = host.querySelector(".usage-status")?.textContent;

    mount("dock");
    const dockText = host.querySelector(".usage-status")?.textContent;

    expect(dockText).toBe(screenText);
  });

  // The actual claim under test: switching `variant` never drops a row, a
  // column or a figure — only the surrounding class names change. Each view
  // is seeded with two agents so a variant that silently dropped one would
  // be caught.
  const VIEWS: readonly UsageViewId[] = ["overview", "daily", "breakdown"];

  it.each(VIEWS)("dock loses no data relative to screen for the %s view", (viewId) => {
    activeUsageView.value = viewId;
    usageSnapshot.value = SEEDED_SNAPSHOT;

    mount("screen");
    const screenPanel = host.querySelector('[role="tabpanel"]');
    const screenText = screenPanel?.textContent;
    const screenCells = [...(screenPanel?.querySelectorAll("th, td") ?? [])].map(
      (cell) => cell.textContent,
    );

    mount("dock");
    const dockPanel = host.querySelector('[role="tabpanel"]');
    const dockText = dockPanel?.textContent;
    const dockCells = [...(dockPanel?.querySelectorAll("th, td") ?? [])].map(
      (cell) => cell.textContent,
    );

    expect(screenText).not.toBeUndefined();
    expect(dockText).toBe(screenText);
    expect(dockCells).toEqual(screenCells);
  });

  it("breakdown keeps all nine columns' cell text in dock mode (no column dropped)", () => {
    activeUsageView.value = "breakdown";
    usageSnapshot.value = SEEDED_SNAPSHOT;
    mount("dock");

    const headerTexts = [...host.querySelectorAll('[role="tabpanel"] thead th')].map(
      (cell) => cell.textContent,
    );
    expect(headerTexts).toEqual([
      "Agent",
      "Model",
      "Input uncached",
      "Cache read",
      "Cache create 5m",
      "Cache create 1h",
      "Cache write",
      "Output",
      "Est. USD",
    ]);
    expect(host.querySelectorAll('[role="tabpanel"] tbody tr')).toHaveLength(2);
  });

  it("a wide table still scrolls inside its own container in dock mode (DL-15.3)", () => {
    activeUsageView.value = "breakdown";
    usageSnapshot.value = SEEDED_SNAPSHOT;
    mount("dock");

    const scroller = host.querySelector(".metric-table__scroll");
    expect(scroller).not.toBeNull();
    expect(scroller?.querySelector("table")).not.toBeNull();
  });
});
