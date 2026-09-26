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
import { usageSnapshot } from "../../usage/usage-store";

// Two agents, so a variant that dropped one agent's figures would go
// undetected on a single-agent fixture.
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
    usageSnapshot.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
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

  it("renders the overview directly, with no view rail", () => {
    for (const variant of ["screen", "dock"] as const) {
      mount(variant);
      // The overview's own cost-range selector is the only tablist left.
      const tablists = [...host.querySelectorAll('[role="tablist"]')];
      expect(tablists.map((list) => list.getAttribute("aria-label"))).toEqual(["Cost range"]);
      expect(host.querySelector(".usage-overview")).not.toBeNull();
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

  // The actual claim under test: switching `variant` never drops a figure —
  // only the surrounding class names change. The fixture carries two agents
  // so a variant that silently dropped one would be caught.
  it("dock loses no data relative to screen", () => {
    usageSnapshot.value = SEEDED_SNAPSHOT;

    mount("screen");
    const screenText = host.querySelector(".usage-screen__section")?.textContent;

    mount("dock");
    const dockText = host.querySelector(".usage-dock__section")?.textContent;

    expect(screenText).not.toBeUndefined();
    expect(dockText).toBe(screenText);
  });
});
