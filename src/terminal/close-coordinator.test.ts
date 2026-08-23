import { describe, expect, it, vi } from "vitest";
import { createCloseCoordinator } from "./close-coordinator";
import type { TerminalManager } from "./terminal-manager";

function mockManager(
  overrides: Partial<TerminalManager> & {
    paneCount(): number;
    activePaneId(): number | null;
    paneIds(): number[];
  },
): TerminalManager {
  return overrides as TerminalManager;
}

describe("createCloseCoordinator", () => {
  it("routes last pane to closeTab", async () => {
    const disposeTab = vi.fn(async () => undefined);
    const confirmClose = vi.fn(async () => true);
    const manager = mockManager({
      paneCount: () => 1,
      activePaneId: () => 1,
      paneIds: () => [1],
      closePaneById: vi.fn(),
    });
    const entry = { manager };
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => entry,
      indexOf: () => 0,
      disposeTab,
    });
    await coord.closePane();
    expect(confirmClose).toHaveBeenCalledWith([1]);
    expect(disposeTab).toHaveBeenCalledWith(0);
    expect(manager.closePaneById).not.toHaveBeenCalled();
  });

  it("closes the confirmed pane id, not a later active pane", async () => {
    const closePaneById = vi.fn(async () => undefined);
    let activeId = 7;
    const manager = mockManager({
      paneCount: () => 2,
      activePaneId: () => activeId,
      paneIds: () => [7, 8],
      closePaneById,
    });
    const confirmClose = vi.fn(async () => {
      activeId = 8; // focus moved during dialog
      return true;
    });
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => ({ manager }),
      indexOf: () => 0,
      disposeTab: vi.fn(),
    });
    await coord.closePane();
    expect(closePaneById).toHaveBeenCalledWith(7);
  });

  it("aborts when Busy dialog declines", async () => {
    const disposeTab = vi.fn();
    const manager = mockManager({
      paneCount: () => 1,
      activePaneId: () => 1,
      paneIds: () => [1],
      closePaneById: vi.fn(),
    });
    const entry = { manager };
    const coord = createCloseCoordinator({
      confirmClose: async () => false,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => entry,
      indexOf: () => 0,
      disposeTab,
    });
    await coord.closeTab(0);
    expect(disposeTab).not.toHaveBeenCalled();
  });

  it("skips dispose when tab vanished during dialog", async () => {
    const disposeTab = vi.fn();
    const manager = mockManager({
      paneCount: () => 1,
      activePaneId: () => 1,
      paneIds: () => [1],
      closePaneById: vi.fn(),
    });
    const entry = { manager };
    const coord = createCloseCoordinator({
      confirmClose: async () => true,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => entry,
      indexOf: () => -1,
      disposeTab,
    });
    await coord.closeTab(0);
    expect(disposeTab).not.toHaveBeenCalled();
  });
});

describe("closePaneAt — the rail's per-agent close (close model, 2026-08-22)", () => {
  it("closes one pane of a BACKGROUND tab", async () => {
    // The path `closePane()` cannot reach: it only ever means the focused pane
    // of the ACTIVE tab, and the rail points at a pane in a tab that is not
    // selected.
    const closePaneById = vi.fn(async () => undefined);
    const background = mockManager({
      paneCount: () => 2,
      activePaneId: () => 41,
      paneIds: () => [41, 42],
      closePaneById,
    });
    const active = mockManager({
      paneCount: () => 1,
      activePaneId: () => 11,
      paneIds: () => [11],
      closePaneById: vi.fn(),
    });
    const confirmClose = vi.fn(async () => true);
    const disposeTab = vi.fn(async () => undefined);
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => active,
      activeIndex: () => 0,
      tabAt: (index) => (index === 1 ? { manager: background } : { manager: active }),
      indexOf: () => 1,
      disposeTab,
    });

    await coord.closePaneAt(1, 42);
    expect(confirmClose).toHaveBeenCalledWith([42]);
    expect(closePaneById).toHaveBeenCalledWith(42);
    expect(disposeTab).not.toHaveBeenCalled();
  });

  it("routes the tab's LAST pane to closeTab (table row 2)", async () => {
    // `paneCount()`, not the rail's agent-row count: a tab holding one agent
    // beside a plain shell has two panes and survives losing the agent.
    const closePaneById = vi.fn(async () => undefined);
    const manager = mockManager({
      paneCount: () => 1,
      activePaneId: () => 11,
      paneIds: () => [11],
      closePaneById,
    });
    const disposeTab = vi.fn(async () => undefined);
    const coord = createCloseCoordinator({
      confirmClose: async () => true,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => ({ manager }),
      indexOf: () => 0,
      disposeTab,
    });

    await coord.closePaneAt(0, 11);
    expect(disposeTab).toHaveBeenCalledWith(0);
    expect(closePaneById).not.toHaveBeenCalled();
  });

  it("does nothing for a pane the tab no longer holds", async () => {
    const closePaneById = vi.fn(async () => undefined);
    const manager = mockManager({
      paneCount: () => 2,
      activePaneId: () => 41,
      paneIds: () => [41, 42],
      closePaneById,
    });
    const confirmClose = vi.fn(async () => true);
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => ({ manager }),
      indexOf: () => 0,
      disposeTab: vi.fn(),
    });

    await coord.closePaneAt(0, 99);
    expect(confirmClose).not.toHaveBeenCalled();
    expect(closePaneById).not.toHaveBeenCalled();
  });

  it("refuses a STALE index rather than closing an unrelated single-pane tab", async () => {
    // The rail read `index` at render time; a `pty:exit` closing an earlier tab
    // in between shifts every later one down, so `index` can now name a
    // different one-pane tab. Routing on its pane count would close that tab
    // outright — and silently, since `confirmClose` answers true when nothing
    // is busy. The pane id is the half of the gesture that cannot go stale.
    const stranger = mockManager({
      paneCount: () => 1,
      activePaneId: () => 77,
      paneIds: () => [77],
      closePaneById: vi.fn(),
    });
    const confirmClose = vi.fn(async () => true);
    const disposeTab = vi.fn(async () => undefined);
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => stranger,
      activeIndex: () => 0,
      tabAt: () => ({ manager: stranger }),
      indexOf: () => 0,
      disposeTab,
    });

    await coord.closePaneAt(1, 42);
    expect(disposeTab).not.toHaveBeenCalled();
    expect(confirmClose).not.toHaveBeenCalled();
  });

  it("drops a pane that exited while the dialog was up", async () => {
    const closePaneById = vi.fn(async () => undefined);
    let ids = [41, 42];
    const manager = mockManager({
      paneCount: () => 2,
      activePaneId: () => 41,
      paneIds: () => ids,
      closePaneById,
    });
    const coord = createCloseCoordinator({
      confirmClose: async () => {
        ids = [41];
        return true;
      },
      activeManager: () => manager,
      activeIndex: () => 0,
      tabAt: () => ({ manager }),
      indexOf: () => 0,
      disposeTab: vi.fn(),
    });

    await coord.closePaneAt(0, 42);
    expect(closePaneById).not.toHaveBeenCalled();
  });
});

describe("closeTabs — the rail's project close (close model, table row 4)", () => {
  function project() {
    const a = mockManager({
      paneCount: () => 1,
      activePaneId: () => 11,
      paneIds: () => [11],
      closePaneById: vi.fn(),
    });
    const b = mockManager({
      paneCount: () => 2,
      activePaneId: () => 21,
      paneIds: () => [21, 22],
      closePaneById: vi.fn(),
    });
    const entries = [{ manager: a }, { manager: b }];
    return { a, b, entries };
  }

  it("asks ONCE, over every pane of every tab", async () => {
    const { entries } = project();
    const confirmClose = vi.fn(async () => true);
    const disposeTab = vi.fn(async () => undefined);
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => entries[0].manager,
      activeIndex: () => 0,
      tabAt: (index) => entries[index],
      indexOf: (entry) => entries.findIndex((e) => e.manager === entry.manager),
      disposeTab,
    });

    await expect(coord.closeTabs([0, 1])).resolves.toBe(true);
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(confirmClose).toHaveBeenCalledWith([11, 21, 22]);
    expect(disposeTab).toHaveBeenCalledTimes(2);
  });

  it("disposes nothing when the one dialog is declined", async () => {
    const { entries } = project();
    const disposeTab = vi.fn();
    const coord = createCloseCoordinator({
      confirmClose: async () => false,
      activeManager: () => entries[0].manager,
      activeIndex: () => 0,
      tabAt: (index) => entries[index],
      indexOf: () => 0,
      disposeTab,
    });

    // `false` is what stops the caller forgetting a project whose tabs are all
    // still open.
    await expect(coord.closeTabs([0, 1])).resolves.toBe(false);
    expect(disposeTab).not.toHaveBeenCalled();
  });

  it("re-pins each tab by identity as the list shifts under it", async () => {
    // Three tabs; the project owns the last two. Disposing index 1 pulls the
    // third down to 1, so a positional replay would ask for index 2 and take
    // nothing (or, with a fourth tab, the wrong one).
    const one = (id: number) =>
      mockManager({
        paneCount: () => 1,
        activePaneId: () => id,
        paneIds: () => [id],
        closePaneById: vi.fn(),
      });
    const live = [{ manager: one(11) }, { manager: one(21) }, { manager: one(31) }];
    const snapshot = [...live];
    const disposeTab = vi.fn(async (index: number) => {
      live.splice(index, 1);
    });
    const coord = createCloseCoordinator({
      confirmClose: async () => true,
      activeManager: () => live[0].manager,
      activeIndex: () => 0,
      tabAt: (index) => snapshot[index],
      indexOf: (entry) => live.findIndex((e) => e.manager === entry.manager),
      disposeTab,
    });

    await coord.closeTabs([1, 2]);
    expect(disposeTab.mock.calls.map((call) => call[0])).toEqual([1, 1]);
    expect(live).toHaveLength(1);
  });

  it("answers false for an empty selection", async () => {
    const confirmClose = vi.fn(async () => true);
    const coord = createCloseCoordinator({
      confirmClose,
      activeManager: () => null,
      activeIndex: () => -1,
      tabAt: () => undefined,
      indexOf: () => -1,
      disposeTab: vi.fn(),
    });

    await expect(coord.closeTabs([])).resolves.toBe(false);
    expect(confirmClose).not.toHaveBeenCalled();
  });
});
