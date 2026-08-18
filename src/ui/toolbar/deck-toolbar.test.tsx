// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckToolbar, toolbarLabel } from './deck-toolbar';

/**
 * The shipping projection: registry actions in, `ToolbarItem`s out, both
 * layouts mounting the same element. What matters here is the boundary work —
 * label re-casing (D6), the D7 group contents, unavailable-not-disabled for
 * Prompts, and the two presentation carriers (`iconbtn--gear`, the anchored
 * popover) surviving the move off `ChromeActions`.
 */
describe('DeckToolbar', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  const handlers = () => ({
    onToggleBrowser: vi.fn(),
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onToggleExpand: vi.fn(),
    onClosePane: vi.fn(),
    onTogglePrompts: vi.fn(),
    onToggleSettings: vi.fn(),
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const on = handlers();
    act(() =>
      render(
        <DeckToolbar
          browserActive={false}
          // Defaults to the host every release still ships (no `sessions_list`),
          // which is also what keeps the D7 label list below exhaustive.
          settingsOpen={false}
          expandActive={false}
          promptsOpen={false}
          promptsUnavailable={null}
          {...on}
          {...overrides}
        />,
        host,
      ),
    );
    return on;
  }

  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.getAttribute('aria-label') === name,
    );
    if (found === undefined) {
      throw new Error(`no button named ${name}`);
    }
    return found;
  };

  it('re-cases registry labels to sentence case and drops menu ellipses', () => {
    expect(toolbarLabel('split-row')).toBe('Split vertically');
    expect(toolbarLabel('toggle-settings')).toBe('Settings');
    expect(toolbarLabel('toggle-prompts')).toBe('Prompts');
    expect(toolbarLabel('toggle-browser')).toBe('Browser');
    expect(toolbarLabel('toggle-usage')).toBe('Token usage');
    expect(toolbarLabel('toggle-explorer')).toBe('Explorer');
  });

  // Shrunk twice on 2026-08-16. First File explorer, Token usage and Session
  // history left the bar for the docked side panel, which carries its own tab
  // row. Then the pane group moved into `More` (DL-23.8), leaving the bar with
  // exactly one control. Browser, Prompts and Settings never rode here at all:
  // they became rows in the rail's footer (DL-28.3), and top-tab mode stands
  // the same rows up in `More`. Mounting them here too would put a second
  // Prompt Board popover on screen at the same time as the footer's.
  it('draws the More control and nothing else', () => {
    mount();
    const labels = Array.from(host.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['More actions']);
  });

  it('carries the whole pane group as named rows inside More', () => {
    const on = mount();
    act(() => button('More actions').click());

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    );
    // The pane group leads, and the global group follows it in BOTH layouts
    // since 2026-08-17: `SIDEBAR_TOOLS_HIDDEN` took the rail's footer away, so
    // `More` is the only place left for those rows — and the only anchor the
    // Prompt Board popover has. Restoring the footer drops the last three.
    expect(rows.map((row) => row.querySelector('.toolbar-menu__label')?.textContent)).toEqual([
      'Split vertically',
      'Split horizontally',
      'Focus expand',
      'Close pane',
      'Browser',
      'Prompts',
      'Settings',
    ]);

    // A row runs the same callback the icon used to, so the command path the
    // keyboard and the native menu take is untouched by the move.
    act(() => (rows[3] as HTMLButtonElement).click());
    expect(on.onClosePane).toHaveBeenCalledTimes(1);
  });

  it('renders no history control on a host without session history', () => {
    const labels = Array.from(host.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).not.toContain('Session history');
  });

  it("hands the window's free width back as a drag surface", () => {
    mount();
    expect(host.querySelector('.ftoolbar__drag')).not.toBeNull();
  });
  it('stands the global pair up in More when the layout is compact', () => {
    mount({ compact: true });
    const more = button('More actions');

    act(() => more.click());

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
    ).map((row) => row.textContent);
    expect(rows?.some((row) => row?.includes('Browser'))).toBe(true);
    expect(rows?.some((row) => row?.includes('Prompts'))).toBe(true);
    expect(rows?.some((row) => row?.includes('Settings'))).toBe(true);
  });

  // The bar itself must never carry them, in either layout — that is what
  // keeps a second Prompt Board popover off the screen.
  it("never puts the rail's own rows on the bar", () => {
    for (const compact of [true, false]) {
      mount({ compact });
      const labels = Array.from(host.querySelectorAll('.ftoolbar > * button'))
        .map((b) => b.getAttribute('aria-label'))
        .filter((label) => label !== 'More actions');
      expect(labels).not.toContain('Prompts');
      expect(labels).not.toContain('Settings');
      expect(labels).not.toContain('Browser');
    }
  });
});
