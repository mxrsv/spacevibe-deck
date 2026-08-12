import {
  TOOLBAR_GROUP_ORDER,
  type ToolbarGroup,
  type ToolbarItem,
} from "./toolbar-item";

/**
 * Deciding what still fits, as arithmetic rather than as layout.
 *
 * The toolbar is made of controls whose size the design fixes — a 24px icon
 * button, a 3px gap, an 11px hairline — so "does this row fit" is answerable
 * from a width and a list, with no measuring pass, no hidden-then-remeasure
 * flicker, and no dependency on a layout engine. That is also what makes it
 * testable: every rule the design states about overflow order and stranded
 * separators is checked here, not inferred from a screenshot.
 */

/** `.iconbtn` — one icon control, geometry owned by `styles.css`. */
export const TOOLBAR_CONTROL_WIDTH = 24;
/** `.ftoolbar` gap between any two adjacent units. */
export const TOOLBAR_GAP = 3;
/** `.tabbar__sep` — the 1px hairline plus its 5px margins. */
export const TOOLBAR_SEPARATOR_WIDTH = 11;

export interface ToolbarGroupView {
  readonly group: ToolbarGroup;
  readonly items: readonly ToolbarItem[];
}

export interface ToolbarFit {
  /** Only non-empty groups, in group order — a separator per gap between them. */
  readonly groups: readonly ToolbarGroupView[];
  readonly visible: readonly ToolbarItem[];
  /** In the original order, so `More` reads like the bar it came from. */
  readonly overflow: readonly ToolbarItem[];
}

/**
 * A group with nothing visible in it produces no group at all, which is what
 * keeps its separator from surviving as a stranded line.
 */
export function groupToolbarItems(
  items: readonly ToolbarItem[],
): readonly ToolbarGroupView[] {
  return TOOLBAR_GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((view) => view.items.length > 0);
}

export function toolbarRowWidth(
  controlCount: number,
  separatorCount: number,
  reservedWidth: number,
): number {
  const units = controlCount + separatorCount + (reservedWidth > 0 ? 1 : 0);
  if (units === 0) {
    return 0;
  }
  return (
    controlCount * TOOLBAR_CONTROL_WIDTH +
    separatorCount * TOOLBAR_SEPARATOR_WIDTH +
    reservedWidth +
    (units - 1) * TOOLBAR_GAP
  );
}

function measure(
  visible: readonly ToolbarItem[],
  hasOverflowButton: boolean,
  reservedWidth: number,
): number {
  const separators = Math.max(0, groupToolbarItems(visible).length - 1);
  return toolbarRowWidth(
    visible.length + (hasOverflowButton ? 1 : 0),
    separators,
    reservedWidth,
  );
}

/**
 * Moves the lowest-priority actions into `More` until the row fits.
 *
 * `reservedWidth` is space the row must leave for something the toolbar does
 * not own — today the update pill, whose width depends on its phase and is
 * measured by the caller rather than guessed here.
 *
 * Hiding the first action costs a `More` button, so the row can briefly get
 * wider before it gets narrower; the loop keeps going rather than concluding
 * from one step that nothing helps. When every candidate has moved and the row
 * still does not fit, the persistent actions stay — a toolbar that hides
 * Settings to satisfy arithmetic is worse than one that is a few pixels tight.
 */
export function fitToolbarItems(
  items: readonly ToolbarItem[],
  availableWidth: number,
  reservedWidth = 0,
): ToolbarFit {
  const candidates = items
    .filter((item) => item.overflowOrder !== null)
    .sort((a, b) => (a.overflowOrder ?? 0) - (b.overflowOrder ?? 0));

  const hidden = new Set<string>();
  if (Number.isFinite(availableWidth)) {
    for (const candidate of candidates) {
      const visible = items.filter((item) => !hidden.has(item.id));
      if (measure(visible, hidden.size > 0, reservedWidth) <= availableWidth) {
        break;
      }
      hidden.add(candidate.id);
    }
  }

  const visible = items.filter((item) => !hidden.has(item.id));
  return {
    groups: groupToolbarItems(visible),
    visible,
    overflow: items.filter((item) => hidden.has(item.id)),
  };
}
