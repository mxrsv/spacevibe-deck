import { describe, expect, it } from "vitest";
import {
  initialLock,
  onBackground,
  onEnabledChange,
  onForeground,
  onUnlocked,
  RELOCK_AFTER_MS,
} from "./lock-state";

describe("lock state (MOB4)", () => {
  it("launches locked when the lock is on, open when it is off", () => {
    expect(initialLock(true).locked).toBe(true);
    expect(initialLock(false).locked).toBe(false);
  });

  it("stays open after a short trip to the background", () => {
    const open = onUnlocked(initialLock(true));
    const back = onForeground(onBackground(open, 0), RELOCK_AFTER_MS - 1);
    expect(back.locked).toBe(false);
  });

  it("relocks after five minutes away", () => {
    const open = onUnlocked(initialLock(true));
    const back = onForeground(onBackground(open, 0), RELOCK_AFTER_MS);
    expect(back.locked).toBe(true);
  });

  it("never relocks when the lock is off", () => {
    const open = initialLock(false);
    expect(onForeground(onBackground(open, 0), RELOCK_AFTER_MS * 10).locked).toBe(false);
  });

  it("measures from the first background event, not a later one", () => {
    const open = onUnlocked(initialLock(true));
    const twice = onBackground(onBackground(open, 0), RELOCK_AFTER_MS - 1_000);
    expect(onForeground(twice, RELOCK_AFTER_MS).locked).toBe(true);
  });

  it("opens at once when the lock is switched off, and does not lock the open session when it is switched on", () => {
    expect(onEnabledChange(initialLock(true), false).locked).toBe(false);
    expect(onEnabledChange(initialLock(false), true).locked).toBe(false);
  });

  it("ignores a foreground event that had no background event", () => {
    const state = onUnlocked(initialLock(true));
    expect(onForeground(state, 10 ** 12)).toBe(state);
  });
});
