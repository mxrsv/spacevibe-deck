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
    settingsOpen: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onClosePane: vi.fn(),
    onRenameTab: vi.fn(),
    onSetTabColor: vi.fn(),
    onToggleSettings: vi.fn(),
    expandActive: false,
    onToggleExpand: vi.fn(),
    promptsOpen: false,
    promptsDisabled: false,
    onTogglePrompts: vi.fn(),
    onFocusAttention: vi.fn(),
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
});
