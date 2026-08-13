/**
 * Theme-derived chrome color system (app-wide standard).
 *
 * All chrome UI derives from the terminal theme's bg/fg — no hardcoded
 * chrome colors. Text tokens are raised toward the tone until they meet
 * WCAG contrast floors, so a low-contrast theme or user override can
 * never sink the chrome below readability.
 */

export interface ChromeColors {
  readonly tone: string;
  readonly chrome1: string;
  readonly chrome2: string;
  readonly tabActiveBg: string;
  /**
   * DL-21.2's hover wash — the quieter half of the selection pair, and the
   * reason it is derived here rather than written at each use site.
   *
   * It mixes from `tone`, not from `fg`. The reviewed direction wrote it as 6%
   * of its ink alias, which resolves to the foreground, and that is the same
   * mistake DL-2.3 corrected for seams: a neutral wash belongs to the
   * background ladder, and mixing it from the foreground lets the terminal's
   * text hue into chrome that is meant to be colourless.
   *
   * Alpha, like `seamDivider` and for the same reason: hover lands on whichever
   * surface owns the row — `bg` on the rail, `chrome1` on the frame, `chrome2`
   * inside a popover — so it has to adapt rather than name one ground.
   */
  readonly stateHoverBg: string;
  readonly inputBg: string;
  readonly hair: string;
  readonly hairStrong: string;
  /**
   * The seam ladder (DL-2.3), approved 2026-08-12 after the gallery study in
   * `src/gallery/sections/seam-section.tsx` — a dev-entry file that is not in
   * the shipping bundle, so treat that path as a footnote: if the gallery is
   * retired, drop the pointer, not the rule. DL-2.3 is the durable record.
   *
   * `hair` mixes from the FOREGROUND, which put every structural line 15–24
   * luminance units above the surface it edged while the step from `bg` to
   * `chrome1` was only 8–9 — the line out-shouted the step it marked and read
   * as ink drawn across the chrome. These three mix from `tone` instead, so a
   * seam belongs to the background ladder rather than to the terminal's text
   * hue, and `seamRecessed` lands BELOW the surface it edges.
   *
   * `hair`/`hairStrong` stay as they are: the surfaces still on them (config
   * rows, the board, inputs) were not part of what was reviewed.
   */
  readonly seamRecessed: string;
  readonly seamDivider: string;
  readonly seamRaised: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly textFaint: string;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// Background luminance below this mixes toward white, otherwise black
const DARK_LUMINANCE_THRESHOLD = 0.45;
// Step size when raising a text color toward the tone (2% per step)
const RAISE_STEP = 0.02;

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Linear interpolation from base toward target; amount in [0, 1]. */
export function mixHex(base: string, target: string, amount: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(target);
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  });
}

/** WCAG relative luminance in [0, 1]. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (n: number): number => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Mix `text` toward `tone` in small steps until it meets `floor` against
 * every surface. Caps at the tone itself when the floor is unreachable
 * (mid-gray backgrounds) — best achievable contrast wins.
 */
function ensureContrast(
  text: string,
  surfaces: readonly string[],
  floor: number,
  tone: string,
): string {
  for (let t = 0; t <= 1; t += RAISE_STEP) {
    const candidate = mixHex(text, tone, t);
    if (surfaces.every((s) => contrastRatio(candidate, s) >= floor)) {
      return candidate;
    }
  }
  return tone;
}

function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Derive every chrome token from the theme's background and foreground. */
export function deriveChromeColors(bg: string, fg: string): ChromeColors {
  const dark = luminance(bg) < DARK_LUMINANCE_THRESHOLD;
  const tone = dark ? "#ffffff" : "#000000";
  // 0.05/0.09, up from 0.04/0.07: the structure now comes from the step
  // between surfaces rather than from the line between them, so the step has
  // to be the thing you can see.
  const chrome1 = mixHex(bg, tone, 0.05);
  const chrome2 = mixHex(bg, tone, 0.09);
  const tabActiveBg = mixHex(bg, tone, 0.15);
  // 6% against tabActiveBg's 15%: far enough apart that hover cannot be read as
  // "already selected" (DL-21.2), close enough that the two belong to one
  // ladder. The percentage is the reviewed direction's; only its source moved.
  const stateHoverBg = alpha(tone, 0.06);
  // Kept soft on light themes — readability comes from the textPrimary floor
  const inputBg = mixHex(bg, tone, dark ? 0.12 : 0.06);
  // Every chrome surface text can sit on, not just the darkest one. The
  // settings panel body is `chrome2` and the active tab / workspace row is
  // `tabActiveBg`, both lighter than `chrome1` — measuring the floors on
  // `chrome1` alone left the two surfaces users read most sitting below the
  // ratio the floor promised (2.1:1 for `textFaint` on `tabActiveBg`).
  const surfaces = [chrome1, chrome2, tabActiveBg];
  // The three text tones are one ladder, built DOWNWARD from `textPrimary` by
  // mixing back toward the background. Deriving each independently from `bg`
  // and raising it to its own floor can inverse the ladder: on a theme whose
  // foreground is itself dim (One Dark, fg #abb2bf), the muted step gets
  // raised past a primary that never needed raising, and the quiet tone ends
  // up louder than the loud one. Mixing toward `bg` can only ever lower
  // contrast, so ordering holds by construction; the `ensureContrast` pass
  // after each mix only pulls a step back up if it undershot its floor.
  const textPrimary = ensureContrast(fg, [inputBg, ...surfaces], 7, tone);
  return {
    tone,
    chrome1,
    chrome2,
    tabActiveBg,
    stateHoverBg,
    inputBg,
    hair: alpha(fg, 0.12),
    hairStrong: alpha(fg, 0.2),
    // Opaque, so a boundary paints one colour instead of two: an alpha border
    // composites over whichever surface owns it, and the two sides of a shell
    // seam are different surfaces by definition.
    seamRecessed: mixHex(bg, tone, 0.02),
    seamRaised: mixHex(bg, tone, 0.14),
    // Alpha, because this one runs INSIDE a single surface and has to adapt to
    // whichever one that is — the stage on one pane, `chrome1` on another.
    seamDivider: alpha(tone, 0.03),
    textPrimary,
    textMuted: ensureContrast(
      mixHex(textPrimary, bg, 0.28),
      surfaces,
      5.5,
      tone,
    ),
    // 4.5, not 3: this token styles 10.5–11px text — config row descriptions,
    // workspace paths, the "off" value of every toggle — which WCAG AA rates
    // as normal text, where 3:1 is the non-text floor, not the text one.
    textFaint: ensureContrast(
      mixHex(textPrimary, bg, 0.5),
      surfaces,
      4.5,
      tone,
    ),
  };
}
