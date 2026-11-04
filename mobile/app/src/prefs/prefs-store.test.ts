import { describe, expect, it } from "vitest";
import { memoryKeyValue } from "@/storage/key-value";
import { createPrefsController, DEFAULT_PREFS, parsePrefs } from "./prefs-store";

describe("prefs", () => {
  it("defaults to Face ID lock on and notifications on", () => {
    expect(DEFAULT_PREFS).toEqual({ faceIdLock: true, notifications: true });
  });

  it("falls back to the safe defaults for corrupt or partial values", () => {
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[]")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"faceIdLock":"no"}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"faceIdLock":false}')).toEqual({ faceIdLock: false, notifications: true });
  });

  it("is not loaded until read, then persists updates and notifies", async () => {
    const kv = memoryKeyValue();
    const prefs = createPrefsController(kv);
    expect(prefs.getSnapshot().loaded).toBe(false);
    let calls = 0;
    prefs.subscribe(() => calls++);
    await prefs.load();
    expect(prefs.getSnapshot().loaded).toBe(true);
    await prefs.update({ faceIdLock: false });
    expect(prefs.getSnapshot().prefs.faceIdLock).toBe(false);
    expect(calls).toBe(2);

    const again = createPrefsController(kv);
    await again.load();
    expect(again.getSnapshot().prefs).toEqual({ faceIdLock: false, notifications: true });
  });
});
