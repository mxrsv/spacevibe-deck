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
import { click, mount, settle } from "../controls/preset-test-kit";
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

const focusPane = vi.fn();
const selectTab = vi.fn();

function dock() {
  return (
    <AgentDock
      entered
      onClose={() => {}}
      selection={{ onFocusPane: focusPane, onSelectTab: selectTab }}
      bodies={{
        changes: null,
        files: testFileBodies(),
        usage: () => <p>usage body</p>,
        history: null,
      }}
    />
  );
}

async function resizeTo(width: number): Promise<void> {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

const ask = (): HTMLElement | null => document.body.querySelector('section[aria-label="Ask"]');
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
  focusPane.mockClear();
  selectTab.mockClear();
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

describe("Ask", () => {
  it("is absent while the focused agent does not need input", async () => {
    tabViews.value = [tab({ panes: [pane({ focused: true })] })];
    const view = await mount(dock());
    expect(ask()).toBeNull();
    await view.unmount();
  });

  it("is absent for an agent that is not the focused one", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, focused: true }),
          pane({ paneId: 12, agent: "codex", attention: "requested" }),
        ],
      }),
    ];
    const view = await mount(dock());
    expect(ask()).toBeNull();
    await view.unmount();
  });

  it("appears at the top with what the signal says the agent waits on, and goes when it is answered", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ focused: true, attention: "requested", detail: "permission prompt: run rm -rf" }),
        ],
      }),
    ];
    const view = await mount(dock());
    expect(ask()?.textContent).toContain("permission prompt: run rm -rf");
    expect(sections()[0]).toBe("Ask");

    await act(async () => {
      tabViews.value = [tab({ panes: [pane({ focused: true })] })];
    });
    await settle();
    expect(ask()).toBeNull();
    await view.unmount();
  });

  it("says plainly that the agent is waiting when the signal names no detail, and hedges an inferred one", async () => {
    tabViews.value = [tab({ panes: [pane({ focused: true, attention: "requested" })] })];
    const view = await mount(dock());
    expect(ask()?.textContent).toContain("Waiting for you");
    expect(ask()?.textContent).not.toContain("Probably");

    await view.update(dock());
    await act(async () => {
      tabViews.value = [
        tab({
          panes: [pane({ focused: true, attention: "requested", confidence: "inferred" })],
        }),
      ];
    });
    await settle();
    expect(ask()?.textContent).toContain("Probably waiting for you");
    await view.unmount();
  });

  it("is not shown for a finished run nobody has looked at: that is Unread, not a question", async () => {
    tabViews.value = [tab({ panes: [pane({ focused: true, attention: "completed" })] })];
    const view = await mount(dock());
    expect(ask()).toBeNull();
    await view.unmount();
  });

  it("has one control, which takes the keyboard to that agent's pane through the rail's focus path", async () => {
    tabViews.value = [
      tab({ key: 4, panes: [pane({ paneId: 31, focused: true, attention: "requested" })] }),
    ];
    activeTabIndex.value = 0;
    const view = await mount(dock());
    const buttons = ask()?.querySelectorAll("button") ?? [];
    expect(buttons).toHaveLength(1);
    await click(buttons[0] as HTMLElement);
    expect(focusPane).toHaveBeenCalledWith(0, 31);
    expect(selectTab).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("shows in the narrow sheet too", async () => {
    await resizeTo(1000);
    tabViews.value = [tab({ panes: [pane({ focused: true, attention: "requested" })] })];
    const view = await mount(dock());
    expect(ask()).toBeNull();
    await click(document.body.querySelector('[aria-label^="Open the side panel"]') as HTMLElement);
    expect(ask()).not.toBeNull();
    await view.unmount();
  });
});

describe("the order of the dock", () => {
  it("is the strip above Ask, and Ask above the body, with no space list", async () => {
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
        selection={{ onFocusPane: focusPane, onSelectTab: selectTab }}
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
    expect(sections()).toEqual(["Ask"]);
    const column = document.body.querySelector(".agent-dock__column") as HTMLElement;
    const order = [...column.children].map(
      (child) => child.getAttribute("aria-label") ?? child.tagName.toLowerCase(),
    );
    expect(order).toEqual(["Dock views", "Ask", "div"]);
    expect(document.body.textContent).not.toContain("In this space");
    await view.unmount();
  });
});
