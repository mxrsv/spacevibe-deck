// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DockPanel } from "./dock-panel";
import { availableDockTabs } from "./dock-tab-registry";
import { ExplorerTab } from "../../files/ui/explorer-tab";
import { DesktopChrome } from "../desktop-chrome";
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
    // Armed, and still MOUNTED: the panel is painted away by `App` (which
    // reads this signal through `dockPaintedOpen`), but the node stays because
    // the pointer is captured on the grip inside it. The 45% dim this used to
    // assert is gone with the wait-for-release behaviour it belonged to
    // (DL-19.4, amended 2026-08-19). Nothing is written until release.
    expect(dockCollapseArmed.value).toBe(true);
    expect(dockWidthLive.value).toBe(DOCK_WIDTH_MIN);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector(".dock-panel")).not.toBeNull();
    // No easing inside a gesture: the pointer is the clock.
    expect(host.querySelector(".dock-panel.is-dragging")).not.toBeNull();

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
  // The hide control came BACK here on 2026-08-19 (DL-19.3, amended again):
  // a shown column carries its own control at its outer edge, the way the
  // sidebar's rides the frame row beside the traffic lights. Only the closed
  // half stayed on the stage strip, and `App` gates that one on the panel
  // being absent — that gate is asserted in `app.test.tsx`, not here.
  it("holds the tab row and ends it with the hide control", () => {
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

    const hide = header.querySelector<HTMLButtonElement>(":scope > .iconbtn")!;
    expect(hide).not.toBeNull();
    // Painted as open, because this mount only exists while the column is.
    expect(hide.getAttribute("aria-label")).toBe("Hide the side panel");
    // Last in the row: the auto-margined tab group sits immediately before it.
    expect(header.lastElementChild).toBe(hide);

    const chips = header.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(chips.length).toBe(3);
    act(() => {
      chips[1].click();
    });
    expect(onSelectTab).toHaveBeenCalledWith("usage");
  });

  // The panel's own control goes through `onClose`, the same seam the
  // drag-past-the-floor gesture uses: `App` routes it into the `toggle-dock`
  // action, which owns the focus guard. A raw settings write would skip it.
  it("closes through onClose, not through a settings write of its own", () => {
    const onClose = vi.fn();
    act(() => {
      render(
        <DockPanel
          tabs={availableDockTabs(true)}
          activeTab="explorer"
          onSelectTab={() => {}}
          width={420}
          onWidthChange={() => {}}
          onClose={onClose}
        >
          <ExplorerTab controller={controller} workspacePath={WS} />
        </DockPanel>,
        host,
      );
    });

    const hide = host.querySelector<HTMLButtonElement>(
      ".dock-panel__header > .iconbtn",
    )!;
    act(() => {
      hide.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The icon-only tabs and toggle form one compact cluster at the outer edge.
  it("pins the tab group beside the trailing hide control", () => {
    const sheet = readFileSync("src/styles/14-dock.css", "utf8");
    const tabsStart = sheet.indexOf("\n.dock-tabs {");
    expect(
      tabsStart,
      "no trailing-edge rule for the dock's tab group",
    ).toBeGreaterThan(-1);
    const tabsBody = sheet.slice(
      sheet.indexOf("{", tabsStart) + 1,
      sheet.indexOf("}", tabsStart),
    );
    expect(tabsBody).toMatch(/margin-left:\s*auto/);

    const toggleStart = sheet.indexOf("\n.dock-panel__header > .iconbtn {");
    const toggleBody = sheet.slice(
      sheet.indexOf("{", toggleStart) + 1,
      sheet.indexOf("}", toggleStart),
    );
    expect(toggleBody).toMatch(/flex-shrink:\s*0/);
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
      host.querySelectorAll('[role="tab"]'),
    ).map((node) => node.getAttribute("aria-label"));
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

/**
 * The dock's header and the stage strip stand side by side across one seam, so
 * a height literal in either file is a hairline that breaks in the middle of
 * the window. Asserted against the stylesheets rather than a rendered box:
 * jsdom applies no stylesheet, and the point is that neither rule owns a
 * number of its own.
 */
describe("dock header height (aligned with the stage strip)", () => {
  function ruleBody(file: string, selector: string): string {
    const sheet = readFileSync(file, "utf8");
    const start = sheet.indexOf(`\n${selector} {`);
    expect(start, `no \`${selector} {\` rule in ${file}`).toBeGreaterThan(-1);
    const open = sheet.indexOf("{", start);
    return sheet.slice(open + 1, sheet.indexOf("}", open));
  }

  it("takes its height from --frame-h, the same token the stage strip does", () => {
    const header = ruleBody("src/styles/14-dock.css", ".dock-panel__header");
    const strip = ruleBody("src/styles/06-stage-panes.css", ".stage__strip");
    expect(header).toMatch(/height:\s*var\(--frame-h\)/);
    expect(strip).toMatch(/height:\s*var\(--frame-h\)/);
  });

  it("keeps its own seam off that height, so both hairlines land on one row", () => {
    const header = ruleBody("src/styles/14-dock.css", ".dock-panel__header");
    expect(header).toMatch(/border-bottom:\s*1px solid/);
    // No global reset in this app: without border-box the seam adds a pixel.
    expect(header).toMatch(/box-sizing:\s*border-box/);
  });
});
