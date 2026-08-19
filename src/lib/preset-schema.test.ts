import { describe, expect, it } from "vitest";
import type { SerializedNode } from "./split-tree";
import {
  BUILT_IN_PRESET,
  isBuiltIn,
  removePreset,
  renamePresetIn,
  resolveCwds,
  upsertPreset,
  validatePresets,
  type Preset,
} from "./preset-schema";

const SPLIT: SerializedNode = {
  type: "split",
  direction: "row",
  ratio: 0.5,
  first: { type: "leaf" },
  second: { type: "leaf" },
};

const QUAD: Preset = {
  id: "p1",
  name: "quad",
  layout: SPLIT,
  cwds: ["/work", null],
};

describe("validatePresets", () => {
  it("returns an empty store for corrupt envelopes", () => {
    expect(validatePresets(undefined)).toEqual({ version: 1, presets: [] });
    expect(validatePresets({ version: 2, presets: [] })).toEqual({
      version: 1,
      presets: [],
    });
  });

  it("keeps valid presets and drops invalid entries", () => {
    const raw = {
      version: 1,
      presets: [
        { id: "a", name: "ok", layout: { type: "leaf" } },
        { id: "b", name: "", layout: { type: "leaf" } },
        { id: "c", name: "bad-layout", layout: { type: "grid" } },
        "junk",
      ],
      lastUsedId: "a",
    };
    const data = validatePresets(raw);
    expect(data.presets.map((preset) => preset.id)).toEqual(["a"]);
    expect(data.lastUsedId).toBe("a");
  });

  it("drops a cwds array whose length does not match the leaf count", () => {
    const raw = {
      version: 1,
      presets: [{ id: "a", name: "two", layout: SPLIT, cwds: ["/only-one"] }],
    };
    expect(validatePresets(raw).presets[0].cwds).toBeUndefined();
  });

  it("drops lastUsedId that points at no preset", () => {
    const raw = { version: 1, presets: [], lastUsedId: "ghost" };
    expect(validatePresets(raw).lastUsedId).toBeUndefined();
  });
});

describe("pure CRUD ops", () => {
  it("upsert appends new and replaces by id without mutating", () => {
    const one = upsertPreset([], QUAD);
    expect(one).toHaveLength(1);
    const renamedQuad = { ...QUAD, name: "quad-2" };
    const two = upsertPreset(one, renamedQuad);
    expect(two).toHaveLength(1);
    expect(two[0].name).toBe("quad-2");
    expect(one[0].name).toBe("quad");
  });

  it("rename and remove target by id and ignore unknown ids", () => {
    const list = [QUAD];
    expect(renamePresetIn(list, "p1", "grid")[0].name).toBe("grid");
    expect(renamePresetIn(list, "nope", "x")).toEqual(list);
    expect(removePreset(list, "p1")).toEqual([]);
    expect(removePreset(list, "nope")).toEqual(list);
  });
});

describe("resolveCwds", () => {
  it("uses the preset cwd when set, else the workspace folder", () => {
    expect(resolveCwds(QUAD, "/ws")).toEqual(["/work", "/ws"]);
  });

  it("fills every leaf with the workspace when the preset has no cwds", () => {
    expect(resolveCwds(BUILT_IN_PRESET, "/ws")).toEqual(["/ws"]);
  });
});

describe("built-in preset", () => {
  it("is a single leaf with no cwds and is recognizable", () => {
    expect(BUILT_IN_PRESET.layout).toEqual({ type: "leaf" });
    expect(BUILT_IN_PRESET.cwds).toBeUndefined();
    expect(isBuiltIn(BUILT_IN_PRESET)).toBe(true);
    expect(isBuiltIn(QUAD)).toBe(false);
  });
});
