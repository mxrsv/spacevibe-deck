import { describe, expect, it } from "vitest";
import type { UsageBucket, UsageSnapshot, UsageSource } from "../../lib/usage-snapshot";
import { repoUsageToday, runningFor, usageAgentOf } from "./dock-usage-model";

// A local midday, so "today" and "yesterday" are unambiguous in any time zone.
const NOW = new Date(2026, 9, 24, 12, 0, 0).getTime();
const TODAY = new Date(2026, 9, 24, 9, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 23, 15, 0, 0).getTime();

const counters = (inputUncached: number, output = 0) => ({
  inputUncached,
  cacheRead: 0,
  cacheCreate5m: 0,
  cacheCreate1h: 0,
  cacheWrite: 0,
  output,
});

const bucket = (over: Partial<UsageBucket> & Pick<UsageBucket, "agent">): UsageBucket => ({
  bucketStartMs: TODAY,
  model: over.agent === "claude" ? "claude-haiku-4-5" : "gpt-5",
  repo: "/r/main",
  counters: counters(1_000_000),
  ...over,
});

const OK: readonly UsageSource[] = [
  { agent: "claude", state: "ok", filesScanned: 3 },
  { agent: "codex", state: "ok", filesScanned: 2 },
];

const snapshot = (buckets: UsageBucket[], sources: readonly UsageSource[] = OK): UsageSnapshot => ({
  scannedAtMs: NOW,
  buckets,
  sources,
  skippedLines: 0,
});

describe("usageAgentOf", () => {
  it("reads Claude Code and Codex, and no other agent", () => {
    expect(usageAgentOf("claude")).toBe("claude");
    expect(usageAgentOf("codex")).toBe("codex");
    for (const other of ["gemini", "opencode", "aider", "my-custom-agent"]) {
      expect(usageAgentOf(other)).toBeNull();
    }
  });
});

describe("repoUsageToday", () => {
  it("sums today's tokens and priced cost for one agent in one repository", () => {
    const usage = repoUsageToday(
      snapshot([
        bucket({ agent: "claude" }),
        bucket({ agent: "claude", counters: counters(0, 100_000) }),
      ]),
      "/r/main",
      ["claude"],
      NOW,
    );
    expect(usage?.tokens).toBe(1_100_000);
    // haiku: $1 per million input, $5 per million output.
    expect(usage?.costUsd).toBeCloseTo(1.5, 6);
  });

  it("leaves out yesterday, another repository and another agent", () => {
    const usage = repoUsageToday(
      snapshot([
        bucket({ agent: "claude" }),
        bucket({ agent: "claude", bucketStartMs: YESTERDAY }),
        bucket({ agent: "claude", repo: "/r/other" }),
        bucket({ agent: "codex" }),
      ]),
      "/r/main",
      ["claude"],
      NOW,
    );
    expect(usage?.tokens).toBe(1_000_000);
    expect(usage?.costUsd).toBeCloseTo(1, 6);
  });

  it("adds the agents of a space, each kind once", () => {
    const buckets = [bucket({ agent: "claude" }), bucket({ agent: "codex" })];
    const together = repoUsageToday(snapshot(buckets), "/r/main", ["claude", "codex"], NOW);
    expect(together?.tokens).toBe(2_000_000);
    // gpt-5: $1.25 per million input.
    expect(together?.costUsd).toBeCloseTo(2.25, 6);
  });

  it("is zero, not unknown, when the scanner read the agent and it did nothing today", () => {
    const usage = repoUsageToday(snapshot([]), "/r/main", ["claude"], NOW);
    expect(usage).toEqual({ tokens: 0, costUsd: 0 });
  });

  it("has a token count but no cost when nothing used today has a price", () => {
    const usage = repoUsageToday(
      snapshot([bucket({ agent: "claude", model: "a-model-with-no-price" })]),
      "/r/main",
      ["claude"],
      NOW,
    );
    expect(usage?.tokens).toBe(1_000_000);
    expect(usage?.costUsd).toBeNull();
  });

  it("is null before a snapshot, with no agent the scanner reads, and for an unreadable source", () => {
    expect(repoUsageToday(null, "/r/main", ["claude"], NOW)).toBeNull();
    expect(repoUsageToday(snapshot([bucket({ agent: "claude" })]), "/r/main", [], NOW)).toBeNull();
    const missing: readonly UsageSource[] = [
      { agent: "claude", state: "missing", filesScanned: 0 },
      { agent: "codex", state: "unreadable", filesScanned: 0 },
    ];
    const buckets = [bucket({ agent: "claude" }), bucket({ agent: "codex" })];
    expect(repoUsageToday(snapshot(buckets, missing), "/r/main", ["claude"], NOW)).toBeNull();
    expect(repoUsageToday(snapshot(buckets, missing), "/r/main", ["codex"], NOW)).toBeNull();
  });

  it("answers with the agents it can read when only some are readable", () => {
    const sources: readonly UsageSource[] = [
      { agent: "claude", state: "ok", filesScanned: 1 },
      { agent: "codex", state: "missing", filesScanned: 0 },
    ];
    const buckets = [bucket({ agent: "claude" }), bucket({ agent: "codex" })];
    const usage = repoUsageToday(snapshot(buckets, sources), "/r/main", ["claude", "codex"], NOW);
    expect(usage?.tokens).toBe(1_000_000);
  });
});

describe("runningFor", () => {
  const minute = 60_000;
  it("reads minutes, hours and days", () => {
    expect(runningFor(NOW - 10_000, NOW)).toBe("under a minute");
    expect(runningFor(NOW - 42 * minute, NOW)).toBe("42m");
    expect(runningFor(NOW - (3 * 60 + 5) * minute, NOW)).toBe("3h 5m");
    expect(runningFor(NOW - 50 * 60 * minute, NOW)).toBe("2d");
  });

  it("never reads negative when a clock disagrees", () => {
    expect(runningFor(NOW + minute, NOW)).toBe("under a minute");
  });
});
