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
import { browserOpen, resetBrowserStore } from "../browser/browser-store";
import { TabBar } from "./tab-bar";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { openFileTab, resetFileSurfaces } from "../files/file-surface-store";
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
    resetBrowserStore();
    fileController = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    resetDesktopEnvironmentForTests();
    fileController.dispose();
    resetFileSurfaces();
    resetBrowserStore();
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
    browserOpen.value = true;
    mount(baseProps());

    const close = host.querySelector(".tab__close") as HTMLButtonElement;

    expect(close.querySelector(".deck-icon--x")).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close the browser tab");
  });

  it("clicking an inactive tab calls onSelectTab", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" }), tab({ key: 2, name: "Beta" })];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const marks = host.querySelectorAll(".space-mark");
    act(() => {
      marks[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSelectTab).toHaveBeenCalledTimes(1);
    expect(props.onSelectTab).toHaveBeenCalledWith(1);
  });

  it("clicking the mark of the space that already holds the stage does nothing", () => {
    // It used to open the rename popover. The owner removed that popover from
    // the strip on 2026-08-16, so the click is inert — it must not fall
    // through to a selection either.
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const row = host.querySelector(".space-mark") as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector(".tab-popover")).toBeNull();
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it("closing a space from its menu calls onCloseTab only", async () => {
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

    const marks = host.querySelectorAll(".space-mark");
    act(() => {
      marks[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((el) => el.textContent === "Close")!
        .click();
    });

    expect(props.onCloseTab).toHaveBeenCalledTimes(1);
    expect(props.onCloseTab).toHaveBeenCalledWith(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(props.onFocusAttention).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("draws a terminal tab as a space mark, with no agent glyph, colour dot or label", () => {
    // DL-35.3 (2026-09-28): a terminal tab left the chip shape. The colour dot
    // had already gone on 2026-08-16 (DL-18.10); the glyph and label went with
    // the chip.
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

    expect(host.querySelectorAll(".space-mark")).toHaveLength(1);
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
    // Only panes drive a mark's needs-you (DL-35.3); a tab summary does not.
    expect(host.querySelectorAll(".space-mark[data-needs]")).toHaveLength(0);
    expect(host.querySelectorAll(".space-mark")).toHaveLength(2);
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

    it("keeps open documents out of the top strip and the terminal mark active", async () => {
      tabViews.value = [tab({ key: 1, name: "Alpha" })];
      await fileController.openFile("/repo", "/repo/a.ts", true);
      await fileController.openFile("/repo", "/repo/b.ts", false);
      mount(baseProps());
      expect(host.querySelectorAll(".space-mark")).toHaveLength(1);
      expect(host.querySelectorAll(".tab")).toHaveLength(0);
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

      const terminalRow = host.querySelector(".space-mark") as HTMLElement;

      act(() => {
        terminalRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(props.onSelectTab).toHaveBeenCalledWith(0);
      expect(host.querySelector(".tab-popover")).toBeNull();
    });
  });
});
