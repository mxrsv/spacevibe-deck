// @vitest-environment jsdom
/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The same host stubs `agent-rail.test.tsx` installs: the rail's import graph
// reaches the repositories store, the session journal and the favicon scan.
vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));
// Phosphor components are React `forwardRef` objects; see `agent-rail.test.tsx`.
vi.mock("./controls/deck-icon", () => ({
  CHROME_ICON: 13,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { activeTabIndex, tabViews, type PaneView, type TabView } from "../terminal/tabs-store";
import { AgentRail } from "./agent-rail";
import {
  configureRepositoryClient,
  invalidateRepositoryScans,
} from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { resetFileSurfaces } from "../files/file-surface-store";
import type { FileClient } from "../files/file-client";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import { sessionArchive } from "../terminal/session-journal";
import { paneModels, paneTails } from "../terminal/session-tail-store";
import { railCardMenuOpen } from "../chrome/events";
import type { CardActions } from "./worktree-card-menus";

const fileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  createEntry: async (_root: string, parent: string, name: string) => ({
    path: `${parent}/${name}`,
  }),
  listenFileChanged: async () => () => {},
};

type RepositoryEntry = Extract<RepositoryScan, { kind: "repository" }>;

function worktree(path: string, branch: string): RepositoryEntry["worktrees"][number] {
  return {
    path,
    head: "a",
    branch,
    bare: false,
    detached: false,
    locked: null,
    prunable: null,
  };
}

const DECK_SCAN: RepositoryEntry = {
  kind: "repository",
  key: "/w/deck/.git",
  root: "/w/deck",
  worktrees: [worktree("/w/deck", "main")],
};

const API_SCAN: RepositoryEntry = {
  kind: "repository",
  key: "/w/api/.git",
  root: "/w/api",
  worktrees: [worktree("/w/api", "main")],
};

function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: false,
    changedAt: 1_000,
    ...overrides,
  };
}

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/w/deck",
    agents: [],
    agentBusy: false,
    unread: false,
    panes: [pane()],
    ...overrides,
  };
}

let host: HTMLDivElement;
let fileController: FileSurfaceController;

const NOOP = (): void => {};

function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onClosePane={NOOP}
        onFocusPane={NOOP}
        legacy={{ onOpenWorkspace: NOOP, onResumeWorktree: NOOP }}
        fileController={fileController}
        {...props}
      />,
      host,
    );
  });
}

/** Let the scan promise and the signal update it triggers both settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function avatars(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(".asr-avatar")];
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  host = document.createElement("div");
  document.body.appendChild(host);
  invalidateRepositoryScans();
  configureRepositoryClient({
    scan: async (path: string) => (path.startsWith("/w/api") ? API_SCAN : DECK_SCAN),
  });
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: [
      { path: "/w/deck", lastOpenedAt: 2 },
      { path: "/w/api", lastOpenedAt: 1 },
      { path: "/w/idle", lastOpenedAt: 0 },
    ],
  };
  tabViews.value = [
    tab({ key: 1, workspacePath: "/w/deck", panes: [pane({ paneId: 11 })] }),
    tab({ key: 2, workspacePath: "/w/api", panes: [pane({ paneId: 21 })] }),
  ];
  activeTabIndex.value = 0;
  resetFileSurfaces();
  fileController = createFileSurfaceController({ client: fileClient });
  sessionArchive.value = {};
  paneTails.value = new Map();
  paneModels.value = new Map();
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  invalidateRepositoryScans();
  resetDesktopEnvironmentForTests();
  workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  fileController.dispose();
  resetFileSurfaces();
  sessionArchive.value = {};
  paneTails.value = new Map();
  paneModels.value = new Map();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentRail collapsed (DL-27.29)", () => {
  it("stacks the create verbs above the avatars as icon buttons with native titles", async () => {
    mount({ collapsed: true });
    await settle();

    const stack = host.querySelector(".rail-create");
    expect(stack?.getAttribute("data-variant")).toBe("column");
    expect(stack?.nextElementSibling).toBe(host.querySelector(".asr-column__list"));
    const buttons = [...(stack?.querySelectorAll<HTMLButtonElement>(".rail-create__button") ?? [])];
    expect(buttons[0]?.getAttribute("data-verb")).toBe("agent");
    expect(buttons[0]?.getAttribute("title")).toBe(buttons[0]?.getAttribute("aria-label"));
    expect(buttons[0]?.textContent).toBe("");
  });

  it("draws one avatar per live project and no tree", async () => {
    mount({ collapsed: true });
    await settle();

    expect(avatars().map((avatar) => avatar.getAttribute("aria-label"))).toEqual(["deck", "api"]);
    // The remembered `/w/idle` project has no avatar, and nothing of the tree draws.
    expect(host.querySelector(".asr-checkout")).toBeNull();
    expect(host.querySelector(".asr-cluster")).toBeNull();
    expect(host.querySelector(".sidebar-launcher")).toBeNull();
  });

  // DL-28.6: the tools stay reachable while collapsed, at the column's foot.
  it("seats the rail's footer after the avatars, not inside their list", async () => {
    mount({ collapsed: true, footer: <div data-testid="rail-footer" /> });
    await settle();

    const footer = host.querySelector('[data-testid="rail-footer"]');
    const list = host.querySelector(".asr-column__list");
    expect(list?.contains(footer)).toBe(false);
    expect(list?.nextElementSibling).toBe(footer);
  });

  it("draws the tree and no avatars when expanded", async () => {
    mount({ collapsed: false });
    await settle();

    expect(avatars()).toHaveLength(0);
    expect(host.querySelectorAll(".asr-checkout").length).toBeGreaterThan(0);
  });

  it("swaps between the two without losing the project order", async () => {
    mount({ collapsed: true });
    await settle();
    mount({ collapsed: false });
    await settle();
    expect(host.querySelector(".asr-avatar")).toBeNull();
    expect(host.querySelector(".asr-rail__list")).not.toBeNull();

    mount({ collapsed: true });
    await settle();
    expect(avatars().map((avatar) => avatar.title)).toEqual(["deck", "api"]);
  });

  it("badges the count of panes that need the user, in the header's two inks", async () => {
    tabViews.value = [
      tab({
        key: 1,
        workspacePath: "/w/deck",
        panes: [
          pane({ paneId: 11, attention: "requested" }),
          pane({ paneId: 12, attention: "error", phase: "exited" }),
        ],
      }),
      tab({
        key: 2,
        workspacePath: "/w/api",
        panes: [pane({ paneId: 21, attention: "warning" })],
      }),
    ];
    mount({ collapsed: true });
    await settle();

    const [deck, api] = avatars();
    const deckBadge = deck.querySelector<HTMLElement>(".asr-avatar__badge");
    const apiBadge = api.querySelector<HTMLElement>(".asr-avatar__badge");
    expect(deckBadge?.textContent).toBe("2");
    expect(deckBadge?.dataset.tone).toBe("failed");
    expect(apiBadge?.textContent).toBe("1");
    expect(apiBadge?.dataset.tone).toBe("asked");
    // DL-27.2: the badge is paint, so the words reach the accessible name.
    expect(deck.getAttribute("aria-label")).toBe("deck, 2 need you, 1 failed");
    expect(api.getAttribute("aria-label")).toBe("api, 1 need you");
  });

  it("prints no badge at zero", async () => {
    mount({ collapsed: true });
    await settle();

    expect(host.querySelector(".asr-avatar__badge")).toBeNull();
  });

  it("carries the current mark on the project that holds the selected tab", async () => {
    activeTabIndex.value = 1;
    mount({ collapsed: true });
    await settle();

    const [deck, api] = avatars();
    expect(deck.dataset.current).toBe("false");
    expect(api.dataset.current).toBe("true");
    expect(api.getAttribute("aria-current")).toBe("true");
    expect(deck.hasAttribute("aria-current")).toBe(false);
  });

  it("falls back to initials where the project has no favicon", async () => {
    mount({ collapsed: true });
    await settle();

    expect(
      avatars().map((avatar) => avatar.querySelector(".asr-avatar__initials")?.textContent),
    ).toEqual(["De", "Ap"]);
  });

  it("keeps Tauri on the legacy repository rail, which hides instead", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    mount({ collapsed: true });
    await settle();

    expect(host.querySelector(".asr-avatar")).toBeNull();
    expect(host.querySelector(".asr-rail--column")).toBeNull();
  });
});

function press(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function flyout(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".asr-flyout");
}

function key(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

describe("AgentRail collapsed flyout (DL-27.29)", () => {
  it("opens nothing on hover alone", async () => {
    mount({ collapsed: true });
    await settle();

    act(() => {
      avatars()[0].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      avatars()[0].dispatchEvent(new MouseEvent("pointerenter", { bubbles: true }));
    });

    expect(flyout()).toBeNull();
    expect(avatars()[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the project's checkouts as the tree's own cards on press", async () => {
    mount({ collapsed: true });
    await settle();

    press(avatars()[1]);

    const open = flyout();
    expect(open?.getAttribute("aria-label")).toBe("api sessions");
    expect(open?.querySelector(".asr-flyout__head")?.textContent).toBe("api");
    // `WorktreeCard`, not a restyled copy: the tree's checkout and row classes.
    expect(open?.querySelectorAll(".asr-checkout")).toHaveLength(1);
    expect(open?.querySelector(".asr-checkout__name")?.textContent).toBe("main");
    expect(open?.querySelectorAll(".asr-card__row")).toHaveLength(1);
    expect(avatars()[1].getAttribute("aria-expanded")).toBe("true");
    // Keyboard users land in it: the first control takes focus.
    expect(open?.contains(document.activeElement)).toBe(true);
  });

  it("focuses the exact pane behind a flyout row and closes (RAIL5)", async () => {
    const onFocusPane = vi.fn();
    mount({ collapsed: true, onFocusPane });
    await settle();
    press(avatars()[1]);

    press(flyout()?.querySelector(".asr-card__row .asr-card__hit"));

    // The pane's GLOBAL tab index (the second tab) and its own id.
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(1, 21);
    expect(flyout()).toBeNull();
  });

  it("closes on Esc and returns focus to the avatar", async () => {
    mount({ collapsed: true });
    await settle();
    press(avatars()[0]);
    expect(flyout()).not.toBeNull();

    key("Escape");

    expect(flyout()).toBeNull();
    expect(document.activeElement).toBe(avatars()[0]);
  });

  it("closes on a press outside, and a second press on its avatar closes too", async () => {
    mount({ collapsed: true });
    await settle();
    press(avatars()[0]);

    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(flyout()).toBeNull();

    press(avatars()[0]);
    expect(flyout()).not.toBeNull();
    press(avatars()[0]);
    expect(flyout()).toBeNull();
  });

  it("keeps one flyout at a time", async () => {
    mount({ collapsed: true });
    await settle();

    press(avatars()[0]);
    press(avatars()[1]);

    expect(host.querySelectorAll(".asr-flyout")).toHaveLength(1);
    expect(flyout()?.querySelector(".asr-flyout__head")?.textContent).toBe("api");
  });

  it("raises the stage overlay flag so the browser's native view steps aside", async () => {
    mount({ collapsed: true });
    await settle();

    press(avatars()[0]);
    expect(railCardMenuOpen.value).toBe(true);

    key("Escape");
    // The flag's release is delayed on purpose (`useStageOverlayFlag`), so a sweep
    // across menus is one hide rather than several.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(railCardMenuOpen.value).toBe(false);
  });

  it("closes the flyout when a checkout's `+` opens the launcher", async () => {
    const onOpenAgentLauncher = vi.fn();
    const cardActions: CardActions = {
      agents: [],
      agentsResolved: true,
      onRunAgent: vi.fn(),
      onSplitHere: vi.fn(),
      onOpenAgentLauncher,
    };
    mount({ collapsed: true, cardActions });
    await settle();
    press(avatars()[0]);

    press(flyout()?.querySelector(".asr-checkout__add"));

    expect(onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/w/deck");
    expect(flyout()).toBeNull();
  });

  it("follows the project: its last tab closing takes the flyout with it", async () => {
    mount({ collapsed: true });
    await settle();
    press(avatars()[1]);
    expect(flyout()).not.toBeNull();

    act(() => {
      tabViews.value = [tab({ key: 1, workspacePath: "/w/deck", panes: [pane({ paneId: 11 })] })];
    });
    await settle();

    expect(flyout()).toBeNull();
    expect(avatars()).toHaveLength(1);
  });
});

function arrow(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

describe("AgentRail collapsed keyboard and motion (COLLAPSE2)", () => {
  it("is one tab stop, on the current project, with every avatar a real button", async () => {
    activeTabIndex.value = 1;
    mount({ collapsed: true });
    await settle();

    expect(avatars().map((avatar) => avatar.tabIndex)).toEqual([-1, 0]);
    // A native button: Enter and Space press it, which is what opens the flyout.
    expect(avatars().every((avatar) => avatar.tagName === "BUTTON")).toBe(true);
  });

  it("starts the tab stop on the first avatar when none is current", async () => {
    tabViews.value = [tab({ key: 1, workspacePath: "/w/deck", panes: [pane({ paneId: 11 })] })];
    tabViews.value = [
      ...tabViews.value,
      tab({ key: 2, workspacePath: "/w/api", panes: [pane({ paneId: 21 })] }),
    ];
    activeTabIndex.value = -1;
    mount({ collapsed: true });
    await settle();

    expect(avatars().map((avatar) => avatar.tabIndex)).toEqual([0, -1]);
  });

  it("walks the avatars with the arrow keys, Home and End, and the tab stop follows", async () => {
    mount({ collapsed: true });
    await settle();
    act(() => avatars()[0].focus());

    arrow("ArrowDown");
    expect(document.activeElement).toBe(avatars()[1]);
    expect(avatars().map((avatar) => avatar.tabIndex)).toEqual([-1, 0]);

    // The ends hold rather than wrap.
    arrow("ArrowDown");
    expect(document.activeElement).toBe(avatars()[1]);

    arrow("ArrowUp");
    expect(document.activeElement).toBe(avatars()[0]);
    arrow("End");
    expect(document.activeElement).toBe(avatars()[1]);
    arrow("Home");
    expect(document.activeElement).toBe(avatars()[0]);
  });

  it("leaves other keys alone", async () => {
    mount({ collapsed: true });
    await settle();
    act(() => avatars()[0].focus());
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });

    act(() => {
      avatars()[0].dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(avatars()[0]);
  });

  it("keeps focus on the avatar through a flyout that opens and closes by keyboard", async () => {
    mount({ collapsed: true });
    await settle();
    act(() => avatars()[1].focus());

    press(avatars()[1]);
    expect(flyout()?.contains(document.activeElement)).toBe(true);
    key("Escape");

    expect(document.activeElement).toBe(avatars()[1]);
  });

  // DL-1.5 / COLLAPSE2: the partial's motion is added under `no-preference` and never
  // switched off by class name, so under `reduce` the column and flyout are still.
  it("declares every transition and animation inside the no-preference scope", () => {
    const css = readFileSync("src/styles/04e-rail-collapsed.css", "utf8");
    const outsideMotion = css.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n(?=\n|$)/g,
      "",
    );

    expect(css).toMatch(/prefers-reduced-motion: no-preference/);
    expect(outsideMotion).not.toMatch(/\b(transition|animation)\s*:/);
  });
});
