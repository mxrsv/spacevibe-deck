/**
 * Easing curves for the video timeline.
 *
 * Every curve is a pure `(u: 0..1) => number` so a frame can be sampled from
 * its timestamp alone — nothing here reads a clock or the previous frame.
 */

export const linear = (u) => u;

export const easeInOutCubic = (u) =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

export const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);

export const easeInCubic = (u) => u * u * u;

export const easeOutQuint = (u) => 1 - Math.pow(1 - u, 5);

/**
 * Critically-tuned overshoot — the pane-resize feel. Settles by u = 1 so a
 * keyframe never lands mid-wobble.
 */
export const easeOutSpring = (u) => {
  if (u >= 1) {
    return 1;
  }

  const decay = Math.exp(-6.5 * u);

  return 1 - decay * Math.cos(7.2 * u);
};

/** Soft in-and-out pulse, for glows that bloom and fade within one beat. */
export const pulse = (u) => Math.sin(Math.PI * Math.min(1, Math.max(0, u)));

export const EASINGS = Object.freeze({
  linear,
  easeInCubic,
  easeOutCubic,
  easeOutQuint,
  easeInOutCubic,
  easeOutSpring,
  pulse,
});

/**
 * Resolve an easing given either a name from `EASINGS` or a function.
 *
 * @param {string | ((u: number) => number) | undefined} ease
 * @returns {(u: number) => number}
 */
export function resolveEasing(ease) {
  if (typeof ease === "function") {
    return ease;
  }

  if (typeof ease === "string") {
    const found = EASINGS[ease];

    if (!found) {
      throw new Error(`Unknown easing "${ease}".`);
    }

    return found;
  }

  return easeInOutCubic;
}
