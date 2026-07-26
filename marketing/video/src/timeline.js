/**
 * Timeline sampling — the whole motion system.
 *
 * A track is a list of keyframes sorted by time in seconds. Numeric tracks
 * interpolate between neighbours through an easing; step tracks hold the last
 * value that is due. Sampling is pure, so frame N always looks the same no
 * matter how the player got there — which is what makes the headless render
 * reproducible.
 */

import { resolveEasing } from "./easing.js";

/**
 * @typedef {{ t: number, v: number, ease?: string }} NumberKey
 * @typedef {{ t: number, v: unknown }} StepKey
 */

function assertKeys(keys, name) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error(`Track "${name}" has no keyframes.`);
  }
}

/**
 * Sample a numeric track. The easing named on a keyframe governs the segment
 * that *ends* at that keyframe.
 *
 * @param {ReadonlyArray<NumberKey>} keys
 * @param {number} t seconds
 * @param {string} [name] used in error messages
 * @returns {number}
 */
export function sampleNumber(keys, t, name = "number") {
  assertKeys(keys, name);

  if (t <= keys[0].t) {
    return keys[0].v;
  }

  const last = keys[keys.length - 1];

  if (t >= last.t) {
    return last.v;
  }

  for (let i = 1; i < keys.length; i += 1) {
    const to = keys[i];

    if (t > to.t) {
      continue;
    }

    const from = keys[i - 1];
    const span = to.t - from.t;
    const u = span <= 0 ? 1 : (t - from.t) / span;

    return from.v + (to.v - from.v) * resolveEasing(to.ease)(u);
  }

  return last.v;
}

/**
 * Sample a step track — the value of the latest keyframe at or before `t`.
 *
 * @param {ReadonlyArray<StepKey>} keys
 * @param {number} t seconds
 * @param {string} [name]
 * @returns {unknown}
 */
export function sampleStep(keys, t, name = "step") {
  assertKeys(keys, name);

  let value = keys[0].v;

  for (const key of keys) {
    if (key.t > t) {
      break;
    }

    value = key.v;
  }

  return value;
}

/**
 * Progress through a window as a 0..1 ramp, eased. Useful for one-shot
 * flourishes (a key press, a glow) that are easier to express as "starts at
 * `at`, lasts `dur`" than as a pair of keyframes.
 *
 * @param {number} t seconds
 * @param {number} at start, seconds
 * @param {number} dur length, seconds
 * @param {string | ((u: number) => number)} [ease]
 * @returns {number}
 */
export function window01(t, at, dur, ease = "linear") {
  if (dur <= 0) {
    throw new Error("window01 needs a positive duration.");
  }

  const u = Math.min(1, Math.max(0, (t - at) / dur));

  return resolveEasing(ease)(u);
}

/**
 * Build a sampler bound to a set of named tracks.
 *
 * @param {Record<string, { keys: ReadonlyArray<NumberKey>, step?: false }
 *   | { keys: ReadonlyArray<StepKey>, step: true }>} tracks
 */
export function createSampler(tracks) {
  const names = Object.keys(tracks);

  if (names.length === 0) {
    throw new Error("A sampler needs at least one track.");
  }

  return {
    /** @param {string} name @param {number} t */
    num(name, t) {
      const track = tracks[name];

      if (!track || track.step === true) {
        throw new Error(`No numeric track named "${name}".`);
      }

      return sampleNumber(track.keys, t, name);
    },
    /** @param {string} name @param {number} t */
    step(name, t) {
      const track = tracks[name];

      if (!track || track.step !== true) {
        throw new Error(`No step track named "${name}".`);
      }

      return sampleStep(track.keys, t, name);
    },
  };
}
