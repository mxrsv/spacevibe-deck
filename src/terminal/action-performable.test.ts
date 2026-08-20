import { describe, expect, it } from "vitest";
import { isActionPerformable, type PerformableContext } from "./action-performable";

const context = (overrides: Partial<PerformableContext> = {}): PerformableContext => ({
  stageOwner: "terminal",
  hasSelection: false,
  ...overrides,
});

describe("isActionPerformable", () => {
  it("answers true for an action with no predicate", () => {
    expect(isActionPerformable("split-row", context())).toBe(true);
    expect(isActionPerformable("split-row", context({ stageOwner: "surface" }))).toBe(true);
  });

  it("lets copy-selection consume inside a terminal with no selection", () => {
    expect(isActionPerformable("copy-selection", context())).toBe(true);
  });

  it.each(["surface", "overlay"] as const)(
    "refuses copy-selection while %s owns the stage",
    (stageOwner) => {
      expect(
        isActionPerformable("copy-selection", context({ stageOwner, hasSelection: true })),
      ).toBe(false);
    },
  );

  it("refuses copy-or-interrupt with no selection so the PTY gets the key", () => {
    expect(isActionPerformable("copy-or-interrupt", context())).toBe(false);
  });

  it("performs copy-or-interrupt with a selection in a terminal", () => {
    expect(isActionPerformable("copy-or-interrupt", context({ hasSelection: true }))).toBe(true);
  });

  it("refuses copy-or-interrupt over a surface even with a selection", () => {
    expect(
      isActionPerformable(
        "copy-or-interrupt",
        context({ stageOwner: "surface", hasSelection: true }),
      ),
    ).toBe(false);
  });
});
