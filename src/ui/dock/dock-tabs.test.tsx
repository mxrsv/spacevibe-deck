// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockTabs } from './dock-tabs';
import { DOCK_TABS, availableDockTabs } from './dock-tab-registry';

describe('DockTabs', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const getTabs = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('[role="tab"]'));

  it('renders one tab per item, in order, inside a labelled tablist', () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    const tablist = host.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.getAttribute('aria-label')).toBeTruthy();

    const tabs = getTabs();
    expect(tabs).toHaveLength(DOCK_TABS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(DOCK_TABS.map((item) => item.label));
  });

  it('marks only the active chip with is-active and aria-selected', () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="usage" onSelect={vi.fn()} />, host));

    getTabs().forEach((tab, index) => {
      const shouldBeActive = DOCK_TABS[index].id === 'usage';
      expect(tab.classList.contains('is-active')).toBe(shouldBeActive);
      expect(tab.getAttribute('aria-selected')).toBe(String(shouldBeActive));
    });
  });

  it('reports the clicked id and keeps no state of its own', () => {
    const onSelect = vi.fn();
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={onSelect} />, host));

    const tabs = getTabs();
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(DOCK_TABS[1].id);
    // Nothing repainted: the caller owns `active`, this component does not.
    expect(tabs[1].classList.contains('is-active')).toBe(false);
  });

  it('renders exactly the items it is given — a caller narrowing to two tabs sees two', () => {
    const narrowed = availableDockTabs(false);
    act(() => render(<DockTabs items={narrowed} active="explorer" onSelect={vi.fn()} />, host));

    const tabs = getTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['File explorer', 'Token usage']);
  });

  it("draws each chip's icon through DeckIcon, never a raw glyph", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    getTabs().forEach((tab) => {
      const icon = tab.querySelector('svg.feature-glyph');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('width')).toBe('15');
    });
  });
});
