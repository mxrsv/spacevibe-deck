import { describe, expect, it } from 'vitest';
import { estimateCostUsd, formatUsd, isPricedModel } from './usage-pricing';
import { EMPTY_COUNTERS, type UsageCounters } from './usage-snapshot';

const counters = (patch: Partial<UsageCounters> = {}): UsageCounters => ({
  ...EMPTY_COUNTERS,
  ...patch,
});

describe('isPricedModel', () => {
  it('recognises a model in the snapshot', () => {
    expect(isPricedModel('claude-opus-5')).toBe(true);
    expect(isPricedModel('gpt-5.6-sol')).toBe(true);
  });

  it("rejects an unknown model and Claude Code's synthetic marker", () => {
    expect(isPricedModel('claude-from-the-future')).toBe(false);
    expect(isPricedModel('<synthetic>')).toBe(false);
  });

  it('does not mistake an Object.prototype key for a model', () => {
    // PRICING_SNAPSHOT is an object literal, so it inherits `toString` and
    // friends. Plain indexing would return a function here.
    expect(isPricedModel('toString')).toBe(false);
    expect(isPricedModel('constructor')).toBe(false);
  });

  it('matches exactly — no prefix or alias fallback in v1', () => {
    expect(isPricedModel('claude-opus-5-20260801')).toBe(false);
    expect(isPricedModel('opus')).toBe(false);
  });
});

describe('estimateCostUsd', () => {
  it('prices every counter class at its own rate', () => {
    // claude-opus-5: input 5e-6, output 2.5e-5, cacheRead 5e-7, cacheWrite 6.25e-6
    //   1000 * 5e-6      = 0.005
    // + 2000 * 5e-7      = 0.001
    // + 3000 * 6.25e-6   = 0.01875
    // + 4000 * 1e-5      = 0.04     (1h = input * 2)
    // + 5000 * 2.5e-5    = 0.125
    expect(
      estimateCostUsd(
        'claude-opus-5',
        counters({
          inputUncached: 1000,
          cacheRead: 2000,
          cacheCreate5m: 3000,
          cacheCreate1h: 4000,
          output: 5000,
        }),
      ),
    ).toBeCloseTo(0.18975, 10);
  });

  it('charges the 1h cache tier at twice the input rate', () => {
    const oneHour = estimateCostUsd('claude-opus-5', counters({ cacheCreate1h: 1000 }));
    const uncached = estimateCostUsd('claude-opus-5', counters({ inputUncached: 1000 }));

    expect(oneHour).not.toBeNull();
    expect(uncached).not.toBeNull();
    expect(oneHour).toBeCloseTo((uncached ?? 0) * 2, 12);
  });

  it('falls back to the input rate when no cache-write rate is published', () => {
    // gpt-5.5: input 5e-6, output 3e-5, cacheRead 5e-7, cacheWrite null
    //   1000 * 5e-6   = 0.005
    // + 1000 * 5e-7   = 0.0005
    // + 1000 * 5e-6   = 0.005    (cacheWrite falls back to input)
    // + 1000 * 3e-5   = 0.03
    expect(
      estimateCostUsd(
        'gpt-5.5',
        counters({
          inputUncached: 1000,
          cacheRead: 1000,
          cacheWrite: 1000,
          output: 1000,
        }),
      ),
    ).toBeCloseTo(0.0405, 10);
  });

  it('returns null for an unknown model rather than guessing', () => {
    expect(estimateCostUsd('claude-from-the-future', counters({ output: 1 }))).toBeNull();
    expect(estimateCostUsd('toString', counters({ output: 1 }))).toBeNull();
  });

  it('costs zero tokens at zero dollars, whatever the model is', () => {
    // Claude Code writes 138 `<synthetic>` usage lines on this machine, every
    // one of them all-zero. Returning null for those would make the whole
    // Claude column read "—" forever.
    expect(estimateCostUsd('<synthetic>', EMPTY_COUNTERS)).toBe(0);
    expect(estimateCostUsd('claude-opus-5', EMPTY_COUNTERS)).toBe(0);
  });
});

describe('formatUsd', () => {
  it('renders zero as the canonical two-decimal zero', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('uses four decimals below a cent so a cheap day is not $0.00', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.0001)).toBe('$0.0001');
  });

  it("says 'less than' rather than rounding a real cost to zero", () => {
    expect(formatUsd(0.00004)).toBe('< $0.0001');
  });

  it('uses two decimals and grouping from a cent upwards', () => {
    expect(formatUsd(0.01)).toBe('$0.01');
    expect(formatUsd(12.3456)).toBe('$12.35');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('does not print NaN or Infinity at the user', () => {
    expect(formatUsd(Number.NaN)).toBe('$0.00');
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });
});
