/**
 * Where the needs-you popover hangs: under its chip, trailing edges aligned,
 * and never off the side or the bottom of the window.
 *
 * Computed from the chip's rect alone, before the surface has painted, because
 * the popover moves focus into its first row the moment it mounts and a surface
 * that is still `visibility: hidden` while it waits to be measured cannot take
 * focus. That works because the width is fixed: `ToolbarOverflowMenu` anchors
 * the same way, by its `right` and `top` (DL-13.1).
 */

/** The surface's width, and the same figure `.attn-pop` declares. */
export const POPOVER_WIDTH = 288;
/** Between the chip and the surface — the toolbar menu's own offset. */
export const POPOVER_GAP = 6;
/** The margin the surface keeps from the window's edge. */
export const POPOVER_EDGE = 8;

export interface PopoverPlacement {
  /** Distance from the window's right edge to the surface's right edge. */
  readonly right: number;
  readonly top: number;
  /** What is left of the window below `top`; the list scrolls past it. */
  readonly maxHeight: number;
}

export function placePopover(
  anchor: Pick<DOMRect, "right" | "bottom">,
  viewport: { readonly width: number; readonly height: number },
): PopoverPlacement {
  const width = Math.min(POPOVER_WIDTH, Math.max(0, viewport.width - 2 * POPOVER_EDGE));
  const wanted = viewport.width - anchor.right;
  const right = Math.min(Math.max(wanted, POPOVER_EDGE), viewport.width - POPOVER_EDGE - width);
  const top = anchor.bottom + POPOVER_GAP;
  return { right, top, maxHeight: Math.max(0, viewport.height - top - POPOVER_EDGE) };
}
