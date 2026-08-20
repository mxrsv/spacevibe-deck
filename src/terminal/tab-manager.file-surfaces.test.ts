// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { resetFileSurfaces } from "../files/file-surface-store";
import type { FileClient } from "../files/file-client";
import { agentQuickPickerOpen, persistError, settingsOpen } from "../chrome/events";
import { activeTabIndex, tabViews, statusInfo } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  flush,
  freshWindowFocusController,
  processInfo,
  setup,
  wire,
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
  // Same reasoning: the dock-toggle tests below open Settings to prove the
  // overlay half of the guard still blocks them, and a left-true signal would
  // rank every later test's `openOverlayRanks()` at "settings".
  settingsOpen.value = false;
});

/**
 * The file explorer's twelve invariants (spec §7, plan T17–T27).
 *
 * Every one of these sites assumed "a tab is a grid of PTY panes". Each gets
 * its own answer here — including the ones that hold BY CONSTRUCTION, because
 * an invariant that holds today with nothing asserting it can stop holding
 * tomorrow with nothing to say so.
 *
 * `TabManager` never learns what a file is: it talks to a `SurfaceStrip`, and
 * this fake is the whole vocabulary between them.
 */
function fakeSurfaces(
  state: {
    count?: number;
    total?: number;
    activeIndex?: number;
  } = {},
) {
  const calls: string[] = [];
  const strip = {
    countValue: state.count ?? 0,
    totalValue: state.total ?? 0,
    activeIndexValue: state.activeIndex ?? -1,
    calls,
    count: () => strip.countValue,
    total: () => strip.totalValue,
    activeIndex: () => strip.activeIndexValue,
    activate: (index: number) => {
      calls.push(`activate:${index}`);
      strip.activeIndexValue = index;
    },
    deactivate: () => {
      calls.push("deactivate");
      strip.activeIndexValue = -1;
    },
    focus: () => {
      calls.push("focus");
    },
    close: async () => {
      calls.push("close");
    },
    save: async () => {
      calls.push("save");
    },
    applySettings: () => {
      calls.push("applySettings");
    },
    /** Flipped per test: false is "the caret is somewhere else". */
    handlesEdit: false,
    runEditCommand: (command: string) => {
      calls.push(`runEditCommand:${command}`);
      return strip.handlesEdit;
    },
  };
  return strip;
}

/** Every pane an explicit idle shell, so the busy guard never opens a dialog
 * — there is no host bridge in this environment, and `confirmClose` treats a
 * failed dialog as "do not close". */
const IDLE_SHELLS = new Map([
  [1, processInfo(1, "/a", "zsh", "idle-shell", null)],
  [2, processInfo(2, "/b", "zsh", "idle-shell", null)],
]);

describe("file surfaces in the tab strip", () => {
  it("T17: a file surface contributes no phantom pane to allPaneIds()", async () => {
    // Feeds both the quit census and the update guard. Holds by construction
    // while the file store stays outside `tabs` — locked in here so that
    // staying true is checked rather than assumed.
    const surfaces = fakeSurfaces({ count: 3, total: 3 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    const withTerminalOnly = tm.allPaneIds();

    surfaces.countValue = 5;
    surfaces.totalValue = 5;

    expect(tm.allPaneIds()).toEqual(withTerminalOnly);
    expect(tm.allPaneIds().every((id) => typeof id === "number")).toBe(true);
  });

  it("T18: the poller never polls when only file surfaces exist", async () => {
    // `targets()` is `allPaneIds()` and the poller skips an empty target list,
    // so T17 carries this — asserted directly all the same.
    const surfaces = fakeSurfaces({ count: 2, total: 2, activeIndex: 0 });
    const pty = createMemoryPtyClient({ nextId: 1 });
    const ptyInfo = vi.fn(pty.ptyInfo);
    const { tm } = wire({ ...pty, ptyInfo }, { surfaces });
    await tm.init();
    // `targets()` is `allPaneIds()`, which a file surface never adds to, and
    // the poller returns immediately on an empty list — so a forced poll is
    // the sharpest form of this assertion.
    expect(tm.allPaneIds()).toEqual([]);
    await Promise.resolve();

    expect(ptyInfo).not.toHaveBeenCalled();
    tm.dispose();
  });

  it("T19: statusInfo reports NO pane count while a file surface is active", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    expect(statusInfo.value.paneCount).toBe(1);

    surfaces.activeIndexValue = 0;
    tm.notifySurfacesChanged();

    // Absent, not zero-with-a-label (spec §7).
    expect(statusInfo.value.paneCount).toBeNull();
  });

  it("T20: ⌘W closes the FILE tab when a file surface is active", async () => {
    // Two sites, not one: this is `close-pane`. Neither may fall through to
    // the other — closing the terminal tab behind a file tab would be silent
    // and catastrophic.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    surfaces.calls.length = 0;

    tm.runAction("close-pane");
    await vi.waitFor(() => expect(surfaces.calls).toContain("close"));

    expect(tabViews.value).toHaveLength(1);
  });

  it("T20: ⌘W still closes the PANE when a terminal tab is active", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.calls.length = 0;

    tm.runAction("close-pane");
    await vi.waitFor(() => expect(tabViews.value).toHaveLength(0));

    expect(surfaces.calls).not.toContain("close");
  });

  it("T21: the last TAB does not close a window that still holds file tabs", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const before = windowCloseCalls.length;
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });

    await tm.closeTab(0);

    expect(windowCloseCalls.length).toBe(before);
    expect(surfaces.calls).toContain("activate:0");
  });

  it("T21: the last SURFACE does close the window", async () => {
    const surfaces = fakeSurfaces({ count: 0, total: 0 });
    const before = windowCloseCalls.length;
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });

    await tm.closeTab(0);

    await vi.waitFor(() => expect(windowCloseCalls.length).toBe(before + 1));
  });

  it("T21: cycleTab reaches file surfaces — one terminal tab plus file tabs", async () => {
    // `tabs.length < 2` used to early-return here, so ⌘⇧] did nothing at all
    // with one terminal tab and three file tabs — deleting the keyboard path
    // to a file (spec §4.3).
    const surfaces = fakeSurfaces({ count: 3, total: 3, activeIndex: -1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });

    tm.cycleTab(1);
    expect(surfaces.calls).toContain("activate:0");

    tm.cycleTab(1);
    expect(surfaces.calls).toContain("activate:1");
  });

  it("T21: cycleTab wraps from the last file surface back to the first tab", async () => {
    const surfaces = fakeSurfaces({ count: 2, total: 2 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 1;
    surfaces.calls.length = 0;

    tm.cycleTab(1);

    expect(surfaces.calls).toContain("deactivate");
    expect(activeTabIndex.value).toBe(0);
  });

  it("T21: cycleTab still does nothing with exactly one surface in total", async () => {
    const surfaces = fakeSurfaces({ count: 0, total: 0 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.calls.length = 0;

    tm.cycleTab(1);

    expect(surfaces.calls).toEqual([]);
  });

  it("T22: ⌘⇧M from a file surface is a no-op with a message", async () => {
    // The transfer transaction hands over a PTY and a file tab has none.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.materialize({ layout: null, cwds: ["/b"] });
    // After the materializes: each one selects its new tab, which hands the
    // stage back to the terminal through the same seam.
    surfaces.activeIndexValue = 0;
    surfaces.calls.length = 0;

    await tm.movePaneToNewWindow();

    expect(persistError.value).toContain("terminal pane");
    expect(tabViews.value).toHaveLength(2);
  });

  it("T23: focusActive() reaches the file surface, not a hidden pane", async () => {
    // The failure mode is silent: focus lands on a pane the user cannot see
    // and their keystrokes go to a shell.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    surfaces.calls.length = 0;

    tm.focusActive();

    expect(surfaces.calls).toContain("focus");
  });

  it("T23: focusActive() still reaches the pane when a terminal tab is active", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.calls.length = 0;

    tm.focusActive();

    expect(surfaces.calls).not.toContain("focus");
  });

  it("T25: applySettings reaches the file surfaces through the same call", async () => {
    // A theme switch must not leave an open editor in the old palette until
    // it is closed and reopened.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });

    tm.applySettings(DEFAULT_SETTINGS);

    expect(surfaces.calls).toContain("applySettings");
  });

  it("save-file (⌘S) reaches the active file surface's save()", async () => {
    // Task 6 added the `save-file` registry action and keymap binding; Task 5
    // owns this dispatch table and wires the actual call — the file this
    // test lives in (dispatch-coverage.test.ts/shortcut-groups.test.ts
    // already assert the id resolves to SOMETHING dispatchable; this asserts
    // it reaches the right method).
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.calls.length = 0;

    tm.runAction("save-file");

    expect(surfaces.calls).toContain("save");
  });

  it("select-all/undo/redo offer themselves to the surface before the browser's own command", async () => {
    // The three Edit-menu commands whose native Cocoa roles cannot reach
    // Monaco (2026-08-19). They must arrive at the surface FIRST — falling
    // straight through to `document.execCommand` is exactly the defect: a
    // document-level command never touches an EditContext editor.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    surfaces.handlesEdit = true;
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.calls.length = 0;

    tm.runAction("select-all");
    tm.runAction("undo");
    tm.runAction("redo");

    expect(surfaces.calls).toEqual([
      "runEditCommand:select-all",
      "runEditCommand:undo",
      "runEditCommand:redo",
    ]);
    // Claimed by the surface, so the browser's own command must NOT also run
    // — a second select-all over the document would clobber the editor's.
    expect(exec).not.toHaveBeenCalled();
    tm.dispose();
  });

  it("a surface that declines an Edit command falls back to the browser's own", async () => {
    // The terminal, a settings field and the file tree all live here: the
    // fallback IS the behaviour the native role used to provide, so declining
    // must not leave the chord dead.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    surfaces.handlesEdit = false;
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });

    tm.runAction("select-all");
    tm.runAction("undo");

    // `selectAll`, not `select-all`: the action id is Deck's, the command name
    // is the browser's.
    expect(exec.mock.calls).toEqual([["selectAll"], ["undo"]]);
    tm.dispose();
  });

  it("selecting a terminal tab takes the stage back from a file surface", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    surfaces.calls.length = 0;

    // Same index as the already-active tab: the early return must not skip
    // handing the stage back, or the file surface stays on top forever.
    tm.selectTab(0);

    expect(surfaces.calls).toContain("deactivate");
    tm.dispose();
  });

  it("focusNextAttention's activateForAttention deactivates a file surface before acknowledging the candidate pane", async () => {
    // Same boundary as `selectTab` above, for the attention-rail's own path
    // into a tab (Task 7): jumping to a candidate PANE must return keyboard
    // focus to xterm, not leave it on a file editor that is no longer on
    // screen once the tab's terminal grid retakes the stage.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // tab 0 -> pane 1
    surfaces.activeIndexValue = 0;
    surfaces.calls.length = 0;

    tm.activateForAttention(0, 1);

    expect(surfaces.calls).toContain("deactivate");
    tm.dispose();
  });

  it("split-row via runAction is a no-op while a file surface owns the stage", async () => {
    // Task 7: Monaco focuses a plain `<div>` — `isChromeTextField` never
    // sees it — so a "pane"-tiered action must not reach the terminal tab
    // hidden behind the file surface. `allPaneIds()` reads the REAL terminal
    // pane count (T17: a file surface never contributes to it), so it stays
    // a faithful proof even though `statusInfo.paneCount` is masked to null
    // while a surface is active (T19).
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    const before = tm.allPaneIds().length;
    surfaces.activeIndexValue = 0;

    tm.runAction("split-row");
    await flush();

    expect(tm.allPaneIds().length).toBe(before); // no split happened behind the file surface
    tm.dispose();
  });

  // The other side of the guard above (2026-08-17). The dock's three toggles
  // are `scope: "pane"` for the OVERLAY half of `overlayBlocksAction` — an
  // overlay covers the column along with the grid — but they act on the chrome
  // BESIDE the stage, never on the pane behind it. The surface block caught
  // them anyway, so with a document on the stage the `DockToggle` button, the
  // drag-past-the-floor close, the View menu items and ⌘⇧B / ⌘⇧U all did
  // nothing at all, leaving the explorer stuck open with no way out.
  it("toggle-dock still opens and closes the column while a file surface owns the stage", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    expect(settings.value.dockOpen).toBe(false);

    tm.runAction("toggle-dock");
    expect(settings.value.dockOpen).toBe(true);

    tm.runAction("toggle-dock");
    expect(settings.value.dockOpen).toBe(false);
    tm.dispose();
  });

  it("toggle-explorer still reveals and puts away the column while a file surface owns the stage", async () => {
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    // Open on ANOTHER tab, so the first press has to switch rather than
    // matching a default that was already "explorer".
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "usage" };

    tm.runAction("toggle-explorer");
    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("explorer");

    tm.runAction("toggle-explorer");
    expect(settings.value.dockOpen).toBe(false);
    tm.dispose();
  });

  it("toggle-usage still reaches its App seam while a file surface owns the stage", async () => {
    const onToggleUsage = vi.fn();
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({
      deps: { surfaces, onToggleUsage },
      infos: IDLE_SHELLS,
    });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;

    tm.runAction("toggle-usage");

    expect(onToggleUsage).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it("putting the column away hands focus to the file surface, not the pane behind it", async () => {
    // Same silent failure as T23 above, reached through the dock's own close
    // branch: with a document on the stage, focusing `activeManager()` would
    // take the caret out of the editor the user is looking at and drop their
    // keystrokes into a shell they cannot see.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    tm.runAction("toggle-dock"); // open
    surfaces.calls.length = 0;

    tm.runAction("toggle-dock"); // close — this is the branch that returns focus

    expect(surfaces.calls).toContain("focus");
    tm.dispose();
  });

  it("the dock toggles are STILL blocked while Settings covers the grid", async () => {
    // The exemption is scoped to the surface half of the guard only: Settings
    // is full-window and covers the column along with the stage, so the
    // overlay-rank half must keep blocking these — that tier is why they are
    // `scope: "pane"` in the first place.
    const surfaces = fakeSurfaces({ count: 1, total: 1 });
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    surfaces.activeIndexValue = 0;
    settingsOpen.value = true;

    tm.runAction("toggle-dock");
    tm.runAction("toggle-explorer");

    expect(settings.value.dockOpen).toBe(false);
    settingsOpen.value = false;
    tm.dispose();
  });
});

/**
 * The same seam as "file surfaces in the tab strip" above, but wired to the
 * REAL `FileSurfaceController` (Task 5) instead of the fake — the fake
 * proves `TabManager` calls the right `SurfaceStrip` methods; this proves
 * the two real halves actually agree once wired, for the invariants the
 * brief names explicitly (spec §4.3): the combined cycle index space,
 * "last surface, not last tab", ⌘W closing a file tab, and ⌘1..9 staying
 * terminal-only.
 */
describe("file surfaces in the tab strip — the real FileSurfaceController (Task 5)", () => {
  const writeFile = vi.fn<FileClient["writeFile"]>(async (_root, path) => ({
    path,
    mtimeMs: 1,
    size: 1,
  }));
  const client: FileClient = {
    listDir: async () => [],
    // Real content, not `refused` — `save-file`'s test below needs
    // `document.file` populated (`savePath` early-returns on a null `file`),
    // and nothing else in this block depends on the read content.
    readFile: async () => ({
      kind: "ok",
      content: "original\n",
      eol: "lf",
      encoding: "utf-8",
      bytes: 9,
      mixedEol: false,
      readOnly: false,
      reason: null,
      mtimeMs: 1,
      size: 9,
      writable: true,
    }),
    writeFile,
    statFiles: async (_root, paths) =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
    watchPaths: async () => {},
    setDirtyFiles: async () => {},
    listenFileChanged: async () => () => {},
  };

  let surfaces: FileSurfaceController;

  beforeEach(() => {
    resetFileSurfaces();
    writeFile.mockClear();
    surfaces = createFileSurfaceController({ client });
  });

  afterEach(() => {
    surfaces.dispose();
    resetFileSurfaces();
  });

  it("⌘⇧] / ⌘⇧[ cycle across the combined index space and wrap both ways", async () => {
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/one.ts", true);
    await surfaces.openFile("/a", "/a/two.ts", true);
    surfaces.deactivate(); // back on the terminal tab, two file tabs waiting

    tm.runAction("next-tab");
    expect(surfaces.activeIndex()).toBe(0);

    tm.runAction("next-tab");
    expect(surfaces.activeIndex()).toBe(1);

    tm.runAction("next-tab");
    expect(surfaces.activeIndex()).toBe(-1); // wraps back to the terminal tab
    expect(activeTabIndex.value).toBe(0);

    tm.runAction("prev-tab");
    expect(surfaces.activeIndex()).toBe(1); // wraps the other way too

    tm.dispose();
  });

  it('"last surface, not last tab": closing the only terminal tab keeps the window open on a file surface', async () => {
    const before = windowCloseCalls.length;
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/one.ts", true);
    surfaces.deactivate();

    await tm.closeTab(0);

    expect(windowCloseCalls.length).toBe(before); // window stayed open
    expect(surfaces.activeIndex()).toBe(0); // the file tab took the stage
    expect(tabViews.value).toHaveLength(0);

    tm.dispose();
  });

  it("⌘W closes the active file tab, never the pane behind it", async () => {
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/one.ts", true);

    tm.runAction("close-pane");
    await vi.waitFor(() => expect(surfaces.count()).toBe(0));

    expect(tabViews.value).toHaveLength(1); // the terminal tab/pane is untouched

    tm.dispose();
  });

  it("⌘1..9 count CHIPS, so a digit can land on a file (2026-08-16)", async () => {
    // Reversed on 2026-08-16 with the merged strip: the digits used to stay
    // terminal-only, which meant ⌘2 did nothing at all on a window whose
    // second chip was a document. "The second chip" now means the same thing
    // to the keymap as it does to the eye (DL-18.6).
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // chip 1
    await surfaces.openFile("/a", "/a/one.ts", true); // chip 2
    await surfaces.openFile("/a", "/a/two.ts", true); // chip 3

    tm.runAction("select-tab-2");
    expect(surfaces.activeIndex()).toBe(0); // the first file tab

    tm.runAction("select-tab-3");
    expect(surfaces.activeIndex()).toBe(1);

    // ⌘9 takes the LAST chip, wherever it sits and whatever kind it is.
    tm.runAction("select-tab-1");
    expect(surfaces.activeIndex()).toBe(-1);
    tm.runAction("select-last-tab");
    expect(surfaces.activeIndex()).toBe(1);

    // An index past the end of the strip is still a no-op.
    tm.runAction("select-tab-8");
    expect(surfaces.activeIndex()).toBe(1);
    expect(activeTabIndex.value).toBe(0);

    tm.dispose();
  });

  it("a file opened BEFORE a terminal tab takes the earlier digit", async () => {
    // The projection the strip paints and the one the keymap walks are the
    // same merge, so this cannot drift into "the eye says 1, ⌘1 says 2".
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/first.ts", true); // chip 2 for now
    await tm.materialize({ layout: null, cwds: ["/a"] }); // opened last → chip 3

    tm.runAction("select-tab-2");
    expect(surfaces.activeIndex()).toBe(0); // the file, not the second terminal

    tm.runAction("select-tab-3");
    expect(surfaces.activeIndex()).toBe(-1);
    expect(activeTabIndex.value).toBe(1);

    tm.dispose();
  });

  it("select-tab-1 switches back to the terminal tab and deactivates the file surface", async () => {
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/one.ts", true);
    expect(surfaces.activeIndex()).toBe(0);

    tm.runAction("select-tab-1");

    expect(surfaces.activeIndex()).toBe(-1);
    expect(activeTabIndex.value).toBe(0);

    tm.dispose();
  });

  it("save-file (⌘S) writes the active file tab through the real controller", async () => {
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await surfaces.openFile("/a", "/a/one.ts", true);

    tm.runAction("save-file");
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));

    expect(writeFile.mock.calls[0]?.[1]).toBe("/a/one.ts");
    tm.dispose();
  });

  it("save-file (⌘S) is a genuine no-op — spec §4.3 — while a terminal tab is active", async () => {
    const { tm } = setup({ deps: { surfaces }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: ["/a"] }); // no file ever opened

    tm.runAction("save-file");
    await flush();

    expect(writeFile).not.toHaveBeenCalled();
    tm.dispose();
  });
});

/**
 * Performable keybindings — `handleShortcut` asks `isActionPerformable`
 * BEFORE `preventDefault()`, so a binding that cannot do anything behaves as
 * if it did not exist and the key continues to whatever holds focus.
 * See docs/specs/2026-08-20-performable-keybindings-design.md.
 *
 * Driving `window` through the pane's own textarea is the real path: the
 * listener is capture-phase on `window`, so a chord that IS consumed never
 * reaches the downstream listener, and one that is not consumed does — which
 * is precisely what "xterm encodes the interrupt itself" means here.
 */
describe("performable chords (Ctrl+C copies or falls through)", () => {
  /** The Windows keymap is where the conditional Ctrl+C lives; macOS is untouched. */
  function useWindows(): void {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
  }

  function terminalInput(): HTMLTextAreaElement {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="fake-terminal-input"]',
    );
    if (input === null) {
      throw new Error("Expected the fake terminal input to be mounted");
    }
    return input;
  }

  function press(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it("does not consume Ctrl+C when the terminal has no selection", async () => {
    useWindows();
    const copySelection = vi.fn();
    const { tm } = setup({ paneOverrides: { copySelection }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });
    // handleShortcut is only attached as a window listener once init() runs.
    await tm.init();
    const input = terminalInput();
    const downstream = vi.fn();
    input.addEventListener("keydown", downstream);

    const event = press(input, { key: "c", ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(copySelection).not.toHaveBeenCalled();
    // The key reached the pane, which is where xterm would encode the
    // interrupt. Deck writes no `\x03` of its own.
    expect(downstream).toHaveBeenCalledTimes(1);
    expect(downstream).toHaveBeenLastCalledWith(event);
    tm.dispose();
  });

  it("consumes Ctrl+C and clears the selection when there is one", async () => {
    useWindows();
    const copySelection = vi.fn();
    const { tm } = setup({
      paneOverrides: { copySelection, selection: true },
      infos: IDLE_SHELLS,
    });
    await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });
    await tm.init();
    const input = terminalInput();
    const downstream = vi.fn();
    input.addEventListener("keydown", downstream);

    const first = press(input, { key: "c", ctrlKey: true });

    expect(first.defaultPrevented).toBe(true);
    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(downstream).not.toHaveBeenCalled();

    // The clear is what makes the SECOND press an interrupt instead of a
    // second copy — spec D3, the two-press cancel.
    const second = press(input, { key: "c", ctrlKey: true });

    expect(second.defaultPrevented).toBe(false);
    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(downstream).toHaveBeenCalledTimes(1);
    tm.dispose();
  });

  it("does not consume Ctrl+Shift+C while a file surface owns the stage", async () => {
    useWindows();
    const copySelection = vi.fn();
    const surfaces = fakeSurfaces({ count: 1, total: 1, activeIndex: 0 });
    const { tm } = setup({
      deps: { surfaces },
      paneOverrides: { copySelection, selection: true },
      infos: IDLE_SHELLS,
    });
    await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });
    await tm.init();
    // After materialize, exactly as every other surface test here does it —
    // materializing a terminal tab deactivates the strip.
    surfaces.activeIndexValue = 0;
    const input = terminalInput();

    // Upper-case `key` on purpose: Shift is held, and matchBinding lowercases.
    const event = press(input, { key: "C", ctrlKey: true, shiftKey: true });

    // Falling through is the point: Chromium's own copy must reach Monaco,
    // which the old order swallowed and then blocked (spec, the latent defect).
    expect(event.defaultPrevented).toBe(false);
    expect(copySelection).not.toHaveBeenCalled();
    tm.dispose();
  });

  it("still consumes Ctrl+Shift+C inside a terminal with nothing selected", async () => {
    useWindows();
    const copySelection = vi.fn();
    const { tm } = setup({ paneOverrides: { copySelection }, infos: IDLE_SHELLS });
    await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });
    await tm.init();
    const input = terminalInput();

    const event = press(input, { key: "C", ctrlKey: true, shiftKey: true });

    // Stage-conditional but NOT selection-conditional (spec D2): nothing else
    // wants this chord, and leaking it into an agent TUI is unspecified.
    expect(event.defaultPrevented).toBe(true);
    expect(copySelection).toHaveBeenCalledTimes(1);
    tm.dispose();
  });
});
