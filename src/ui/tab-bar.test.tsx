// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dotColor as processDotColor } from "../lib/process-info";
import { tabDotCssColor } from "../lib/tab-colors";
import {
  activeTabIndex,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
import type { AgentAttentionSummary, TabView } from "../terminal/tabs-store";
import { TabBar } from "./tab-bar";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import {
  openFileTab,
  resetFileSurfaces,
  updateDocument,
} from "../files/file-surface-store";
import type { FileClient } from "../files/file-client";

const fileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused in this test" }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

function actionable(
  overrides: Partial<AgentAttentionSummary> = {},
): AgentAttentionSummary {
  return {
    kind: "error",
    actionableCount: 1,
    workingCount: 0,
    unreadCount: 0,
    ...overrides,
  };
}

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: "Tab",
    dotColor: null,
    workspacePath: "/Users/dev/project",
    agentBusy: false,
    unread: false,
    ...overrides,
  };
}

describe("TabBar", () => {
  let host: HTMLDivElement;
  let fileController: FileSurfaceController;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    tabViews.value = [];
    activeTabIndex.value = 0;
    requestTabOptionsKey.value = null;
    resetFileSurfaces();
    fileController = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    requestTabOptionsKey.value = null;
    resetDesktopEnvironmentForTests();
    fileController.dispose();
    resetFileSurfaces();
  });

  const baseProps = () => ({
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    onRenameTab: vi.fn(),
    onSetTabColor: vi.fn(),
    // TabBar places the toolbar element `App` builds; a marker div is enough
    // to prove the placement without dragging the whole projection in here.
    toolbar: <div data-testid="toolbar-slot" />,
    onFocusAttention: vi.fn(),
    fileController,
  });

  const mount = (props: ReturnType<typeof baseProps>): void => {
    act(() => {
      render(<TabBar {...props} />, host);
    });
  };

  it("shows the Windows New Tab shortcut without changing its accessible label", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\Deck",
    });
    mount(baseProps());

    const add = host.querySelector(".tab-add") as HTMLButtonElement;
    expect(add.title).toBe("New tab (Ctrl+Shift+T)");
    expect(add.getAttribute("aria-label")).toBe("New tab");
  });

  it("draws add and close as icons, named only by their labels", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    mount(baseProps());

    const add = host.querySelector(".tab-add") as HTMLButtonElement;
    const close = host.querySelector(".tab__close") as HTMLButtonElement;

    expect(add.querySelector(".lucide-plus")).not.toBeNull();
    expect(add.textContent).toBe("");
    expect(close.querySelector(".lucide-x")).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close tab");
  });

  it("clicking the status mark calls onFocusAttention(index) and does not select or toggle the popover", () => {
    tabViews.value = [
      tab({
        key: 1,
        name: "Alpha",
        attention: actionable({ kind: "error", actionableCount: 3 }),
      }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 0; // active tab: a non-mark click here would toggle the popover
    const props = baseProps();
    mount(props);

    const button = host.querySelector(".tab__attn button") as HTMLButtonElement;
    expect(button).not.toBeNull();

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onFocusAttention).toHaveBeenCalledTimes(1);
    expect(props.onFocusAttention).toHaveBeenCalledWith(0);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("clicking the status mark on an INACTIVE tab calls onFocusAttention(index) and does not leak into onSelectTab", () => {
    // Regression guard: on the active tab the row's own onClick can never
    // reach onSelectTab, so that case alone can't prove stopPropagation is
    // doing anything. Here the marked tab (index 1) is inactive — without
    // the .tab__attn wrapper's stopPropagation, this click would bubble to
    // the tab and call onSelectTab(1).
    tabViews.value = [
      tab({ key: 1, name: "Alpha" }),
      tab({
        key: 2,
        name: "Beta",
        attention: actionable({ kind: "error", actionableCount: 2 }),
      }),
    ];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const tabs = host.querySelectorAll(".tab");
    const button = tabs[1].querySelector(
      ".tab__attn button",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onFocusAttention).toHaveBeenCalledTimes(1);
    expect(props.onFocusAttention).toHaveBeenCalledWith(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("clicking an inactive tab calls onSelectTab", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha" }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const tabs = host.querySelectorAll(".tab");
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSelectTab).toHaveBeenCalledTimes(1);
    expect(props.onSelectTab).toHaveBeenCalledWith(1);
  });

  it("clicking the active tab opens the popover, and clicking it again closes it", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const row = host.querySelector(".tab") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".tab-popover")).not.toBeNull();
    expect(props.onSelectTab).not.toHaveBeenCalled();

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  // open-tab-options (⌘⇧R, docs/plans/2026-07-27-keyboard-parity.md Task 2):
  // the keyboard trigger doesn't know which chrome component is mounted, so
  // it goes through a shared signal instead of an imperative handle — each
  // side (TabBar/WorkspaceSidebar) listens and consumes it independently.
  it("requestTabOptionsKey opens the popover for that tab, anchored to its DOM element, then resets to null", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha" }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 1; // active tab need not be the one requested
    mount(baseProps());

    act(() => {
      requestTabOptionsKey.value = 1; // Alpha, not the active tab
    });

    const popover = host.querySelector(".tab-popover");
    expect(popover).not.toBeNull();
    expect(requestTabOptionsKey.value).toBeNull(); // consumed — won't re-fire
  });

  it("requestTabOptionsKey for a tab not in the DOM is a safe no-op — still resets to null, no throw", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    mount(baseProps());

    expect(() => {
      act(() => {
        requestTabOptionsKey.value = 999;
      });
    }).not.toThrow();

    expect(host.querySelector(".tab-popover")).toBeNull();
    expect(requestTabOptionsKey.value).toBeNull();
  });

  it("clicking close calls onCloseTab only", () => {
    tabViews.value = [
      tab({
        key: 1,
        name: "Alpha",
        attention: actionable({ kind: "warning", actionableCount: 1 }),
      }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const tabs = host.querySelectorAll(".tab");
    const close = tabs[1].querySelector(".tab__close") as HTMLButtonElement;

    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onCloseTab).toHaveBeenCalledTimes(1);
    expect(props.onCloseTab).toHaveBeenCalledWith(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(props.onFocusAttention).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("renders tab__dot using the process-derived color when no dotColor override is set", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", process: "claude", dotColor: null }),
    ];
    mount(baseProps());

    const dot = host.querySelector(".tab__dot") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute("style")).toContain(processDotColor("claude"));
  });

  it("renders tab__dot using the dotColor override when set, regardless of process", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", process: "claude", dotColor: "red" }),
    ];
    mount(baseProps());

    const dot = host.querySelector(".tab__dot") as HTMLElement;
    expect(dot.getAttribute("style")).toContain(tabDotCssColor("red"));
  });

  it("does not render a .tab__attn wrapper for an idle-attention tab (no empty flex-gap slot)", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha", attention: undefined })];
    mount(baseProps());

    expect(host.querySelector(".tab__attn")).toBeNull();
  });

  it("keeps a two-digit count off the mark while both the close and status buttons stay clickable", () => {
    tabViews.value = [
      tab({
        key: 1,
        name: "Alpha",
        attention: actionable({ kind: "error", actionableCount: 12 }),
      }),
    ];
    const props = baseProps();
    mount(props);

    const statusButton = host.querySelector(
      ".tab__attn button",
    ) as HTMLButtonElement;
    const closeButton = host.querySelector(".tab__close") as HTMLButtonElement;
    expect(statusButton).not.toBeNull();
    expect(closeButton).not.toBeNull();
    expect(statusButton.textContent).toBe("");
    expect(statusButton.getAttribute("title")).toContain("12");

    act(() => {
      statusButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onFocusAttention).toHaveBeenCalledWith(0);
    expect(props.onCloseTab).not.toHaveBeenCalled();

    act(() => {
      closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(props.onCloseTab).toHaveBeenCalledWith(0);
    expect(props.onFocusAttention).toHaveBeenCalledTimes(1);
  });

  /**
   * File tabs join the strip after every terminal tab (spec §4.2), driven by
   * the same controller wired as `TabManager`'s `SurfaceStrip` (Task 5).
   */
  describe("file tabs (spec §4.2)", () => {
    it("renders no file segment and no separator when nothing is open", () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      mount(baseProps());

      expect(host.querySelector(".tab--file")).toBeNull();
      expect(host.querySelector(".tabbar__sep")).toBeNull();
    });

    it("renders file tabs after the terminal tabs, preview italic on the unedited preview slot only", async () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      await fileController.openFile("/repo", "/repo/a.ts", true); // kept
      await fileController.openFile("/repo", "/repo/b.ts", false); // preview, untouched
      mount(baseProps());

      const rows = host.querySelectorAll(".tab");
      // 1 terminal + 2 file rows, file rows AFTER the terminal one, in order.
      expect(rows).toHaveLength(3);
      expect(rows[1].querySelector(".tab__label")?.textContent).toBe("a.ts");
      expect(rows[2].querySelector(".tab__label")?.textContent).toBe("b.ts");
      expect(rows[1].querySelector(".tab__label--preview")).toBeNull(); // kept
      expect(rows[2].querySelector(".tab__label--preview")).not.toBeNull(); // preview
      expect(host.querySelector(".tabbar__sep")).not.toBeNull();
    });

    it("renders the dirty dot on a file tab whose document is dirty", async () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      await fileController.openFile("/repo", "/repo/a.ts", true);
      updateDocument("/repo/a.ts", { dirty: true });
      mount(baseProps());

      expect(host.querySelector(".tab--file .tab__dot--dirty")).not.toBeNull();
    });

    it("clicking a file tab activates it through the controller, not onSelectTab", () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      openFileTab("/repo", "/repo/a.ts", { keep: true });
      const props = baseProps();
      mount(props);

      const fileRow = host.querySelector(".tab--file") as HTMLElement;
      act(() => {
        fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(props.onSelectTab).not.toHaveBeenCalled();
    });

    it("closing a file tab calls closePath, not onCloseTab", () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      openFileTab("/repo", "/repo/a.ts", { keep: true });
      const props = baseProps();
      const closePath = vi.spyOn(fileController, "closePath");
      mount(props);

      const close = host.querySelector(
        ".tab--file .tab__close",
      ) as HTMLButtonElement;
      act(() => {
        close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(closePath).toHaveBeenCalledWith("/repo", "/repo/a.ts");
      expect(props.onCloseTab).not.toHaveBeenCalled();
    });

    it("clicking the terminal tab that's still 'active' takes the stage back while a file surface is on top", () => {
      // Regression guard for the popover-vs-reselect fork: `index === active`
      // alone used to open the rename popover, which would leave the file
      // surface on the stage forever with no way back via that tab's chip.
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      activeTabIndex.value = 0;
      openFileTab("/repo", "/repo/a.ts", { keep: true }); // activates the file surface
      const props = baseProps();
      mount(props);

      const terminalRow = host.querySelector(
        ".tab:not(.tab--file)",
      ) as HTMLElement;
      expect(terminalRow.classList.contains("is-active")).toBe(false);

      act(() => {
        terminalRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(props.onSelectTab).toHaveBeenCalledWith(0);
      expect(host.querySelector(".tab-popover")).toBeNull();
    });
  });
});
