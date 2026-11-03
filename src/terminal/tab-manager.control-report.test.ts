// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { PaneAttentionReport } from "../lib/pane-attention-report";
import { agentQuickPickerOpen } from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { flush, processInfo, setup, setupControllable } from "./tab-manager.fixtures";

// The production notifier sends through this adapter; keep every test off the real native API.
vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// init() reads window focus and installs the file-drop listener through the window facade.
vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => true,
    onFocusChanged: async () => () => {},
  }),
}));

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = 0;
  settings.value = DEFAULT_SETTINGS;
});

afterEach(() => {
  agentQuickPickerOpen.value = false;
  vi.restoreAllMocks();
});

function claudePane(): Map<number, PaneProcessInfo> {
  return new Map([[1, processInfo(1, "/repo", "claude", "agent", "claude")]]);
}

describe("createTabManager reports pane state to main (ORC17)", () => {
  it("sends one report with the flat keys when a pane's phase changes", async () => {
    const reports: PaneAttentionReport[] = [];
    const { tm, pty } = setup({
      infos: claudePane(),
      deps: { reportPaneAttention: (report) => reports.push(report) },
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await tm.init();
    await flush();
    const before = reports.length;

    pty.emitOutput(1, "\x1b]9;4;1\x07"); // the agent says it is working

    expect(reports).toHaveLength(before + 1);
    expect(reports.at(-1)).toEqual({
      paneId: 1,
      phase: "working",
      attention: "none",
      source: null,
      confidence: "explicit",
      agent: "claude",
      pid: 1000,
    });
    tm.dispose();
  });

  it("sends nothing while the state stays the same, whatever else makes the views sync", async () => {
    const reports: PaneAttentionReport[] = [];
    const { tm, pty } = setup({
      infos: claudePane(),
      deps: { reportPaneAttention: (report) => reports.push(report) },
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await tm.init();
    await flush();
    pty.emitOutput(1, "\x1b]9;4;1\x07");
    const settled = reports.length;

    pty.emitOutput(1, "\x1b]9;4;1\x07"); // the same progress again
    pty.emitOutput(1, "plain output");
    await tm.selectTab(0);
    await flush();

    expect(reports).toHaveLength(settled);
    tm.dispose();
  });

  it("reports the end of a turn, then the agent leaving the pane", async () => {
    const infoByPane = claudePane();
    const reports: PaneAttentionReport[] = [];
    const { tm, pty } = setupControllable(infoByPane, {
      reportPaneAttention: (report) => reports.push(report),
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await tm.init();
    await flush();
    pty.emitOutput(1, "\x1b]9;4;1\x07");
    pty.emitOutput(1, "\x1b]9;4;0\x07"); // the CLI's own clear: the turn is over

    expect(reports.at(-1)).toMatchObject({
      phase: "idle",
      attention: "completed",
      agent: "claude",
    });

    pty.emitExit(1);
    expect(reports.at(-1)).toMatchObject({ phase: "exited", agent: "claude" });
    tm.dispose();
  });

  it("reports a plain shell pane as unknown with no agent", async () => {
    const reports: PaneAttentionReport[] = [];
    const infos = new Map([[1, processInfo(1, "/repo", "zsh", "idle-shell", null)]]);
    const { tm } = setup({
      infos,
      deps: { reportPaneAttention: (report) => reports.push(report) },
    });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await tm.init();
    await flush();

    expect(reports.at(-1)).toEqual({
      paneId: 1,
      phase: "unknown",
      attention: "none",
      source: null,
      confidence: "unknown",
      agent: null,
      pid: null,
    });
    tm.dispose();
  });

  it("sends nothing when the reports are turned off", async () => {
    const { tm, pty } = setup({ infos: claudePane(), deps: { reportPaneAttention: null } });
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await tm.init();
    await flush();
    expect(() => pty.emitOutput(1, "\x1b]9;4;1\x07")).not.toThrow();
    tm.dispose();
  });

  it("keeps working where the host bridge is absent: no throw, one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("__deckHost", undefined);
    try {
      const { tm, pty } = setup({ infos: claudePane() });
      await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
      await tm.init();
      await flush();
      expect(() => pty.emitOutput(1, "\x1b]9;4;1\x07")).not.toThrow();
      expect(() => pty.emitOutput(1, "\x1b]9;4;0\x07")).not.toThrow();
      expect(tabViews.value[0].attention?.kind).toBe("completed");
      const skipped = warn.mock.calls.filter(([line]) =>
        String(line).includes("pane_attention_report skipped"),
      );
      // Exactly one: zero would mean the production default was never wired to the facade.
      expect(skipped).toHaveLength(1);
      tm.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
