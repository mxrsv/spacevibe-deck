import { Columns2 } from "lucide-preact";
import { describe, expect, it } from "vitest";
import type { ToolbarGroup, ToolbarItem } from "./toolbar-item";
import {
  fitToolbarItems,
  TOOLBAR_CONTROL_WIDTH,
  TOOLBAR_GAP,
  TOOLBAR_SEPARATOR_WIDTH,
  toolbarRowWidth,
} from "./toolbar-overflow";

/**
 * The design states overflow as rules — which action gives way first, that an
 * emptied group takes its separator with it, that persistent actions never
 * leave. Each of those is checked here rather than by looking at a narrow
 * window, because a screenshot cannot show the ORDER things were given up in.
 */

function item(
  id: string,
  group: ToolbarGroup,
  overflowOrder: number | null,
): ToolbarItem {
  return {
    id,
    label: id,
    icon: Columns2,
    group,
    shortcut: null,
    state: { kind: "idle" },
    overflowOrder,
    onActivate: () => {},
  };
}

/** The design's own bar: three tools, four pane actions, two global. */
const ITEMS: readonly ToolbarItem[] = [
  item("explorer", "tools", null),
  item("browser", "tools", null),
  item("usage", "tools", 1),
  item("split-row", "pane", 5),
  item("split-column", "pane", 4),
  item("expand", "pane", 2),
  item("close-pane", "pane", 3),
  item("prompts", "global", null),
  item("settings", "global", null),
];

const ids = (items: readonly ToolbarItem[]): readonly string[] =>
  items.map((entry) => entry.id);

describe("toolbarRowWidth", () => {
  it("counts controls, separators and the gaps between them", () => {
    expect(toolbarRowWidth(2, 1, 0)).toBe(
      TOOLBAR_CONTROL_WIDTH * 2 + TOOLBAR_SEPARATOR_WIDTH + TOOLBAR_GAP * 2,
    );
  });

  it("is zero for an empty row rather than a negative gap", () => {
    expect(toolbarRowWidth(0, 0, 0)).toBe(0);
  });

  it("counts reserved space as one more unit", () => {
    expect(toolbarRowWidth(1, 0, 60)).toBe(
      TOOLBAR_CONTROL_WIDTH + 60 + TOOLBAR_GAP,
    );
  });
});

describe("fitToolbarItems", () => {
  it("keeps every action when the row is wide enough", () => {
    const fit = fitToolbarItems(ITEMS, 1000);
    expect(fit.overflow).toEqual([]);
    expect(fit.groups.map((view) => view.group)).toEqual([
      "tools",
      "pane",
      "global",
    ]);
  });

  it("gives up Usage first, then Focus expand, Close pane, then the splits", () => {
    const given: string[] = [];
    for (let width = 300; width >= 120; width -= 4) {
      for (const entry of fitToolbarItems(ITEMS, width).overflow) {
        if (!given.includes(entry.id)) {
          given.push(entry.id);
        }
      }
    }
    expect(given).toEqual([
      "usage",
      "expand",
      "close-pane",
      "split-column",
      "split-row",
    ]);
  });

  it("never overflows a persistent action, however narrow the row", () => {
    const fit = fitToolbarItems(ITEMS, 0);
    expect(ids(fit.visible)).toEqual([
      "explorer",
      "browser",
      "prompts",
      "settings",
    ]);
  });

  it("drops the separator of a group it emptied", () => {
    const fit = fitToolbarItems(ITEMS, 0);
    expect(fit.groups.map((view) => view.group)).toEqual(["tools", "global"]);
  });

  it("lists the overflow in bar order, not in the order it gave way", () => {
    const fit = fitToolbarItems(ITEMS, 0);
    expect(ids(fit.overflow)).toEqual([
      "usage",
      "split-row",
      "split-column",
      "expand",
      "close-pane",
    ]);
  });

  it("treats reserved width as space it cannot use", () => {
    const width = 260;
    const roomy = fitToolbarItems(ITEMS, width).overflow.length;
    const withPill = fitToolbarItems(ITEMS, width, 90).overflow.length;
    expect(withPill).toBeGreaterThan(roomy);
  });

  it("does not measure at all when the width is not a number it can trust", () => {
    const fit = fitToolbarItems(ITEMS, Number.POSITIVE_INFINITY);
    expect(fit.overflow).toEqual([]);
  });
});
