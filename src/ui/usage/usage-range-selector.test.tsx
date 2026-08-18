// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activeUsageRange } from './active-usage-view-store';
import { UsageRangeSelector } from './usage-range-selector';
import { DEFAULT_USAGE_RANGE, USAGE_RANGES } from './usage-ranges';

describe('UsageRangeSelector', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    activeUsageRange.value = DEFAULT_USAGE_RANGE;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    activeUsageRange.value = DEFAULT_USAGE_RANGE;
  });

  const mount = (): void => {
    act(() => {
      render(<UsageRangeSelector />, host);
    });
  };

  const options = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('[role="tab"]'));

  it('shows every period at once, sentence-case (DL-16.7, DL-4.4)', () => {
    mount();
    // All four visible is the rule, not a layout accident: the set of
    // available comparisons is itself information.
    expect(options().map((option) => option.textContent)).toEqual([
      'Today',
      '7 days',
      '30 days',
      'All',
    ]);
    for (const option of options()) {
      expect(option.textContent).not.toBe(option.textContent?.toUpperCase());
    }
  });

  it('defaults to the whole recorded history', () => {
    mount();
    const selected = options().filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe('All');
  });

  it('marks exactly one option active, by class and by aria', () => {
    activeUsageRange.value = '7d';
    mount();
    for (const option of options()) {
      const shouldBeActive = option.textContent === '7 days';
      expect(option.classList.contains('is-active')).toBe(shouldBeActive);
      expect(option.getAttribute('aria-selected')).toBe(String(shouldBeActive));
    }
  });

  it('clicking an option selects that period', () => {
    mount();
    USAGE_RANGES.forEach((range, index) => {
      act(() => {
        options()[index].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(activeUsageRange.value).toBe(range.id);
    });
  });

  it('ArrowRight from the last option wraps to the first, focus following', () => {
    activeUsageRange.value = 'all';
    mount();
    const tabs = options();
    tabs[tabs.length - 1].focus();

    act(() => {
      tabs[tabs.length - 1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });

    expect(activeUsageRange.value).toBe('today');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('ArrowLeft from the first option wraps to the last, focus following', () => {
    activeUsageRange.value = 'today';
    mount();
    const tabs = options();
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    expect(activeUsageRange.value).toBe('all');
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
  });

  it('keeps only the selected option in the tab order', () => {
    activeUsageRange.value = '30d';
    mount();
    for (const option of options()) {
      expect(option.getAttribute('tabindex')).toBe(option.textContent === '30 days' ? '0' : '-1');
    }
  });

  it('does not swallow Escape — the screen still owns it', () => {
    mount();
    const tabs = options();
    tabs[0].focus();
    let reachedWindow = false;
    const listener = (): void => {
      reachedWindow = true;
    };
    window.addEventListener('keydown', listener);
    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', listener);
    expect(reachedWindow).toBe(true);
    expect(activeUsageRange.value).toBe(DEFAULT_USAGE_RANGE);
  });

  it('names itself for assistive tech', () => {
    mount();
    const tablist = host.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute('aria-label')).toBe('Cost range');
  });
});
