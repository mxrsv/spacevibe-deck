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
vi.mock("../../repositories/repositories-store", async () => {
  const actual = await vi.importActual<typeof import("../../repositories/repositories-store")>(
    "../../repositories/repositories-store",
  );
  return { ...actual, ensureRepositoriesScanned: vi.fn() };
});

import type { ChangeEntry, ChangesSnapshot } from "../../host/git-changes-host";
import type { ChangesController, ChangesState } from "../../files/changes/changes-controller";
import { diffFocusRequested } from "../../files/changes/diff-column-focus";
import { createDiffSelection, type DiffSelectionStore } from "../../files/changes/diff-selection";
import { repositoryScans } from "../../repositories/repositories-store";
import type { RepositoryScan } from "../../repositories/repository-client";
import { tabViews, type TabView } from "../../terminal/tabs-store";
import { click, mount, press } from "../controls/preset-test-kit";
import { resetAgentDockState } from "./agent-dock-state";
import { DockChanges } from "./dock-changes";
import { DockChangesWatch } from "./dock-changes-watch";

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
const section = (controller: ChangesController, root: string | null = ROOT) => (
  <>
    <DockChangesWatch root={root} changes={controller} diff={diff} />
    <DockChanges root={root} changes={controller} diff={diff} />
  </>
);

const row = (key: string): HTMLElement =>
  document.body.querySelector(`[data-change-row="${key}"]`) as HTMLElement;
const rowKeys = (): (string | null)[] =>
  [...document.body.querySelectorAll("[data-change-row]")].map((r) =>
    r.getAttribute("data-change-row"),
  );
const header = (): HTMLElement =>
  document.body.querySelector('[data-slot="collapsible-trigger"]') as HTMLElement;
const text = (): string => document.body.textContent ?? "";
const squash = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ");

/** Resize the window the way the browser reports it: the column's tree is a wide-window thing. */
function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  resizeTo(1440);
  resetAgentDockState();
  repositoryScans.value = new Map();
  diffFocusRequested.value = false;
});

afterEach(() => {
  resizeTo(1024);
  repositoryScans.value = new Map();
  resetAgentDockState();
});

describe("the Changes section's tree", () => {
  it("counts the changed files in its header", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(squash(header().textContent)).toBe("Changes6");
    await view.unmount();
  });

  it("rolls lines up through folders and folds a lone folder chain into one row", async () => {
    const { controller } = fakeChanges({
      snapshot: snapshot([
        entry({ path: "src/ui/a.ts", added: 5, removed: 2 }),
        entry({ path: "src/ui/deep/b.ts", added: 3, removed: 1 }),
        entry({ path: "src/lib/c.ts", added: 10, removed: 0 }),
        entry({ path: "pkg/inner/only/d.ts", added: 1, removed: 1 }),
      ]),
    });
    const view = await mount(section(controller));
    expect(squash(row("folder:src").textContent)).toBe("src3+18 −3");
    expect(squash(row("folder:src/ui").textContent)).toBe("ui2+8 −3");
    expect(squash(row("folder:src/lib").textContent)).toBe("lib1+10 −0");
    // `pkg/inner/only` holds nothing but one folder at each step, so it is one row.
    expect(squash(row("folder:pkg/inner/only").textContent)).toBe("pkg/inner/only1+1 −1");
    expect(row("folder:pkg")).toBeNull();
    await view.unmount();
  });

  it("marks each file by status and strikes a deleted one", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    const mark = (key: string) => row(key).querySelector('[role="img"]');
    expect(mark("file:old.txt")?.getAttribute("aria-label")).toBe("Deleted");
    expect(mark("file:old.txt")?.textContent).toBe("D");
    expect(mark("file:scratch.txt")?.getAttribute("aria-label")).toBe("Untracked");
    expect(mark("file:img.png")?.getAttribute("aria-label")).toBe("Added");
    expect(row("file:old.txt").textContent).toContain("+0 −9");
    expect(row("file:old.txt").querySelector(".line-through")).not.toBeNull();
    expect(row("file:img.png").textContent).toContain("binary");
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

describe("opening a diff from a row", () => {
  it("raises the same call as the legacy row: the diff opens on the root and the column asks for focus", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(row("file:src/ui/a.ts"));
    expect(diff.selection.value).toMatchObject({ root: ROOT, path: "src/ui/a.ts" });
    expect(diffFocusRequested.value).toBe(true);
    expect(row("file:src/ui/a.ts").getAttribute("aria-current")).toBe("true");
    expect(row("file:src/lib/c.ts").getAttribute("aria-current")).toBeNull();

    // A deleted file's diff is the old side: it is pressable too.
    await click(row("file:old.txt"));
    expect(diff.selection.value?.path).toBe("old.txt");
    await view.unmount();
  });

  it("ends the diff when the section folds, as leaving the legacy Changes view does", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(row("file:src/ui/a.ts"));
    expect(diff.selection.value).not.toBeNull();
    await click(header());
    expect(diff.selection.value).toBeNull();
    await view.unmount();
  });

  it("ends the diff when the root moves to another checkout", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(row("file:src/ui/a.ts"));
    await view.update(section(controller, "/work/side"));
    expect(diff.selection.value).toBeNull();
    await view.unmount();
  });

  it("ends the diff when the section unmounts: a closed dock, or a closed sheet", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    await click(row("file:src/ui/a.ts"));
    await view.unmount();
    expect(diff.selection.value).toBeNull();
  });
});

describe("what the section watches", () => {
  it("watches the root while mounted, folded or not, and releases it on unmount", async () => {
    const { controller } = fakeChanges();
    const view = await mount(section(controller));
    expect(controller.setShown).toHaveBeenLastCalledWith(ROOT);
    await click(header());
    // Folded: the count in the header stays live.
    expect(controller.setShown).not.toHaveBeenCalledWith(null);
    expect(squash(header().textContent)).toBe("Changes6");
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
    expect(squash(header().textContent)).toBe("Changes");
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
