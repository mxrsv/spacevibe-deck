// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pane } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import { ACTION_REGISTRY } from "./action-registry";
import {
  agentQuickPickerOpen,
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
  shortcutCaptureActive,
} from "../chrome/events";
import { activeTabIndex, tabViews, statusInfo } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { fakePane, flush, freshWindowFocusController, setup } from "./tab-manager.fixtures";

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
    shortcutCaptureActive.value = false;
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

  // The Shortcuts settings row records a chord by listening for the raw
  // keydown. `handleShortcut` is a CAPTURE-phase window listener registered at
  // app start, so the capture control cannot out-listen it — without this gate
  // the keystroke runs its own action first, and rebinding ⌘W would close the
  // pane instead of being recorded.
  it("⌘W does nothing while a Shortcuts row is recording a replacement chord", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: ["/a"] });
    await tm.splitActive("row");
    await tm.init();
    await flush();
    expect(statusInfo.value.paneCount).toBe(2);

    shortcutCaptureActive.value = true;
    // The motivating case: ⌘W is `close-pane`, so recording it must not kill
    // the pane the user is looking at.
    window.dispatchEvent(metaKeydown("w"));
    await flush();
    expect(statusInfo.value.paneCount).toBe(2);
    // …and a non-destructive chord is just as gated.
    window.dispatchEvent(metaKeydown("d"));
    await flush();
    expect(statusInfo.value.paneCount).toBe(2);

    // The gate releases: it must not be able to disable the app silently.
    shortcutCaptureActive.value = false;
    window.dispatchEvent(metaKeydown("d"));
    await flush();
    expect(statusInfo.value.paneCount).toBe(3);

    tm.dispose();
  });

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

  it("new-tab still raises AgentQuickPicker while Settings is open — harmless, so it is not gated", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    agentQuickPickerOpen.value = false;
    settingsOpen.value = true;

    tm.runAction("new-tab");
    await flush();

    expect(agentQuickPickerOpen.value).toBe(true);

    tm.dispose();
  });

  // F2 (2026-07-27 code review): new-tab used to be scope "always", which
  // bypassed the guard UNCONDITIONALLY — including while a PresetEditor/
  // SavePresetDialog draft was up. That let Cmd+T (or the menu's "New Tab")
  // mount an overlay underneath the modal scrim (z-40 > board's z-30): its
  // own mount-focus effect then stole DOM focus away from the live draft, so
  // a later Enter could silently act on something behind it. Still true now
  // that new-tab opens AgentQuickPicker (also rank "modal") instead of the
  // board — the "board" scope (rank 30) blocks both.
  it("new-tab is now blocked while a PresetEditor draft is open (F2 — 'always' used to bypass every overlay, not just the board)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    agentQuickPickerOpen.value = false;

    editorRequest.value = { source: "live" };
    tm.runAction("new-tab");
    await flush();

    expect(agentQuickPickerOpen.value).toBe(false);

    editorRequest.value = null;
    tm.dispose();
  });

  it("new-tab is blocked while the SavePresetDialog is open too (F2)", async () => {
    const { tm } = setup({});
    await tm.init();
    await flush();
    agentQuickPickerOpen.value = false;

    saveDialogOpen.value = true;
    tm.runAction("new-tab");
    await flush();

    expect(agentQuickPickerOpen.value).toBe(false);

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
  for (const action of ["select-tab-1", "select-last-tab", "next-tab", "prev-tab"] as const) {
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
    const alwaysActions = ACTION_REGISTRY.filter((a) => a.scope === "always").map((a) => a.id);
    // The updater rows are app-level menu actions intercepted by App before
    // TabManager.runAction; "always" records that overlays must not disable
    // either manual update checks or the web Release Notes link.
    expect(new Set(alwaysActions)).toEqual(
      new Set([
        "check-for-updates",
        "focus-next-attention",
        "open-release-notes",
        // The Edit menu's three (2026-08-19). "always" for a third reason
        // beyond this list's other two: they act on whatever holds the caret
        // and never on the pane, so the "pane" tier — which blocks the moment
        // a file surface takes the stage — would block them exactly where the
        // editor needs them.
        "select-all",
        "undo",
        "redo",
        "toggle-settings",
        // `toggle-usage` LEFT this set on 2026-08-16. It was "always"
        // because the usage screen pushed an overlay rank that would have
        // blocked the only action able to close it; as a dock tab it pushes
        // no rank, so it takes the ordinary "pane" tier again.
        //
        // `open-tab-options` LEFT it on 2026-08-16 with `TabPopover` itself.
      ]),
    );
  });
});
