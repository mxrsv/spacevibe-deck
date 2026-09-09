// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import { activeTabIndex, tabViews } from "./tabs-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { freshWindowFocusController, wire } from "./tab-manager.fixtures";

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

/**
 * `splitInWorkspace` — the seam a worktree card's `New split here` row rides
 * (`docs/internals/agent-rail.md`).
 *
 * The rule under test is CONTAINMENT: the card that raises the row groups its
 * tabs by `worktreeForPath`'s longest-prefix match, so a tab whose cwd is a
 * subdirectory of the checkout shows its agents on that checkout's card. An
 * exact `workspacePath === target` therefore missed it and materialized a
 * second tab instead of splitting the one the user was looking at, which the
 * row's own detail line ("Open a pane beside this tab") denies.
 */
describe("createTabManager splitInWorkspace", () => {
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
      agents: [{ name: "claude", path: "/bin/claude" }],
    });
    return { pty, ...wire(pty) };
  }

  it("splits an exactly-matching tab rather than opening a second one", async () => {
    const { tm } = build();
    await tm.openQuickAgent("claude", "/repo/wt");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tabViews.value).toHaveLength(1);

    expect(await tm.splitInWorkspace("/repo/wt")).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tabViews.value).toHaveLength(1);
    expect(tabViews.value[0]?.panes?.length ?? 0).toBeGreaterThan(1);
    tm.dispose();
  });

  it("splits a tab whose cwd is INSIDE the checkout, not a new tab beside it", async () => {
    // The card for `/repo/wt` shows this tab's agents, because `buildRail`
    // attaches a tab to its checkout by longest prefix. Before 2026-08-31 the
    // exact match found nothing and this produced a second tab.
    const { tm } = build();
    await tm.openQuickAgent("claude", "/repo/wt/packages/web");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tabViews.value).toHaveLength(1);

    expect(await tm.splitInWorkspace("/repo/wt")).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tabViews.value).toHaveLength(1);
    expect(tabViews.value[0]?.panes?.length ?? 0).toBeGreaterThan(1);
    tm.dispose();
  });

  it("prefers the checkout's own tab over a nested one", async () => {
    const { tm } = build();
    await tm.openQuickAgent("claude", "/repo/wt/packages/web");
    await vi.advanceTimersByTimeAsync(3000);
    await tm.openQuickAgent("claude", "/repo/wt");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tabViews.value).toHaveLength(2);

    expect(await tm.splitInWorkspace("/repo/wt")).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    // The exact match wins, so the nested tab is untouched.
    expect(tabViews.value).toHaveLength(2);
    expect(tabViews.value[0]?.panes).toHaveLength(1);
    expect(tabViews.value[1]?.panes?.length ?? 0).toBeGreaterThan(1);
    tm.dispose();
  });

  it("materializes when the checkout has nothing open at all", async () => {
    const { tm } = build();

    expect(await tm.splitInWorkspace("/repo/other")).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    // Spec §11.1's named departure: a fresh tab's single pane IS the pane the
    // row promised, so it materializes and STOPS.
    expect(tabViews.value).toHaveLength(1);
    expect(tabViews.value[0]?.panes).toHaveLength(1);
    tm.dispose();
  });

  it("does not treat a sibling with a shared name prefix as inside the checkout", async () => {
    // `/repo/wt-old` starts with `/repo/wt` as a STRING but is a different
    // checkout, which is why the test is `${target}/` and not `${target}`.
    const { tm } = build();
    await tm.openQuickAgent("claude", "/repo/wt-old");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tabViews.value).toHaveLength(1);

    expect(await tm.splitInWorkspace("/repo/wt")).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);

    expect(tabViews.value).toHaveLength(2);
    expect(tabViews.value[0]?.panes).toHaveLength(1);
    tm.dispose();
  });
});
