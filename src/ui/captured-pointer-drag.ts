/**
 * Follows a drag on the element that captured its pointer, and ends it exactly
 * once, on whichever end signal arrives first. The three resize seams (sidebar,
 * dock, pane split) share it so none of them can get stuck again on its own.
 *
 * `pointerup` alone is not enough (owner report, 2026-11-04): the release could
 * go missing, and the seam kept its capture, so every later move resized the
 * column and the next press anywhere was retargeted to the seam. A move with no
 * button held is that missing release. Where the release goes is unverified; the
 * prime suspect is the `-webkit-app-region: drag` stage strip right above the
 * sidebar seam, which the OS can claim the mouse-up for.
 */
export interface CapturedDragHandlers {
  /** A move while a button is still held. */
  readonly onMove: (event: PointerEvent) => void;
  /**
   * Called once, however the drag ended. The move that revealed a lost release
   * never reaches `onMove`, so the drag settles on the last position the user
   * saw while still holding the button.
   */
  readonly onEnd: () => void;
}

export function trackCapturedDrag(
  target: HTMLElement,
  pointerId: number,
  handlers: CapturedDragHandlers,
): void {
  let ended = false;

  const move = (event: PointerEvent): void => {
    if (event.buttons === 0) {
      end();
      return;
    }
    handlers.onMove(event);
  };

  const end = (): void => {
    // `pointerup` is followed by `lostpointercapture`, and the release below
    // fires one too: without this guard a commit would run twice.
    if (ended) {
      return;
    }
    ended = true;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    target.removeEventListener("lostpointercapture", end);
    window.removeEventListener("blur", end);
    // Load-bearing on the lost-release path: the capture is still held there,
    // and leaving it would hand the next press anywhere in the window to this
    // seam. Releasing throws `NotFoundError` for a pointer that is no longer
    // active (touch or pen after its `pointerup`); there is no capture left to
    // give back then, and letting it throw would skip `onEnd` and leave the
    // drag uncommitted.
    try {
      target.releasePointerCapture(pointerId);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "NotFoundError")) {
        throw err;
      }
    }
    handlers.onEnd();
  };

  target.setPointerCapture(pointerId);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
  target.addEventListener("lostpointercapture", end);
  // Switching apps mid-drag never delivers the release to this window.
  window.addEventListener("blur", end);
}
