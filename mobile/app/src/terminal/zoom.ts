import steps from "./zoom-steps.json";

/** Text-size factors in percent (MOB17); the terminal page and this module share the one list. */
export const ZOOM_STEPS: readonly number[] = steps;
export const ZOOM_DEFAULT = 100;

/** Advance of a monospace cell relative to the font size, for Menlo (iOS's `monospace`). */
export const CELL_WIDTH_RATIO = 0.602;
export const MIN_FONT_SIZE = 3;

/** The step nearest to a free factor, so pinching lands on a fixed size. */
export function snapZoom(raw: number): number {
  if (!Number.isFinite(raw)) return ZOOM_DEFAULT;
  return ZOOM_STEPS.reduce((best, step) =>
    Math.abs(step - raw) < Math.abs(best - raw) ? step : best,
  );
}

export function isZoomStep(value: unknown): value is number {
  return typeof value === "number" && ZOOM_STEPS.includes(value);
}

/** The next larger (`1`) or smaller (`-1`) step; stays put at either end. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.indexOf(snapZoom(current));
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
}

/** A pinch that scaled the distance between fingers by `scale`, from `current`. */
export function pinchZoom(current: number, scale: number): number {
  return snapZoom(current * scale);
}

/**
 * The font size at which the desktop pane's `cols` fill `width` points at 100%, scaled by the
 * zoom. Above 100% the terminal is wider than the screen and scrolls sideways.
 */
export function fitFontSize(width: number, cols: number, zoom: number): number {
  if (width <= 0 || cols <= 0) return 10;
  const base = width / (cols * CELL_WIDTH_RATIO);
  return Math.max(MIN_FONT_SIZE, Math.floor(((base * zoom) / 100) * 10) / 10);
}

export function zoomLabel(cols: number, zoom: number): string {
  return `${cols} cols · ${zoom}%`;
}
