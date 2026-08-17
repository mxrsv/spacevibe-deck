// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pane } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import type { ShortcutAction } from "./keymap";
import type { TabManager } from "./tab-manager";
import {
  agentQuickPickerOpen,
  boardOpen,
  saveDialogOpen,
} from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
  fakePane,
  flush,
  freshWindowFocusController,
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
// reset, not a per-describe one like `boardOpen`'s scattered resets below,
// because leaving it true after whichever test exercises "new-tab" would
// silently rank every later test's `openOverlayRanks()` at "modal", failing
// unrelated pane-tiered assertions with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
});

describe("runAction — the macOS menu bridge", () => {
  // `new-tab` is the probe: it raises AgentQuickPicker rather than spawning
  // a tab directly (the picker owns the agent choice), so
  // `agentQuickPickerOpen` is the observable, not `tabViews.length`.
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

    expect(agentQuickPickerOpen.value).toBe(true);
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

    expect(agentQuickPickerOpen.value).toBe(true);
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
