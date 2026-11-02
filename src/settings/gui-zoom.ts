/**
 * The renderer's side of GUI zoom: what factor is in force and the font sizes
 * that keep text steady under it. `gui-zoom-binding.ts` applies it to the window.
 */
import { compensatedFontSize, parseGuiZoom } from "../lib/gui-zoom";
import type { Settings } from "./settings-schema";

/**
 * The factor the window is really zoomed by. Without the Electron host (the
 * browser preview) nothing zooms the page, so compensating would shrink text
 * for no reason.
 */
export function effectiveGuiZoom(current: Pick<Settings, "guiZoom">): number {
  const hosted = (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
  return hosted ? parseGuiZoom(current.guiZoom) : 1;
}

/**
 * The font size for xterm or Monaco: the setting divided by the zoom, so the
 * glyphs keep their physical size and a terminal keeps its cell size.
 */
export function textFontSize(current: Pick<Settings, "fontSize" | "guiZoom">): number {
  return compensatedFontSize(current.fontSize, effectiveGuiZoom(current));
}

/** Frame geometry (`--frame-h` and friends) divides by this custom property. */
export const GUI_ZOOM_PROPERTY = "--gui-zoom";
