// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreeView } from "./file-tree-view";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import type { FileClient } from "../file-client";
import type { DirEntry } from "../file-tree";
import {
  activateFileTab,
  activateTerminalSurface,
  openFileTab,
  resetFileSurfaces,
  surfaceFor,
} from "../file-surface-store";

/**
 * The reveal needs a controller that really expands, so these tests drive the
 * real one over an in-memory file system — `fakeController`'s `vi.fn`s never
 * change the store. The root key is `/tmp/ws` and every listed path is
 * `/private/tmp/ws/...`, the spelling `list_dir` returns under a symlinked
 * root, which is the case a prefix test against the root would get wrong.
 */
const WS = "/tmp/ws";
const REAL = "/private/tmp/ws";

const dir = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: true,
  outOfRoot: false,
});
const file = (parent: string, name: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  directory: false,
  outOfRoot: false,
});

const BULK = Array.from({ length: 60 }, (_, index) =>
  file(`${REAL}/src/a`, `f${String(index).padStart(2, "0")}.ts`),
);
const DEEP = `${REAL}/src/a/z-deep.ts`;

/** What `list_dir` would answer, hidden entries included — the filter is the
 * renderer's. */
function tree(): Record<string, DirEntry[]> {
  return {
    [WS]: [
      dir(REAL, "src"),
      dir(REAL, ".github"),
      dir(REAL, "node_modules"),
      file(REAL, ".env"),
      file(REAL, "README.md"),
    ],
    [`${REAL}/src`]: [dir(`${REAL}/src`, "a"), file(`${REAL}/src`, "index.ts")],
    [`${REAL}/src/a`]: [...BULK, file(`${REAL}/src/a`, "z-deep.ts")],
    [`${REAL}/.github`]: [dir(`${REAL}/.github`, "workflows")],
    [`${REAL}/.github/workflows`]: [file(`${REAL}/.github/workflows`, "ci.yml")],
    [`${REAL}/node_modules`]: [file(`${REAL}/node_modules`, "x.js")],
  };
}

interface Harness {
  readonly controller: FileSurfaceController;
  readonly listed: string[];
  /** Hold the next `list_dir` for `directory` until `release()`. */
  hold(directory: string): { release(): void };
}

function harness(): Harness {
  const fs = tree();
  const listed: string[] = [];
  const held = new Map<string, Promise<void>>();
  const client: FileClient = {
    listDir: async (_root, directory) => {
      listed.push(directory);
      await held.get(directory);
      return fs[directory] ?? [];
    },
    readFile: async () => ({ kind: "refused", reason: "test" }),
    writeFile: async (_root, path) => ({ path, mtimeMs: 0, size: 0 }),
    statFiles: async (_root, paths) =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 0, size: 0 })),
    watchPaths: async () => {},
    setDirtyFiles: async () => {},
    createEntry: async (_root, parent, name) => ({ path: `${parent}/${name}` }),
    listenFileChanged: async () => () => {},
  };
  return {
    controller: createFileSurfaceController({ client }),
    listed,
    hold(directory) {
      let release = (): void => {};
      held.set(
        directory,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release };
    },
  };
}

let host: HTMLDivElement;
let controller: FileSurfaceController;
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeEach(() => {
  resetFileSurfaces();
  host = document.createElement("div");
  document.body.appendChild(host);
  // jsdom has no layout: a fixed viewport of ten 22px rows lets the window and
  // the scroll arithmetic run.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 220 });
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  controller?.dispose();
  if (clientHeight !== undefined) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
  }
});

function mount(c: FileSurfaceController): void {
  controller = c;
  act(() => {
    render(<FileTreeView controller={c} workspacePath={WS} canCreate />, host);
  });
}

const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".file-tree__row")];
const names = (): string[] =>
  rows().map((row) => row.querySelector(".file-tree__name")!.textContent!);
const marked = (): string[] =>
  rows()
    .filter((row) => row.classList.contains("is-active"))
    .map((row) => row.querySelector(".file-tree__name")!.textContent!);
const container = (): HTMLElement => host.querySelector<HTMLElement>(".file-tree")!;
const toggle = (): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>('[aria-label="Show hidden files"]')!;

/** Open a preview tab through the store, as the controller does before it
 * reads. */
function open(path: string): void {
  act(() => {
    openFileTab(WS, path, { keep: false });
  });
}

describe("marking the document on the stage (H3)", () => {
  it("marks the displayed document even while the terminal has focus", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    act(() =>
      rows()
        .find((row) => row.textContent === "README.md")!
        .click(),
    );
    await vi.waitFor(() => expect(marked()).toEqual(["README.md"]));
    const row = rows().find((r) => r.classList.contains("is-active"))!;
    expect(row.getAttribute("aria-selected")).toBe("true");

    // Keep it (a double-click), open a second file beside it, and let a strip
    // chip bring the first back: the mark follows each.
    act(() => {
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    open(`${REAL}/src/index.ts`);
    await vi.waitFor(() => expect(marked()).toEqual(["index.ts"]));
    act(() => activateFileTab(WS, `${REAL}/README.md`));
    await vi.waitFor(() => expect(marked()).toEqual(["README.md"]));

    // The document remains visible beside the tree when the terminal has focus.
    act(() => activateTerminalSurface());
    await vi.waitFor(() => expect(marked()).toEqual(["README.md"]));
    expect(rows().some((r) => r.getAttribute("aria-selected") === "true")).toBe(true);
  });

  it("only files carry aria-selected", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    for (const row of rows()) {
      const isFile = row.getAttribute("aria-expanded") === null;
      expect(row.hasAttribute("aria-selected")).toBe(isFile);
    }
  });

  it("does not mark another workspace's document", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    act(() => {
      openFileTab("/tmp/other", `${REAL}/README.md`, { keep: false });
    });
    await vi.waitFor(() => expect(controller).toBeDefined());

    expect(marked()).toEqual([]);
  });
});

describe("revealing it (H4)", () => {
  it("expands the folders above a deep document and brings its row into the window", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    open(DEEP);

    await vi.waitFor(() => expect(marked()).toEqual(["z-deep.ts"]));
    const state = surfaceFor(WS);
    expect([...state.expanded].sort()).toEqual([`${REAL}/src`, `${REAL}/src/a`]);
    // Row 63 of 64: bottom-aligned, the least scroll that shows it.
    expect(container().scrollTop).toBe(64 * 22 - 220);
  });

  it("leaves the keyboard focus and the roving tab stop where they were", async () => {
    const h = harness();
    const sentinel = document.createElement("input");
    document.body.appendChild(sentinel);
    try {
      mount(h.controller);
      await vi.waitFor(() => expect(names()).toContain("README.md"));
      sentinel.focus();
      expect(rows()[0].tabIndex).toBe(0);

      open(DEEP);
      await vi.waitFor(() => expect(marked()).toEqual(["z-deep.ts"]));

      expect(document.activeElement).toBe(sentinel);
      // The root row is windowed out by the scroll; bring it back to read it.
      act(() => {
        container().scrollTop = 0;
        container().dispatchEvent(new Event("scroll"));
      });
      expect(rows()[0].querySelector(".file-tree__name")?.textContent).toBe("ws");
      expect(rows().filter((row) => row.tabIndex === 0)).toEqual([rows()[0]]);
    } finally {
      sentinel.remove();
    }
  });

  it("does not scroll for a row that is already in view", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    open(`${REAL}/README.md`);
    await vi.waitFor(() => expect(marked()).toEqual(["README.md"]));

    expect(container().scrollTop).toBe(0);
    expect(surfaceFor(WS).expanded.size).toBe(0);
  });

  it("reveals once when the tree mounts with a document already on the stage", async () => {
    const h = harness();
    // The dock was closed when it was opened: nothing is mounted to react.
    open(DEEP);

    mount(h.controller);

    await vi.waitFor(() => expect(marked()).toEqual(["z-deep.ts"]));
    expect(container().scrollTop).toBe(64 * 22 - 220);
  });

  it("lets a later collapse and a later scroll stand", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));
    open(DEEP);
    await vi.waitFor(() => expect(marked()).toEqual(["z-deep.ts"]));

    act(() => h.controller.toggleDirectory(WS, `${REAL}/src`));
    await vi.waitFor(() => expect(names()).not.toContain("a"));
    // Give a stray re-run every chance to put it back.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(surfaceFor(WS).expanded.has(`${REAL}/src`)).toBe(false);
    expect(names()).not.toContain("a");

    act(() => {
      container().scrollTop = 0;
      container().dispatchEvent(new Event("scroll"));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(container().scrollTop).toBe(0);
  });

  it("drops a reveal in flight when a newer document arrives", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));
    const held = h.hold(`${REAL}/src`);

    open(DEEP);
    await vi.waitFor(() => expect(h.listed).toContain(`${REAL}/src`));
    open(`${REAL}/README.md`);
    await vi.waitFor(() => expect(marked()).toEqual(["README.md"]));
    await act(async () => {
      held.release();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // The first request opened `src` before it was replaced, and went no
    // further: `src/a` stays shut and the mark stays on the newer document.
    expect(surfaceFor(WS).expanded.has(`${REAL}/src/a`)).toBe(false);
    expect(marked()).toEqual(["README.md"]);
  });
});

describe("documents the tree cannot show (H5)", () => {
  it("marks nothing and changes nothing for a dot-path while hidden files are off", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    open(`${REAL}/.github/workflows/ci.yml`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const state = surfaceFor(WS);
    expect(marked()).toEqual([]);
    expect(state.expanded.size).toBe(0);
    expect(state.showHidden).toBe(false);
    expect(state.rootExpanded).toBe(true);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("reveals that dot-path when hidden files turn on", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));
    open(`${REAL}/.github/workflows/ci.yml`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    act(() => toggle().click());

    await vi.waitFor(() => expect(marked()).toEqual(["ci.yml"]));
    expect([...surfaceFor(WS).expanded].sort()).toEqual([
      `${REAL}/.github`,
      `${REAL}/.github/workflows`,
    ]);
  });

  it("marks nothing under an excluded name even with hidden files on", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));
    act(() => toggle().click());

    open(`${REAL}/node_modules/x.js`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(marked()).toEqual([]);
    expect(surfaceFor(WS).expanded.has(`${REAL}/node_modules`)).toBe(false);
  });

  it("marks nothing for a document outside the root, and opens nothing for it", async () => {
    const h = harness();
    mount(h.controller);
    await vi.waitFor(() => expect(names()).toContain("README.md"));

    open("/elsewhere/notes.md");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(marked()).toEqual([]);
    expect(surfaceFor(WS).expanded.size).toBe(0);
  });
});
