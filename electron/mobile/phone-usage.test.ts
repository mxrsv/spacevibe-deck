import { describe, expect, it } from "vitest";
import { EMPTY_COUNTERS, type UsageSnapshot } from "../../src/lib/usage-snapshot";
import { summarizeUsage } from "./phone-usage";

const NOW = new Date(2026, 10, 5, 15, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function bucket(offsetDays: number, agent: "claude" | "codex", model: string, output: number) {
  return {
    bucketStartMs: new Date(2026, 10, 5, 9, 0, 0).getTime() - offsetDays * DAY,
    agent,
    model,
    repo: null,
    counters: { ...EMPTY_COUNTERS, output },
  };
}

describe("summarizeUsage", () => {
  it("splits today from the last seven days, per agent, and discloses unpriced tokens", () => {
    const snapshot: UsageSnapshot = {
      scannedAtMs: NOW,
      buckets: [
        bucket(0, "claude", "some-model-nobody-priced", 100),
        bucket(3, "codex", "some-model-nobody-priced", 50),
        bucket(9, "claude", "some-model-nobody-priced", 999),
      ],
      sources: [],
      skippedLines: 0,
    };
    const summary = summarizeUsage(snapshot, NOW);
    expect(summary.today.tokens).toBe(100);
    expect(summary.today.byAgent.claude.tokens).toBe(100);
    expect(summary.today.byAgent.codex.tokens).toBe(0);
    expect(summary.last7Days.tokens).toBe(150);
    expect(summary.last7Days.unpricedTokens).toBe(150);
    expect(summary.last7Days.costUsd).toBeNull();
  });

  it("is empty for an empty snapshot", () => {
    const summary = summarizeUsage(
      { scannedAtMs: 0, buckets: [], sources: [], skippedLines: 0 },
      NOW,
    );
    expect(summary.today).toMatchObject({ tokens: 0, costUsd: null });
  });
});
