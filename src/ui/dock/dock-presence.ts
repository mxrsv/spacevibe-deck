/**
 * The docked column's mount lifetime, stretched over its exit (DL §7).
 *
 * `App` mounts `DockPanel` on the `dockOpen` setting, so the column used to
 * appear and disappear between two frames. DL §7 already budgets a panel
 * slide-over — `transform` + `opacity`, 0.28s — and a CSS transition cannot
 * play on an element that has left the DOM, so the exit needs someone to keep
 * the panel mounted while it slides out.
 *
 * That is the whole job here: `mounted` says whether the column is in the DOM
 * (open, OR closing and still animating), `entered` says whether it is at rest
 * on screen. The two are deliberately separate — an entrance needs one painted
 * frame at the closed transform before the open one, or the browser has no
 * start value to interpolate from and the panel simply appears.
 *
 * Width is NOT part of this. A resize drag rides `dockWidthLive` at whatever
 * rate the pointer moves, and a transition on `width` would make the column
 * lag the cursor; only the slide is animated, and `--dock-w` keeps answering
 * instantly (DL-1.2 allows `transform`/`opacity` and nothing else anyway).
 */
import { useEffect, useState } from "preact/hooks";

/**
 * DL §7's slide-over figure, in ms, inside DL-1.2's 300ms ceiling.
 *
 * The CSS duration in `14-dock.css` and this constant are the same number
 * twice: the stylesheet decides how long the slide takes, this decides how
 * long the panel outlives its close. A shorter figure here would cut the exit
 * off mid-slide.
 */
export const DOCK_SLIDE_MS = 280;

export interface DockPresence {
  /** In the DOM: open, or closing and still sliding out. */
  readonly mounted: boolean;
  /** At rest on screen — what the `is-open` class is written from. */
  readonly entered: boolean;
}

/**
 * @param hold Keeps the column MOUNTED regardless of `visible` — true while a
 * resize drag is in flight. The gesture is captured on the grip inside the
 * panel: pointer capture survives the panel being pushed off-stage and made
 * `pointer-events: none`, but it does not survive the panel being removed from
 * the DOM, and an overshoot that unmounts its own grip is unrecoverable. This
 * is what lets a drag past the floor hide the column IMMEDIATELY the way the
 * navigation sidebar always has, instead of dimming it and waiting for the
 * pointer to come up.
 */
export function useDockPresence(visible: boolean, hold: boolean = false): DockPresence {
  const [mounted, setMounted] = useState(visible);
  const [entered, setEntered] = useState(visible);

  useEffect(() => {
    if (!visible && hold) {
      // Painted closed, still in the DOM: the drag owns the mount until it
      // ends, and no unmount timer is started at all.
      setEntered(false);
      return;
    }
    if (visible) {
      setMounted(true);
      // One frame, not an animation loop (DL-1.3): the panel has to be painted
      // once at its closed transform, or `transition` has nothing to run from.
      // Cancelled on cleanup, so a close arriving in the same frame wins.
      const frame = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(frame);
    }
    setEntered(false);
    // Unmounted only after the slide has played. Re-opening during the exit
    // clears this through the cleanup below, so the column never vanishes
    // under a user who changed their mind mid-animation.
    const timer = window.setTimeout(() => setMounted(false), DOCK_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [visible, hold]);

  return { mounted, entered };
}
