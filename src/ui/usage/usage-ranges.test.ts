import { describe, expect, it } from "vitest";
import {
  rangeSinceMs,
  startOfLocalDay,
  USAGE_RANGES,
  type UsageRangeId,
} from "./usage-ranges";

const NOW = new Date("2026-08-10T15:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

const rangeById = (id: UsageRangeId) =>
  USAGE_RANGES.find((range) => range.id === id)!;

describe("startOfLocalDay", () => {
  it("returns local midnight, not UTC midnight", () => {
    const asDate = new Date(startOfLocalDay(NOW));
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

describe("USAGE_RANGES", () => {
  it("offers today, 7 days, 30 days and all, in that order", () => {
    expect(USAGE_RANGES.map((range) => range.id)).toEqual([
      "today",
      "7d",
      "30d",
      "all",
    ]);
    expect(USAGE_RANGES.map((range) => range.label)).toEqual([
      "Today",
      "7 days",
      "30 days",
      "All",
    ]);
  });

  it("labels every option sentence-case, never uppercase (DL-16.7, DL-4.3, DL-4.4)", () => {
    for (const range of USAGE_RANGES) {
      expect(range.label).not.toBe(range.label.toUpperCase());
      expect(range.label[0]).not.toMatch(/[a-z]/);
    }
  });

  it("names the period in its own empty message, never just 'nothing'", () => {
    // DL-16.7: an empty period says WHICH period is empty.
    expect(rangeById("today").emptyLabel).toBe("No usage today");
    expect(rangeById("7d").emptyLabel).toBe(
      "No usage in the last 7 local days",
    );
    expect(rangeById("30d").emptyLabel).toBe(
      "No usage in the last 30 local days",
    );
    expect(rangeById("all").emptyLabel).toBe("No data yet");
  });
});

describe("rangeSinceMs", () => {
  it("counts local calendar days inclusive of today, not rolling 24h windows", () => {
    // "7 days" must agree with the daily view one rail item away, which is
    // bucketed by local calendar day.
    expect(rangeSinceMs(rangeById("today"), NOW)).toBe(startOfLocalDay(NOW));
    expect(rangeSinceMs(rangeById("7d"), NOW)).toBe(
      startOfLocalDay(NOW - 6 * DAY),
    );
    expect(rangeSinceMs(rangeById("30d"), NOW)).toBe(
      startOfLocalDay(NOW - 29 * DAY),
    );
  });

  it("returns null for the whole recorded history", () => {
    expect(rangeSinceMs(rangeById("all"), NOW)).toBeNull();
  });

  it("always starts at a local midnight, however far back it reaches", () => {
    for (const range of USAGE_RANGES) {
      const since = rangeSinceMs(range, NOW);
      if (since === null) {
        continue;
      }
      const asDate = new Date(since);
      expect(asDate.getHours()).toBe(0);
      expect(asDate.getMinutes()).toBe(0);
    }
  });

  it("crosses a month boundary by calendar, not by subtracting milliseconds", () => {
    // 2026-03-05 minus 6 days is 2026-02-27; date arithmetic through the Date
    // constructor handles the short month, a `- n * DAY` subtraction would
    // also drift across a DST change.
    const march5 = new Date(2026, 2, 5, 15, 0, 0).getTime();
    const since = rangeSinceMs(rangeById("7d"), march5) as number;
    const asDate = new Date(since);
    expect(asDate.getFullYear()).toBe(2026);
    expect(asDate.getMonth()).toBe(1);
    expect(asDate.getDate()).toBe(27);
  });
});
