import { describe, expect, it } from 'vitest';
import { BUILTIN_AGENTS } from '../../lib/agent-catalog';
import { formatUsd } from '../../lib/usage-pricing';
import { PRICING_SNAPSHOT_DATE } from '../../lib/usage-pricing-snapshot';
import {
  EM_DASH,
  ESTIMATE_NOTE,
  formatTokens,
  formatTokensCompact,
  usdCell,
  USAGE_AGENT_LABEL,
  USAGE_AGENT_ORDER,
} from './usage-format';

describe('USAGE_AGENT_LABEL', () => {
  it('uses the same words the agent catalog already uses', () => {
    // Two names for one tool inside one app is the bug this guards.
    for (const agent of USAGE_AGENT_ORDER) {
      const builtin = BUILTIN_AGENTS.find((entry) => entry.id === agent);
      expect(builtin?.label).toBe(USAGE_AGENT_LABEL[agent]);
    }
  });

  it("orders claude before codex, matching the scanner's source order", () => {
    expect([...USAGE_AGENT_ORDER]).toEqual(['claude', 'codex']);
  });
});

describe('formatTokens', () => {
  it('groups thousands so magnitudes are readable at a glance', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1234)).toBe('1,234');
    expect(formatTokens(1204338)).toBe('1,204,338');
  });
});

describe('formatTokensCompact', () => {
  it('leaves anything under a thousand exactly as it is', () => {
    // No suffix and no decimal: `912` is already short, and `0.9K` would be
    // both longer and less precise than the number it replaced.
    expect(formatTokensCompact(0)).toBe('0');
    expect(formatTokensCompact(7)).toBe('7');
    expect(formatTokensCompact(999)).toBe('999');
  });

  it('uses one decimal, and drops it when it would read `.0`', () => {
    expect(formatTokensCompact(1000)).toBe('1K');
    expect(formatTokensCompact(1234)).toBe('1.2K');
    expect(formatTokensCompact(912_000)).toBe('912K');
    expect(formatTokensCompact(16_800_000)).toBe('16.8M');
    expect(formatTokensCompact(48_100_000_000)).toBe('48.1B');
  });

  it('promotes to the next tier when rounding would print a four-digit mantissa', () => {
    // 999_950 / 1000 rounds to 1000.0 at one decimal. `1000.0K` is the bug
    // this guards: the tier has to move, not the mantissa.
    expect(formatTokensCompact(999_949)).toBe('999.9K');
    expect(formatTokensCompact(999_950)).toBe('1M');
    expect(formatTokensCompact(999_999_999)).toBe('1B');
  });

  it('carries a tier past billions rather than printing a bare huge number', () => {
    expect(formatTokensCompact(1_000_000_000_000)).toBe('1T');
    expect(formatTokensCompact(2_500_000_000_000)).toBe('2.5T');
  });

  it('never renders a non-finite count as `NaN`', () => {
    // Unreachable from the payload (counters are integers) but a rendered
    // `NaN` is worse than a wrong zero, same rule as `formatUsd`.
    expect(formatTokensCompact(Number.NaN)).toBe('0');
    expect(formatTokensCompact(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('usdCell', () => {
  it('returns null for an unpriced value so the table paints the dash', () => {
    // The dash itself is the table's job (DL-15.6) — this must not
    // pre-render a placeholder of its own.
    expect(usdCell(null)).toBeNull();
    expect(usdCell(null)).not.toBe(EM_DASH);
  });

  it('delegates a real number to the shared money formatter', () => {
    expect(usdCell(12.5)).toBe(formatUsd(12.5));
    // Zero is a measurement, not an absence (DL-15.6).
    expect(usdCell(0)).toBe(formatUsd(0));
  });
});

describe('ESTIMATE_NOTE', () => {
  it('names the estimate and carries the pricing snapshot date', () => {
    expect(ESTIMATE_NOTE).toContain('estimated at API prices');
    // Interpolated, never hardcoded: a pricing refresh must not fail a test.
    expect(ESTIMATE_NOTE).toContain(PRICING_SNAPSHOT_DATE);
  });

  it('never claims more than the data supports', () => {
    expect(ESTIMATE_NOTE).not.toContain('machine-wide');
    expect(ESTIMATE_NOTE).not.toContain('all-time');
  });
});
