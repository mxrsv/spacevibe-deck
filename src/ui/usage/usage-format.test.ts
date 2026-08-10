import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { formatUsd } from "../../lib/usage-pricing";
import { PRICING_SNAPSHOT_DATE } from "../../lib/usage-pricing-snapshot";
import {
  EM_DASH,
  ESTIMATE_NOTE,
  formatTokens,
  usdCell,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
} from "./usage-format";

describe("USAGE_AGENT_LABEL", () => {
  it("uses the same words the agent catalog already uses", () => {
    // Two names for one tool inside one app is the bug this guards.
    for (const agent of USAGE_AGENT_ORDER) {
      const builtin = BUILTIN_AGENTS.find((entry) => entry.id === agent);
      expect(builtin?.label).toBe(USAGE_AGENT_LABEL[agent]);
    }
  });

  it("orders claude before codex, matching the scanner's source order", () => {
    expect([...USAGE_AGENT_ORDER]).toEqual(["claude", "codex"]);
  });
});

describe("formatTokens", () => {
  it("groups thousands so magnitudes are readable at a glance", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1234)).toBe("1,234");
    expect(formatTokens(1204338)).toBe("1,204,338");
  });
});

describe("usdCell", () => {
  it("returns null for an unpriced value so the table paints the dash", () => {
    // The dash itself is the table's job (DL-15.6) — this must not
    // pre-render a placeholder of its own.
    expect(usdCell(null)).toBeNull();
    expect(usdCell(null)).not.toBe(EM_DASH);
  });

  it("delegates a real number to the shared money formatter", () => {
    expect(usdCell(12.5)).toBe(formatUsd(12.5));
    // Zero is a measurement, not an absence (DL-15.6).
    expect(usdCell(0)).toBe(formatUsd(0));
  });
});

describe("ESTIMATE_NOTE", () => {
  it("names the estimate and carries the pricing snapshot date", () => {
    expect(ESTIMATE_NOTE).toContain("estimated at API prices");
    // Interpolated, never hardcoded: a pricing refresh must not fail a test.
    expect(ESTIMATE_NOTE).toContain(PRICING_SNAPSHOT_DATE);
  });

  it("never claims more than the data supports", () => {
    expect(ESTIMATE_NOTE).not.toContain("machine-wide");
    expect(ESTIMATE_NOTE).not.toContain("all-time");
  });
});
