import { describe, expect, it } from "vitest";
import { validateSettings } from "./settings-schema";
import { withWorktreeColor, worktreeColorStyle, validateWorktreeColors } from "./worktree-colors";

describe("worktree colors", () => {
  it("loads old settings without overrides and drops malformed color values", () => {
    expect(validateSettings({}).worktreeColors).toEqual({});
    for (const raw of [null, undefined, [], 12, "green"]) {
      expect(validateWorktreeColors(raw)).toEqual({});
    }
    expect(
      validateSettings({
        worktreeColors: {
          "/r/main": "green",
          "/other/main": "purple",
          "/bad": "url(https://example.com)",
          "/object": { id: "cyan" },
          "": "rose",
          " ": "amber",
        },
      }).worktreeColors,
    ).toEqual({ "/r/main": "green", "/other/main": "purple" });
  });

  it("retains independent paths with identical names without mutating prior state", () => {
    const original = Object.freeze({ "/r/main": "green" as const });
    const next = withWorktreeColor(original, "/other/main", "purple");
    expect(next).toEqual({ "/r/main": "green", "/other/main": "purple" });
    expect(original).toEqual({ "/r/main": "green" });
    expect(withWorktreeColor(next, "/r/main", null)).toEqual({ "/other/main": "purple" });
    expect(worktreeColorStyle(next, "/other/main")).toEqual({
      "--worktree-color": "var(--magenta)",
    });
    expect(worktreeColorStyle(next, "/missing")).toEqual({});
    expect(
      validateSettings(JSON.parse(JSON.stringify({ worktreeColors: next }))).worktreeColors,
    ).toEqual(next);
  });
});
