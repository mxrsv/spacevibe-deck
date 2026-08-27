// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The editor's own boot is the packaged Monaco smoke's concern (and file-editor.test.tsx's) —
// this suite is about the pipe from a tree click to a mounted `.fileview`,
// not about Monaco. A promise that never resolves keeps the editor in its
// permanent "loading" state without pulling in the full stub.
vi.mock("../editor-host", async () => {
  const actual = await vi.importActual<typeof import("../editor-host")>("../editor-host");
  return {
    ...actual,
    loadMonaco: () => new Promise(() => {}),
  };
});

import { ExplorerTab } from "./explorer-tab";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import {
  activeFileTab,
  documentFor,
  explorerStatus,
  resetFileSurfaces,
  setExplorerStatus,
  setListing,
} from "../file-surface-store";
import type { FileClient } from "../file-client";

const WS = "/r";
const FILE = `${WS}/a.ts`;

const client: FileClient = {
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

let host: HTMLDivElement;
let controller: FileSurfaceController;

beforeEach(() => {
  resetFileSurfaces();
  controller = createFileSurfaceController({ client });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  controller.dispose();
});

describe("ExplorerTab", () => {
  it("selecting a file creates the preview surface and supplies its editor document", async () => {
    act(() => {
      setListing(WS, WS, [{ name: "a.ts", path: FILE, directory: false, outOfRoot: false }]);
    });
    act(() => {
      render(<ExplorerTab controller={controller} workspacePath={WS} canCreate />, host);
    });

    await act(async () => {
      // Row 0 is the root (design §3.1); the file is row 1.
      host.querySelectorAll<HTMLElement>(".file-tree__row")[1]!.click();
    });

    // The preview surface: the tab is active and its document exists
    // (spec §4.1) — the read itself resolves to "refused" here on purpose.
    expect(activeFileTab.value).toBe(FILE);
    expect(documentFor(FILE)).toBeDefined();
    // …and the tab renders NO editor. The document goes to the stage
    // (`.stage__surface`, mounted by `App`) since 2026-08-14; a click here
    // opens the tab and stops there.
    expect(host.querySelector(".fileview")).toBeNull();
  });

  it("shows an empty state instead of a tree when the tab has no workspace", () => {
    act(() => {
      render(<ExplorerTab controller={controller} workspacePath={null} canCreate />, host);
    });

    expect(host.querySelector(".file-tree")).toBeNull();
    expect(host.querySelector(".explorer-tab__empty")).not.toBeNull();
  });
});

describe("the explorer's DL-19.5 status line", () => {
  function mountTab(workspacePath: string | null): void {
    act(() => {
      render(<ExplorerTab controller={controller} workspacePath={workspacePath} canCreate />, host);
    });
  }

  const line = (): HTMLElement | null => host.querySelector(".file-tree-shell__status");

  it("prints a create failure in red under the header", () => {
    setExplorerStatus(WS, "An entry with that name already exists.", true);
    mountTab(WS);

    expect(line()?.textContent).toBe("An entry with that name already exists.");
    expect(line()?.classList.contains("is-failure")).toBe(true);
    expect(line()?.getAttribute("role")).toBe("status");
  });

  it("prints the hidden-files notice without the failure colour", () => {
    setExplorerStatus(WS, "Showing hidden files so .github is visible.", false);
    mountTab(WS);

    expect(line()?.classList.contains("is-failure")).toBe(false);
  });

  it("says nothing about another workspace's message", () => {
    setExplorerStatus("/other", "boom", true);
    mountTab(WS);

    expect(line()).toBeNull();
  });

  it("clears the line when the tab moves to a different workspace", () => {
    setExplorerStatus(WS, "boom", true);
    mountTab(WS);
    mountTab("/other");

    expect(explorerStatus.value).toBeNull();
  });
});
