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
  return {
    ptyPaneIds: () => overrides.paneIds(),
    ...overrides,
  } as TerminalManager;
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

  it("closes a native pane without sending its id through the PTY busy guard", async () => {
    const closePaneById = vi.fn(async () => undefined);
    const confirmClose = vi.fn(async () => true);
    const manager = mockManager({
      paneCount: () => 2,
      activePaneId: () => 0x8000_0000,
      paneIds: () => [1, 0x8000_0000],
      ptyPaneIds: () => [1],
      closePaneById,
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

    expect(confirmClose).not.toHaveBeenCalled();
    expect(closePaneById).toHaveBeenCalledWith(0x8000_0000);
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
