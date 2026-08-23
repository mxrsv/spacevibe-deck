// @vitest-environment jsdom
/**
 * The rendered view mounted for real: which of the two views a path lands on,
 * that the mode survives a tab switch, and that the document re-renders from
 * the BUFFER — not from the disk — when it changes underneath.
 *
 * Monaco is never loaded here. Every test either renders a document with no
 * fence at all, or supplies its own image seam; `StageSurface`'s source-mode
 * branch mounts `FileEditor`, which loads Monaco lazily and simply never
 * resolves under jsdom — the assertion is on which root class is in the DOM,
 * which the component decides before that import is ever started.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StageSurface } from "./stage-surface";
import { MarkdownView, RENDER_DEBOUNCE_MS } from "./markdown-view";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import {
  activateFileTab,
  openFileTab,
  resetFileSurfaces,
  toggleViewMode,
  updateDocument,
  viewModeFor,
} from "../file-surface-store";
import type { FileClient } from "../file-client";
import type { MarkdownImageSource } from "../markdown-image-source";

const WS = "/repo";
const DOC = "/repo/docs/guide.md";
const MDX = "/repo/docs/page.mdx";
const CODE = "/repo/src/app.ts";

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

const noImages: MarkdownImageSource = { read: async () => null };

/**
 * Poll until the document says what the test expects.
 *
 * Not a fixed number of turns: the render effect is held together by a dynamic
 * `marked` import plus `RENDER_DEBOUNCE_MS`, and a fixed budget that passes on
 * its own goes flaky the moment the file runs beside the rest of `src/files`.
 * Real timers rather than fake ones, for the same reason — a fake clock does
 * not advance a dynamic import.
 */
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000 + RENDER_DEBOUNCE_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the rendered document");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** What the document's first heading currently says, or null. */
const headingIn = (host: HTMLElement): string | null =>
  host.querySelector(".md-doc h1")?.textContent ?? null;

describe("StageSurface — which view a file lands on", () => {
  let host: HTMLDivElement;
  let controller: FileSurfaceController;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    resetFileSurfaces();
    controller = createFileSurfaceController({ client: fileClient });
  });

  afterEach(() => {
    act(() => render(null, host));
    controller.dispose();
    resetFileSurfaces();
  });

  const mount = (): void => {
    act(() => {
      render(<StageSurface controller={controller} />, host);
    });
  };

  it("opens a .md file rendered", () => {
    openFileTab(WS, DOC, { keep: true });
    mount();
    expect(host.querySelector(".fileview--rendered")).not.toBeNull();
  });

  it("opens a .mdx file as source", () => {
    openFileTab(WS, MDX, { keep: true });
    mount();
    expect(host.querySelector(".fileview--rendered")).toBeNull();
    expect(host.querySelector(".fileview__editor")).not.toBeNull();
  });

  it("shows the toggle on markdown and nowhere else", () => {
    openFileTab(WS, CODE, { keep: true });
    mount();
    expect(host.querySelector(".md-view-toggle")).toBeNull();

    openFileTab(WS, DOC, { keep: true });
    mount();
    expect(host.querySelector(".md-view-toggle")).not.toBeNull();
  });

  it("flips to source when the toggle is pressed, and back", () => {
    openFileTab(WS, DOC, { keep: true });
    mount();
    const toggle = host.querySelector<HTMLButtonElement>(".md-view-toggle");
    act(() => toggle?.click());
    expect(host.querySelector(".fileview--rendered")).toBeNull();

    act(() => host.querySelector<HTMLButtonElement>(".md-view-toggle")?.click());
    expect(host.querySelector(".fileview--rendered")).not.toBeNull();
  });

  it("keeps each tab's mode across a tab switch", () => {
    openFileTab(WS, DOC, { keep: true });
    const second = "/repo/docs/other.md";
    openFileTab(WS, second, { keep: true });
    mount();

    act(() => toggleViewMode(DOC));
    act(() => activateFileTab(WS, DOC));
    mount();
    expect(host.querySelector(".fileview--rendered")).toBeNull();

    act(() => activateFileTab(WS, second));
    mount();
    // The other tab was never flipped, so it is still on its default.
    expect(host.querySelector(".fileview--rendered")).not.toBeNull();
  });

  it("forgets the mode when the tab closes, so a reopen lands on the default", () => {
    openFileTab(WS, DOC, { keep: true });
    act(() => toggleViewMode(DOC));
    expect(viewModeFor(DOC)).toBe("source");

    act(() => void controller.closePath(WS, DOC));
    expect(viewModeFor(DOC)).toBe("rendered");
  });
});

describe("MarkdownView", () => {
  let host: HTMLDivElement;
  let controller: FileSurfaceController;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    resetFileSurfaces();
    controller = createFileSurfaceController({ client: fileClient });
    openFileTab(WS, DOC, { keep: true });
  });

  afterEach(() => {
    act(() => render(null, host));
    controller.dispose();
    resetFileSurfaces();
    vi.useRealTimers();
  });

  const mount = (): void => {
    act(() => {
      render(<MarkdownView path={DOC} controller={controller} images={noImages} />, host);
    });
  };

  it("renders the buffer, not the disk", async () => {
    updateDocument(DOC, { text: "# Hello\n\nsome prose" });
    mount();
    await waitFor(() => headingIn(host) === "Hello");
    expect(host.querySelector(".md-doc p")?.textContent).toBe("some prose");
  });

  it("re-renders when the buffer changes underneath it", async () => {
    updateDocument(DOC, { text: "# One" });
    mount();
    await waitFor(() => headingIn(host) === "One");

    act(() => updateDocument(DOC, { text: "# Two" }));
    mount();
    await waitFor(() => headingIn(host) === "Two");
  });

  it("escapes raw HTML in the buffer rather than mounting it", async () => {
    updateDocument(DOC, { text: "<img src=x onerror=alert(1)>" });
    mount();
    await waitFor(() => host.querySelector(".md-raw") !== null);
    expect(host.querySelector(".md-doc img")).toBeNull();
    expect(host.querySelector(".md-raw")?.textContent).toContain("<img src=x");
  });

  it("says the file was deleted while keeping the last content Deck read", async () => {
    updateDocument(DOC, { text: "# Hello", gone: true });
    mount();
    await waitFor(() => headingIn(host) === "Hello");
    expect(host.querySelector(".filebar--quiet")?.textContent).toContain("was deleted on disk");
  });
});
