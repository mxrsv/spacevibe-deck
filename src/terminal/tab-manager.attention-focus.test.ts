// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { agentQuickPickerOpen } from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { flush, freshWindowFocusController, processInfo, setup } from "./tab-manager.fixtures";

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

// Task 11B: the private attention-navigation primitive. The window mock's
// `initialFocused` defaults to true (foreground), so every ack below fires —
// see the window-focus describe (`tab-manager.attention-tracker.test.ts`)
// for the controller itself.
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
