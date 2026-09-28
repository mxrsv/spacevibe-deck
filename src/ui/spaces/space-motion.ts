/**
 * The one motion spaces and Mission Control use (DL-35.1, DL-35.2): transform
 * and opacity only, 280 ms — DL §7's slide-over figure, inside DL-1.2's 300 ms
 * ceiling — run by the Web Animations API. A WAAPI animation is finite and
 * compositor-driven: it is not DL-1.3's `requestAnimationFrame` loop and no
 * timer drives it, and nothing runs while the user is idle. Everything here is
 * skipped under `prefers-reduced-motion: reduce` (DL-1.5).
 */

export const SPACE_MOTION_MS = 280;
export const SPACE_MOTION_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** A box in viewport coordinates — `DOMRect` and `PaneRect` both qualify. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function reducedMotion(): boolean {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The transform that draws a box laid out at `at` over `over` instead. */
function mapping(at: Box, over: Box): string | null {
  const width = at.right - at.left;
  const height = at.bottom - at.top;
  if (width <= 0 || height <= 0) return null;
  const sx = (over.right - over.left) / width;
  const sy = (over.bottom - over.top) / height;
  return `translate(${over.left - at.left}px, ${over.top - at.top}px) scale(${sx}, ${sy})`;
}

/** Plays `element` from `from` into where it is laid out now (the FLIP). */
export function flyFrom(element: HTMLElement, from: Box): Animation | null {
  if (reducedMotion() || typeof element.animate !== "function") return null;
  const start = mapping(element.getBoundingClientRect(), from);
  if (start === null) return null;
  return element.animate(
    [
      { transformOrigin: "0 0", transform: start },
      { transformOrigin: "0 0", transform: "none" },
    ],
    { duration: SPACE_MOTION_MS, easing: SPACE_MOTION_EASE },
  );
}

/** Plays `element` from where it is laid out onto `to`, and holds there. */
export function flyTo(element: HTMLElement, to: Box): Animation | null {
  if (reducedMotion() || typeof element.animate !== "function") return null;
  const end = mapping(element.getBoundingClientRect(), to);
  if (end === null) return null;
  return element.animate(
    [
      { transformOrigin: "0 0", transform: "none" },
      { transformOrigin: "0 0", transform: end },
    ],
    { duration: SPACE_MOTION_MS, easing: SPACE_MOTION_EASE, fill: "forwards" },
  );
}

/** Fades `element` in or out over the same beat. */
export function fade(element: Element | null, direction: "in" | "out"): Animation | null {
  if (element === null || reducedMotion() || typeof element.animate !== "function") return null;
  const frames =
    direction === "in" ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  return element.animate(frames, {
    duration: SPACE_MOTION_MS,
    easing: SPACE_MOTION_EASE,
    fill: direction === "out" ? "forwards" : "none",
  });
}

/** Slides `element` horizontally by whole widths: `from` → `to`, in units of its width. */
export function slide(element: HTMLElement, from: number, to: number): Animation | null {
  if (reducedMotion() || typeof element.animate !== "function") return null;
  return element.animate(
    [{ transform: `translateX(${from * 100}%)` }, { transform: `translateX(${to * 100}%)` }],
    { duration: SPACE_MOTION_MS, easing: SPACE_MOTION_EASE },
  );
}

/** Resolves when every animation given has finished or been cancelled. */
export function settled(animations: readonly (Animation | null)[]): Promise<void> {
  return Promise.all(
    animations.map((animation) =>
      animation === null
        ? Promise.resolve()
        : animation.finished.then(
            () => undefined,
            () => undefined,
          ),
    ),
  ).then(() => undefined);
}
