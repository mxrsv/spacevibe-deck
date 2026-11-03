// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The dock's import graph reaches the host (settings, sessions, repositories): stub it as the
// rail's tests do.
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

import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { activeWorkspace, dockCollapseArmed, dockWidthLive } from "../../files/file-surface-store";
import { repositoryScans } from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import {
  activeTabIndex,
  statusInfo,
  tabViews,
  type PaneView,
  type TabView,
} from "../../terminal/tabs-store";
import { browserPanelObscured } from "../app-policy";
import { byRole, click, mount, press, settle, waitUntil } from "../controls/preset-test-kit";
import { AgentDock } from "./agent-dock";
import { dockSheetOpen, dockView, resetAgentDockState, setDockView } from "./agent-dock-state";
import { resetRevealDockTabForTests } from "./use-reveal-dock-tab";

const NOW = 1_800_000_000_000;

function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: NOW,
    ...overrides,
  };
}

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/r/main",
    agents: [],
    agentBusy: false,
    unread: false,
    panes: [pane()],
    ...overrides,
  };
}

/** Two agents in two tabs; `focusedKey` names the tab whose pane holds the keyboard. */
function twoAgents(focusedKey: number | null): TabView[] {
  return [
    tab({
      key: 1,
      name: "token refresh",
      panes: [pane({ paneId: 11, focused: focusedKey === 1 })],
    }),
    tab({
      key: 2,
      name: "fix flaky test",
      workspacePath: "/w/api",
      panes: [pane({ paneId: 21, agent: "codex", focused: focusedKey === 2 })],
    }),
  ];
}

const BODIES = {
  changes: {
    watch: () => null,
    section: (root: string | null) => <p>changes body at {root ?? "no folder"}</p>,
    count: () => null,
  },
  files: (root: string | null) => <p>files body at {root ?? "no folder"}</p>,
  usage: () => <p>usage body</p>,
  history: () => <p>history body</p>,
};

function dock(overrides: Partial<Parameters<typeof AgentDock>[0]> = {}) {
  return (
    <AgentDock
      entered
      onClose={() => {}}
      bodies={BODIES}
      selection={{ onFocusPane: () => {}, onSelectTab: () => {} }}
      {...overrides}
    />
  );
}

/** Pin the host the way `action-availability.test.ts` does; the switch follows `isDevelopment`. */
function pinHost(isDevelopment: boolean): void {
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

/** Resize the window the way the browser reports it. */
async function resizeTo(width: number): Promise<void> {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

const strip = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[aria-label="Dock views"]');
const icon = (label: string): HTMLElement =>
  strip()?.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const icons = (): (string | null)[] =>
  [...(strip()?.querySelectorAll("button") ?? [])].map((button) =>
    button.getAttribute("aria-label"),
  );
const pressed = (): (string | null)[] =>
  [...(strip()?.querySelectorAll('button[aria-pressed="true"]') ?? [])].map((button) =>
    button.getAttribute("aria-label"),
  );
const bodyText = (): string => document.body.textContent ?? "";
const named = (label: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
const scrim = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');

/** A press on the scrim, as a pointer delivers it: down, up, then the click. */
async function pressScrim(target: HTMLElement): Promise<void> {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  });
  await settle();
}

beforeEach(() => {
  pinHost(true);
  settings.value = DEFAULT_SETTINGS;
  tabViews.value = twoAgents(1);
  activeTabIndex.value = 0;
  activeWorkspace.value = "/r/main";
  repositoryScans.value = new Map();
  statusInfo.value = { branch: null, cwd: null, agent: null, paneCount: 1, home: "/home/test" };
  resetAgentDockState();
  resetRevealDockTabForTests();
});

afterEach(async () => {
  await resizeTo(1024);
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  tabViews.value = [];
  activeTabIndex.value = -1;
  activeWorkspace.value = null;
  repositoryScans.value = new Map();
  resetAgentDockState();
});

describe("the tabbed dock in a wide window", () => {
  beforeEach(() => resizeTo(1440));

  it("names the focused agent and its title, and follows focus", async () => {
    const view = await mount(dock());
    const header = document.body.querySelector("header") as HTMLElement;
    expect(header.textContent).toContain("Claude");
    expect(header.textContent).toContain("token refresh");

    tabViews.value = twoAgents(2);
    activeTabIndex.value = 1;
    await settle();
    expect(header.textContent).toContain("Codex");
    expect(header.textContent).toContain("fix flaky test");
    await view.unmount();
  });

  it("shows a neutral header when no agent holds the keyboard", async () => {
    tabViews.value = twoAgents(null);
    const view = await mount(dock());
    expect(document.body.querySelector("header")?.textContent).toContain("No agent focused");
    await view.unmount();
  });

  it("has one strip of fixed icons in order, with no tab and no count", async () => {
    const view = await mount(dock());
    expect(icons()).toEqual(["Changes", "Usage", "Files", "History"]);
    expect(strip()?.textContent).toBe("");
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    await view.unmount();
  });

  it("starts on Changes and swaps the whole body on an icon press, unmounting the rest", async () => {
    const view = await mount(dock());
    expect(pressed()).toEqual(["Changes"]);
    expect(bodyText()).toContain("changes body");
    expect(bodyText()).not.toContain("usage body");

    await click(icon("Usage"));
    expect(pressed()).toEqual(["Usage"]);
    expect(bodyText()).toContain("usage body");
    // The unselected view is unmounted, so an unselected Usage runs no poll.
    expect(bodyText()).not.toContain("changes body");
    expect(bodyText()).not.toContain("files body");

    await click(icon("Files"));
    expect(bodyText()).toContain("files body");
    expect(bodyText()).not.toContain("usage body");
    await view.unmount();
  });

  it("gives the body the height and keeps the column from scrolling, however long Changes is", async () => {
    const rows = Array.from({ length: 65 }, (_, index) => <li key={index}>file {index}</li>);
    const view = await mount(
      dock({
        bodies: { ...BODIES, changes: { ...BODIES.changes, section: () => <ul>{rows}</ul> } },
      }),
    );
    const column = document.body.querySelector(".agent-dock__column") as HTMLElement;
    expect(column.className).not.toContain("overflow-y-auto");
    const body = column.lastElementChild as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("flex-1");
    expect(body.contains(strip())).toBe(false);
    expect(body.querySelectorAll("li")).toHaveLength(65);
    await view.unmount();
  });

  it("keeps the view when focus moves to another agent and when the dock closes and reopens", async () => {
    let view = await mount(dock());
    await click(icon("History"));
    expect(bodyText()).toContain("history body");

    tabViews.value = twoAgents(2);
    activeTabIndex.value = 1;
    await settle();
    expect(pressed()).toEqual(["History"]);

    await view.unmount();
    view = await mount(dock());
    expect(pressed()).toEqual(["History"]);
    expect(bodyText()).toContain("history body");
    await view.unmount();
  });

  it("leaves History out where the host cannot list sessions", async () => {
    const view = await mount(dock({ bodies: { ...BODIES, history: null } }));
    expect(icons()).toEqual(["Changes", "Usage", "Files"]);
    await view.unmount();
  });

  it("falls back to the first available view when the selected one is unavailable, keeping the choice", async () => {
    setDockView("history");
    const view = await mount(dock({ bodies: { ...BODIES, history: null } }));
    expect(pressed()).toEqual(["Changes"]);
    expect(bodyText()).toContain("changes body");
    expect(dockView.value).toBe("history");
    await view.update(dock({ bodies: { ...BODIES, changes: null, history: null } }));
    expect(pressed()).toEqual(["Usage"]);
    expect(bodyText()).toContain("usage body");
    await view.unmount();
  });

  it("hides the dock through the close control", async () => {
    const onClose = vi.fn();
    const view = await mount(dock({ onClose }));
    await click(named("Hide the side panel") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("is at rest only while entered", async () => {
    const view = await mount(dock({ entered: false }));
    const root = document.body.querySelector("aside") as HTMLElement;
    expect(root.classList.contains("is-open")).toBe(false);
    await view.update(dock({ entered: true }));
    expect(root.classList.contains("is-open")).toBe(true);
    await view.unmount();
  });

  it("selects the view a changed dockTab names, and not on a plain reopen", async () => {
    let view = await mount(dock());
    expect(pressed()).toEqual(["Changes"]);

    // The usage chord with the dock open: the legacy chord writes `dockTab`.
    await act(async () => {
      settings.value = { ...settings.value, dockTab: "usage" };
    });
    await settle();
    expect(pressed()).toEqual(["Usage"]);

    // The user picks another view and closes the dock; opening it again is not a request.
    await click(icon("Files"));
    await view.unmount();
    view = await mount(dock());
    expect(pressed()).toEqual(["Files"]);
    await view.unmount();
  });
});

async function dragGripEnd(): Promise<void> {
  const grip = document.body.querySelector<HTMLElement>('[role="separator"]') as HTMLElement;
  await act(async () => {
    grip.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  });
}

/** Press the grip, move the pointer by `dx`, and optionally release; the way a drag arrives. */
async function dragGrip(dx: number, release: boolean): Promise<void> {
  const grip = document.body.querySelector<HTMLElement>('[role="separator"]') as HTMLElement;
  // jsdom does not implement pointer capture.
  grip.setPointerCapture = vi.fn();
  grip.releasePointerCapture = vi.fn();
  const fire = async (type: string, clientX: number): Promise<void> => {
    await act(async () => {
      grip.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
    });
  };
  await fire("pointerdown", 1000);
  await fire("pointermove", 1000 + dx);
  if (release) {
    await fire("pointerup", 1000 + dx);
  }
}

describe("the tabbed dock's resize grip", () => {
  beforeEach(async () => {
    await resizeTo(1440);
    dockWidthLive.value = null;
    dockCollapseArmed.value = false;
  });

  it("widens the column from its 320px rest, follows the pointer, and writes one width on release", async () => {
    const view = await mount(dock());
    await dragGrip(-100, false);
    // Dragging left widens it: 320 + 100, held live and not yet written.
    expect(dockWidthLive.value).toBe(420);
    expect(settings.value.dockWidth).toBe(DEFAULT_SETTINGS.dockWidth);
    await dragGripEnd();
    expect(dockWidthLive.value).toBeNull();
    expect(settings.value.dockWidth).toBe(420);
    await view.unmount();
  });

  it("hides the dock, writing no width, when pulled past the floor", async () => {
    const onClose = vi.fn();
    const view = await mount(dock({ onClose }));
    await dragGrip(150, true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(settings.value.dockWidth).toBe(DEFAULT_SETTINGS.dockWidth);
    expect(dockWidthLive.value).toBeNull();
    await view.unmount();
  });
});

describe("the folder the views show", () => {
  const repository = (root: string, ...worktrees: string[]): RepositoryScan => ({
    kind: "repository",
    key: `${root}/.git`,
    root,
    worktrees: worktrees.map((path) => ({
      path,
      head: "a",
      branch: "b",
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    })),
  });

  beforeEach(() => resizeTo(1440));

  it("starts on the tab's folder, then follows the focused agent into another checkout", async () => {
    repositoryScans.value = new Map([["/r/main", repository("/r/main", "/r/main", "/r/side")]]);
    const view = await mount(dock());
    expect(bodyText()).toContain("changes body at /r/main");

    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: "/r/side/src" };
    });
    await settle();
    expect(bodyText()).toContain("changes body at /r/side");
    // The tab's own folder is what file tabs and the watcher key on: it is not rewritten.
    expect(activeWorkspace.value).toBe("/r/main");
    await view.unmount();
  });

  it("follows focus between two agents of one project standing in different checkouts", async () => {
    repositoryScans.value = new Map([["/r/main", repository("/r/main", "/r/main", "/r/side")]]);
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, focused: true })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, agent: "codex" })] }),
    ];
    statusInfo.value = { ...statusInfo.value, cwd: "/r/main" };
    const view = await mount(dock());
    expect(bodyText()).toContain("changes body at /r/main");

    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, agent: "codex", focused: true })] }),
    ];
    activeTabIndex.value = 1;
    statusInfo.value = { ...statusInfo.value, cwd: "/r/side" };
    await settle();
    expect(bodyText()).toContain("changes body at /r/side");
    await view.unmount();
  });

  it("keeps the tab's folder while a file surface holds the keyboard", async () => {
    repositoryScans.value = new Map([["/r/main", repository("/r/main", "/r/main", "/r/side")]]);
    const view = await mount(dock());
    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: "/r/side", paneCount: null };
    });
    await settle();
    expect(bodyText()).toContain("changes body at /r/main");
    await view.unmount();
  });

  it("is never the home directory: a cwd in no known checkout keeps the tab's folder", async () => {
    const view = await mount(dock());
    await act(async () => {
      statusInfo.value = { ...statusInfo.value, cwd: "/home/test/projects/other" };
    });
    await settle();
    expect(bodyText()).toContain("changes body at /r/main");
    await view.unmount();
  });

  it("leaves the Changes view out where the host cannot read git changes", async () => {
    const view = await mount(dock({ bodies: { ...BODIES, changes: null } }));
    expect(icons()).toEqual(["Usage", "Files", "History"]);
    await view.unmount();
  });

  it("shows no folder rather than a guess when the window has none", async () => {
    activeWorkspace.value = null;
    tabViews.value = twoAgents(null);
    const view = await mount(dock());
    expect(bodyText()).toContain("changes body at no folder");
    await view.unmount();
  });
});

describe("the tabbed dock under 1360px", () => {
  beforeEach(() => resizeTo(1000));

  it("has no resize grip, and its own control hides the dock", async () => {
    const onClose = vi.fn();
    const view = await mount(dock({ onClose }));
    expect(document.body.querySelector('[role="separator"]')).toBeNull();
    await click(named("Hide the side panel") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dockSheetOpen.value).toBe(false);
    await view.unmount();
  });

  it("is a handle: no strip, no sheet, and the browser is not asked to yield", async () => {
    const view = await mount(dock());
    expect(named("Open the side panel")).not.toBeNull();
    expect(strip()).toBeNull();
    expect(byRole("dialog")).toBeNull();
    expect(dockSheetOpen.value).toBe(false);
    await view.unmount();
  });

  it("names the focused agent and its state on the handle", async () => {
    const view = await mount(dock());
    expect(named("Open the side panel")?.getAttribute("aria-label")).toBe(
      "Open the side panel, Claude, done",
    );
    await view.unmount();
  });

  it("opens the column in a sheet, which makes the browser yield", async () => {
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    const sheet = byRole("dialog") as HTMLElement;
    expect(sheet.textContent).toContain("token refresh");
    expect(icons()).toEqual(["Changes", "Usage", "Files", "History"]);
    expect(dockSheetOpen.value).toBe(true);
    expect(
      browserPanelObscured({
        overlayCoversPane: false,
        agentQuickPickerOpen: false,
        usageConsentOpen: false,
        railCardMenuOpen: false,
        agentBoardActive: false,
        promptsOpen: false,
        createEntryOpen: false,
        persistErrorVisible: false,
        settingsLoadError: false,
        dockSheetOpen: dockSheetOpen.value,
      }),
    ).toBe(true);
    await view.unmount();
  });

  it("is 320px wide, not three quarters of the window", async () => {
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    const classes = (byRole("dialog") as HTMLElement).className.split(/\s+/);
    expect(classes).toContain("data-[side=right]:w-80");
    expect(classes).toContain("data-[side=right]:sm:max-w-80");
    expect(classes).not.toContain("data-[side=right]:w-3/4");
    expect(classes).not.toContain("data-[side=right]:sm:max-w-sm");
    await view.unmount();
  });

  it("closes on Escape and gives focus back to the handle", async () => {
    const view = await mount(dock());
    const handle = named("Open the side panel") as HTMLElement;
    handle.focus();
    await click(handle);
    expect(dockSheetOpen.value).toBe(true);

    await press(byRole("dialog") as HTMLElement, { key: "Escape" });
    await waitUntil(() => byRole("dialog") === null);
    expect(dockSheetOpen.value).toBe(false);
    await waitUntil(() => document.activeElement === handle);
    await view.unmount();
  });

  it("closes when the scrim is pressed and gives focus back to the handle", async () => {
    const view = await mount(dock());
    const handle = named("Open the side panel") as HTMLElement;
    handle.focus();
    await click(handle);
    expect(scrim()).not.toBeNull();

    await pressScrim(scrim() as HTMLElement);
    await waitUntil(() => byRole("dialog") === null);
    expect(dockSheetOpen.value).toBe(false);
    await waitUntil(() => document.activeElement === handle);
    await view.unmount();
  });

  it("closes the sheet from its own control without hiding the dock", async () => {
    const onClose = vi.fn();
    const view = await mount(dock({ onClose }));
    await click(named("Open the side panel") as HTMLElement);
    await click(named("Close the side panel") as HTMLElement);
    await waitUntil(() => byRole("dialog") === null);
    expect(onClose).not.toHaveBeenCalled();
    expect(named("Open the side panel")).not.toBeNull();
    await view.unmount();
  });

  it("clears the browser's yield when the dock goes away with the sheet open", async () => {
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    expect(dockSheetOpen.value).toBe(true);
    await view.unmount();
    expect(dockSheetOpen.value).toBe(false);
  });

  it("clears the browser's yield and shows the column when the window widens", async () => {
    const view = await mount(dock());
    await click(named("Open the side panel") as HTMLElement);
    expect(dockSheetOpen.value).toBe(true);

    await resizeTo(1440);
    await settle();
    expect(dockSheetOpen.value).toBe(false);
    expect(byRole("dialog")).toBeNull();
    expect(named("Hide the side panel")).not.toBeNull();
    await view.unmount();
  });
});
