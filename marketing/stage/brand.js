/**
 * Single source of truth for the product name and mark.
 *
 * Every surface that paints the product name inside app chrome — the landing
 * hero, the scroll tour and the marketing video — reads it from here, so the
 * Stackgrid → Deck rename stays one edit instead of a grep across three
 * renderers.
 *
 * `name` and `bundlePath` deliberately disagree: the product goes by Deck in
 * prose, but the shipped bundle carries the full `SpaceVibe Deck` (ADR 0028),
 * and the landing's proof terminal quotes a path a user can actually paste.
 */

export const BRAND = Object.freeze({
  /** Display name, as it appears in the Open board and the window title. */
  name: "Deck",
  /** App mark. Resolved through the module URL so both Vite roots work. */
  iconSrc: new URL("./assets/deck-icon.svg", import.meta.url).href,
  /** Installed bundle path, quoted by the landing's proof terminal. */
  bundlePath: "/Applications/SpaceVibe Deck.app",
  /** Lowercase slug used for workspace folders in mock transcripts. */
  slug: "deck",
});

export const STAGE_ARIA_LABEL = `${BRAND.name} app window preview`;
