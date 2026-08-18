// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryPtyClient } from './pty-client';
import { settings } from '../settings/settings-store';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';
import { workspacesData } from '../open-board/workspaces-store';
import { WORKSPACES_VERSION } from '../lib/workspace-recents';
import { activeTabIndex, tabViews } from './tabs-store';
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from '../lib/platform';
import { freshWindowFocusController, wire } from './tab-manager.fixtures';

vi.mock('../lib/native-notification', () => ({
  sendAgentNotification: vi.fn(),
}));

// See tab-manager.materialize.test.ts: `init()` is not called here, but the
// window facade is imported at module load and must exist regardless.
let windowFocus = freshWindowFocusController();

vi.mock('../host/window-host', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

/**
 * `dropAgentPane` is the only agent launch that adds a pane to a LIVE tab, so
 * these tests pin the two things that separates it from `openQuickAgent`: no
 * tab is created, and the agent comes from the workspace's memory rather than
 * from a picker.
 */
describe('createTabManager dropAgentPane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settings.value = DEFAULT_SETTINGS;
    windowFocus = freshWindowFocusController();
    initializeDesktopEnvironment({ platform: 'macos', homeDir: '/Users/dev' });
    document.body.innerHTML = '';
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    tabViews.value = [];
    activeTabIndex.value = -1;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopEnvironmentForTests();
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  });

  function build(agents: readonly { name: string; path: string }[]) {
    const pty = createMemoryPtyClient({ nextId: 1, agents });
    return { pty, ...wire(pty) };
  }

  it("docks a pane into the active tab and types the workspace's remembered agent", async () => {
    const { tm, pty } = build([{ name: 'codex', path: '/bin/codex' }]);
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: '/work', lastOpenedAt: 1, lastAgent: 'codex' }],
    };
    await tm.openFromPreset({ type: 'leaf' }, ['/work'], {
      workspacePath: '/work',
      agent: null,
    });
    const tabCount = tabViews.value.length;

    const ok = await tm.dropAgentPane(1, 'right');
    await vi.advanceTimersByTimeAsync(3000);

    expect(ok).toBe(true);
    // A pane joined the tab; no tab was created.
    expect(tabViews.value.length).toBe(tabCount);
    expect(tm.allPaneIds()).toEqual([1, 2]);
    expect(pty.writes).toEqual([{ id: 2, data: 'codex\r' }]);
    tm.dispose();
  });

  it('falls back to the first detected agent for a workspace with no memory', async () => {
    const { tm, pty } = build([
      { name: 'claude', path: '/bin/claude' },
      { name: 'codex', path: '/bin/codex' },
    ]);
    await tm.openFromPreset({ type: 'leaf' }, ['/fresh'], {
      workspacePath: '/fresh',
      agent: null,
    });

    await tm.dropAgentPane(1, 'bottom');
    await vi.advanceTimersByTimeAsync(3000);

    // BUILTIN_AGENTS order, not probe order — `agentOptions` decides both.
    expect(pty.writes).toEqual([{ id: 2, data: 'claude\r' }]);
    tm.dispose();
  });

  it('opens a plain shell when nothing is detected, on the side that was dropped on', async () => {
    const { tm, pty } = build([]);
    await tm.openFromPreset({ type: 'leaf' }, ['/work'], {
      workspacePath: '/work',
      agent: null,
    });

    await tm.dropAgentPane(1, 'left');
    await vi.advanceTimersByTimeAsync(3000);

    // `[2, 1]`, not `[1, 2]`: a "left" drop puts the new pane FIRST, which is
    // exactly what `splitLeaf` could not express and `dockNewPane` can.
    expect(tm.allPaneIds()).toEqual([2, 1]);
    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it('creates nothing when the target pane is not in the active tab', async () => {
    const { tm, pty } = build([{ name: 'claude', path: '/bin/claude' }]);
    await tm.openFromPreset({ type: 'leaf' }, ['/work'], {
      workspacePath: '/work',
      agent: null,
    });

    const ok = await tm.dropAgentPane(99, 'right');
    await vi.advanceTimersByTimeAsync(3000);

    expect(ok).toBe(false);
    expect(tm.allPaneIds()).toEqual([1]);
    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it('reports no slot rects when there is no tab', () => {
    const { tm } = build([]);
    expect(tm.activeSlotRects()).toEqual([]);
    tm.dispose();
  });

  it('collapses the slot list to the zoomed pane while a pane is zoomed', async () => {
    const { tm } = build([]);
    await tm.openFromPreset(
      {
        type: 'split',
        direction: 'row',
        ratio: 0.5,
        first: { type: 'leaf' },
        second: { type: 'leaf' },
      },
      ['/work', '/work'],
      { workspacePath: '/work', agent: null },
    );

    expect(tm.activeSlotRects().map((rect) => rect.id)).toEqual([1, 2]);

    // Zoom reparents the active pane (1) over the whole tab while BOTH
    // `.pane-slot` elements keep their geometry — the raw list would offer a
    // drop onto pane 2, which nobody can see.
    tm.runAction('toggle-zoom-pane');

    expect(tm.activeSlotRects().map((rect) => rect.id)).toEqual([1]);
    tm.dispose();
  });
});
