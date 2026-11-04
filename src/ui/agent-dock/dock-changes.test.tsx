// @vitest-environment jsdom
import { signal } from "@preact/signals";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The section's import graph reaches the host (repository scans, settings): stub it as the dock's
// own tests do, and never let a test start a real scan.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
// The file menu copies a path and hands one to an installed app: both are observed, not run.
vi.mock("../../host/shell-host", async () => {
  const actual =
    await vi.importActual<typeof import("../../host/shell-host")>("../../host/shell-host");
  return { ...actual, writeText: vi.fn(async () => {}) };
});
vi.mock("../../host/external-apps-host", async () => {
  const actual = await vi.importActual<typeof import("../../host/external-apps-host")>(
    "../../host/external-apps-host",
  );
  return { ...actual, available: true, openInApp: vi.fn(async () => {}) };
});
vi.mock("../../repositories/repositories-store", async () => {
  const actual = await vi.importActual<typeof import("../../repositories/repositories-store")>(
    "../../repositories/repositories-store",
  );
  return { ...actual, ensureRepositoriesScanned: vi.fn() };
});

import type { ChangeEntry, ChangesSnapshot } from "../../host/git-changes-host";
import type { ChangesController, ChangesState } from "../../files/changes/changes-controller";
import { diffFocusRequested } from "../../files/changes/diff-column-focus";
import type { DiffSidesPorts } from "../../files/changes/diff-sides";
import { createDiffSelection, type DiffSelectionStore } from "../../files/changes/diff-selection";
import { repositoryScans } from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import { tabViews, type TabView } from "../../terminal/tabs-store";
import { openInApp } from "../../host/external-apps-host";
import { writeText } from "../../host/shell-host";
import { installedExternalApps } from "../../links/external-apps-store";
import { resetFileSurfaces, surfaceFor } from "../../files/file-surface-store";
import { byRole, click, mount, press, settle, waitUntil } from "../controls/preset-test-kit";
import { dockChangesList, dockSurface, resetAgentDockState, setDockView } from "./agent-dock-state";
import { DockChanges } from "./dock-changes";
import { testFileBodies } from "./dock-files-test-kit";
import { changedFileCount, DockChangesWatch } from "./dock-changes-watch";

const ROOT = "/work/repo";

const entry = (over: Partial<ChangeEntry> & Pick<ChangeEntry, "path">): ChangeEntry => ({
  status: "modified",
  oldPath: null,
  added: 2,
  removed: 1,
  binary: false,
  counted: true,
  ...over,
});

const ENTRIES: ChangeEntry[] = [
  entry({ path: "src/ui/a.ts", added: 5, removed: 2 }),
  entry({ path: "src/ui/deep/b.ts", added: 3, removed: 1 }),
  entry({ path: "src/lib/c.ts", status: "added", added: 10, removed: 0 }),
  entry({ path: "old.txt", status: "deleted", added: 0, removed: 9 }),
  entry({ path: "img.png", status: "added", added: 0, removed: 0, binary: true }),
  entry({ path: "scratch.txt", status: "untracked", added: 7, removed: 0 }),
];

function snapshot(entries: ChangeEntry[], over: Partial<ChangesSnapshot> = {}): ChangesSnapshot {
  return {
    kind: "changes",
    branch: "feat/x",
    detached: false,
    oid: null,
    initial: false,
    entries,
    omitted: 0,
    totals: {
      added: entries.reduce((sum, item) => sum + item.added, 0),
      removed: entries.reduce((sum, item) => sum + item.removed, 0),
    },
    ...over,
  };
}

let diff: DiffSelectionStore;

function fakeChanges(initial: Partial<ChangesState> = {}) {
  const state = signal<ChangesState>({
    root: ROOT,
    snapshot: snapshot(ENTRIES),
    failure: null,
    reading: false,
    ...initial,
  });
  const controller: ChangesController = {
    state,
    readCount: signal(1),
    setShown: vi.fn(),
    setWindowVisible: vi.fn(),
    trigger: vi.fn(),
    turnEnded: vi.fn(),
    dispose: vi.fn(),
  };
  diff = createDiffSelection(state);
  return { controller, state };
}

/** What `AgentDock` mounts for Changes: the watch beside the section. */
const files = testFileBodies().controller;
/** Both sides read as one-line files: the cards load, the tests here look at the list. */
const ports: DiffSidesPorts = {
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 4 })),
  readFile: async () => ({
    kind: "ok",
    content: "new\n",
    eol: "lf",
    encoding: "utf-8",
    bytes: 4,
    mixedEol: false,
    readOnly: false,
    reason: null,
    mtimeMs: 1,
    size: 4,
    writable: true,
  }),
  readHeadFile: async () => ({
    kind: "ok",
    content: "old\n",
    eol: "lf",
    encoding: "utf-8",
    bytes: 4,
    mixedEol: false,
  }),
};
const section = (controller: ChangesController, root: string | null = ROOT) => (
  <>
    <DockChangesWatch root={root} changes={controller} diff={diff} />
    <DockChanges root={root} changes={controller} controller={files} ports={ports} />
  </>
);

const row = (key: string): HTMLElement =>
  document.body.querySelector(`[data-change-row="${key}"]`) as HTMLElement;
const rowKeys = (): (string | null)[] =>
  [...document.body.querySelectorAll("[data-change-row]")].map((r) =>
    r.getAttribute("data-change-row"),
  );
const text = (): string => document.body.textContent ?? "";
const foldButton = (path: string): HTMLElement =>
  document.body.querySelector(`[data-card-path="${path}"] button[aria-expanded]`) as HTMLElement;
const flashed = (): (string | null)[] =>
  [...document.body.querySelectorAll("[data-flash]")].map((card) =>
    card.getAttribute("data-card-path"),
  );
const squash = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ");

/** Resize the window the way the browser reports it: the column's tree is a wide-window thing. */
function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  resizeTo(1440);
  resetAgentDockState();
  // The list pane is off by default; most of this file looks at the list.
  dockChangesList.value = true;
  repositoryScans.value = new Map();
  diffFocusRequested.value = false;
});

afterEach(() => {
  resizeTo(1024);
  vi.unstubAllGlobals();
  repositoryScans.value = new Map();
  resetAgentDockState();
  resetFileSurfaces();
});

describe("the Changes view's tree", () => {
  it("counts the changed files for the handle", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(changedFileCount(ROOT, controller)).toBe(6);
    expect(squash(document.body.textContent)).not.toContain("Changes");
    await view.unmount();
  });

  it("shows the scope and the totals in one toolbar row, in the UI face", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    const bar = (document.body.querySelector('[aria-label="Refresh changes"]') as HTMLElement)
      .parentElement as HTMLElement;
    expect(squash(bar.textContent)).toBe("Uncommitted6 files +25 −12");
    expect(bar.querySelector(".font-mono")).toBeNull();
    await view.unmount();
  });

  it("sets names in the UI face, not mono", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(row("file:src/lib/c.ts").querySelector(".font-mono:not([role])")).toBeNull();
    expect(row("folder:src").querySelector(".font-mono")).toBeNull();
    await view.unmount();
  });

  it("shows a folder's file count only while it is closed, and folds a lone chain into one row", async () => {
    const { controller } = fakeChanges({
      snapshot: snapshot([
        entry({ path: "src/ui/a.ts", added: 5, removed: 2 }),
        entry({ path: "src/ui/deep/b.ts", added: 3, removed: 1 }),
        entry({ path: "src/lib/c.ts", added: 10, removed: 0 }),
        entry({ path: "pkg/inner/only/d.ts", added: 1, removed: 1 }),
      ]),
    });
    const view = await mount(section(controller));
    expect(squash(row("folder:src").textContent)).toBe("src");
    expect(squash(row("folder:src/ui").textContent)).toBe("ui");
    // `pkg/inner/only` holds nothing but one folder at each step, so it is one row.
    expect(squash(row("folder:pkg/inner/only").textContent)).toBe("pkg/inner/only");
    expect(row("folder:pkg")).toBeNull();

    await click(row("folder:src/ui"));
    const count = row("folder:src/ui").lastElementChild as HTMLElement;
    expect(squash(row("folder:src/ui").textContent)).toBe("ui2");
    expect(count.className).toContain("text-muted-foreground");
    expect(count.className).toContain("tabular-nums");
    await click(row("folder:src"));
    expect(squash(row("folder:src").textContent)).toBe("src3");
    await view.unmount();
  });

  it("lists names only: no line counts and no binary label on any row", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    const pane = document.body.querySelector('[aria-label="Changed files"]') as HTMLElement;
    expect(pane.textContent).not.toMatch(/[+−]\d/);
    expect(row("file:img.png").textContent).not.toContain("binary");
    await view.unmount();
  });

  it("names each file's status for assistive technology, shows no letter, and strikes a deleted one", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    const status = (key: string) => row(key).querySelector(".sr-only")?.textContent?.trim();
    expect(status("file:old.txt")).toBe("(Deleted)");
    expect(status("file:scratch.txt")).toBe("(Untracked)");
    expect(status("file:img.png")).toBe("(Added)");
    expect(row("file:old.txt").querySelector('[role="img"]')).toBeNull();
    expect(row("file:old.txt").querySelector(".line-through")).not.toBeNull();
    await view.unmount();
  });

  it("names a rename's old path for assistive technology", async () => {
    const { controller } = fakeChanges({
      snapshot: snapshot([entry({ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" })]),
    });
    const view = await mount(section(controller));
    expect(row("file:src/new.ts").textContent).toContain("(from src/old.ts)");
    await view.unmount();
  });

  it("collapses and expands a folder, hiding what is under it", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(rowKeys()).toContain("file:src/ui/a.ts");
    expect(row("folder:src/ui").getAttribute("aria-expanded")).toBe("true");

    await click(row("folder:src/ui"));
    expect(row("folder:src/ui").getAttribute("aria-expanded")).toBe("false");
    expect(rowKeys()).not.toContain("file:src/ui/a.ts");
    expect(rowKeys()).not.toContain("folder:src/ui/deep");
    expect(rowKeys()).toContain("file:src/lib/c.ts");

    await click(row("folder:src/ui"));
    expect(rowKeys()).toContain("file:src/ui/a.ts");
    await view.unmount();
  });
});

describe("the list pane", () => {
  /** The body's ResizeObserver; `widen` reports a new width, as a dock resize does. */
  let widen: (width: number) => Promise<void> = async () => {};
  function observeWidth(width: number): void {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: (entries: unknown[]) => void) {
          widen = async (next) => {
            await act(async () => this.callback([{ contentRect: { width: next, height: 400 } }]));
          };
        }
        observe(): void {
          this.callback([{ contentRect: { width, height: 400 } }]);
        }
        disconnect(): void {}
      },
    );
  }
  const toggle = (): HTMLElement | null =>
    document.body.querySelector<HTMLElement>('[aria-label$="file navigation"]');

  it("is off by default: the stack fills the body and no list shows", async () => {
    dockChangesList.value = false;
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(rowKeys()).toEqual([]);
    expect(document.body.querySelectorAll("[data-card-path]")).toHaveLength(ENTRIES.length);
    expect(toggle()?.getAttribute("aria-label")).toBe("Show file navigation");
    await click(toggle() as HTMLElement);
    expect(rowKeys()).toContain("file:src/ui/a.ts");
    expect(toggle()?.getAttribute("aria-label")).toBe("Hide file navigation");
    await view.unmount();
  });

  it("has no toggle and no list below 560px, and the choice returns when the dock widens", async () => {
    observeWidth(559);
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(toggle()).toBeNull();
    expect(rowKeys()).toEqual([]);
    expect(document.body.querySelectorAll("[data-card-path]")).toHaveLength(ENTRIES.length);
    expect(dockChangesList.value).toBe(true);

    await widen(560);
    expect(toggle()?.getAttribute("aria-label")).toBe("Hide file navigation");
    expect(rowKeys()).toContain("file:src/ui/a.ts");
    await view.unmount();
  });

  it("unfolds, scrolls to and flashes a pressed file's card, then leaves no mark and opens nothing", async () => {
    const scrolled: (string | undefined)[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.cardPath);
    };
    const openFile = vi.spyOn(files, "openFile");
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(foldButton("src/lib/c.ts"));
    expect(foldButton("src/lib/c.ts").getAttribute("aria-expanded")).toBe("false");
    const before = [...document.body.querySelectorAll("[data-card-path]")];

    await click(row("file:src/lib/c.ts"));
    expect(foldButton("src/lib/c.ts").getAttribute("aria-expanded")).toBe("true");
    expect(scrolled).toEqual(["src/lib/c.ts"]);
    expect(flashed()).toEqual(["src/lib/c.ts"]);
    // The press re-mounts no card: the stack keeps its nodes, and with them its scroll.
    const after = [...document.body.querySelectorAll("[data-card-path]")];
    expect(after.every((card, index) => card === before[index])).toBe(true);
    expect(row("file:src/lib/c.ts").hasAttribute("aria-current")).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    expect(diff.selection.value).toBeNull();
    expect(diffFocusRequested.value).toBe(false);

    await waitUntil(() => flashed().length === 0, 2500);
    Element.prototype.scrollIntoView = original;
    openFile.mockRestore();
    await view.unmount();
  });

  it("moves the flash to the newest press", async () => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn();
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(row("file:src/lib/c.ts"));
    await click(row("file:old.txt"));
    expect(flashed()).toEqual(["old.txt"]);
    Element.prototype.scrollIntoView = original;
    await view.unmount();
  });

  it("forgets a fold when a refresh drops the file, so the file comes back unfolded", async () => {
    const { controller, state } = fakeChanges();
    const view = await mount(section(controller));
    await click(foldButton("src/lib/c.ts"));
    await click(foldButton("src/ui/a.ts"));
    const without = ENTRIES.filter((item) => item.path !== "src/lib/c.ts");
    await act(async () => {
      state.value = { ...state.value, snapshot: snapshot(without) };
    });
    await act(async () => {
      state.value = { ...state.value, snapshot: snapshot(ENTRIES) };
    });
    expect(foldButton("src/lib/c.ts").getAttribute("aria-expanded")).toBe("true");
    // A file every read kept keeps its fold.
    expect(foldButton("src/ui/a.ts").getAttribute("aria-expanded")).toBe("false");
    await view.unmount();
  });
});

describe("the diff column stays out of the dock's Changes view", () => {
  it("ends an open diff when another view is selected, as leaving the legacy Changes view does", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    diff.open(ROOT, "src/ui/a.ts");
    expect(diff.selection.value).not.toBeNull();
    await act(async () => setDockView("usage"));
    expect(diff.selection.value).toBeNull();
    await view.unmount();
  });

  it("ends the diff when the root moves to another checkout", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    diff.open(ROOT, "src/ui/a.ts");
    await view.update(section(controller, "/work/side"));
    expect(diff.selection.value).toBeNull();
    await view.unmount();
  });

  it("ends the diff when the view unmounts: a closed dock, or a closed sheet", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    diff.open(ROOT, "src/ui/a.ts");
    await view.unmount();
    expect(diff.selection.value).toBeNull();
  });
});

describe("what the view watches", () => {
  it("watches the root while mounted, selected or not, and releases it on unmount", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(controller.setShown).toHaveBeenLastCalledWith(ROOT);
    await act(async () => setDockView("usage"));
    // Another view is selected: the count on the handle stays live.
    expect(controller.setShown).not.toHaveBeenCalledWith(null);
    expect(changedFileCount(ROOT, controller)).toBe(6);
    await view.unmount();
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
  });

  it("moves the watch with the root", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await view.update(section(controller, "/work/side"));
    expect(controller.setShown).toHaveBeenLastCalledWith("/work/side");
    await view.unmount();
  });

  it("asks the controller to read again on Refresh", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(document.body.querySelector('[aria-label="Refresh changes"]') as HTMLElement);
    expect(controller.trigger).toHaveBeenCalledWith("refresh");
    await view.unmount();
  });
});

describe("the turn-end refresh", () => {
  const repository = (key: string): RepositoryScan => ({
    kind: "repository",
    key,
    root: "/x",
    worktrees: [],
  });
  const tab = (workspacePath: string, phase: "working" | "idle"): TabView =>
    ({ key: 1, workspacePath, panes: [{ paneId: 1, phase }] }) as unknown as TabView;
  const endTurn = async (workspacePath: string): Promise<void> => {
    await act(async () => {
      tabViews.value = [tab(workspacePath, "working")];
    });
    await act(async () => {
      tabViews.value = [tab(workspacePath, "idle")];
    });
  };

  beforeEach(() => {
    repositoryScans.value = new Map([
      [ROOT, repository("/repo/.git")],
      ["/work/side", repository("/repo/.git")],
      ["/work/other", repository("/other/.git")],
    ]);
    tabViews.value = [];
  });
  afterEach(() => {
    tabViews.value = [];
  });

  it("reads again when a turn ends in the root's own folder", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await endTurn(ROOT);
    expect(controller.trigger).toHaveBeenCalledWith("turn-end");
    await view.unmount();
  });

  it("reads again when a turn ends in another checkout of the same repository", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await endTurn("/work/side");
    expect(controller.trigger).toHaveBeenCalledWith("turn-end");
    await view.unmount();
  });

  it("does not read for a turn in another repository, or when nothing is watched", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await endTurn("/work/other");
    expect(controller.trigger).not.toHaveBeenCalled();
    await view.unmount();

    const idle = fakeChanges();
    const plain = await mount(section(idle.controller, null));
    await endTurn(ROOT);
    expect(idle.controller.trigger).not.toHaveBeenCalled();
    await plain.unmount();
  });
});

describe("empty, loading and error states", () => {
  it("says it is reading until the first reply", async () => {
    const { controller } = fakeChanges({ snapshot: null, reading: true });
    const view = await mount(section(controller));
    expect(text()).toContain("Reading changes…");
    await view.unmount();
  });

  it("says there is nothing against HEAD, or no files yet on an unborn branch", async () => {
    const { controller, state } = fakeChanges({ snapshot: snapshot([]) });
    const view = await mount(section(controller));
    expect(text()).toContain("No changes against HEAD.");
    await act(async () => {
      state.value = { ...state.value, snapshot: snapshot([], { initial: true }) };
    });
    expect(text()).toContain("No files yet.");
    await view.unmount();
  });

  it("prints a failed read under a status line and keeps the last list", async () => {
    const { controller } = fakeChanges({
      failure: { kind: "timeout", message: "git took too long" },
    });
    const view = await mount(section(controller));
    const line = [...document.body.querySelectorAll('[role="status"]')].find((p) =>
      p.textContent?.includes("git took too long"),
    );
    expect(line).not.toBeUndefined();
    expect(rowKeys()).toContain("file:old.txt");
    await view.unmount();
  });

  it("says how many changes are not shown", async () => {
    const { controller } = fakeChanges({ snapshot: snapshot(ENTRIES, { omitted: 3 }) });
    const view = await mount(section(controller));
    expect(text()).toContain("3 more changes are not shown");
    await view.unmount();
  });

  it("says a folder is not a repository, and watches nothing", async () => {
    repositoryScans.value = new Map([[ROOT, { kind: "plain", reason: "not a git repository" }]]);
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(text()).toContain("Not a git repository");
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
    expect(rowKeys()).toEqual([]);
    await view.unmount();
  });

  it("says the tab has no workspace when there is no root", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller, null));
    expect(text()).toContain("This tab has no workspace to show.");
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
    await view.unmount();
  });
});

describe("the keyboard", () => {
  const tabStops = (): (string | null)[] =>
    [...document.body.querySelectorAll<HTMLElement>("[data-change-row]")]
      .filter((r) => r.tabIndex === 0)
      .map((r) => r.getAttribute("data-change-row"));

  it("leaves one row as the Tab stop and walks the rest with the arrow keys", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(tabStops()).toEqual(["folder:src"]);

    row("folder:src").focus();
    await press(row("folder:src"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("folder:src/lib"));
    expect(tabStops()).toEqual(["folder:src/lib"]);

    await press(row("folder:src/lib"), { key: "End" });
    expect(document.activeElement).toBe(row("file:scratch.txt"));
    await press(row("file:scratch.txt"), { key: "Home" });
    expect(document.activeElement).toBe(row("folder:src"));
    await press(row("folder:src"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("folder:src"));
    await view.unmount();
  });

  it("collapses and expands a folder with Left and Right", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    row("folder:src/ui").focus();
    await press(row("folder:src/ui"), { key: "ArrowLeft" });
    expect(row("folder:src/ui").getAttribute("aria-expanded")).toBe("false");
    await press(row("folder:src/ui"), { key: "ArrowRight" });
    expect(row("folder:src/ui").getAttribute("aria-expanded")).toBe("true");
    await view.unmount();
  });
});

describe("opening a file from its card", () => {
  const header = (path: string): HTMLElement =>
    document.body.querySelector(`[data-card-path="${path}"] .sticky`) as HTMLElement;

  it("keeps Changes on screen for a path press, through the window's real file controller", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(
      header("src/lib/c.ts").querySelector('button[title="src/lib/c.ts"]') as HTMLElement,
    );
    await settle();
    expect(dockSurface.value).toBe("view");
    expect(document.body.querySelectorAll("[data-card-path]")).toHaveLength(ENTRIES.length);
    expect(surfaceFor(ROOT).tabs).toEqual([
      expect.objectContaining({ path: `${ROOT}/src/lib/c.ts`, preview: true }),
    ]);
    await view.unmount();
  });

  it("shows the file for the open icon and the menu's Open", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(header("src/lib/c.ts").querySelector('[aria-label="Open in File"]') as HTMLElement);
    await settle();
    expect(dockSurface.value).toBe("file");
    expect(surfaceFor(ROOT).tabs).toEqual([
      expect.objectContaining({ path: `${ROOT}/src/lib/c.ts`, preview: false }),
    ]);
    await view.unmount();
  });
});

describe("a changed file's menu", () => {
  const menuItems = (): string[] =>
    [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (item) => item.textContent ?? "",
    );
  async function rightClick(target: HTMLElement): Promise<void> {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    await waitUntil(() => byRole("menu") !== null);
  }
  const pick = (label: string): Promise<void> =>
    click(
      [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === label,
      ) as HTMLElement,
    );

  beforeEach(() => {
    vi.mocked(writeText).mockClear();
    vi.mocked(openInApp).mockClear();
    installedExternalApps.value = [
      { id: "cursor", label: "Cursor", group: "editor", iconDataUrl: null },
      { id: "finder", label: "Finder", group: "files", iconDataUrl: null },
    ];
  });
  afterEach(() => {
    installedExternalApps.value = [];
  });

  it("offers open, reveal, an editor and copy on a row, and copies the absolute path", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await rightClick(row("file:src/lib/c.ts"));
    expect(menuItems()).toEqual(["Open", "Reveal in Finder", "Open with", "Copy path"]);
    await pick("Copy path");
    expect(writeText).toHaveBeenCalledWith(`${ROOT}/src/lib/c.ts`);
    await view.unmount();
  });

  it("reveals the file in the installed files app", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await rightClick(row("file:src/lib/c.ts"));
    await pick("Reveal in Finder");
    expect(openInApp).toHaveBeenCalledWith({
      appId: "finder",
      path: `${ROOT}/src/lib/c.ts`,
      isDirectory: false,
      line: 1,
      column: 1,
    });
    await view.unmount();
  });

  it("leaves out what this machine does not have", async () => {
    installedExternalApps.value = [];
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await rightClick(row("file:src/lib/c.ts"));
    expect(menuItems()).toEqual(["Open", "Copy path"]);
    await view.unmount();
  });

  it("offers only the path for a deleted file, which has nothing to open", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await rightClick(row("file:old.txt"));
    expect(menuItems()).toEqual(["Copy path"]);
    await view.unmount();
  });

  it("opens from a card header as well as from a row", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    const header = document.body.querySelector(
      '[data-card-path="src/lib/c.ts"] .sticky',
    ) as HTMLElement;
    await rightClick(header);
    expect(menuItems()).toContain("Copy path");
    await view.unmount();
  });
});
