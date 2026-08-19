import { describe, expect, it } from "vitest";
import { validateLayout } from "./layout-validation";

describe("validateLayout", () => {
  it("accepts a leaf", () => {
    expect(validateLayout({ type: "leaf" })).toEqual({ type: "leaf" });
  });

  it("accepts a nested split and strips unknown fields", () => {
    const raw = {
      type: "split",
      direction: "row",
      ratio: 0.4,
      first: { type: "leaf", junk: 1 },
      second: { type: "leaf" },
      extra: true,
    };
    expect(validateLayout(raw)).toEqual({
      type: "split",
      direction: "row",
      ratio: 0.4,
      first: { type: "leaf" },
      second: { type: "leaf" },
    });
  });

  it("rejects out-of-range ratios", () => {
    const raw = {
      type: "split",
      direction: "row",
      ratio: 1,
      first: { type: "leaf" },
      second: { type: "leaf" },
    };
    expect(validateLayout(raw)).toBeNull();
  });

  it("rejects trees deeper than MAX_LAYOUT_DEPTH", () => {
    let node: unknown = { type: "leaf" };
    for (let i = 0; i < 10; i += 1) {
      node = {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: node,
        second: { type: "leaf" },
      };
    }
    expect(validateLayout(node)).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(validateLayout("leaf")).toBeNull();
    expect(validateLayout(null)).toBeNull();
  });
});
