/**
 * GUI zoom: the whole window scales by one of a few fixed factors
 * (`webContents.setZoomFactor`), while a terminal or editor keeps its text
 * size by dividing its font by the same factor. Pure, so the renderer, the
 * settings validator and the main process read one definition.
 */

/** The only factors the app applies, ascending. */
export const GUI_ZOOM_STEPS: readonly number[] = [0.85, 0.9, 1, 1.1, 1.25];

export const DEFAULT_GUI_ZOOM = 1;

const EPSILON = 1e-9;

function stepIndex(value: number): number {
  return GUI_ZOOM_STEPS.findIndex((step) => Math.abs(step - value) < EPSILON);
}

/** A stored or received value as a step, or the default for anything else. */
export function parseGuiZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_GUI_ZOOM;
  }
  const index = stepIndex(value);
  return index === -1 ? DEFAULT_GUI_ZOOM : GUI_ZOOM_STEPS[index];
}

/** The next step in `direction`, clamped at both ends of the ladder. */
export function stepGuiZoom(current: number, direction: 1 | -1): number {
  const index = stepIndex(parseGuiZoom(current));
  const next = Math.min(GUI_ZOOM_STEPS.length - 1, Math.max(0, index + direction));
  return GUI_ZOOM_STEPS[next];
}

/**
 * The font size to give xterm or Monaco so the text keeps its on-screen size
 * under `zoom`: the page draws a CSS pixel `zoom` physical pixels wide, so the
 * CSS size is the setting divided by it. Rounded to three decimals so float
 * noise (13 / 1.1) never reaches the font option.
 */
export function compensatedFontSize(fontSize: number, zoom: number): number {
  return Math.round((fontSize / parseGuiZoom(zoom)) * 1000) / 1000;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle measured in the zoomed page's CSS pixels, in window pixels.
 * Edges are rounded, not the size, so two neighbours that met in CSS still
 * meet and no one-pixel gap opens at a fractional factor.
 */
export function cssRectToWindow(rect: PixelRect, zoom: number): PixelRect {
  const left = Math.round(rect.x * zoom);
  const top = Math.round(rect.y * zoom);
  const right = Math.max(left, Math.round((rect.x + rect.width) * zoom));
  const bottom = Math.max(top, Math.round((rect.y + rect.height) * zoom));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
