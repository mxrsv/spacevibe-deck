// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneProcessInfo } from '../lib/process-info';
import { agentQuickPickerOpen } from '../chrome/events';
import { activeTabIndex, tabViews, statusInfo } from './tabs-store';
import { settings } from '../settings/settings-store';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';
import { sendAgentNotification } from '../lib/native-notification';
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from '../lib/platform';
import {
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

describe('createTabManager attention tracker', () => {
  it('keeps per-pane tracker unread independent within one tab', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'zsh', 'idle-shell', null)],
      [2, processInfo(2, '/repo', 'zsh', 'idle-shell', null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.splitActive('row'); // pane 2 is now the focused/active pane
    await tm.init();
    await flush();

    // Output to the focused pane (2) is already seen — no per-pane unread.
    pty.emitOutput(2, 'visible');
    // Output to the unfocused pane (1) flags only its own per-pane unread.
    pty.emitOutput(1, 'hidden');

    // Exactly one of the two panes is unread → they track it independently.
    expect(tabViews.value[0].attention?.unreadCount).toBe(1);

    tm.dispose();
  });

  it('selectTab clears legacy unread; showing the tab also acknowledges its focused pane', async () => {
    // Pre-Task-11 this asserted selectTab did NOT touch tracker attention,
    // because `callbacks.onPaneFocus` didn't exist yet — `show()`'s internal
    // `pane.focus()` call (unchanged by Task 11; see plan §Task 11A) was a
    // no-op for the tracker. Task 11 wires `onPaneFocus` to `acknowledge`, so
    // that same `show()` focus call now acknowledges the tab's active pane as
    // a side effect of regaining DOM focus — not a direct selectTab→ack wire.
    // Task 11A/11B later add a non-focusing `show()` path for attention
    // navigation specifically; plain `selectTab` keeps this behavior.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/a', 'claude', 'agent', 'claude')],
      [2, processInfo(2, '/b', 'zsh', 'idle-shell', null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ['/a'] }); // tab 0 → pane 1 (claude)
    await tm.materialize({ layout: null, cwds: ['/b'] }); // tab 1 → pane 2 (active)
    await tm.init();
    await flush();

    // The background agent errors — latched attention plus legacy unread.
    pty.emitOutput(1, '\x1b]9;4;2\x07');
    expect(tabViews.value[0].attention?.kind).toBe('error');
    expect(tabViews.value[0].unread).toBe(true);

    // Opening the tab clears LEGACY unread, and its `show()`-driven pane
    // focus acknowledges pane 1's latched tracker attention too.
    tm.selectTab(0);
    expect(tabViews.value[0].unread).toBe(false);
    expect(tabViews.value[0].attention?.kind).not.toBe('error');

    tm.dispose();
  });

  it('aggregates a working→error→clear batch to error with a cleared phase', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    // One PTY chunk carrying three ordered OSC 9;4 reports.
    pty.emitOutput(1, '\x1b]9;4;1\x07mid\x1b]9;4;2\x07more\x1b]9;4;0\x07');

    expect(tabViews.value[0].attention?.kind).toBe('error');
    expect(tabViews.value[0].attention?.actionableCount).toBe(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);

    tm.dispose();
  });

  it('latches requested when a recognized agent pane signals', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, emitSignal } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    emitSignal(1, { kind: 'requested', source: 'osc-notification' });

    expect(tabViews.value[0].attention?.kind).toBe('requested');
    expect(tabViews.value[0].attention?.actionableCount).toBe(1);

    tm.dispose();
  });

  it('clears the working badge when an agent pane exits', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    pty.emitOutput(1, '\x1b]9;4;3\x07');
    expect(tabViews.value[0].attention?.workingCount).toBe(1);

    // Single-pane exit → exit limbo (no close/prune) → noteExit clears working.
    pty.emitExit(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);
    expect(tabViews.value[0].attention?.kind).not.toBe('working');

    tm.dispose();
  });

  it('prunes tracker state on pane close so no ghost badge remains', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      [2, processInfo(2, '/repo', 'zsh', 'idle-shell', null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.splitActive('row'); // pane 2 active; pane 1 is the background agent
    await tm.init();
    await flush();

    pty.emitOutput(1, '\x1b]9;4;3\x07');
    expect(tabViews.value[0].attention?.workingCount).toBe(1);

    // Pane 1 exits → auto-closed (2 panes) → pruned; no lingering working badge.
    pty.emitExit(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);
    expect(tabViews.value[0].attention?.kind).not.toBe('working');

    tm.dispose();
  });

  describe('process gate', () => {
    it('ignores OSC 9;4 error from a shell pane', async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'zsh', 'idle-shell', null)],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      pty.emitOutput(1, '\x1b]9;4;2\x07');

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.workingCount).toBe(0);
      expect(tabViews.value[0].attention?.kind).not.toBe('error');

      tm.dispose();
    });

    it('ignores sustained output from a shell pane', async () => {
      vi.useFakeTimers();
      try {
        const infos = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, '/repo', 'zsh', 'idle-shell', null)],
        ]);
        const { tm, pty } = setup({ infos });
        await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
          workspacePath: '/repo',
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0);

        pty.emitOutput(1, 'building…');
        await vi.advanceTimersByTimeAsync(500);
        pty.emitOutput(1, 'still building…');

        expect(tabViews.value[0].attention?.workingCount).toBe(0);
        expect(tabViews.value[0].attention?.actionableCount).toBe(0);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores an attention signal from a shell pane', async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'zsh', 'idle-shell', null)],
      ]);
      const { tm, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: 'requested', source: 'bell' });

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.kind).not.toBe('requested');

      tm.dispose();
    });

    it('rejects an agent-looking process label when the explicit kind is busy', async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'busy', null)],
      ]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: 'requested', source: 'bell' });
      pty.emitOutput(1, '\x1b]9;4;2\x07');

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].agentBusy).toBe(false);
      expect(statusInfo.value.agent).toBeNull();
      tm.dispose();
    });

    it.each([
      processInfo(1, '/repo', 'claude', 'agent', 'claude'),
      processInfo(1, '/repo', 'node', 'agent', 'codex'),
      processInfo(1, '/repo', 'aider', 'agent', 'Aider'),
    ])('accepts a recognized $agent agent with foreground process $process', async (info) => {
      const infos = new Map<number, PaneProcessInfo>([[1, info]]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: 'requested', source: 'bell' });
      pty.emitOutput(1, '\x1b]9;4;1\x07');

      expect(tabViews.value[0].attention?.actionableCount).toBe(1);
      expect(tabViews.value[0].agentBusy).toBe(true);
      expect(tabViews.value[0].process).toBe(info.agent);
      expect(statusInfo.value.agent).toBe(info.agent);
      tm.dispose();
    });

    it.each([
      processInfo(1, '/repo', 'node', 'busy', null),
      processInfo(1, '/repo', null, 'unknown', null),
    ])('keeps the attention gate closed for $kind snapshots', async (info) => {
      const infos = new Map<number, PaneProcessInfo>([[1, info]]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: 'requested', source: 'bell' });
      pty.emitOutput(1, '\x1b]9;4;2\x07');

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].agentBusy).toBe(false);
      tm.dispose();
    });

    it('ignores activity from a pane never recognized as an agent', async () => {
      // No infos → the poll returns nothing for pane 1, so its gate never opens.
      const { tm, pty } = setup({});
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      pty.emitOutput(1, '\x1b]9;4;2\x07');

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.workingCount).toBe(0);

      tm.dispose();
    });

    it('infers one completion on agent→shell then ignores shell activity', async () => {
      vi.useFakeTimers();
      try {
        const infoByPane = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
        ]);
        const { tm, pty } = setupControllable(infoByPane);
        await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
          workspacePath: '/repo',
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)

        pty.emitOutput(1, '\x1b]9;4;1\x07');
        expect(tabViews.value[0].attention?.workingCount).toBe(1);

        // The foreground process becomes the shell; the next poll closes the
        // gate and infers exactly one completion.
        infoByPane.set(1, processInfo(1, '/repo', 'zsh', 'idle-shell', null));
        await vi.advanceTimersByTimeAsync(2000);
        expect(tabViews.value[0].attention?.kind).toBe('completed');
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);
        expect(tabViews.value[0].attention?.workingCount).toBe(0);

        // Shell activity after the gate closed adds nothing (would be `error`).
        pty.emitOutput(1, '\x1b]9;4;2\x07');
        expect(tabViews.value[0].attention?.kind).toBe('completed');
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it('synthesizes a completed transition when heuristic-working silence outlasts the resync timer', async () => {
      // codex/gemini never emit OSC 9;4 — the ONLY signal they ever produce
      // is the sustained-output heuristic. This locks the silence-completion
      // path: the pane goes working via the heuristic, then falls fully
      // silent (no OSC clear, no further output, no poll transition) for
      // longer than the ~3200ms resync one-shot, and the tab must still
      // reach `completed` on its own.
      vi.useFakeTimers();
      try {
        const infos = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, '/repo', 'codex', 'agent', 'codex')],
        ]);
        const { tm, pty } = setup({ infos });
        await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
          workspacePath: '/repo',
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (codex)

        // One isolated chunk starts the streak but isn't sustained yet…
        pty.emitOutput(1, 'streaming tokens…');
        // …a second chunk past minStreakMs flips the heuristic to working.
        await vi.advanceTimersByTimeAsync(500);
        pty.emitOutput(1, 'more tokens…');
        expect(tabViews.value[0].attention?.kind).toBe('working');
        expect(tabViews.value[0].attention?.workingCount).toBe(1);

        // Go fully silent — no more output, no OSC clear, no process change —
        // past the resync one-shot. `activity.working` decays to false while
        // the tracker still reads "working", so the one-shot synthesizes an
        // idle transition with no new output ever having arrived.
        await vi.advanceTimersByTimeAsync(3400);

        expect(tabViews.value[0].attention?.kind).toBe('completed');
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);
        expect(tabViews.value[0].attention?.workingCount).toBe(0);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('createTabManager window focus (Task 11)', () => {
  it("acknowledges a pane's latched attention when the window starts focused", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init(); // isFocused() resolves true by default
    await flush();

    pty.emitOutput(1, '\x1b]9;4;2\x07');
    expect(tabViews.value[0].attention?.kind).toBe('error');

    // A fresh focus event on the pane (click/focusin/keyboard) acknowledges it.
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).not.toBe('error');

    tm.dispose();
  });

  it('does not acknowledge a pane focus while the window starts unfocused', async () => {
    windowFocus.initialFocused = false;
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    pty.emitOutput(1, '\x1b]9;4;2\x07');
    expect(tabViews.value[0].attention?.kind).toBe('error');

    // The pane regains DOM focus, but the window itself is still backgrounded
    // (e.g. focus bounced inside an inactive app) — no acknowledge.
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).toBe('error');

    tm.dispose();
  });

  it('treats a rejected isFocused() as focused and keeps the in-app rail working', async () => {
    windowFocus.isFocusedError = new Error('no window handle');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('isFocused'),
        windowFocus.isFocusedError,
      );

      // Fail-safe = focused: acknowledge still works.
      pty.emitOutput(1, '\x1b]9;4;2\x07');
      focusPaneDirectly(1);
      expect(tabViews.value[0].attention?.kind).not.toBe('error');

      tm.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it('still works when onFocusChanged registration rejects (native notifications suppressed)', async () => {
    windowFocus.onFocusChangedError = new Error('event API unavailable');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.init();
      await flush();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('onFocusChanged'),
        windowFocus.onFocusChangedError,
      );

      // isFocused() itself still resolved (true), so the in-app rail works —
      // only the ability to react to LATER focus changes is lost.
      pty.emitOutput(1, '\x1b]9;4;2\x07');
      focusPaneDirectly(1);
      expect(tabViews.value[0].attention?.kind).not.toBe('error');

      tm.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it('marks output unread while backgrounded and only acknowledges pane focus once the window returns', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();

    windowFocus.emitFocusChanged?.(false); // OS reports the window lost focus

    pty.emitOutput(1, 'hi from the agent');
    expect(tabViews.value[0].attention?.unreadCount).toBe(1);

    // Focus lands back on the pane while the window is still backgrounded —
    // no acknowledge yet.
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.unreadCount).toBe(1);

    windowFocus.emitFocusChanged?.(true); // the window returns to foreground
    focusPaneDirectly(1); // terminal focus now acknowledges
    expect(tabViews.value[0].attention?.unreadCount).toBe(0);

    tm.dispose();
  });

  it('does not mark output seen when a Settings-like element holds DOM focus', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
      workspacePath: '/repo',
    });
    await tm.init();
    await flush();
    focusPaneDirectly(1); // window foreground, tab active, pane DOM-focused

    // A Settings-like overlay steals DOM focus without the tab/window
    // changing — the pane stays "active" in the split tree the whole time.
    const settingsField = document.createElement('input');
    document.body.appendChild(settingsField);
    settingsField.focus();

    pty.emitOutput(1, 'output while the settings panel is open');
    expect(tabViews.value[0].attention?.unreadCount).toBe(1); // NOT seen

    settingsField.remove();
    tm.dispose();
  });

  it('acknowledges only the focused pane in a multi-pane tab', async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, '/repo', 'claude', 'agent', 'claude')],
        [2, processInfo(2, '/repo', 'claude', 'agent', 'claude')],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.init();
      await tm.openFromPreset({ type: 'leaf' }, ['/repo'], {
        workspacePath: '/repo',
      });
      await tm.splitActive('row'); // pane 2 is now the focused/active pane
      // Pane 2 was spawned after materialize's one-shot poll, so its gate is
      // still closed — advance past the periodic poll (covers every live
      // pane) so both panes' agent gate is open before emitting OSC 9;4.
      await vi.advanceTimersByTimeAsync(2000);

      pty.emitOutput(1, '\x1b]9;4;2\x07'); // background pane errors
      pty.emitOutput(2, '\x1b]9;4;2\x07'); // focused pane errors too
      expect(tabViews.value[0].attention?.actionableCount).toBe(2);

      focusPaneDirectly(2); // re-focus only pane 2
      expect(tabViews.value[0].attention?.actionableCount).toBe(1); // pane 1's stays latched

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes the window-focus listener via unlisteners', async () => {
    const { tm } = setup({});
    await tm.init();
    expect(windowFocus.unlistenFocus).not.toHaveBeenCalled();

    tm.dispose();

    expect(windowFocus.unlistenFocus).toHaveBeenCalledTimes(1);
  });
});
