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
 * The sidebar mount keeps the current-space breadcrumb but hides space marks,
 * because the rail lists the spaces. Exercise menus through visible surface
 * chips. Top-tab mode keeps the marks; `tab-bar.test.tsx` covers them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTabIndex, tabViews, type TabView } from "../terminal/tabs-store";
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
            hideMarks
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
  it("reorders surface chips from mouse pointer events with no space marks", () => {
    tabViews.value = [tab({ key: 1, openedAt: nextOpenSequence() })];
    openFileTab("/repo", "/repo/first.ts", { keep: true });
    openFileTab("/repo", "/repo/second.ts", { keep: true });
    const select = vi.fn();
    mount({ onSelectTab: select });
    expect(host.querySelector(".space-mark")).toBeNull();
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
  const context = (target: string): void => {
    act(() => {
      chipNamed(target).dispatchEvent(
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

  it("shows the active breadcrumb and surface chips without terminal marks", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" }), tab({ key: 2, name: "Beta" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount({ scopeToActiveRepository: false });
    const label = () =>
      host.querySelector('.space-bar__name-slot[data-current="true"] .space-bar__label')
        ?.textContent;
    expect(label()).toBe("Alpha");
    expect(host.querySelector(".space-mark, .space-bar__marks, .tab-add, .tabbar")).toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(chipNamed("a.ts")).toBeDefined();
    act(() => {
      activeTabIndex.value = 1;
    });
    expect(label()).toBe("Beta");
  });

  it("draws a mark per space again when the mount has no rail", () => {
    const select = vi.fn();
    tabViews.value = [tab({ key: 1, name: "Alpha" }), tab({ key: 2, name: "Beta" })];
    mount({ scopeToActiveRepository: false, hideMarks: false, onSelectTab: select });

    const marks = host.querySelectorAll<HTMLElement>(".space-mark");
    expect(marks).toHaveLength(2);
    act(() => marks[1].click());
    expect(select).toHaveBeenCalledWith(1);
  });

  it("dismisses a transient launcher before selecting a browser chip", () => {
    tabViews.value = [tab()];
    browserOpen.value = true;
    const calls: string[] = [];
    mount({
      transientPageOpen: true,
      onBeforeSelect: () => calls.push("dismiss"),
      onSelectBrowser: () => calls.push("select"),
    });
    act(() => chipNamed("Browser").click());
    expect(calls).toEqual(["dismiss", "select"]);
  });

  it("Escape and removal of the owning file close its menu", () => {
    tabViews.value = [tab()];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount();
    context("a.ts");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    context("a.ts");
    act(() => {
      closeFileSurface("/repo", "/repo/a.ts");
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("Close Others skips pinned terminals and terminals outside the active repository", async () => {
    const keys = [nextOpenSequence(), nextOpenSequence(), nextOpenSequence()];
    tabViews.value = [
      tab({ key: 1, openedAt: keys[0] }),
      tab({ key: 2, openedAt: keys[1] }),
      tab({ key: 3, openedAt: keys[2], workspacePath: "/elsewhere" }),
    ];
    setStripPinned(keys[1]!, true);
    openFileTab("/repo", "/repo/keep.ts", { keep: true });
    const closeTabs = vi.fn(async () => true);
    mount({ onCloseTabs: closeTabs });
    context("keep.ts");
    await menuAction("Close Others");
    expect(closeTabs).toHaveBeenCalledExactlyOnceWith([0]);
  });

  it("Close to the Right closes only unpinned surfaces after the owner", async () => {
    tabViews.value = [tab({ openedAt: nextOpenSequence() })];
    for (const name of ["left", "owner", "pinned", "right"]) {
      openFileTab("/repo", `/repo/${name}.ts`, { keep: true });
    }
    const closeTabs = vi.fn(async () => true);
    const closePath = vi.fn(async (workspace: string, path: string) => {
      closeFileSurface(workspace, path);
    });
    mount({ onCloseTabs: closeTabs, fileController: { ...fileController, closePath } });
    context("pinned.ts");
    await menuAction("Pin");
    context("owner.ts");
    await menuAction("Close to the Right");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/right.ts");
    expect(closeTabs).not.toHaveBeenCalled();
    expect(
      ["left.ts", "owner.ts", "pinned.ts"].map((name) => chipNamed(name)?.textContent),
    ).toEqual(["left.ts", "owner.ts", "pinned.ts"]);
  });

  it("explicitly closes a pinned file while bulk actions exclude pinned targets", async () => {
    const openedAt = nextOpenSequence();
    tabViews.value = [tab({ openedAt })];
    setStripPinned(openedAt, true);
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    openFileTab("/repo", "/repo/b.ts", { keep: true });
    const closePath = vi.fn(async (workspace: string, path: string) => {
      closeFileSurface(workspace, path);
    });
    mount({ fileController: { ...fileController, closePath } });
    for (const name of ["a.ts", "b.ts"]) {
      context(name);
      await menuAction("Pin");
    }
    context("a.ts");
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.find((item) => item.textContent === "Close Others")?.disabled).toBe(true);
    expect(items.find((item) => item.textContent === "Close to the Right")?.disabled).toBe(true);
    await menuAction("Close");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/a.ts");
    expect(chipNamed("a.ts")).toBeUndefined();
    expect(chipNamed("b.ts")).toBeDefined();
  });

  it("a cancelled file close stops the batch before touching terminals", async () => {
    tabViews.value = [tab({ openedAt: nextOpenSequence() })];
    openFileTab("/repo", "/repo/keep.ts", { keep: true });
    openFileTab("/repo", "/repo/dirty.ts", { keep: true });
    const closeTabs = vi.fn(async () => true);
    const closePath = vi.fn(async () => {});
    mount({ onCloseTabs: closeTabs, fileController: { ...fileController, closePath } });
    context("keep.ts");
    await menuAction("Close Others");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/dirty.ts");
    expect(closeTabs).not.toHaveBeenCalled();
    expect(tabViews.value).toHaveLength(1);
  });

  it("resolves terminal identities again after waiting for a file guard", async () => {
    tabViews.value = [
      tab({ key: 1, openedAt: nextOpenSequence() }),
      tab({ key: 2, openedAt: nextOpenSequence() }),
    ];
    openFileTab("/repo", "/repo/keep.ts", { keep: true });
    openFileTab("/repo", "/repo/close.ts", { keep: true });
    let release = () => {};
    const guard = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closePath = vi.fn(async (workspace: string, path: string) => {
      await guard;
      closeFileSurface(workspace, path);
    });
    const closeTabs = vi.fn(async () => true);
    mount({ onCloseTabs: closeTabs, fileController: { ...fileController, closePath } });
    context("keep.ts");
    await menuAction("Close Others");
    expect(closePath).toHaveBeenCalledExactlyOnceWith("/repo", "/repo/close.ts");
    expect(closeTabs).not.toHaveBeenCalled();
    await act(async () => {
      tabViews.value = [
        tab({ key: 2, openedAt: 2 }),
        tab({ key: 3, openedAt: nextOpenSequence() }),
      ];
      release();
    });
    await vi.waitFor(() => expect(closeTabs).toHaveBeenCalledExactlyOnceWith([0]));
  });

  it.each([false, true])(
    "closes the browser and board only when the terminal guard accepts: %s",
    async (accepted) => {
      tabViews.value = [tab({ openedAt: nextOpenSequence() })];
      openFileTab("/repo", "/repo/keep.ts", { keep: true });
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
      context("keep.ts");
      await menuAction("Close Others");
      expect(closeTabs).toHaveBeenCalledExactlyOnceWith([0]);
      expect(closeBrowser).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(closeBoard).toHaveBeenCalledTimes(accepted ? 1 : 0);
    },
  );

  it("keeps a single close locked until its callback settles", async () => {
    tabViews.value = [tab()];
    browserOpen.value = true;
    let release = () => {};
    const closeBrowser = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mount({ onCloseBrowser: closeBrowser });
    context("Browser");
    await menuAction("Close");
    context("Browser");
    await menuAction("Close");
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    await vi.waitFor(async () => {
      context("Browser");
      await menuAction("Close");
      expect(closeBrowser).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      release();
    });
  });

  describe("renaming a space in place (DL-35.3)", () => {
    const label = (): HTMLElement =>
      host.querySelector<HTMLElement>(
        '.space-bar__name-slot[data-current="true"] .space-bar__label',
      )!;
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
