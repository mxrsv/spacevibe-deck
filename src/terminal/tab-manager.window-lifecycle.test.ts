// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryTransferClient } from "./transfer-client";
import type { TabManagerDeps } from "./tab-manager";
import { agentQuickPickerOpen } from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
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

describe("TabManager window lifecycle", () => {
  async function windowSetup(deps: Partial<TabManagerDeps> = {}) {
    const transfer = createMemoryTransferClient();
    const { tm, pty } = setup({
      infos: new Map<number, PaneProcessInfo>([
        [1, processInfo(1, null, "zsh", "idle-shell", null)],
      ]),
      deps: { transfer, closeWindow: async () => {}, ...deps },
    });
    // Without init() the cross-window listeners are never registered and any
    // assertion about `transfer.moveToWindow` is vacuously true.
    await tm.init();
    return { tm, pty, transfer };
  }

  it("removes the emptied tab after a pane moves out, without pushing it onto the reopen stack", async () => {
    const { tm, transfer } = await windowSetup();
    // Two tabs: the window survives the move, so the guard does not fire and
    // the emptied tab is what this test is about.
    await tm.materialize({ layout: null, cwds: [] });
    await tm.materialize({ layout: null, cwds: [] });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(tabViews.value).toHaveLength(1);
    await tm.reopenTab();
    expect(tabViews.value).toHaveLength(1);
  });

  it("stages the workspace the pane carried, not nulls", async () => {
    const { tm, transfer } = await windowSetup();
    await tm.materialize({ layout: null, cwds: [] });
    await tm.materialize({ layout: null, cwds: [], workspacePath: "/work" });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    // Spec §10.2: the tab identity moves WITH the pane. Without the
    // `identity` wiring `workspacePath` is null and every other test in this
    // file still passes — which is why this one exists. The `tabName`/
    // `dotColor` half of that payload is dormant since 2026-08-16: the
    // plumbing is untouched, but `renameTab`/`setTabDotColor` went with
    // `TabPopover`, so nothing can put a value in it to carry across.
    await expect(transfer.claimTransfer("xfer-1")).resolves.toMatchObject({
      tabName: null,
      dotColor: null,
      workspacePath: "/work",
    });
  });

  it("keeps the tab when the move aborts", async () => {
    const { tm, transfer } = await windowSetup();
    await tm.materialize({ layout: null, cwds: [] });
    await tm.materialize({ layout: null, cwds: [] });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "aborted", reason: "claim-failed" });
    await promise;

    expect(tabViews.value).toHaveLength(2);
  });

  it("adopts an offered pane into a new tab of a running window", async () => {
    const { tm, transfer } = await windowSetup();
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
    const { tm, transfer } = await windowSetup();
    await tm.materialize({ layout: null, cwds: [] });

    // What the listener would receive for a malformed emit: no label at all.
    transfer.moveToWindow("");

    expect(transfer.calls).toEqual([]);
    expect(tabViews.value).toHaveLength(1);
  });
});

describe("TabManager move-to-new-window guard", () => {
  async function guardSetup() {
    const transfer = createMemoryTransferClient();
    const { tm } = setup({
      infos: new Map<number, PaneProcessInfo>([
        [1, processInfo(1, null, "zsh", "idle-shell", null)],
        [2, processInfo(2, null, "zsh", "idle-shell", null)],
      ]),
      deps: { transfer, closeWindow: async () => {} },
    });
    await tm.init();
    return { tm, transfer };
  }

  it("refuses to move the window's only pane into a new window", async () => {
    // Moving it would close this window and open another holding the same
    // pane: the window is swapped, its geometry lost, and the pane risked
    // through a whole transaction for no observable change.
    const { tm, transfer } = await guardSetup();
    await tm.materialize({ layout: null, cwds: [] });

    await tm.movePaneToNewWindow();

    expect(transfer.calls).toEqual([]);
    expect(tabViews.value).toHaveLength(1);
  });

  it("allows it when another tab keeps the window alive", async () => {
    // The condition is WINDOW-level, not tab-level: a second tab means the
    // window survives, so splitting this tab out is a real move.
    const { tm, transfer } = await guardSetup();
    await tm.materialize({ layout: null, cwds: [] });
    await tm.materialize({ layout: null, cwds: [] });

    const promise = tm.movePaneToNewWindow();
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await promise;

    expect(tabViews.value).toHaveLength(1);
  });

  it("still offers the only pane to an EXISTING window", async () => {
    // Merging into another window is meaningful even from a one-pane window:
    // the pane lands there and this window closes. Only the new-window path
    // is guarded.
    const { tm, transfer } = await guardSetup();
    await tm.materialize({ layout: null, cwds: [] });

    transfer.moveToWindow("deck-2");
    await vi.waitFor(() => expect(transfer.calls).toContain("await:xfer-1"));
    transfer.settle("xfer-1", { kind: "committed" });
    await vi.waitFor(() =>
      expect(transfer.calls).toContain("offer:xfer-1:deck-2"),
    );
  });
});
