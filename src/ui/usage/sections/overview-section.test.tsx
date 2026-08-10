// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section imports the usage store, whose client reaches `invoke`; stub it
// so the tree mounts under jsdom (the workspace-sidebar.test.tsx idiom).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { EMPTY_COUNTERS } from "../../../lib/usage-snapshot";
import type { UsageBucket, UsageSnapshot } from "../../../lib/usage-snapshot";
import { PRICING_SNAPSHOT_DATE } from "../../../lib/usage-pricing-snapshot";
import { usageSnapshot } from "../../../usage/usage-store";
import { OverviewSection, startOfLocalDay } from "./overview-section";
import { EM_DASH } from "../usage-format";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const bucket = (patch: Partial<UsageBucket>): UsageBucket => ({
  bucketStartMs: NOW,
  agent: "claude",
  model: "claude-opus-4-20250514",
  counters: { ...EMPTY_COUNTERS, inputUncached: 100, output: 50 },
  ...patch,
});

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 3 },
    { agent: "codex", state: "ok", filesScanned: 2 },
  ],
  skippedLines: 0,
});

describe("startOfLocalDay", () => {
  it("returns local midnight, not UTC midnight", () => {
    const midnight = startOfLocalDay(NOW);
    const asDate = new Date(midnight);
    expect(asDate.getHours()).toBe(0);
    expect(asDate.getMinutes()).toBe(0);
    expect(asDate.getSeconds()).toBe(0);
    expect(asDate.getDate()).toBe(new Date(NOW).getDate());
  });

  it("lands on a 15-minute boundary for every offset, so the filter is exact", () => {
    // BUCKET_MS is 15 minutes precisely so this holds (§0.2.4).
    expect(startOfLocalDay(NOW) % (15 * 60 * 1000)).toBe(0);
  });
});

describe("OverviewSection", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
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
    vi.useRealTimers();
  });

  const mount = (): void => {
    act(() => {
      render(<OverviewSection />, host);
    });
  };

  const rowFor = (label: string): HTMLTableRowElement =>
    [...host.querySelectorAll("tbody tr")].find(
      (row) => row.querySelector("th")?.textContent === label,
    ) as HTMLTableRowElement;

  it("lists both agents even with no data, dashed rather than zeroed", () => {
    mount();
    expect(rowFor("Claude Code")).toBeDefined();
    expect(rowFor("Codex")).toBeDefined();
    // A dash is "we counted nothing"; a 0 would claim a measurement.
    const cells = rowFor("Codex").querySelectorAll("td");
    expect([...cells].map((cell) => cell.textContent)).toEqual([
      EM_DASH,
      EM_DASH,
      EM_DASH,
      EM_DASH,
    ]);
  });

  it("separates today from recorded history", () => {
    const yesterday = startOfLocalDay(NOW) - 60 * 60 * 1000;
    usageSnapshot.value = snapshot([
      bucket({ bucketStartMs: NOW }),
      bucket({ bucketStartMs: yesterday }),
    ]);
    mount();

    const cells = [...rowFor("Claude Code").querySelectorAll("td")].map(
      (cell) => cell.textContent,
    );
    // today = one bucket of 150 tokens; recorded = both, 300.
    expect(cells[0]).toBe("150");
    expect(cells[2]).toBe("300");
  });

  it("names its columns for the words the spec uses, never 'all-time'", () => {
    mount();
    const headers = [...host.querySelectorAll("thead th")].map(
      (cell) => cell.textContent,
    );
    expect(headers).toEqual([
      "agent",
      "tokens today",
      "est. usd today",
      "tokens recorded",
      "est. usd recorded",
    ]);
    expect(host.textContent).not.toContain("all-time");
    expect(host.textContent).not.toContain("machine-wide");
  });

  it("carries the estimate disclaimer and the pricing snapshot date", () => {
    mount();
    const note = host.querySelector(".metric-table__note")?.textContent ?? "";
    expect(note).toContain("estimated at API prices");
    expect(note).toContain(PRICING_SNAPSHOT_DATE);
  });
});
