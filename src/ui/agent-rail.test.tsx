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
import { paneTails } from "../terminal/session-tail-store";
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

function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onClosePane={NOOP}
        onFocusPane={NOOP}
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
          onClosePane={NOOP}
          onFocusPane={NOOP}
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
  paneTails.value = new Map();
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
    // row out of its project, so the project is printed exactly once. An
    // unnamed multi-agent tab is HEADLESS (DL-27.13) — one item, no parent
    // row, every pane a leaf.
    expect(host.querySelector(".asr-block")).toBeNull();
    expect(host.querySelectorAll(".asr-stream .asr-item")).toHaveLength(1);
    expect(host.querySelectorAll(".asr-stream .asr-row--tab")).toHaveLength(0);
    expect(host.querySelectorAll(".asr-leaf")).toHaveLength(3);
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

    const listed = host.querySelectorAll<HTMLElement>(".asr-stream .asr-row--tab");
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

  it("focuses the exact pane behind a leaf row", async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount({ onFocusPane });
    await settle();

    // A multi-agent tab lists its panes as leaf rows (DL-27.13); each leaf is
    // the chip's contract at row width — press to focus that exact pane.
    // The press lands on the leaf's HIT LAYER since the close model gave the
    // row its own ✕ (2026-08-22): the leaf itself is a container now, the
    // same DL-27.1 shape `.asr-row--tab` has always had.
    const leaves = host.querySelectorAll<HTMLElement>(".asr-leaf");
    expect(leaves).toHaveLength(2);
    click(leaves[1].querySelector(".asr-leaf__hit"));
    expect(onFocusPane).toHaveBeenCalledWith(0, 12);
  });

  it("lists every pane of a multi-agent tab as a leaf, with no overflow count", async () => {
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

    // The chip budget and its `+N` died with the tree (DL-27.13): every agent
    // is a visible leaf, so there is nothing left to count or disclose.
    expect(host.querySelectorAll(".asr-leaf")).toHaveLength(4);
    expect(host.querySelector(".asr-chip--more")).toBeNull();
    expect(host.querySelector(".asr-chips")).toBeNull();
    expect(host.querySelector("button.asr-disclose")).toBeNull();
  });

  it("closes only that row's own agent from the hover action", async () => {
    // Close model (2026-08-22) table row 1: a row carrying ONE agent is an
    // agent row, and its ✕ closes that PANE — the same rule ⌘W follows. The
    // tab going with it is row 2's consequence, decided host-side by the tab's
    // real pane count, not by this control.
    const onCloseTab = vi.fn();
    const onClosePane = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onCloseTab, onClosePane });
    await settle();

    click(host.querySelector('[data-key="2"] .asr-row__action--close'));
    expect(onClosePane).toHaveBeenCalledWith(1, 21);
    expect(onClosePane).toHaveBeenCalledTimes(1);
    expect(onCloseTab).not.toHaveBeenCalled();
  });

  it("closes the TAB from a row that carries no agent", async () => {
    // A plain shell tab has no pane to name — `panes` holds agent panes only
    // (spec §9) — so its ✕ stays the tab's own.
    const onCloseTab = vi.fn();
    const onClosePane = vi.fn();
    tabViews.value = [tab({ key: 1, panes: [] })];
    mount({ onCloseTab, onClosePane });
    await settle();

    click(host.querySelector('[data-key="1"] .asr-row__action--close'));
    expect(onCloseTab).toHaveBeenCalledWith(0);
    expect(onClosePane).not.toHaveBeenCalled();
  });

  it("gives every leaf of a multi-agent tab its own close", async () => {
    // Table row 1 again, on the shape that had no close at all before: with
    // the pane tree hidden a multi-agent tab draws no parent row, so until the
    // close model the rail could not close one of its agents.
    const onClosePane = vi.fn();
    tabViews.value = [
      tab({
        key: 4,
        panes: [pane({ paneId: 41, agent: "claude" }), pane({ paneId: 42, agent: "codex" })],
      }),
    ];
    mount({ onClosePane });
    await settle();

    const closes = host.querySelectorAll<HTMLElement>(".asr-leaf .asr-row__action--close");
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

describe("AgentRail pane tree", () => {
  it("goes headless even for a NAMED multi-agent tab while the tree is hidden", async () => {
    // `PANE_TREE_HIDDEN` (owner, 2026-08-16, temporary): only agents and
    // projects show, so a named multi-agent tab also drops its parent row and
    // its panes stand as plain full-width rows. This test pins the temporary
    // state; when the constant flips back, a named tab regains its parent row
    // and the leaves become its siblings again (DL-27.13).
    tabViews.value = [
      tab({
        name: "pair",
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    const item = host.querySelector<HTMLElement>(".asr-item");
    expect(host.querySelectorAll(".asr-item")).toHaveLength(1);
    expect(item?.querySelector(".asr-row--tab")).toBeNull();
    const leaves = item?.querySelectorAll(":scope > .asr-leaf.asr-leaf--flat");
    expect(leaves).toHaveLength(2);
    // The old expanded-pane machinery stays dead: no disclosure, no nested
    // pane list.
    expect(host.querySelector(".asr-disclose")).toBeNull();
    expect(host.querySelector(".asr-panes")).toBeNull();
  });

  it("renders an unnamed multi-agent tab headless: no parent row at all", async () => {
    // With the count label gone the parent row held only its trailing meta,
    // and the owner ruled the empty stretch out (DL-27.13): the tree alone is
    // the tab. There is still no close for the TAB here — ⌘⇧W is what closes
    // a whole agent group (close model, table row 5) — but each leaf carries
    // its own agent's ✕ since 2026-08-22.
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    const item = host.querySelector<HTMLElement>(".asr-item");
    expect(item?.dataset.headless).toBe("true");
    expect(item?.querySelector(".asr-row--tab")).toBeNull();
    expect(item?.querySelectorAll(":scope > .asr-leaf")).toHaveLength(2);
    // Every close in this item belongs to a LEAF; none is the tab's.
    expect(item?.querySelectorAll(".asr-row__action--close")).toHaveLength(2);
    expect(item?.querySelectorAll(".asr-leaf .asr-row__action--close")).toHaveLength(2);
  });

  it("gives each flat leaf its own turn and its own status dot", async () => {
    // A leaf is a row in its own right, so it carries its PANE's state and
    // turn without dimming either one.
    tabViews.value = [
      tab({
        name: "pair",
        panes: [
          pane({ paneId: 11, agent: "claude", attention: "requested" }),
          pane({ paneId: 12, agent: "codex", phase: "working" }),
        ],
      }),
    ];
    paneTails.value = new Map([
      [11, "Permission needed: prisma migrate dev"],
      [12, "Running the suite"],
    ]);
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>(".asr-leaf")];
    expect(leaves.map((leaf) => leaf.dataset.quiet)).toEqual([undefined, undefined]);
    expect(
      leaves.map((leaf) => leaf.querySelector(".asr-row__mark")?.getAttribute("data-state")),
    ).toEqual(["asked", "working"]);
    expect(leaves.map((leaf) => leaf.querySelector(".asr-leaf__msg")?.textContent)).toEqual([
      "Permission needed: prisma migrate dev",
      "Running the suite",
    ]);
  });

  it("puts a leaf's turn where its agent name was, not on a second line", async () => {
    // DL-27.15 amended (2026-08-17): one line per row. The glyph beside the
    // turn is the agent's name, so the sentence takes that word's slot — and
    // a pane that has said nothing keeps the name rather than going blank.
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    paneTails.value = new Map([[11, "Wrote the migration"]]);
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>(".asr-leaf")];
    expect(leaves[0].querySelector(".asr-leaf__agent")).toBeNull();
    expect(leaves[0].querySelector(".asr-leaf__msg")?.textContent).toBe("Wrote the migration");
    expect(leaves[1].querySelector(".asr-leaf__agent")?.textContent).toBe("codex");
    expect(leaves[1].querySelector(".asr-leaf__msg")).toBeNull();
  });

  it("leaves a flat leaf with nothing to say showing its agent alone", async () => {
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    expect(host.querySelector(".asr-leaf__msg")).toBeNull();
    expect([...host.querySelectorAll(".asr-leaf__agent")].map((name) => name.textContent)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("puts the agent glyph before the tab name and age on the same line", async () => {
    tabViews.value = [
      tab({
        name: "api handoff",
        panes: [pane({ paneId: 11, agent: "claude", changedAt: 1_000 })],
      }),
    ];
    mount();
    await settle();

    const row = rows()[0];
    const directClasses = [...row.children].map((child) => child.className);
    expect(directClasses.indexOf("asr-chips")).toBeLessThan(directClasses.indexOf("asr-row__name"));
    expect(row.querySelector(".asr-row__age")?.parentElement).toBe(row);
  });

  it("gives every row that has a turn its sentence at full legibility", async () => {
    tabViews.value = [
      tab({
        key: 1,
        // A checked run: quiet. (`completed` is no longer quiet — it reads
        // as `asked` under the owner's 2026-08-16 merge.)
        panes: [pane({ paneId: 11, hasRun: true })],
      }),
      tab({
        key: 2,
        panes: [pane({ paneId: 21, attention: "requested" })],
      }),
    ];
    paneTails.value = new Map([
      [11, "Wrote the migration"],
      [21, "Permission needed: prisma migrate dev"],
    ]);
    mount();
    await settle();

    // Every row that has something to say says it, without state-based dimming.
    expect(rows()[0].querySelector(".asr-row__msg")?.textContent).toBe("Wrote the migration");
    expect(rows()[1].querySelector(".asr-row__msg")?.textContent).toBe(
      "Permission needed: prisma migrate dev",
    );
    expect(rows()[0].dataset.quiet).toBeUndefined();
    expect(rows()[1].dataset.quiet).toBeUndefined();
  });

  it("spends the row's one line on the turn, not on the agent's name", async () => {
    // The one-line amendment (2026-08-17): three `claude` rows in a project
    // were told apart by nothing but their sentence, which was also the text
    // being trimmed hardest. The glyph still says which agent this is.
    tabViews.value = [tab({ key: 1, panes: [pane({ paneId: 11 })] })];
    paneTails.value = new Map([[11, "Reading the rail model"]]);
    mount();
    await settle();

    expect(rows()[0].querySelector(".asr-row__name strong")).toBeNull();
    expect(rows()[0].querySelector(".asr-row__msg")?.textContent).toBe("Reading the rail model");
  });

  it("keeps a name the user typed even when its agent has spoken", async () => {
    // A derived label is a word the glyph or the cluster header already says;
    // a typed one exists nowhere else, so the turn follows it on the same
    // line instead of replacing it.
    tabViews.value = [tab({ key: 1, name: "release cut", panes: [pane({ paneId: 11 })] })];
    paneTails.value = new Map([[11, "Reading the rail model"]]);
    mount();
    await settle();

    expect(rows()[0].querySelector(".asr-row__name strong")?.textContent).toBe("release cut");
    expect(rows()[0].querySelector(".asr-row__msg")?.textContent).toBe("Reading the rail model");
  });

  it("falls back to the tab's own identity when nothing has been said", async () => {
    // Nobody renamed this tab and no session tail reaches it, so the row
    // spends its line on what the tab is: its one agent.
    tabViews.value = [tab({ key: 1, panes: [pane({ paneId: 11 })] })];
    mount();
    await settle();

    expect(rows()[0].querySelector(".asr-row__msg")).toBeNull();
    expect(rows()[0].querySelector(".asr-row__name strong")?.textContent).toBe("claude");
    expect(rows()[0].dataset.quiet).toBeUndefined();
  });

  it("lets a project header collapse and restore its tab rows", async () => {
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
    expect(rows()).toHaveLength(0);

    click(header);
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);
  });
});

describe("AgentRail clusters (DL-27.9/DL-27.12)", () => {
  it("puts a folder before the project name and the caret at the far edge", async () => {
    mount();
    await settle();

    // The collapse control, not the header row: since DL-27.18 the row also
    // carries the `+`, which stands OUTSIDE this button.
    const head = host.querySelector<HTMLElement>(".asr-cluster__toggle");
    expect([...(head?.children ?? [])].map((child) => child.className)).toEqual([
      "asr-cluster__folder",
      "asr-cluster__name",
      "asr-cluster__caret",
    ]);
    expect(
      head?.querySelector(".asr-cluster__folder > span")?.getAttribute("data-deck-icon-size"),
    ).toBe("15");
    expect(readFileSync("src/styles/01-tokens.css", "utf8")).toContain("--type-project: 13px");
    expect(readFileSync("src/styles/04a-agent-rail.css", "utf8")).toContain(
      "font: 560 var(--type-project)",
    );
  });

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
    expect([...rows()].map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "claude",
      "codex",
    ]);
    // The worktree suffix survives the change — it is the only thing telling
    // two tabs of one project apart.
    expect(rows()[1].querySelector(".asr-row__worktree")?.textContent).toBe("side");
  });

  it("keeps project → tab for a project with one tab", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__head")?.textContent).toBe("main");
    expect(rows()[0].querySelector("strong")?.textContent).toBe("claude");
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
    const asking = host.querySelector<HTMLElement>('.asr-stream .asr-row--tab[data-state="asked"]');
    expect(asking?.querySelector("strong")?.textContent).toBe("claude");
  });
});

describe("AgentRail project launcher (DL-27.18)", () => {
  it("opens the picker on the project the header belongs to", async () => {
    // `/r/side` is a WORKTREE of the same repository, so both tabs land in one
    // cluster — which is the point: one header, one launcher, and it answers
    // with the project's own path rather than with whichever tab is active.
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({
        key: 2,
        workspacePath: "/r/side",
        panes: [pane({ paneId: 21 })],
      }),
    ];
    const onNewTabIn = vi.fn();
    mount({ onNewTabIn });
    await settle();

    const adds = host.querySelectorAll<HTMLElement>("button.asr-cluster__add");
    expect(adds).toHaveLength(1);
    click(adds[0]);
    expect(onNewTabIn).toHaveBeenCalledWith("/r/main");
  });

  it("omits the launcher when the host cannot open one", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-cluster__add")).toBeNull();
    // The collapse control is untouched by its absence.
    expect(host.querySelector("button.asr-cluster__toggle")).not.toBeNull();
  });

  it("names the project in the launcher's accessible name", async () => {
    mount({ onNewTabIn: NOOP });
    await settle();

    expect(host.querySelector(".asr-cluster__add")?.getAttribute("aria-label")).toBe(
      "New tab in main",
    );
  });

  it("lays the launcher one slot inside the caret, on the rows' own edge", () => {
    // The re-amendment (2026-08-19): reading order is folder → name → `+` →
    // caret, expressed as a grid rather than as DOM order — the toggle spans
    // every track so its trailing caret keeps the outermost 17px slot, the
    // launcher is pinned into the track before it, and the caret reserves that
    // track from inside the button (7 + 17 = 24px). The box rule is the other
    // half of the alignment: `width: 100%` beside the padding had made the
    // header 11px wider than every row under it.
    const css = readFileSync("src/styles/04a-agent-rail.css", "utf8");
    const head = css.slice(
      css.indexOf(".asr-cluster__head {"),
      css.indexOf(".asr-cluster__toggle {"),
    );
    expect(head).toContain("box-sizing: border-box");
    expect(head).not.toContain("\n  width: 100%;");
    expect(head).toContain("grid-template-columns: minmax(0, 1fr) 17px 17px");
    expect(css).toContain("grid-column: 1 / -1");
    expect(css).toContain(
      ".asr-cluster__head:has(.asr-cluster__add) .asr-cluster__caret {\n  margin-left: 24px;",
    );
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

  it("offers the launcher on a remembered project", async () => {
    const onNewTabIn = vi.fn();
    mount({ onNewTabIn });
    await settle();

    const adds = host.querySelectorAll<HTMLElement>("button.asr-cluster__add");
    expect(adds).toHaveLength(2);
    click(adds[1]);
    expect(onNewTabIn).toHaveBeenCalledWith("/w/other");
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

  it("gives the live close the caret's own slot (DL-27.21)", () => {
    // The header's trailing 17px track is the rows' glyph column restated, and
    // the close swaps into it exactly as DL-27.5's row close swaps into the
    // glyph — no fourth track, so nothing moves off the rows' own columns.
    const css = readFileSync("src/styles/04a-agent-rail.css", "utf8");
    expect(css).toContain(
      ".asr-cluster:hover .asr-cluster__head:has(.asr-cluster__remove--live) .asr-cluster__caret,",
    );
    expect(css).toContain(
      ".asr-cluster__head:has(.asr-cluster__remove--live:focus-visible) .asr-cluster__caret {",
    );
    // Still three tracks.
    const head = css.slice(
      css.indexOf(".asr-cluster__head {"),
      css.indexOf(".asr-cluster__toggle {"),
    );
    expect(head).toContain("grid-template-columns: minmax(0, 1fr) 17px 17px");
  });
});

describe("AgentRail state wording (DL-27.2)", () => {
  it("puts status first and the agent glyph last in every agent row", async () => {
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: "claude" }), pane({ paneId: 12, agent: "codex" })],
      }),
    ];
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>(".asr-leaf")];
    expect(leaves).toHaveLength(2);
    for (const leaf of leaves) {
      // The hit layer is first in DOM order and paints under everything
      // (DL-27.1); the READING order the rule is about starts after it.
      expect(leaf.firstElementChild?.classList.contains("asr-leaf__hit")).toBe(true);
      const drawn = [...leaf.children].filter(
        (child) => !child.classList.contains("asr-leaf__hit"),
      );
      expect(drawn[0].classList.contains("asr-row__mark")).toBe(true);
      // The glyph still ends the row. The close that follows it in the DOM is
      // absolutely positioned OVER that same slot (DL-27.5's swap), so it adds
      // nothing to the line.
      // Index math, not `Array.at`: this repo's `lib` is ES2020 and `.at`
      // arrived in ES2022, so it is a typecheck error rather than a runtime one.
      expect(drawn[drawn.length - 2].classList.contains("asr-leaf__logo")).toBe(true);
      expect(drawn[drawn.length - 1].classList.contains("asr-leaf__actions")).toBe(true);
    }

    tabViews.value = [tab()];
    await settle();
    const row = rows()[0];
    expect([...row.children].map((child) => child.className)).toEqual([
      "asr-row__hit",
      "asr-row__mark",
      "asr-chips",
      "asr-row__name",
      "asr-row__age",
      "asr-row__actions",
    ]);

    const rowStyles = readFileSync("src/styles/04b-agent-rail-rows.css", "utf8");
    expect(rowStyles).toContain("grid-template-columns: 17px minmax(0, 1fr) auto 17px");
    expect(rowStyles).toContain(
      ".asr-row--tab > .asr-row__mark {\n  grid-row: 1;\n  grid-column: 1",
    );
    expect(rowStyles).toContain(".asr-row--tab > .asr-chips {\n  grid-row: 1;\n  grid-column: 4");
  });

  it("keeps the status word out of the row while title and aria still say it", async () => {
    tabViews.value = [tab({ panes: [pane({ attention: "error" })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("failed");
    // The mark is the fast read; the word is never painted in the row.
    expect(row.textContent).not.toContain("failed");
    expect(row.querySelector(".asr-row__mark")?.getAttribute("data-state")).toBe("failed");

    const hit = row.querySelector<HTMLElement>(".asr-row__hit");
    expect(hit?.getAttribute("aria-label")).toContain("failed");
    expect(hit?.getAttribute("title")).toContain("failed");
  });

  it.each([
    {
      name: "working",
      pane: pane({ phase: "working" }),
      mark: "working",
    },
    {
      name: "done",
      pane: pane({ hasRun: true }),
      mark: "done",
    },
    {
      name: "idle",
      pane: pane(),
      mark: "idle",
    },
  ])(
    "keeps $name fully legible with only its visible status dot",
    async ({ pane: paneView, mark }) => {
      tabViews.value = [tab({ panes: [paneView] })];
      mount();
      await settle();

      const row = rows()[0];
      expect(row.dataset.quiet).toBeUndefined();
      expect(row.querySelector(".asr-row__mark")).not.toBeNull();
      expect(row.querySelector(".asr-row__mark")?.getAttribute("data-state") ?? null).toBe(mark);
    },
  );

  it("turns the working mark into the shared working ring", async () => {
    // The one state that changes on its own is the one that moves: a still
    // dot said the opposite. `WorkspaceSpinner` is reused rather than redrawn,
    // so its `wschase` ink cycle and reduced-motion rule come along.
    tabViews.value = [tab({ panes: [pane({ phase: "working" })] })];
    mount();
    await settle();

    const mark = rows()[0].querySelector(".asr-row__mark");
    expect(mark?.classList.contains("asr-row__mark--spinner")).toBe(true);
    expect(mark?.querySelector("svg.wsitem__spinner")).not.toBeNull();
  });
});

describe("AgentRail live-only contract", () => {
  it("does not paint a workspace that exists only in history", async () => {
    sessionArchive.value = { "/r/side": { savedAt: 1, tabs: [] } };
    mount();
    await settle();

    expect(host.querySelector(".asr-row--archived")).toBeNull();
  });

  it("draws a tab that runs no agent with a terminal glyph and no message line", async () => {
    // The rail is the sidebar's only list, so a shell-only tab it declines to
    // draw is a tab the user cannot reach from there. `voice` is null here and
    // every agent-shaped part of the row has to stand down on its own.
    tabViews.value = [tab({ panes: [pane({ agent: null })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe("idle");
    expect(row.querySelector(".asr-row__msg")).toBeNull();
    // The glyph slot is filled by the terminal mark rather than left empty:
    // the strip's chip has said the same thing for a shell since DL-18.10.
    expect(row.querySelector(".asr-chip--static")).not.toBeNull();
    expect(row.querySelector(".asr-chip__logo")).toBeNull();
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

  it("keeps the row's identity dataset on the row element", async () => {
    mount();
    await settle();

    expect(rows()[0].dataset.key).toBe("1");
  });

  it("drops the active wash while a browser surface holds the stage", async () => {
    // DL-27.8: the wash is carried by the ITEM, not by the row inside it.
    // Asserted on the wrapper for that reason.
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

  it("contains live project rows only; New belongs to the frame", async () => {
    mount();
    await settle();

    expect(host.querySelector(".asr-openrow, .asr-open")).toBeNull();
    expect(host.querySelector(".asr-stream")?.firstElementChild).not.toBeNull();
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

  afterEach(() => {
    updateSettings({ railOrder: [] });
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

describe("AgentRail focused pane (DL-27.22)", () => {
  it("washes the leaf whose pane holds the keyboard and marks it aria-current", async () => {
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

    const leaves = host.querySelectorAll<HTMLElement>(".asr-leaf");
    expect(leaves).toHaveLength(2);
    expect(leaves[0].dataset.focused).toBe("false");
    expect(leaves[1].dataset.focused).toBe("true");
    expect(leaves[0].querySelector(".asr-leaf__hit")?.getAttribute("aria-current")).toBeNull();
    expect(leaves[1].querySelector(".asr-leaf__hit")?.getAttribute("aria-current")).toBe("true");
  });

  it("marks no leaf of a tab that is not the active one", async () => {
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
    // lighting it would put two active rows in one rail.
    activeTabIndex.value = 0;
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>(".asr-leaf")];
    // Both tabs are drawn — otherwise the count below would pass vacuously.
    expect(leaves).toHaveLength(4);
    expect(leaves.filter((leaf) => leaf.dataset.focused === "true")).toHaveLength(0);
  });
});
