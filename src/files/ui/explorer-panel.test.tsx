// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The editor's own boot is Gate M's concern (and file-editor.test.tsx's) —
// this suite is about the pipe from a tree click to a mounted `.fileview`,
// not about Monaco. A promise that never resolves keeps the editor in its
// permanent "loading" state without pulling in the full stub.
vi.mock("../editor-host", async () => {
  const actual =
    await vi.importActual<typeof import("../editor-host")>("../editor-host");
  return {
    ...actual,
    loadMonaco: () => new Promise(() => {}),
  };
});

import { ExplorerPanel } from "./explorer-panel";
import { DesktopChrome } from "../../ui/app";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../file-surface-controller";
import {
  activeFileTab,
  documentFor,
  explorerWidthLive,
  resetFileSurfaces,
  setListing,
} from "../file-surface-store";
import type { FileClient } from "../file-client";
import { EXPLORER_WIDTH_MAX } from "../../settings/settings-schema";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../../lib/platform";

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

describe("ExplorerPanel", () => {
  it("selecting a file creates the preview surface and supplies its editor document", async () => {
    act(() => {
      setListing(WS, WS, [
        { name: "a.ts", path: FILE, directory: false, outOfRoot: false },
      ]);
    });
    act(() => {
      render(
        <ExplorerPanel
          controller={controller}
          workspacePath={WS}
          width={260}
          onWidthChange={() => {}}
        />,
        host,
      );
    });

    await act(async () => {
      host.querySelector<HTMLElement>(".file-tree__row")!.click();
    });

    // The preview surface: the tab is active and its document exists
    // (spec §4.1) — the read itself resolves to "refused" here on purpose.
    expect(activeFileTab.value).toBe(FILE);
    expect(documentFor(FILE)).toBeDefined();
    // …and the panel renders NO editor. The document goes to the stage
    // (`.stage__surface`, mounted by `App`) since 2026-08-14; a click here
    // opens the tab and stops there.
    expect(host.querySelector(".fileview")).toBeNull();
  });

  it("shows an empty state instead of a tree when the tab has no workspace", () => {
    act(() => {
      render(
        <ExplorerPanel
          controller={controller}
          workspacePath={null}
          width={260}
          onWidthChange={() => {}}
        />,
        host,
      );
    });

    expect(host.querySelector(".file-tree")).toBeNull();
    expect(host.querySelector(".explorer-panel__empty")).not.toBeNull();
  });
});

describe("ExplorerPanel resize", () => {
  it("drags the inner-edge grip, updates the live width, clamps, and commits once on release", async () => {
    const onWidthChange = vi.fn();
    act(() => {
      render(
        <ExplorerPanel
          controller={controller}
          workspacePath={WS}
          width={260}
          onWidthChange={onWidthChange}
        />,
        host,
      );
    });

    const grip = host.querySelector<HTMLElement>(".explorer-panel__grip")!;
    // jsdom does not implement pointer capture (DL-19.4's drag target).
    grip.setPointerCapture = vi.fn();
    grip.releasePointerCapture = vi.fn();

    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 500,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    expect(explorerWidthLive.value).toBeNull();

    // The grip sits on the panel's LEFT (inner) edge, so dragging left widens
    // it — moved 60px left from the drag start.
    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 440,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    expect(explorerWidthLive.value).toBe(320);
    expect(onWidthChange).not.toHaveBeenCalled();

    // Dragged far past the max clamps instead of growing unbounded.
    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: -1000,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    expect(explorerWidthLive.value).toBe(EXPLORER_WIDTH_MAX);

    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
    });

    // One settings write, on release — not on every pointermove.
    expect(onWidthChange).toHaveBeenCalledTimes(1);
    expect(onWidthChange).toHaveBeenCalledWith(EXPLORER_WIDTH_MAX);
    // Cleared before the commit, same reasoning as the browser panel's grip:
    // the settings write is async, and leaving the live value up would jump
    // the column back to the old width for a frame if the write is slow.
    expect(explorerWidthLive.value).toBeNull();
  });
});

describe("ExplorerPanel — both chrome layouts", () => {
  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
  });

  afterEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it.each([true, false])(
    "mounts the panel node in the stage when sidebar=%s",
    (sidebar) => {
      act(() => {
        render(
          <DesktopChrome
            sidebar={sidebar}
            toolbar={<span />}
            sidebarNavigation={<nav />}
            topTabs={<header />}
            stage={
              <main>
                <ExplorerPanel
                  controller={controller}
                  workspacePath={WS}
                  width={260}
                  onWidthChange={() => {}}
                />
              </main>
            }
            status={<footer />}
            onMacTitlebarDoubleClick={() => {}}
          />,
          host,
        );
      });

      expect(host.querySelector(".explorer-panel")).not.toBeNull();
    },
  );
});
