import { describe, expect, it } from "vitest";
import { agentLabel, formatCost, formatTokens, parseUsage, unpricedNote } from "./usage-format";

const w = (tokens: number, costUsd: number | null, unpricedTokens = 0) => ({
  tokens,
  costUsd,
  unpricedTokens,
});
const sample = {
  scannedAtMs: 1_700_000_000_000,
  today: {
    ...w(1_250_000, 4.5, 30_000),
    byAgent: { claude: w(1_000_000, 4, 0), codex: w(250_000, 0.5, 30_000) },
  },
  last7Days: {
    ...w(9_900_000, null, 9_900_000),
    byAgent: { claude: w(9_900_000, null, 9_900_000), codex: w(0, null, 0) },
  },
};

describe("usage formatting", () => {
  it("parses what the desktop sends and nothing else", () => {
    const view = parseUsage(sample);
    expect(view?.today.byAgent.map((a) => a.agent)).toEqual(["claude", "codex"]);
    expect(view?.last7Days.costUsd).toBeNull();
    expect(parseUsage({ ...sample, today: { tokens: "x" } })).toBeNull();
    expect(parseUsage({ ...sample, today: { ...sample.today, tokens: -1 } })).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage({})).toBeNull();
  });

  it("shortens token counts like the desktop tab", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(912_000)).toBe("912K");
    expect(formatTokens(16_800_000)).toBe("16.8M");
    expect(formatTokens(999_999)).toBe("1M");
    expect(formatTokens(48_100_000_000)).toBe("48.1B");
  });

  it("formats dollars, with a dash for an unknown cost and never a fake zero", () => {
    expect(formatCost(4.5)).toBe("$4.50");
    expect(formatCost(1234.5)).toBe("$1,234.50");
    expect(formatCost(0.004)).toBe("$0.0040");
    expect(formatCost(0.00001)).toBe("< $0.0001");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(null)).toBe("—");
  });

  it("discloses tokens that no price covers, so a partial cost is not read as complete", () => {
    expect(unpricedNote(w(10, 1, 0))).toBeNull();
    expect(unpricedNote(w(100_000, 2, 30_000))).toBe(
      "30K tokens have no known price and are not in this cost",
    );
    expect(unpricedNote(w(100_000, null, 100_000))).toMatch(/no cost$/);
  });

  it("labels the agents it knows and passes others through", () => {
    expect(agentLabel("claude")).toBe("Claude Code");
    expect(agentLabel("opencode")).toBe("opencode");
  });
});
