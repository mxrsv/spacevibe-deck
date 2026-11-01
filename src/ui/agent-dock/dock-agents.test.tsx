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
import { AgentDock } from "./agent-dock";
import { resetAgentDockState } from "./agent-dock-state";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

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
        files: () => <p>files body</p>,
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
const spaceRows = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('section[aria-label="In this space"] li button'),
];

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

describe("In this space", () => {
  const space = (): TabView =>
    tab({
      panes: [
        pane({ paneId: 11, focused: true }),
        pane({ paneId: 12, agent: "codex", phase: "working", changedAt: NOW - 5 * MINUTE }),
        pane({ paneId: 13, agent: "gemini", attention: "requested", changedAt: NOW - 2 * MINUTE }),
      ],
    });

  it("lists the other agents of the focused agent's tab with state, agent, branch and age", async () => {
    tabViews.value = [space()];
    const view = await mount(dock());
    const rows = spaceRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("5m");
    expect(rows[0].textContent).toContain("Codex, working");
    expect(rows[0].querySelector('[data-state="working"]')).not.toBeNull();
    expect(rows[0].querySelector("svg, img")).not.toBeNull();
    expect(rows[0].textContent).toContain("Codex · main");
    expect(rows[1].textContent).toContain("Gemini, needs you");
    expect(
      document.body.querySelector(
        'section[aria-label="In this space"] [data-slot="collapsible-trigger"]',
      )?.textContent,
    ).toContain("2");
    await view.unmount();
  });

  it("is left out when the focused agent is alone in its tab, or no agent is focused", async () => {
    tabViews.value = [tab({ panes: [pane({ focused: true })] })];
    const view = await mount(dock());
    expect(sections()).not.toContain("In this space");

    await act(async () => {
      tabViews.value = [
        space().panes
          ? { ...space(), panes: space().panes!.map((p) => ({ ...p, focused: false })) }
          : space(),
      ];
    });
    await settle();
    expect(sections()).not.toContain("In this space");
    await view.unmount();
  });

  it("does not list agents of other tabs", async () => {
    tabViews.value = [
      space(),
      tab({ key: 2, workspacePath: "/w/api", panes: [pane({ paneId: 21, agent: "opencode" })] }),
    ];
    const view = await mount(dock());
    expect(spaceRows()).toHaveLength(2);
    expect(
      spaceRows()
        .map((r) => r.textContent)
        .join()
        .toLowerCase(),
    ).not.toContain("opencode");
    await view.unmount();
  });

  it("takes the keyboard to the pressed agent's pane through the same path the rail uses", async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 5 })] }),
      { ...space(), key: 2, panes: space().panes },
    ];
    activeTabIndex.value = 1;
    const view = await mount(dock());
    await click(spaceRows()[1]);
    expect(focusPane).toHaveBeenCalledWith(1, 13);
    await click(spaceRows()[0]);
    expect(focusPane).toHaveBeenLastCalledWith(1, 12);
    await view.unmount();
  });

  it("follows the focused agent: a space-mate becomes the dock's agent and the old one a row", async () => {
    tabViews.value = [space()];
    const view = await mount(dock());
    await act(async () => {
      tabViews.value = [
        tab({
          panes: space().panes!.map((p) => ({ ...p, focused: p.paneId === 12 })),
        }),
      ];
    });
    await settle();
    expect(document.body.querySelector("header")?.textContent).toContain("Codex");
    expect(
      spaceRows()
        .map((r) => r.textContent)
        .join(),
    ).toContain("Claude, ");
    await view.unmount();
  });
});

describe("the order of the sections", () => {
  it("is the mock's: Ask, Changes, In this space, Usage, Files, History", async () => {
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
            section: () => <section aria-label="Changes" />,
            count: () => null,
          },
          files: () => <p>files body</p>,
          usage: () => <p>usage body</p>,
          history: () => <p>history body</p>,
        }}
      />,
    );
    expect(sections()).toEqual(["Ask", "Changes", "In this space", "Usage", "Files", "History"]);
    await view.unmount();
  });
});
