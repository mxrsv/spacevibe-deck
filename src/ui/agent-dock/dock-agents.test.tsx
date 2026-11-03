// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dock's import graph reaches the host (settings, sessions, repositories): stub it as the
// dock's own tests do.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));

import { activeWorkspace } from "../../files/file-surface-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import {
  activeTabIndex,
  statusInfo,
  tabViews,
  type PaneView,
  type TabView,
} from "../../terminal/tabs-store";
import { mount } from "../controls/preset-test-kit";
import { testFileBodies } from "./dock-files-test-kit";
import { AgentDock } from "./agent-dock";
import { resetAgentDockState } from "./agent-dock-state";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const NOW = 1_800_000_000_000;

const pane = (overrides: Partial<PaneView> = {}): PaneView => ({
  paneId: 11,
  agent: "claude",
  attention: "none",
  phase: "idle",
  hasRun: true,
  changedAt: NOW,
  ...overrides,
});

const tab = (overrides: Partial<TabView> = {}): TabView => ({
  key: 1,
  process: "node",
  name: "token refresh",
  dotColor: null,
  workspacePath: "/r/main",
  agents: [],
  agentBusy: false,
  unread: false,
  panes: [pane()],
  ...overrides,
});

async function resizeTo(width: number): Promise<void> {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

const sections = (): (string | null)[] =>
  [...document.body.querySelectorAll("section[aria-label]")].map((s) =>
    s.getAttribute("aria-label"),
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  settings.value = DEFAULT_SETTINGS;
  activeWorkspace.value = "/r/main";
  statusInfo.value = { branch: null, cwd: null, agent: null, paneCount: 1, home: "/home/test" };
  activeTabIndex.value = 0;
  resetAgentDockState();
  resetRevealDockTabForTests();
  await resizeTo(1440);
});

afterEach(async () => {
  await resizeTo(1024);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  tabViews.value = [];
  activeTabIndex.value = -1;
  activeWorkspace.value = null;
  resetAgentDockState();
});

describe("the order of the dock", () => {
  it("is the strip above the body, with no space list and no Ask banner (the rail row asks)", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, focused: true, attention: "requested" }),
          pane({ paneId: 12, agent: "codex" }),
        ],
      }),
    ];
    const view = await mount(
      <AgentDock
        entered
        onClose={() => {}}
        bodies={{
          changes: {
            watch: () => null,
            section: () => <p>changes body</p>,
            count: () => null,
          },
          files: testFileBodies(),
          usage: () => <p>usage body</p>,
          history: () => <p>history body</p>,
        }}
      />,
    );
    expect(sections()).toEqual([]);
    const column = document.body.querySelector(".agent-dock__column") as HTMLElement;
    const order = [...column.children].map(
      (child) => child.getAttribute("aria-label") ?? child.tagName.toLowerCase(),
    );
    expect(order).toEqual(["Dock views", "div"]);
    expect(document.body.textContent).not.toContain("In this space");
    expect(document.body.textContent).not.toContain("Waiting for you");
    await view.unmount();
  });
});
