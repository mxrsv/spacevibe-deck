import { describe, expect, it } from 'vitest';
import {
  addCounters,
  EMPTY_COUNTERS,
  EMPTY_USAGE_SNAPSHOT,
  totalTokens,
  type UsageCounters,
} from './usage-snapshot';

const counters = (patch: Partial<UsageCounters> = {}): UsageCounters => ({
  inputUncached: 1,
  cacheRead: 2,
  cacheCreate5m: 3,
  cacheCreate1h: 4,
  cacheWrite: 5,
  output: 6,
  ...patch,
});

describe('EMPTY_COUNTERS', () => {
  it('is the additive identity on both sides', () => {
    expect(addCounters(counters(), EMPTY_COUNTERS)).toEqual(counters());
    expect(addCounters(EMPTY_COUNTERS, counters())).toEqual(counters());
  });

  it('totals zero', () => {
    expect(totalTokens(EMPTY_COUNTERS)).toBe(0);
  });
});

describe('addCounters', () => {
  it('sums every counter class separately', () => {
    expect(addCounters(counters(), counters())).toEqual({
      inputUncached: 2,
      cacheRead: 4,
      cacheCreate5m: 6,
      cacheCreate1h: 8,
      cacheWrite: 10,
      output: 12,
    });
  });

  it('returns a new object and mutates neither argument', () => {
    const left = counters();
    const right = counters({ output: 0 });
    const sum = addCounters(left, right);

    expect(sum).not.toBe(left);
    expect(sum).not.toBe(right);
    expect(left).toEqual(counters());
    expect(right).toEqual(counters({ output: 0 }));
  });
});

describe('totalTokens', () => {
  it('adds all six classes', () => {
    expect(totalTokens(counters())).toBe(21);
  });

  it('counts a Codex-shaped bucket once, not twice', () => {
    // usage.rs stores input_uncached = input - cached, so a Codex event with
    // input 100 of which 40 were cached becomes 60 + 40 and totals 100.
    expect(
      totalTokens(
        counters({
          inputUncached: 60,
          cacheRead: 40,
          cacheCreate5m: 0,
          cacheCreate1h: 0,
          cacheWrite: 0,
          output: 0,
        }),
      ),
    ).toBe(100);
  });
});

describe('EMPTY_USAGE_SNAPSHOT', () => {
  it('still carries both sources, so the two-entry invariant always holds', () => {
    expect(EMPTY_USAGE_SNAPSHOT.sources).toEqual([
      { agent: 'claude', state: 'missing', filesScanned: 0 },
      { agent: 'codex', state: 'missing', filesScanned: 0 },
    ]);
  });

  it('has no buckets, no skipped lines and no scan time', () => {
    expect(EMPTY_USAGE_SNAPSHOT.buckets).toEqual([]);
    expect(EMPTY_USAGE_SNAPSHOT.skippedLines).toBe(0);
    expect(EMPTY_USAGE_SNAPSHOT.scannedAtMs).toBe(0);
  });
});
