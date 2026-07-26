/**
 * Export matrix. One timeline, four deliverables.
 *
 * `range` trims the film for surfaces that shouldn't carry the end card (the
 * looping hero, the README GIF); `scale` is the device pixel ratio used while
 * capturing, so a small output can still be sampled from a crisp raster.
 */

export const PRESETS = Object.freeze({
  /** YouTube / X master, and the source for any re-edit. */
  master: {
    width: 1920,
    height: 1080,
    fps: 60,
    scale: 1,
    range: [0, 20],
    formats: ["mp4", "webm"],
    poster: 6.4,
  },
  /** Landing hero: loops, so it stops before the end card. */
  hero: {
    width: 1600,
    height: 900,
    fps: 30,
    scale: 1,
    range: [0, 16.2],
    formats: ["mp4", "webm"],
    poster: 6.4,
    fade: { in: 0.35, out: 0.6 },
  },
  /**
   * GitHub README: an autoplaying GIF, so weight is the binding constraint.
   * 800×450 at 12fps over the 13.6s that carry the story keeps it in single
   * digits of MB; the full arc lives in the mp4 next to it.
   */
  gif: {
    width: 720,
    height: 405,
    fps: 12,
    scale: 1,
    range: [1, 14.2],
    formats: ["gif"],
    poster: null,
    fade: { in: 0.3, out: 0.5 },
    gifColors: 128,
  },
  /** Product Hunt / social, 9:16. */
  vertical: {
    width: 1080,
    height: 1920,
    fps: 30,
    scale: 1,
    range: [0, 20],
    formats: ["mp4"],
    poster: 6.4,
  },
});

export const PRESET_NAMES = Object.keys(PRESETS);

/** @param {string} name */
export function resolvePreset(name) {
  const preset = PRESETS[name];

  if (!preset) {
    throw new Error(
      `Unknown preset "${name}". Known presets: ${PRESET_NAMES.join(", ")}.`,
    );
  }

  return preset;
}
