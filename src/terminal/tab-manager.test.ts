// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { Pane, PaneEvents, PaneAttentionSignal } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import { createMemoryPtyClient, type PtyClient } from "./pty-client";
import { createMemoryTransferClient } from "./transfer-client";
import { MACOS_KEYMAP, type ShortcutAction } from "./keymap";
import { ACTION_REGISTRY } from "./action-registry";
import {
  boardOpen,
  editorRequest,
  persistError,
  promptsOpen,
  saveDialogOpen,
  settingsOpen,
  usageOpen,
} from "../chrome/events";
import {
  createTabManager,
  type TabManager,
  type TabManagerDeps,
} from "./tab-manager";
import {
  activeTabIndex,
  requestTabOptionsKey,
  tabViews,
  statusInfo,
} from "./tabs-store";
import type { AgentNotifier, AttentionNotification } from "./agent-notifier";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { closeSearchBar } from "./search-bar";
import { WINDOWS_AGENT_LAUNCH_TIMEOUT_MS } from "./agent-launch";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";

function processInfo(
  id: number,
  cwd: string | null,
  process: string | null,
  kind: PaneProcessInfo["kind"],
  agent: PaneProcessInfo["agent"],
): PaneProcessInfo {
  return { id, cwd, process, kind, agent };
}

// Task 23: the production-default notifier sends through this adapter. Mock
// it at the module boundary so NO test — including every pre-Task-23 test
// above that never touches the notifier at all — can ever reach the real
// Tauri `@tauri-apps/plugin-notification` API, regardless of the
// `agentNotifications` setting's value at the time.
vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// init() installs the file-drop listener, which reaches into the Tauri window
// and webview. Stub them so init() can register the pty output listener the
// unread tracking hangs off of. `getCurrentWindow` is also how Task 11 reads
// initial focus + subscribes to focus changes — the controller below lets
// each test steer `isFocused()`/`onFocusChanged()` (resolve, reject, or fire
// a focus change) without re-mocking the module per test.
interface WindowFocusController {
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

function freshWindowFocusController(): WindowFocusController {
  return {
    initialFocused: true,
    isFocusedError: null,
    onFocusChangedError: null,
    emitFocusChanged: null,
    unlistenFocus: vi.fn(),
  };
}

let windowFocus = freshWindowFocusController();
const windowCloseCalls: number[] = [];

vi.mock("@tauri-apps/api/window", () => ({
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
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

function fakePane(
  id: number,
  events: PaneEvents,
  // `search` defaults to an unusable stub — no existing test drives it. The
  // find-next/find-previous tests below pass a real spy set so `advanceSearch`
  // (search-bar.ts) has something to call. `copySelection`/`paste` default to
  // no-ops — the Windows clipboard-chord test below passes spies so it can
  // assert the real capture-phase dispatch path reaches the pane.
  overrides: {
    search?: Pane["search"];
    copySelection?: Pane["copySelection"];
    paste?: Pane["paste"];
    pasteText?: Pane["pasteText"];
  } = {},
): Pane {
  const element = document.createElement("div");
  // Mirrors xterm's textarea: shortcut events originate below the pane root,
  // then the window capture listener decides whether Deck owns the chord.
  const terminalInput = document.createElement("textarea");
  terminalInput.dataset.testid = "fake-terminal-input";
  element.className = "pane__term";
  element.appendChild(terminalInput);
  // Focusable + real DOM focus movement (like xterm's textarea would): the
  // Task 11 visibility predicate checks `element.contains(document.activeElement)`,
  // so the fake must actually move `document.activeElement`, not just fire
  // the synthetic event below (which mirrors production's `focusin` listener).
  element.tabIndex = -1;
  return {
    id,
    element,
    search: overrides.search ?? ({} as Pane["search"]),
    mount() {},
    write() {},
    cols: 80,
    rows: 24,
    flush() {
      return Promise.resolve();
    },
    serializeScrollback() {
      return "";
    },
    writeln() {},
    fit() {},
    clear() {},
    copySelection: overrides.copySelection ?? (() => {}),
    paste: overrides.paste ?? (() => {}),
    pasteText:
      overrides.pasteText ?? ((text: string) => events.onData(id, text)),
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
type EmitSignal = (id: number, signal: PaneAttentionSignal) => void;
/** Simulates a real focusin/mousedown/keyboard-driven focus landing on a pane. */
type FocusPaneDirectly = (id: number) => void;

/**
 * Build a TabManager on `pty` with a capturing pane factory: it records each
 * pane's PaneEvents so a test can drive `onAttentionSignal` the way an OSC
 * 9/777 notification or a bell would, straight through the manager wiring —
 * and keeps the `Pane` itself so a test can call `.focus()` directly, which
 * both moves real DOM focus (for the visibility predicate) and fires
 * `onFocus` (for the acknowledge path), exactly like a real click would.
 */
function wire(
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
  const host = document.createElement("div");
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

function setup(options: {
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
  const { tm, emitSignal, focusPaneDirectly } = wire(
    pty,
    options.deps,
    options.paneOverrides,
  );
  return { tm, pty, emitSignal, focusPaneDirectly };
}

/**
 * Like `setup`, but the process snapshot of each pane is read live from
 * `infoByPane` on every poll (missing id = the poll returns nothing for it,
 * i.e. never recognized). Mutating the map then advancing the poll interval
 * drives the tracker's process gate open/closed deterministically.
 */
function setupControllable(
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fake `AgentNotifier` — records every `maybeNotify` call verbatim instead
 * of applying the real enabled/focus/dedupe policy, so a test can assert
 * exactly what TabManager routed through the Task 23 choke point without
 * that policy masking it (and without ever touching the real Tauri API).
 */
function fakeNotifierSpy(): {
  notifier: AgentNotifier;
  maybeNotify: ReturnType<typeof vi.fn<(n: AttentionNotification) => void>>;
  prune: ReturnType<typeof vi.fn<(live: readonly number[]) => void>>;
} {
  const maybeNotify = vi.fn<(n: AttentionNotification) => void>();
  const prune = vi.fn<(live: readonly number[]) => void>();
  return { notifier: { maybeNotify, prune }, maybeNotify, prune };
}

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({
    platform: "macos",
    homeDir: "/Users/dev",
  });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = 0;
  windowFocus = freshWindowFocusController();
  // Task 23: reset the live setting the production-default notifier reads,
  // and clear the mocked native adapter so per-test call counts start fresh.
  settings.value = DEFAULT_SETTINGS;
  vi.mocked(sendAgentNotification).mockClear();
});

describe("createTabManager materialize (through the createPane seam)", () => {
  it("publishes the initialized home directory", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const { tm } = setup({});

    await tm.init();

    expect(statusInfo.value.home).toBe(String.raw`C:\Users\dev`);
    tm.dispose();
  });

  it("spawns a tab at the given CWD", async () => {
    const { tm, pty } = setup({});

    const ok = await tm.materialize({ layout: null, cwds: ["/work"] });
    await flush();

    expect(ok).toBe(true);
    expect(tabViews.value).toHaveLength(1);
    expect(pty.sessions.get(1)?.cwd).toBe("/work");
  });

  it("splitActive spawns the new pane at the focused pane's fresh CWD", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: [] });

    await tm.splitActive("row");

    expect(pty.sessions.size).toBe(2);
    expect(pty.sessions.get(2)?.cwd).toBe("/repo");
    expect(statusInfo.value.paneCount).toBe(2);
  });

  it("dispatches the Windows clipboard chords to the active pane and leaves Alt+V to the active agent (prior H1, audit A4)", async () => {
    // Clipboard chords resolved in WINDOWS_KEYMAP but had no entry in the commands
    // table, so dispatchAction's `commands[action]?.()` was a silent no-op —
    // and the pane-local handler on the xterm textarea could never be reached,
    // because handleShortcut is a capture-phase window listener that
    // stopPropagation()s first. Driving `window` is that real path.
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const copySelection = vi.fn();
    const paste = vi.fn();
    const { tm } = setup({ paneOverrides: { copySelection, paste } });
    await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });
    // handleShortcut is only attached as a window listener once init() runs
    // (tab-manager.ts:1295) — without it, the dispatchEvent calls below would
    // hit no listener at all and the assertions would pass vacuously
    // regardless of the commands-table wiring under test.
    await tm.init();

    const terminalInput = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="fake-terminal-input"]',
    );
    if (terminalInput === null) {
      throw new Error("Expected the fake terminal input to be mounted");
    }
    const downstream = vi.fn();
    terminalInput.addEventListener("keydown", downstream);
    const dispatch = (init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      terminalInput.dispatchEvent(event);
      return event;
    };

    const ctrlV = dispatch({ key: "v", ctrlKey: true });
    // Upper-case `key` on purpose: Shift is held, and matchBinding lowercases.
    const copy = dispatch({ key: "C", ctrlKey: true, shiftKey: true });
    const ctrlShiftV = dispatch({
      key: "V",
      ctrlKey: true,
      shiftKey: true,
    });
    const shiftInsert = dispatch({
      key: "Unidentified",
      code: "Insert",
      shiftKey: true,
    });
    const altV = dispatch({ key: "v", altKey: true });

    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(paste).toHaveBeenCalledTimes(3);
    expect(copy.defaultPrevented).toBe(true);
    expect(ctrlV.defaultPrevented).toBe(true);
    expect(ctrlShiftV.defaultPrevented).toBe(true);
    expect(shiftInsert.defaultPrevented).toBe(true);
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(downstream).toHaveBeenLastCalledWith(altV);
    expect(altV.defaultPrevented).toBe(false);
    expect(paste).toHaveBeenCalledTimes(3);
    tm.dispose();
  });

  it("dispatches a select-tab-N chord to actually switch tabs — direct check, not mirrored from the keymap under test (H1/A4)", async () => {
    // dispatch-coverage.test.ts's DISPATCHABLE_ACTIONS mirrors select-tab-N
    // membership straight off MACOS_KEYMAP/WINDOWS_KEYMAP (see its own doc
    // comment in tab-manager.ts, above DISPATCHABLE_ACTIONS), so that test is
    // tautological for this one family: it can never catch a broken/removed
    // `selectTabIndex(action) !== null` early-return in `dispatchAction`,
    // because it derives "is this dispatchable" from the same two arrays it
    // iterates over. If that early-return ever breaks, every select-tab-N
    // chord silently stops switching tabs — H1/A4's exact failure mode —
    // while dispatch-coverage.test.ts stays green throughout. This test
    // drives the real chord through `handleShortcut` and asserts the tab
    // genuinely changed, so THAT regression has somewhere to fail.
    const binding = MACOS_KEYMAP.find((b) => b.action === "select-tab-2");
    if (binding === undefined) {
      throw new Error(
        "MACOS_KEYMAP has no select-tab-2 binding — test setup is stale",
      );
    }
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.materialize({ layout: null, cwds: ["/c"] });
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(2); // the last-materialized tab starts active

    // Built from the live binding's own modifiers/code, not guessed.
    const keyboardInit: KeyboardEventInit = {
      metaKey: !!binding.meta,
      ctrlKey: !!binding.ctrl,
      altKey: !!binding.alt,
      shiftKey: !!binding.shift,
    };
    if ("code" in binding) {
      keyboardInit.code = binding.code;
      keyboardInit.key = binding.code.replace("Digit", "");
    } else {
      keyboardInit.key = binding.key;
    }
    window.dispatchEvent(new KeyboardEvent("keydown", keyboardInit));
    await flush();

    expect(activeTabIndex.value).toBe(1); // select-tab-2 → 0-based index 1

    tm.dispose();
  });
});

describe("createTabManager agent launch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("types the chosen agent into every new pane after the launch timeout", async () => {
    const { tm, pty } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/work"], {
      workspacePath: "/work",
      agent: "claude",
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([{ id: 1, data: "claude\r" }]);
    tm.dispose();
  });

  it("does not open attention from selected agent intent before process confirmation", async () => {
    const { tm, pty, emitSignal } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/work"], {
      workspacePath: "/work",
      agent: "claude",
    });
    await tm.init();
    await vi.advanceTimersByTimeAsync(0);

    emitSignal(1, { kind: "requested", source: "bell" });
    pty.emitOutput(1, "\x1b]9;4;2\x07");

    expect(tabViews.value[0].attention?.actionableCount).toBe(0);
    expect(tabViews.value[0].agentBusy).toBe(false);
    expect(statusInfo.value.agent).toBeNull();
    tm.dispose();
  });

  it("leaves panes as plain shells for a Shell-only choice", async () => {
    const { tm, pty } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/work"], {
      workspacePath: "/work",
      agent: null,
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it("does not re-run the agent when reopening a closed tab", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/work", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ dirs: ["/work"], infos });
    await tm.openFromPreset({ type: "leaf" }, ["/work"], {
      workspacePath: "/work",
      agent: "claude",
    });
    await vi.advanceTimersByTimeAsync(3000);
    await tm.closeTab(0);
    pty.writes.length = 0;

    await tm.reopenTab();
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([]);
    tm.dispose();
  });

  it("launches a Windows agent once from structured readiness", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const { tm, pty } = setup({});
    await tm.openFromPreset({ type: "leaf" }, [String.raw`C:\work`], {
      workspacePath: String.raw`C:\work`,
      agent: "claude",
    });
    await tm.init();

    pty.emitOutput(1, "PowerShell banner");
    expect(pty.writes).toEqual([]);
    pty.emitPromptReady(1);
    pty.emitPromptReady(1);

    expect(pty.writes).toEqual([{ id: 1, data: "claude\r" }]);
    tm.dispose();
  });

  it("shows manual-launch guidance on Windows timeout without writing", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    const onAgentLaunchTimeout = vi.fn();
    const { tm, pty } = setup({
      deps: { onAgentLaunchTimeout },
    });
    await tm.openFromPreset({ type: "leaf" }, [String.raw`C:\work`], {
      workspacePath: String.raw`C:\work`,
      agent: "codex",
    });

    await vi.advanceTimersByTimeAsync(WINDOWS_AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([]);
    expect(onAgentLaunchTimeout).toHaveBeenCalledWith(
      "PowerShell was not ready in time. Launch the agent manually.",
    );
    tm.dispose();
  });
});

describe("createTabManager workspace identity", () => {
  it("tags each tab with its own workspace and reports the active one", async () => {
    const { tm } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/repo/a"], {
      workspacePath: "/repo/a",
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo/b"], {
      workspacePath: "/repo/b",
    });

    expect(tabViews.value.map((view) => view.workspacePath)).toEqual([
      "/repo/a",
      "/repo/b",
    ]);
    expect(tm.activeWorkspacePath()).toBe("/repo/b");
  });

  // Normalization still matters for everything keyed by workspace (sidebar
  // label, per-workspace logo) even though it no longer dedupes anything.
  it("stores the workspace normalized — a trailing slash is stripped", async () => {
    const { tm } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/repo/a"], {
      workspacePath: "/repo/a/",
    });

    expect(tabViews.value[0].workspacePath).toBe("/repo/a");
  });

  it("opens a second tab for a workspace that already has one", async () => {
    const { tm } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/repo/a"], {
      workspacePath: "/repo/a",
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo/b"], {
      workspacePath: "/repo/b",
    });
    // Same folder as tab 0, spelled with a trailing slash: a new tab either
    // way, and the normalized spelling is what lands on it.
    await tm.openFromPreset({ type: "leaf" }, ["/repo/a"], {
      workspacePath: "/repo/a/",
    });

    expect(tabViews.value).toHaveLength(3);
    expect(tabViews.value[2].workspacePath).toBe("/repo/a");
    expect(activeTabIndex.value).toBe(2); // the new tab, not the existing one
  });

  it("exposes the workspace on the tab view; a tab without one stays null", async () => {
    const { tm } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/repo/a"], {
      workspacePath: "/repo/a",
    });
    await tm.materialize({ layout: null, cwds: [] });

    expect(tabViews.value[0].workspacePath).toBe("/repo/a");
    expect(tabViews.value[1].workspacePath).toBeNull();
  });

  it("lights agentBusy only while the agent reports it is working", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "vim", "busy", null)],
      [2, processInfo(2, "/repo", "claude", "agent", "claude")],
      [3, processInfo(3, "/other", "npm", "busy", null)],
    ]);
    const { tm, pty } = setup({ infos });
    // Tab 0: two panes — the focused one runs vim, the background one claude.
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.splitActive("row");
    // Tab 1: a single pane running npm — busy, but not an agent. Opening it
    // polls again, and that poll now covers tab 0's background pane too.
    await tm.openFromPreset({ type: "leaf" }, ["/other"], {
      workspacePath: "/other",
    });
    await tm.init(); // registers the pty output listener activity feeds on
    await flush();

    // An agent sitting idle at its prompt is NOT busy — no spinner.
    expect(tabViews.value[0].agentBusy).toBe(false);

    // Claude reports busy via OSC 9;4 from tab 0's background pane.
    pty.emitOutput(2, "\x1b]9;4;3\x07");
    expect(tabViews.value[0].agentBusy).toBe(true);
    expect(tabViews.value[1].agentBusy).toBe(false);

    // The clear report ends the spinner even though output just arrived.
    pty.emitOutput(2, "done.\x1b]9;4;0\x07");
    expect(tabViews.value[0].agentBusy).toBe(false);

    // npm output never lights the spinner — not an agent.
    pty.emitOutput(3, "installing...");
    expect(tabViews.value[1].agentBusy).toBe(false);

    tm.dispose();
  });

  it("falls back to sustained output for agents without progress reports", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      expect(tabViews.value[0].agentBusy).toBe(false);

      // One isolated chunk (an idle repaint) is not work…
      pty.emitOutput(1, "streaming tokens…");
      expect(tabViews.value[0].agentBusy).toBe(false);
      // …but a sustained stream is.
      await vi.advanceTimersByTimeAsync(500);
      pty.emitOutput(1, "more tokens…");
      expect(tabViews.value[0].agentBusy).toBe(true);

      // Silence — the one-shot resync timer flips it off, no poll needed.
      await vi.advanceTimersByTimeAsync(3400);
      expect(tabViews.value[0].agentBusy).toBe(false);

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createTabManager reopen (Cmd+Shift+T)", () => {
  it("reopens a closed tab whose workspace still exists", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/alive", "zsh", "idle-shell", null)],
      [2, processInfo(2, null, "zsh", "idle-shell", null)],
    ]);
    const { tm } = setup({ dirs: ["/repo/alive"], infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo/alive"], {
      workspacePath: "/repo/alive",
    });
    await tm.materialize({ layout: null, cwds: [] });
    await tm.closeTab(0);
    expect(tabViews.value).toHaveLength(1);

    await tm.reopenTab();
    await flush();

    expect(tabViews.value).toHaveLength(2);
    expect(
      tabViews.value.some((tab) => tab.workspacePath === "/repo/alive"),
    ).toBe(true);
    tm.dispose();
  });

  it("refuses to resurrect a tab whose workspace was deleted meanwhile", async () => {
    // The folder is gone by reopen time: spawn_shell would silently land in
    // $HOME while the tab kept claiming /repo/gone.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/gone", "zsh", "idle-shell", null)],
      [2, processInfo(2, null, "zsh", "idle-shell", null)],
    ]);
    const { tm } = setup({ dirs: [], infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo/gone"], {
      workspacePath: "/repo/gone",
    });
    await tm.materialize({ layout: null, cwds: [] });
    await tm.closeTab(0);
    expect(tabViews.value).toHaveLength(1);

    await tm.reopenTab();
    await flush();

    expect(tabViews.value).toHaveLength(1); // no zombie tab
    expect(
      tabViews.value.some((tab) => tab.workspacePath === "/repo/gone"),
    ).toBe(false);
    tm.dispose();
  });
});

describe("createTabManager unread tracking", () => {
  it("lights unread for background output, never for the active tab, and clears on open", async () => {
    const { tm, pty } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
    await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2 (active)
    await tm.init(); // registers the pty output listener

    // Output to the background tab's pane lights its badge.
    pty.emitOutput(1, "hello");
    expect(tabViews.value[0].unread).toBe(true);
    expect(tabViews.value[1].unread).toBe(false);

    // Output to the active tab's own pane never lights unread.
    pty.emitOutput(2, "world");
    expect(tabViews.value[1].unread).toBe(false);

    // Opening the background tab clears its unread badge.
    tm.selectTab(0);
    expect(tabViews.value[0].unread).toBe(false);

    tm.dispose();
  });
});

describe("createTabManager close routing", () => {
  async function threeTabs(): Promise<{
    tm: TabManager;
    pty: ReturnType<typeof createMemoryPtyClient>;
  }> {
    const infos = new Map<number, PaneProcessInfo>(
      [1, 2, 3].map((id) => [
        id,
        processInfo(id, null, "zsh", "idle-shell", null),
      ]),
    );
    const { tm, pty } = setup({ infos });
    for (let i = 0; i < 3; i += 1) {
      await tm.materialize({ layout: null, cwds: [] });
    }
    return { tm, pty };
  }

  it("closes a tab and keeps the view state consistent", async () => {
    const { tm } = await threeTabs();
    expect(tabViews.value).toHaveLength(3);

    await tm.closeTab(0);

    expect(tabViews.value).toHaveLength(2);
    expect(activeTabIndex.value).toBeLessThan(2);
  });

  it("guards concurrent closes: the second Cmd+W during the first is a no-op", async () => {
    const { tm } = await threeTabs();

    // Fire both without awaiting — the second hits the close coordinator's
    // in-flight guard while the first fresh pty_info await is still pending.
    await Promise.all([tm.closeTab(0), tm.closeTab(1)]);

    expect(tabViews.value).toHaveLength(2);
    // The surviving entries are still closable — indexes did not go stale.
    await tm.closeTab(0);
    expect(tabViews.value).toHaveLength(1);
  });

  it("closing the last tab closes this window instead of quitting the app", async () => {
    // Behaviour change (spec §9.5): every window is a peer, so the last tab
    // closes THIS window and Rust decides whether that was also the last
    // window and the process should exit.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, null, "zsh", "idle-shell", null)],
    ]);
    const closeWindow = vi.fn(async () => {});
    const { tm, pty } = setup({ infos, deps: { closeWindow } });
    await tm.materialize({ layout: null, cwds: [] });
    const quitSpy = vi.spyOn(pty, "confirmQuit");

    await tm.closeTab(0);

    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(quitSpy).not.toHaveBeenCalled();
  });
});

describe("createTabManager attention tracker", () => {
  it("keeps per-pane tracker unread independent within one tab", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
      [2, processInfo(2, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.splitActive("row"); // pane 2 is now the focused/active pane
    await tm.init();
    await flush();

    // Output to the focused pane (2) is already seen — no per-pane unread.
    pty.emitOutput(2, "visible");
    // Output to the unfocused pane (1) flags only its own per-pane unread.
    pty.emitOutput(1, "hidden");

    // Exactly one of the two panes is unread → they track it independently.
    expect(tabViews.value[0].attention?.unreadCount).toBe(1);

    tm.dispose();
  });

  it("selectTab clears legacy unread; showing the tab also acknowledges its focused pane", async () => {
    // Pre-Task-11 this asserted selectTab did NOT touch tracker attention,
    // because `callbacks.onPaneFocus` didn't exist yet — `show()`'s internal
    // `pane.focus()` call (unchanged by Task 11; see plan §Task 11A) was a
    // no-op for the tracker. Task 11 wires `onPaneFocus` to `acknowledge`, so
    // that same `show()` focus call now acknowledges the tab's active pane as
    // a side effect of regaining DOM focus — not a direct selectTab→ack wire.
    // Task 11A/11B later add a non-focusing `show()` path for attention
    // navigation specifically; plain `selectTab` keeps this behavior.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
      [2, processInfo(2, "/b", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1 (claude)
    await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2 (active)
    await tm.init();
    await flush();

    // The background agent errors — latched attention plus legacy unread.
    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");
    expect(tabViews.value[0].unread).toBe(true);

    // Opening the tab clears LEGACY unread, and its `show()`-driven pane
    // focus acknowledges pane 1's latched tracker attention too.
    tm.selectTab(0);
    expect(tabViews.value[0].unread).toBe(false);
    expect(tabViews.value[0].attention?.kind).not.toBe("error");

    tm.dispose();
  });

  it("aggregates a working→error→clear batch to error with a cleared phase", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    // One PTY chunk carrying three ordered OSC 9;4 reports.
    pty.emitOutput(1, "\x1b]9;4;1\x07mid\x1b]9;4;2\x07more\x1b]9;4;0\x07");

    expect(tabViews.value[0].attention?.kind).toBe("error");
    expect(tabViews.value[0].attention?.actionableCount).toBe(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);

    tm.dispose();
  });

  it("latches requested when a recognized agent pane signals", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, emitSignal } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    emitSignal(1, { kind: "requested", source: "osc-notification" });

    expect(tabViews.value[0].attention?.kind).toBe("requested");
    expect(tabViews.value[0].attention?.actionableCount).toBe(1);

    tm.dispose();
  });

  it("clears the working badge when an agent pane exits", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;3\x07");
    expect(tabViews.value[0].attention?.workingCount).toBe(1);

    // Single-pane exit → exit limbo (no close/prune) → noteExit clears working.
    pty.emitExit(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);
    expect(tabViews.value[0].attention?.kind).not.toBe("working");

    tm.dispose();
  });

  it("prunes tracker state on pane close so no ghost badge remains", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      [2, processInfo(2, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.splitActive("row"); // pane 2 active; pane 1 is the background agent
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;3\x07");
    expect(tabViews.value[0].attention?.workingCount).toBe(1);

    // Pane 1 exits → auto-closed (2 panes) → pruned; no lingering working badge.
    pty.emitExit(1);
    expect(tabViews.value[0].attention?.workingCount).toBe(0);
    expect(tabViews.value[0].attention?.kind).not.toBe("working");

    tm.dispose();
  });

  describe("process gate", () => {
    it("ignores OSC 9;4 error from a shell pane", async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      pty.emitOutput(1, "\x1b]9;4;2\x07");

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.workingCount).toBe(0);
      expect(tabViews.value[0].attention?.kind).not.toBe("error");

      tm.dispose();
    });

    it("ignores sustained output from a shell pane", async () => {
      vi.useFakeTimers();
      try {
        const infos = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
        ]);
        const { tm, pty } = setup({ infos });
        await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
          workspacePath: "/repo",
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0);

        pty.emitOutput(1, "building…");
        await vi.advanceTimersByTimeAsync(500);
        pty.emitOutput(1, "still building…");

        expect(tabViews.value[0].attention?.workingCount).toBe(0);
        expect(tabViews.value[0].attention?.actionableCount).toBe(0);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores an attention signal from a shell pane", async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
      ]);
      const { tm, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: "requested", source: "bell" });

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.kind).not.toBe("requested");

      tm.dispose();
    });

    it("rejects an agent-looking process label when the explicit kind is busy", async () => {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "busy", null)],
      ]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: "requested", source: "bell" });
      pty.emitOutput(1, "\x1b]9;4;2\x07");

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].agentBusy).toBe(false);
      expect(statusInfo.value.agent).toBeNull();
      tm.dispose();
    });

    it.each([
      processInfo(1, "/repo", "claude", "agent", "claude"),
      processInfo(1, "/repo", "node", "agent", "codex"),
    ])(
      "accepts a recognized $agent agent with foreground process $process",
      async (info) => {
        const infos = new Map<number, PaneProcessInfo>([[1, info]]);
        const { tm, pty, emitSignal } = setup({ infos });
        await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
          workspacePath: "/repo",
        });
        await tm.init();
        await flush();

        emitSignal(1, { kind: "requested", source: "bell" });
        pty.emitOutput(1, "\x1b]9;4;1\x07");

        expect(tabViews.value[0].attention?.actionableCount).toBe(1);
        expect(tabViews.value[0].agentBusy).toBe(true);
        expect(tabViews.value[0].process).toBe(info.agent);
        expect(statusInfo.value.agent).toBe(info.agent);
        tm.dispose();
      },
    );

    it.each([
      processInfo(1, "/repo", "node", "busy", null),
      processInfo(1, "/repo", null, "unknown", null),
    ])("keeps the attention gate closed for $kind snapshots", async (info) => {
      const infos = new Map<number, PaneProcessInfo>([[1, info]]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      emitSignal(1, { kind: "requested", source: "bell" });
      pty.emitOutput(1, "\x1b]9;4;2\x07");

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].agentBusy).toBe(false);
      tm.dispose();
    });

    it("ignores activity from a pane never recognized as an agent", async () => {
      // No infos → the poll returns nothing for pane 1, so its gate never opens.
      const { tm, pty } = setup({});
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      pty.emitOutput(1, "\x1b]9;4;2\x07");

      expect(tabViews.value[0].attention?.actionableCount).toBe(0);
      expect(tabViews.value[0].attention?.workingCount).toBe(0);

      tm.dispose();
    });

    it("infers one completion on agent→shell then ignores shell activity", async () => {
      vi.useFakeTimers();
      try {
        const infoByPane = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, "/repo", "claude", "agent", "claude")],
        ]);
        const { tm, pty } = setupControllable(infoByPane);
        await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
          workspacePath: "/repo",
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)

        pty.emitOutput(1, "\x1b]9;4;1\x07");
        expect(tabViews.value[0].attention?.workingCount).toBe(1);

        // The foreground process becomes the shell; the next poll closes the
        // gate and infers exactly one completion.
        infoByPane.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
        await vi.advanceTimersByTimeAsync(2000);
        expect(tabViews.value[0].attention?.kind).toBe("completed");
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);
        expect(tabViews.value[0].attention?.workingCount).toBe(0);

        // Shell activity after the gate closed adds nothing (would be `error`).
        pty.emitOutput(1, "\x1b]9;4;2\x07");
        expect(tabViews.value[0].attention?.kind).toBe("completed");
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("synthesizes a completed transition when heuristic-working silence outlasts the resync timer", async () => {
      // codex/gemini never emit OSC 9;4 — the ONLY signal they ever produce
      // is the sustained-output heuristic. This locks the silence-completion
      // path: the pane goes working via the heuristic, then falls fully
      // silent (no OSC clear, no further output, no poll transition) for
      // longer than the ~3200ms resync one-shot, and the tab must still
      // reach `completed` on its own.
      vi.useFakeTimers();
      try {
        const infos = new Map<number, PaneProcessInfo>([
          [1, processInfo(1, "/repo", "codex", "agent", "codex")],
        ]);
        const { tm, pty } = setup({ infos });
        await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
          workspacePath: "/repo",
        });
        await tm.init();
        await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (codex)

        // One isolated chunk starts the streak but isn't sustained yet…
        pty.emitOutput(1, "streaming tokens…");
        // …a second chunk past minStreakMs flips the heuristic to working.
        await vi.advanceTimersByTimeAsync(500);
        pty.emitOutput(1, "more tokens…");
        expect(tabViews.value[0].attention?.kind).toBe("working");
        expect(tabViews.value[0].attention?.workingCount).toBe(1);

        // Go fully silent — no more output, no OSC clear, no process change —
        // past the resync one-shot. `activity.working` decays to false while
        // the tracker still reads "working", so the one-shot synthesizes an
        // idle transition with no new output ever having arrived.
        await vi.advanceTimersByTimeAsync(3400);

        expect(tabViews.value[0].attention?.kind).toBe("completed");
        expect(tabViews.value[0].attention?.actionableCount).toBe(1);
        expect(tabViews.value[0].attention?.workingCount).toBe(0);

        tm.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("createTabManager window focus (Task 11)", () => {
  it("acknowledges a pane's latched attention when the window starts focused", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init(); // isFocused() resolves true by default
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");

    // A fresh focus event on the pane (click/focusin/keyboard) acknowledges it.
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).not.toBe("error");

    tm.dispose();
  });

  it("does not acknowledge a pane focus while the window starts unfocused", async () => {
    windowFocus.initialFocused = false;
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");

    // The pane regains DOM focus, but the window itself is still backgrounded
    // (e.g. focus bounced inside an inactive app) — no acknowledge.
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).toBe("error");

    tm.dispose();
  });

  it("treats a rejected isFocused() as focused and keeps the in-app rail working", async () => {
    windowFocus.isFocusedError = new Error("no window handle");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("isFocused"),
        windowFocus.isFocusedError,
      );

      // Fail-safe = focused: acknowledge still works.
      pty.emitOutput(1, "\x1b]9;4;2\x07");
      focusPaneDirectly(1);
      expect(tabViews.value[0].attention?.kind).not.toBe("error");

      tm.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it("still works when onFocusChanged registration rejects (native notifications suppressed)", async () => {
    windowFocus.onFocusChangedError = new Error("event API unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await flush();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("onFocusChanged"),
        windowFocus.onFocusChangedError,
      );

      // isFocused() itself still resolved (true), so the in-app rail works —
      // only the ability to react to LATER focus changes is lost.
      pty.emitOutput(1, "\x1b]9;4;2\x07");
      focusPaneDirectly(1);
      expect(tabViews.value[0].attention?.kind).not.toBe("error");

      tm.dispose();
    } finally {
      warn.mockRestore();
    }
  });

  it("marks output unread while backgrounded and only acknowledges pane focus once the window returns", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    windowFocus.emitFocusChanged?.(false); // OS reports the window lost focus

    pty.emitOutput(1, "hi from the agent");
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

  it("does not mark output seen when a Settings-like element holds DOM focus", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty, focusPaneDirectly } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    focusPaneDirectly(1); // window foreground, tab active, pane DOM-focused

    // A Settings-like overlay steals DOM focus without the tab/window
    // changing — the pane stays "active" in the split tree the whole time.
    const settingsField = document.createElement("input");
    document.body.appendChild(settingsField);
    settingsField.focus();

    pty.emitOutput(1, "output while the settings panel is open");
    expect(tabViews.value[0].attention?.unreadCount).toBe(1); // NOT seen

    settingsField.remove();
    tm.dispose();
  });

  it("acknowledges only the focused pane in a multi-pane tab", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
        [2, processInfo(2, "/repo", "claude", "agent", "claude")],
      ]);
      const { tm, pty, focusPaneDirectly } = setup({ infos });
      await tm.init();
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.splitActive("row"); // pane 2 is now the focused/active pane
      // Pane 2 was spawned after materialize's one-shot poll, so its gate is
      // still closed — advance past the periodic poll (covers every live
      // pane) so both panes' agent gate is open before emitting OSC 9;4.
      await vi.advanceTimersByTimeAsync(2000);

      pty.emitOutput(1, "\x1b]9;4;2\x07"); // background pane errors
      pty.emitOutput(2, "\x1b]9;4;2\x07"); // focused pane errors too
      expect(tabViews.value[0].attention?.actionableCount).toBe(2);

      focusPaneDirectly(2); // re-focus only pane 2
      expect(tabViews.value[0].attention?.actionableCount).toBe(1); // pane 1's stays latched

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disposes the window-focus listener via unlisteners", async () => {
    const { tm } = setup({});
    await tm.init();
    expect(windowFocus.unlistenFocus).not.toHaveBeenCalled();

    tm.dispose();

    expect(windowFocus.unlistenFocus).toHaveBeenCalledTimes(1);
  });
});

// Task 11B: the private attention-navigation primitive. The window mock's
// `initialFocused` defaults to true (foreground), so every ack below fires —
// see the Task 11 describe block above for the controller itself.
describe("createTabManager activateForAttention (Task 11B)", () => {
  it("same-tab: acknowledges only the candidate pane; the active pane's attention stays latched", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
        [2, processInfo(2, "/repo", "claude", "agent", "claude")],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.init();
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.splitActive("row"); // pane 2 is now the tab's active pane (A)
      // Pane 2 was spawned after materialize's one-shot poll, so its gate is
      // still closed — advance past the periodic poll so both panes' agent
      // gate is open before emitting OSC 9;4.
      await vi.advanceTimersByTimeAsync(2000);

      pty.emitOutput(2, "\x1b]9;4;2\x07"); // A (active pane): error
      pty.emitOutput(1, "\x1b]9;4;4\x07"); // B (candidate, background): warning
      expect(tabViews.value[0].attention?.actionableCount).toBe(2);
      expect(tabViews.value[0].attention?.kind).toBe("error");

      tm.activateForAttention(0, 1); // same tab (0), candidate = pane 1 (B)

      // Only B was acknowledged — A's error is still latched, so the tab
      // still reads "error" with exactly one actionable pane left.
      expect(activeTabIndex.value).toBe(0); // no tab switch
      expect(tabViews.value[0].attention?.actionableCount).toBe(1);
      expect(tabViews.value[0].attention?.kind).toBe("error");

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cross-tab: switches tabs without acknowledging the target's own active pane, only the candidate", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/a", "zsh", "idle-shell", null)],
        [2, processInfo(2, "/b", "claude", "agent", "claude")],
        [3, processInfo(3, "/b", "claude", "agent", "claude")],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
      await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2 (active)
      await tm.splitActive("row"); // tab 1: pane 3 spawned, becomes its active pane (A)
      await vi.advanceTimersByTimeAsync(2000); // panes 2 and 3's agent gate opens

      tm.selectTab(0); // back to tab 0 — tab 1 becomes the background target

      pty.emitOutput(3, "\x1b]9;4;4\x07"); // A (tab 1's active pane): warning
      pty.emitOutput(2, "\x1b]9;4;2\x07"); // B (candidate, tab 1's other pane): error
      expect(tabViews.value[1].attention?.actionableCount).toBe(2);
      expect(tabViews.value[1].attention?.kind).toBe("error");

      // ONE call: switches to tab 1 AND acknowledges only the candidate (B).
      // If this went through show({focus:true}) or a second focus call, A's
      // warning would also clear — it must not.
      tm.activateForAttention(1, 2);

      expect(activeTabIndex.value).toBe(1); // the tab DID switch
      expect(tabViews.value[1].attention?.actionableCount).toBe(1); // only B cleared
      expect(tabViews.value[1].attention?.kind).toBe("warning"); // A's warning survives

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("same-tab: an id that never belonged to any pane is a complete no-op", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07"); // the only pane errors
    expect(tabViews.value[0].attention?.kind).toBe("error");

    tm.activateForAttention(0, 999); // unknown id — never a pane anywhere

    expect(activeTabIndex.value).toBe(0); // no tab change
    expect(tabViews.value[0].attention?.kind).toBe("error"); // untouched

    tm.dispose();
  });

  it("cross-tab: a candidate that belongs to a different tab is a complete no-op — no ack anywhere, no tab switch", async () => {
    // Simulates the "target died mid-selection" race: a candidate that was
    // valid somewhere is no longer a member of the tab it's requested
    // against. Validate-first checks `paneIds()` before any hide/active
    // change, so this must be indistinguishable from a truly dead id.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
      [2, processInfo(2, "/b", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
    await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2 (active)
    await tm.init();
    await flush();

    // Both panes carry latched attention.
    pty.emitOutput(1, "\x1b]9;4;2\x07"); // tab 0's pane errors
    pty.emitOutput(2, "\x1b]9;4;2\x07"); // tab 1's pane errors too
    expect(tabViews.value[0].attention?.kind).toBe("error");
    expect(tabViews.value[1].attention?.kind).toBe("error");

    // Pane 2 is real and alive, but not a member of tab 0 — must be treated
    // exactly like a dead/unknown candidate: complete no-op.
    tm.activateForAttention(0, 2);

    expect(activeTabIndex.value).toBe(1); // no tab switch (still tab 1)
    expect(tabViews.value[0].attention?.kind).toBe("error"); // untouched
    expect(tabViews.value[1].attention?.kind).toBe("error"); // pane 2 NOT acked

    tm.dispose();
  });
});

// Task 12: Cmd+Shift+A / focus-next-attention. `focusNextAttention` walks
// `tracker.actionable()` (already sorted highest-severity, then oldest-first)
// and routes the first in-scope live candidate through `activateForAttention`.
describe("createTabManager focusNextAttention / hasActionableAttention (Task 12)", () => {
  it("global: severity order wins over insertion order, oldest-first breaks ties, and repeated calls advance through every candidate", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/a", "claude", "agent", "claude")], // → requested
        [2, processInfo(2, "/b", "claude", "agent", "claude")], // → error (older)
        [3, processInfo(3, "/b", "claude", "agent", "claude")], // → error (newer, same tab)
        [4, processInfo(4, "/c", "claude", "agent", "claude")], // → warning
      ]);
      const { tm, pty, emitSignal } = setup({ infos });
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
      await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2
      await tm.splitActive("row"); // tab 1 → pane 3 added
      await tm.materialize({ layout: null, cwds: ["/c"] }); // tab 2 → pane 4 (active)
      await vi.advanceTimersByTimeAsync(2000); // every pane's agent gate opens

      // Inserted out of severity order on purpose: requested first, error last.
      emitSignal(1, { kind: "requested", source: "osc-notification" });
      await vi.advanceTimersByTimeAsync(10);
      pty.emitOutput(2, "\x1b]9;4;2\x07"); // older error
      await vi.advanceTimersByTimeAsync(10);
      pty.emitOutput(3, "\x1b]9;4;2\x07"); // newer error, same tab as pane 2
      await vi.advanceTimersByTimeAsync(10);
      pty.emitOutput(4, "\x1b]9;4;4\x07"); // warning

      expect(tm.hasActionableAttention()).toBe(true);

      // 1st: the OLDER of the two errors (pane 2) — severity beats insertion
      // order, and the tie between pane 2/3 breaks oldest-first.
      tm.focusNextAttention();
      expect(activeTabIndex.value).toBe(1);
      expect(tabViews.value[1].attention?.actionableCount).toBe(1); // pane 3 still latched

      // 2nd: the remaining error (pane 3), same tab — same-tab ack path.
      tm.focusNextAttention();
      expect(activeTabIndex.value).toBe(1);
      expect(tabViews.value[1].attention?.actionableCount).toBe(0);

      // 3rd: warning (pane 4) outranks the still-pending requested (pane 1).
      tm.focusNextAttention();
      expect(activeTabIndex.value).toBe(2);
      expect(tabViews.value[2].attention?.kind).not.toBe("warning");

      // 4th: only requested (pane 1) is left.
      tm.focusNextAttention();
      expect(activeTabIndex.value).toBe(0);
      expect(tabViews.value[0].attention?.kind).not.toBe("requested");

      // Queue now empty — a 5th call is a complete no-op.
      expect(tm.hasActionableAttention()).toBe(false);
      tm.focusNextAttention();
      expect(activeTabIndex.value).toBe(0);

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cross-tab: the global jump acks only the winning candidate, never the target tab's own active pane", async () => {
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/a", "claude", "agent", "claude")],
        [2, processInfo(2, "/b", "claude", "agent", "claude")],
        [3, processInfo(3, "/b", "claude", "agent", "claude")],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
      await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2
      await tm.splitActive("row"); // tab 1 → pane 3, becomes tab 1's own active pane
      tm.selectTab(0); // back to tab 0
      await vi.advanceTimersByTimeAsync(2000);

      pty.emitOutput(3, "\x1b]9;4;4\x07"); // tab 1's own active pane: warning
      pty.emitOutput(2, "\x1b]9;4;2\x07"); // tab 1's background pane: error (wins globally)
      expect(tabViews.value[1].attention?.actionableCount).toBe(2);
      expect(tabViews.value[1].attention?.kind).toBe("error");

      tm.focusNextAttention(); // no tabIndex — global scan

      expect(activeTabIndex.value).toBe(1); // switched into tab 1
      expect(tabViews.value[1].attention?.actionableCount).toBe(1); // only pane 2 acked
      expect(tabViews.value[1].attention?.kind).toBe("warning"); // pane 3's warning survives

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("scoped: a tabIndex restricts the scan to that tab even when a higher-severity candidate exists elsewhere", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
      [2, processInfo(2, "/b", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1
    await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 → pane 2 (active)
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07"); // tab 0: error — globally highest severity
    pty.emitOutput(2, "\x1b]9;4;4\x07"); // tab 1: warning
    expect(tm.hasActionableAttention(1)).toBe(true);

    tm.focusNextAttention(1); // scoped to tab 1 — must not jump to tab 0's error

    expect(activeTabIndex.value).toBe(1); // stayed put (same-tab ack)
    expect(tabViews.value[1].attention?.kind).not.toBe("warning"); // tab 1's candidate acked
    expect(tabViews.value[0].attention?.kind).toBe("error"); // tab 0 untouched

    tm.dispose();
  });

  it("unknown tabIndex: an out-of-range scope finds nothing and is a complete no-op", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");
    expect(tm.hasActionableAttention(5)).toBe(false);

    tm.focusNextAttention(5); // tab 5 does not exist

    expect(activeTabIndex.value).toBe(0); // no tab change
    expect(tabViews.value[0].attention?.kind).toBe("error"); // untouched — no ack

    tm.dispose();
  });

  it("no candidate anywhere: focusNextAttention is a complete no-op", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    expect(tm.hasActionableAttention()).toBe(false);
    expect(() => tm.focusNextAttention()).not.toThrow();
    expect(activeTabIndex.value).toBe(0);

    tm.dispose();
  });

  it("does not hijack an unread-only pane — only tracker.actionable() candidates ever count", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 → pane 1 (background)
    await tm.materialize({ layout: null, cwds: ["/b"] }); // tab 1 (active)
    await tm.init();
    await flush();

    // Plain background output: lights legacy `unread`, but a single isolated
    // chunk never crosses the sustained-output heuristic, so it is not
    // actionable — the tracker's `actionable()` must not contain it.
    pty.emitOutput(1, "plain agent output, no OSC markers");
    expect(tabViews.value[0].unread).toBe(true);
    expect(tabViews.value[0].attention?.actionableCount).toBe(0);

    expect(tm.hasActionableAttention()).toBe(false);
    tm.focusNextAttention();

    expect(activeTabIndex.value).toBe(1); // untouched — no hijack into tab 0

    tm.dispose();
  });
});

describe("createTabManager Cmd+Shift+A shortcut routing (Task 12)", () => {
  function attentionKeydown(): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key: "a",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    });
  }

  it("with an onRequestAttentionFocus dep: routes the request exactly once and does not focus/ack directly", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const onRequestAttentionFocus = vi.fn();
    const { tm, pty } = setup({ infos, deps: { onRequestAttentionFocus } });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();

    // An actionable candidate exists, but the shortcut must still go through
    // the seam instead of calling focusNextAttention/activateForAttention.
    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");

    window.dispatchEvent(attentionKeydown());

    expect(onRequestAttentionFocus).toHaveBeenCalledTimes(1);
    expect(onRequestAttentionFocus).toHaveBeenCalledWith();
    // NOT acked — routing through the seam must not focus/ack the pane itself.
    expect(tabViews.value[0].attention?.kind).toBe("error");

    tm.dispose();
  });

  it("without the dep: Cmd+Shift+A is a safe no-op — no throw, no direct focus/ack", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setup({ infos }); // no onRequestAttentionFocus
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();

    pty.emitOutput(1, "\x1b]9;4;2\x07");
    expect(tabViews.value[0].attention?.kind).toBe("error");

    expect(() => window.dispatchEvent(attentionKeydown())).not.toThrow();

    expect(tabViews.value[0].attention?.kind).toBe("error"); // untouched

    tm.dispose();
  });
});

// Task 23: wiring the notifier into TabManager. Every non-null tracker
// snapshot from a real transition routes through ONE choke point
// (`maybeNotify`); the notifier itself owns the enabled/focus/dedupe policy.
describe("createTabManager notifier deps (Task 23)", () => {
  it("compiles and constructs with the 3rd arg omitted", () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement("div");
    document.body.appendChild(host);

    expect(() => createTabManager(host, pty)).not.toThrow();
  });

  it("compiles and constructs with only { createPane }", () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const createPane: CreatePaneFn = (id, _settings, events) =>
      fakePane(id, events);

    expect(() => createTabManager(host, pty, { createPane })).not.toThrow();
  });

  it("compiles and constructs with { createPane, notifier }", () => {
    const pty = createMemoryPtyClient({ nextId: 1 });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const createPane: CreatePaneFn = (id, _settings, events) =>
      fakePane(id, events);
    const { notifier } = fakeNotifierSpy();

    expect(() =>
      createTabManager(host, pty, { createPane, notifier }),
    ).not.toThrow();
  });
});

describe("createTabManager notifier — production default reads the setting LIVE (Task 23)", () => {
  it("does not send while agentNotifications is off, then sends once flipped on — without reconstructing the manager", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    // Window starts backgrounded so only the `agentNotifications` setting
    // gates the send below — isolates the "read live" behavior under test.
    windowFocus.initialFocused = false;
    const { tm, pty, emitSignal } = setup({ infos }); // no injected notifier
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();

    // `agentNotifications` defaults to false (beforeEach resets it) — a real
    // actionable, backgrounded transition must NOT send.
    emitSignal(1, { kind: "requested", source: "osc-notification" });
    expect(tabViews.value[0].attention?.kind).toBe("requested");
    expect(sendAgentNotification).not.toHaveBeenCalled();

    // Flip the setting AFTER construction — a captured startup snapshot of
    // `agentNotifications` would stay false and this would still not send.
    settings.value = { ...settings.value, agentNotifications: true };

    // A higher-severity transition on the same pane — genuinely new revision.
    pty.emitOutput(1, "\x1b]9;4;2\x07"); // error
    expect(tabViews.value[0].attention?.kind).toBe("error");

    expect(sendAgentNotification).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(sendAgentNotification).mock.calls[0][0];
    expect(payload.title).toBe("repo");
    expect(payload.body).toBe("claude error");

    tm.dispose();
  });
});

describe("createTabManager notifier integration — fake notifier (Task 23)", () => {
  it("routes a background agent→shell completion transition through maybeNotify once, with the right paneId/kind/labels", async () => {
    vi.useFakeTimers();
    try {
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)

      pty.emitOutput(1, "\x1b]9;4;1\x07"); // working
      maybeNotify.mockClear(); // discard the gate-open + working calls (kind "none")

      infoByPane.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null)); // foreground process becomes the shell
      await vi.advanceTimersByTimeAsync(2000); // poll closes the gate → inferred completion

      expect(maybeNotify).toHaveBeenCalledTimes(1);
      const n = maybeNotify.mock.calls[0][0];
      expect(n.paneId).toBe(1);
      expect(n.kind).toBe("completed");
      expect(n.workspaceLabel).toBe("repo");
      expect(n.agentLabel).toBe("claude");

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
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);

      pty.emitOutput(1, "\x1b]9;4;1\x07");
      maybeNotify.mockClear();

      infoByPane.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
      await vi.advanceTimersByTimeAsync(2000);

      // Routed regardless of window focus — a real notifier would gate this
      // on `isWindowFocused()`, but this fake proves TabManager itself
      // never pre-filters on focus before the choke point.
      expect(maybeNotify).toHaveBeenCalledTimes(1);
      expect(maybeNotify.mock.calls[0][0].kind).toBe("completed");

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes a warning transition through maybeNotify with kind "warning"', async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call (kind "none")

    pty.emitOutput(1, "\x1b]9;4;4\x07"); // warning

    expect(maybeNotify).toHaveBeenCalledTimes(1);
    const n = maybeNotify.mock.calls[0][0];
    expect(n.paneId).toBe(1);
    expect(n.kind).toBe("warning");
    expect(n.workspaceLabel).toBe("repo");

    tm.dispose();
  });

  it("does not call maybeNotify for ordinary output with no attention transition", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call

    // A single isolated chunk never crosses the sustained-output heuristic —
    // no activity transition, so the tracker is never even touched.
    pty.emitOutput(
      1,
      "plain agent output, no OSC markers, no sustained streak",
    );

    expect(maybeNotify).not.toHaveBeenCalled();

    tm.dispose();
  });

  it("uses the tab rename override as the workspace label when one is set", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    tm.renameTab(0, "my custom name");
    await tm.init();
    await flush();
    maybeNotify.mockClear();

    pty.emitOutput(1, "\x1b]9;4;4\x07"); // warning

    expect(maybeNotify).toHaveBeenCalledTimes(1);
    expect(maybeNotify.mock.calls[0][0].workspaceLabel).toBe("my custom name");

    tm.dispose();
  });

  it("prunes the notifier alongside the tracker when a tab closes", async () => {
    const { notifier, prune } = fakeNotifierSpy();
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "zsh", "idle-shell", null)],
    ]);
    const { tm } = setup({ infos, deps: { notifier } });
    await tm.materialize({ layout: null, cwds: ["/a"] });

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
describe("createTabManager notifier — dedupe on attention latch identity, not raw revision", () => {
  it("does not re-notify when a latched error re-emits on a phase-only agent→shell poll, then again on pty:exit", async () => {
    vi.useFakeTimers();
    try {
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
      ]);
      windowFocus.initialFocused = false; // background
      settings.value = { ...settings.value, agentNotifications: true };
      const { notifier, maybeNotify } = fakeNotifierSpy();
      const { tm, pty } = setupControllable(infoByPane, { notifier });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0); // materialize poll → gate open (claude)
      maybeNotify.mockClear(); // discard the gate-open call (kind "none")

      pty.emitOutput(1, "\x1b]9;4;2\x07"); // error latches — the one real event
      expect(maybeNotify).toHaveBeenCalledTimes(1);
      expect(maybeNotify.mock.calls[0][0].kind).toBe("error");

      // agent→shell poll: phase working→idle, error stays latched — a
      // phase-only re-emit of the SAME latched kind, not a new event.
      infoByPane.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
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

  it("notifies again for a genuinely new error raised after the previous one was acknowledged", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    windowFocus.initialFocused = false; // background
    settings.value = { ...settings.value, agentNotifications: true };
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty, focusPaneDirectly } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear(); // discard the gate-open call (kind "none")

    pty.emitOutput(1, "\x1b]9;4;2\x07"); // first error — background, notified
    expect(maybeNotify).toHaveBeenCalledTimes(1);
    expect(maybeNotify.mock.calls[0][0].kind).toBe("error");

    // Window regains foreground, user focuses the pane — acknowledges it.
    windowFocus.emitFocusChanged?.(true);
    focusPaneDirectly(1);
    expect(tabViews.value[0].attention?.kind).not.toBe("error"); // sanity: cleared

    // Backgrounded again; a genuinely NEW error on the same pane must notify.
    windowFocus.emitFocusChanged?.(false);
    pty.emitOutput(1, "\x1b]9;4;2\x07");

    expect(maybeNotify).toHaveBeenCalledTimes(2);
    expect(maybeNotify.mock.calls[1][0].kind).toBe("error");

    tm.dispose();
  });

  it("notifies twice for an escalation from warning to error on the same pane", async () => {
    windowFocus.initialFocused = false; // background
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear();

    pty.emitOutput(1, "\x1b]9;4;4\x07"); // warning latches
    pty.emitOutput(1, "\x1b]9;4;2\x07"); // escalates to error

    expect(maybeNotify).toHaveBeenCalledTimes(2);
    expect(maybeNotify.mock.calls[0][0].kind).toBe("warning");
    expect(maybeNotify.mock.calls[1][0].kind).toBe("error");

    tm.dispose();
  });

  it("does not re-notify when a latched warning's phase flips working→idle with no attention change", async () => {
    windowFocus.initialFocused = false; // background
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { notifier, maybeNotify } = fakeNotifierSpy();
    const { tm, pty } = setup({ infos, deps: { notifier } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.init();
    await flush();
    maybeNotify.mockClear();

    pty.emitOutput(1, "\x1b]9;4;4\x07"); // warning latches, phase working
    expect(maybeNotify).toHaveBeenCalledTimes(1);

    pty.emitOutput(1, "\x1b]9;4;0\x07"); // phase clears to idle, warning stays latched
    expect(tabViews.value[0].attention?.kind).toBe("warning"); // sanity: still latched

    expect(maybeNotify).toHaveBeenCalledTimes(1); // no re-notify on phase-only change

    tm.dispose();
  });
});

describe("runAction — the macOS menu bridge", () => {
  // `new-tab` is the probe: it raises the Open board rather than spawning a
  // tab (the board owns workspace ∥ preset ∥ agent), so `boardOpen` is the
  // observable, not `tabViews.length`.
  async function ready(): Promise<TabManager> {
    boardOpen.value = false;
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;
    return tm;
  }

  afterEach(() => {
    boardOpen.value = false;
  });

  it("runs the same action the keymap would", async () => {
    const tm = await ready();

    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(true);
    tm.dispose();
  });

  // F-B1/F-B2 (2026-07-27 code review) retired the blanket "block every
  // action while a chrome text field is focused" this guard used to be —
  // Tauri's MenuEvent (confirmed against the 2.9.3 docs) can't tell a menu
  // accelerator from a deliberate click on the same item, so the guard now
  // keys off the ACTION (`destructive` in ACTION_REGISTRY), not the trigger.
  // `new-tab` is no longer a valid probe for "the guard still blocks
  // something" — it isn't destructive, so it now runs unconditionally (see
  // the dedicated test for that below). `clear-buffer` (destructive: true)
  // takes over as the probe for these two tests.
  it("a destructive action (clear-buffer) is a no-op while a chrome text field holds the caret", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    const clearSpy = vi.spyOn(panes.get(1)!, "clear");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    tm.runAction("clear-buffer");
    await flush();

    expect(clearSpy).not.toHaveBeenCalled();
    input.remove();
    tm.dispose();
  });

  it("a destructive action (clear-buffer) still runs when the caret is in a terminal's helper textarea", async () => {
    // xterm parks a textarea inside .pane__term to capture input — that one
    // must NOT suppress shortcuts, or the menu is dead whenever a pane has
    // focus, which is almost always.
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    const clearSpy = vi.spyOn(panes.get(1)!, "clear");
    const term = document.createElement("div");
    term.className = "pane__term";
    const textarea = document.createElement("textarea");
    term.appendChild(textarea);
    document.body.appendChild(term);
    textarea.focus();

    tm.runAction("clear-buffer");
    await flush();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    term.remove();
    tm.dispose();
  });

  it("a NON-destructive action (new-tab) now runs via runAction even while a chrome text field holds the caret", async () => {
    const tm = await ready();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(true);
    input.remove();
    tm.dispose();
  });

  // F-B2's exact reported scenario: click "Save Layout as Preset…" while the
  // search bar's input (or any other chrome text field) still holds focus —
  // before this fix, the blanket guard silently swallowed it: no dialog, no
  // error, nothing.
  it("save-preset (F-B2) now runs via runAction even while a chrome text field holds the caret", async () => {
    boardOpen.value = false;
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    tm.runAction("save-preset");
    await flush();

    expect(saveDialogOpen.value).toBe(true);
    input.remove();
    saveDialogOpen.value = false;
    tm.dispose();
  });

  it("ignores an action name the dispatch table does not know", async () => {
    const tm = await ready();

    tm.runAction("split-diagonal" as ShortcutAction);
    await flush();

    expect(boardOpen.value).toBe(false);
    tm.dispose();
  });
});

// Whole-branch review bugfix: `handleShortcut` (capture-phase keydown) and
// `runAction` (the macOS menu bridge) both used to dispatch straight to the
// command table with no idea an overlay was covering the terminal grid — an
// overlay-hidden ⌘W closed the pane behind it, ⌘⇧W closed the whole tab, ⌘K
// wiped its scrollback, all invisibly. `runAction` is the more dangerous of
// the two paths: the OS consumes a menu accelerator before the webview ever
// sees the key, so ⌘W in production always goes through `runAction`, never
// `handleShortcut`.
describe("overlay scope guard — blocks terminal/tab/pane actions while an overlay covers the grid", () => {
  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    saveDialogOpen.value = false;
    editorRequest.value = null;
  });

  function metaKeydown(key: string): KeyboardEvent {
    return new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true });
  }

  // select-tab-N/select-last-tab bind by physical digit-key position
  // (F-C1, 2026-07-27 code review) — `code` must be set explicitly, since
  // the native KeyboardEvent constructor does not derive it from `key`.
  function digitKeydown(digit: string): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key: digit,
      code: `Digit${digit}`,
      metaKey: true,
      bubbles: true,
    });
  }

  it("⌘W (close-pane) via the keydown path leaves the hidden pane untouched while the Open board is up", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row");
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(2);

    boardOpen.value = true;
    window.dispatchEvent(metaKeydown("w"));
    await flush();

    expect(statusInfo.value.paneCount).toBe(2); // pane hidden behind the board survives

    tm.dispose();
  });

  it("⌘W (close-pane) via runAction — the macOS menu bridge, the dangerous path — is blocked the same way", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row");
    await tm.init();
    await flush();

    boardOpen.value = true;
    tm.runAction("close-pane");
    await flush();

    expect(statusInfo.value.paneCount).toBe(2);

    tm.dispose();
  });

  it("close-pane via runAction is blocked while a PresetEditor draft is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row");
    await tm.init();
    await flush();

    editorRequest.value = { source: "live" };
    tm.runAction("close-pane");
    await flush();

    expect(statusInfo.value.paneCount).toBe(2); // the draft must never be silently discarded

    tm.dispose();
  });

  it("⌘D (split-row) via runAction is a no-op while Settings is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(1);

    settingsOpen.value = true;
    tm.runAction("split-row");
    await flush();

    expect(statusInfo.value.paneCount).toBe(1); // no split happened behind Settings

    tm.dispose();
  });

  it("close-tab via runAction is blocked while the SavePresetDialog is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.init();
    await flush();
    expect(tabViews.value).toHaveLength(2);

    saveDialogOpen.value = true;
    tm.runAction("close-tab");
    await flush();

    expect(tabViews.value).toHaveLength(2); // both tabs survive

    tm.dispose();
  });

  it("⌘K (clear-buffer) via runAction is blocked while Settings is open, and works again once it closes", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    const clearSpy = vi.spyOn(panes.get(1)!, "clear");

    settingsOpen.value = true;
    tm.runAction("clear-buffer");
    await flush();
    expect(clearSpy).not.toHaveBeenCalled();

    settingsOpen.value = false;
    tm.runAction("clear-buffer");
    await flush();
    expect(clearSpy).toHaveBeenCalledTimes(1); // scoped to the overlay, not permanently broken

    tm.dispose();
  });

  it("new-tab still raises the Open board while Settings is open — harmless, so it is not gated", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;
    settingsOpen.value = true;

    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(true);

    tm.dispose();
  });

  // F2 (2026-07-27 code review): new-tab used to be scope "always", which
  // bypassed the guard UNCONDITIONALLY — including while a PresetEditor/
  // SavePresetDialog draft was up. That let Cmd+T (or the menu's "New Tab")
  // mount the board underneath the modal scrim (z-40 > board's z-30): the
  // board's own mount-focus effect then stole DOM focus away from the live
  // draft, so a later Enter could silently open a workspace tab behind it.
  it("new-tab is now blocked while a PresetEditor draft is open (F2 — 'always' used to bypass every overlay, not just the board)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;

    editorRequest.value = { source: "live" };
    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(false);

    editorRequest.value = null;
    tm.dispose();
  });

  it("new-tab is blocked while the SavePresetDialog is open too (F2)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;

    saveDialogOpen.value = true;
    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(false);

    saveDialogOpen.value = false;
    tm.dispose();
  });

  it("select-tab-N still switches the active tab while the Open board is up", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(1);

    boardOpen.value = true;
    window.dispatchEvent(digitKeydown("1"));
    await flush();

    expect(activeTabIndex.value).toBe(0);
    // F1 (2026-07-27 code review): switching tabs used to leave the board up
    // — the newly active pane's textarea got focused BEHIND it (z-30), so
    // every following keystroke, Enter included, silently reached a hidden
    // shell instead of the terminal the user could see. Dismissing the
    // board here mirrors App.selectTab's click path (app.tsx), which has
    // always cleared boardOpen before switching.
    expect(boardOpen.value).toBe(false);

    tm.dispose();
  });

  it("select-last-tab (⌘9) still switches to the last tab while the Open board is up", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.materialize({ layout: null, cwds: ["/c"] });
    await tm.init();
    await flush();
    tm.selectTab(0);
    await flush();
    expect(activeTabIndex.value).toBe(0);

    boardOpen.value = true;
    window.dispatchEvent(digitKeydown("9"));
    await flush();

    expect(activeTabIndex.value).toBe(2); // the last tab, same exemption as select-tab-N
    expect(boardOpen.value).toBe(false); // F1 — same board-dismiss fix as select-tab-N above

    tm.dispose();
  });

  // Decision 3 of the design proposal (2026-07-27 code review): before the
  // F1 fix above, Cmd+1-9/Cmd+9 and Cmd+Shift+]/Cmd+Shift+[ were both fully
  // blocked while the board was up — consistent. F1 made the first family
  // dismiss-then-act, leaving next-tab/prev-tab as the only "switch tabs"
  // actions still dead on the board — an inconsistency F1 itself created,
  // not a pre-existing one, so it belongs in this same round of fixes.
  // next-tab/prev-tab now join isTabSwitchAction (renamed from
  // isTabSelectionAction to reflect the wider membership) and get the exact
  // same unconditional board-dismiss treatment.
  it("next-tab (⌘⇧]) cycles the active tab while the Open board is up, dismissing it first (decision 3)", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(1);

    boardOpen.value = true;
    tm.runAction("next-tab");
    await flush();

    expect(activeTabIndex.value).toBe(0); // wraps from the last tab to the first
    expect(boardOpen.value).toBe(false);

    tm.dispose();
  });

  it("prev-tab (⌘⇧[) cycles the active tab while the Open board is up too (decision 3)", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(1);

    boardOpen.value = true;
    tm.runAction("prev-tab");
    await flush();

    expect(activeTabIndex.value).toBe(0);
    expect(boardOpen.value).toBe(false);

    tm.dispose();
  });

  // The dismiss above is unconditional ONLY once a tab exists. With zero tabs
  // the F1 fix used to blank the window: `boardOpen` went false, every
  // select/cycle then no-opped on an empty `tabs`, and the stage was left with
  // no board and no terminal — on the app's own default landing screen, since
  // it always opens on the board with no session restore. `canCancel={
  // tabViews.value.length > 0}` (app.tsx) already refuses the same thing on
  // the mouse path; these lock the keyboard half of that invariant.
  for (const action of [
    "select-tab-1",
    "select-last-tab",
    "next-tab",
    "prev-tab",
  ] as const) {
    it(`${action} leaves the Open board up when there is no tab to switch to`, async () => {
      const { tm } = setup({});
      await tm.init();
      await flush();
      expect(activeTabIndex.value).toBe(-1);

      boardOpen.value = true;
      tm.runAction(action);
      await flush();

      expect(boardOpen.value).toBe(true);
      expect(activeTabIndex.value).toBe(-1);

      tm.dispose();
    });
  }

  // Decision 2 of the design proposal (2026-07-27 code review): save-preset
  // was scope "terminal"/"pane", blocked by literally any open overlay
  // including Settings — an accident of the blanket scope, same as
  // new-preset's Settings block above. Settings holds no draft (every
  // change writes straight through updateSettings) and SavePresetDialog
  // (z-40) renders fully visible above it (z-20), so there is nothing to
  // protect. Retiered "board" (NOT "modal" like new-preset — see the
  // board-still-blocks test right below for why they differ).
  it("save-preset via runAction is NOT blocked while Settings is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    boardOpen.value = false;

    settingsOpen.value = true;
    tm.runAction("save-preset");
    await flush();

    expect(saveDialogOpen.value).toBe(true);

    tm.dispose();
  });

  // Unlike new-preset (tiered "modal", sketches a preset from scratch,
  // independent of any tab), save-preset CAPTURES THE ACTIVE TAB'S LIVE
  // LAYOUT — while the board covers the screen, "the active tab" is exactly
  // the invisible state this whole overlay guard exists to protect. Tiering
  // it "board" (rather than "modal") keeps it blocked here.
  it("save-preset via runAction is STILL blocked while the Open board is up — it captures the active tab's live layout, which the board hides", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    boardOpen.value = true;
    tm.runAction("save-preset");
    await flush();

    expect(saveDialogOpen.value).toBe(false);

    tm.dispose();
  });

  // Task 3 (docs/plans/2026-07-27-action-registry.md): overlayBlocksAction
  // now reads action-registry.ts's ACTION_REGISTRY instead of a hardcoded
  // if-chain. Every other test above already proves the observable behavior
  // held; this one proves the SOURCE actually changed — flip a scope in the
  // registry and the guard must follow, not silently keep its own copy.
  //
  // "new-tab" dropped out of this set in the F2 fix above: it moved from
  // scope "always" (bypassed every overlay unconditionally) to tier "board"
  // (blocked only by an overlay ranked at or above the board — the modal
  // family). See its ACTION_REGISTRY row for the full rationale.
  it("reads scope from ACTION_REGISTRY, not a hardcoded list", () => {
    const alwaysActions = ACTION_REGISTRY.filter(
      (a) => a.scope === "always",
    ).map((a) => a.id);
    // The updater rows are app-level menu actions intercepted by App before
    // TabManager.runAction; "always" records that overlays must not disable
    // either manual update checks or the web Release Notes link.
    // open-tab-options joined this set in Task 2 of keyboard-parity —
    // TabPopover (z-100) outranks every overlay tier this registry models,
    // and TabBar/WorkspaceSidebar sit outside `.stage`, so there is nothing
    // for a tier to protect (see the row's own comment).
    expect(new Set(alwaysActions)).toEqual(
      new Set([
        "check-for-updates",
        "focus-next-attention",
        "open-release-notes",
        "toggle-settings",
        // The token usage screen joins the set for the same reason
        // `toggle-settings` is in it: its own overlay rank would otherwise
        // block the only action that can close it again.
        "toggle-usage",
        "open-tab-options",
      ]),
    );
  });
});

// Task 4 (docs/plans/2026-07-27-action-registry.md): new-preset and
// save-preset used to reach the app through two dedicated Tauri events
// (`menu:new-preset`/`menu:save-preset`) instead of the shared `action:`/
// `runAction` dispatch every other item uses. `menu:new-preset` had NO
// overlay guard at all; `menu:save-preset` only ever checked
// `!boardOpen.value`, missing Settings/PresetEditor/SavePresetDialog. Both
// bugs die by construction once both actions go through
// `dispatchAction`/`overlayBlocksAction` like everything else — these tests
// prove that for both the keydown path and the runAction (menu bridge)
// path, which is the one that matters in production (macOS eats the
// accelerator before the webview sees it).
describe("createTabManager new-preset / save-preset — unified into the action: dispatch path (Task 4)", () => {
  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    saveDialogOpen.value = false;
    editorRequest.value = null;
  });

  function metaShiftKeydown(key: string): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key,
      metaKey: true,
      shiftKey: true,
      bubbles: true,
    });
  }

  it("new-preset opens the PresetEditor via runAction when no overlay is blocking", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    tm.runAction("new-preset");

    expect(editorRequest.value).toEqual({ source: "live" });

    tm.dispose();
  });

  // F4 (2026-07-27 code review): new-preset was scope "terminal"/"pane", so
  // it was blocked by Settings too — an accident of the blanket scope, not a
  // deliberate product decision. PresetEditor (z-40) renders ON TOP OF
  // Settings (z-20) and is fully visible; Settings holds no draft (every
  // change writes straight through updateSettings), so there is nothing to
  // protect by blocking. Retiered "modal": no longer blocked by Settings or
  // by the board (below), only by another modal-family overlay already open
  // (see the sibling-exclusion test further down).
  it("new-preset via runAction is NOT blocked while Settings is open (F4 — Settings holds no draft, and PresetEditor renders above it)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    settingsOpen.value = true;
    tm.runAction("new-preset");

    expect(editorRequest.value).toEqual({ source: "live" });

    tm.dispose();
  });

  it("new-preset via runAction is NOT blocked while the Open board is up (F4 — the bug this finding reported: Cmd+Shift+N was dead on the app's own default landing screen)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    boardOpen.value = true;
    tm.runAction("new-preset");

    expect(editorRequest.value).toEqual({ source: "live" });

    tm.dispose();
  });

  it("new-preset is blocked while the SavePresetDialog is already open — modal-family sibling exclusion via rank >=, not >", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    saveDialogOpen.value = true;
    tm.runAction("new-preset");

    expect(editorRequest.value).toBeNull();

    tm.dispose();
  });

  it("Cmd+Shift+N (new-preset) via the keydown path opens the PresetEditor, and stays open while Settings is up too", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    window.dispatchEvent(metaShiftKeydown("n"));
    expect(editorRequest.value).toEqual({ source: "live" });
    editorRequest.value = null;

    settingsOpen.value = true;
    window.dispatchEvent(metaShiftKeydown("n"));
    expect(editorRequest.value).toEqual({ source: "live" });

    tm.dispose();
  });

  // save-preset's webview keyboard path has been routed through the general
  // overlay guard since Task 3 (it never had its own if-chain entry to
  // begin with) — these two lock that in against the specific overlay
  // (PresetEditor draft) the OLD menu-only path used to miss, on both entry
  // points, so the production bug (menu click / the OS-eaten Cmd+Shift+S
  // accelerator) cannot resurface once the parallel menu:save-preset event
  // is removed in this same task.
  it("save-preset via runAction is blocked while a PresetEditor draft is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    editorRequest.value = { source: "live" };
    tm.runAction("save-preset");

    expect(saveDialogOpen.value).toBe(false);

    tm.dispose();
  });

  it("Cmd+Shift+S (save-preset) via the keydown path is blocked while a PresetEditor draft is open", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    editorRequest.value = { source: "live" };
    window.dispatchEvent(metaShiftKeydown("s"));

    expect(saveDialogOpen.value).toBe(false);

    tm.dispose();
  });
});

describe("createTabManager toggle-settings routing (⌘, / Settings… menu item)", () => {
  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
  });

  function commaKeydown(): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key: ",",
      metaKey: true,
      bubbles: true,
    });
  }

  it("⌘, routes through onToggleSettings exactly once, the same pattern Cmd+Shift+A uses for onRequestAttentionFocus", async () => {
    const onToggleSettings = vi.fn();
    const { tm } = setup({ deps: { onToggleSettings } });
    await tm.init();
    await flush();

    window.dispatchEvent(commaKeydown());

    expect(onToggleSettings).toHaveBeenCalledTimes(1);
    expect(onToggleSettings).toHaveBeenCalledWith();

    tm.dispose();
  });

  it("without the dep: ⌘, is a safe no-op — no throw, nothing to toggle", async () => {
    const { tm } = setup({}); // no onToggleSettings
    await tm.init();
    await flush();

    expect(() => window.dispatchEvent(commaKeydown())).not.toThrow();

    tm.dispose();
  });

  it("the macOS menu bridge (runAction) routes toggle-settings through onToggleSettings too — the item's accelerator never reaches the webview", async () => {
    const onToggleSettings = vi.fn();
    const { tm } = setup({ deps: { onToggleSettings } });
    await tm.init();
    await flush();

    tm.runAction("toggle-settings");

    expect(onToggleSettings).toHaveBeenCalledTimes(1);

    tm.dispose();
  });

  it("is NOT blocked by the overlay scope guard while Settings is already open — the case that would otherwise strand the panel open forever", async () => {
    const onToggleSettings = vi.fn();
    const { tm } = setup({ deps: { onToggleSettings } });
    await tm.init();
    await flush();

    settingsOpen.value = true;
    tm.runAction("toggle-settings");

    expect(onToggleSettings).toHaveBeenCalledTimes(1);

    tm.dispose();
  });

  it("is NOT blocked while the Open board is up either — matches clicking the always-reachable gear button", async () => {
    const onToggleSettings = vi.fn();
    const { tm } = setup({ deps: { onToggleSettings } });
    await tm.init();
    await flush();

    boardOpen.value = true;
    tm.runAction("toggle-settings");

    expect(onToggleSettings).toHaveBeenCalledTimes(1);

    tm.dispose();
  });
});

// Lỗi 2 fix: ⌘9 used to parse as select-tab-9 (fixed index 8), a no-op with
// fewer than 9 tabs and just plain wrong with more — macOS convention
// (Safari, Chrome, iTerm2, Terminal.app) is that ⌘9 always jumps to the
// LAST tab, whatever the current count.
describe("select-last-tab (⌘9) — always the last tab, never a fixed index 8", () => {
  async function nTabs(tm: TabManager, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await tm.materialize({ layout: null, cwds: [] });
    }
  }

  it("with 3 tabs, ⌘9 selects index 2 — the last tab, not index 8", async () => {
    const { tm } = setup({});
    await nTabs(tm, 3);
    await tm.init();
    await flush();
    tm.selectTab(0);
    await flush();
    expect(activeTabIndex.value).toBe(0);

    tm.runAction("select-last-tab");
    await flush();

    expect(activeTabIndex.value).toBe(2);

    tm.dispose();
  });

  it("with 12 tabs, ⌘9 selects index 11 — always the last tab, whatever the count", async () => {
    const { tm } = setup({});
    await nTabs(tm, 12);
    await tm.init();
    await flush();
    tm.selectTab(0);
    await flush();
    expect(activeTabIndex.value).toBe(0);

    tm.runAction("select-last-tab");
    await flush();

    expect(activeTabIndex.value).toBe(11);

    tm.dispose();
  });

  it("with no tabs, ⌘9 is a safe no-op", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(-1);

    expect(() => tm.runAction("select-last-tab")).not.toThrow();
    await flush();

    expect(activeTabIndex.value).toBe(-1);

    tm.dispose();
  });
});

describe("createTabManager find-next / find-previous (⌘G / ⌘⇧G repeat the last search)", () => {
  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    closeSearchBar();
  });

  function searchSpies(): Pane["search"] {
    return {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
      onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as Pane["search"];
  }

  function gKeydown(shift = false): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      key: "g",
      metaKey: true,
      shiftKey: shift,
      bubbles: true,
    });
  }

  /** ⌘F, type, Escape — the exact flow the shortcut exists to continue. */
  function searchThenClose(pane: Pane, tm: TabManager, query: string): void {
    tm.runAction("find");
    const input = pane.element.querySelector(
      ".search-bar__input",
    ) as HTMLInputElement;
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    closeSearchBar();
  }

  it("find-next: blocked by the overlay guard while Settings is open, reaches the pane once it closes — via the real ⌘G keydown path", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events, { search: searchSpies() });
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    searchThenClose(panes.get(1)!, tm, "needle");
    const findNextSpy = panes.get(1)!.search.findNext as ReturnType<
      typeof vi.fn
    >;
    findNextSpy.mockClear(); // drop the incremental-typing call above

    settingsOpen.value = true;
    window.dispatchEvent(gKeydown());
    await flush();
    expect(findNextSpy).not.toHaveBeenCalled();

    settingsOpen.value = false;
    window.dispatchEvent(gKeydown());
    await flush();
    expect(findNextSpy).toHaveBeenCalledWith("needle", expect.anything());

    tm.dispose();
  });

  it("find-previous: blocked by the overlay guard while the Open board is up, reaches the pane once it closes — via the menu bridge (runAction)", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events, { search: searchSpies() });
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    searchThenClose(panes.get(1)!, tm, "needle");
    const findPrevSpy = panes.get(1)!.search.findPrevious as ReturnType<
      typeof vi.fn
    >;
    findPrevSpy.mockClear();

    boardOpen.value = true;
    tm.runAction("find-previous");
    expect(findPrevSpy).not.toHaveBeenCalled();

    boardOpen.value = false;
    tm.runAction("find-previous");
    expect(findPrevSpy).toHaveBeenCalledWith("needle", expect.anything());

    tm.dispose();
  });

  // F-B1 (2026-07-27 code review): on macOS the Edit menu's Cmd+G accelerator
  // (3e68378) is consumed by the OS before the webview ever sees a keydown —
  // production ALWAYS reaches find-next through runAction (the menu bridge),
  // never through the search bar's own keydown listener. The exact failure
  // this locks in: the bar stays OPEN with the caret still in its own input
  // (the whole point of Cmd+G — repeat the query without leaving the bar),
  // and find-next used to die there because it arrived as a "chrome text
  // field is focused" case indistinguishable from any other.
  it("find-next via runAction still reaches the active pane while the search bar's own input holds the caret (F-B1)", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events, { search: searchSpies() });
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    tm.runAction("find"); // opens the bar
    const input = panes
      .get(1)!
      .element.querySelector(".search-bar__input") as HTMLInputElement;
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const findNextSpy = panes.get(1)!.search.findNext as ReturnType<
      typeof vi.fn
    >;
    findNextSpy.mockClear(); // drop the incremental-typing call above
    input.focus(); // bar stays OPEN — caret sits in its own input, not closed

    tm.runAction("find-next"); // the real production path: menu bridge
    await flush();

    expect(findNextSpy).toHaveBeenCalledWith("needle", expect.anything());

    tm.dispose();
  });
});

// FR-032 (docs/plans/2026-07-27-keyboard-parity.md Task 1): swap-left/right/
// up/down route to TerminalManager.swapDirection — its own geometry/DOM
// behavior (slot order, focus-follows-pane, zoom drop) is covered directly
// in terminal-manager.test.ts, which can construct a real two-pane split and
// inspect .pane-slot order; here the only thing worth proving is routing —
// that runAction reaches swapDirection at all, and is gated like every other
// pane-tier action. Proven via a focus-call spy: swapDirection always calls
// pane.focus() on success (never on a no-op), so a spy is a reliable proxy
// for "the whole chain ran" without needing DOM slot inspection at this layer.
describe("createTabManager swap-* actions (FR-032)", () => {
  afterEach(() => {
    settingsOpen.value = false;
  });

  async function twoPaneSetup(): Promise<{
    tm: TabManager;
    panes: Map<number, Pane>;
  }> {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row"); // active pane is now the freshly split one
    await tm.init();
    await flush();
    return { tm, panes };
  }

  it("swap-left via runAction reaches TerminalManager.swapDirection", async () => {
    const { tm, panes } = await twoPaneSetup();
    // splitActive leaves the newer pane (id 2) active.
    const focusSpy = vi.spyOn(panes.get(2)!, "focus");
    focusSpy.mockClear(); // drop splitActive's own focus call

    tm.runAction("swap-left");
    await flush();

    expect(focusSpy).toHaveBeenCalled(); // swapDirection only focuses on success

    tm.dispose();
  });

  it("swap-left via runAction is blocked while Settings is open", async () => {
    const { tm, panes } = await twoPaneSetup();
    const focusSpy = vi.spyOn(panes.get(2)!, "focus");
    focusSpy.mockClear();

    settingsOpen.value = true;
    tm.runAction("swap-left");
    await flush();

    expect(focusSpy).not.toHaveBeenCalled();

    tm.dispose();
  });
});

// open-tab-options (⌘⇧R, docs/plans/2026-07-27-keyboard-parity.md Task 2):
// scope "always" (a deliberate, documented choice — see the row's own
// comment in action-registry.ts) rather than a new OverlayTier, so this
// suite proves the request reaches requestTabOptionsKey regardless of which
// overlay is open — TabBar/WorkspaceSidebar consuming it is covered
// separately in tab-bar.test.tsx/workspace-sidebar.test.tsx.
describe("createTabManager open-tab-options (⌘⇧R)", () => {
  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
    requestTabOptionsKey.value = null;
  });

  it("runAction sets requestTabOptionsKey to the active tab's key", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    await tm.init();
    await flush();
    expect(activeTabIndex.value).toBe(1);

    tm.runAction("open-tab-options");
    await flush();

    expect(requestTabOptionsKey.value).toBe(tabViews.value[1]!.key);

    tm.dispose();
  });

  it("is a safe no-op with no tabs — nothing to request", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    tm.runAction("open-tab-options");
    await flush();

    expect(requestTabOptionsKey.value).toBeNull();

    tm.dispose();
  });

  // scope "always" — TabBar sits outside `.stage`, unaffected by any of the
  // four overlays, so there is nothing for the guard to protect here.
  it("is NOT blocked while the Open board, Settings, or a modal draft is up", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    for (const openOverlay of [
      () => {
        boardOpen.value = true;
      },
      () => {
        settingsOpen.value = true;
      },
      () => {
        editorRequest.value = { source: "live" };
      },
      () => {
        saveDialogOpen.value = true;
      },
    ]) {
      requestTabOptionsKey.value = null;
      boardOpen.value = false;
      settingsOpen.value = false;
      editorRequest.value = null;
      saveDialogOpen.value = false;
      openOverlay();

      tm.runAction("open-tab-options");
      await flush();

      expect(requestTabOptionsKey.value).not.toBeNull();
    }

    tm.dispose();
  });
});

// copy-cwd (⌘⇧C + menu Edit ▸ "Copy Working Directory",
// docs/plans/2026-07-27-keyboard-parity.md Task 3): both surfaces share the
// exact same commands["copy-cwd"] closure via dispatchAction, so one set of
// tests through runAction covers both — no separate Tauri event to test.
describe("createTabManager copy-cwd (⌘⇧C / menu Edit)", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    boardOpen.value = false;
    settingsOpen.value = false;
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }

  it("copies the active pane's polled CWD to the clipboard", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/spacevibe-deck", "zsh", "idle-shell", null)],
    ]);
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { tm } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/repo/spacevibe-deck"] });
    await tm.init();
    await flush();

    tm.runAction("copy-cwd");
    await flush();

    expect(writeText).toHaveBeenCalledWith("/repo/spacevibe-deck");

    tm.dispose();
  });

  it("no active pane (no tabs yet) — no-op, clipboard untouched", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { tm } = setup({});
    await tm.init();
    await flush();

    tm.runAction("copy-cwd");
    await flush();

    expect(writeText).not.toHaveBeenCalled();

    tm.dispose();
  });

  it("CWD not polled yet — no-op, clipboard untouched, no throw", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { tm } = setup({}); // no `infos` — poller never learns a cwd for pane 1
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();

    expect(() => tm.runAction("copy-cwd")).not.toThrow();
    await flush();

    expect(writeText).not.toHaveBeenCalled();

    tm.dispose();
  });

  it("clipboard write failure reports through notifyError, not a swallowed error", async () => {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    stubClipboard(writeText);
    const { tm } = setup({ infos, deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const writelnSpy = vi.spyOn(panes.get(1)!, "writeln");

    tm.runAction("copy-cwd");
    await flush();

    expect(writelnSpy).toHaveBeenCalledTimes(1);
    expect(writelnSpy.mock.calls[0]![0]).toContain(
      "Couldn't copy the working directory",
    );

    tm.dispose();
  });

  it("is blocked while Settings is open, like every other pane-tier action", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { tm } = setup({ infos });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();

    settingsOpen.value = true;
    tm.runAction("copy-cwd");
    await flush();

    expect(writeText).not.toHaveBeenCalled();

    tm.dispose();
  });
});

// Scrollback navigation (⇧PageUp/⇧PageDown/⇧Home/⇧End,
// docs/plans/2026-07-27-keyboard-parity.md Task 4): routing + overlay-guard
// gating only — TerminalManager.scrollActivePage/scrollActiveToEdge's own
// delegation is covered directly in terminal-manager.test.ts.
describe("createTabManager scroll-page-up/down, scroll-to-top/bottom (Task 4)", () => {
  afterEach(() => {
    settingsOpen.value = false;
  });

  async function onePaneSetup(): Promise<{
    tm: TabManager;
    panes: Map<number, Pane>;
  }> {
    const panes = new Map<number, Pane>();
    const createPane: CreatePaneFn = (id, _settings, events) => {
      const pane = fakePane(id, events);
      panes.set(id, pane);
      return pane;
    };
    const { tm } = setup({ deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    return { tm, panes };
  }

  it("scroll-page-up/down route to scrollPage(-1)/scrollPage(1) on the active pane", async () => {
    const { tm, panes } = await onePaneSetup();
    const scrollPageSpy = vi.spyOn(panes.get(1)!, "scrollPage");

    tm.runAction("scroll-page-up");
    tm.runAction("scroll-page-down");
    await flush();

    expect(scrollPageSpy).toHaveBeenNthCalledWith(1, -1);
    expect(scrollPageSpy).toHaveBeenNthCalledWith(2, 1);

    tm.dispose();
  });

  it("scroll-to-top/scroll-to-bottom route to scrollToEdge('top')/('bottom') on the active pane", async () => {
    const { tm, panes } = await onePaneSetup();
    const scrollToEdgeSpy = vi.spyOn(panes.get(1)!, "scrollToEdge");

    tm.runAction("scroll-to-top");
    tm.runAction("scroll-to-bottom");
    await flush();

    expect(scrollToEdgeSpy).toHaveBeenNthCalledWith(1, "top");
    expect(scrollToEdgeSpy).toHaveBeenNthCalledWith(2, "bottom");

    tm.dispose();
  });

  it("all four are blocked while Settings is open, like every other pane-tier action", async () => {
    const { tm, panes } = await onePaneSetup();
    const scrollPageSpy = vi.spyOn(panes.get(1)!, "scrollPage");
    const scrollToEdgeSpy = vi.spyOn(panes.get(1)!, "scrollToEdge");

    settingsOpen.value = true;
    tm.runAction("scroll-page-up");
    tm.runAction("scroll-to-top");
    await flush();

    expect(scrollPageSpy).not.toHaveBeenCalled();
    expect(scrollToEdgeSpy).not.toHaveBeenCalled();

    tm.dispose();
  });
});

/**
 * One tab holding one pane the poll reports as `agent`, with the attention
 * tracker driven all the way to `phase: "idle"`.
 *
 * The OSC emit is not decoration. `freshState()` starts a pane at
 * `phase: "unknown"` and `noteProcess`'s pre-poll→agent branch leaves the
 * phase alone, so a poll opens the process gate while gate 2
 * (`phase === "idle"`) still refuses — every submit would degrade to
 * `"pasted"` and read like a gate bug. `init()` is equally load-bearing:
 * the memory client's `emitOutput` only reaches listeners registered inside
 * `init()`, so without it the emit is a silent no-op.
 */
async function mountManagerWithAgentPane(
  agent: NonNullable<PaneProcessInfo["agent"]>,
): Promise<{
  manager: TabManager;
  pty: ReturnType<typeof createMemoryPtyClient>;
  emitSignal: EmitSignal;
  focusPaneDirectly: FocusPaneDirectly;
}> {
  const infos = new Map<number, PaneProcessInfo>([
    [1, processInfo(1, "/repo", agent, "agent", agent)],
  ]);
  const { tm, pty, emitSignal, focusPaneDirectly } = setup({ infos });
  await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
    workspacePath: "/repo",
  });
  await tm.init();
  await flush();
  pty.emitOutput(1, "\x1b]9;4;0\x07"); // OSC 9;4 state 0 → idle
  return { manager: tm, pty, emitSignal, focusPaneDirectly };
}

describe("injectIntoPane", () => {
  it("pastes and sends when the gate holds", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId();
    expect(paneId).not.toBeNull();
    await expect(
      manager.injectIntoPane(paneId as number, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("sent");
    await flush();
    // Indexed, not `.at(-1)`: the repo's tsconfig `lib` predates ES2022.
    expect(pty.writes[pty.writes.length - 1]).toEqual({
      id: paneId,
      data: "\r",
    });
    manager.dispose();
  });

  it("pastes without sending when autoSend is off", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: false,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("withholds the submit when the pane changed agent since capture", async () => {
    const { manager, pty } = await mountManagerWithAgentPane("codex");
    const paneId = manager.activePaneId() as number;
    await expect(
      manager.injectIntoPane(paneId, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("reports no target for an unknown pane", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    await expect(
      manager.injectIntoPane(9999, "x", {
        autoSend: false,
        expectedAgent: null,
      }),
    ).resolves.toBe("no-target");
    manager.dispose();
  });

  it("withholds submit when focus acknowledges attention during injection", async () => {
    const { manager, pty, emitSignal, focusPaneDirectly } =
      await mountManagerWithAgentPane("claude");
    const paneId = manager.activePaneId() as number;
    const infoGate: {
      release?: (infos: PaneProcessInfo[]) => void;
    } = {};
    pty.ptyInfo = () =>
      new Promise<PaneProcessInfo[]>((resolve) => {
        infoGate.release = resolve;
      });
    emitSignal(paneId, {
      kind: "requested",
      source: "osc-notification",
    });

    const injection = manager.injectIntoPane(paneId, "review this", {
      autoSend: true,
      expectedAgent: "claude",
    });
    await flush();
    focusPaneDirectly(paneId);
    if (infoGate.release === undefined) {
      throw new Error("fresh pty_info did not start");
    }
    infoGate.release([
      processInfo(paneId, "/repo", "claude", "agent", "claude"),
    ]);

    await expect(injection).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.data === "\r")).toBe(false);
    manager.dispose();
  });

  it("never submits when the paste write fails", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const memory = createMemoryPtyClient({ nextId: 1, infos });
    const writes: string[] = [];
    const pty = {
      ...memory,
      async writePty(_id: number, data: string): Promise<void> {
        writes.push(data);
        if (data === "review this") {
          throw new Error("paste failed");
        }
      },
    };
    const { tm: manager } = wire(pty);
    await manager.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await manager.init();
    await flush();
    memory.emitOutput(1, "\x1b]9;4;0\x07");

    await expect(
      manager.injectIntoPane(1, "review this", {
        autoSend: true,
        expectedAgent: "claude",
      }),
    ).resolves.toBe("failed");
    await flush();
    expect(writes).toEqual(["review this"]);
    manager.dispose();
  });

  it("rejects an overlapping injection into the same pane before writing", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const memory = createMemoryPtyClient({ nextId: 1, infos });
    const writeControl: { release?: () => void } = {};
    const writeGate = new Promise<void>((resolve) => {
      writeControl.release = resolve;
    });
    const writeStarted = vi.fn();
    const writes: string[] = [];
    const pty = {
      ...memory,
      async writePty(_id: number, data: string): Promise<void> {
        writes.push(data);
        writeStarted();
        await writeGate;
      },
    };
    const { tm: manager } = wire(pty);
    await manager.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    const first = manager.injectIntoPane(1, "first", {
      autoSend: false,
      expectedAgent: "claude",
    });
    await vi.waitFor(() => expect(writeStarted).toHaveBeenCalledTimes(1));

    let overlappingOutcome: string | undefined;
    const overlapping = manager
      .injectIntoPane(1, "second", {
        autoSend: false,
        expectedAgent: "claude",
      })
      .then((outcome) => {
        overlappingOutcome = outcome;
        return outcome;
      });
    await flush();
    const outcomeBeforeFirstCompletes = overlappingOutcome;
    expect(writes).toEqual(["first"]);

    if (writeControl.release === undefined) {
      throw new Error("write gate was not initialized");
    }
    writeControl.release();
    await expect(Promise.all([first, overlapping])).resolves.toEqual([
      "pasted",
      "busy",
    ]);
    expect(outcomeBeforeFirstCompletes).toBe("busy");
    manager.dispose();
  });
});

describe("toggle-prompts", () => {
  beforeEach(() => {
    promptsOpen.value = false;
    persistError.value = null;
    // `scope: "pane"` blocks this action while ANY overlay is open, so all
    // four overlay signals have to be cleared — not just the board. This is
    // load-bearing, not defensive: the file's scroll-action describe above
    // sets `settingsOpen.value = true` in its last test and never resets it,
    // and the file-level beforeEach does not either — so a describe appended
    // at the end of the file inherits an open Settings and both tests below
    // fail.
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  it("opens the popover signal when a pane is focused", async () => {
    const { manager } = await mountManagerWithAgentPane("claude");
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(true);
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
    manager.dispose();
  });

  it("says so instead of opening with no pane to paste into", () => {
    const manager = createTabManager(
      document.createElement("div"),
      createMemoryPtyClient(),
    );
    manager.runAction("toggle-prompts");
    expect(promptsOpen.value).toBe(false);
    expect(persistError.value).toBe("No pane to paste into.");
    manager.dispose();
  });
});

describe("TabManager window lifecycle", () => {
  function windowSetup(deps: Partial<TabManagerDeps> = {}) {
    const transfer = createMemoryTransferClient();
    const { tm, pty } = setup({
      infos: new Map<number, PaneProcessInfo>([
        [1, processInfo(1, null, "zsh", "idle-shell", null)],
      ]),
      deps: { transfer, closeWindow: async () => {}, ...deps },
    });
    return { tm, pty, transfer };
  }

  it("removes the emptied tab after a pane moves out, without pushing it onto the reopen stack", async () => {
    const { tm, transfer } = windowSetup();
    await tm.materialize({ layout: null, cwds: [] });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(tabViews.value).toHaveLength(0);
    await tm.reopenTab();
    expect(tabViews.value).toHaveLength(0);
  });

  it("stages the tab identity the pane carried, not nulls", async () => {
    const { tm, transfer } = windowSetup();
    await tm.materialize({ layout: null, cwds: [], workspacePath: "/work" });
    tm.renameTab(0, "billing");
    tm.setTabDotColor(0, "cyan");

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    // Spec §10.2: name override, dot color and workspace move WITH the pane.
    // Without the `identity` wiring these are all null and every other test
    // in this file still passes — which is why this one exists.
    await expect(transfer.claimTransfer("xfer-1")).resolves.toMatchObject({
      tabName: "billing",
      dotColor: "cyan",
      workspacePath: "/work",
    });
  });

  it("keeps the tab when the move aborts", async () => {
    const { tm, transfer } = windowSetup();
    await tm.materialize({ layout: null, cwds: [] });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });
    await promise;

    expect(tabViews.value).toHaveLength(1);
  });

  it("adopts an offered pane into a new tab of a running window", async () => {
    const { tm, transfer } = windowSetup();
    const token = await transfer.prepareTransfer(99);
    await transfer.stageTransfer(token, {
      paneId: 99,
      cwd: "/repo",
      agentId: null,
      scrollback: "",
      cols: 100,
      rows: 30,
      tabName: "moved",
      dotColor: null,
      workspacePath: "/repo",
    });

    await expect(tm.adoptIntoNewTab(token)).resolves.toBe(true);
    expect(tabViews.value).toHaveLength(1);
    expect(tm.allPaneIds()).toContain(99);
  });

  it("starts no transfer when the move-to-window payload has no usable label", async () => {
    const { tm, transfer } = windowSetup();
    await tm.materialize({ layout: null, cwds: [] });

    // What the listener would receive for a malformed emit: no label at all.
    transfer.moveToWindow("");

    expect(transfer.calls).toEqual([]);
    expect(tabViews.value).toHaveLength(1);
  });
});

describe("toggle-usage", () => {
  beforeEach(() => {
    // Same trap the `toggle-prompts` describe above documents: the file's
    // earlier describes leave `settingsOpen` true and neither they nor the
    // file-level `beforeEach` reset it. `toggle-usage` is `scope: "always"`
    // so an open overlay cannot block IT — but the gating test below drives a
    // `"pane"`-tiered action, which every stale overlay would block for the
    // wrong reason and turn the assertion into a false pass.
    usageOpen.value = false;
    boardOpen.value = false;
    settingsOpen.value = false;
    editorRequest.value = null;
    saveDialogOpen.value = false;
  });

  afterEach(() => {
    usageOpen.value = false;
    settingsOpen.value = false;
  });

  it("routes through the onToggleUsage seam instead of writing the signal", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    // The seam owns the write — TabManager must never touch `usageOpen`, or
    // the Settings/Usage mutual exclusion would live in two places.
    expect(usageOpen.value).toBe(false);
    tm.dispose();
  });

  it("is a safe no-op when no seam is supplied", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();

    expect(() => tm.runAction("toggle-usage")).not.toThrow();
    expect(usageOpen.value).toBe(false);
    tm.dispose();
  });

  it("still runs while Settings is open — scope 'always', or the screen could strand itself", async () => {
    const onToggleUsage = vi.fn();
    const { tm } = setup({ deps: { onToggleUsage } });
    await tm.init();
    await flush();
    settingsOpen.value = true;

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it("blocks a pane-tiered action while the usage screen covers the grid, and unblocks once it closes", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(1);

    usageOpen.value = true;
    tm.runAction("split-row");
    await flush();
    expect(statusInfo.value.paneCount).toBe(1); // no split happened behind Usage

    usageOpen.value = false;
    tm.runAction("split-row");
    await flush();
    expect(statusInfo.value.paneCount).toBe(2); // scoped to the overlay, not broken

    tm.dispose();
  });

  it("leaves board-tiered actions alone — Usage ranks below the board, exactly like Settings", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    boardOpen.value = false;
    usageOpen.value = true;

    tm.runAction("new-tab");
    await flush();

    expect(boardOpen.value).toBe(true);
    tm.dispose();
  });
});
