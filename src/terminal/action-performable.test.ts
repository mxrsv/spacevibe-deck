import { describe, expect, it } from "vitest";
import { isActionPerformable, type PerformableContext } from "./action-performable";

const context = (overrides: Partial<PerformableContext> = {}): PerformableContext => ({
  stageOwner: "terminal",
  hasSelection: false,
  keymapPlatform: "macos",
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

  it("performs toggle-markdown-view over a surface that offers a second view", () => {
    expect(
      isActionPerformable(
        "toggle-markdown-view",
        context({ stageOwner: "surface", surfaceCanToggleView: true }),
      ),
    ).toBe(true);
  });

  it("refuses toggle-markdown-view over a surface with only one view", () => {
    // A `.ts` file on the stage: ⌘⇧V must reach Monaco, not die here.
    expect(
      isActionPerformable(
        "toggle-markdown-view",
        context({ stageOwner: "surface", surfaceCanToggleView: false }),
      ),
    ).toBe(false);
  });

  it.each(["terminal", "overlay"] as const)(
    "refuses toggle-markdown-view while %s owns the stage",
    (stageOwner) => {
      expect(
        isActionPerformable(
          "toggle-markdown-view",
          context({ stageOwner, surfaceCanToggleView: true }),
        ),
      ).toBe(false);
    },
  );

  it("reads an absent surfaceCanToggleView as no second view", () => {
    // The field is optional so every context literal written before
    // 2026-08-23 keeps compiling; absent must fail toward not consuming.
    expect(isActionPerformable("toggle-markdown-view", context({ stageOwner: "surface" }))).toBe(
      false,
    );
  });
});

describe("toggle-mission-control", () => {
  it("consumes the chord while a terminal tab is open", () => {
    expect(isActionPerformable("toggle-mission-control", context({ hasTerminalTab: true }))).toBe(
      true,
    );
  });

  it("leaves the keystroke alone with no terminal tab", () => {
    expect(isActionPerformable("toggle-mission-control", context({ hasTerminalTab: false }))).toBe(
      false,
    );
  });

  it("reads an absent hasTerminalTab as no tab", () => {
    // The field is optional so every context literal written before this keeps
    // compiling; absent must fail toward not consuming, exactly as
    // `surfaceCanToggleView` does.
    expect(isActionPerformable("toggle-mission-control", context())).toBe(false);
  });

  it("consumes the chord over a terminal or a surface", () => {
    for (const stageOwner of ["terminal", "surface"] as const) {
      expect(
        isActionPerformable(
          "toggle-mission-control",
          context({ stageOwner, hasTerminalTab: true }),
        ),
      ).toBe(true);
    }
  });

  it("consumes it over its own overlay, so Mission Control can be left, and not over another", () => {
    // The close branch fires while Mission Control is up, which `stageOwner()`
    // reports as "overlay"; behind Settings or a modal it cannot open, so the
    // key must reach whatever holds focus.
    const overlay = { stageOwner: "overlay" as const, hasTerminalTab: true };
    expect(
      isActionPerformable(
        "toggle-mission-control",
        context({ ...overlay, missionControlOpen: true }),
      ),
    ).toBe(true);
    expect(isActionPerformable("toggle-mission-control", context(overlay))).toBe(false);
  });
});

/**
 * `save-file` is bare ⌘S on macOS and bare Ctrl+S on Windows, and both keymaps
 * read this one predicate table. macOS has always consumed ⌘S wherever it was
 * pressed, so the macOS answer is pinned to "true for every stage owner" and
 * the Windows rule is the only thing allowed to differ.
 */
describe("isActionPerformable — save-file", () => {
  const STAGE_OWNERS = ["terminal", "surface", "overlay"] as const;

  it.each(STAGE_OWNERS)("keeps consuming ⌘S on macOS with %s on the stage", (stageOwner) => {
    expect(isActionPerformable("save-file", context({ stageOwner, keymapPlatform: "macos" }))).toBe(
      true,
    );
  });

  it("consumes Ctrl+S on Windows while a surface owns the stage", () => {
    expect(
      isActionPerformable(
        "save-file",
        context({ stageOwner: "surface", keymapPlatform: "windows" }),
      ),
    ).toBe(true);
  });

  it.each(["terminal", "overlay"] as const)(
    "leaves Ctrl+S to the PTY or the overlay on Windows with %s on the stage",
    (stageOwner) => {
      expect(
        isActionPerformable("save-file", context({ stageOwner, keymapPlatform: "windows" })),
      ).toBe(false);
    },
  );
});
