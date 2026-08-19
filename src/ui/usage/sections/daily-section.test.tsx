// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { EMPTY_COUNTERS, type UsageBucket, type UsageSnapshot } from "../../../lib/usage-snapshot";
import { localDayKey } from "../../../lib/usage-aggregate";
import { usageSnapshot } from "../../../usage/usage-store";
import { DAILY_DAYS, DailySection } from "./daily-section";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();

const snapshot = (buckets: readonly UsageBucket[]): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources: [
    { agent: "claude", state: "ok", filesScanned: 1 },
    { agent: "codex", state: "ok", filesScanned: 1 },
  ],
  skippedLines: 0,
});

describe("DailySection", () => {
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
      render(<DailySection />, host);
    });
  };

  it("covers the window the spec names, in the title and in the empty row", () => {
    mount();
    expect(DAILY_DAYS).toBe(30);
    expect(host.querySelector(".metric-table__title")?.textContent).toBe(
      `Last ${DAILY_DAYS} local days`,
    );
    // Empty is a statement, not a disappearance (DL-15.8).
    expect(host.querySelector(".metric-table__empty")?.textContent).toBe(
      `No data yet in the last ${DAILY_DAYS} local days`,
    );
    expect(host.querySelectorAll("thead th")).toHaveLength(4);
  });

  it("renders one row per local day, both agents inside it, day as the row header", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "claude-opus-4-20250514",
        counters: { ...EMPTY_COUNTERS, inputUncached: 10, output: 5 },
      },
      {
        bucketStartMs: NOW,
        agent: "codex",
        model: "gpt-5",
        counters: { ...EMPTY_COUNTERS, inputUncached: 2, output: 1 },
      },
    ]);
    mount();

    const rows = host.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('th[scope="row"]')?.textContent).toBe(localDayKey(NOW));
    const lines = rows[0].querySelectorAll(".usage-day-agent");
    expect(lines).toHaveLength(2);
    expect(host.textContent).toContain("Claude Code");
    expect(host.textContent).toContain("Codex");
    // The day's own totals stay in the numeric columns: 15 + 3 tokens.
    const cells = [...rows[0].querySelectorAll("th, td")].map((cell) => cell.textContent);
    expect(cells[2]).toBe("18");
  });

  it("gives every agent line its brand mark, with no alt beside its name", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "claude-opus-4-20250514",
        counters: { ...EMPTY_COUNTERS, output: 5 },
      },
      {
        bucketStartMs: NOW,
        agent: "codex",
        model: "gpt-5",
        counters: { ...EMPTY_COUNTERS, output: 1 },
      },
    ]);
    mount();

    const logos = [...host.querySelectorAll<HTMLImageElement>("img.usage-day-agent__logo")];
    expect(logos).toHaveLength(2);
    // DL-15.9: the name is the next element, so the mark is decorative here.
    for (const logo of logos) {
      expect(logo.getAttribute("alt")).toBe("");
      expect(logo.getAttribute("src")).toBeTruthy();
    }
  });

  it("keeps the table non-interactive, cells included (DL-15.2)", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "claude-opus-4-20250514",
        counters: { ...EMPTY_COUNTERS, output: 5 },
      },
    ]);
    mount();

    expect(host.querySelectorAll("tbody button, tbody a")).toHaveLength(0);
    expect(host.querySelector("[title]")).toBeNull();
  });

  it("prices what it can when one model on the day is unrecognised", () => {
    // The same real-corpus flaw the overview had: one unpriced sliver used to
    // dash the whole day's money cell.
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "claude-opus-4-5-20251101",
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000_000 },
      },
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "gpt-6-preview-2026-08",
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000 },
      },
    ]);
    mount();

    const cells = [
      ...(host.querySelector("tbody tr") as HTMLTableRowElement).querySelectorAll("th, td"),
    ].map((cell) => cell.textContent);
    expect(cells[3]).toBe("$5.00");
    // And the omission is disclosed under the table, by name.
    expect(host.querySelector(".metric-table__note")?.textContent).toContain(
      "no price for gpt-6-preview-2026-08",
    );
  });

  it("still dashes a day where nothing at all could be priced", () => {
    usageSnapshot.value = snapshot([
      {
        bucketStartMs: NOW,
        agent: "claude",
        model: "gpt-6-preview-2026-08",
        counters: { ...EMPTY_COUNTERS, inputUncached: 1_000 },
      },
    ]);
    mount();

    const cells = [
      ...(host.querySelector("tbody tr") as HTMLTableRowElement).querySelectorAll("th, td"),
    ].map((cell) => cell.textContent);
    expect(cells[3]).toBe("—");
  });
});
