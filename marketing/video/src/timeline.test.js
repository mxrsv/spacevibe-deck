import { describe, expect, it } from "vitest";

import {
  createSampler,
  sampleNumber,
  sampleStep,
  window01,
} from "./timeline.js";

const keys = [
  { t: 0, v: 0 },
  { t: 1, v: 10, ease: "linear" },
  { t: 2, v: 20, ease: "linear" },
];

describe("sampleNumber", () => {
  it("clamps outside the keyframe range", () => {
    expect(sampleNumber(keys, -5)).toBe(0);
    expect(sampleNumber(keys, 99)).toBe(20);
  });

  it("interpolates within a segment", () => {
    expect(sampleNumber(keys, 0.5)).toBeCloseTo(5);
    expect(sampleNumber(keys, 1.25)).toBeCloseTo(12.5);
  });

  it("lands exactly on keyframes", () => {
    expect(sampleNumber(keys, 1)).toBe(10);
  });

  it("applies the easing named on the segment's end keyframe", () => {
    const eased = [
      { t: 0, v: 0 },
      { t: 1, v: 1, ease: "easeInCubic" },
    ];

    expect(sampleNumber(eased, 0.5)).toBeCloseTo(0.125);
  });

  it("rejects an empty track", () => {
    expect(() => sampleNumber([], 0, "empty")).toThrow(/no keyframes/i);
  });

  it("is a pure function of time", () => {
    const first = sampleNumber(keys, 1.37);
    const second = sampleNumber(keys, 1.37);

    expect(first).toBe(second);
  });
});

describe("sampleStep", () => {
  const steps = [
    { t: 0, v: "board" },
    { t: 3, v: "grid" },
    { t: 9, v: "expanded" },
  ];

  it("holds the latest value that is due", () => {
    expect(sampleStep(steps, 0)).toBe("board");
    expect(sampleStep(steps, 2.99)).toBe("board");
    expect(sampleStep(steps, 3)).toBe("grid");
    expect(sampleStep(steps, 100)).toBe("expanded");
  });
});

describe("window01", () => {
  it("ramps from 0 to 1 across the window and clamps outside it", () => {
    expect(window01(0, 1, 2)).toBe(0);
    expect(window01(2, 1, 2)).toBeCloseTo(0.5);
    expect(window01(9, 1, 2)).toBe(1);
  });

  it("rejects a non-positive duration", () => {
    expect(() => window01(0, 0, 0)).toThrow(/positive duration/i);
  });
});

describe("createSampler", () => {
  const sampler = createSampler({
    scale: { keys },
    view: { step: true, keys: [{ t: 0, v: "a" }] },
  });

  it("reads numeric and step tracks by name", () => {
    expect(sampler.num("scale", 1)).toBe(10);
    expect(sampler.step("view", 5)).toBe("a");
  });

  it("refuses to read a track as the wrong kind", () => {
    expect(() => sampler.num("view", 0)).toThrow(/numeric track/i);
    expect(() => sampler.step("scale", 0)).toThrow(/step track/i);
  });
});
