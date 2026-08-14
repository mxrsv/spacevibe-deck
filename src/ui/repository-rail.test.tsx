// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stubs the flat sidebar's suite installs: the rail reaches the host for
// logo persistence, favicon scanning and the native dialog through its
// imports, none of which a jsdom tree can provide.
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
vi.mock("../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));

import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import type { TabView } from "../terminal/tabs-store";
import { RepositoryRail } from "./repository-rail";
import {
  collapsedRepositories,
  configureRepositoryClient,
  invalidateRepositoryScans,
} from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { resetFileSurfaces } from "../files/file-surface-store";
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

const SCAN: RepositoryScan = {
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

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/r/main",
    agentBusy: false,
    unread: false,
    ...overrides,
  };
}

let host: HTMLDivElement;
let fileController: FileSurfaceController;

const NOOP = (): void => {};

function mount(
  props: Partial<Parameters<typeof RepositoryRail>[0]> = {},
): void {
  act(() => {
    render(
      <RepositoryRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        fileController={fileController}
        onNewTab={NOOP}
        onRenameTab={NOOP}
        onSetTabColor={NOOP}
        {...props}
      />,
      host,
    );
  });
}

/** Let the scan promise and the signal update it triggers both settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  host = document.createElement("div");
  document.body.appendChild(host);
  invalidateRepositoryScans();
  collapsedRepositories.value = new Set();
  configureRepositoryClient({ scan: async () => SCAN });
  tabViews.value = [tab()];
  activeTabIndex.value = 0;
  resetFileSurfaces();
  fileController = createFileSurfaceController({ client: fileClient });
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  invalidateRepositoryScans();
  resetDesktopEnvironmentForTests();
  fileController.dispose();
  resetFileSurfaces();
  vi.restoreAllMocks();
});

describe("RepositoryRail", () => {
  it("groups the open tab under its repository and lists the sibling worktree", async () => {
    mount();
    await settle();
    expect(host.querySelector(".repogroup__name")?.textContent).toBe("main");
    // One interactive row for the open tab, one readout for the worktree
    // nobody has opened.
    expect(host.querySelectorAll(".wsitem").length).toBe(2);
    expect(host.querySelectorAll(".wsitem--readout").length).toBe(1);
  });

  it("selects a tab through the same callback the flat sidebar used", async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/r/side" })];
    activeTabIndex.value = 0;
    mount({ onSelectTab });
    await settle();
    const rows = host.querySelectorAll<HTMLElement>(
      ".wsitem:not(.wsitem--readout)",
    );
    expect(rows.length).toBe(2);
    act(() => {
      rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it("closes a tab by index, not by row position", async () => {
    const onCloseTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/r/side" })];
    mount({ onCloseTab });
    await settle();
    const closers = host.querySelectorAll<HTMLElement>(".wsitem__close");
    act(() => {
      closers[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCloseTab).toHaveBeenCalledWith(1);
  });

  it("does not make the not-open worktree a button (DL-17.3 readout)", async () => {
    mount();
    await settle();
    const readout = host.querySelector(".wsitem--readout");
    expect(readout?.tagName).toBe("DIV");
    expect(readout?.querySelector("button")).toBeNull();
    expect(readout?.getAttribute("aria-label")).toContain("not open");
  });

  it("names every state in the accessible label, not only in colour", async () => {
    configureRepositoryClient({
      scan: async () => ({
        ...SCAN,
        worktrees: [
          SCAN.worktrees[0],
          { ...SCAN.worktrees[1], prunable: "gitdir file points to nowhere" },
        ],
      }),
    });
    invalidateRepositoryScans();
    mount();
    await settle();
    expect(
      host.querySelector(".wsitem--readout")?.getAttribute("aria-label"),
    ).toContain("missing from disk");
  });

  it("collapses a repository and hides its worktrees", async () => {
    mount();
    await settle();
    const toggle = host.querySelector<HTMLElement>(".repogroup__toggle");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      host.querySelector(".repogroup__toggle")?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(host.querySelectorAll(".wsitem").length).toBe(0);
  });

  it("still renders every tab when the scan refuses", async () => {
    // Navigation must not be able to fail: a machine without git, or a folder
    // that is not a repository, gets the flat list Deck has always shown.
    configureRepositoryClient({
      scan: async () => ({ kind: "plain", reason: "not a git repository" }),
    });
    invalidateRepositoryScans();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: "/elsewhere" })];
    mount();
    await settle();
    expect(host.querySelectorAll(".repogroup--plain").length).toBe(2);
    expect(host.querySelectorAll(".wsitem").length).toBe(2);
    expect(host.querySelectorAll(".wsitem--readout").length).toBe(0);
    // No repository header and no `primary` badge: the rail adds a tier where
    // git says there is one, and claims nothing where git said nothing.
    expect(host.querySelector(".repogroup__head")).toBeNull();
    expect(host.querySelector(".wsitem__badge")).toBeNull();
  });

  it("still renders when the scan rejects outright", async () => {
    configureRepositoryClient({
      scan: async () => {
        throw new Error("bridge is gone");
      },
    });
    invalidateRepositoryScans();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    await settle();
    expect(host.querySelectorAll(".wsitem").length).toBe(1);
  });
});

/**
 * File tabs join the sidebar after the active workspace's row (spec §4.2's
 * ordering, stated spatially for the nested variant), driven by the same
 * controller wired as `TabManager`'s `SurfaceStrip` (Task 5).
 */
describe("RepositoryRail file tabs (spec §4.2)", () => {
  it("renders no file rows when nothing is open", async () => {
    mount();
    await settle();

    expect(host.querySelector(".wsitem--file")).toBeNull();
  });

  it("nests file tabs right after the open tab's row, preview italic on the unedited slot only", async () => {
    tabViews.value = [tab()]; // /r/main, the open tab
    activeTabIndex.value = 0;
    await fileController.openFile("/r/main", "/r/main/a.ts", true); // kept
    await fileController.openFile("/r/main", "/r/main/b.ts", false); // preview
    mount();
    await settle();

    const rows = host.querySelectorAll(".wsitem:not(.wsitem--readout)");
    // The open tab's row, then its two file rows, in order.
    expect(rows).toHaveLength(3);
    expect(rows[1].classList.contains("wsitem--file")).toBe(true);
    expect(rows[1].querySelector(".wsitem__label")?.textContent).toBe("a.ts");
    expect(rows[2].querySelector(".wsitem__label")?.textContent).toBe("b.ts");
    expect(rows[1].querySelector(".wsitem__label--preview")).toBeNull(); // kept
    expect(rows[2].querySelector(".wsitem__label--preview")).not.toBeNull(); // preview
  });

  it("clicking a file row activates it through the controller, not onSelectTab", async () => {
    tabViews.value = [tab()];
    await fileController.openFile("/r/main", "/r/main/a.ts", true);
    const onSelectTab = vi.fn();
    mount({ onSelectTab });
    await settle();

    const fileRow = host.querySelector(".wsitem--file") as HTMLElement;
    act(() => {
      fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it("closing a file row calls closePath, not onCloseTab", async () => {
    tabViews.value = [tab()];
    await fileController.openFile("/r/main", "/r/main/a.ts", true);
    const onCloseTab = vi.fn();
    const closePath = vi.spyOn(fileController, "closePath");
    mount({ onCloseTab });
    await settle();

    const close = host.querySelector(
      ".wsitem--file .wsitem__close",
    ) as HTMLButtonElement;
    act(() => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(closePath).toHaveBeenCalledWith("/r/main", "/r/main/a.ts");
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it("clicking the terminal row that's still 'active' takes the stage back while a file surface is on top", async () => {
    // Regression guard for the popover-vs-reselect fork: `tab.active` alone
    // used to open the rename popover, which would leave the file surface on
    // the stage forever with no way back via that row.
    tabViews.value = [tab()];
    activeTabIndex.value = 0;
    await fileController.openFile("/r/main", "/r/main/a.ts", true); // activates the file surface
    const onSelectTab = vi.fn();
    mount({ onSelectTab });
    await settle();

    const terminalRow = host.querySelector(
      ".wsitem:not(.wsitem--readout):not(.wsitem--file)",
    ) as HTMLElement;
    expect(terminalRow.classList.contains("is-active")).toBe(false);

    act(() => {
      terminalRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectTab).toHaveBeenCalledWith(0);
    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it('"last surface, not last tab": file rows survive as their own group once the window has no open terminal tab at all', async () => {
    tabViews.value = [tab()];
    activeTabIndex.value = 0;
    await fileController.openFile("/r/main", "/r/main/a.ts", true);
    // The window's only terminal tab closed — `activeWorkspace` survives
    // that (file-surface-store.ts's own doc comment), which is the whole
    // point of spec §7's rule. `buildRail` derives every row from open tabs,
    // so with zero tabs anywhere it returns no groups at all — the fallback
    // section (`activeWorkspaceHasRow`) is what keeps the file tabs visible.
    // Simulated directly here since driving it through a real `TabManager`
    // close is Task 5's integration test's job, not this presentational
    // component's.
    tabViews.value = [];
    activeTabIndex.value = -1;
    mount();
    await settle();

    expect(host.querySelector(".repogroup__name")).toBeNull(); // no scanned group left to name
    const fileRow = host.querySelector(".wsitem--file");
    expect(fileRow).not.toBeNull();
    expect(fileRow?.querySelector(".wsitem__label")?.textContent).toBe("a.ts");
  });
});
