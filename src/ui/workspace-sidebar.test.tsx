// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WorkspaceSidebar pulls in Tauri-backed stores (workspace logo persistence,
// favicon scanning, the native file dialog) through its imports; stub them so
// the tree mounts under jsdom, mirroring the settings section tests.
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
  activateTerminalSurface,
  openFileTab,
  resetFileSurfaces,
  setActiveWorkspace,
  updateDocument,
} from "../files/file-surface-store";
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
    onNewTab: vi.fn(),
    onRenameTab: vi.fn(),
    onSetTabColor: vi.fn(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onFocusAttention: vi.fn(),
  });

  const mount = (props: ReturnType<typeof baseProps>): void => {
    act(() => {
      render(<WorkspaceSidebar {...props} />, host);
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
});

const TAB_SELECTOR = ".wsitem";
const LABEL_SELECTOR = ".wsitem__label";
const DIRTY_SELECTOR = ".wsitem__dirty";
const CLOSE_SELECTOR = ".wsitem__close";
const stripProps = {
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onNewTab: vi.fn(),
  onRenameTab: vi.fn(),
  onSetTabColor: vi.fn(),
  onSelectFile: vi.fn(),
  onCloseFile: vi.fn(),
};

function renderStrip(): HTMLDivElement {
  stripProps.onSelectTab.mockClear();
  stripProps.onSelectFile.mockClear();
  stripProps.onCloseFile.mockClear();
  tabViews.value = [
    {
      key: 1,
      process: "zsh",
      name: null,
      dotColor: null,
      workspacePath: "/repo",
      agentBusy: false,
      unread: false,
    },
  ];
  activeTabIndex.value = 0;
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(<WorkspaceSidebar {...stripProps} />, host);
  });
  return host;
}


/**
 * File tabs in the strip (plan T27, T32).
 *
 * Run in BOTH chrome layouts, in each layout's own test file: only one mounts
 * at a time, driven by `tabBarPosition`, so a single-layout check proves half
 * the app — spec §7's last row.
 */
describe("file tabs in the strip", () => {
  afterEach(() => {
    resetFileSurfaces();
  });

  it("renders the file tabs of the active surface's workspace after the terminal tabs", () => {
    openFileTab("/repo", "/repo/src/index.ts", { keep: true });
    const host = renderStrip();
    const labels = [...host.querySelectorAll(LABEL_SELECTOR)].map(
      (node) => node.textContent,
    );
    expect(labels[labels.length - 1]).toBe("index.ts");
  });

  it("marks a preview tab italic and a kept tab not", () => {
    openFileTab("/repo", "/repo/preview.ts", { keep: false });
    const host = renderStrip();
    expect(host.querySelector(`${TAB_SELECTOR}.is-preview`)).not.toBeNull();

    resetFileSurfaces();
    openFileTab("/repo", "/repo/kept.ts", { keep: true });
    const kept = renderStrip();
    expect(kept.querySelector(`${TAB_SELECTOR}.is-preview`)).toBeNull();
  });

  it("shows a dot for unsaved changes", () => {
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    expect(renderStrip().querySelector(DIRTY_SELECTOR)).toBeNull();

    updateDocument("/repo/a.ts", { dirty: true });
    expect(renderStrip().querySelector(DIRTY_SELECTOR)).not.toBeNull();
  });

  it("takes the active mark off the terminal tab while a file tab holds the stage", () => {
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    const host = renderStrip();
    const active = [...host.querySelectorAll(`${TAB_SELECTOR}.is-active`)];
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-file")).toBe("/repo/a.ts");
  });

  it("swaps which file tabs are visible when the active workspace changes", () => {
    // The named cost of spec §2.1.
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    openFileTab("/other", "/other/b.ts", { keep: true });
    expect(renderStrip().querySelectorAll(`${TAB_SELECTOR}[data-file]`)).toHaveLength(1);
    expect(
      renderStrip().querySelector(`${TAB_SELECTOR}[data-file]`)?.getAttribute("data-file"),
    ).toBe("/other/b.ts");

    activateTerminalSurface();
    setActiveWorkspace("/repo");
    expect(
      renderStrip().querySelector(`${TAB_SELECTOR}[data-file]`)?.getAttribute("data-file"),
    ).toBe("/repo/a.ts");
  });


  it("clicking the ACTIVE terminal tab takes the stage back from a file tab", () => {
    // The class was made conditional on `terminalActive` but the click handler
    // still branched on the bare `index !== active`, so this click opened the
    // Tab Options popover instead of returning to the terminal.
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    const host = renderStrip();
    const terminal = host.querySelector<HTMLElement>(`${TAB_SELECTOR}[data-key]`)!;

    terminal.click();

    expect(stripProps.onSelectTab).toHaveBeenCalledWith(0);
  });

  it("reports exactly one selected tab to assistive tech", () => {
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    const host = renderStrip();
    const selected = [...host.querySelectorAll('[role="tab"][aria-selected="true"]')];
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-file")).toBe("/repo/a.ts");
  });

  it("routes a click to onSelectFile and the × to onCloseFile", () => {
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    const host = renderStrip();
    const tab = host.querySelector<HTMLElement>(`${TAB_SELECTOR}[data-file]`)!;

    tab.click();
    expect(stripProps.onSelectFile).toHaveBeenCalledWith("/repo/a.ts");

    tab.querySelector<HTMLButtonElement>(CLOSE_SELECTOR)!.click();
    expect(stripProps.onCloseFile).toHaveBeenCalledWith("/repo/a.ts");
    // The × must not also select the tab it is closing.
    expect(stripProps.onSelectFile).toHaveBeenCalledTimes(1);
  });
});
