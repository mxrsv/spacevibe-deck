// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The same stubs `repository-rail.test.tsx` installs: the rail reaches the host
// for logo persistence, favicon scanning, the native dialog and the file drop
// through its imports, none of which a jsdom tree can provide.
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

import {
  activeTabIndex,
  requestTabOptionsKey,
  tabViews,
} from "../terminal/tabs-store";
import type { PaneView, TabView } from "../terminal/tabs-store";
import { AgentRail } from "./agent-rail";
import { TabStrip } from "./tab-strip";
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
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import { sessionArchive } from "../terminal/session-journal";
import { browserSurfaceActive } from "../browser/browser-store";

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

/** A quiet agent pane; every test names only the fields it cares about. */
function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: "claude",
    attention: "none",
    phase: "idle",
    changedAt: 1_000,
    ...overrides,
  };
}

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: "node",
    name: null,
    dotColor: null,
    workspacePath: "/r/main",
    agents: [],
    agentBusy: false,
    unread: false,
    panes: [pane()],
    ...overrides,
  };
}

let host: HTMLDivElement;
let fileController: FileSurfaceController;

const NOOP = (): void => {};

function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onOpenWorkspace={NOOP}
        onRenameTab={NOOP}
        onSetTabColor={NOOP}
        onFocusPane={NOOP}
        onResumeWorktree={NOOP}
        fileController={fileController}
        showAgentPresence
        {...props}
      />,
      host,
    );
  });
}

/**
 * Sidebar layout as `App` assembles it: the rail in the navigation column AND
 * the stage's tab strip, alive at the same time. Only that shape can show
 * whether the ⌘⇧R chord still reaches exactly one surface.
 */
function mountSidebarLayout(): void {
  act(() => {
    render(
      <>
        <AgentRail
          onSelectTab={NOOP}
          onCloseTab={NOOP}
          onOpenWorkspace={NOOP}
          onRenameTab={NOOP}
          onSetTabColor={NOOP}
          onFocusPane={NOOP}
          onResumeWorktree={NOOP}
          fileController={fileController}
          showAgentPresence
        />
        <div class="stage__strip">
          <TabStrip
            onSelectTab={NOOP}
            onCloseTab={NOOP}
            fileController={fileController}
            onNewTab={NOOP}
            onSelectBrowser={NOOP}
            onCloseBrowser={NOOP}
            scopeToActiveRepository
          />
        </div>
      </>,
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

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function rows(): NodeListOf<HTMLElement> {
  return host.querySelectorAll<HTMLElement>(".asr-row--tab");
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  host = document.createElement("div");
  document.body.appendChild(host);
  invalidateRepositoryScans();
  collapsedRepositories.value = new Set();
  configureRepositoryClient({ scan: async () => SCAN });
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: [
      { path: "/r/main", lastOpenedAt: 2 },
      { path: "/r/side", lastOpenedAt: 1 },
    ],
  };
  tabViews.value = [tab()];
  activeTabIndex.value = 0;
  resetFileSurfaces();
  fileController = createFileSurfaceController({ client: fileClient });
  sessionArchive.value = {};
  browserSurfaceActive.value = false;
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  invalidateRepositoryScans();
  resetDesktopEnvironmentForTests();
  workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  fileController.dispose();
  resetFileSurfaces();
  sessionArchive.value = {};
  browserSurfaceActive.value = false;
  vi.restoreAllMocks();
});

describe("AgentRail attention rows", () => {
  it("keeps every tab in the one stream, whatever its state", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, attention: "requested" }),
          pane({ paneId: 12, agent: "codex", attention: "completed" }),
          pane({ paneId: 13, agent: "gemini", phase: "working" }),
        ],
      }),
    ];
    mount();
    await settle();

    // The pinned `Needs you` block was removed on 2026-08-16: nothing lifts a
    // row out of its project, so the project is printed exactly once.
    expect(host.querySelector(".asr-block")).toBeNull();
    expect(host.querySelectorAll(".asr-stream .asr-row--tab")).toHaveLength(1);
  });

  it("never reorders a row by its state", async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [pane({ paneId: 11, attention: "requested", changedAt: 9_000 })],
      }),
      tab({
        key: 2,
        panes: [pane({ paneId: 21, attention: "error", changedAt: 1_000 })],
      }),
    ];
    mount();
    await settle();

    const listed = host.querySelectorAll<HTMLElement>(
      ".asr-stream .asr-row--tab",
    );
    expect(listed).toHaveLength(2);
    // Open order, not severity: the marks differ, the positions do not move.
    expect(listed[0].dataset.state).toBe("asked");
    expect(listed[1].dataset.state).toBe("failed");
  });
});

describe("AgentRail click contract", () => {
  it("selects the tab by its GLOBAL index when the row body is pressed", async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onSelectTab });
    await settle();

    // Keyed lookup, not positional: the stream is ordered by recency, so the
    // second tab is not the second row.
    click(host.querySelector('[data-key="2"] .asr-row__hit'));
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it("focuses the exact pane behind an agent chip", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, agent: "claude" }),
          pane({ paneId: 12, agent: "codex" }),
        ],
      }),
    ];
    mount({ onFocusPane });
    await settle();

    const chips = host.querySelectorAll<HTMLElement>(
      ".asr-chip:not(.asr-chip--more)",
    );
    expect(chips).toHaveLength(2);
    click(chips[1]);
    expect(onFocusPane).toHaveBeenCalledWith(0, 12);
  });

  it("opens the row from `+N` and focuses a pane from the list it reveals", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, agent: "claude" }),
          pane({ paneId: 12, agent: "codex" }),
          pane({ paneId: 13, agent: "gemini" }),
          pane({ paneId: 14, agent: "opencode" }),
        ],
      }),
    ];
    mount({ onFocusPane });
    await settle();

    expect(host.querySelector(".asr-panes")).toBeNull();
    const more = host.querySelector<HTMLElement>(".asr-chip--more");
    expect(more?.textContent).toBe("+1");

    click(more);
    const paneRows = host.querySelectorAll<HTMLElement>(".asr-panes .asr-pane");
    expect(paneRows).toHaveLength(4);

    click(paneRows[3]);
    expect(onFocusPane).toHaveBeenCalledWith(0, 14);
  });

  it("closes only the row's own tab from the hover action", async () => {
    const onCloseTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onCloseTab });
    await settle();

    click(host.querySelector('[data-key="2"] .asr-row__action--close'));
    expect(onCloseTab).toHaveBeenCalledWith(1);
    expect(onCloseTab).toHaveBeenCalledTimes(1);
  });

  it("opens the rename/colour/logo popover from the hover action", async () => {
    mount();
    await settle();

    expect(host.querySelector(".tab-popover")).toBeNull();
    click(host.querySelector(".asr-row__action--options"));
    // The rail's popover, not the strip's: only the rail wires `onSetLogo`.
    expect(host.querySelector(".tab-popover__logo")).not.toBeNull();
  });
});

describe("AgentRail disclosure", () => {
  it("reserves the gutter but shows no control for a single-agent tab", async () => {
    mount();
    await settle();

    expect(host.querySelector("button.asr-disclose")).toBeNull();
    expect(host.querySelector(".asr-disclose--empty")).not.toBeNull();
  });

  it("hides the folded message line while the row is open", async () => {
    tabViews.value = [
      tab({
        // Named, because an unnamed tab has no message line to hide: its title
        // would only repeat the project name above it (DL-27.9).
        name: "api handoff",
        panes: [
          pane({ paneId: 11, agent: "claude" }),
          pane({ paneId: 12, agent: "codex" }),
        ],
      }),
    ];
    mount();
    await settle();

    const disclose = host.querySelector<HTMLElement>("button.asr-disclose");
    expect(disclose?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".asr-row__msg")).not.toBeNull();

    click(disclose);
    expect(
      host.querySelector(".asr-disclose")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(host.querySelector(".asr-row__msg")).toBeNull();
    expect(host.querySelectorAll(".asr-pane")).toHaveLength(2);
  });
});

describe("AgentRail clusters (DL-27.9)", () => {
  it("prints the project once and names each row by its tab", async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, agent: "claude" })] }),
      tab({
        key: 2,
        workspacePath: "/r/side",
        panes: [pane({ paneId: 21, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    expect(heads).toHaveLength(1);
    expect(heads[0].textContent).toBe("main");
    // Both tabs belong to one repository, so neither row repeats its name.
    expect(
      [...rows()].map((row) => row.querySelector("strong")?.textContent),
    ).toEqual(["claude", "codex"]);
    // The worktree suffix survives the change — it is the only thing telling
    // two tabs of one project apart.
    expect(rows()[1].querySelector(".asr-row__worktree")?.textContent).toBe(
      "side",
    );
  });

  it("prints no header for a project with one tab, and names it in the row", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__head")).toBeNull();
    expect(rows()[0].querySelector("strong")?.textContent).toBe("main");
  });

  it("keeps a tab that wants the user under its own project header", async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [pane({ paneId: 11, attention: "requested" })],
      }),
      tab({ key: 2, panes: [pane({ paneId: 21 })] }),
      tab({
        key: 3,
        workspacePath: "/r/side",
        panes: [pane({ paneId: 31 })],
      }),
    ];
    mount();
    await settle();

    // Two tabs of one project, one of them asking: one header, both rows under
    // it, and the asking row names the TAB like every other row in a cluster.
    const heads = host.querySelectorAll(".asr-stream .asr-cluster__head");
    expect(heads).toHaveLength(1);
    expect(host.querySelectorAll(".asr-stream .asr-row--tab")).toHaveLength(3);
    const asking = host.querySelector<HTMLElement>(
      '.asr-stream .asr-row--tab[data-state="asked"]',
    );
    expect(asking?.querySelector("strong")?.textContent).toBe("claude");
  });
});

describe("AgentRail state wording (DL-27.2)", () => {
  it("keeps the status word out of the row while title and aria still say it", async () => {
    tabViews.value = [tab({ panes: [pane({ attention: "error" })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("failed");
    // The mark is the fast read; the word is never painted in the row.
    expect(row.textContent).not.toContain("failed");
    expect(
      row.querySelector(".asr-row__mark")?.getAttribute("data-state"),
    ).toBe("failed");

    const hit = row.querySelector<HTMLElement>(".asr-row__hit");
    expect(hit?.getAttribute("aria-label")).toContain("failed");
    expect(hit?.getAttribute("title")).toContain("failed");
  });
});

describe("AgentRail archived rows", () => {
  it("resumes a workspace with an archived session and no live tab", async () => {
    sessionArchive.value = { "/r/side": { savedAt: 1, tabs: [] } };
    const onResumeWorktree = vi.fn();
    mount({ onResumeWorktree });
    await settle();

    const archived = host.querySelector<HTMLElement>(".asr-row--archived");
    expect(archived).not.toBeNull();
    expect(archived?.getAttribute("role")).toBe("button");
    expect(archived?.getAttribute("tabindex")).toBe("0");
    expect(archived?.getAttribute("aria-label")).toBe(
      "Resume last session in main · side",
    );
    // No live pane has said anything, so the row carries no message line.
    expect(archived?.querySelector(".asr-row__msg")).toBeNull();

    click(archived);
    expect(onResumeWorktree).toHaveBeenCalledWith("/r/side");

    onResumeWorktree.mockClear();
    act(() => {
      archived?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onResumeWorktree).toHaveBeenCalledWith("/r/side");
  });

  it("still draws a tab that runs no agent, without a message line or chips", async () => {
    // The rail is the sidebar's only list, so a shell-only tab it declines to
    // draw is a tab the user cannot reach from there. `voice` is null here and
    // every agent-shaped part of the row has to stand down on its own.
    tabViews.value = [tab({ panes: [pane({ agent: null })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("resting");
    expect(row.querySelector(".asr-row__msg")).toBeNull();
    expect(row.querySelector(".asr-chips")).toBeNull();
    expect(host.querySelector("button.asr-disclose")).toBeNull();
  });

  it("lists no archived row for a worktree with no recorded session", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-row--archived")).toBeNull();
  });
});

describe("AgentRail carried-over jobs", () => {
  it("answers the open-tab-options chord ONCE with the stage strip mounted beside it", async () => {
    // `TabStrip` is mounted with `ownsTabOptionsChord={false}` in sidebar
    // layout, so the rail is the only consumer left — dropping this effect
    // makes ⌘⇧R dead there rather than merely quieter.
    mountSidebarLayout();
    await settle();

    act(() => {
      requestTabOptionsKey.value = 1;
    });

    expect(host.querySelectorAll(".tab-popover")).toHaveLength(1);
    expect(host.querySelector(".tab-popover__logo")).not.toBeNull();
    expect(requestTabOptionsKey.value).toBeNull(); // consumed exactly once
  });

  it("keeps the drop target's datasets on the row element", async () => {
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.key).toBe("1");
    expect(row.dataset.workspace).toBe("/r/main");
  });

  it("drops the active wash while a browser surface holds the stage", async () => {
    // DL-27.8: the wash is carried by the ITEM, not by the row inside it, so
    // an unfolded tab paints as one block rather than a lit line above dim
    // agents. Asserted on the wrapper for that reason.
    mount();
    await settle();
    const items = () => host.querySelectorAll<HTMLElement>(".asr-item");
    expect(items()[0].dataset.active).toBe("true");
    expect(rows()[0].classList.contains("is-active")).toBe(false);

    act(() => {
      browserSurfaceActive.value = true;
    });
    expect(items()[0].dataset.active).toBe("false");
  });

  it("opens the Open board from the footer row", async () => {
    const onOpenWorkspace = vi.fn();
    mount({ onOpenWorkspace });
    await settle();

    click(host.querySelector(".asr-open"));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });
});

/**
 * The rail's shell contract, read off the stylesheet rather than off a render.
 *
 * `DesktopChrome` puts `sidebarNavigation` straight into `.window`'s grid, so
 * the rail has to place ITSELF; a rail with no placement auto-flows into the
 * next free cell, lands under the stage on top of the status row, and leaves
 * the navigation column empty. That shipped once, on 2026-08-16, and no test
 * saw it: jsdom loads no stylesheet, so every render assertion above passed
 * against a rail nobody could see. These read the declarations directly, which
 * is the only layer where this class of defect is visible to a suite at all.
 */
describe("AgentRail shell contract", () => {
  // Repo-root relative, the way `scripts/electron-ipc-contract.test.ts` reads
  // its own source of truth: `import.meta.url` is not a file URL under the
  // jsdom environment this file runs in.
  const stylesheet = readFileSync("src/styles.css", "utf8");

  /**
   * The declarations of the rule whose selector is exactly `selector`.
   *
   * Matched on the literal `\n<selector> {` rather than by regex: the
   * stylesheet is Prettier-formatted, so a selector always owns its own line,
   * and an exact string keeps `.asr-rail` from answering for
   * `.asr-rail--mounted`.
   */
  function ruleBody(selector: string): string {
    const start = stylesheet.indexOf(`\n${selector} {`);
    expect(start, `no \`${selector} {\` rule in styles.css`).toBeGreaterThan(
      -1,
    );
    const open = stylesheet.indexOf("{", start);
    return stylesheet.slice(open + 1, stylesheet.indexOf("}", open));
  }

  it("places itself in the window grid's navigation cell", () => {
    const body = ruleBody(".asr-rail");
    expect(body).toContain("grid-column: 1");
    expect(body).toContain("grid-row: 2");
  });

  it("paints the recessed side surface rather than letting the stage through", () => {
    // DL-18.7: the frame and the rail are one continuous recessed surface.
    expect(ruleBody(".asr-rail")).toContain("background: var(--sidebar-bg)");
  });

  it("scrolls its rows inside a box that can shrink", () => {
    // `min-height: 0` is what lets a flex child shrink to its scrollport
    // instead of stretching to its content and pushing the footer out.
    const body = ruleBody(".asr-rail__list");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("min-height: 0");
  });

  it("answers the collapsed column instead of inheriting the old rail's rules", () => {
    // Every DL-18.9 collapse rule is `.wsbar`/`.wsitem`-scoped, so replacing
    // the rail silently dropped them all. These are the rail's own.
    expect(stylesheet).toContain('[data-sidebar-collapsed="true"] .asr-rail');
    expect(stylesheet).toContain(
      '[data-sidebar-collapsed="true"] .asr-open__label',
    );
  });
});
