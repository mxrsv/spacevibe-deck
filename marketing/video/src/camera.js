/**
 * Camera rig — one transform on the wrapper that holds the app window.
 *
 * Translations are in percent of the rig's own size so the same numbers frame
 * the shot at every export aspect ratio.
 */

/**
 * @param {HTMLElement} el
 * @param {{ x: number, y: number, scale: number, rotX: number, rotY: number }} camera
 * @param {number} [defocus] 0..1 rack-focus amount applied as a blur
 */
export function applyCamera(el, camera, defocus = 0) {
  if (!el) {
    throw new Error("Camera rig element is missing.");
  }

  el.style.filter = defocus > 0 ? `blur(${(defocus * 9).toFixed(2)}px)` : "";
  el.style.transform = [
    `translate3d(${camera.x}%, ${camera.y}%, 0)`,
    `rotateX(${camera.rotX}deg)`,
    `rotateY(${camera.rotY}deg)`,
    `scale(${camera.scale})`,
  ].join(" ");
}
