/**
 * Colour interpolation for the backdrop.
 *
 * Palettes come from the app's own Tokyo Night theme so the curtain behind
 * the window never introduces a colour the product doesn't use.
 */

/** @typedef {readonly [string, string, string]} Palette */

function parseHex(hex) {
  const value = hex.trim().replace("#", "");

  if (value.length !== 6) {
    throw new Error(`Expected a 6-digit hex colour, got "${hex}".`);
  }

  const int = Number.parseInt(value, 16);

  if (Number.isNaN(int)) {
    throw new Error(`"${hex}" is not a hex colour.`);
  }

  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex([r, g, b]) {
  const channel = (n) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Blend two hex colours in linear-ish RGB. */
export function mixHex(from, to, u) {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.min(1, Math.max(0, u));

  return toHex([
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ]);
}

/**
 * Blend two three-stop palettes.
 *
 * @param {Palette} from
 * @param {Palette} to
 * @param {number} u
 * @returns {Palette}
 */
export function mixPalette(from, to, u) {
  return [
    mixHex(from[0], to[0], u),
    mixHex(from[1], to[1], u),
    mixHex(from[2], to[2], u),
  ];
}

/**
 * Sample a palette track — a list of `{ t, palette }` keyframes blended
 * linearly between neighbours.
 *
 * @param {ReadonlyArray<{ t: number, palette: Palette }>} keys
 * @param {number} t seconds
 * @returns {Palette}
 */
export function samplePalette(keys, t) {
  if (keys.length === 0) {
    throw new Error("Palette track has no keyframes.");
  }

  if (t <= keys[0].t) {
    return keys[0].palette;
  }

  const last = keys[keys.length - 1];

  if (t >= last.t) {
    return last.palette;
  }

  for (let i = 1; i < keys.length; i += 1) {
    if (t > keys[i].t) {
      continue;
    }

    const from = keys[i - 1];
    const span = keys[i].t - from.t;

    return mixPalette(
      from.palette,
      keys[i].palette,
      span <= 0 ? 1 : (t - from.t) / span,
    );
  }

  return last.palette;
}
