import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import {
  agentBoardOpen,
  agentBoardOpenedAt,
  agentBoardSurfaceActive,
  boardHeldOrder,
  boardProjectFilter,
  boardSelectedPaneId,
  boardStatusFilter,
  closeAgentBoard,
  boardSnapshotTick,
  installSnapshotRefresh,
  openAgentBoard,
  resetAgentBoardStore,
  selectBoardCard,
  SNAPSHOT_THROTTLE_MS,
  stepAgentBoardBack,
} from "./agent-board-store";

describe("agent-board-store", () => {
  beforeEach(() => {
    resetOpenSequence();
    resetAgentBoardStore();
  });

  it("opens once, takes one open-order slot, and steps back without losing the chip", () => {
    openAgentBoard();
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(true);
    const slot = agentBoardOpenedAt.value;
    expect(slot).not.toBe(UNSEQUENCED);
    stepAgentBoardBack();
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(false);
    openAgentBoard();
    expect(agentBoardOpenedAt.value).toBe(slot);
  });
  it("snapshots the held order on select and clears it on deselect", () => {
    selectBoardCard(4, [4, 2, 9]);
    expect(boardSelectedPaneId.value).toBe(4);
    expect(boardHeldOrder.value).toEqual([4, 2, 9]);
    selectBoardCard(null, []);
    expect(boardSelectedPaneId.value).toBeNull();
    expect(boardHeldOrder.value).toBeNull();
  });
  it("close resets every Board-local value and the chip", () => {
    openAgentBoard();
    boardStatusFilter.value = "asked";
    boardProjectFilter.value = "deck";
    selectBoardCard(4, [4]);
    closeAgentBoard();
    expect(agentBoardOpen.value).toBe(false);
    expect(agentBoardSurfaceActive.value).toBe(false);
    expect(agentBoardOpenedAt.value).toBe(UNSEQUENCED);
    expect(boardStatusFilter.value).toBe("all");
    expect(boardProjectFilter.value).toBeNull();
    expect(boardSelectedPaneId.value).toBeNull();
    expect(boardHeldOrder.value).toBeNull();
  });
});

describe("the snapshot's refresh cadence (spec §7.3)", () => {
  beforeEach(() => {
    resetAgentBoardStore();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Every condition satisfied, so each case below turns exactly one off. */
  function refreshing(over: Partial<Parameters<typeof installSnapshotRefresh>[0]> = {}) {
    return installSnapshotRefresh({
      selectedPaneId: () => 11,
      paneState: () => "working",
      onStage: () => true,
      ...over,
    });
  }

  it("ticks on a throttle while the selected pane is working", () => {
    const stop = refreshing();
    const first = boardSnapshotTick.value;
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 2);
    expect(boardSnapshotTick.value).toBe(first + 2);
    stop();
  });

  it("does NOT tick while the board is off the stage", () => {
    // `stepAgentBoardBack` deliberately keeps the selection so the chord
    // returns to the same panel — so a selection alone must not keep a timer
    // running for a panel nobody can see. DL-1.2 bans a loop while the user is
    // idle, and this is precisely that.
    const stop = refreshing({ onStage: () => false });
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
    expect(boardSnapshotTick.value).toBe(0);
    stop();
  });

  it("does NOT tick for a pane that is not working", () => {
    // Spec §7.3: `changedAt` drives a quiet pane, not a timer. A `done` pane
    // ticking twice a second is a loop with nothing to show.
    const stop = refreshing({ paneState: () => "done" });
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
    expect(boardSnapshotTick.value).toBe(0);
    stop();
  });

  it("does NOT tick with no card selected", () => {
    const stop = refreshing({ selectedPaneId: () => null });
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
    expect(boardSnapshotTick.value).toBe(0);
    stop();
  });

  it("reads its conditions on every tick, not once at install", () => {
    // The deps are closures precisely so a pane that STOPS working stops the
    // ticking without the effect re-installing.
    let state = "working";
    const stop = refreshing({ paneState: () => state });
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 2);
    expect(boardSnapshotTick.value).toBe(2);
    state = "done";
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
    expect(boardSnapshotTick.value).toBe(2);
    stop();
  });

  it("stops when disposed", () => {
    refreshing()();
    vi.advanceTimersByTime(SNAPSHOT_THROTTLE_MS * 4);
    expect(boardSnapshotTick.value).toBe(0);
  });
});
