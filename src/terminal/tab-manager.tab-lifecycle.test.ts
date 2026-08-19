// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";
import { agentQuickPickerOpen } from "../chrome/events";
import type { TabManager } from "./tab-manager";
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
      [1, processInfo(1, "/repo", "codex", "agent", "codex")],
      [2, processInfo(2, "/repo", "claude", "agent", "claude")],
      [3, processInfo(3, "/repo", "claude", "agent", "claude")],
      [4, processInfo(4, "/other", "npm", "busy", null)],
    ]);
    const { tm, pty } = setup({ infos });
    // Tab 0: three panes — Codex plus two Claude panes, so identity aggregation
    // also proves that one CLI is listed once rather than once per pane.
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
      workspacePath: "/repo",
    });
    await tm.splitActive("row");
    await tm.splitActive("column");
    // Tab 1: a single pane running npm — busy, but not an agent. Opening it
    // polls again, and that poll now covers tab 0's background pane too.
    await tm.openFromPreset({ type: "leaf" }, ["/other"], {
      workspacePath: "/other",
    });
    await tm.init(); // registers the pty output listener activity feeds on
    await flush();

    // An agent sitting idle at its prompt is NOT busy — no spinner.
    expect(tabViews.value[0].agentBusy).toBe(false);
    expect(tabViews.value[0]).toMatchObject({ agents: ["codex", "claude"] });
    expect(tabViews.value[1]).toMatchObject({ agents: [] });

    // Claude reports busy via OSC 9;4 from tab 0's background pane.
    pty.emitOutput(2, "\x1b]9;4;3\x07");
    expect(tabViews.value[0].agentBusy).toBe(true);
    expect(tabViews.value[1].agentBusy).toBe(false);

    // The clear report ends the spinner even though output just arrived.
    pty.emitOutput(2, "done.\x1b]9;4;0\x07");
    expect(tabViews.value[0].agentBusy).toBe(false);
    expect(tabViews.value[0]).toMatchObject({ agents: ["codex", "claude"] });

    // npm output never lights the spinner — not an agent.
    pty.emitOutput(4, "installing...");
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

  it("projects every pane of the tab with its id, agent and tracker state", async () => {
    // The per-tab rollup cannot name the pane behind a mark, and the agent
    // rail's chips and expanded rows both activate an EXACT pane
    // (`docs/specs/2026-08-16-agent-status-rail-design.md` §2.2). `TabView.panes`
    // is that projection; a shell pane stays in it because filtering rows is
    // the rail's job, not the projection's.
    vi.useFakeTimers();
    try {
      const infos = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", "claude", "agent", "claude")],
        [2, processInfo(2, "/repo", "zsh", "idle-shell", null)],
      ]);
      const { tm, pty } = setup({ infos });
      await tm.init();
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], {
        workspacePath: "/repo",
      });
      await tm.splitActive("row"); // pane 2, a plain shell beside the agent
      await vi.advanceTimersByTimeAsync(2000); // both panes polled, gate open

      pty.emitOutput(1, "\x1b]9;4;3\x07"); // Claude reports it is working

      expect(tabViews.value[0].panes).toEqual([
        {
          paneId: 1,
          agent: "claude",
          attention: "none",
          phase: "working",
          changedAt: expect.any(Number),
          // The tracker's gate opened and this pane has produced a run, which
          // is what separates the rail's `done` from its `idle`.
          hasRun: true,
        },
        // Polled and recognised as a shell: no agent identity, and the
        // tracker's gate never opened for it, so nothing latched, the phase is
        // still `unknown` and it has never run.
        {
          paneId: 2,
          agent: null,
          attention: "none",
          phase: "unknown",
          changedAt: 0,
          hasRun: false,
        },
      ]);
      expect(tabViews.value[0].panes?.[0].changedAt).toBeGreaterThan(0);

      // Attention latches on its own axis: the pane is still working.
      pty.emitOutput(1, "\x1b]9;4;2\x07");
      expect(tabViews.value[0].panes?.[0]).toMatchObject({
        paneId: 1,
        attention: "error",
        phase: "working",
      });
      expect(tabViews.value[0].panes?.[1].attention).toBe("none");

      tm.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createTabManager captureSession (session journal)", () => {
  it("captures every tab with polled cwd/agent and its chrome fields", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/w/a", "claude", "agent", "claude")],
    ]);
    const { tm } = setup({ infos });
    await tm.openFromPreset({ type: "leaf" }, ["/w/a"], {
      workspacePath: "/w/a",
    });
    // Second tab has no workspace and no info for its pane — the poller
    // never learns about id 2, so its snapshot stays unknown.
    await tm.openFromPreset({ type: "leaf" }, [null], {});
    await flush(); // let materialize's `void poller.poll()` resolve

    expect(tm.captureSession()).toEqual([
      {
        workspacePath: "/w/a",
        layout: { type: "leaf" },
        panes: [{ cwd: "/w/a", agent: "claude", launchCommand: null }],
        // Always null since 2026-08-16: `renameTab` went with `TabPopover`,
        // so nothing can set a name any more. The FIELD stays because the
        // snapshot shape is shared with the transfer payload.
        name: null,
        dotColor: null,
      },
      {
        workspacePath: null,
        layout: { type: "leaf" },
        panes: [{ cwd: null, agent: null, launchCommand: null }],
        name: null,
        dotColor: null,
      },
    ]);
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
