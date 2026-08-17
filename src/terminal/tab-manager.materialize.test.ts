// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { MACOS_KEYMAP } from "./keymap";
import { agentQuickPickerOpen } from "../chrome/events";
import { activeTabIndex, tabViews, statusInfo } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { WINDOWS_AGENT_LAUNCH_TIMEOUT_MS } from "./agent-launch";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
  flush,
  freshWindowFocusController,
  processInfo,
  setup,
} from "./tab-manager.fixtures";

// Task 23: the production-default notifier sends through this adapter. Mock
// it at the module boundary so NO test can ever reach the real Tauri
// `@tauri-apps/plugin-notification` API, regardless of the
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
// Local to this file, not imported from tab-manager.fixtures.ts: `beforeEach`
// below reassigns `windowFocus`, and an ES import is a read-only live
// binding — reassigning it from outside its declaring module isn't legal.
// Do not "deduplicate" this into the fixtures module; it would break every
// beforeEach in every split file that has one of these blocks.
let windowFocus = freshWindowFocusController();
const windowCloseCalls: number[] = [];

vi.mock("../host/window-host", () => ({
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

// `newTab()` (the "new-tab" action) flips this module signal — a global
// reset, not a per-describe one like `boardOpen`'s scattered resets in the
// action-dispatch/chord-actions split files, because leaving it true after
// whichever test exercises "new-tab" would silently rank every later test's
// `openOverlayRanks()` at "modal", failing unrelated pane-tiered assertions
// with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
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

describe("createTabManager openQuickAgent (AgentQuickPicker confirm)", () => {
  it("newTab() opens AgentQuickPicker rather than materializing directly", async () => {
    const { tm } = setup({});
    agentQuickPickerOpen.value = false;

    await tm.newTab();

    expect(agentQuickPickerOpen.value).toBe(true);
    expect(tabViews.value).toHaveLength(0); // no tab spawned — the picker owns that
    tm.dispose();
  });

  it("single pane, inheriting the active tab's LIVE cwd — not its static workspacePath", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/sub-dir", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    const ok = await tm.openQuickAgent(null);

    expect(ok).toBe(true);
    expect(tabViews.value).toHaveLength(2);
    expect(tabViews.value[1].workspacePath).toBe("/repo"); // carried from the active tab
    expect(pty.sessions.get(2)?.cwd).toBe("/repo/sub-dir"); // fresh, not "/repo"
    tm.dispose();
  });

  it("arms the chosen agent, same as an Open board confirm", async () => {
    vi.useFakeTimers();
    const { tm, pty } = setup({});
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    await tm.openQuickAgent("claude");
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([{ id: 2, data: "claude\r" }]);
    tm.dispose();
    vi.useRealTimers();
  });

  it("falls back to $HOME with no workspace tag when there is no active tab", async () => {
    const { tm, pty } = setup({});

    const ok = await tm.openQuickAgent(null);

    expect(ok).toBe(true);
    expect(tabViews.value).toHaveLength(1);
    expect(tabViews.value[0].workspacePath).toBeNull();
    expect(pty.sessions.get(1)?.cwd).toBeNull(); // spawnShell falls back to $HOME
    tm.dispose();
  });

  // A destination the picker offered is a worktree, so it has to become BOTH
  // the cwd and the workspace tag — tagging it is what files the new tab
  // under the right rail row instead of the one the user came from.
  it("a chosen destination overrides both the live cwd and the workspace tag", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/sub-dir", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    const ok = await tm.openQuickAgent(null, "/repo-feature");

    expect(ok).toBe(true);
    expect(tabViews.value[1].workspacePath).toBe("/repo-feature");
    expect(pty.sessions.get(2)?.cwd).toBe("/repo-feature");
    tm.dispose();
  });

  it("a null destination keeps the pre-picker behaviour exactly", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo/sub-dir", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });

    await tm.openQuickAgent(null, null);

    expect(tabViews.value[1].workspacePath).toBe("/repo");
    expect(pty.sessions.get(2)?.cwd).toBe("/repo/sub-dir");
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

  it("arms per-pane paneCommands, overriding the tab-wide agent fallback", async () => {
    const { tm, pty } = setup({});
    await tm.materialize({
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      cwds: ["/a", "/b"],
      paneCommands: ["claude --resume abc", null],
      workspacePath: "/work",
    });

    await vi.advanceTimersByTimeAsync(3000);

    // Pane 1 arms the literal restore command; pane 2's null slot arms nothing.
    expect(pty.writes).toEqual([{ id: 1, data: "claude --resume abc\r" }]);
    tm.dispose();
  });

  it("arms the legacy agent fallback for every pane when paneCommands is absent", async () => {
    const { tm, pty } = setup({});
    await tm.materialize({
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      cwds: ["/a", "/b"],
      agent: "claude",
      workspacePath: "/work",
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([
      { id: 1, data: "claude\r" },
      { id: 2, data: "claude\r" },
    ]);
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
