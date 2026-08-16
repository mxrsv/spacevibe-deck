// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DockPanel } from "./dock-panel";
import { availableDockTabs } from "./dock-tab-registry";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import { DesktopChrome } from "../app";
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from "../../files/file-surface-controller";
import {
  dockCollapseArmed,
  dockWidthLive,
  resetFileSurfaces,
} from "../../files/file-surface-store";
import type { FileClient } from "../../files/file-client";
import { DOCK_WIDTH_MAX, DOCK_WIDTH_MIN } from "../../settings/settings-schema";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../../lib/platform";

const WS = "/r";

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

describe("DockPanel resize", () => {
  it("drags the inner-edge grip, updates the live width, clamps, and commits once on release", async () => {
    const onWidthChange = vi.fn();
    const onClose = vi.fn();
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(true)}
          activeTab="explorer"
          onSelectTab={() => {}}
          width={420}
          onWidthChange={onWidthChange}
          onClose={onClose}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const grip = host.querySelector<HTMLElement>(".dock-panel__grip")!;
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
    expect(dockWidthLive.value).toBeNull();

    // The grip sits on the column's LEFT (inner) edge, so dragging left widens
    // it — moved 60px left from the 420px start.
    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 440,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    expect(dockWidthLive.value).toBe(480);
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
    expect(dockWidthLive.value).toBe(DOCK_WIDTH_MAX);

    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
    });

    // One settings write, on release — not on every pointermove.
    expect(onWidthChange).toHaveBeenCalledTimes(1);
    expect(onWidthChange).toHaveBeenCalledWith(DOCK_WIDTH_MAX);
    // Cleared before the commit, same reasoning as the browser panel's grip:
    // the settings write is async, and leaving the live value up would jump
    // the column back to the old width for a frame if the write is slow.
    expect(dockWidthLive.value).toBeNull();
    // A resize is not a close, however far past the max it went.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on release when the drag was pulled past the floor, and writes no width", async () => {
    const onWidthChange = vi.fn();
    const onClose = vi.fn();
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(true)}
          activeTab="explorer"
          onSelectTab={() => {}}
          width={420}
          onWidthChange={onWidthChange}
          onClose={onClose}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const grip = host.querySelector<HTMLElement>(".dock-panel__grip")!;
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

    // 420 - 200 = 220 raw, under the 300px floor-minus-slack threshold.
    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 700,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    // Armed, but still mounted and still at the floor: the panel dims rather
    // than vanishing under the pointer.
    expect(dockCollapseArmed.value).toBe(true);
    expect(dockWidthLive.value).toBe(DOCK_WIDTH_MIN);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector(".dock-panel.is-collapse-armed")).not.toBeNull();

    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    // The floor must NOT be persisted as the user's preferred width — they
    // asked for the column to go away, not for a 360px column next time.
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(dockCollapseArmed.value).toBe(false);
    expect(dockWidthLive.value).toBeNull();
  });

  it("pulling back inside the floor before release resizes instead of closing", async () => {
    const onWidthChange = vi.fn();
    const onClose = vi.fn();
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(true)}
          activeTab="explorer"
          onSelectTab={() => {}}
          width={420}
          onWidthChange={onWidthChange}
          onClose={onClose}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const grip = host.querySelector<HTMLElement>(".dock-panel__grip")!;
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
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 700,
          pointerId: 1,
          bubbles: true,
        }),
      );
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: 460,
          pointerId: 1,
          bubbles: true,
        }),
      );
    });
    expect(dockCollapseArmed.value).toBe(false);

    await act(async () => {
      grip.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onWidthChange).toHaveBeenCalledWith(460);
  });
});

describe("DockPanel header", () => {
  // The hide control is NOT here any more: it moved to the stage strip on
  // 2026-08-16, because a closed column cannot hold its own way back out
  // (DL-18.9's reasoning, applied to the other edge). What the header holds
  // now is the tab row.
  it("holds the tab row and no hide control", () => {
    const onSelectTab = vi.fn();
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(true)}
          activeTab="explorer"
          onSelectTab={onSelectTab}
          width={420}
          onWidthChange={() => {}}
          onClose={() => {}}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const header = host.querySelector(".dock-panel__header")!;
    expect(header.querySelector('[role="tablist"]')).not.toBeNull();
    expect(header.querySelector(".iconbtn")).toBeNull();

    const chips = header.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(chips.length).toBe(3);
    act(() => {
      chips[1].click();
    });
    expect(onSelectTab).toHaveBeenCalledWith("usage");
  });

  // A host with no `sessions_list` gets two chips, not three greyed ones.
  it("shows only the tabs the host can answer for", () => {
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(false)}
          activeTab="explorer"
          onSelectTab={() => {}}
          width={420}
          onWidthChange={() => {}}
          onClose={() => {}}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const labels = Array.from(
      host.querySelectorAll('[role="tab"] .dock-tabs__label'),
    ).map((node) => node.textContent);
    expect(labels).toEqual(["File explorer", "Token usage"]);
  });
});

describe("DockPanel — both chrome layouts", () => {
  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
  });

  afterEach(() => {
    resetDesktopEnvironmentForTests();
  });

  it.each([true, false])(
    "mounts the dock node in the stage when sidebar=%s",
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
                <DockPanel
                  tabs={availableDockTabs(true)}
                  activeTab="explorer"
                  onSelectTab={() => {}}
                  width={420}
                  onWidthChange={() => {}}
                  onClose={() => {}}
                >
                  <ExplorerTab controller={controller} workspacePath={WS} />
                </DockPanel>
              </main>
            }
            status={<footer />}
            onMacTitlebarDoubleClick={() => {}}
          />,
          host,
        );
      });

      expect(host.querySelector(".dock-panel")).not.toBeNull();
    },
  );
});
