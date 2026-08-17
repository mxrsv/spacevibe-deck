// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentQuickPickerOpen,
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
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
// reset, not a per-describe one like `boardOpen`'s scattered resets in the
// overlay-guard split file, because leaving it true after whichever test
// exercises "new-tab" would silently rank every later test's
// `openOverlayRanks()` at "modal", failing unrelated pane-tiered assertions
// with no visible connection to the cause.
afterEach(() => {
  agentQuickPickerOpen.value = false;
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
