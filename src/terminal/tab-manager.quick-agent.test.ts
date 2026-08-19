// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import { activeTabIndex, tabViews } from "./tabs-store";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { freshWindowFocusController, wire } from "./tab-manager.fixtures";
import type { LaunchProfile } from "../lib/launch-profile";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

const plan: LaunchProfile = {
  id: "lp:plan",
  name: "Plan",
  options: { kind: "claude", model: null, permissionMode: "plan" },
};

/**
 * `openQuickAgent`'s third argument has THREE states, and the difference is
 * what these tests pin: omitted resolves the agent's default profile, an
 * explicit `null` launches bare even when a default exists, and an id picks
 * that profile. Two states would make the default unreachable from every
 * caller that does not pass one.
 */
describe("createTabManager openQuickAgent launch profiles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settings.value = DEFAULT_SETTINGS;
    windowFocus = freshWindowFocusController();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    document.body.innerHTML = "";
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    tabViews.value = [];
    activeTabIndex.value = -1;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopEnvironmentForTests();
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  });

  function build() {
    const pty = createMemoryPtyClient({
      nextId: 1,
      agents: [
        { name: "claude", path: "/bin/claude" },
        { name: "gemini", path: "/bin/gemini" },
      ],
    });
    return { pty, ...wire(pty) };
  }

  function withProfiles(defaults: Readonly<Record<string, string>>): void {
    settings.value = {
      ...DEFAULT_SETTINGS,
      launchProfiles: [plan],
      defaultLaunchProfiles: defaults,
    };
  }

  it("types the chosen profile's command into the new pane", async () => {
    const { tm, pty } = build();
    withProfiles({});

    await tm.openQuickAgent("claude", null, "lp:plan");
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([
      { id: 1, data: "claude --permission-mode plan\r" },
    ]);
    tm.dispose();
  });

  it("falls back to the agent's default profile when none is passed", async () => {
    const { tm, pty } = build();
    withProfiles({ claude: "lp:plan" });

    await tm.openQuickAgent("claude");
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([
      { id: 1, data: "claude --permission-mode plan\r" },
    ]);
    tm.dispose();
  });

  it("launches bare when the caller passes an explicit null profile", async () => {
    const { tm, pty } = build();
    withProfiles({ claude: "lp:plan" });

    await tm.openQuickAgent("claude", null, null);
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([{ id: 1, data: "claude\r" }]);
    tm.dispose();
  });

  it("leaves an agent with no profiles on its bare command", async () => {
    const { tm, pty } = build();
    withProfiles({ claude: "lp:plan" });

    await tm.openQuickAgent("gemini");
    await vi.advanceTimersByTimeAsync(3000);

    expect(pty.writes).toEqual([{ id: 1, data: "gemini\r" }]);
    tm.dispose();
  });

  it("remembers the options a pane launched with", async () => {
    const { tm } = build();
    withProfiles({});

    await tm.openQuickAgent("claude", null, "lp:plan");
    await vi.advanceTimersByTimeAsync(3000);

    expect(tm.launchOptionsFor(1)).toEqual({
      kind: "claude",
      model: null,
      permissionMode: "plan",
    });
    tm.dispose();
  });

  it("reports no options for a pane launched without a profile", async () => {
    const { tm } = build();
    withProfiles({});

    await tm.openQuickAgent("claude", null, null);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tm.launchOptionsFor(1)).toBeNull();
    tm.dispose();
  });
});
