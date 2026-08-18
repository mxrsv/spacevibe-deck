import type { Icon } from '@phosphor-icons/react';

/**
 * The one place Phosphor's presentation defaults are set (`DL-14.1`). Surfaces
 * choose *which* icon means what and own the accessible name on the button
 * around it; this component owns only how every icon is drawn.
 *
 * Phosphor has no `strokeWidth`: weight is a discrete family, and `regular`
 * is the one picked (2026-08-16) because it lands closest to the
 * `strokeWidth={1.8}` the retired Lucide set drew at, in the same 24-unit box.
 * The weight is therefore unchanged at every size, not re-tuned per call site.
 */

/** The component type every surface passes in — one import, not the library's. */
export type DeckIconComponent = Icon;

/** The sizes chrome draws at: chrome 13, compact row 14, feature/board 15, rail 16. */
export type DeckIconSize = 13 | 14 | 15 | 16;

/** Window chrome — the tab bar and the titlebar's action cluster. */
export const CHROME_ICON: DeckIconSize = 13;
/** Compact actions inside a config row or a popover row. */
export const ROW_ICON: DeckIconSize = 14;
/** Prominent feature entry points, kept visibly larger than their row text. */
export const FEATURE_ICON: DeckIconSize = 15;
/** Open Board rows, which sit one step larger than a settings row. */
export const BOARD_ICON: DeckIconSize = 15;
/** The settings rail, the largest icon the chrome draws. */
export const RAIL_ICON: DeckIconSize = 16;

/**
 * `.deck-icon` is the class the stylesheet targets, and it is emitted
 * unconditionally — the app's one icon rule (`display: block; flex: none`)
 * hangs off it, so an icon that lost its class would leave a descender-sized
 * gap inside every button in the app.
 *
 * The per-icon modifier beside it is derived from Phosphor's `displayName`
 * (`GearIcon` → `deck-icon--gear`) and exists so a test can name the icon it
 * expects. Nothing in CSS may depend on it: a minifier is entitled to drop a
 * `displayName`, and the layout rule must not be the thing that discovers it.
 */
function iconModifier(icon: Icon): string {
  const displayName = icon.displayName ?? '';
  const bare = displayName.endsWith('Icon') ? displayName.slice(0, -'Icon'.length) : displayName;
  if (bare === '') {
    return '';
  }
  const slug = bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return ` deck-icon--${slug}`;
}

export interface DeckIconProps {
  /** A named import from `@phosphor-icons/react` — never a locally drawn SVG. */
  readonly icon: Icon;
  readonly size?: DeckIconSize;
  readonly class?: string;
  /**
   * Phosphor draws the one-sided marks facing left only. The dock's toggle
   * points at a panel on the right, so it flips the same icon rather than the
   * set gaining a second drawing of it.
   */
  readonly mirrored?: boolean;
}

export function DeckIcon({
  icon: Icon,
  size = 16,
  class: className,
  mirrored = false,
}: DeckIconProps) {
  return (
    <Icon
      size={size}
      color="currentColor"
      weight="regular"
      mirrored={mirrored}
      aria-hidden="true"
      focusable="false"
      className={`deck-icon${iconModifier(Icon)}${className === undefined ? '' : ` ${className}`}`}
    />
  );
}
