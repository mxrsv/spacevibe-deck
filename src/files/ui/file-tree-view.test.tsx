// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./file-tree-view";
import {
  pendingTreeFocus,
  requestTreeFocus,
  resetFileSurfaces,
  setListing,
  setListingError,
  setRootExpanded,
  toggleDirectory,
} from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";
import type { DirEntry } from "../file-tree";
import { createEntryRequest } from "../../chrome/events";

const WS = "/r";

function fakeController(overrides: Partial<FileSurfaceController> = {}): FileSurfaceController {
  return {
    init: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    activateFile: vi.fn(),
    toggleDirectory: vi.fn(),
    toggleRoot: vi.fn(),
    refreshTree: vi.fn(),
    collapseAll: vi.fn(),
    createEntry: vi.fn(async () => true),
    ensureListing: vi.fn(async () => {}),
    setText: vi.fn(),
    setCursor: vi.fn(),
    savePath: vi.fn(async () => {}),
    closePath: vi.fn(async () => {}),
    closeWorkspace: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
    setEditorFocus: vi.fn(),
    setEditorEdit: vi.fn(),
    runEditCommand: vi.fn(() => false),
    dispose: vi.fn(),
    count: () => 0,
    total: () => 0,
    activeIndex: () => -1,
    activate: vi.fn(),
    deactivate: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    applySettings: vi.fn(),
    ...overrides,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  resetFileSurfaces();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  // Without this, a previous test's tree stays mounted and subscribed to the
  // module-level store signals — the 10,000-row test below then writes a
  // 10,000-entry listing that every stale, still-subscribed instance
  // re-renders too (most of them unwindowed, since their own `clientHeight`
  // was never stubbed), which is enough DOM work to exhaust the heap.
  act(() => render(null, host));
  host.remove();
});

function mount(controller: FileSurfaceController, canCreate = true): void {
  act(() => {
    render(<FileTreeView controller={controller} workspacePath={WS} canCreate={canCreate} />, host);
  });
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".file-tree__row")];
}

function tree(): HTMLElement {
  const node = host.querySelector<HTMLElement>(".file-tree");
  if (node === null) {
    throw new Error("`.file-tree` did not render");
  }
  return node;
}

describe("FileTreeView", () => {
  it("renders a flat, sorted list of the root listing (directories first)", () => {
    act(() => {
      setListing(WS, WS, [
        {
          name: "b.ts",
          path: `${WS}/b.ts`,
          directory: false,
          outOfRoot: false,
        },
        { name: "src", path: `${WS}/src`, directory: true, outOfRoot: false },
      ]);
    });

    mount(fakeController());

    expect(rows().map((row) => row.textContent)).toEqual(["r", "src", "b.ts"]);
  });

  it("asks the controller to load the root listing on mount", () => {
    const controller = fakeController();
    mount(controller);

    expect(controller.ensureListing).toHaveBeenCalledWith(WS, WS);
  });

  it("opens a file as the preview tab on a single click", () => {
    act(() => {
      setListing(WS, WS, [
        {
          name: "a.ts",
          path: `${WS}/a.ts`,
          directory: false,
          outOfRoot: false,
        },
      ]);
    });
    const controller = fakeController();
    mount(controller);

    act(() => {
      rows()[1].click();
    });

    expect(controller.openFile).toHaveBeenCalledWith(WS, `${WS}/a.ts`, false);
  });

  it("promotes a file to a kept tab on double-click", () => {
    act(() => {
      setListing(WS, WS, [
        {
          name: "a.ts",
          path: `${WS}/a.ts`,
          directory: false,
          outOfRoot: false,
        },
      ]);
    });
    const controller = fakeController();
    mount(controller);

    act(() => {
      rows()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(controller.openFile).toHaveBeenCalledWith(WS, `${WS}/a.ts`, true);
  });

  it("toggles a directory instead of opening it", () => {
    act(() => {
      setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
    });
    const controller = fakeController();
    mount(controller);

    act(() => {
      rows()[1].click();
    });

    expect(controller.toggleDirectory).toHaveBeenCalledWith(WS, `${WS}/src`);
    expect(controller.openFile).not.toHaveBeenCalled();
  });

  it("does not open a symlink that resolves out of the workspace root (spec §3.1)", () => {
    act(() => {
      setListing(WS, WS, [
        {
          name: "escaped",
          path: `${WS}/escaped`,
          directory: true,
          outOfRoot: true,
        },
      ]);
    });
    const controller = fakeController();
    mount(controller);

    act(() => {
      rows()[1].click();
    });

    expect(controller.toggleDirectory).not.toHaveBeenCalled();
    expect(controller.openFile).not.toHaveBeenCalled();
  });

  it("shows a loading state before the root listing arrives", () => {
    // No `setListing` — the root directory has never been fetched.
    mount(fakeController());

    // Design §3.3: loading, empty and error all KEEP the root row, so a
    // workspace whose listing failed still says which folder failed.
    expect(rows().map((row) => row.textContent)).toEqual(["r"]);
    expect(tree().textContent).toMatch(/loading/i);
  });

  it("shows an empty state once the root listing arrives with no entries", () => {
    act(() => {
      setListing(WS, WS, []);
    });
    mount(fakeController());

    // The root row survives an empty listing (design §3.3) — a workspace with
    // no visible entries still says which folder it is.
    expect(rows().map((row) => row.textContent)).toEqual(["r"]);
    expect(tree().textContent).not.toMatch(/loading/i);
  });

  it("shows a sticky read error and retries the failed directory", () => {
    setListingError(WS, WS, "Couldn't read this folder.");
    const controller = fakeController();

    mount(controller);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't read this folder.");

    act(() => {
      alert?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(controller.ensureListing).toHaveBeenCalledWith(WS, WS);
  });

  it("keeps Retry outside the tree keyboard handler when rows are retained", () => {
    act(() => {
      setListing(WS, WS, [
        {
          name: "a.ts",
          path: `${WS}/a.ts`,
          directory: false,
          outOfRoot: false,
        },
      ]);
      setListingError(WS, WS, "Couldn't read this folder.");
    });
    const controller = fakeController();
    mount(controller);
    const retry = host.querySelector<HTMLButtonElement>(".load-error__retry")!;

    expect(tree().contains(retry)).toBe(false);
    act(() => {
      retry.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      retry.click();
    });

    expect(controller.openFile).not.toHaveBeenCalled();
    expect(controller.toggleDirectory).not.toHaveBeenCalled();
    expect(controller.ensureListing).toHaveBeenCalledWith(WS, WS);
  });

  it("keeps depth-based indentation correct for a deeply nested expanded path", () => {
    act(() => {
      setListing(WS, WS, [{ name: "a", path: `${WS}/a`, directory: true, outOfRoot: false }]);
      toggleDirectory(WS, `${WS}/a`);
      setListing(WS, `${WS}/a`, [
        { name: "b", path: `${WS}/a/b`, directory: true, outOfRoot: false },
      ]);
      toggleDirectory(WS, `${WS}/a/b`);
      setListing(WS, `${WS}/a/b`, [
        {
          name: "c.ts",
          path: `${WS}/a/b/c.ts`,
          directory: false,
          outOfRoot: false,
        },
      ]);
    });
    mount(fakeController());

    const deepest = rows().find((row) => row.textContent === "c.ts");
    expect(deepest).toBeDefined();
    // depth 3 since the root became row 0: 8px base + 3 * 14px indent tokens
    // (DL-19).
    expect(deepest?.style.paddingLeft).toBe("50px");
  });

  describe("keyboard focus and navigation (spec §3.1)", () => {
    it("moves the roving focus down and up with the arrow keys", () => {
      act(() => {
        setListing(WS, WS, [
          {
            name: "a.ts",
            path: `${WS}/a.ts`,
            directory: false,
            outOfRoot: false,
          },
          {
            name: "b.ts",
            path: `${WS}/b.ts`,
            directory: false,
            outOfRoot: false,
          },
        ]);
      });
      mount(fakeController());

      expect(rows()[0].tabIndex).toBe(0);
      expect(rows()[1].tabIndex).toBe(-1);

      act(() => {
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });

      expect(rows()[0].tabIndex).toBe(-1);
      expect(rows()[1].tabIndex).toBe(0);
      expect(document.activeElement).toBe(rows()[1]);
      expect(rows()[1].textContent).toBe("a.ts");

      act(() => {
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      });

      expect(rows()[0].tabIndex).toBe(0);
      expect(document.activeElement).toBe(rows()[0]);
    });

    it("expands the focused directory on ArrowRight", () => {
      act(() => {
        setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
      });
      const controller = fakeController();
      mount(controller);

      act(() => {
        // Index 0 is the root row now; step onto the directory first.
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
      act(() => {
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      });

      expect(controller.toggleDirectory).toHaveBeenCalledWith(WS, `${WS}/src`);
    });

    it("collapses the focused expanded directory on ArrowLeft", () => {
      act(() => {
        setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
        toggleDirectory(WS, `${WS}/src`);
      });
      const controller = fakeController();
      mount(controller);

      act(() => {
        // Index 0 is the root row now; step onto the directory first.
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
      act(() => {
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      });

      expect(controller.toggleDirectory).toHaveBeenCalledWith(WS, `${WS}/src`);
    });

    it("does not collapse a directory on ArrowLeft when it is not expanded", () => {
      act(() => {
        setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
      });
      const controller = fakeController();
      mount(controller);

      act(() => {
        // Index 0 is the root row now; step onto the directory first.
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
      act(() => {
        tree().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      });

      expect(controller.toggleDirectory).not.toHaveBeenCalled();
    });
  });

  describe("10,000-row windowing", () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

    beforeEach(() => {
      // jsdom never lays out real geometry — a fixed viewport height is what
      // lets the arithmetic windowing math (spec §3.1) run in a unit test at
      // all, on every element the same way a real docked panel would report.
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        value: 220,
      });
    });

    afterEach(() => {
      if (descriptor !== undefined) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", descriptor);
      }
    });

    // 10,000 rows of jsdom DOM work exceeds the 5 s default under full-suite
    // parallel load; the math itself is instant, the tree building is not.
    it(
      "keeps a 10,000-row directory down to only the rows near the viewport",
      { timeout: 30_000 },
      () => {
        act(() => {
          setListing(
            WS,
            WS,
            Array.from({ length: 10_000 }, (_, index) => ({
              name: `file-${String(index).padStart(5, "0")}.ts`,
              path: `${WS}/file-${index}.ts`,
              directory: false,
              outOfRoot: false,
            })),
          );
        });
        mount(fakeController());

        expect(rows().length).toBeGreaterThan(0);
        // 220px / 22px = 10 rows on screen; even a generous overscan stays far
        // below the 10,000 total rows a non-windowed render would produce.
        expect(rows().length).toBeLessThan(50);
      },
    );
  });
});

/** One paint. A signal change reaches a Preact effect on the next animation
 * frame in this repo, never on a microtask. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

function press(key: string): void {
  act(() => {
    tree().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The default tree: root `r` over `src` and `readme.md`. */
function seedTree(entries?: DirEntry[] | null): void {
  if (entries === null) {
    return;
  }
  act(() => {
    setListing(
      WS,
      WS,
      entries ?? [
        { name: "src", path: `${WS}/src`, directory: true, outOfRoot: false },
        { name: "readme.md", path: `${WS}/readme.md`, directory: false, outOfRoot: false },
      ],
    );
  });
}

async function mountTree(
  controller: FileSurfaceController = fakeController(),
  options: { listing?: DirEntry[] | null; canCreate?: boolean } = {},
): Promise<void> {
  seedTree(options.listing);
  mount(controller, options.canCreate ?? true);
  await frame();
}

/** Walk the roving focus down to `index` with the arrow key, the way a user
 * reaches it — the component owns the focused path, not the test. */
async function focusRow(index: number): Promise<void> {
  for (let step = 0; step < index; step += 1) {
    press("ArrowDown");
  }
  await frame();
}

describe("FileTreeView's root row (design §3)", () => {
  it("draws the root as row 0 with a caret and no folder icon", async () => {
    await mountTree();

    expect(rows()[0].querySelector(".file-tree__name")?.textContent).toBe("r");
    expect(rows()[0].getAttribute("aria-level")).toBe("1");
    expect(rows()[0].querySelector(".file-tree__chevron")).not.toBeNull();
    // Design §3.2: `iconForRow` is not consulted for the root — the caret at
    // depth 0 already says "this is the folder everything is in".
    expect(rows()[0].querySelector(".file-tree__icon")).toBeNull();
    expect(rows()[1].getAttribute("aria-level")).toBe("2");
  });

  it("marks the root row so it can carry its own ink", async () => {
    await mountTree();

    expect(rows()[0].classList.contains("is-root")).toBe(true);
  });

  it("clicking the root row toggles the root and not a directory", async () => {
    const controller = fakeController();
    await mountTree(controller);

    act(() => {
      rows()[0].click();
    });

    expect(controller.toggleRoot).toHaveBeenCalledWith(WS);
    expect(controller.toggleDirectory).not.toHaveBeenCalled();
  });

  it("ArrowLeft on an open root collapses it; ArrowRight on a shut one re-opens it", async () => {
    const controller = fakeController();
    await mountTree(controller);

    press("ArrowLeft");
    expect(controller.toggleRoot).toHaveBeenCalledTimes(1);

    act(() => setRootExpanded(WS, false));
    await frame();
    press("ArrowRight");
    expect(controller.toggleRoot).toHaveBeenCalledTimes(2);
  });

  it("says 'No files' beneath the root row, not instead of it", async () => {
    await mountTree(fakeController(), { listing: [] });

    expect(rows()).toHaveLength(1);
    expect(host.querySelector(".file-tree__status")?.textContent).toBe("No files");
  });

  it("says nothing about emptiness while the root is collapsed", async () => {
    act(() => setRootExpanded(WS, false));
    await mountTree(fakeController(), { listing: [] });

    expect(host.querySelector(".file-tree__status")).toBeNull();
  });
});

describe("FileTreeView focuses by path (design §3.4)", () => {
  it("keeps focus on a path across a re-sort", async () => {
    await mountTree(); // rows: r, src, readme.md
    await focusRow(2); // readme.md

    seedTree([
      { name: "aaa.ts", path: `${WS}/aaa.ts`, directory: false, outOfRoot: false },
      { name: "src", path: `${WS}/src`, directory: true, outOfRoot: false },
      { name: "readme.md", path: `${WS}/readme.md`, directory: false, outOfRoot: false },
    ]);
    await frame();

    const stop = rows().findIndex((row) => row.tabIndex === 0);
    expect(rows()[stop].querySelector(".file-tree__name")?.textContent).toBe("readme.md");
  });

  it("falls back to the nearest surviving row when the focused path leaves", async () => {
    await mountTree();
    await focusRow(2);

    seedTree([{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
    await frame();

    expect(rows().findIndex((row) => row.tabIndex === 0)).toBe(1);
  });

  it("focuses the row a create asked for, once it exists", async () => {
    await mountTree();

    act(() => requestTreeFocus(`${WS}/readme.md`));
    await frame();

    expect(document.activeElement?.textContent).toContain("readme.md");
    expect(pendingTreeFocus.value).toBeNull();
  });
});

describe("the root row's action cluster (DL-19.9)", () => {
  const buttons = (): HTMLButtonElement[] => [
    ...host.querySelectorAll<HTMLButtonElement>(".file-tree__action"),
  ];

  it("pressing a cluster control does not toggle the root — pointer and keyboard", async () => {
    const controller = fakeController();
    await mountTree(controller);
    const refresh = host.querySelector('[aria-label="Refresh"]') as HTMLButtonElement;

    act(() => {
      refresh.click();
    });
    expect(controller.refreshTree).toHaveBeenCalledTimes(1);
    expect(controller.toggleRoot).not.toHaveBeenCalled();

    // The keyboard path is a SEPARATE bug: `stopPropagation` on the click
    // covers the pointer only, and the container's own `onKeyDown` would still
    // run `activateRow(rows[0])`.
    act(() => {
      refresh.focus();
      refresh.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(controller.toggleRoot).not.toHaveBeenCalled();
  });

  it("hands the cluster the root row's tab stop and takes it away again", async () => {
    await mountTree();

    expect(buttons().every((button) => button.tabIndex === 0)).toBe(true);
    await focusRow(1);
    expect(buttons().every((button) => button.tabIndex === -1)).toBe(true);
  });

  it("omits the create controls when the host cannot answer", async () => {
    await mountTree(fakeController(), { canCreate: false });

    expect(host.querySelector('[aria-label="New file"]')).toBeNull();
    expect(host.querySelector('[aria-label="Refresh"]')).not.toBeNull();
  });

  it("raises the naming dialog against the focused directory (design §5.1)", async () => {
    await mountTree(fakeController(), {
      listing: [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }],
    });
    await focusRow(1);

    act(() => {
      (host.querySelector('[aria-label="New file"]') as HTMLButtonElement).click();
    });

    expect(createEntryRequest.value).toEqual({
      workspacePath: WS,
      parent: `${WS}/src`,
      kind: "file",
    });
  });
});
