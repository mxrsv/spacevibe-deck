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
import { activeTabIndex, tabViews, type TabView, type PaneView } from "../terminal/tabs-store";
import { TabStrip } from "./tab-strip";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { openFileTab, resetFileSurfaces } from "../files/file-surface-store";
import { nextOpenSequence, resetOpenSequence } from "../lib/open-sequence";
import type { FileClient } from "../files/file-client";
import { repositoryScans } from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import {
  browserOpen,
  browserState,
  browserSurfaceActive,
  EMPTY_STATE,
  resetBrowserStore,
} from "../browser/browser-store";
import { paneTails } from "../terminal/session-tail-store";

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
    resetOpenSequence();
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
            onNewTab={vi.fn()}
            onSelectBrowser={vi.fn()}
            onCloseBrowser={vi.fn()}
            fileController={fileController}
            scopeToActiveRepository
            {...props}
          />
        </div>,
        host,
      );
    });
  };

  it("renders every chip and the add button with no .tabbar in the tree", () => {
    tabViews.value = [tab({ key: 1, name: "Alpha" })];
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    mount();

    expect(host.querySelector(".tabbar")).toBeNull();
    expect(host.querySelectorAll(".tab")).toHaveLength(2);
    expect(host.querySelector(".tab--file .tab__label")?.textContent).toBe("a.ts");
    // One row since 2026-08-16 (DL-18.6): no segment hairline anywhere in it.
    expect(host.querySelector(".tabbar__sep")).toBeNull();
    expect(host.querySelector(".tab-add")).not.toBeNull();
  });

  it("puts the tab's newest turn on its chip, and keeps a typed name over it", () => {
    // DL-18.10 amended (2026-08-17, owner): a chip carries the same sentence
    // the rail row shows, through the same precedence — so the two surfaces
    // cannot quote different agents for one tab. A name the user typed still
    // wins, exactly as it does in the rail (DL-27.15).
    tabViews.value = [
      tab({ key: 1, name: null, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, name: "release cut", panes: [pane({ paneId: 21 })] }),
    ];
    paneTails.value = new Map([
      [11, "Reading the rail model"],
      [21, "Wrote the migration"],
    ]);
    mount({ scopeToActiveRepository: false });

    const labels = [...host.querySelectorAll(".tab .tab__label")].map((node) => node.textContent);
    expect(labels).toEqual(["Reading the rail model", "release cut"]);
    // The whole sentence stays reachable even though the chip trims it
    // (DL-27.4's contract, inherited with the sentence).
    expect(host.querySelector(".tab")?.getAttribute("title")).toBe("Reading the rail model");
  });

  it("keeps the process name on a chip whose agent has said nothing", () => {
    tabViews.value = [tab({ key: 1, name: null, process: "codex", panes: [pane()] })];
    mount({ scopeToActiveRepository: false });

    expect(host.querySelector(".tab .tab__label")?.textContent).toBe("codex");
  });

  it("places a chip by when it was opened, not by what kind it is", () => {
    // The file opens FIRST, so its chip leads a terminal tab opened after it.
    // Under the old two-segment strip every file chip followed every terminal
    // chip, whatever the clock said.
    openFileTab("/repo", "/repo/a.ts", { keep: true });
    tabViews.value = [tab({ key: 1, name: "Alpha", openedAt: nextOpenSequence() })];
    mount();

    const labels = [...host.querySelectorAll(".tab .tab__label")].map((node) => node.textContent);
    expect(labels).toEqual(["a.ts", "Alpha"]);
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

    const labels = () =>
      [...host.querySelectorAll(".tab:not(.tab--file) .tab__label")].map(
        (label) => label.textContent,
      );
    // Every tab of the repository, in TAB order — a sub-package tab resolves
    // through the same longest-prefix match, and the other repository's tab
    // stays out.
    expect(labels()).toEqual(["main · claude", "side · codex", "main · opencode"]);

    act(() => {
      const visibleTabs = host.querySelectorAll<HTMLElement>(".tab:not(.tab--file)");
      visibleTabs[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(2);

    act(() => {
      activeTabIndex.value = 3; // the other repository
    });
    expect(labels()).toEqual(["other · gemini"]);
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
    // The terminal chip stands down while the browser holds the stage.
    expect(
      host.querySelector(".tab:not(.tab--file):not(.tab--browser)")?.getAttribute("aria-selected"),
    ).toBe("false");
    // A click on the ALREADY-active chip must not re-fire selection.
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectBrowser).toHaveBeenCalledTimes(1);

    chip
      .querySelector<HTMLButtonElement>(".tab__close")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCloseBrowser).toHaveBeenCalledTimes(1);
    expect(onSelectBrowser).toHaveBeenCalledTimes(1); // ✕ never selects
  });
});
