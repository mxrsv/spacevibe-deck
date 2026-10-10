// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeTabIndex,
  tabViews,
  type AgentAttentionSummary,
  type TabView,
} from "../terminal/tabs-store";
import { TabBar } from "./tab-bar";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { openFileTab, resetFileSurfaces, updateDocument } from "../files/file-surface-store";
import type { FileClient } from "../files/file-client";

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

function actionable(overrides: Partial<AgentAttentionSummary> = {}): AgentAttentionSummary {
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
    onRenameTab: vi.fn(),
    onSetTabColor: vi.fn(),
    // TabBar places the toolbar element `App` builds; a marker div is enough
    // to prove the placement without dragging the whole projection in here.
    toolbar: <div data-testid="toolbar-slot" />,
    onFocusAttention: vi.fn(),
    fileController,
    onSelectBrowser: vi.fn(),
    onCloseBrowser: vi.fn(),
    onSelectAgentBoard: vi.fn(),
    onCloseAgentBoard: vi.fn(),
  });

  const mount = (props: ReturnType<typeof baseProps>): void => {
    act(() => {
      render(<TabBar {...props} />, host);
    });
  };

  it("carries no add button in top-tab mode either", () => {
    // `rail-create-consolidation` (2026-09-02): the strip's `+` is gone in BOTH
    // layouts. Top-tab mode has no sidebar, so this frame has no mouse create
    // control at all — ⌘T's free-standing list, which carries
    // `Open another project…`, is the route, and that consequence is recorded
    // in the change's proposal for the owner.
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\Deck",
    });
    mount(baseProps());

    expect(host.querySelector(".tab-add")).toBeNull();
    expect(host.querySelector('[aria-label="New tab"]')).toBeNull();
  });

  it("draws a surface chip's close as an icon, named only by its label", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount(baseProps());

    const close = host.querySelector(".tab__close") as HTMLButtonElement;

    expect(close.querySelector(".deck-icon--x")).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close a.ts");
  });

  it("shows a terminal breadcrumb without a space mark, agent glyph or colour dot", () => {
    // The current space keeps its breadcrumb; its mark row is hidden.
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

    expect(host.querySelectorAll(".space-mark")).toHaveLength(0);
    expect(host.querySelector(".space-bar__label")?.textContent).toBe("Alpha");
    expect(host.querySelector(".tab")).toBeNull();
    expect(host.querySelector(".tab__logo, .tab__dot")).toBeNull();
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
    // Space marks remain hidden even when a terminal needs attention.
    expect(host.querySelectorAll(".space-mark[data-needs]")).toHaveLength(0);
    expect(host.querySelectorAll(".space-mark")).toHaveLength(0);
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

    it("renders file tabs beside the breadcrumb, preview italic on the unedited preview slot only", async () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      await fileController.openFile("/repo", "/repo/a.ts", true); // kept
      await fileController.openFile("/repo", "/repo/b.ts", false); // preview, untouched
      mount(baseProps());

      const rows = host.querySelectorAll(".tab");
      // The breadcrumb remains beside the two file chips; space marks are hidden.
      expect(host.querySelectorAll(".space-mark")).toHaveLength(0);
      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector(".tab__label")?.textContent).toBe("a.ts");
      expect(rows[1].querySelector(".tab__label")?.textContent).toBe("b.ts");
      expect(rows[0].querySelector(".tab__label--preview")).toBeNull(); // kept
      expect(rows[1].querySelector(".tab__label--preview")).not.toBeNull(); // preview
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

      const close = host.querySelector(".tab--file .tab__close") as HTMLButtonElement;
      act(() => {
        close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(closePath).toHaveBeenCalledWith("/repo", "/repo/a.ts");
      expect(props.onCloseTab).not.toHaveBeenCalled();
    });
  });
});
