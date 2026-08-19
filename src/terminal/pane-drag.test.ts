import { describe, expect, it } from "vitest";
import type { PaneRect } from "../lib/pane-geometry";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { dragModeForEvent, dropTargetAt, edgeFor } from "./pane-drag";

// Two panes side by side: |  1  |  2  |
const LEFT: PaneRect = { id: 1, left: 0, top: 0, right: 100, bottom: 100 };
const RIGHT: PaneRect = { id: 2, left: 100, top: 0, right: 200, bottom: 100 };
const RECTS = [LEFT, RIGHT];

describe("edgeFor", () => {
  it("picks the nearest edge by normalized distance", () => {
    expect(edgeFor(LEFT, 5, 50)).toBe("left");
    expect(edgeFor(LEFT, 95, 50)).toBe("right");
    expect(edgeFor(LEFT, 50, 5)).toBe("top");
    expect(edgeFor(LEFT, 50, 95)).toBe("bottom");
  });

  it("normalizes by size, so a wide pane still splits top/bottom near those edges", () => {
    const wide: PaneRect = { id: 3, left: 0, top: 0, right: 400, bottom: 100 };
    // 30px from the top is 30% of the height; at the horizontal center
    // left/right sit at 50% — top wins despite the pane being 4× wider.
    expect(edgeFor(wide, 200, 30)).toBe("top");
  });
});

describe("dropTargetAt", () => {
  it("returns the hovered pane, its edge and its rect", () => {
    const hit = dropTargetAt(RECTS, 150, 10, 1);
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe(2);
    expect(hit!.edge).toBe("top");
    expect(hit!.rect).toBe(RIGHT);
  });

  it("never docks onto the source pane itself", () => {
    expect(dropTargetAt(RECTS, 50, 50, 1)).toBeNull();
  });

  it("returns null outside every pane", () => {
    expect(dropTargetAt(RECTS, 300, 50, 1)).toBeNull();
  });
});

describe("dragModeForEvent", () => {
  it("uses Cmd on macOS and Ctrl on Windows", () => {
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    expect(dragModeForEvent({ metaKey: true, ctrlKey: false })).toBe("swap");
    expect(dragModeForEvent({ metaKey: false, ctrlKey: true })).toBe("dock");

    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    expect(dragModeForEvent({ metaKey: true, ctrlKey: false })).toBe("dock");
    expect(dragModeForEvent({ metaKey: false, ctrlKey: true })).toBe("swap");
    resetDesktopEnvironmentForTests();
  });
});
