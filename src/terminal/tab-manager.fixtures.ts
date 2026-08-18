import { vi } from 'vitest';
import type { PaneProcessInfo } from '../lib/process-info';
import type { Pane, PaneEvents, PaneAttentionSignal } from './pane';
import type { CreatePaneFn } from './pane-lifecycle';
import { createMemoryPtyClient, type PtyClient } from './pty-client';
import { createTabManager, type TabManager, type TabManagerDeps } from './tab-manager';
import type { AgentNotifier, AttentionNotification } from './agent-notifier';

/**
 * Shared, mock-free harness for `tab-manager.*.test.ts` — split out of the
 * former monolithic `tab-manager.test.ts` so every split file can build a
 * `TabManager` on identical fakes without re-deriving them. Deliberately
 * carries NO `vi.mock(...)` calls: those are hoisted per test file by
 * Vitest, so each split file registers its own `../lib/native-notification`
 * and `../host/window-host` mocks (and its own local `windowFocus`/
 * `windowCloseCalls` state, since the mock factory closes over them and
 * `beforeEach` reassigns `windowFocus` — an imported binding can't be
 * reassigned from outside its own module). This file only holds the parts
 * that don't touch that seam.
 */

export function processInfo(
  id: number,
  cwd: string | null,
  process: string | null,
  kind: PaneProcessInfo['kind'],
  agent: PaneProcessInfo['agent'],
): PaneProcessInfo {
  return { id, cwd, process, kind, agent };
}

export function fakePane(
  id: number,
  events: PaneEvents,
  // `search` defaults to an unusable stub — no existing test drives it. The
  // find-next/find-previous tests pass a real spy set so `advanceSearch`
  // (search-bar.ts) has something to call. `copySelection`/`paste` default to
  // no-ops — the Windows clipboard-chord test passes spies so it can assert
  // the real capture-phase dispatch path reaches the pane.
  overrides: {
    search?: Pane['search'];
    copySelection?: Pane['copySelection'];
    paste?: Pane['paste'];
    pasteText?: Pane['pasteText'];
  } = {},
): Pane {
  const element = document.createElement('div');
  // Mirrors xterm's textarea: shortcut events originate below the pane root,
  // then the window capture listener decides whether Deck owns the chord.
  const terminalInput = document.createElement('textarea');
  terminalInput.dataset.testid = 'fake-terminal-input';
  element.className = 'pane__term';
  element.appendChild(terminalInput);
  // Focusable + real DOM focus movement (like xterm's textarea would): the
  // Task 11 visibility predicate checks `element.contains(document.activeElement)`,
  // so the fake must actually move `document.activeElement`, not just fire
  // the synthetic event below (which mirrors production's `focusin` listener).
  element.tabIndex = -1;
  return {
    id,
    element,
    search: overrides.search ?? ({} as Pane['search']),
    mount() {},
    write() {},
    cols: 80,
    rows: 24,
    flush() {
      return Promise.resolve();
    },
    serializeScrollback() {
      return '';
    },
    writeln() {},
    fit() {},
    clear() {},
    copySelection: overrides.copySelection ?? (() => {}),
    paste: overrides.paste ?? (() => {}),
    pasteText: overrides.pasteText ?? ((text: string) => events.onData(id, text)),
    scrollPage() {},
    scrollToEdge() {},
    focus() {
      element.focus();
      events.onFocus(id);
    },
    applySettings() {},
    setHeaderInfo() {},
    captureSelection() {
      return null;
    },
    restoreSelection() {},
    dispose() {},
  };
}

/** An attention signal a real pane would emit — the tracker adds `observedAt`. */
export type EmitSignal = (id: number, signal: PaneAttentionSignal) => void;
/** Simulates a real focusin/mousedown/keyboard-driven focus landing on a pane. */
export type FocusPaneDirectly = (id: number) => void;

/**
 * Build a TabManager on `pty` with a capturing pane factory: it records each
 * pane's PaneEvents so a test can drive `onAttentionSignal` the way an OSC
 * 9/777 notification or a bell would, straight through the manager wiring —
 * and keeps the `Pane` itself so a test can call `.focus()` directly, which
 * both moves real DOM focus (for the visibility predicate) and fires
 * `onFocus` (for the acknowledge path), exactly like a real click would.
 */
export function wire(
  pty: PtyClient,
  // Task 12: lets a test add `onRequestAttentionFocus` (or any other future
  // seam) on top of the fake `createPane` below — merged flat, matching
  // TabManagerDeps extending TerminalManagerDeps.
  extraDeps: Partial<TabManagerDeps> = {},
  paneOverrides: Parameters<typeof fakePane>[2] = {},
): {
  tm: TabManager;
  emitSignal: EmitSignal;
  focusPaneDirectly: FocusPaneDirectly;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const eventsById = new Map<number, PaneEvents>();
  const panesById = new Map<number, Pane>();
  const createPane: CreatePaneFn = (id, _settings, events) => {
    eventsById.set(id, events);
    const pane = fakePane(id, events, paneOverrides);
    panesById.set(id, pane);
    return pane;
  };
  const tm = createTabManager(host, pty, { createPane, ...extraDeps });
  const emitSignal: EmitSignal = (id, signal) => {
    eventsById.get(id)?.onAttentionSignal?.(id, signal);
  };
  const focusPaneDirectly: FocusPaneDirectly = (id) => {
    panesById.get(id)?.focus();
  };
  return { tm, emitSignal, focusPaneDirectly };
}

export function setup(options: {
  infos?: ReadonlyMap<number, PaneProcessInfo>;
  /** Directories that still exist; omitted = every path exists. */
  dirs?: readonly string[];
  /** Extra TabManagerDeps (e.g. `onRequestAttentionFocus`) on top of the fake pane. */
  deps?: Partial<TabManagerDeps>;
  /** Pane-level spies, e.g. the clipboard methods the Ctrl+Shift chords hit. */
  paneOverrides?: Parameters<typeof fakePane>[2];
}): {
  tm: TabManager;
  pty: ReturnType<typeof createMemoryPtyClient>;
  emitSignal: EmitSignal;
  focusPaneDirectly: FocusPaneDirectly;
} {
  const pty = createMemoryPtyClient({
    nextId: 1,
    infos: options.infos,
    ...(options.dirs !== undefined ? { dirs: options.dirs } : {}),
  });
  const { tm, emitSignal, focusPaneDirectly } = wire(pty, options.deps, options.paneOverrides);
  return { tm, pty, emitSignal, focusPaneDirectly };
}

/**
 * Like `setup`, but the process snapshot of each pane is read live from
 * `infoByPane` on every poll (missing id = the poll returns nothing for it,
 * i.e. never recognized). Mutating the map then advancing the poll interval
 * drives the tracker's process gate open/closed deterministically.
 */
export function setupControllable(
  infoByPane: Map<number, PaneProcessInfo>,
  deps: Partial<TabManagerDeps> = {},
): {
  tm: TabManager;
  pty: ReturnType<typeof createMemoryPtyClient>;
  emitSignal: EmitSignal;
} {
  const base = createMemoryPtyClient({ nextId: 1 });
  const pty = {
    ...base,
    async ptyInfo(ids: readonly number[]): Promise<PaneProcessInfo[]> {
      return ids.flatMap((id) => {
        const info = infoByPane.get(id);
        return info === undefined ? [] : [info];
      });
    },
  };
  const { tm, emitSignal } = wire(pty, deps);
  return { tm, pty, emitSignal };
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fake `AgentNotifier` — records every `maybeNotify` call verbatim instead
 * of applying the real enabled/focus/dedupe policy, so a test can assert
 * exactly what TabManager routed through the Task 23 choke point without
 * that policy masking it (and without ever touching the real Tauri API).
 */
export function fakeNotifierSpy(): {
  notifier: AgentNotifier;
  maybeNotify: ReturnType<typeof vi.fn<(n: AttentionNotification) => void>>;
  prune: ReturnType<typeof vi.fn<(live: readonly number[]) => void>>;
} {
  const maybeNotify = vi.fn<(n: AttentionNotification) => void>();
  const prune = vi.fn<(live: readonly number[]) => void>();
  return { notifier: { maybeNotify, prune }, maybeNotify, prune };
}

// init() installs the file-drop listener, which reaches into the Tauri window
// and webview. Each split file's own `../host/window-host` mock stubs them so
// init() can register the pty output listener the unread tracking hangs off
// of. `getCurrentWindow` is also how Task 11 reads initial focus + subscribes
// to focus changes — this controller lets each test steer `isFocused()`/
// `onFocusChanged()` (resolve, reject, or fire a focus change) without
// re-mocking the module per test. The TYPE and factory live here so every
// split file's local `windowFocus` starts from the same shape; the mutable
// instance itself must stay local to each file (see the file doc comment).
export interface WindowFocusController {
  /** What `isFocused()` resolves to when it doesn't reject. */
  initialFocused: boolean;
  /** Set to make `isFocused()` reject this tick. */
  isFocusedError: Error | null;
  /** Set to make `onFocusChanged()` registration reject this tick. */
  onFocusChangedError: Error | null;
  /** Captured by `onFocusChanged()` — a test calls this to emit a change. */
  emitFocusChanged: ((focused: boolean) => void) | null;
  /** The unlisten fn returned from `onFocusChanged()` — asserted by dispose(). */
  unlistenFocus: ReturnType<typeof vi.fn>;
}

export function freshWindowFocusController(): WindowFocusController {
  return {
    initialFocused: true,
    isFocusedError: null,
    onFocusChangedError: null,
    emitFocusChanged: null,
    unlistenFocus: vi.fn(),
  };
}
