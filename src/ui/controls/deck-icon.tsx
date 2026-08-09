import type { LucideIcon } from "lucide-preact";

/**
 * The one place Lucide's presentation defaults are set (`DL-14.1`). Surfaces
 * choose *which* icon means what and own the accessible name on the button
 * around it; this component owns only how every icon is drawn.
 *
 * `strokeWidth` is 1.8 rather than Lucide's 2 because that is what the
 * hand-drawn icons this replaced already used, in the same 24-unit box — so
 * the weight is unchanged at every size, not re-tuned per call site.
 */

/** The sizes chrome draws at: chrome 13, compact row 14, board row 15, rail 16. */
export type DeckIconSize = 13 | 14 | 15 | 16;

/** Window chrome — the tab bar and the titlebar's action cluster. */
export const CHROME_ICON: DeckIconSize = 13;
/** Compact actions inside a config row or a popover row. */
export const ROW_ICON: DeckIconSize = 14;
/** Open Board rows, which sit one step larger than a settings row. */
export const BOARD_ICON: DeckIconSize = 15;
/** The settings rail, the largest icon the chrome draws. */
export const RAIL_ICON: DeckIconSize = 16;

export interface DeckIconProps {
  /** A named import from `lucide-preact` — never a locally drawn SVG. */
  readonly icon: LucideIcon;
  readonly size?: DeckIconSize;
  readonly class?: string;
}

export function DeckIcon({
  icon: Icon,
  size = 16,
  class: className,
}: DeckIconProps) {
  return (
    <Icon
      size={size}
      color="currentColor"
      strokeWidth={1.8}
      fill="none"
      aria-hidden="true"
      focusable="false"
      class={className}
    />
  );
}
