import { describe, expect, it } from 'vitest';
import { availableDockTabs, DOCK_TABS, resolveDockTab } from './dock-tab-registry';

describe('DOCK_TABS', () => {
  it('lists explorer, usage, sessions in that order', () => {
    expect(DOCK_TABS.map((tab) => tab.id)).toEqual(['explorer', 'usage', 'sessions']);
  });

  it('uses sentence-case labels (DL-4.4, §8)', () => {
    expect(DOCK_TABS.map((tab) => tab.label)).toEqual([
      'File explorer',
      'Token usage',
      'Session history',
    ]);
  });

  it('is frozen, so nothing can append, remove or reorder it at runtime', () => {
    expect(Object.isFrozen(DOCK_TABS)).toBe(true);
  });
});

describe('availableDockTabs', () => {
  it('returns all three tabs when sessions is available', () => {
    expect(availableDockTabs(true).map((tab) => tab.id)).toEqual(['explorer', 'usage', 'sessions']);
  });

  it('drops sessions entirely — not disabled, not shown — when unavailable', () => {
    const tabs = availableDockTabs(false);
    expect(tabs.map((tab) => tab.id)).toEqual(['explorer', 'usage']);
    expect(tabs.some((tab) => tab.id === 'sessions')).toBe(false);
  });
});

describe('resolveDockTab', () => {
  it('returns the requested tab when it is available', () => {
    expect(resolveDockTab('usage', true)).toBe('usage');
    expect(resolveDockTab('sessions', true)).toBe('sessions');
  });

  it('falls back to explorer when the requested tab is unavailable', () => {
    expect(resolveDockTab('sessions', false)).toBe('explorer');
  });

  it('resolves explorer to itself regardless of sessions availability', () => {
    expect(resolveDockTab('explorer', false)).toBe('explorer');
    expect(resolveDockTab('explorer', true)).toBe('explorer');
  });
});
