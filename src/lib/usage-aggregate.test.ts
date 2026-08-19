// This repo has no `@types/node` and `tsconfig.json` lists only ES2020 + DOM,
// so `process` is not a known global under `src/` — declaring it here is what
// keeps `npm run build` green. Ambient, so nothing is emitted.
declare const process: { env: Record<string, string | undefined> };

// The zone is pinned before anything reads it: `America/New_York` observes
// DST, which is what makes the local-day assertions below meaningful. ESM
// hoists the imports above this line, so it runs after they evaluate but
// before any test body — soon enough, because `usage-aggregate` builds every
// Date at call time rather than at module load.
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = "America/New_York";

import { afterAll, describe, expect, it } from "vitest";
import { agentTotals, breakdownRows, dailyRows, dailyTotals, localDayKey } from "./usage-aggregate";
import { EMPTY_COUNTERS, type UsageBucket, type UsageCounters } from "./usage-snapshot";

afterAll(() => {
  // Worker processes are reused across test files; a leaked TZ would make
  // another suite's dates depend on this one having run first.
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

function bucket(
  isoStart: string,
  agent: UsageBucket["agent"],
  model: string,
  patch: Partial<UsageCounters> = {},
): UsageBucket {
  return {
    bucketStartMs: Date.parse(isoStart),
    agent,
    model,
    counters: { ...EMPTY_COUNTERS, ...patch },
  };
}

describe("localDayKey", () => {
  it("is a meaningful test — the pinned zone really does shift", () => {
    expect(new Date(Date.parse("2026-03-08T06:30:00Z")).getTimezoneOffset()).toBe(300);
    expect(new Date(Date.parse("2026-03-08T07:30:00Z")).getTimezoneOffset()).toBe(240);
  });

  it("keeps both sides of a spring-forward transition on the same local day", () => {
    expect(localDayKey(Date.parse("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
    expect(localDayKey(Date.parse("2026-03-08T07:30:00Z"))).toBe("2026-03-08");
  });

  it("keeps both sides of a fall-back transition on the same local day", () => {
    expect(localDayKey(Date.parse("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(localDayKey(Date.parse("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
  });

  it("rolls the day at local midnight, not UTC midnight", () => {
    expect(localDayKey(Date.parse("2026-08-10T03:59:00Z"))).toBe("2026-08-09");
    expect(localDayKey(Date.parse("2026-08-10T04:01:00Z"))).toBe("2026-08-10");
  });

  it("zero-pads month and day", () => {
    expect(localDayKey(Date.parse("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("agentTotals", () => {
  const buckets = [
    bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", { output: 1000 }),
    bucket("2026-08-10T12:15:00Z", "claude", "claude-sonnet-5", {
      output: 1000,
    }),
    bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", { output: 1000 }),
    bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", {
      inputUncached: 1000,
    }),
  ];

  it("sums per agent across models and buckets, Claude before Codex", () => {
    const totals = agentTotals(buckets, null);

    expect(totals.map((row) => row.agent)).toEqual(["claude", "codex"]);
    expect(totals[0].counters.output).toBe(3000);
    expect(totals[1].counters.inputUncached).toBe(1000);
  });

  it("prices the total from each contributing model's own rate", () => {
    const totals = agentTotals(buckets, null);

    // 2000 output on claude-opus-5 at 2.5e-5 + 1000 on claude-sonnet-5 at 1e-5
    expect(totals[0].costUsd).toBeCloseTo(0.06, 10);
    // 1000 uncached input on gpt-5.6-sol at 5e-6
    expect(totals[1].costUsd).toBeCloseTo(0.005, 10);
  });

  it("drops buckets that start before sinceMs", () => {
    const todayStart = Date.parse("2026-08-10T04:00:00Z"); // local midnight

    const totals = agentTotals(buckets, todayStart);

    expect(totals[0].counters.output).toBe(2000);
  });

  it("returns no row for an agent with nothing in range", () => {
    const totals = agentTotals(buckets, Date.parse("2026-08-10T12:10:00Z"));

    expect(totals.map((row) => row.agent)).toEqual(["claude"]);
  });

  it("returns nothing at all for an empty input", () => {
    expect(agentTotals([], null)).toEqual([]);
  });

  it("reports the priced part and discloses the gap when a model is unpriced", () => {
    const totals = agentTotals(
      [
        ...buckets,
        bucket("2026-08-10T12:30:00Z", "claude", "claude-from-the-future", {
          output: 5,
        }),
      ],
      null,
    );

    // The refinement of §0.3 decision 8: one unrecognised model id used to
    // null the whole agent, which deleted a correct $11k figure on the real
    // corpus. The priced models still add up; the gap is disclosed beside it.
    expect(totals[0].costUsd).toBeCloseTo(0.06, 10);
    expect(totals[0].unpricedModels).toEqual(["claude-from-the-future"]);
    expect(totals[0].unpricedTokens).toBe(5);
    // Codex is untouched — nothing spreads across agents.
    expect(totals[1].costUsd).toBeCloseTo(0.005, 10);
    expect(totals[1].unpricedTokens).toBe(0);
  });

  it("still refuses a figure when NOTHING the agent ran is priced", () => {
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-from-the-future", {
          output: 5,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "another-unknown", {
          output: 7,
        }),
      ],
      null,
    );

    // No priced part to report, so there is no partial sum to stand behind.
    expect(totals[0].costUsd).toBeNull();
    expect(totals[0].unpricedTokens).toBe(12);
  });

  it("counts unpriced tokens across every counter class, not just output", () => {
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "mystery-model", {
          inputUncached: 100,
          cacheRead: 20,
          output: 3,
        }),
      ],
      null,
    );

    expect(totals[0].unpricedTokens).toBe(123);
  });

  it("lists unpriced models deduped and sorted", () => {
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "zeta-model", { output: 1 }),
        bucket("2026-08-10T12:15:00Z", "claude", "alpha-model", { output: 1 }),
        bucket("2026-08-10T12:30:00Z", "claude", "zeta-model", { output: 1 }),
      ],
      null,
    );

    expect(totals[0].unpricedModels).toEqual(["alpha-model", "zeta-model"]);
  });

  it("is not poisoned by an all-zero unpriced model", () => {
    // Claude Code's `<synthetic>` marker: 138 lines on this machine, all zero.
    const totals = agentTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "<synthetic>"),
      ],
      null,
    );

    expect(totals[0].unpricedModels).toEqual([]);
    expect(totals[0].costUsd).toBeCloseTo(0.025, 10);
  });
});

describe("dailyRows", () => {
  const nowMs = Date.parse("2026-08-10T18:00:00Z"); // 14:00 local

  it("emits one row per day and agent that has data, newest day first", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", { output: 1 }),
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows.map((row) => [row.day, row.agent])).toEqual([
      ["2026-08-10", "claude"],
      ["2026-08-10", "codex"],
      ["2026-08-09", "claude"],
    ]);
  });

  it("merges every bucket of the same local day into one row", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 100,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "claude-opus-5", {
          output: 200,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].counters.output).toBe(300);
  });

  it("assigns a bucket to its LOCAL day, not its UTC day", () => {
    // 03:00Z on the 8th is 23:00 on the 7th in New York, so it falls outside
    // a three-day window ending on the 10th.
    const rows = dailyRows(
      [
        bucket("2026-08-08T03:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-08-08T05:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows.map((row) => row.day)).toEqual(["2026-08-08"]);
  });

  it("neither skips nor repeats a day across a DST transition", () => {
    // 2026-11-01 is the US fall-back date. Local noon on three consecutive
    // days must produce three distinct, consecutive keys.
    const afterFallBack = Date.parse("2026-11-02T17:00:00Z");
    const rows = dailyRows(
      [
        bucket("2026-10-31T16:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-11-01T17:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-11-02T17:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      afterFallBack,
    );

    expect(rows.map((row) => row.day)).toEqual(["2026-11-02", "2026-11-01", "2026-10-31"]);
  });

  it("drops anything older than the window", () => {
    const rows = dailyRows(
      [
        bucket("2026-07-01T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows).toEqual([]);
  });

  it("returns nothing for a non-positive or unusable window", () => {
    const one = [bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", { output: 1 })];

    expect(dailyRows(one, 0, nowMs)).toEqual([]);
    expect(dailyRows(one, -1, nowMs)).toEqual([]);
    expect(dailyRows(one, 3, Number.NaN)).toEqual([]);
  });

  it("carries the same priced-part rule as the totals", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "claude", "claude-from-the-future", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    // A day with one unrecognised model still reports what it can price.
    expect(rows[0].costUsd).toBeCloseTo(0.025, 10);
    expect(rows[0].unpricedModels).toEqual(["claude-from-the-future"]);
    expect(rows[0].unpricedTokens).toBe(1);
  });

  it("dashes a day whose every model is unpriced", () => {
    const rows = dailyRows(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-from-the-future", {
          output: 4,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows[0].costUsd).toBeNull();
    expect(rows[0].unpricedTokens).toBe(4);
  });
});

describe("dailyTotals", () => {
  const nowMs = Date.parse("2026-08-10T18:00:00Z"); // 14:00 local

  it("emits one row per day, carrying that day's agents, newest first", () => {
    const rows = dailyTotals(
      [
        bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", { output: 1 }),
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
        bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", {
          output: 1,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows.map((row) => row.day)).toEqual(["2026-08-10", "2026-08-09"]);
    expect(rows[0].agents.map((agent) => agent.agent)).toEqual(["claude", "codex"]);
    expect(rows[1].agents.map((agent) => agent.agent)).toEqual(["claude"]);
  });

  it("sums the day's counters and the day's priced cost across agents", () => {
    const rows = dailyTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "codex", "gpt-5.6-sol", {
          output: 1000,
        }),
      ],
      3,
      nowMs,
    );

    const [claude, codex] = rows[0].agents;
    expect(rows[0].counters.output).toBe(2000);
    expect(rows[0].costUsd).toBeCloseTo((claude.costUsd ?? 0) + (codex.costUsd ?? 0), 10);
  });

  it("prices what it can when one agent on the day is entirely unpriced", () => {
    const rows = dailyTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
          output: 1000,
        }),
        bucket("2026-08-10T12:15:00Z", "codex", "gpt-from-the-future", {
          output: 7,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows[0].costUsd).toBeCloseTo(0.025, 10);
    expect(rows[0].unpricedModels).toEqual(["gpt-from-the-future"]);
    expect(rows[0].unpricedTokens).toBe(7);
  });

  it("keeps a model string shared by two agents on separate lines", () => {
    // `unknown` really does appear under both agents on the real corpus.
    // Rolling the day up per agent first is what stops the two counters from
    // fusing into one entry — a day row must still be able to say who spent
    // what.
    const rows = dailyTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "unknown", { output: 3 }),
        bucket("2026-08-10T12:15:00Z", "codex", "unknown", { output: 5 }),
      ],
      3,
      nowMs,
    );

    expect(rows[0].agents.map((agent) => agent.counters.output)).toEqual([3, 5]);
    expect(rows[0].counters.output).toBe(8);
  });

  it("dashes a day whose every model is unpriced", () => {
    const rows = dailyTotals(
      [
        bucket("2026-08-10T12:00:00Z", "claude", "claude-from-the-future", {
          output: 4,
        }),
      ],
      3,
      nowMs,
    );

    expect(rows[0].costUsd).toBeNull();
    expect(rows[0].unpricedTokens).toBe(4);
  });

  it("returns nothing for a non-positive or unusable window", () => {
    const one = [bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", { output: 1 })];

    expect(dailyTotals(one, 0, nowMs)).toEqual([]);
    expect(dailyTotals(one, 3, Number.NaN)).toEqual([]);
  });
});

describe("breakdownRows", () => {
  it("emits one row per agent and raw model, sorted by both", () => {
    const rows = breakdownRows([
      bucket("2026-08-10T12:00:00Z", "codex", "gpt-5.6-sol", {
        inputUncached: 10,
      }),
      bucket("2026-08-10T12:00:00Z", "claude", "claude-sonnet-5", {
        output: 20,
      }),
      bucket("2026-08-09T12:00:00Z", "claude", "claude-opus-5", { output: 30 }),
      bucket("2026-08-10T12:15:00Z", "claude", "claude-opus-5", { output: 40 }),
    ]);

    expect(rows.map((row) => [row.agent, row.model])).toEqual([
      ["claude", "claude-opus-5"],
      ["claude", "claude-sonnet-5"],
      ["codex", "gpt-5.6-sol"],
    ]);
    expect(rows[0].counters.output).toBe(70);
  });

  it("keeps the raw model string verbatim and prices it on its own", () => {
    const rows = breakdownRows([
      bucket("2026-08-10T12:00:00Z", "claude", "claude-opus-5", {
        output: 1000,
      }),
      bucket("2026-08-10T12:00:00Z", "claude", "claude-from-the-future", {
        output: 1000,
      }),
    ]);

    expect(rows[0].model).toBe("claude-from-the-future");
    expect(rows[0].costUsd).toBeNull();
    expect(rows[1].costUsd).toBeCloseTo(0.025, 10);
  });

  it("returns nothing for an empty input", () => {
    expect(breakdownRows([])).toEqual([]);
  });
});
