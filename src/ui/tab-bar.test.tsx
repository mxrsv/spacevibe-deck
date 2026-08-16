// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
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
    agents: [],
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
    resetFileSurfaces();
    fileController = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
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
    onSelectBrowser: vi.fn(),
    onCloseBrowser: vi.fn(),
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

  it("clicking the chip that already holds the stage does nothing", () => {
    // It used to open the rename popover. The owner removed that popover from
    // the strip on 2026-08-16, so the click is inert — it must not fall
    // through to a selection either.
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const row = host.querySelector(".tab") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector(".tab-popover")).toBeNull();
    expect(props.onSelectTab).not.toHaveBeenCalled();
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

  it("leads a terminal chip with the agent's mark and no colour dot", () => {
    // The colour dot left the chip on 2026-08-16 (DL-18.10 amended). Both of
    // the tests this replaced asserted its fill — from the process, and from
    // the `dotColor` override — and the override itself is untouched
    // (`tabs-store.test.ts` still covers the merge); it simply has nothing on
    // the strip to paint any more.
    tabViews.value = [
      tab({
        key: 1,
        name: "Alpha",
        process: "claude",
        agents: ["claude"],
        dotColor: "red",
      }),
    ];
    mount(baseProps());

    expect(host.querySelector(".tab .tab__dot")).toBeNull();
    expect(host.querySelector(".tab .tab__logo")).not.toBeNull();
  });

  it("falls back to the terminal glyph for a tab running no recognised agent", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", process: "zsh", agents: [] }),
    ];
    mount(baseProps());

    expect(host.querySelector(".tab .tab__logo")).toBeNull();
    expect(host.querySelector(".tab .tab__glyph svg")).not.toBeNull();
    expect(host.querySelector(".tab .tab__dot")).toBeNull();
  });

  it("carries no attention mark, whatever the tab's state", () => {
    // The strip stopped showing agent state on 2026-08-16 (DL-18.10): a chip
    // says what is open, the rail says what an agent is doing. Both an idle
    // summary and a loud actionable one render exactly the same chip.
    tabViews.value = [
      tab({ key: 1, name: "Alpha", attention: undefined }),
      tab({
        key: 2,
        name: "Beta",
        attention: actionable({ kind: "error", actionableCount: 12 }),
      }),
    ];
    mount(baseProps());

    expect(host.querySelector(".tab__attn")).toBeNull();
    expect(host.querySelector(".attn-mark")).toBeNull();
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
  });

  /**
   * File chips share the one strip with the terminal tabs (spec §4.2), driven
   * by the same controller wired as `TabManager`'s `SurfaceStrip` (Task 5).
   * Since 2026-08-16 they sit in open order rather than in a segment of their
   * own, and the hairline that used to split the two is gone (DL-18.6).
   */
  describe("file tabs (spec §4.2)", () => {
    it("renders no file chip when nothing is open", () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      mount(baseProps());

      expect(host.querySelector(".tab--file")).toBeNull();
      expect(host.querySelector(".tabbar__sep")).toBeNull();
    });

    it("renders file tabs after a terminal tab that predates them, preview italic on the unedited preview slot only", async () => {
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
      // The segment hairline is gone with the segments themselves (DL-18.6).
      expect(host.querySelector(".tabbar__sep")).toBeNull();
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
