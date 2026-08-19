import { describe, expect, it } from "vitest";
import { leafIds } from "../lib/split-tree";
import {
  canRemove,
  createMockModel,
  moveSelection,
  nudgeSelected,
  removeSelected,
  selectPane,
  setMockRatio,
  setSelectedCwd,
  splitSelected,
  toPresetArtifact,
} from "./mock-model";

describe("mock model", () => {
  it("starts as a single selected pane and cannot remove it", () => {
    const model = createMockModel();
    expect(leafIds(model.tree)).toEqual([1]);
    expect(model.selectedId).toBe(1);
    expect(canRemove(model)).toBe(false);
    expect(removeSelected(model)).toBe(model);
  });

  it("split selects the new pane; remove collapses back", () => {
    const two = splitSelected(createMockModel(), "row");
    expect(leafIds(two.tree)).toEqual([1, 2]);
    expect(two.selectedId).toBe(2);
    const one = removeSelected(two);
    expect(leafIds(one.tree)).toEqual([1]);
    expect(one.selectedId).toBe(1);
  });

  it("selection moves by step and by explicit pick, ignoring unknown ids", () => {
    const model = splitSelected(createMockModel(), "row");
    expect(moveSelection(model, -1).selectedId).toBe(1);
    expect(selectPane(model, 1).selectedId).toBe(1);
    expect(selectPane(model, 99)).toBe(model);
  });

  it("cwd set/clear is per selected pane and dropped on remove", () => {
    let model = splitSelected(createMockModel(), "row");
    model = setSelectedCwd(model, "/work");
    expect(model.cwds.get(2)).toBe("/work");
    model = setSelectedCwd(model, null);
    expect(model.cwds.has(2)).toBe(false);
    // Actually exercise the remove path (removeSelected), not just an
    // explicit clear — the two are different code paths in mock-model.ts.
    model = setSelectedCwd(model, "/again");
    model = removeSelected(model);
    expect(model.cwds.has(2)).toBe(false);
  });

  it("ratio set and nudge are clamped to 0.15–0.85", () => {
    let model = splitSelected(createMockModel(), "row");
    model = setMockRatio(model, [], 0.95);
    expect(model.tree.kind === "split" && model.tree.ratio).toBe(0.85);
    model = nudgeSelected(model, 0.05); // selected pane 2 = branch b → shrink a
    expect(model.tree.kind === "split" && model.tree.ratio).toBeCloseTo(0.8, 10);
  });

  it("artifact zips cwds left-to-right and omits an all-inherit map", () => {
    let model = splitSelected(createMockModel(), "row");
    expect(toPresetArtifact(model).cwds).toBeUndefined();
    model = selectPane(model, 1);
    model = setSelectedCwd(model, "/a");
    expect(toPresetArtifact(model)).toEqual({
      layout: {
        type: "split",
        direction: "row",
        ratio: 0.5,
        first: { type: "leaf" },
        second: { type: "leaf" },
      },
      cwds: ["/a", null],
    });
  });
});
