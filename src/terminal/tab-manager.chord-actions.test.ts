// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { Pane } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import type { TabManager } from "./tab-manager";
import { closeSearchBar } from "./search-bar";
import { agentQuickPickerOpen, boardOpen, settingsOpen } from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  fakePane,
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
// reset, not a per-describe one like `boardOpen`'s scattered resets below,
// because leaving it true after whichever test exercises "new-tab" would
// silently rank every later test's `openOverlayRanks()` at "modal", failing
// unrelated pane-tiered assertions with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
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

// Bug 2 fix: ⌘9 used to parse as select-tab-9 (fixed index 8), a no-op with
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
    const input = pane.element.querySelector(".search-bar__input") as HTMLInputElement;
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
    const findNextSpy = panes.get(1)!.search.findNext as ReturnType<typeof vi.fn>;
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
    const findPrevSpy = panes.get(1)!.search.findPrevious as ReturnType<typeof vi.fn>;
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
    const input = panes.get(1)!.element.querySelector(".search-bar__input") as HTMLInputElement;
    input.value = "needle";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const findNextSpy = panes.get(1)!.search.findNext as ReturnType<typeof vi.fn>;
    findNextSpy.mockClear(); // drop the incremental-typing call above
    input.focus(); // bar stays OPEN — caret sits in its own input, not closed

    tm.runAction("find-next"); // the real production path: menu bridge
    await flush();

    expect(findNextSpy).toHaveBeenCalledWith("needle", expect.anything());

    tm.dispose();
  });
});

// swap-left/right/up/down exchange the focused pane with its neighbour and
// route to TerminalManager.swapDirection — its own geometry/DOM
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

// copy-cwd (⌘⇧C + menu Edit ▸ "Copy Working Directory"): both surfaces share the
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
    expect(writelnSpy.mock.calls[0]![0]).toContain("Couldn't copy the working directory");

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

// Scrollback navigation (⇧PageUp/⇧PageDown/⇧Home/⇧End): routing + overlay-guard
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
