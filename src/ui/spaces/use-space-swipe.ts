import { useEffect, useRef } from "preact/hooks";
import type { SlideDirection } from "./space-slide";

/**
 * A horizontal trackpad swipe or wheel moves one space (DL-35.2).
 *
 * Read in the CAPTURE phase on the stage: xterm handles wheel events on its
 * own viewport, and a horizontal gesture that reached it would be nothing to
 * xterm but a lost swipe here. Only a gesture whose horizontal travel wins
 * over its vertical travel is taken, so scrolling a terminal's history is
 * untouched. One gesture moves one space: the rest of it — trackpad momentum
 * included, which outlasts the slide — is swallowed until the events pause.
 */

/** Horizontal travel, in CSS pixels, that counts as one swipe. */
const SWIPE_THRESHOLD = 60;
/** A pause longer than this starts a new gesture. */
const SWIPE_IDLE_MS = 200;

interface Gesture {
  readonly travel: number;
  readonly lastAt: number;
  /** This gesture already moved a space; the rest of it is swallowed. */
  readonly spent: boolean;
}

const REST: Gesture = { travel: 0, lastAt: 0, spent: false };

export function useSpaceSwipe(
  stage: () => HTMLElement | null,
  onSwipe: (direction: SlideDirection) => void,
): void {
  const handler = useRef(onSwipe);
  handler.current = onSwipe;
  useEffect(() => {
    const element = stage();
    if (element === null) return;
    let gesture = REST;
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      event.stopPropagation();
      const now = event.timeStamp;
      const fresh = now - gesture.lastAt > SWIPE_IDLE_MS;
      if (gesture.spent && !fresh) {
        gesture = { ...gesture, lastAt: now };
        return;
      }
      const travel = (fresh ? 0 : gesture.travel) + event.deltaX;
      if (Math.abs(travel) < SWIPE_THRESHOLD) {
        gesture = { travel, lastAt: now, spent: false };
        return;
      }
      gesture = { travel: 0, lastAt: now, spent: true };
      handler.current(travel > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => element.removeEventListener("wheel", onWheel, { capture: true });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the stage element exists for the window's life
  }, []);
}
