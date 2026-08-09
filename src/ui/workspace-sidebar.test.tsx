// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkspaceSidebar pulls in Tauri-backed stores (workspace logo persistence,
// favicon scanning, the native file dialog) through its imports; stub them so
// the tree mounts under jsdom, mirroring the settings section tests.
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
// installFileDrop talks to the real webview/window Tauri APIs (drag & drop) —
// not exercised by these tests, so replace it with a no-op unlisten.
vi.mock("../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));

import {
  activeTabIndex,
  IDLE_ATTENTION_SUMMARY,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
import type { AgentAttentionSummary, TabView } from "../terminal/tabs-store";
import { WorkspaceSidebar } from "./workspace-sidebar";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";

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

describe("WorkspaceSidebar", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    tabViews.value = [];
    activeTabIndex.value = 0;
    requestTabOptionsKey.value = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    requestTabOptionsKey.value = null;
    resetDesktopEnvironmentForTests();
  });

  const baseProps = () => ({
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onMoveTab: vi.fn(),
    onNewTab: vi.fn(),
    onRenameTab: vi.fn(),
    onSetTabColor: vi.fn(),
    onFocusAttention: vi.fn(),
  });

  const mount = (props: ReturnType<typeof baseProps>): void => {
    act(() => {
      render(<WorkspaceSidebar {...props} />, host);
    });
  };

  /**
   * jsdom has no PointerEvent and lays nothing out, so the drag is driven by
   * MouseEvents under the pointer names (Preact dispatches by name) with each
   * row given a 40px box — which half of a row the pointer is in is the whole
   * reorder decision.
   */
  const ROW_HEIGHT = 40;

  const layOutRows = (): void => {
    host.querySelectorAll<HTMLElement>(".wsitem").forEach((row, index) => {
      row.getBoundingClientRect = () =>
        ({
          top: index * ROW_HEIGHT,
          bottom: (index + 1) * ROW_HEIGHT,
          height: ROW_HEIGHT,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: index * ROW_HEIGHT,
          toJSON: () => ({}),
        }) as DOMRect;
    });
  };

  const pointer = (
    row: Element,
    type: "pointerdown" | "pointermove" | "pointerup",
    clientY: number,
  ): void => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientY,
      button: 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    // Pointer capture is a real API the component calls; jsdom lacks it.
    (row as HTMLElement).setPointerCapture ??= () => {};
    act(() => {
      row.dispatchEvent(event);
    });
  };

  it("draws the workspace close action as an icon", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    mount(baseProps());

    const close = host.querySelector(".wsitem__close") as HTMLButtonElement;
    expect(close.querySelector(".lucide-x")).not.toBeNull();
    expect(close.getAttribute("aria-label")).toBe("Close workspace");
  });

  it("shows the Windows New Tab shortcut without changing its accessible label", () => {
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:\\Users\\Deck",
    });
    mount(baseProps());

    const add = host.querySelector(".wsbar__add") as HTMLButtonElement;
    expect(add.title).toBe("New tab (Ctrl+Shift+T)");
    expect(add.getAttribute("aria-label")).toBe("New tab");
    expect(add.querySelector(".lucide-plus")).not.toBeNull();
    // The word stays: this control is wide and reads as a labelled action.
    expect(add.textContent).toContain("Open workspace");
  });

  it("renders the label, path, and logo for each row", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha", workspacePath: "/Users/dev/alpha" }),
      tab({ key: 2, name: "Beta", workspacePath: "/Users/dev/beta" }),
    ];
    mount(baseProps());

    const rows = host.querySelectorAll(".wsitem");
    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("Alpha");
    expect(host.textContent).toContain("Beta");
    expect(rows[0].querySelector(".wsitem__logo")).not.toBeNull();
    expect(rows[0].querySelector(".wsitem__path")).not.toBeNull();
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
    activeTabIndex.value = 0; // active row: a non-mark click here would toggle the popover
    const props = baseProps();
    mount(props);

    const button = host.querySelector(
      ".wsitem__logo-attn button",
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onFocusAttention).toHaveBeenCalledTimes(1);
    expect(props.onFocusAttention).toHaveBeenCalledWith(0);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("clicking the status mark on an INACTIVE row calls onFocusAttention(index) and does not leak into onSelectTab", () => {
    // Regression guard: on the active row the row's own onClick can never
    // reach onSelectTab, so that case alone can't prove stopPropagation is
    // doing anything. Here the marked tab (index 1) is inactive — without
    // the .wsitem__logo-attn wrapper's stopPropagation, this click would
    // bubble to the row and call onSelectTab(1).
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

    const rows = host.querySelectorAll(".wsitem");
    const button = rows[1].querySelector(
      ".wsitem__logo-attn button",
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

  it("clicking the row (not the mark) calls onSelectTab for an inactive tab", () => {
    tabViews.value = [
      tab({
        key: 1,
        name: "Alpha",
        attention: actionable({ kind: "error", actionableCount: 1 }),
      }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const rows = host.querySelectorAll(".wsitem");
    const label = rows[1].querySelector(".wsitem__label") as HTMLElement;

    act(() => {
      label.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onSelectTab).toHaveBeenCalledTimes(1);
    expect(props.onSelectTab).toHaveBeenCalledWith(1);
    expect(props.onFocusAttention).not.toHaveBeenCalled();
  });

  it("clicking the row (not the mark) on the active tab toggles the popover open, then closed", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    activeTabIndex.value = 0;
    const props = baseProps();
    mount(props);

    const row = host.querySelector(".wsitem") as HTMLElement;
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

  // open-tab-options (⌘⇧R, docs/plans/2026-07-27-keyboard-parity.md Task 2) —
  // same shared-signal mechanism as TabBar (tabs-store.ts's doc comment).
  it("requestTabOptionsKey opens the popover for that row, anchored to its DOM element, then resets to null", () => {
    tabViews.value = [
      tab({ key: 1, name: "Alpha" }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 1; // active row need not be the one requested
    mount(baseProps());

    act(() => {
      requestTabOptionsKey.value = 1; // Alpha, not the active row
    });

    expect(host.querySelector(".tab-popover")).not.toBeNull();
    expect(requestTabOptionsKey.value).toBeNull(); // consumed — won't re-fire
  });

  it("requestTabOptionsKey for a row not in the DOM is a safe no-op — still resets to null, no throw", () => {
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

    const rows = host.querySelectorAll(".wsitem");
    const close = rows[1].querySelector(".wsitem__close") as HTMLButtonElement;

    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(props.onCloseTab).toHaveBeenCalledTimes(1);
    expect(props.onCloseTab).toHaveBeenCalledWith(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
    expect(props.onFocusAttention).not.toHaveBeenCalled();
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("falls back to IDLE_ATTENTION_SUMMARY for a tab with no attention field, rendering no status mark", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha", attention: undefined })];
    activeTabIndex.value = 0;
    mount(baseProps());

    expect(IDLE_ATTENTION_SUMMARY.kind).toBe("idle");
    expect(host.querySelector(".wsitem__logo-attn")).toBeNull();
  });

  describe("reorder by drag", () => {
    const threeTabs = (): void => {
      tabViews.value = [
        tab({ key: 1, name: "Alpha" }),
        tab({ key: 2, name: "Beta" }),
        tab({ key: 3, name: "Gamma" }),
      ];
      activeTabIndex.value = 0;
    };

    it("dragging a row past another row's midpoint moves it there", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      pointer(rows[0], "pointerdown", 20);
      pointer(rows[0], "pointermove", 110); // past Gamma's centre (100)
      pointer(rows[0], "pointerup", 110);

      expect(props.onMoveTab).toHaveBeenCalledTimes(1);
      expect(props.onMoveTab).toHaveBeenCalledWith(0, 2);
    });

    it("marks the carried row and draws the line at the gap it would land in", () => {
      threeTabs();
      mount(baseProps());
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      pointer(rows[0], "pointerdown", 20);
      pointer(rows[0], "pointermove", 110);

      expect(host.querySelectorAll(".wsitem.is-reordering")).toHaveLength(1);
      expect(rows[0].classList.contains("is-reordering")).toBe(true);
      // Gap 3 of 3 rows is below the last one.
      expect(rows[2].classList.contains("is-drop-after")).toBe(true);
      expect(host.querySelectorAll(".wsitem.is-drop-before")).toHaveLength(0);
    });

    it("releasing inside its own slot moves nothing", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      pointer(rows[1], "pointerdown", 60);
      pointer(rows[1], "pointermove", 75); // still between the gaps around Beta
      pointer(rows[1], "pointerup", 75);

      expect(props.onMoveTab).not.toHaveBeenCalled();
    });

    it("a press that never travels stays a click", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      pointer(rows[1], "pointerdown", 60);
      pointer(rows[1], "pointermove", 62); // under the 4px threshold
      pointer(rows[1], "pointerup", 62);
      act(() => {
        rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(props.onMoveTab).not.toHaveBeenCalled();
      expect(props.onSelectTab).toHaveBeenCalledWith(1);
    });

    it("the click that ends a drag does not also select the row", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      pointer(rows[2], "pointerdown", 100);
      pointer(rows[2], "pointermove", 10); // above Alpha's centre
      pointer(rows[2], "pointerup", 10);
      act(() => {
        rows[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(props.onMoveTab).toHaveBeenCalledWith(2, 0);
      expect(props.onSelectTab).not.toHaveBeenCalled();
      expect(host.querySelector(".tab-popover")).toBeNull();
    });

    it("cancels the press so the row's text is not selected while it moves", () => {
      threeTabs();
      mount(baseProps());
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      const down = new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientY: 20,
        button: 0,
      });
      Object.defineProperty(down, "pointerId", { value: 1 });
      act(() => {
        rows[0].dispatchEvent(down);
      });

      expect(down.defaultPrevented).toBe(true);
    });

    it("pressing the close button never starts a drag", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      const close = rows[0].querySelector(
        ".wsitem__close",
      ) as HTMLButtonElement;
      // pointerdown on the button bubbles to the row; without the guard the
      // wiggle below would reorder the list and the release would still close
      // the tab that just moved.
      const down = new MouseEvent("pointerdown", {
        bubbles: true,
        clientY: 20,
        button: 0,
      });
      Object.defineProperty(down, "pointerId", { value: 1 });
      act(() => {
        close.dispatchEvent(down);
      });
      pointer(rows[0], "pointermove", 110);
      pointer(rows[0], "pointerup", 110);

      expect(props.onMoveTab).not.toHaveBeenCalled();
      expect(host.querySelector(".wsitem.is-reordering")).toBeNull();
    });

    it("a right-click never starts a drag", () => {
      threeTabs();
      const props = baseProps();
      mount(props);
      layOutRows();

      const rows = host.querySelectorAll(".wsitem");
      const down = new MouseEvent("pointerdown", {
        bubbles: true,
        clientY: 20,
        button: 2,
      });
      act(() => {
        rows[0].dispatchEvent(down);
      });
      pointer(rows[0], "pointermove", 110);
      pointer(rows[0], "pointerup", 110);

      expect(props.onMoveTab).not.toHaveBeenCalled();
      expect(host.querySelector(".wsitem.is-reordering")).toBeNull();
    });
  });
});
