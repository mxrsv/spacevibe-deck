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
 *
 * Since 2026-09-28 (DL-35.3) a terminal tab is a space MARK, not a chip: the
 * bar draws the current space's folder and one mark per space, and only
 * documents, the browser and the Board keep chips. The menu, close and order
 * behaviour below is driven through the marks for terminals.
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
    // Unnamed unless a test names it: a space's name now replaces its folder.
    name: null,
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
  /** The space mark of the terminal tab with this `TabView.key`. */
  const mark = (key: number): HTMLElement =>
    host.querySelector<HTMLElement>(`.space-mark[data-space-key="${key}"]`)!;
  const markKeys = (): number[] =>
    [...host.querySelectorAll<HTMLElement>(".space-mark")].map((el) => Number(el.dataset.spaceKey));
  it("selects a space from its mark after dismissing a transient launcher", () => {
    tabViews.value = [tab()];
    const calls: string[] = [];
    mount({
      transientPageOpen: true,
      onBeforeSelect: () => calls.push("dismiss"),
      onSelectTab: () => calls.push("select"),
    });
    act(() => mark(1).click());
    expect(calls).toEqual(["dismiss", "select"]);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  it("reorders surface chips from mouse pointer events, and marks carry no drag handle", () => {
    tabViews.value = [tab({ key: 1, openedAt: nextOpenSequence() })];
    openFileTab("/repo", "/repo/first.ts", { keep: true });
    openFileTab("/repo", "/repo/second.ts", { keep: true });
    const select = vi.fn();
    mount({ onSelectTab: select });
    expect(mark(1).hasAttribute("data-strip-key")).toBe(false);
    const list = host.querySelector<HTMLElement>('.tabbar__tabs[role="tablist"]')!;
    const box = (left: number, width: number) =>
      ({ left, right: left + width, top: 0, bottom: 30, width, height: 30 }) as DOMRect;
    list.getBoundingClientRect = () => box(0, 200);
    chipNamed("first.ts").getBoundingClientRect = () => box(0, 100);
    chipNamed("second.ts").getBoundingClientRect = () => box(100, 100);
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
      pointer(chipNamed("second.ts").querySelector(".tab__label")!, "pointerdown", 150);
      pointer(window, "pointermove", 10);
      pointer(window, "pointerup", 10);
      list.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect([...list.querySelectorAll(".tab__label")].map((el) => el.textContent)).toEqual([
      "second.ts",
      "first.ts",
    ]);
    expect(select).not.toHaveBeenCalled();
  });
  const context = (target: string | number): void => {
    act(() => {
      (typeof target === "number" ? mark(target) : chipNamed(target)).dispatchEvent(
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

  it("offers a space's menu without Pin, and never selects from it", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() }),
      tab({ key: 2, name: "Beta", openedAt: nextOpenSequence() }),
    ];
    const select = vi.fn();
    mount({ onSelectTab: select });
    context(2);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(mark(2).getAttribute("aria-expanded")).toBe("true");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (el) => el.textContent === "Pin",
      )?.disabled,
    ).toBe(true);
    expect(select).not.toHaveBeenCalled();
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
    context(1);
    await menuAction("Close Others");
    expect(closeTabs).toHaveBeenCalledExactlyOnceWith([2]);
  });

  it("draws marks in the rail's order, not a manual strip order, and closes to the right of that", async () => {
    // DL-35.3 (owner, 2026-09-29): a mark sits where its tab sits in the
    // sidebar — one workspace's spaces together — so neither opening order
    // nor a stored strip order moves it.
    tabViews.value = [
      tab({ key: 1, name: "Alpha", openedAt: 1, workspacePath: "/a" }),
      tab({ key: 2, name: "Beta", openedAt: 2, workspacePath: "/b" }),
      tab({ key: 3, name: "Gamma", openedAt: 3, workspacePath: "/a" }),
    ];
    stripPreferences.value = { order: [2, 3, 1], pinned: [] };
    const closeTabs = vi.fn(async () => true);
    // Unscoped, as `App` mounts it since 2026-09-29: every workspace's spaces.
    mount({ onCloseTabs: closeTabs, scopeToActiveRepository: false });
    expect(markKeys()).toEqual([1, 3, 2]);
    context(3);
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
    context(2);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    context(2);
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
    context(1);
    await menuAction("Close Others");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/a.ts");
    expect(closeTabs).not.toHaveBeenCalled();
    expect(mark(2)).not.toBeNull();
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
    context(1);
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
    context(1);
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
      context(1);
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
    context(1);
    await menuAction("Close");
    context(1);
    await menuAction("Close");
    expect(closeTab).toHaveBeenCalledExactlyOnceWith(0);
    await act(async () => {
      release();
    });
    await vi.waitFor(async () => {
      context(1);
      await menuAction("Close");
      expect(closeTab).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      release();
    });
  });

  it("renders a mark per space and a chip per surface, and no add button, with no .tabbar in the tree", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount();

    expect(host.querySelector(".tabbar")).toBeNull();
    expect(host.querySelectorAll(".space-mark")).toHaveLength(1);
    expect(host.querySelectorAll(".tab")).toHaveLength(1);
    expect(host.querySelector(".tab--file .tab__label")?.textContent).toBe("a.ts");
    // One row since 2026-08-16 (DL-18.6): no segment hairline anywhere in it.
    expect(host.querySelector(".tabbar__sep")).toBeNull();
    // No `+` after the chips since `rail-create-consolidation` (2026-09-02):
    // the strip's launcher was the one create control whose destination was
    // implicit, and ⌘T keeps the keyboard route.
    expect(host.querySelector(".tab-add")).toBeNull();
    expect(host.querySelector('[aria-label="New tab"]')).toBeNull();
  });

  it("names the current space by its folder and describes every mark by folder and counts", () => {
    tabViews.value = [
      tab({ key: 1, workspacePath: "/w/spacevibe-deck", panes: [pane({ paneId: 11 })] }),
      tab({
        key: 2,
        workspacePath: "/w/spacevibe-api",
        panes: [pane({ paneId: 21, attention: "requested" }), pane({ paneId: 22 })],
      }),
    ];
    mount({ scopeToActiveRepository: false });

    const shown = host.querySelector('.space-bar__name-slot[data-current="true"]');
    expect(shown?.textContent).toBe("spacevibe-deck");
    expect(mark(1).getAttribute("aria-selected")).toBe("true");
    expect(mark(1).getAttribute("aria-label")).toBe("spacevibe-deck · 1 agent");
    expect(mark(2).getAttribute("aria-label")).toBe("spacevibe-api · 2 agents · 1 need you");
    // DL-35.3: yellow for needs-you is the one state a mark carries.
    expect(mark(2).dataset.needs).toBe("asked");
    act(() => {
      tabViews.value = [
        tabViews.value[0]!,
        { ...tabViews.value[1]!, panes: [pane({ paneId: 21, attention: "error" })] },
      ];
    });
    // A failure is red, not yellow (DL-3.2).
    expect(mark(2).dataset.needs).toBe("failed");
    expect(mark(1).dataset.needs).toBeUndefined();
    // A mark is not a chip: no turn text, no process name, no native title.
    expect(mark(1).textContent).toBe("");
    expect(mark(1).hasAttribute("title")).toBe(false);
  });

  it("indexes spaces that share a workspace in the label and the accessible name", () => {
    tabViews.value = [tab({ key: 1 }), tab({ key: 2 })];
    mount({ scopeToActiveRepository: false });

    expect(host.querySelector('.space-bar__name-slot[data-current="true"]')?.textContent).toBe(
      "repo 1",
    );
    expect(mark(1).getAttribute("aria-label")).toBe("repo 1 · 0 agents");
    expect(mark(2).getAttribute("aria-label")).toBe("repo 2 · 0 agents");
  });

  it("shows a space's name in place of its folder, and keeps folder and index in the card", () => {
    tabViews.value = [
      tab({ key: 1, name: "auth", panes: [pane()] }),
      tab({ key: 2, panes: [pane({ paneId: 21 })] }),
    ];
    repositoryScans.value = new Map<string, RepositoryScan>([
      [
        "/repo",
        {
          kind: "repository",
          key: "/repo/.git",
          root: "/repo",
          worktrees: [
            {
              path: "/repo",
              head: "a",
              branch: "main",
              bare: false,
              detached: false,
              locked: null,
              prunable: null,
            },
          ],
        },
      ],
    ]);
    mount({ scopeToActiveRepository: false });

    expect(host.querySelector('.space-bar__name-slot[data-current="true"]')?.textContent).toBe(
      "auth",
    );
    expect(mark(1).getAttribute("aria-label")).toBe("auth · 1 agent");
    // The name never renumbers a neighbour: the unnamed one is still `repo 2`.
    expect(mark(2).getAttribute("aria-label")).toBe("repo 2 · 1 agent");

    act(() => mark(1).focus());
    const card = document.querySelector<HTMLElement>(".space-card")!;
    expect(card.querySelector(".space-card__name")?.textContent).toBe("auth");
    expect(card.querySelector(".space-card__meta")?.textContent).toBe(
      "repo 1 · main · 1 agent",
    );
  });

  describe("renaming a space in place (DL-35.3)", () => {
    const label = (): HTMLElement =>
      host.querySelector<HTMLElement>('.space-bar__name-slot[data-current="true"] .space-bar__label')!;
    const field = (): HTMLInputElement | null => host.querySelector("input.space-rename");
    const type = (value: string, key: string): void => {
      act(() => {
        field()!.value = value;
        field()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };
    const openField = (): void => {
      act(() => {
        label().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
    };

    it("opens on a double-click of the label, saves on Enter with the tab's index", () => {
      tabViews.value = [tab({ key: 5, name: null }), tab({ key: 6, name: null })];
      activeTabIndex.value = 1;
      const onRenameTab = vi.fn();
      mount({ scopeToActiveRepository: false, onRenameTab });

      expect(field()).toBeNull();
      openField();
      expect(field()).not.toBeNull();
      expect(field()!.value).toBe("");
      expect(field()!.placeholder).toBe("repo 2");

      type("scroll fix", "Enter");
      expect(onRenameTab).toHaveBeenCalledWith(1, "scroll fix");
      expect(field()).toBeNull();
    });

    it("starts from the current name, cancels on Escape, and clears with an empty name", () => {
      tabViews.value = [tab({ key: 5, name: "auth" })];
      const onRenameTab = vi.fn();
      mount({ scopeToActiveRepository: false, onRenameTab });

      openField();
      expect(field()!.value).toBe("auth");
      type("changed", "Escape");
      expect(onRenameTab).not.toHaveBeenCalled();
      expect(field()).toBeNull();

      openField();
      type("", "Enter");
      expect(onRenameTab).toHaveBeenCalledWith(0, null);
    });
  });

  it("raises a name-and-counts hover card on focus, and drops it on blur", () => {
    tabViews.value = [tab({ key: 1, workspacePath: "/Users/deck/repo", panes: [pane()] })];
    mount({ scopeToActiveRepository: false });

    act(() => mark(1).focus());
    const card = document.querySelector<HTMLElement>(".space-card")!;
    expect(card).not.toBeNull();
    expect(mark(1).getAttribute("aria-describedby")).toBe(card.id);
    expect(card.textContent).toContain("repo");
    expect(card.textContent).toContain("1 agent");
    expect(card.textContent).not.toContain("/Users/deck");
    expect(card.querySelector(".space-card__path, .space-card__mini")).toBeNull();

    act(() => mark(1).blur());
    expect(document.querySelector(".space-card")).toBeNull();
  });

  it("draws every space mark before every surface chip, whatever was opened first", () => {
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    tabViews.value = [tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() })];
    mount();

    const order = [...host.querySelectorAll(".space-mark, .tab")].map((el) =>
      el.classList.contains("space-mark") ? "mark" : el.querySelector(".tab__label")?.textContent,
    );
    expect(order).toEqual(["mark", "a.ts"]);
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

    // Every tab of the repository, in the RAIL's order (DL-35.3, 2026-09-29):
    // the main checkout's two tabs — a sub-package tab resolves through the
    // same longest-prefix match — then the side worktree's. The other
    // repository's tab stays out of a scoped strip.
    expect(markKeys()).toEqual([1, 3, 2]);

    act(() => {
      mark(3).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(2);

    act(() => {
      activeTabIndex.value = 3; // the other repository
    });
    expect(markKeys()).toEqual([4]);
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
