// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./file-tree-view";
import {
  resetFileSurfaces,
  setListing,
  setListingError,
  toggleDirectory,
} from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";

const WS = "/r";

function fakeController(overrides: Partial<FileSurfaceController> = {}): FileSurfaceController {
  return {
    init: vi.fn(async () => {}),
    openFile: vi.fn(async () => {}),
    activateFile: vi.fn(),
    toggleDirectory: vi.fn(),
    ensureListing: vi.fn(async () => {}),
    setText: vi.fn(),
    setCursor: vi.fn(),
    savePath: vi.fn(async () => {}),
    closePath: vi.fn(async () => {}),
    closeWorkspace: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
    setEditorFocus: vi.fn(),
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

function mount(controller: FileSurfaceController): void {
  act(() => {
    render(<FileTreeView controller={controller} workspacePath={WS} />, host);
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

    expect(rows().map((row) => row.textContent)).toEqual(["src", "b.ts"]);
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
      rows()[0].click();
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
      rows()[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
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
      rows()[0].click();
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
      rows()[0].click();
    });

    expect(controller.toggleDirectory).not.toHaveBeenCalled();
    expect(controller.openFile).not.toHaveBeenCalled();
  });

  it("shows a loading state before the root listing arrives", () => {
    // No `setListing` — the root directory has never been fetched.
    mount(fakeController());

    expect(rows()).toEqual([]);
    expect(tree().textContent).toMatch(/loading/i);
  });

  it("shows an empty state once the root listing arrives with no entries", () => {
    act(() => {
      setListing(WS, WS, []);
    });
    mount(fakeController());

    expect(rows()).toEqual([]);
    expect(tree().textContent).not.toMatch(/loading/i);
    expect((tree().textContent ?? "").length).toBeGreaterThan(0);
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
    // depth 2: 8px base + 2 * 14px indent tokens (DL-19).
    expect(deepest?.style.paddingLeft).toBe("36px");
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
