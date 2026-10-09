// @vitest-environment jsdom
/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Host stubs the rail's import graph still reaches under jsdom. The logo,
// favicon-scan, native-dialog and file-drop paths left the rail on 2026-08-16
// with `TabPopover`; these stay because the repositories store and the session
// journal below it still talk to the host.
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
// Phosphor components are React `forwardRef` objects. The production Vite
// pipeline aliases them through `preact/compat`, but Vitest externalises the
// package before that alias and jsdom tries to use the object as a tag name.
// The rail tests exercise the controls around the icon, not Phosphor itself.
vi.mock("./controls/deck-icon", () => ({
  CHROME_ICON: 13,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { activeTabIndex, tabViews, type PaneView, type TabView } from "../terminal/tabs-store";
import { AgentRail } from "./agent-rail";
import { TabStrip } from "./tab-strip";
import type { CardActions } from "./worktree-card-menus";
import {
  collapsedRepositories,
  configureRepositoryClient,
  invalidateRepositoryScans,
} from "../repositories/repositories-store";
import type { RepositoryScan } from "../repositories/repository-client";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../files/file-surface-controller";
import { resetFileSurfaces } from "../files/file-surface-store";
import type { FileClient } from "../files/file-client";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import { sessionArchive } from "../terminal/session-journal";
import { paneModels, paneTails } from "../terminal/session-tail-store";
import { browserSurfaceActive } from "../browser/browser-store";
import { settings, updateSettings } from "../settings/settings-store";

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
    // Never ran: the default quiet pane reads `idle`; a test wanting the
    // checked-run `done` says `hasRun: true` itself.
    hasRun: false,
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

/**
 * What every checkout's create control raises (`rail-create-consolidation`):
 * the card's actions menu, wired the way `App` wires it. One agent, so the
 * first `menuitem` is `Claude` and a press on it is what starts a process.
 */
const ACTIONS: CardActions = {
  agents: [{ id: "claude", label: "Claude", detail: "claude" }],
  agentsResolved: true,
  onRunAgent: vi.fn(),
  onSplitHere: vi.fn(),
};

function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onClosePane={NOOP}
        onFocusPane={NOOP}
        legacy={{ onOpenWorkspace: NOOP, onResumeWorktree: NOOP }}
        fileController={fileController}
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
          onClosePane={NOOP}
          onFocusPane={NOOP}
          legacy={{ onOpenWorkspace: NOOP, onResumeWorktree: NOOP }}
          fileController={fileController}
        />
        <div class="stage__strip">
          <TabStrip
            onSelectTab={NOOP}
            onCloseTab={NOOP}
            fileController={fileController}
            onSelectBrowser={NOOP}
            onCloseBrowser={NOOP}
            onSelectAgentBoard={NOOP}
            onCloseAgentBoard={NOOP}
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

/**
 * Every session row in the tree (DL-27.28): a pure "how many rows are drawn" count.
 */
function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".asr-card__row")];
}

/** Every checkout's label-line name, whether or not it has rows. */
function branches(): string[] {
  return [...host.querySelectorAll(".asr-checkout__name")].map((name) => name.textContent ?? "");
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  vi.mocked(ACTIONS.onRunAgent).mockClear();
  vi.mocked(ACTIONS.onSplitHere).mockClear();
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
  paneTails.value = new Map();
  paneModels.value = new Map();
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
  paneTails.value = new Map();
  paneModels.value = new Map();
  browserSurfaceActive.value = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentRail attention rows", () => {
  it("keeps every agent pane of a checkout under its one card, whatever its state", async () => {
    // The pinned `Needs you` block was removed on 2026-08-16: nothing lifts a
    // row out of its project. The pane TREE / leaf vocabulary is gone with
    // the tab tier (design 2026-08-25): every agent pane is a peer row inside
    // the ONE worktree card, not a leaf under a headless tab item.
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

    expect(host.querySelector(".asr-block")).toBeNull();
    // A remembered project's rowless checkout is a label line too, so count
    // the checkouts the rows actually sit under.
    expect(rows()).toHaveLength(3);
    expect(new Set(rows().map((row) => row.closest(".asr-checkout"))).size).toBe(1);
    // The old tab/leaf vocabulary never renders again.
    expect(host.querySelector(".asr-item")).toBeNull();
    expect(host.querySelector(".asr-row--tab")).toBeNull();
    expect(host.querySelector(".asr-leaf")).toBeNull();

    expect(rows()).toHaveLength(3);
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

    const listed = rows();
    expect(listed).toHaveLength(2);
    // Open order, not severity: the marks differ, the positions do not move.
    expect(listed[0].dataset.state).toBe("asked");
    expect(listed[1].dataset.state).toBe("failed");
  });
});

describe("AgentRail click contract", () => {
  it("never selects a tab from the rail; a card row only focuses its pane", async () => {
    // Spec §12: "a tab is unreachable" from the card rail — the whole
    // `onSelectTab` path a tab row used to drive is gone. `onFocusPane` is
    // the ONE press a card row makes, keyed by the pane's own GLOBAL tab
    // index (not its position in the card, which the fixture's second tab
    // deliberately does not share).
    const onSelectTab = vi.fn();
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onSelectTab, onFocusPane });
    await settle();

    click(rows()[1].querySelector(".asr-card__hit"));
    expect(onFocusPane).toHaveBeenCalledWith(1, 21);
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it("focuses the exact pane behind a card row", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount({ onFocusPane });
    await settle();

    // Every agent in a checkout is a peer row now (design §3/§5) — no more
    // headless item, no leaf tree. Press lands on the row's hit layer, since
    // DL-27.21 gives the row its own ✕ and a button cannot nest a button.
    const listed = rows();
    expect(listed).toHaveLength(2);
    click(listed[1].querySelector(".asr-card__hit"));
    expect(onFocusPane).toHaveBeenCalledWith(0, 12);
  });

  it("lists every pane of a multi-agent tab as a row when the card is open, with no overflow count", async () => {
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
    mount();
    await settle();

    // The chip budget, `+N` and the tree all died with the tab tier: every
    // agent is a visible ROW, so there is nothing left to count or disclose.
    // `+N` survives only on a CLOSED card's segmented strip (spec §4).
    expect(rows()).toHaveLength(4);
    expect(host.querySelector("[data-overflow]")).toBeNull();
    expect(host.querySelector(".asr-chips")).toBeNull();
    expect(host.querySelector("button.asr-disclose")).toBeNull();
  });

  it("closes only that row's own agent from the close action", async () => {
    // Close model (2026-08-22) table row 1, kept across the tab tier's
    // removal (DL-27.21): every agent row's ✕ closes that PANE. There is no
    // more "close the tab" branch on an agent row — a card row IS an agent.
    const onCloseTab = vi.fn();
    const onClosePane = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onCloseTab, onClosePane });
    await settle();

    click(rows()[1].querySelector(".asr-row__action--close"));
    expect(onClosePane).toHaveBeenCalledWith(1, 21);
    expect(onClosePane).toHaveBeenCalledTimes(1);
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it("gives a shell-only tab its own selectable and closable row", async () => {
    const onCloseTab = vi.fn();
    const onClosePane = vi.fn();
    const onSelectTab = vi.fn();
    tabViews.value = [tab({ key: 1, panes: [] })];
    mount({ onCloseTab, onClosePane, onSelectTab, cardActions: ACTIONS });
    await settle();

    expect(host.querySelector(".asr-checkout")).not.toBeNull();
    // The row is reachable without a press on the label line; that line's own
    // press-to-focus contract is `worktree-card.test.tsx`'s.
    expect(onSelectTab).not.toHaveBeenCalled();
    const shell = host.querySelector<HTMLElement>('.asr-card__row[data-kind="shell"]');
    expect(shell).not.toBeNull();
    click(shell?.querySelector(".asr-card__hit"));
    expect(onSelectTab).toHaveBeenCalledWith(0);
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    click(shell?.querySelector(".asr-row__action--close"));
    expect(onCloseTab).toHaveBeenCalledWith(0);
    expect(ACTIONS.onRunAgent).not.toHaveBeenCalled();
    expect(onClosePane).not.toHaveBeenCalled();
  });

  it("moves the current mark from tab state when a checkout's label is pressed", async () => {
    tabViews.value = [
      tab({ key: 1, workspacePath: "/r/main" }),
      tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 22 })] }),
    ];
    activeTabIndex.value = 0;
    const onFocusPane = vi.fn((index: number) => {
      activeTabIndex.value = index;
    });
    mount({ onFocusPane });
    await settle();
    const checkouts = host.querySelectorAll<HTMLElement>(".asr-checkout");
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].dataset.current).toBe("true");
    expect(checkouts[1].dataset.current).toBe("false");
    click(checkouts[1].querySelector(".asr-checkout__focus"));
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(1, 22);
    expect(checkouts[0].dataset.current).toBe("false");
    expect(checkouts[1].dataset.current).toBe("true");
  });

  it("keeps a shell tab reachable beside an agent tab in the same checkout", async () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, agent: "claude" })] }),
      tab({ key: 2, name: "logs", panes: [pane({ paneId: 21, agent: null })] }),
    ];
    mount({ onSelectTab, onCloseTab });
    await settle();

    const shell = host.querySelector<HTMLElement>('.asr-card__row[data-kind="shell"]');
    expect(shell?.querySelector(".asr-card__name")?.textContent).toBe("logs");
    click(shell?.querySelector(".asr-card__hit"));
    expect(onSelectTab).toHaveBeenCalledWith(1);
    click(shell?.querySelector(".asr-row__action--close"));
    expect(onCloseTab).toHaveBeenCalledWith(1);
  });

  it("keeps every shell-only tab in one checkout separately reachable", async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, name: "server", panes: [pane({ paneId: 11, agent: null })] }),
      tab({ key: 2, name: "logs", panes: [pane({ paneId: 21, agent: null })] }),
    ];
    mount({ onSelectTab });
    await settle();

    const shellRows = host.querySelectorAll<HTMLElement>('.asr-card__row[data-kind="shell"]');
    expect([...shellRows].map((row) => row.querySelector(".asr-card__name")?.textContent)).toEqual([
      "server",
      "logs",
    ]);
    click(shellRows[1]?.querySelector(".asr-card__hit"));
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it("gives every row of a multi-agent checkout its own close", async () => {
    const onClosePane = vi.fn();
    tabViews.value = [
      tab({
        key: 4,
        panes: [pane({ paneId: 41, agent: "claude" }), pane({ paneId: 42, agent: "codex" })],
      }),
    ];
    mount({ onClosePane });
    await settle();

    const closes = host.querySelectorAll<HTMLElement>(".asr-card__row .asr-row__action--close");
    expect(closes).toHaveLength(2);
    click(closes[1]);
    expect(onClosePane).toHaveBeenCalledWith(0, 42);
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });

  it("has no options control left on the row", async () => {
    // `TabPopover` and the rename/colour/logo features it carried were removed
    // on 2026-08-16; close is the only hover action a row has now.
    mount();
    await settle();

    expect(host.querySelector(".asr-row__action--options")).toBeNull();
    expect(host.querySelector(".tab-popover")).toBeNull();
    expect(host.querySelectorAll(".asr-row__action")).toHaveLength(rows().length);
  });
});

describe("AgentRail worktree cards (design 2026-08-25)", () => {
  it("renders a multi-agent checkout as peer rows, named or not, with no tree and no headless item", async () => {
    // The pane TREE / headless-item vocabulary (`PANE_TREE_HIDDEN`,
    // `.asr-item[data-headless]`) is gone with the tab tier: a checkout's
    // agents are peer rows inside its ONE card, whether or not the tab that
    // holds them was named.
    tabViews.value = [
      tab({
        name: "pair",
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    expect(host.querySelector(".asr-item")).toBeNull();
    expect(host.querySelector("[data-headless]")).toBeNull();
    expect(host.querySelector(".asr-disclose")).toBeNull();
    expect(host.querySelector(".asr-panes")).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it("updates each row from its own session message while keeping its state and close", async () => {
    tabViews.value = [
      // Two separate tabs of the same checkout, each its first agent — so
      // neither label carries the `(Split)` suffix (spec §3's own case for
      // a SECOND pane of one tab, exercised separately below).
      tab({ key: 1, panes: [pane({ paneId: 11, agent: "claude", attention: "requested" })] }),
      tab({ key: 2, panes: [pane({ paneId: 12, agent: "codex", phase: "working" })] }),
    ];
    mount();
    await settle();

    expect(rows().map((row) => row.querySelector(".asr-card__name")?.textContent)).toEqual([
      "Claude",
      "Codex",
    ]);
    act(() => {
      paneTails.value = new Map([
        [11, "Permission needed: prisma migrate dev"],
        [12, "Running the suite"],
      ]);
    });
    await settle();

    const listed = rows();
    expect(listed.map((row) => row.dataset.state)).toEqual(["asked", "working"]);
    // DL-27.28: an unnamed row with no first prompt leads with its agent label
    // and carries `agent · turn` on its second line.
    expect(listed.map((row) => row.querySelector(".asr-card__name")?.textContent)).toEqual([
      "Claude",
      "Codex",
    ]);
    expect(listed.map((row) => row.querySelector(".asr-card__sentence")?.textContent)).toEqual([
      "Claude · Permission needed: prisma migrate dev",
      "Codex · Running the suite",
    ]);
    expect(listed[0]?.querySelector(".asr-card__hit")?.getAttribute("title")).toContain(
      "Permission needed: prisma migrate dev",
    );
    expect(
      listed[1]?.querySelector(".asr-row__action--close")?.getAttribute("aria-label"),
    ).toContain("Running the suite");
    expect(host.querySelectorAll(".asr-row__action--close")).toHaveLength(2);
    act(() => {
      paneTails.value = new Map();
    });
    await settle();
    expect(rows().map((row) => row.querySelector(".asr-card__name")?.textContent)).toEqual([
      "Claude",
      "Codex",
    ]);
  });

  it("lets a project header collapse and restore its cards", async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21 })] }),
    ];
    mount();
    await settle();

    const header = host.querySelector<HTMLElement>("button.asr-cluster__toggle");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);

    click(header);
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".asr-checkout")).toBeNull();

    // The card's own OPEN state is window-local and independent of the
    // project's collapse (design §11.6/§13.7) — it survives the round trip
    // without being re-clicked.
    click(header);
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);
  });

  it("counts who needs you on the header, open or folded (DL-27.27, amended 2026-10-07)", async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [
          pane({ paneId: 11, attention: "requested" }),
          pane({ paneId: 12, agent: "codex", phase: "working" }),
        ],
      }),
      tab({
        key: 2,
        workspacePath: "/r/side",
        panes: [pane({ paneId: 21, attention: "warning" })],
      }),
      tab({ key: 3, panes: [pane({ paneId: 31, hasRun: true })] }),
    ];
    mount();
    await settle();

    const header = host.querySelector<HTMLElement>("button.asr-cluster__toggle");
    const count = (): HTMLElement | null | undefined =>
      header?.querySelector<HTMLElement>(".asr-cluster__count");
    expect(count()?.textContent).toBe("2 need you");
    // Asked only: the yellow ink.
    expect(count()?.dataset.tone).toBe("asked");
    expect(header?.getAttribute("aria-label")).toBe("Collapse project main, 2 need you");

    click(header);
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(count()?.textContent).toBe("2 need you");
  });

  it("turns the count red when any of them failed", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, attention: "requested" }),
          pane({ paneId: 12, attention: "error" }),
        ],
      }),
    ];
    mount();
    await settle();

    const count = host.querySelector<HTMLElement>(".asr-cluster__count");
    expect(count?.textContent).toBe("2 need you");
    expect(count?.dataset.tone).toBe("failed");
    expect(count?.getAttribute("title")).toBe("2 need you, 1 failed");
  });

  it("omits the count when nothing needs the user, however much is running", async () => {
    tabViews.value = [
      tab({ panes: [pane({ paneId: 11, phase: "working" }), pane({ paneId: 12, agent: null })] }),
    ];
    mount();
    await settle();

    expect(host.querySelector("button.asr-cluster__toggle")).not.toBeNull();
    expect(host.querySelector(".asr-cluster__count")).toBeNull();
  });

  it("keeps Tauri on the legacy repository rail", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    tabViews.value = [tab({ panes: [pane({ paneId: 11 })] })];
    mount();
    await settle();

    const rail = host.querySelector(".wsbar--repos");
    expect(rail?.firstElementChild?.className).toBe("sidebar-launcher");
    expect(rail?.querySelector(".sidebar-new")).not.toBeNull();
    expect(host.querySelector(".asr-checkout")).toBeNull();
  });

  // DL-28 (restored 2026-10-07): the tools row is Electron's. A footer handed
  // to the frozen Tauri rail must not paint there.
  it("hands the legacy Tauri rail no tools footer", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    tabViews.value = [tab({ panes: [pane({ paneId: 11 })] })];
    mount({ footer: <div data-testid="rail-footer" /> });
    await settle();

    expect(host.querySelector(".wsbar--repos")).not.toBeNull();
    expect(host.querySelector('[data-testid="rail-footer"]')).toBeNull();
  });
});

describe("AgentRail clusters (DL-27.9/DL-27.12)", () => {
  it("puts a folder before the project name and the caret at the far edge", async () => {
    tabViews.value = [tab({ panes: [pane({ attention: "requested" })] })];
    mount();
    await settle();

    // The collapse control, not the header row: since DL-27.18 the row also
    // carries the `+`, which stands OUTSIDE this button.
    const head = host.querySelector<HTMLElement>(".asr-cluster__toggle");
    expect([...(head?.children ?? [])].map((child) => child.className)).toEqual([
      "asr-cluster__folder",
      "asr-cluster__name",
      "asr-cluster__tail",
    ]);
    // DL-27.27 (amended 2026-10-04): count and caret share the trailing slot.
    expect(
      [...(head?.querySelector(".asr-cluster__tail")?.children ?? [])].map(
        (child) => child.className,
      ),
    ).toEqual(["asr-cluster__count", "asr-cluster__caret"]);
    expect(
      head?.querySelector(".asr-cluster__folder > span")?.getAttribute("data-deck-icon-size"),
    ).toBe("15");
    expect(readFileSync("src/styles/01-tokens.css", "utf8")).toContain("--type-project: 15px");
    expect(readFileSync("src/styles/04a-agent-rail.css", "utf8")).toContain(
      "font: 600 var(--type-project)",
    );
  });

  it("prints the project once and names each row by its pane label", async () => {
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
    expect(heads[0].querySelector(".asr-cluster__name")?.textContent).toBe("main");
    // Both tabs belong to one repository (two checkouts, `main` and `side`),
    // each its own label line, its rows named by pane label: a row with no
    // task label spends its word on the agent, capitalised via `displayAgent`,
    // never on the raw agent id (DL-27.28).
    expect(branches()).toEqual(["main", "side"]);
    expect([...rows()].map((row) => row.querySelector(".asr-card__name")?.textContent)).toEqual([
      "Claude",
      "Codex",
    ]);
    // The old worktree sub-header vocabulary is entirely gone (DL-27.23,
    // superseded by the card).
    expect(host.querySelector(".asr-row__worktree")).toBeNull();
    expect(host.querySelector(".asr-wt__name")).toBeNull();
  });

  it("keeps project → checkout → agent for a project with one tab", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__head .asr-cluster__name")?.textContent).toBe("main");
    expect(rows()[0].querySelector(".asr-card__name")?.textContent).toBe("Claude");
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

    // Two tabs of one project, one of them asking: one header, both rows
    // under the same checkout card, and the asking row names its AGENT like
    // every other row.
    const heads = host.querySelectorAll(".asr-stream .asr-cluster__head");
    expect(heads).toHaveLength(1);
    expect(host.querySelectorAll(".asr-stream .asr-card__row")).toHaveLength(3);
    const asking = host.querySelector<HTMLElement>(
      '.asr-stream .asr-card__row[data-state="asked"]',
    );
    expect(asking?.querySelector(".asr-card__name")?.textContent).toBe("Claude");
  });
});

describe("AgentRail worktree groups (DL-27.23/DL-27.24, amended by the card)", () => {
  it("prints a card head for a project with exactly one checkout", async () => {
    // `/r/side` is in this fixture's workspace history, so the project has two
    // groups by default; a history with only the primary in it is the
    // one-checkout case — and it is still labelled (DL-27.23).
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/r/main", lastOpenedAt: 2 }],
    };
    mount();
    await settle();

    expect(branches()).toEqual(["main"]);
    expect(host.querySelectorAll(".asr-cluster__head")).toHaveLength(1);
  });

  it("stands each row under the checkout it runs in, on the rail's one left edge", async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] }),
    ];
    mount();
    await settle();

    // DOM order is the render order: label line, its rows, next label line.
    const printed = [
      ...host.querySelectorAll(".asr-checkout__line, .asr-stream .asr-card__row"),
    ].map((node) =>
      node.classList.contains("asr-checkout__line")
        ? `checkout:${node.querySelector(".asr-checkout__name")?.textContent}`
        : `row:${node.getAttribute("data-pane-id")}`,
    );
    expect(printed).toEqual(["checkout:main", "row:11", "checkout:side", "row:21"]);
    // DL-27.28: the label line focuses its checkout and folds nothing.
    const label = host.querySelector(".asr-checkout__focus");
    expect(label?.tagName).toBe("BUTTON");
    expect(label?.hasAttribute("aria-expanded")).toBe(false);
  });

  it("keeps a checkout with nothing open in it, its label opening the launch page", async () => {
    const onOpenAgentLauncher = vi.fn();
    mount({ cardActions: { ...ACTIONS, onOpenAgentLauncher } });
    await settle();

    // One tab, in `/r/main`; `/r/side` is in Deck's history with nothing
    // open, so it renders as its label line alone.
    expect(branches()).toEqual(["main", "side"]);
    expect(rows()).toHaveLength(1);

    // No `+` on any line (DL-27.26, amended 2026-10-08): the bare checkout's
    // label is the way in, and names the project, the checkout AND its branch.
    expect(host.querySelector(".asr-checkout__add")).toBeNull();
    const bare = host.querySelectorAll<HTMLElement>(".asr-checkout__focus")[1];
    expect(bare.getAttribute("aria-label")).toBe("New agent in main · side");
    click(bare);
    expect(onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/r/side");
    expect(ACTIONS.onRunAgent).not.toHaveBeenCalled();
  });

  it("keeps the bare checkout's label as text when the host cannot open a launcher", async () => {
    mount({ cardActions: ACTIONS });
    await settle();

    expect(host.querySelector(".asr-checkout__add")).toBeNull();
    expect(host.querySelectorAll("span.asr-checkout__focus")).toHaveLength(1);
    // The labels stand without it (DL-19.7).
    expect(branches()).toEqual(["main", "side"]);
  });

  it("tags a folder git does not know `folder`", async () => {
    configureRepositoryClient({
      scan: async () => ({ kind: "plain", reason: "not a git repository" }),
    });
    invalidateRepositoryScans();
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/r/main", lastOpenedAt: 2 }],
    };
    mount({ cardActions: ACTIONS });
    await settle();

    // DL-27.23, amended 2026-09-23: the one implicit group takes the same
    // shape a checkout does, named by the folder and tagged `folder`, so an
    // added folder does not read as a different kind of thing.
    expect(host.querySelectorAll(".asr-checkout")).toHaveLength(1);
    expect(host.querySelector(".asr-cluster__head .asr-cluster__name")?.textContent).toBe("main");
    expect(branches()).toEqual(["main"]);
    expect(host.querySelector(".asr-checkout__tag")?.textContent).toBe("folder");
    expect(rows()).toHaveLength(1);
    // No `+` on the line; the checkout's right-click menu has no branch to fork from.
    expect(host.querySelector(".asr-checkout__add")).toBeNull();
    expect(host.querySelector(".asr-cluster__add")).toBeNull();
    act(() => {
      host
        .querySelector(".asr-checkout")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const menu = host.querySelector<HTMLElement>(".asr-pop--actions");
    expect(menu).not.toBeNull();
    expect(menu?.textContent).not.toContain("Create branch");
    expect(menu?.textContent).toContain("runs in this folder");
  });

  it("hides its groups with the project when the header collapses", async () => {
    mount();
    await settle();

    click(host.querySelector("button.asr-cluster__toggle"));
    expect(branches()).toEqual([]);
    expect(rows()).toHaveLength(0);
  });

  it("focuses the project's checkout when its header is pressed", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] })];
    mount({ onFocusPane });
    await settle();

    click(host.querySelector("button.asr-cluster__toggle"));
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(0, 21);
  });

  it("focuses the project from its frame's padding without toggling it", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] })];
    mount({ onFocusPane });
    await settle();

    for (const selector of [".asr-cluster", ".asr-cluster__head"]) {
      click(host.querySelector(selector));
    }
    expect(onFocusPane).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".asr-cluster")?.getAttribute("data-collapsed")).toBe("false");
  });

  it("opens a folded project from its frame's padding", async () => {
    tabViews.value = [tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] })];
    mount();
    await settle();

    click(host.querySelector("button.asr-cluster__toggle"));
    const cluster = host.querySelector(".asr-cluster");
    expect(cluster?.getAttribute("data-collapsed")).toBe("true");
    click(cluster);
    expect(cluster?.getAttribute("data-collapsed")).toBe("false");
  });

  it("carries the checkout's branch into the row's accessible name and tooltip", async () => {
    tabViews.value = [tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] })];
    mount();
    await settle();

    const hit = host.querySelector(".asr-card__hit");
    // Review fix (2026-08-26): the project prefix is back too. Deduplicated
    // since 2026-08-30 — folder and branch are both `side` here, so the
    // composed name states the word once.
    expect(hit?.getAttribute("aria-label")).toContain("main · side");
    expect(hit?.getAttribute("aria-label")).not.toContain("side · side");
    expect(hit?.getAttribute("title")).toBe("Claude — idle");
  });
});

describe("AgentRail create controls (rail-create-consolidation, 2026-09-02)", () => {
  it("draws no create control on any checkout or project header", async () => {
    // DL-27.26, amended 2026-10-08: the create verbs live in the create row.
    mount({ cardActions: ACTIONS });
    await settle();

    expect(host.querySelectorAll(".asr-cluster__add")).toHaveLength(0);
    expect(host.querySelectorAll(".asr-checkout__add")).toHaveLength(0);
  });

  it("gives a checkout no fold of its own, its collapse left to the project header", async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] }),
    ];
    mount({ cardActions: ACTIONS });
    await settle();

    // DL-27.28: the project header's caret is the only fold, even with two
    // checkouts holding rows.
    expect(host.querySelectorAll(".asr-checkout [aria-expanded]")).toHaveLength(0);
    click(host.querySelector(".asr-checkout__focus"));
    expect(rows()).toHaveLength(2);
  });

  it("omits every create control when nothing wires the menu (DL-19.7)", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__add")).toBeNull();
    expect(host.querySelector(".asr-checkout__add")).toBeNull();
    // The collapse control is untouched by their absence.
    expect(host.querySelector("button.asr-cluster__toggle")).not.toBeNull();
  });

  it("keeps the header a two-track grid with the caret on the rows' own edge", () => {
    // The launcher's middle track went with the launcher: the toggle spans
    // every track so its trailing caret keeps the outermost 17px slot, and no
    // `:has` reserve holds 24px open for a control that is not there. The box
    // rule is the other half of the alignment: `width: 100%` beside the
    // padding had made the header 11px wider than every row under it.
    const css = readFileSync("src/styles/04a-agent-rail.css", "utf8");
    const head = css.slice(
      css.indexOf(".asr-cluster__head {"),
      css.indexOf(".asr-cluster__toggle {"),
    );
    expect(head).toContain("box-sizing: border-box");
    expect(head).not.toContain("\n  width: 100%;");
    expect(head).toContain("grid-template-columns: minmax(0, 1fr) 17px;");
    expect(css).toContain("grid-column: 1 / -1");
    expect(css).not.toContain(".asr-cluster__add {");
    expect(css).not.toContain(":has(.asr-cluster__add)");
  });
});

describe("AgentRail remembered projects (2026-08-20)", () => {
  beforeEach(() => {
    // Per-path scans: the shared client answers SCAN for every path, which
    // would fold the remembered folder below into the live repository.
    configureRepositoryClient({
      scan: async (path: string) =>
        path.startsWith("/r/") ? SCAN : { kind: "plain", reason: "not a git repository" },
    });
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/r/main", lastOpenedAt: 2 },
        { path: "/w/other", lastOpenedAt: 1 },
      ],
    };
  });

  it("puts no needs-you count on a remembered project's header (DL-27.27)", async () => {
    tabViews.value = [tab({ panes: [pane({ attention: "requested" })] })];
    mount();
    await settle();

    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    expect(heads).toHaveLength(2);
    expect(heads[0].querySelector(".asr-cluster__count")?.textContent).toBe("1 need you");
    expect(heads[1].querySelector(".asr-cluster__count")).toBeNull();
  });

  it("keeps a rowless still header for a workspace with nothing open", async () => {
    mount();
    await settle();

    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    expect(heads).toHaveLength(2);
    // The live project leads; the remembered one follows as a still label —
    // no rows under it and no collapse control (DL-19.7: omitted, not inert).
    const still = heads[1].querySelector(".asr-cluster__still");
    expect(still?.querySelector(".asr-cluster__name")?.textContent).toBe("other");
    expect(heads[1].querySelector(".asr-cluster__toggle")).toBeNull();
    expect(heads[1].querySelector(".asr-cluster__caret")).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it("keeps a remembered project one press from an agent, through its checkout's label", async () => {
    // The header carries no `+`, so a remembered project prints its checkouts
    // as rowless label lines and THEIR label is the way back in — `/w/other` is
    // a plain folder, so it reads the same as a checkout with nothing open
    // (tagged `folder`), and the launch page opens there.
    const onOpenAgentLauncher = vi.fn();
    mount({ cardActions: { ...ACTIONS, onOpenAgentLauncher } });
    await settle();

    expect(host.querySelector(".asr-cluster__add")).toBeNull();
    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    const remembered = heads[1].closest<HTMLElement>(".asr-cluster");
    expect(remembered?.querySelector(".asr-checkout__tag")?.textContent).toBe("folder");
    const row = remembered?.querySelector<HTMLElement>("button.asr-checkout__focus");
    expect(row).not.toBeNull();
    // The header itself is still a still label — no toggle, no live close.
    expect(heads[1].querySelector(".asr-cluster__toggle")).toBeNull();
    expect(heads[1].querySelector(".asr-cluster__remove--live")).toBeNull();
    click(row);
    expect(onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/w/other");
  });

  it("keeps a close on the rowless header that removes the folder", async () => {
    const onRemoveWorkspace = vi.fn();
    mount({ onRemoveWorkspace });
    await settle();

    // Only the remembered header carries it: a live cluster's close lives on
    // its tab rows, and history does not control its presence.
    const removes = host.querySelectorAll<HTMLElement>("button.asr-cluster__remove");
    expect(removes).toHaveLength(1);
    expect(removes[0].closest(".asr-cluster__head")).toBe(
      host.querySelectorAll(".asr-cluster__head")[1],
    );
    expect(removes[0].getAttribute("aria-label")).toBe("Remove other from the rail");
    click(removes[0]);
    expect(onRemoveWorkspace).toHaveBeenCalledWith(["/w/other"]);
  });

  it("omits the close when nothing wires it", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__remove")).toBeNull();
  });

  it("removes every folded history entry of one repository at once", async () => {
    // Two remembered worktrees of ONE repository fold into one header
    // (2026-08-20); its close must drop both entries, or the header would
    // re-derive from the sibling and the X would appear to do nothing.
    const OTHER_SCAN: RepositoryScan = {
      kind: "repository",
      key: "/x/.git",
      root: "/x/main",
      worktrees: [
        {
          path: "/x/main",
          head: "c",
          branch: "main",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
        {
          path: "/x/side",
          head: "d",
          branch: "side",
          bare: false,
          detached: false,
          locked: null,
          prunable: null,
        },
      ],
    };
    configureRepositoryClient({
      scan: async (path: string) =>
        path.startsWith("/x/")
          ? OTHER_SCAN
          : path.startsWith("/r/")
            ? SCAN
            : { kind: "plain", reason: "not a git repository" },
    });
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/r/main", lastOpenedAt: 3 },
        { path: "/x/main", lastOpenedAt: 2 },
        { path: "/x/side", lastOpenedAt: 1 },
      ],
    };
    const onRemoveWorkspace = vi.fn();
    mount({ onRemoveWorkspace });
    await settle();

    const removes = host.querySelectorAll<HTMLElement>("button.asr-cluster__remove");
    expect(removes).toHaveLength(1);
    click(removes[0]);
    expect(onRemoveWorkspace).toHaveBeenCalledWith(["/x/main", "/x/side"]);
  });
});

describe("AgentRail project close (close model, 2026-08-22, table row 4)", () => {
  beforeEach(() => {
    configureRepositoryClient({
      scan: async (path: string) =>
        path.startsWith("/r/") ? SCAN : { kind: "plain", reason: "not a git repository" },
    });
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/r/main", lastOpenedAt: 3 },
        { path: "/r/side", lastOpenedAt: 2 },
        { path: "/w/other", lastOpenedAt: 1 },
      ],
    };
  });

  it("closes every tab of the project, secondary worktrees included", async () => {
    // One repository, two checkouts, three tabs — the cluster folds them and
    // the header's ✕ is the whole project's, not the primary worktree's.
    tabViews.value = [
      tab({ key: 1, workspacePath: "/r/main", panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, workspacePath: "/r/side", panes: [pane({ paneId: 21 })] }),
      tab({ key: 3, workspacePath: "/r/main", panes: [pane({ paneId: 31 })] }),
    ];
    const onCloseProject = vi.fn();
    mount({ onCloseProject });
    await settle();

    const removes = host.querySelectorAll<HTMLElement>("button.asr-cluster__remove--live");
    expect(removes).toHaveLength(1);
    click(removes[0]);
    expect(onCloseProject).toHaveBeenCalledTimes(1);
    expect(onCloseProject.mock.calls[0][0]).toEqual([0, 1, 2]);
  });

  it("hands over the history entries the project would otherwise re-derive from", async () => {
    // The second half of the act: closing the tabs alone would demote this
    // cluster to the remembered tier and leave the header standing.
    tabViews.value = [tab({ key: 1, workspacePath: "/r/main", panes: [pane({ paneId: 11 })] })];
    const onCloseProject = vi.fn();
    mount({ onCloseProject });
    await settle();

    click(host.querySelector("button.asr-cluster__remove--live"));
    // `/w/other` is a DIFFERENT project's history and stays untouched.
    expect(onCloseProject.mock.calls[0][1]).toEqual(["/r/main", "/r/side"]);
  });

  it("omits the live close when nothing wires it", async () => {
    mount({ onRemoveWorkspace: NOOP });
    await settle();

    // The remembered header keeps its own; the live one carries none.
    expect(host.querySelector(".asr-cluster__remove--live")).toBeNull();
    expect(host.querySelectorAll("button.asr-cluster__remove")).toHaveLength(1);
  });

  it("gives the live close the header's last track and swaps the caret with the count", () => {
    // The header's trailing 17px track is the rows' glyph column restated —
    // no fourth track, so nothing moves off the rows' own columns. Since
    // 2026-10-04 the caret leaves it for the count's slot (DL-27.27, amended).
    const css = readFileSync("src/styles/04a-agent-rail.css", "utf8");
    expect(css).toContain(".asr-cluster:hover .asr-cluster__count,");
    expect(css).not.toContain(":has(.asr-cluster__remove--live) .asr-cluster__caret");
    // Two tracks since `rail-create-consolidation` (2026-09-02) took the
    // launcher's middle one: the close pins into the last, which is the caret's.
    const head = css.slice(
      css.indexOf(".asr-cluster__head {"),
      css.indexOf(".asr-cluster__toggle {"),
    );
    expect(head).toContain("grid-template-columns: minmax(0, 1fr) 17px;");
    const remove = css.slice(
      css.indexOf(".asr-cluster__remove {"),
      css.indexOf(".asr-cluster:hover .asr-cluster__remove,"),
    );
    expect(remove).toContain("grid-column: 2;");
  });
});

describe("AgentRail state wording (DL-27.2, amended by the card)", () => {
  it("puts the state badge on the agent glyph and keeps close in the trailing cell", async () => {
    // Both non-idle, deliberately: `idle` paints no badge at all (its own
    // pinned test below), so this checks the badge's PLACEMENT on a state
    // that actually draws one.
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, agent: "claude", attention: "requested" }),
          pane({ paneId: 12, agent: "codex", hasRun: true }),
        ],
      }),
    ];
    mount();
    await settle();

    const listed = rows();
    expect(listed).toHaveLength(2);
    for (const row of listed) {
      // The hit layer is first in DOM order and paints under everything
      // (DL-27.1); the READING order starts after it.
      expect(row.firstElementChild?.classList.contains("asr-card__hit")).toBe(true);
      expect(row.querySelector(".asr-card__glyph")).not.toBeNull();
      expect(row.querySelector(".asr-card__glyph .asr-card__logo")).not.toBeNull();
      // DL-27.21, amended 2026-10-09: the state is the corner badge on the logo;
      // the trailing cell keeps only, on hover, close.
      expect(row.querySelector(".asr-card__glyph .asr-card__dot")).not.toBeNull();
      expect(row.querySelector(".asr-card__status .asr-card__dot")).toBeNull();
      expect(row.querySelector(".asr-row__actions")).not.toBeNull();
    }
  });

  it("keeps the status word out of the row while title and aria still say it", async () => {
    tabViews.value = [tab({ panes: [pane({ attention: "error" })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("failed");
    // The mark is the fast read; the word is never painted in the row.
    expect(row.textContent).not.toContain("failed");
    expect(row.querySelector(".asr-card__dot")?.getAttribute("data-state")).toBe("failed");

    const hit = row.querySelector<HTMLElement>(".asr-card__hit");
    expect(hit?.getAttribute("aria-label")).toContain("failed");
    expect(hit?.getAttribute("title")).toContain("failed");
  });

  it.each([
    { name: "working", pane: pane({ phase: "working" }), mark: "working" },
    { name: "done", pane: pane({ hasRun: true }), mark: "done" },
  ])("keeps $name legible with one state signal", async ({ pane: paneView, mark }) => {
    tabViews.value = [tab({ panes: [paneView] })];
    mount();
    await settle();

    const row = rows()[0];
    const status = row.querySelector(".asr-card__status");
    expect(row.querySelector(".asr-card__glyph .asr-card__dot")?.getAttribute("data-state")).toBe(
      mark,
    );
    expect(status?.querySelector(".asr-card__dot")).toBeNull();
    expect(status?.querySelector("i")).toBeNull();
  });

  // Agent-signal contract layer, stage 0 (2026-09-03; DL-27.3 amended): the
  // mark carries its confidence, and an agent whose process left reads `ended`.
  it("preserves inferred asked confidence in the badge metadata and accessible name", async () => {
    tabViews.value = [
      tab({
        panes: [pane({ attention: "completed", confidence: "inferred", hasRun: true })],
      }),
    ];
    mount();
    await settle();

    const row = rows()[0];
    const dot = row.querySelector(".asr-card__dot");
    expect(dot?.getAttribute("data-state")).toBe("asked");
    expect(dot?.getAttribute("data-confidence")).toBe("inferred");
    expect(row.dataset.confidence).toBe("inferred");
    const hit = row.querySelector<HTMLElement>(".asr-card__hit");
    expect(hit?.getAttribute("aria-label")).toContain("needs you (inferred)");
    expect(hit?.getAttribute("title")).toContain("needs you (inferred)");
  });

  it("draws an explicit asked filled, with no confidence word in the name", async () => {
    tabViews.value = [
      tab({ panes: [pane({ attention: "requested", confidence: "explicit", hasRun: true })] }),
    ];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.querySelector(".asr-card__dot")?.getAttribute("data-confidence")).toBe("explicit");
    const hit = row.querySelector<HTMLElement>(".asr-card__hit");
    expect(hit?.getAttribute("aria-label")).toMatch(/, needs you$/);
    expect(hit?.getAttribute("aria-label")).not.toContain("inferred");
  });

  it("names an ended agent's pane ended, with its own dot state", async () => {
    tabViews.value = [
      tab({ panes: [pane({ phase: "exited", phaseConfidence: "explicit", hasRun: true })] }),
    ];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("ended");
    expect(row.querySelector(".asr-card__dot")?.getAttribute("data-state")).toBe("ended");
    const hit = row.querySelector<HTMLElement>(".asr-card__hit");
    expect(hit?.getAttribute("aria-label")).toMatch(/, ended$/);
    // Not busy: a dead agent draws the stop square, not the spinner's frames.
    expect(row.querySelectorAll(".asr-card__dot > i")).toHaveLength(0);
  });

  it("paints no dot at all for idle (design §9.4 point 2 — amends DL-27.3)", async () => {
    // A real, deliberate reversal: the shipped rail's `RailStatusMark` drew a
    // quiet gray dot for `idle`; the card's own corner badge draws NOTHING,
    // so a still agent reads as absent decoration rather than a fourth colour.
    tabViews.value = [tab({ panes: [pane()] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("idle");
    expect(row.querySelector(".asr-card__dot")).toBeNull();
  });

  it("draws a busy row as the braille spinner on the logo, never the shared working ring", async () => {
    // DL-27.21, amended 2026-10-09: `working` is a braille terminal spinner on
    // the logo's corner, not `WorkspaceSpinner` — the ring stays the CLUSTER/head
    // vocabulary and is never reused on a card row.
    tabViews.value = [tab({ panes: [pane({ phase: "working" })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.querySelector(".asr-row__mark--spinner")).toBeNull();
    expect(row.querySelector("svg.wsitem__spinner")).toBeNull();
    const spinner = row.querySelector(".asr-card__glyph > .asr-card__dot");
    expect(spinner?.getAttribute("data-state")).toBe("working");
    expect(spinner?.children).toHaveLength(10);
    expect(row.querySelector(".asr-card__load")?.children).toHaveLength(0);
  });
});

describe("AgentRail live-only contract", () => {
  it("does not paint a workspace that exists only in history", async () => {
    sessionArchive.value = { "/r/side": { savedAt: 1, tabs: [] } };
    mount();
    await settle();

    expect(host.querySelector(".asr-row--archived")).toBeNull();
  });

  it("gives a shell-only tab a terminal row rather than an agent row", async () => {
    tabViews.value = [tab({ panes: [pane({ agent: null })] })];
    mount();
    await settle();

    expect(host.querySelector(".asr-checkout")).not.toBeNull();
    expect(host.querySelector('.asr-card__row[data-kind="shell"]')).not.toBeNull();
    expect(host.querySelector('.asr-card__row[data-kind="agent"]')).toBeNull();
    expect(host.querySelector(".asr-chip--static")).toBeNull();
    expect(host.querySelector(".asr-disclose")).toBeNull();
  });
});

describe("AgentRail carried-over jobs", () => {
  it("raises no popover in sidebar layout, with the strip mounted beside it", async () => {
    // Both surfaces used to consume the ⌘⇧R chord; the action, the signal and
    // the popover all went on 2026-08-16, so neither can raise one.
    mountSidebarLayout();
    await settle();

    expect(host.querySelector(".tab-popover")).toBeNull();
  });

  it("keeps the row's pane identity dataset on the row element", async () => {
    mount();
    await settle();

    expect(rows()[0].dataset.paneId).toBe("11");
  });

  it("keeps the focused row's aria-current while a browser surface holds the stage", async () => {
    // DL-27.22's own record (kept, not moved, by the card design §9.10): the
    // focused mark is a fact about the WINDOW's keyboard, and a file or
    // browser surface holding the stage does not change which pane that is.
    // The old `surfaceActive` gate that used to blank a tab row's wash never
    // applied to the card's `aria-current` in the first place — this pins
    // that it still does not.
    tabViews.value = [tab({ panes: [pane({ paneId: 11, focused: true })] })];
    mount();
    await settle();

    const hit = () => rows()[0].querySelector(".asr-card__hit");
    expect(hit()?.getAttribute("aria-current")).toBe("true");

    act(() => {
      browserSurfaceActive.value = true;
    });
    expect(hit()?.getAttribute("aria-current")).toBe("true");
  });

  // DL-27.14 (amended 2026-10-08): the identity row carries no `+ New`; the rail's create row
  // is its own, and the tree draws no launcher.
  it("starts the Electron rail with the create row, then the project scrollport", async () => {
    mount();
    await settle();

    expect(host.querySelector(".sidebar-launcher")).toBeNull();
    expect(host.querySelector(".sidebar-new")).toBeNull();
    // The create row (DL-27.14, amended 2026-10-08) stands above the list, outside it.
    expect(host.querySelector(".asr-rail")?.firstElementChild).toBe(
      host.querySelector(".rail-create"),
    );
    expect(host.querySelector(".rail-create")?.nextElementSibling).toBe(
      host.querySelector(".asr-rail__list"),
    );
    expect(host.querySelector(".asr-rail__list .rail-create")).toBeNull();
    expect(host.querySelector(".asr-stream")?.firstElementChild).not.toBeNull();
  });

  // DL-28.1 (amended 2026-10-07): the tools row, then the usage summary, which
  // closes the rail.
  it("places the tools row, then the usage summary, outside the project scrollport", async () => {
    mount({
      usageSummary: <section data-testid="recent-activity" />,
      footer: <div data-testid="rail-footer" />,
    });
    await settle();

    const list = host.querySelector(".asr-rail__list");
    const stream = host.querySelector(".asr-stream");
    const activity = host.querySelector('[data-testid="recent-activity"]');
    const footer = host.querySelector('[data-testid="rail-footer"]');

    expect(stream?.parentElement).toBe(list);
    expect(list?.contains(activity)).toBe(false);
    expect(activity?.parentElement).toBe(list?.parentElement);
    expect(list?.nextElementSibling).toBe(footer);
    expect(list?.contains(footer)).toBe(false);
    expect(footer?.nextElementSibling).toBe(activity);
  });

  it("adds no rail wrapper when recent activity is omitted", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-rail__list")?.children).toHaveLength(1);
    expect(host.querySelector(".asr-rail__list")?.firstElementChild).toBe(
      host.querySelector(".asr-stream"),
    );
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
  // jsdom environment this file runs in. `src/styles.css` is an `@import`
  // index since the 2026-08-16 partial split, itself sub-split into
  // `04a`/`04b` once `04-agent-rail.css` crossed the 800-line ceiling; every
  // selector below (`.asr-rail`, `.asr-rail__list`, both collapsed-column
  // rules) lives in the shell half, `04a-agent-rail.css`.
  const stylesheet = readFileSync("src/styles/04a-agent-rail.css", "utf8");

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
    expect(start, `no \`${selector} {\` rule in src/styles/04a-agent-rail.css`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf("{", start);
    return stylesheet.slice(open + 1, stylesheet.indexOf("}", open));
  }

  it("places itself in the window grid's navigation cell", () => {
    const body = ruleBody(".asr-rail");
    expect(body).toContain("grid-column: 1");
    expect(body).toContain("grid-row: 2");
  });

  it("paints the side surface rather than letting the stage through", () => {
    // DL-18.7: the frame and the rail are one continuous side surface.
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
    expect(stylesheet).toContain('[data-sidebar-collapsed="true"] .asr-cluster__head');
  });
});

describe("AgentRail recent activity style contract", () => {
  const stylesheet = readFileSync("src/styles/13-sessions.css", "utf8");
  const recentStart = stylesheet.indexOf("/* ── Recent activity");
  const recentEnd = stylesheet.indexOf("/* ── Sessions screen: reduced motion", recentStart);
  const recentRules = stylesheet.slice(recentStart, recentEnd);

  function ruleBody(selector: string): string {
    const start = stylesheet.indexOf(`\n${selector} {`);
    expect(start, `no \`${selector} {\` rule in src/styles/13-sessions.css`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf("{", start);
    return stylesheet.slice(open + 1, stylesheet.indexOf("}", open));
  }

  it("separates the flat block and hides it with the collapsed sidebar", () => {
    const block = ruleBody(".recent-session-activity");
    expect(block).toContain("border-top: 1px solid var(--seam-recessed)");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("max-width: 100%");
    expect(stylesheet).toContain(
      '[data-sidebar-collapsed="true"] .recent-session-activity {\n  display: none;',
    );
  });

  it("keeps compact rows at fixed glyph and time geometry without horizontal overflow", () => {
    const row = ruleBody(".recent-session-activity__row");
    expect(row).toContain("grid-template-columns: 15px minmax(0, 1fr) 4em 14px");
    expect(row).toContain("min-height: 30px");
    expect(row).toContain("box-sizing: border-box");
    expect(row).toContain("width: 100%");
    expect(row).toContain("overflow: hidden");

    const glyph = ruleBody(".recent-session-activity__glyph");
    expect(glyph).toContain("width: 15px");
    expect(glyph).toContain("height: 15px");

    const summary = ruleBody(".recent-session-activity__summary");
    expect(summary).toContain("min-width: 0");
    expect(summary).toContain("white-space: nowrap");
    expect(summary).toContain("overflow: hidden");
    expect(summary).toContain("text-overflow: ellipsis");

    // DL-33.2 (amended 2026-08-26): the status mark is the rail's own 14px
    // box, centred in the track it was given rather than resting at the tab
    // row's trailing edge.
    const mark = ruleBody(".recent-session-activity__state > .asr-row__mark");
    expect(mark).toContain("justify-self: center");

    const time = ruleBody(".recent-session-activity__time");
    expect(time).toContain("width: 4em");
    expect(time).toContain("font-variant-numeric: tabular-nums");
    expect(time).toContain("text-align: right");
    expect(time).toContain("white-space: nowrap");
  });

  it("uses semantic tokens and non-layout hover treatment", () => {
    const row = ruleBody(".recent-session-activity__row");
    expect(row).toContain("background: transparent");
    expect(row).toContain("border: 0");
    expect(row).toContain("transition: background var(--duration) var(--ease)");
    expect(stylesheet).toContain(
      ".recent-session-activity__row:hover,\n.recent-session-activity__row:focus-visible {\n  background: var(--state-hover-bg);",
    );

    expect(recentRules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(recentRules).not.toMatch(/font-size:\s*\d/);
    expect(recentRules).not.toMatch(/\b(?:box-shadow|text-shadow)\s*:/);
    expect(recentRules).not.toMatch(/\b(?:filter|backdrop-filter)\s*:/);
    expect(recentRules).not.toMatch(/\b(?:rgba?|hsla?|oklch|color)\s*\(/i);

    const withoutSemanticTokens = recentRules.replace(/var\(--[a-z0-9-]+\)/gi, "");
    expect(withoutSemanticTokens).not.toMatch(
      /\btransition(?:-(?:duration|timing-function))?\s*:[^;]*(?:\d*\.?\d+(?:ms|s)\b|\b(?:linear|ease(?:-in|-out|-in-out)?|cubic-bezier|steps)\b)/i,
    );
  });

  it("keeps unavailable rows focusable without promising resume", () => {
    const unavailable = ruleBody(".recent-session-activity__row.is-unavailable");
    expect(unavailable).toContain("cursor: default");
    expect(stylesheet).toContain(
      ".recent-session-activity__row.is-unavailable:hover,\n.recent-session-activity__row.is-unavailable:focus-visible {\n  background: transparent;",
    );
    expect(stylesheet).toContain(
      ".recent-session-activity__row:focus-visible {\n  outline: 2px solid var(--accent);",
    );
    expect(stylesheet).toContain(
      ".recent-session-activity__row.is-unavailable .recent-session-activity__agent,\n.recent-session-activity__row.is-unavailable .recent-session-activity__summary {\n  color: var(--text-faint);",
    );
  });
});

describe("AgentRail cluster reorder (DL-27.20)", () => {
  const CLUSTER_HEIGHT = 60;

  /** jsdom lays nothing out, so every rect the drag reads is declared. */
  function stubRect(element: Element, top: number, height: number): void {
    element.getBoundingClientRect = () =>
      ({
        x: 0,
        y: top,
        top,
        bottom: top + height,
        left: 0,
        right: 240,
        width: 240,
        height,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  function pointer(type: string, y: number): PointerEvent {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: 20,
      clientY: y,
      button: 0,
    }) as unknown as PointerEvent;
    Object.defineProperty(event, "pointerId", { value: 1 });
    return event;
  }

  /**
   * The controller measures and paints once per animation frame, so a drag has
   * to be given one before it knows which slot it is over. The REAL
   * `requestAnimationFrame` is used rather than a stub: Preact's own signal
   * effects ride the same clock in this file, and replacing it would stall
   * them. The controller's callback was queued first, so it has already run by
   * the time this one resolves.
   */
  async function nextFrame(): Promise<void> {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  /** The list's own rect, kept clear of the auto-scroll band at both edges. */
  function stubGeometry(): void {
    stubRect(host.querySelector<HTMLElement>(".asr-rail__list")!, -200, 1000);
    for (const [index, cluster] of [
      ...host.querySelectorAll<HTMLElement>(".asr-cluster"),
    ].entries()) {
      stubRect(cluster, index * CLUSTER_HEIGHT, CLUSTER_HEIGHT);
    }
  }

  beforeEach(() => {
    // A second project git does not know, so the rail has two clusters to
    // reorder rather than one repository folding both worktrees.
    configureRepositoryClient({
      scan: async (path) =>
        path.startsWith("/r/") ? SCAN : { kind: "plain", reason: "no git here" },
    });
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/r/main", lastOpenedAt: 2 },
        { path: "/other", lastOpenedAt: 1 },
      ],
    };
    updateSettings({ railOrder: [] });
  });

  afterEach(async () => {
    updateSettings({ railOrder: [] });
    // A completed drag arms `swallowNextClick` (rail-cluster-drag.ts): a
    // capture-phase `click` listener on `window`, self-removed by a REAL
    // `setTimeout(0)` so a drop that produces no click does not stay armed
    // to eat an unrelated one later. `settle()` only flushes microtasks, so
    // without a real macrotask tick here that listener can survive into the
    // next test — this describe is the only one that ever completes a drag
    // — and swallow the first `click` it sees, which reads as that test's
    // press silently doing nothing. One real timer tick lets the listener
    // remove itself before any other test can observe it.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it("writes the dragged project's order key once, on the drop", async () => {
    mount();
    await settle();

    expect(
      [...host.querySelectorAll<HTMLElement>(".asr-cluster")].map(
        (cluster) => cluster.dataset.orderKey,
      ),
    ).toEqual(["/r/.git", "plain:/other"]);
    stubGeometry();

    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    act(() => {
      heads[1].dispatchEvent(pointer("pointerdown", 90));
      // Into the top half of the first cluster: the second project is dropped
      // above the first.
      window.dispatchEvent(pointer("pointermove", 20));
    });
    await nextFrame();
    act(() => {
      window.dispatchEvent(pointer("pointerup", 20));
    });

    // Only the dropped cluster is pinned — nothing sits above it — and the
    // project below keeps today's order (spec §6).
    expect(settings.value.railOrder).toEqual(["plain:/other"]);
    // What that list then DOES to the stream is asserted where it is decided,
    // in `rail-order.test.ts` and `agent-rail-model.test.ts` — this test owns
    // the write, and the write happens exactly once per drop.
  });

  it("writes nothing when the drop lands where the cluster started", async () => {
    mount();
    await settle();

    stubGeometry();

    const heads = host.querySelectorAll<HTMLElement>(".asr-cluster__head");
    act(() => {
      heads[1].dispatchEvent(pointer("pointerdown", 90));
      window.dispatchEvent(pointer("pointermove", 80));
    });
    await nextFrame();
    act(() => {
      window.dispatchEvent(pointer("pointerup", 80));
    });

    expect(settings.value.railOrder).toEqual([]);
  });
});

describe("AgentRail focused pane (DL-27.22, kept unchanged by the card — design §9.10)", () => {
  it("washes the row whose pane holds the keyboard and marks it aria-current", async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, agent: "claude", focused: false }),
          pane({ paneId: 12, agent: "codex", focused: true }),
        ],
      }),
    ];
    activeTabIndex.value = 0;
    mount();
    await settle();

    const listed = rows();
    expect(listed).toHaveLength(2);
    expect(listed[0].dataset.focused).toBe("false");
    expect(listed[1].dataset.focused).toBe("true");
    expect(listed[0].querySelector(".asr-card__hit")?.getAttribute("aria-current")).toBeNull();
    expect(listed[1].querySelector(".asr-card__hit")?.getAttribute("aria-current")).toBe("true");
  });

  it("marks no row of a tab that is not the active one", async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
      tab({
        key: 2,
        panes: [
          pane({ paneId: 21, agent: "claude", focused: true }),
          pane({ paneId: 22, agent: "codex" }),
        ],
      }),
    ];
    // Tab 1 is on the stage; tab 2 still has a focused pane of its own, and
    // lighting it would put two active rows in one rail. Both tabs default
    // to the same checkout, so all four panes sit in the one card.
    activeTabIndex.value = 0;
    mount();
    await settle();

    const listed = rows();
    // All four are drawn — otherwise the count below would pass vacuously.
    expect(listed).toHaveLength(4);
    expect(listed.filter((row) => row.dataset.focused === "true")).toHaveLength(0);
  });
});

describe("AgentRail paneModels wiring (Task 8)", () => {
  // The model no longer has a pill (DL-27.28, amended 2026-10-07); it rides in the row's
  // tooltip when the production rail passes one. Production passes none, because the
  // pane → session pairing is heuristic.
  it("withholds a heuristic model pairing from the production rail", async () => {
    tabViews.value = [tab({ panes: [pane({ paneId: 11, agent: "claude", phase: "working" })] })];
    // Write the model BEFORE mount so the first render already has it.
    paneModels.value = new Map([[11, "claude-sonnet-5"]]);
    mount();
    await settle();

    expect(host.querySelector(".asr-card__pill")).toBeNull();
    expect(host.querySelector(".asr-card__hit")?.getAttribute("title")).not.toContain(
      "claude-sonnet-5",
    );
  });

  it("shows no model for a pane not present in paneModels", async () => {
    tabViews.value = [tab({ panes: [pane({ paneId: 11, agent: "claude", phase: "working" })] })];
    // paneModels starts empty (set in beforeEach).
    mount();
    await settle();

    expect(host.querySelector(".asr-card__pill")).toBeNull();
  });
});

describe("AgentRail create row (DL-27.14, amended 2026-10-08)", () => {
  const verbs = (): string[] =>
    [...host.querySelectorAll(".rail-create__button")].map((button) => button.textContent ?? "");
  const verb = (name: string): HTMLButtonElement | null =>
    host.querySelector(`.rail-create__button[data-verb="${name}"]`);
  const launcher = vi.fn();
  const withLauncher: CardActions = { ...ACTIONS, onOpenAgentLauncher: launcher };

  beforeEach(() => {
    launcher.mockClear();
  });

  it("draws Agent last, closing the row outside the list", async () => {
    mount({ cardActions: withLauncher });
    await settle();

    expect(verbs().at(-1)).toBe("Agent");
    expect(host.querySelector(".asr-rail__list .rail-create")).toBeNull();
  });

  it("draws Folder, and omits Worktree when the host cannot create one (DL-19.7)", async () => {
    mount({ cardActions: withLauncher });
    await settle();

    expect(verbs()).toEqual(["Folder", "Agent"]);
  });

  it("opens the launch page on the focused checkout", async () => {
    mount({ cardActions: withLauncher });
    await settle();

    click(verb("agent"));

    expect(launcher).toHaveBeenCalledExactlyOnceWith("/r/main");
  });

  it("falls back to the active tab's workspace when no checkout is focused", async () => {
    tabViews.value = [tab({ workspacePath: "/r/side", panes: [pane({ focused: false })] })];
    activeTabIndex.value = 0;
    mount({ cardActions: withLauncher });
    await settle();

    click(verb("agent"));

    expect(launcher).toHaveBeenCalledExactlyOnceWith("/r/side");
  });

  it("opens the board with no workspace at all", async () => {
    const onOpenWorkspace = vi.fn();
    tabViews.value = [];
    mount({
      cardActions: withLauncher,
      legacy: { onOpenWorkspace, onResumeWorktree: NOOP },
    });
    await settle();

    click(verb("agent"));

    expect(launcher).not.toHaveBeenCalled();
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("disables Agent while a task operation is in flight", async () => {
    mount({
      cardActions: withLauncher,
      legacy: { onOpenWorkspace: NOOP, onResumeWorktree: NOOP, openWorkspaceDisabled: true },
    });
    await settle();

    expect(verb("agent")?.disabled).toBe(true);
  });

  it("starts the drag from Agent and from nothing else", async () => {
    const slotRects = vi.fn(() => []);
    const onDragStart = vi.fn();
    mount({ cardActions: withLauncher, newPaneDrop: { slotRects, onDragStart, onDrop: vi.fn() } });
    await settle();
    const pointer = (type: string, x: number): PointerEvent => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event as unknown as PointerEvent;
    };
    const drag = (button: HTMLButtonElement | null): void => {
      act(() => {
        button?.dispatchEvent(pointer("pointerdown", 0));
        window.dispatchEvent(pointer("pointermove", 40));
        window.dispatchEvent(pointer("pointerup", 40));
      });
    };

    drag(verb("agent"));
    expect(onDragStart).toHaveBeenCalledTimes(1);

    drag(verb("worktree"));
    drag(verb("folder"));
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});
