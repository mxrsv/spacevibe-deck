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
import {
  activeTabIndex,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
import type { TabView } from "../terminal/tabs-store";
import { TabStrip } from "./tab-strip";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
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

  const mount = (): void => {
    act(() => {
      render(
        // The same wrapper `App` puts it in — a plain div, not the frame.
        <div class="stage__strip">
          <TabStrip
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            onNewTab={vi.fn()}
            onRenameTab={vi.fn()}
            onSetTabColor={vi.fn()}
            onFocusAttention={vi.fn()}
            fileController={fileController}
            ownsTabOptionsChord
          />
        </div>,
        host,
      );
    });
  };

  it("renders both segments and the add button with no .tabbar in the tree", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount();

    expect(host.querySelector(".tabbar")).toBeNull();
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
    expect(host.querySelector(".tab--file .tab__label")?.textContent).toBe(
      "a.ts",
    );
    expect(host.querySelector(".tabbar__sep")).not.toBeNull();
    expect(host.querySelector(".tab-add")).not.toBeNull();
  });

  it("open-tab-options still finds its anchor from this mount", () => {
    // The anchor lookup's root moved from the `<header class="tabbar">` to the
    // tablist when the chips were extracted. Sidebar mode has no header at
    // all, so a lookup that still expected one would silently never open.
    tabViews.value = [
      tab({ key: 1, name: "Alpha" }),
      tab({ key: 2, name: "Beta" }),
    ];
    activeTabIndex.value = 1;
    mount();

    act(() => {
      requestTabOptionsKey.value = 1; // Alpha, not the active tab
    });

    expect(host.querySelector(".tab-popover")).not.toBeNull();
    expect(requestTabOptionsKey.value).toBeNull(); // consumed — won't re-fire
  });
});
