// @vitest-environment jsdom
/**
 * `TabStrip` mounted on its own — the shape sidebar mode uses (`.stage__strip`
 * in `App`), with no `.tabbar` frame around it.
 *
 * Chip behaviour itself is covered once, through `TabBar`, in
 * `tab-bar.test.tsx`; duplicating it here would only prove the same component
 * twice. What is specific to this mount is that nothing in the strip depends
 * on the frame it happens to be inside — including the popover anchor lookup,
 * whose root moved from the `<header>` to the tablist when the component was
 * extracted.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTabIndex, tabViews, type TabView, type PaneView } from "../terminal/tabs-store";
import { TabStrip } from "./tab-strip";
import { stripPreferences, EMPTY_STRIP_PREFERENCES, setStripPinned } from "../lib/strip-order";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { openFileTab, closeFileSurface, resetFileSurfaces } from "../files/file-surface-store";
import { nextOpenSequence, resetOpenSequence } from "../lib/open-sequence";
import type { FileClient } from "../files/file-client";
import { repositoryScans } from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import {
  browserOpen,
  browserOpenedAt,
  browserState,
  browserSurfaceActive,
  EMPTY_STATE,
  resetBrowserStore,
} from "../browser/browser-store";
import { paneTails } from "../terminal/session-tail-store";
import { agentBoardSurfaceActive, openAgentBoard, resetAgentBoardStore } from "./agent-board-store";

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

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: "Tab",
    dotColor: null,
    workspacePath: "/repo",
    agents: [],
    agentBusy: false,
    unread: false,
    ...overrides,
  };
}

/** One agent pane, for the chips that carry a session tail (DL-18.10). */
function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    hasRun: true,
    changedAt: 1_000,
    ...overrides,
  };
}

describe("TabStrip mounted outside the tab bar (sidebar layout)", () => {
  let host: HTMLDivElement;
  let fileController: FileSurfaceController;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    tabViews.value = [];
    activeTabIndex.value = 0;
    repositoryScans.value = new Map();
    resetFileSurfaces();
    resetBrowserStore();
    resetAgentBoardStore();
    resetOpenSequence();
    stripPreferences.value = EMPTY_STRIP_PREFERENCES;
    paneTails.value = new Map();
    fileController = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    repositoryScans.value = new Map();
    resetDesktopEnvironmentForTests();
    fileController.dispose();
    resetFileSurfaces();
    resetAgentBoardStore();
    paneTails.value = new Map();
  });

  const mount = (props: Partial<Parameters<typeof TabStrip>[0]> = {}): void => {
    act(() => {
      render(
        // The same wrapper `App` puts it in — a plain div, not the frame.
        <div class="stage__strip">
          <TabStrip
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            onSelectBrowser={vi.fn()}
            onCloseBrowser={vi.fn()}
            onSelectAgentBoard={vi.fn()}
            onCloseAgentBoard={vi.fn()}
            fileController={fileController}
            scopeToActiveRepository
            {...props}
          />
        </div>,
        host,
      );
    });
  };

  const chipNamed = (name: string): HTMLElement =>
    [...host.querySelectorAll<HTMLElement>(".tab")].find(
      (el) => el.querySelector(".tab__label")?.textContent === name,
    )!;
  it("reorders mounted terminal chips from mouse pointer events", () => {
    tabViews.value = [
      tab({ key: 1, openedAt: 1, name: "First" }),
      tab({ key: 2, openedAt: 2, name: "Second" }),
    ];
    const select = vi.fn();
    mount({ onSelectTab: select });
    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    const box = (left: number, width: number) =>
      ({ left, right: left + width, top: 0, bottom: 30, width, height: 30 }) as DOMRect;
    list.getBoundingClientRect = () => box(0, 200);
    chipNamed("First").getBoundingClientRect = () => box(0, 100);
    chipNamed("Second").getBoundingClientRect = () => box(100, 100);
    const pointer = (target: EventTarget, type: string, x: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 15,
        button: 0,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      target.dispatchEvent(event);
    };
    act(() => {
      pointer(chipNamed("Second").querySelector(".tab__label")!, "pointerdown", 150);
      pointer(window, "pointermove", 10);
      pointer(window, "pointerup", 10);
      list.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect([...list.querySelectorAll(".tab__label")].map((el) => el.textContent)).toEqual([
      "Second",
      "First",
    ]);
    expect(select).not.toHaveBeenCalled();
  });
  const context = (name: string): void => {
    act(() => {
      chipNamed(name).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 25,
        }),
      );
    });
  };
  const menuAction = async (label: string): Promise<void> => {
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((el) => el.textContent === label)!
        .click();
    });
  };

  it("pins a tab without selecting it, retains its name and removes its close button", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() }),
      tab({ key: 2, name: "Beta", openedAt: nextOpenSequence() }),
    ];
    const select = vi.fn();
    mount({ onSelectTab: select });
    context("Beta");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await menuAction("Pin");
    expect(host.querySelector(".tab__label")?.textContent).toBe("Beta");
    expect(chipNamed("Beta").querySelector(".tab__close")).toBeNull();
    expect(chipNamed("Beta").querySelector(".tab__pin")).not.toBeNull();
    expect(select).not.toHaveBeenCalled();
    context("Beta");
    await menuAction("Unpin");
    expect(host.querySelector(".tab__label")?.textContent).toBe("Alpha");
    expect(chipNamed("Beta").querySelector(".tab__close")).not.toBeNull();
  });

  it("Close Others targets only visible unpinned terminals in one guarded batch", async () => {
    const keys = [nextOpenSequence(), nextOpenSequence(), nextOpenSequence(), nextOpenSequence()];
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: keys[0] }),
      tab({ key: 2, name: "Pinned", openedAt: keys[1] }),
      tab({ key: 3, name: "Close me", openedAt: keys[2] }),
      tab({ key: 4, name: "Hidden", workspacePath: "/elsewhere", openedAt: keys[3] }),
    ];
    setStripPinned(keys[1]!, true);
    const closeTabs = vi.fn(async () => true);
    mount({ onCloseTabs: closeTabs });
    context("Alpha");
    await menuAction("Close Others");
    expect(closeTabs).toHaveBeenCalledExactlyOnceWith([2]);
  });

  it("Close to the Right follows the displayed manual order", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: 1 }),
      tab({ key: 2, name: "Beta", openedAt: 2 }),
      tab({ key: 3, name: "Gamma", openedAt: 3 }),
    ];
    stripPreferences.value = { order: [3, 1, 2], pinned: [] };
    const closeTabs = vi.fn(async () => true);
    mount({ onCloseTabs: closeTabs });
    context("Alpha");
    await menuAction("Close to the Right");
    expect(closeTabs).toHaveBeenCalledExactlyOnceWith([1]);
  });

  it("keeps a pinned preview file when another preview opens", async () => {
    tabViews.value = [tab({ openedAt: nextOpenSequence() })];
    openFileTab("/repo", "/repo/a.ts", { keep: false });
    mount();
    context("a.ts");
    await menuAction("Pin");
    act(() => {
      openFileTab("/repo", "/repo/b.ts", { keep: false });
    });
    expect(chipNamed("a.ts").querySelector(".tab__label--preview")).toBeNull();
    expect(chipNamed("a.ts").dataset.pinned).toBe("true");
  });

  it("Escape closes the menu and a disappearing owner cannot redirect an action", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: 1 }),
      tab({ key: 2, name: "Beta", openedAt: 2 }),
    ];
    mount();
    context("Beta");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    context("Beta");
    act(() => {
      tabViews.value = [tab({ key: 1, name: "Alpha", openedAt: 1 })];
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("a cancelled file close stops the batch before touching any terminals", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() }),
      tab({ key: 2, name: "Beta", openedAt: nextOpenSequence() }),
    ];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    const closeTabs = vi.fn(async () => true);
    const closePath = vi.fn(async () => {});
    mount({ onCloseTabs: closeTabs, fileController: { ...fileController, closePath } });
    context("Alpha");
    await menuAction("Close Others");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/a.ts");
    expect(closeTabs).not.toHaveBeenCalled();
    expect(chipNamed("Beta")).toBeDefined();
  });

  it("Close explicitly targets a pinned tab, but bulk actions are unavailable beside only pinned tabs", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: 1 }),
      tab({ key: 2, name: "Beta", openedAt: 2 }),
    ];
    setStripPinned(1, true);
    setStripPinned(2, true);
    const closeTabs = vi.fn(async () => true);
    const closeTab = vi.fn();
    mount({ onCloseTabs: closeTabs, onCloseTab: closeTab });
    context("Alpha");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (el) => el.textContent === "Close Others",
      )?.disabled,
    ).toBe(true);
    await menuAction("Close");
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(0);
    expect(closeTabs).not.toHaveBeenCalled();
  });

  it("resolves terminal identities again after waiting for a file guard", async () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() }),
      tab({ key: 2, name: "Gone", openedAt: nextOpenSequence() }),
      tab({ key: 3, name: "Target", openedAt: nextOpenSequence() }),
    ];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    let release = (): void => {};
    const guard = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closePath = vi.fn(async (workspace: string, path: string) => {
      await guard;
      closeFileSurface(workspace, path);
    });
    const closeTabs = vi.fn(async () => true);
    mount({ onCloseTabs: closeTabs, fileController: { ...fileController, closePath } });
    context("Alpha");
    await menuAction("Close Others");
    expect(closeTabs).not.toHaveBeenCalled();
    await act(async () => {
      tabViews.value = [
        tab({ key: 3, name: "Target", openedAt: 3 }),
        tab({ key: 4, name: "New", openedAt: nextOpenSequence() }),
      ];
      release();
    });
    await vi.waitFor(() => expect(closeTabs).toHaveBeenCalledExactlyOnceWith([0]));
  });

  it.each([false, true])(
    "continues to browser and Agents only when the Busy guard accepts: %s",
    async (accepted) => {
      tabViews.value = [
        tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() }),
        tab({ key: 2, name: "Beta", openedAt: nextOpenSequence() }),
      ];
      browserOpen.value = true;
      browserOpenedAt.value = nextOpenSequence();
      openAgentBoard();
      const closeTabs = vi.fn(async () => accepted);
      const closeBrowser = vi.fn();
      const closeBoard = vi.fn();
      mount({
        onCloseTabs: closeTabs,
        onCloseBrowser: closeBrowser,
        onCloseAgentBoard: closeBoard,
      });
      context("Alpha");
      await menuAction("Close Others");
      expect(closeTabs).toHaveBeenCalledExactlyOnceWith([1]);
      expect(closeBrowser).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(closeBoard).toHaveBeenCalledTimes(accepted ? 1 : 0);
      if (!accepted) {
        expect(chipNamed("Browser")).toBeDefined();
        expect(chipNamed("Agents")).toBeDefined();
      }
    },
  );

  it("keeps a single close locked until its callback settles", async () => {
    tabViews.value = [tab({ key: 1, name: "Alpha", openedAt: 1 })];
    let release = (): void => {};
    const closeTab = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mount({ onCloseTab: closeTab });
    act(() => {
      chipNamed("Alpha").querySelector<HTMLButtonElement>(".tab__close")!.click();
    });
    act(() => {
      chipNamed("Alpha").querySelector<HTMLButtonElement>(".tab__close")!.click();
    });
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(0);
    await act(async () => {
      release();
    });
    await vi.waitFor(() => {
      act(() => {
        chipNamed("Alpha").querySelector<HTMLButtonElement>(".tab__close")!.click();
      });
      expect(closeTab).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      release();
    });
  });

  it("renders every chip, and no add button, with no .tabbar in the tree", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount();

    expect(host.querySelector(".tabbar")).toBeNull();
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
    expect(host.querySelector(".tab--file .tab__label")?.textContent).toBe("a.ts");
    // One row since 2026-08-16 (DL-18.6): no segment hairline anywhere in it.
    expect(host.querySelector(".tabbar__sep")).toBeNull();
    // No `+` after the chips since `rail-create-consolidation` (2026-09-02):
    // the strip's launcher was the one create control whose destination was
    // implicit, and ⌘T keeps the keyboard route.
    expect(host.querySelector(".tab-add")).toBeNull();
    expect(host.querySelector('[aria-label="New tab"]')).toBeNull();
  });

  it("puts the tab's newest turn on its chip, and keeps a typed name over it", () => {
    // DL-18.10 amended (2026-08-17, owner): a chip carries the same sentence
    // the rail row shows, through the same precedence — so the two surfaces
    // cannot quote different agents for one tab. A name the user typed still
    // wins, exactly as it does in the rail (DL-27.15).
    tabViews.value = [
      tab({ key: 1, name: null, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, name: "release cut", panes: [pane({ paneId: 21 })] }),
    ];
    paneTails.value = new Map([
      [11, "Reading the rail model"],
      [21, "Wrote the migration"],
    ]);
    mount({ scopeToActiveRepository: false });

    const labels = [...host.querySelectorAll(".tab .tab__label")].map((node) => node.textContent);
    expect(labels).toEqual(["Reading the rail model", "release cut"]);
    // The whole sentence stays reachable even though the chip trims it
    // (DL-27.4's contract, inherited with the sentence).
    expect(host.querySelector(".tab")?.getAttribute("title")).toBe("Reading the rail model");
  });

  it("keeps the process name on a chip whose agent has said nothing", () => {
    tabViews.value = [tab({ key: 1, name: null, process: "codex", panes: [pane()] })];
    mount({ scopeToActiveRepository: false });

    expect(host.querySelector(".tab .tab__label")?.textContent).toBe("codex");
  });

  it("places a chip by when it was opened, not by what kind it is", () => {
    // The file opens FIRST, so its chip leads a terminal tab opened after it.
    // Under the old two-segment strip every file chip followed every terminal
    // chip, whatever the clock said.
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    tabViews.value = [tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() })];
    mount();

    const labels = [...host.querySelectorAll(".tab .tab__label")].map((node) => node.textContent);
    expect(labels).toEqual(["a.ts", "Alpha"]);
  });

  it("follows the active tab's repository without losing global tab indexes", () => {
    // Scoping moved from the worktree to the REPOSITORY on 2026-08-16
    // (agent-status-rail spec §4.1): the rail's rows are tabs in a project, so
    // a strip scoped tighter than the rail would hide a sibling tab the rail
    // is still listing. `/r/side` therefore stays on the strip beside
    // `/r/main` — it is the SECOND repository that changes the projection.
    const scan: RepositoryScan = {
      kind: "repository",
      key: "/r/.git",
      root: "/r/main",
      worktrees: [
        {
          path: "/r/main",
          head: "a",
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
        {
          path: "/r/side",
          head: "b",
          branch: "side",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    };
    const other: RepositoryScan = {
      kind: "repository",
      key: "/other/.git",
      root: "/other",
      worktrees: [
        {
          path: "/other",
          head: "c",
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    };
    repositoryScans.value = new Map([
      ["/r/main", scan],
      ["/r/main/packages/app", scan],
      ["/r/side", scan],
      ["/other", other],
    ]);
    tabViews.value = [
      tab({ key: 1, name: "main · claude", workspacePath: "/r/main" }),
      tab({ key: 2, name: "side · codex", workspacePath: "/r/side" }),
      tab({
        key: 3,
        name: "main · opencode",
        workspacePath: "/r/main/packages/app",
      }),
      tab({ key: 4, name: "other · gemini", workspacePath: "/other" }),
    ];
    activeTabIndex.value = 0;
    const onSelectTab = vi.fn();
    mount({ onSelectTab });

    const labels = () =>
      [...host.querySelectorAll(".tab:not(.tab--file) .tab__label")].map(
        (label) => label.textContent,
      );
    // Every tab of the repository, in TAB order — a sub-package tab resolves
    // through the same longest-prefix match, and the other repository's tab
    // stays out.
    expect(labels()).toEqual(["main · claude", "side · codex", "main · opencode"]);

    act(() => {
      const visibleTabs = host.querySelectorAll<HTMLElement>(".tab:not(.tab--file)");
      visibleTabs[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(2);

    act(() => {
      activeTabIndex.value = 3; // the other repository
    });
    expect(labels()).toEqual(["other · gemini"]);
  });

  it("renders the browser chip while the tab is open and routes its actions", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    const onSelectBrowser = vi.fn();
    const onCloseBrowser = vi.fn();
    mount({ onSelectBrowser, onCloseBrowser });
    // Closed: no chip, no separator claiming an empty segment.
    expect(host.querySelector(".tab--browser")).toBeNull();

    act(() => {
      browserOpen.value = true;
      browserState.value = { ...EMPTY_STATE, title: "Academy — Home" };
    });
    const chip = host.querySelector<HTMLElement>(".tab--browser")!;
    expect(chip.textContent).toContain("Academy — Home");
    expect(chip.getAttribute("aria-selected")).toBe("false");

    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectBrowser).toHaveBeenCalledTimes(1);

    act(() => {
      browserSurfaceActive.value = true;
    });
    expect(chip.getAttribute("aria-selected")).toBe("true");
    // The terminal chip stands down while the browser holds the stage.
    expect(
      host.querySelector(".tab:not(.tab--file):not(.tab--browser)")?.getAttribute("aria-selected"),
    ).toBe("false");
    // A click on the ALREADY-active chip must not re-fire selection.
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectBrowser).toHaveBeenCalledTimes(1);

    chip
      .querySelector<HTMLButtonElement>(".tab__close")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCloseBrowser).toHaveBeenCalledTimes(1);
    expect(onSelectBrowser).toHaveBeenCalledTimes(1); // ✕ never selects
  });

  it("draws an agent board chip that is neither a file nor the browser", () => {
    // The strip used to read every non-file slot as the browser, which was
    // true at two surface kinds and silently wrong at three: a board chip
    // would have rendered as a globe labelled with the browser's page title.
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    const onSelectAgentBoard = vi.fn();
    const onCloseAgentBoard = vi.fn();
    mount({ onSelectAgentBoard, onCloseAgentBoard });
    expect(host.querySelector(".tab--agent-board")).toBeNull();

    act(() => {
      openAgentBoard();
    });
    const chip = host.querySelector<HTMLElement>(".tab--agent-board")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("Agents");
    expect(host.querySelectorAll(".tab--browser")).toHaveLength(0);
    // `openAgentBoard` puts it on the stage, so the terminal chip stands down.
    expect(chip.getAttribute("aria-selected")).toBe("true");
    expect(
      host
        .querySelector(".tab:not(.tab--file):not(.tab--agent-board)")
        ?.getAttribute("aria-selected"),
    ).toBe("false");

    // A click on the ALREADY-active chip must not re-fire selection.
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectAgentBoard).not.toHaveBeenCalled();

    act(() => {
      agentBoardSurfaceActive.value = false;
    });
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectAgentBoard).toHaveBeenCalledTimes(1);

    chip
      .querySelector<HTMLButtonElement>(".tab__close")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCloseAgentBoard).toHaveBeenCalledTimes(1);
    expect(onSelectAgentBoard).toHaveBeenCalledTimes(1); // ✕ never selects
  });
});
