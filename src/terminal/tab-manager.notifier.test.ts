// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneProcessInfo } from '../lib/process-info';
import type { CreatePaneFn } from './pane-lifecycle';
import { createMemoryPtyClient } from './pty-client';
import { createTabManager } from './tab-manager';
import { agentQuickPickerOpen } from '../chrome/events';
import { activeTabIndex, tabViews } from './tabs-store';
import { settings } from '../settings/settings-store';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';
import { sendAgentNotification } from '../lib/native-notification';
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from '../lib/platform';
import {
  fakeNotifierSpy,
  fakePane,
  flush,
  freshWindowFocusController,
  processInfo,
  setup,
  setupControllable,
} from './tab-manager.fixtures';

// Task 23: the production-default notifier sends through this adapter. Mock
// it at the module boundary so NO test can ever reach the real Tauri
// `@tauri-apps/plugin-notification` API, regardless of the
// `agentNotifications` setting's value at the time.
vi.mock('../lib/native-notification', () => ({
  sendAgentNotification: vi.fn(),
}));

// init() installs the file-drop listener, which reaches into the Tauri window
// and webview. Stub them so init() can register the pty output listener the
// unread tracking hangs off of. `getCurrentWindow` is also how Task 11 reads
// initial focus + subscribes to focus changes — the controller below lets
// each test steer `isFocused()`/`onFocusChanged()` (resolve, reject, or fire
// a focus change) without re-mocking the module per test.
// Local to this file, not imported from tab-manager.fixtures.ts: `beforeEach`
// below reassigns `windowFocus`, and an ES import is a read-only live
// binding — reassigning it from outside its declaring module isn't legal.
// Do not "deduplicate" this into the fixtures module; it would break every
// beforeEach in every split file that has one of these blocks.
let windowFocus = freshWindowFocusController();
const windowCloseCalls: number[] = [];

vi.mock('../host/window-host', () => ({
  // `getCurrentWindow` and `getCurrentWebview` were separate Tauri modules and
  // are now one facade, so a single factory must supply both — two vi.mock
  // calls for the same path would silently keep only the last.
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    // The last tab now closes THIS window rather than quitting the app
    // (spec §9.5). Recorded so the close-routing test can assert it.
    close: async () => {
      windowCloseCalls.push(Date.now());
    },
    isFocused: async () => {
      if (windowFocus.isFocusedError) {
        throw windowFocus.isFocusedError;
      }
      return windowFocus.initialFocused;
    },
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      if (windowFocus.onFocusChangedError) {
        throw windowFocus.onFocusChangedError;
      }
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({
    platform: 'macos',
    homeDir: '/Users/dev',
  });
  document.body.innerHTML = '';
  tabViews.value = [];
  activeTabIndex.value = 0;
  windowFocus = freshWindowFocusController();
  // Task 23: reset the live setting the production-default notifier reads,
  // and clear the mocked native adapter so per-test call counts start fresh.
  settings.value = DEFAULT_SETTINGS;
  vi.mocked(sendAgentNotification).mockClear();
});

// `newTab()` (the "new-tab" action) flips this module signal — a global
// reset, not a per-describe one like `boardOpen`'s scattered resets in the
// action-dispatch/chord-actions split files, because leaving it true after
// whichever test exercises "new-tab" would silently rank every later test's
// `openOverlayRanks()` at "modal", failing unrelated pane-tiered assertions
// with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
});

// Task 23: wiring the notifier into TabManager. Every non-null tracker
// snapshot from a real transition routes through ONE choke point
// (`maybeNotify`); the notifier itself owns the enabled/focus/dedupe policy.
describe('createTabManager notifier deps (Task 23)', () => {
  it('compiles and constructs with the 3rd arg omitted', () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement('div');
    document.body.appendChild(host);

    expect(() => createTabManager(host, pty)).not.toThrow();
  });

  it('compiles and constructs with only { createPane }', () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const createPane: CreatePaneFn = (id, _settings, events) => fakePane(id, events);

    expect(() => createTabManager(host, pty, { createPane })).not.toThrow();
  });

  it('compiles and constructs with { createPane, notifier }', () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const createPane: CreatePaneFn = (id, _settings, events) => fakePane(id, events);
    const { notifier } = fakeNotifierSpy();

    expect(() => createTabManager(host, pty, { createPane, notifier })).not.toThrow();
  });
});

describe('createTabManager notifier — production default reads the setting LIVE (Task 23)', () => {
  it('does not send while agentNotifications is off, then sends once flipped on — without reconstructing the manager', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    // Window starts backgrounded so only the `agentNotifications` setting
    // gates the send below — isolates the "read live" behavior under test.
    windowFocus.initialFocused = false;
    const { tm, pty, emitSignal } = setup({ infos }); // no injected notifier
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    // `agentNotifications` defaults to false (beforeEach resets it) — a real
    // actionable, backgrounded transition must NOT send.
    emitSignal(1, { kind: 'requested', source: 'osc-notification' });
    expect(tabViews.value[0].attention?.kind).toBe('requested');
    expect(sendAgentNotification).not.toHaveBeenCalled();

    // Flip the setting AFTER construction — a captured startup snapshot of
    // `agentNotifications` would stay false and this would still not send.
    settings.value = { ...settings.value, agentNotifications: true };

    // A higher-severity transition on the same pane — genuinely new revision.
    pty.emitOutput(1, '\x1b]9;4;2\x07'); // error
    expect(tabViews.value[0].attention?.kind).toBe('error');

    expect(sendAgentNotification).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(sendAgentNotification).mock.calls[0][0];
    expect(payload.title).toBe('repo');
    expect(payload.body).toBe('claude error');

    tm.dispose();
  });
});

describe('createTabManager notifier integration — fake notifier (Task 23)', () => {
  it('routes a background agent→shell completion transition through maybeNotify once, with the right paneId/kind/labels', async () => {
    vi.useFakeTimers();
    try {
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      ]);
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)

      pty.emitOutput(1, '\x1b]9;4;1\x07'); // working
      maybeNotify.mockClear(); // discard the gate-open + working calls (kind "none")

      infoByPane.set(1, processInfo(1, '/repo', 'zsh', 'idle-shell', null)); // foreground process becomes the shell
      await vi.advanceTimersByTimeAsync(2000); // poll closes the gate → inferred completion

      expect(maybeNotify).toHaveBeenCalledTimes(1);
      const n = maybeNotify.mock.calls[0][0];
      expect(n.paneId).toBe(1);
      expect(n.kind).toBe('completed');
      expect(n.workspaceLabel).toBe('repo');
      expect(n.agentLabel).toBe('claude');

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a transition through maybeNotify even while the window is foreground — window-focus gating is the notifier's job, not TabManager's", async () => {
    vi.useFakeTimers();
    try {
      // windowFocus stays at its default (focused) — the "foreground" case.
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      ]);
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);

      pty.emitOutput(1, '\x1b]9;4;1\x07');
      maybeNotify.mockClear();

      infoByPane.set(1, processInfo(1, '/repo', 'zsh', 'idle-shell', null));
      await vi.advanceTimersByTimeAsync(2000);

      // Routed regardless of window focus — a real notifier would gate this
      // on `isWindowFocused()`, but this fake proves TabManager itself
      // never pre-filters on focus before the choke point.
      expect(maybeNotify).toHaveBeenCalledTimes(1);
      expect(maybeNotify.mock.calls[0][0].kind).toBe('completed');

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes a warning transition through maybeNotify with kind "warning"', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call (kind "none")

    pty.emitOutput(1, '\x1b]9;4;4\x07'); // warning

    expect(maybeNotify).toHaveBeenCalledTimes(1);
    const n = maybeNotify.mock.calls[0][0];
    expect(n.paneId).toBe(1);
    expect(n.kind).toBe('warning');
    expect(n.workspaceLabel).toBe('repo');

    tm.dispose();
  });

  it('does not call maybeNotify for ordinary output with no attention transition', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call

    // A single isolated chunk never crosses the sustained-output heuristic —
    // no activity transition, so the tracker is never even touched.
    pty.emitOutput(1, 'plain agent output, no OSC markers, no sustained streak');

    expect(maybeNotify).not.toHaveBeenCalled();

    tm.dispose();
  });

  it('prunes the notifier alongside the tracker when a tab closes', async () => {
    const { notifier, prune } = fakeNotifierSpy();
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/a', 'zsh', 'idle-shell', null)],
    ]);
    const { tm } = setup({ infos, deps: { notifier } });
    await tm.materialize({ layout: null, cwds: ['/a'] });

    await tm.closeTab(0);

    expect(prune).toHaveBeenCalledWith([]);

    tm.dispose();
  });
});

// Whole-branch review bugfix: dedupe on the ATTENTION LATCH IDENTITY, not raw
// tracker revision. The tracker bumps `revision` on ANY visible-signature
// change (including a phase-only re-emit of an already-latched kind), so
// routing every non-null snapshot straight to the notifier double/triple-
// fires for one real attention event (agent→shell poll, then pty:exit).
describe('createTabManager notifier — dedupe on attention latch identity, not raw revision', () => {
  it('does not re-notify when a latched error re-emits on a phase-only agent→shell poll, then again on pty:exit', async () => {
    vi.useFakeTimers();
    try {
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      ]);
      windowFocus.initialFocused = false; // background
      settings.value = { ...settings.value, agentNotifications: true };
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)
      maybeNotify.mockClear(); // discard the gate-open call (kind "none")

      pty.emitOutput(1, '\x1b]9;4;2\x07'); // error latches — the one real event
      expect(maybeNotify).toHaveBeenCalledTimes(1);
      expect(maybeNotify.mock.calls[0][0].kind).toBe('error');

      // agent→shell poll: phase working→idle, error stays latched — a
      // phase-only re-emit of the SAME latched kind, not a new event.
      infoByPane.set(1, processInfo(1, '/repo', 'zsh', 'idle-shell', null));
      await vi.advanceTimersByTimeAsync(2000);

      // pty:exit: phase→exited, attention unchanged — another phase-only
      // re-emit of the same latched error.
      pty.emitExit(1);

      // Exactly one notification total for this one error.
      expect(maybeNotify).toHaveBeenCalledTimes(1);

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies again for a genuinely new error raised after the previous one was acknowledged', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    windowFocus.initialFocused = false; // background
    settings.value = { ...settings.value, agentNotifications: true };
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty, focusPaneDirectly } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call (kind "none")

    pty.emitOutput(1, '\x1b]9;4;2\x07'); // first error — background, notified
    expect(maybeNotify).toHaveBeenCalledTimes(1);
    expect(maybeNotify.mock.calls[0][0].kind).toBe('error');

    // Window regains foreground, user focuses the pane — acknowledges it.
    windowFocus.emitFocusChanged?.(true);
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).not.toBe('error'); // sanity: cleared

    // Backgrounded again; a genuinely NEW error on the same pane must notify.
    windowFocus.emitFocusChanged?.(false);
    pty.emitOutput(1, '\x1b]9;4;2\x07');

    expect(maybeNotify).toHaveBeenCalledTimes(2);
    expect(maybeNotify.mock.calls[1][0].kind).toBe('error');

    tm.dispose();
  });

  it('notifies twice for an escalation from warning to error on the same pane', async () => {
    windowFocus.initialFocused = false; // background
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear();

    pty.emitOutput(1, '\x1b]9;4;4\x07'); // warning latches
    pty.emitOutput(1, '\x1b]9;4;2\x07'); // escalates to error

    expect(maybeNotify).toHaveBeenCalledTimes(2);
    expect(maybeNotify.mock.calls[0][0].kind).toBe('warning');
    expect(maybeNotify.mock.calls[1][0].kind).toBe('error');

    tm.dispose();
  });

  it("does not re-notify when a latched warning's phase flips working→idle with no attention change", async () => {
    windowFocus.initialFocused = false; // background
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear();

    pty.emitOutput(1, '\x1b]9;4;4\x07'); // warning latches, phase working
    expect(maybeNotify).toHaveBeenCalledTimes(1);

    pty.emitOutput(1, '\x1b]9;4;0\x07'); // phase clears to idle, warning stays latched
    expect(tabViews.value[0].attention?.kind).toBe('warning'); // sanity: still latched

    expect(maybeNotify).toHaveBeenCalledTimes(1); // no re-notify on phase-only change

    tm.dispose();
  });
});
