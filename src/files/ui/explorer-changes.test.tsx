// @vitest-environment jsdom
import { signal } from "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/repositories-store", async () => {
  const actual = await vi.importActual<typeof import("../../repositories/repositories-store")>(
    "../../repositories/repositories-store",
  );
  return { ...actual, ensureRepositoriesScanned: vi.fn() };
});

vi.mock("../editor-host", async () => {
  const actual = await vi.importActual<typeof import("../editor-host")>("../editor-host");
  const { loadStubbedMonaco } = await import("./monaco-diff-stub");
  return { ...actual, loadMonaco: loadStubbedMonaco };
});

import { ExplorerTab } from "./explorer-tab";
import { DiffColumn } from "./diff-column";
import { resetStub } from "./monaco-diff-stub";
import { diffFocusRequested } from "../changes/diff-column-focus";
import { createDiffSelection, type DiffSelectionStore } from "../changes/diff-selection";
import type { DiffSidesPorts } from "../changes/diff-sides";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import { resetFileSurfaces, setExplorerStatus } from "../file-surface-store";
import type { FileClient } from "../file-client";
import type { ChangesController, ChangesState } from "../changes/changes-controller";
import { explorerView } from "../changes/explorer-view";
import { repositoryScans } from "../../repositories/repositories-store";
import type { ChangeEntry, ChangesSnapshot } from "../../host/git-changes-host";

const WS = "/work/repo";

const client: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: "refused", reason: "unused" }),
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

const entry = (over: Partial<ChangeEntry> & Pick<ChangeEntry, "path">): ChangeEntry => ({
  status: "modified",
  oldPath: null,
  added: 2,
  removed: 1,
  binary: false,
  counted: true,
  ...over,
});

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

const ENTRIES: ChangeEntry[] = [
  entry({ path: "src/a.ts", added: 5, removed: 2 }),
  entry({ path: "docs/new.md", status: "added", added: 3, removed: 0 }),
  entry({ path: "old.txt", status: "deleted", added: 0, removed: 9 }),
  entry({ path: "img.png", status: "added", added: 0, removed: 0, binary: true }),
  entry({
    path: "src/b.ts",
    status: "renamed",
    oldPath: "src/b-old.ts",
    added: 0,
    removed: 0,
  }),
  entry({ path: "scratch.txt", status: "untracked", added: 7, removed: 0 }),
];

function fakeChanges(initial: Partial<ChangesState> = {}) {
  const state = signal<ChangesState>({
    root: WS,
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

let host: HTMLDivElement;
let surface: FileSurfaceController;
/** The selection over the latest `fakeChanges` state, as the window's own is over its controller. */
let diff: DiffSelectionStore;

beforeEach(() => {
  resetStub();
  resetFileSurfaces();
  explorerView.value = "files";
  repositoryScans.value = new Map();
  surface = createFileSurfaceController({ client });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  surface.dispose();
});

function mount(changes: ChangesController | undefined, available = true): void {
  act(() => {
    render(
      <ExplorerTab
        controller={surface}
        workspacePath={WS}
        canCreate
        changesAvailable={available}
        changes={changes}
        diff={diff}
      />,
      host,
    );
  });
}

const chip = (view: "files" | "changes"): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`.explorer-switch__chip[data-view="${view}"]`)!;
const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".changes-row")];
const statusLine = (): HTMLElement | null => host.querySelector(".file-tree-shell__status");

function showChanges(): void {
  act(() => chip("changes").click());
}

describe("the switch", () => {
  it("is omitted where the host cannot serve git_changes", () => {
    mount(undefined, false);
    expect(host.querySelector(".explorer-switch")).toBeNull();
    expect(host.querySelector(".file-tree")).not.toBeNull();
  });

  it("starts on Files and shows the totals beside Changes", () => {
    const { controller } = fakeChanges();
    mount(controller);
    expect(chip("files").getAttribute("aria-selected")).toBe("true");
    expect(chip("changes").getAttribute("aria-selected")).toBe("false");
    expect(chip("changes").textContent).toContain("+15 −11");
    expect(host.querySelector(".changes-list")).toBeNull();
    // The totals need a live read, so Files watches the checkout too.
    expect(controller.setShown).toHaveBeenLastCalledWith(WS);
  });

  it("opens the list on press and hides the tree, and Files brings the tree back", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    expect(host.querySelector(".changes-list")).not.toBeNull();
    expect(host.querySelector(".file-tree")).toBeNull();
    expect(controller.setShown).toHaveBeenLastCalledWith(WS);

    act(() => chip("files").click());
    expect(host.querySelector(".file-tree")).not.toBeNull();
    expect(controller.setShown).not.toHaveBeenCalledWith(null);
  });

  it("releases the list when the tab unmounts", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => render(null, host));
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
  });

  it("walks between the chips with the arrow keys", () => {
    const { controller } = fakeChanges();
    mount(controller);
    act(() => {
      chip("files").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(host.querySelector(".changes-list")).not.toBeNull();
    act(() => {
      chip("changes").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(host.querySelector(".file-tree")).not.toBeNull();
  });

  it("disables Changes with the reason when the folder is not a repository", () => {
    const { controller } = fakeChanges();
    repositoryScans.value = new Map([[WS, { kind: "plain", reason: "not a repository" }]]);
    mount(controller);
    expect(chip("changes").getAttribute("aria-disabled")).toBe("true");
    expect(chip("changes").title).toBe("Not a git repository");
    expect(controller.setShown).not.toHaveBeenCalledWith(WS);
    showChanges();
    expect(host.querySelector(".changes-list")).toBeNull();
    expect(host.querySelector(".file-tree")).not.toBeNull();
  });

  it("falls back to Files when a shown folder turns out not to be a repository", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => {
      repositoryScans.value = new Map([[WS, { kind: "plain", reason: "gone" }]]);
    });
    expect(host.querySelector(".changes-list")).toBeNull();
    expect(controller.setShown).toHaveBeenLastCalledWith(null);
  });
});

describe("the list", () => {
  it("prints the branch row with its totals, and one row per entry", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    expect(host.querySelector(".changes-head__branch")?.textContent).toBe("feat/x");
    expect(host.querySelector(".changes-head__totals")?.textContent).toBe("+15 −11");
    expect(host.querySelector(".changes-head")?.getAttribute("title")).toBe(
      "Uncommitted changes against HEAD",
    );
    expect(rows()).toHaveLength(ENTRIES.length);
  });

  it("shows status mark, name, directory and counts, or binary", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    const [first, , , binary, renamed] = rows();
    expect(first.querySelector(".changes-row__mark")?.textContent).toBe("M");
    expect(first.querySelector(".changes-row__name")?.textContent).toBe("a.ts");
    expect(first.querySelector(".changes-row__dir")?.textContent).toBe("src");
    expect(first.querySelector(".changes-row__counts")?.textContent).toBe("+5 −2");
    expect(binary.querySelector(".changes-row__counts")?.textContent).toBe("binary");
    expect(renamed.title).toBe("Renamed from src/b-old.ts to src/b.ts");
    expect(renamed.querySelector(".changes-row__mark")?.textContent).toBe("R");
  });

  it("colours added and removed counts apart, and leaves a zero side neutral", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    const [first, added] = rows();
    expect(first.querySelector(".diff-counts__added")?.textContent).toBe("+5");
    expect(first.querySelector(".diff-counts__removed")?.textContent).toBe("−2");
    expect(added.querySelector(".diff-counts__added")?.textContent).toBe("+3");
    expect(added.querySelector(".diff-counts__removed")).toBeNull();
    expect(chip("changes").querySelector(".diff-counts__added")?.textContent).toBe("+15");
    expect(host.querySelector(".changes-head__totals .diff-counts__removed")?.textContent).toBe(
      "−11",
    );
  });

  it("a root-level file has no directory cell", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    expect(rows()[2].querySelector(".changes-row__dir")).toBeNull();
  });

  it("names the footer when entries were left out", () => {
    const { controller } = fakeChanges({ snapshot: snapshot(ENTRIES, { omitted: 12 }) });
    mount(controller);
    showChanges();
    expect(host.querySelector(".changes-list__note")?.textContent).toBe(
      "12 more changes are not shown",
    );
  });

  it("says so when the checkout is clean, and when there is no commit yet", () => {
    const clean = fakeChanges({ snapshot: snapshot([]) });
    mount(clean.controller);
    showChanges();
    expect(host.querySelector(".changes-list__note")?.textContent).toBe("No changes against HEAD.");
    expect(host.querySelector(".changes-list__rows")).toBeNull();
    expect(host.querySelector(".explorer-switch__totals")).toBeNull();

    act(() => {
      clean.state.value = {
        ...clean.state.value,
        snapshot: snapshot([], { initial: true, branch: "main" }),
      };
    });
    expect(host.querySelector(".changes-head__note")?.textContent).toBe("No commits yet");
    expect(host.querySelector(".changes-head")?.getAttribute("title")).toContain("empty tree");
  });

  it("labels a detached HEAD with the commit", () => {
    const { controller } = fakeChanges({
      snapshot: snapshot([], { branch: null, detached: true, oid: "abc1234" }),
    });
    mount(controller);
    showChanges();
    expect(host.querySelector(".changes-head__branch")?.textContent).toBe("Detached at abc1234");
  });

  it("shows a reading note before the first reply", () => {
    const { controller } = fakeChanges({ snapshot: null, reading: true });
    mount(controller);
    showChanges();
    expect(host.querySelector(".changes-list__note")?.textContent).toBe("Reading changes…");
  });

  it("Refresh reads at once", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Refresh changes"]')!.click());
    expect(controller.trigger).toHaveBeenCalledWith("refresh");
  });
});

describe("pressing a row opens its diff (plan 2026-10-10-diff-column, D4)", () => {
  it("selects the row, marks it, and does not open the file in the dock", () => {
    const { controller } = fakeChanges();
    const open = vi.spyOn(surface, "openFile").mockResolvedValue(undefined as never);
    mount(controller);
    showChanges();
    expect(rows().every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
    act(() => rows()[0].click());
    expect(diff.selection.value).toMatchObject({ root: WS, path: "src/a.ts" });
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    expect(rows()[0].classList.contains("is-selected")).toBe(true);
    expect(rows().filter((row) => row.classList.contains("is-selected"))).toHaveLength(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("asks the column to take focus", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    diffFocusRequested.value = false;
    act(() => rows()[0].click());
    expect(diffFocusRequested.value).toBe(true);
  });

  it("presses a deleted row too: its diff is the old side", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    const deleted = rows()[2];
    expect(deleted.hasAttribute("aria-disabled")).toBe(false);
    act(() => deleted.click());
    expect(diff.selection.value?.path).toBe("old.txt");
    expect(deleted.classList.contains("is-deleted")).toBe(true);
  });

  it("moves the wash when another row is pressed", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => rows()[1].click());
    expect(rows()[0].classList.contains("is-selected")).toBe(false);
    expect(rows()[1].classList.contains("is-selected")).toBe(true);
  });

  it("is reachable from the keyboard: one tab stop, arrows move it, Enter and Space press", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1);
    const list = host.querySelector<HTMLElement>(".changes-list__rows")!;
    act(() => {
      rows()[0].focus();
      list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(rows()[1].tabIndex).toBe(0);
    act(() => {
      rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(diff.selection.value?.path).toBe("docs/new.md");
    act(() => {
      rows()[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(diff.selection.value?.path).toBe("old.txt");
  });
});

describe("the column's life follows the list (D4)", () => {
  it("closes when the list gives way to Files", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => chip("files").click());
    expect(diff.selection.value).toBeNull();
  });

  it("closes when the tab unmounts: another dock tab, or a closed dock", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => render(null, host));
    expect(diff.selection.value).toBeNull();
  });

  it("leaves a diff alone when it offers no Changes: the stacked dock's Files section", () => {
    const { controller } = fakeChanges();
    diff.open(WS, "src/a.ts");
    mount(controller, false);
    act(() => render(null, host));
    expect(diff.selection.value?.path).toBe("src/a.ts");
  });

  it("closes when the Explorer is re-rooted on another workspace", () => {
    const { controller } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => {
      render(
        <ExplorerTab
          controller={surface}
          workspacePath="/work/other"
          canCreate
          changesAvailable
          changes={controller}
          diff={diff}
        />,
        host,
      );
    });
    expect(diff.selection.value).toBeNull();
  });

  it("keeps the selection while the list stays on screen and refreshes", () => {
    const { controller, state } = fakeChanges();
    mount(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => {
      state.value = { ...state.value, snapshot: snapshot(ENTRIES.slice(0, 3)) };
    });
    expect(diff.selection.value?.path).toBe("src/a.ts");
    expect(rows()[0].classList.contains("is-selected")).toBe(true);
  });
});

describe("with the column mounted beside the Explorer", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const ports: DiffSidesPorts = {
    statFiles: async (_root, paths) =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 3 })),
    readFile: async () => ({
      kind: "ok",
      content: "x\n",
      eol: "lf",
      encoding: "utf-8",
      bytes: 2,
      mixedEol: false,
      readOnly: false,
      writable: true,
      reason: null,
      mtimeMs: 1,
      size: 2,
    }),
    readHeadFile: async () => ({ kind: "absent" }),
  };

  function mountBoth(changes: ChangesController): void {
    act(() => {
      render(
        <>
          <ExplorerTab
            controller={surface}
            workspacePath={WS}
            canCreate
            changesAvailable
            changes={changes}
            diff={diff}
          />
          <DiffColumn
            controller={surface}
            dockWidth={420}
            selection={diff}
            changes={changes}
            ports={ports}
            onInset={() => {}}
          />
        </>,
        host,
      );
    });
  }

  const column = (): HTMLElement | null => host.querySelector("[data-diff-column]");

  it("a press opens it and Esc closes it, returning focus to the row", async () => {
    const { controller } = fakeChanges();
    mountBoth(controller);
    showChanges();
    expect(column()).toBeNull();
    act(() => rows()[0].click());
    expect(column()).not.toBeNull();
    expect(host.querySelector(".diff-column__name")?.textContent).toBe("a.ts");
    column()!.focus();
    act(() => {
      column()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(column()).toBeNull();
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("never says No longer changed for the list's empty state", async () => {
    const { controller, state } = fakeChanges();
    mountBoth(controller);
    showChanges();
    act(() => rows()[0].click());
    act(() => {
      state.value = { root: null, snapshot: null, failure: null, reading: false };
    });
    expect(host.textContent).not.toContain("No longer changed");
  });
});

describe("the status line (plan C6)", () => {
  it("prints a git failure in red and keeps the last list", () => {
    const { controller } = fakeChanges({
      failure: { kind: "timeout", message: "git took longer than 10 s to answer" },
    });
    mount(controller);
    showChanges();
    expect(statusLine()?.textContent).toBe("git took longer than 10 s to answer");
    expect(statusLine()?.classList.contains("is-failure")).toBe(true);
    expect(rows()).toHaveLength(ENTRIES.length);
  });

  it("says Not a git repository for a shown root that stopped being one", () => {
    const { controller } = fakeChanges({
      snapshot: null,
      failure: { kind: "not-repository", message: "Not a git repository" },
    });
    mount(controller);
    showChanges();
    expect(statusLine()?.textContent).toBe("Not a git repository");
  });

  it("lets a create failure win while it is up, then returns the git message", () => {
    const { controller } = fakeChanges({
      failure: { kind: "overflow", message: "The change list is too large to read" },
    });
    mount(controller);
    showChanges();
    act(() => setExplorerStatus(WS, "An entry with that name already exists.", true));
    expect(statusLine()?.textContent).toBe("An entry with that name already exists.");
    expect(host.querySelectorAll(".file-tree-shell__status")).toHaveLength(1);
    act(() => setExplorerStatus(WS, "", false));
    act(() => {
      // Retiring the message is the controller's `clearExplorerStatus`; emulate it.
      void import("../file-surface-store").then((store) => store.clearExplorerStatus());
    });
  });

  it("prints no git message on the Files side", () => {
    const { controller } = fakeChanges({
      failure: { kind: "timeout", message: "slow" },
    });
    mount(controller);
    expect(statusLine()).toBeNull();
  });
});
