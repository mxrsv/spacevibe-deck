// @vitest-environment jsdom
import { DOCK_ROW_HEIGHT } from "./dock-row-height";
import { signal } from "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangesController, ChangesState } from "../../files/changes/changes-controller";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import {
  resetFileSurfaces,
  setListing,
  setShowIgnored,
  setIgnored,
  toggleDirectory,
} from "../../files/file-surface-store";
import { FileTreeView } from "../../files/ui/file-tree-view";
import { DockFileTree } from "./dock-file-tree";

const ROOT = "/r";
const dir = (name: string, parent = ROOT) => ({
  name,
  path: `${parent}/${name}`,
  directory: true,
  outOfRoot: false,
});
const file = (name: string, parent = ROOT) => ({
  name,
  path: `${parent}/${name}`,
  directory: false,
  outOfRoot: false,
});

function snapshotWith(paths: string[]): ChangesState {
  return {
    root: ROOT,
    failure: null,
    reading: false,
    snapshot: {
      kind: "changes",
      branch: "main",
      detached: false,
      oid: null,
      initial: false,
      omitted: 0,
      totals: { added: 0, removed: 0 },
      entries: paths.map((path) => ({
        path,
        status: "modified" as const,
        oldPath: null,
        added: 1,
        removed: 0,
        binary: false,
        counted: true,
      })),
    },
  };
}

function fakeChanges(state: ChangesState): ChangesController {
  return { state: signal(state) } as unknown as ChangesController;
}

function fakeController(): FileSurfaceController {
  return {
    ensureListing: vi.fn(async () => {}),
    refreshTree: vi.fn(),
    toggleDirectory: vi.fn(),
    toggleRoot: vi.fn(),
    collapseAll: vi.fn(),
    openFile: vi.fn(async () => {}),
  } as unknown as FileSurfaceController;
}

let host: HTMLDivElement;

beforeEach(() => {
  resetFileSurfaces();
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    setListing(ROOT, ROOT, [dir("docs"), dir("src"), file("readme.md")]);
    setListing(ROOT, `${ROOT}/src`, [
      file("main.ts", `${ROOT}/src`),
      file("util.ts", `${ROOT}/src`),
    ]);
    toggleDirectory(ROOT, `${ROOT}/src`);
  });
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function mount(changes: ChangesController, controller = fakeController()): FileSurfaceController {
  act(() => {
    render(
      <DockFileTree
        controller={controller}
        workspacePath={ROOT}
        canCreate={false}
        changes={changes}
      />,
      host,
    );
  });
  return controller;
}

function names(): string[] {
  return [...host.querySelectorAll(".file-tree__row .file-tree__name")].map(
    (node) => node.textContent ?? "",
  );
}

function search(): HTMLInputElement {
  return host.querySelector('input[aria-label="Search files"]') as HTMLInputElement;
}

function type(text: string): void {
  act(() => {
    search().value = text;
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the dock's tree pane", () => {
  it("filters rows by name, keeps the folders above a match, and Esc restores them", () => {
    mount(fakeChanges(snapshotWith([])));
    expect(names()).toEqual(["r", "docs", "src", "main.ts", "util.ts", "readme.md"]);

    type("util");
    expect(names()).toEqual(["r", "src", "util.ts"]);

    act(() => {
      search().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(search().value).toBe("");
    expect(names()).toEqual(["r", "docs", "src", "main.ts", "util.ts", "readme.md"]);
  });

  it("says when nothing matches", () => {
    mount(fakeChanges(snapshotWith([])));
    type("zzz");
    expect(names()).toEqual(["r"]);
    expect(host.textContent).toContain("No matches");
  });

  it("re-lists the tree from the Refresh button", () => {
    const controller = mount(fakeChanges(snapshotWith([])));
    act(() => (host.querySelector('[aria-label="Refresh files"]') as HTMLElement).click());
    expect(controller.refreshTree).toHaveBeenCalledWith(ROOT);
  });

  it("dots a folder that holds a changed file and not an unrelated one", () => {
    mount(fakeChanges(snapshotWith(["src/main.ts"])));
    const dotted = [...host.querySelectorAll(".file-tree__row")]
      .filter((row) => row.querySelector('[aria-label="Contains changes"]') !== null)
      .map((row) => row.querySelector(".file-tree__name")?.textContent);
    expect(dotted).toEqual(["src"]);
  });

  it("dots a collapsed folder too, from a nested change", () => {
    mount(fakeChanges(snapshotWith(["docs/guide/a.md"])));
    const dotted = [...host.querySelectorAll(".file-tree__row")]
      .filter((row) => row.querySelector('[aria-label="Contains changes"]') !== null)
      .map((row) => row.querySelector(".file-tree__name")?.textContent);
    expect(dotted).toEqual(["docs"]);
  });

  it("marks ignored rows as dimmed", () => {
    act(() => {
      setIgnored(ROOT, ROOT, new Set(["docs"]));
      setShowIgnored(ROOT, true);
    });
    mount(fakeChanges(snapshotWith([])));
    const docs = [...host.querySelectorAll(".file-tree__row")].find(
      (row) => row.querySelector(".file-tree__name")?.textContent === "docs",
    );
    expect(docs?.classList.contains("is-ignored")).toBe(true);
  });

  it("gives the rows the dock's one row height, the same the Changes rows take", () => {
    mount(fakeChanges(snapshotWith([])));
    const row = host.querySelector<HTMLElement>(".file-tree__row");
    expect(row?.style.height).toBe(`${DOCK_ROW_HEIGHT}px`);
  });
});

describe("FileTreeView without the dock's props", () => {
  it("shows every row, 22px tall, with no dots", () => {
    act(() => {
      render(
        <FileTreeView controller={fakeController()} workspacePath={ROOT} canCreate={false} />,
        host,
      );
    });
    expect(names()).toEqual(["r", "docs", "src", "main.ts", "util.ts", "readme.md"]);
    expect(host.querySelector<HTMLElement>(".file-tree__row")?.style.height).toBe("22px");
    expect(host.querySelector(".file-tree__dot")).toBeNull();
  });
});
