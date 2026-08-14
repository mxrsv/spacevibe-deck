// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./file-tree-view";
import { resetFileSurfaces, setListing } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";

const WS = "/r";

function fakeController(
  overrides: Partial<FileSurfaceController> = {},
): FileSurfaceController {
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

function mount(controller: FileSurfaceController): void {
  act(() => {
    render(<FileTreeView controller={controller} workspacePath={WS} />, host);
  });
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".file-tree__row")];
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
      setListing(WS, WS, [
        { name: "src", path: `${WS}/src`, directory: true, outOfRoot: false },
      ]);
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
});
