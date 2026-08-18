// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The screen pulls in Tauri-backed stores through its sections; stub them so
// the component tree mounts under jsdom.
vi.mock('../../host/store-host', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      loadState: { state: 'ready', fresh: false },
    })),
  },
}));
vi.mock('../../host/dialog-host', () => ({
  open: vi.fn(async () => null),
  ask: vi.fn(async () => true),
}));
vi.mock('../../lib/native-notification', () => ({
  requestAgentNotificationPermission: vi.fn(),
}));
vi.mock('../../chrome/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chrome/events')>();
  return {
    ...actual,
    reportPersistError: vi.fn(),
  };
});

import { SettingsScreen } from './settings-screen';
import { activeCategory } from './active-category-store';
import { SETTINGS_CATEGORIES } from './settings-categories';
import { settingsLoadState } from '../../settings/settings-store';

describe('SettingsScreen — Escape / focus (M2)', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    activeCategory.value = 'appearance';
    settingsLoadState.value = { status: 'ready' };
  });

  // Unmount so the screen's window keydown listener is removed between tests —
  // a leaked listener from a prior instance would fire on the next dispatch.
  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (open: boolean, onClose = vi.fn()): (() => void) => {
    act(() => {
      render(<SettingsScreen open={open} onClose={onClose} />, host);
    });
    return onClose;
  };

  it('moves focus onto the close pill when it opens', () => {
    mount(true);
    expect(document.activeElement).toBe(host.querySelector('.settings-screen__esc'));
  });

  it('Escape closes the screen when focus is not in a terminal', () => {
    const onClose = mount(true);
    act(() => {
      (document.activeElement ?? window).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does NOT close the screen when a terminal owns focus (vim/fzf)', () => {
    const onClose = mount(true);

    // Simulate a focused xterm sitting behind the surface.
    const term = document.createElement('div');
    term.className = 'xterm';
    const textarea = document.createElement('textarea');
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once closed', () => {
    const onClose = mount(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps a settings load failure visible with a retry action', () => {
    settingsLoadState.value = {
      status: 'error',
      message: "Couldn't load settings. Defaults are temporary and won't overwrite settings.json.",
    };
    mount(true);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load settings.");
    expect(alert?.querySelector('button')?.textContent).toMatch(/retry/i);
  });
});

/**
 * The guarantee the whole relocation rests on: moving rows from one scrolling
 * drawer into five separate panels must not quietly lose one. Eyeballing a
 * screenshot cannot prove this — a row can only be seen once its category is
 * selected, so the check has to walk every category.
 *
 * The expected list is written out by hand, not derived from the registry:
 * a list generated from the same source it verifies would agree with itself
 * even after a row is dropped.
 */
const EXPECTED_ROWS = [
  // appearance. The theme itself is no longer a row: it became the gallery
  // grid (DL-24), which this walk cannot see because it counts `cfg-row`
  // labels. `theme-gallery.test.tsx` owns the cards; these two are the rows
  // the gallery brought with it.
  'Import theme',
  'Themes folder',
  // The colour overrides are an appearance group since 2026-08-16, not their
  // own rail category.
  'Background',
  'Foreground',
  'Cursor',
  'Selection',
  'Font',
  'Font size',
  'Terminal renderer',
  'App logo',
  'Tab bar position',
  'Show pane bar',
  'Show status bar',
  'Sidebar banner',
  // browser
  'Home address',
  // terminal
  'Scrollback',
  // agents (built-ins are locked rows; declared ones are added by the user)
  'Claude Code',
  'Codex',
  'Gemini CLI',
  'OpenCode',
  'Antigravity',
  'Add agent',
  'Token usage',
  // links & editor
  'Editor',
  // notifications
  'Agent notifications',
  'Restore sessions on launch',
  // about
  'Check for updates',
  'Release notes',
  // rail foot, reachable from every category
  'Restore defaults',
] as const;

/**
 * The Shortcuts category is deliberately OUT of `EXPECTED_ROWS`.
 *
 * This test asks one question — did every setting survive the move out of the
 * old drawer — and its answer is a fixed list. Shortcut rows are generated
 * from `ACTION_REGISTRY`, so folding them in would mean re-listing ~50 action
 * names here and re-editing this test on every new action, turning a
 * regression check into a transcription chore. Their own coverage
 * (`shortcuts-section.test.tsx`, `shortcut-groups.test.ts`) asserts the far
 * stronger property: that every registry action gets a row.
 */
const isShortcutRow = (label: Element): boolean => label.closest('.cfg-row--shortcut') !== null;

describe('SettingsScreen — every setting survived the move', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    activeCategory.value = 'appearance';
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  it('reaches all 29 rows by walking the rail', () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const seen = new Set<string>();
    const collect = (): void => {
      for (const label of host.querySelectorAll('.cfg-row__label')) {
        if (isShortcutRow(label)) {
          continue;
        }
        const text = label.textContent?.trim();
        if (text !== undefined && text !== '') {
          seen.add(text);
        }
      }
    };

    collect();
    for (const tab of host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      act(() => {
        tab.click();
      });
      collect();
    }

    expect([...seen].sort()).toEqual([...EXPECTED_ROWS].sort());
  });

  it('visits every registered category on the walk', () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(SETTINGS_CATEGORIES.length);

    const visited: string[] = [];
    for (const tab of tabs) {
      act(() => {
        tab.click();
      });
      visited.push(activeCategory.value);
    }
    expect(visited).toEqual(SETTINGS_CATEGORIES.map((c) => c.id));
  });

  it('wires the tab/panel ARIA pair so the panel is announced with its tab', () => {
    act(() => {
      render(<SettingsScreen open onClose={vi.fn()} />, host);
    });

    const panel = host.querySelector('[role="tabpanel"]');
    const selectedTab = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(panel).not.toBeNull();
    expect(selectedTab).not.toBeNull();
    // Every tab must control a panel that exists, and the live panel must name
    // the tab that is actually selected.
    for (const tab of host.querySelectorAll('[role="tab"]')) {
      expect(tab.getAttribute('aria-controls')).toBe(panel?.id);
    }
    expect(panel?.getAttribute('aria-labelledby')).toBe(selectedTab?.id);
  });
});
