import { describe, expect, it } from "vitest";
import { memoryKeyValue } from "@/storage/key-value";
import { createPrefsController, DEFAULT_PREFS, parsePrefs, zoomFor } from "@/prefs/prefs-store";
import { fitFontSize, pinchZoom, snapZoom, stepZoom, zoomLabel, ZOOM_STEPS } from "./zoom";

describe("zoom steps", () => {
  it("are the fixed list 50 to 200", () => {
    expect(ZOOM_STEPS).toEqual([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200]);
  });

  it("snap a pinch to the nearest step", () => {
    expect(snapZoom(103)).toBe(100);
    expect(snapZoom(118)).toBe(125);
    expect(snapZoom(10)).toBe(50);
    expect(snapZoom(900)).toBe(200);
    expect(snapZoom(Number.NaN)).toBe(100);
    expect(pinchZoom(100, 1.52)).toBe(150);
    expect(pinchZoom(100, 0.5)).toBe(50);
  });

  it("step up and down, and stop at the ends", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(200, 1)).toBe(200);
    expect(stepZoom(50, -1)).toBe(50);
  });
});

describe("fitFontSize", () => {
  it("makes the columns fill the width at 100%, and scales with the zoom", () => {
    const at100 = fitFontSize(393, 64, 100);
    expect(at100 * 0.602 * 64).toBeLessThanOrEqual(393);
    expect(at100 * 0.602 * 64).toBeGreaterThan(385);
    expect(fitFontSize(393, 64, 200)).toBeCloseTo(at100 * 2, 0);
    expect(fitFontSize(0, 64, 100)).toBe(10);
  });

  it("labels the chip like the mock", () => {
    expect(zoomLabel(64, 100)).toBe("64 cols · 100%");
  });
});

describe("zoom per desktop on this device", () => {
  it("is remembered per desktop and restored after a restart", async () => {
    const kv = memoryKeyValue();
    const prefs = createPrefsController(kv);
    await prefs.load();
    expect(zoomFor(prefs.getSnapshot().prefs, "desktop-a")).toBe(100);
    await prefs.setTerminalZoom("desktop-a", 150);
    await prefs.setTerminalZoom("desktop-b", 75);
    const again = createPrefsController(kv);
    await again.load();
    expect(zoomFor(again.getSnapshot().prefs, "desktop-a")).toBe(150);
    expect(zoomFor(again.getSnapshot().prefs, "desktop-b")).toBe(75);
    expect(zoomFor(again.getSnapshot().prefs, "desktop-c")).toBe(100);
  });

  it("ignores a stored value that is not a step", () => {
    expect(zoomFor(parsePrefs('{"terminalZoom":{"a":133,"b":150}}'), "a")).toBe(100);
    expect(zoomFor(parsePrefs('{"terminalZoom":{"a":133,"b":150}}'), "b")).toBe(150);
    expect(DEFAULT_PREFS.terminalZoom).toEqual({});
  });
});
