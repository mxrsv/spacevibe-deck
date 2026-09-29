/**
 * FLIP for the Mission Control study: a pane measured in one layout is drawn
 * flying from there into its place in the next layout, so the overview reads
 * as the same windows zooming out, not a new screen. Transform and opacity
 * only; skipped entirely under reduced motion.
 */

export const ZOOM_MS = 280;
const ZOOM_EASE = "cubic-bezier(0.2, 0, 0, 1)";

export type RectMap = ReadonlyMap<string, DOMRect>;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rects of every `[data-key]` element under `root` matching `selector`. */
export function captureRects(root: Element | null, selector: string): RectMap {
  const rects = new Map<string, DOMRect>();
  root?.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const key = element.dataset.key;
    if (key !== undefined) rects.set(key, element.getBoundingClientRect());
  });
  return rects;
}

/** Plays each matching element from its rect in `from` to where it now sits. */
export function playFlip(root: Element | null, selector: string, from: RectMap): void {
  if (root === null || from.size === 0 || reducedMotion()) return;
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const key = element.dataset.key;
    const start = key === undefined ? undefined : from.get(key);
    const end = element.getBoundingClientRect();
    if (start === undefined || end.width === 0 || end.height === 0) return;
    const dx = start.left - end.left;
    const dy = start.top - end.top;
    const sx = start.width / end.width;
    const sy = start.height / end.height;
    element.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: ZOOM_MS, easing: ZOOM_EASE },
    );
  });
}

/** Fades an element in over the zoom, for the parts that have no source rect. */
export function fadeIn(element: Element | null): void {
  if (element === null || reducedMotion()) return;
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ZOOM_MS, easing: ZOOM_EASE });
}
