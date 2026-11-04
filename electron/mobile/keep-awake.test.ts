import { describe, expect, it, vi } from "vitest";
import { createKeepAwake, shouldKeepAwake } from "./keep-awake";

function setup() {
  const state = { working: 0, phones: 0 };
  const blocker = { start: vi.fn(() => 7), stop: vi.fn() };
  const awake = createKeepAwake({
    blocker,
    workingPanes: () => state.working,
    pairedPhones: () => state.phones,
  });
  return { state, blocker, awake };
}

describe("keep awake", () => {
  it("needs both a working pane and a paired phone", () => {
    expect(shouldKeepAwake(0, 1)).toBe(false);
    expect(shouldKeepAwake(2, 0)).toBe(false);
    expect(shouldKeepAwake(1, 1)).toBe(true);
  });

  it("starts once, stops when the work or the phone goes, and never double-starts", () => {
    const { state, blocker, awake } = setup();
    state.phones = 1;
    awake.evaluate();
    expect(blocker.start).not.toHaveBeenCalled();
    state.working = 1;
    awake.evaluate();
    awake.evaluate();
    expect(blocker.start).toHaveBeenCalledOnce();
    expect(blocker.start).toHaveBeenCalledWith("prevent-app-suspension");
    expect(awake.active).toBe(true);
    state.working = 0;
    awake.evaluate();
    expect(blocker.stop).toHaveBeenCalledWith(7);
    expect(awake.active).toBe(false);
  });

  it("releases on quit and after the last phone is revoked", () => {
    const { state, blocker, awake } = setup();
    state.working = 1;
    state.phones = 1;
    awake.evaluate();
    state.phones = 0;
    awake.evaluate();
    expect(blocker.stop).toHaveBeenCalledOnce();
    state.phones = 1;
    awake.evaluate();
    awake.release();
    awake.release();
    expect(blocker.stop).toHaveBeenCalledTimes(2);
  });
});
