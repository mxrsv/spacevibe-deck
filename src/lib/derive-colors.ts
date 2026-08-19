/**
 * Theme-derived chrome color system (app-wide standard).
 *
 * All chrome UI derives from the terminal theme's bg/fg — no hardcoded chrome
 * colors, with one exception a background may claim for its own sidebar
 * (`PINNED_SIDEBAR_BG`, DL-2.2). Text tokens are raised toward the tone until they meet
 * WCAG contrast floors, so a low-contrast theme or user override can
 * never sink the chrome below readability.
 */

export interface ChromeColors {
  readonly tone: string;
  readonly sidebarBg: string;
  readonly sidebarSeam: string;
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
  /**
   * Lines INSIDE a surface — config rows, the board, input borders.
   *
   * Alpha over the `tone` since 2026-08-17, not over `fg`: these were the last
   * chrome tokens still mixing from the foreground, which is what let a
   * blue-violet theme draw blue-violet rules across chrome DL-2.3 already
   * declared colourless. That rule's ledger row carved them out only because
   * the surfaces carrying them had not been reviewed yet; neutralizing the
   * built-in foregrounds the same day closed the carve-out, since a hairline
   * left on `fg` would have been the one blue thing remaining.
   */
  readonly hair: string;
  readonly hairStrong: string;
  /**
   * The seam ladder (DL-2.3), approved 2026-08-12 after the gallery study in
   * `src/gallery/sections/seam-section.tsx` — a dev-entry file that is not in
   * the shipping bundle, so treat that path as a footnote: if the gallery is
   * retired, drop the pointer, not the rule. DL-2.3 is the durable record.
   *
   * `hair` used to mix from the FOREGROUND, which put every structural line
   * 15–24 luminance units above the surface it edged while the step from `bg`
   * to `chrome1` was only 8–9 — the line out-shouted the step it marked and
   * read as ink drawn across the chrome. These three mix from `tone` instead,
   * so a seam belongs to the background ladder rather than to the terminal's
   * text hue, and `seamRecessed` lands BELOW the surface it edges.
   *
   * `hair`/`hairStrong` joined them on 2026-08-17 — see their own note above.
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

/**
 * Background luminance below this mixes toward white, otherwise black.
 *
 * Exported since 2026-08-19 because Settings' Light/Dark selector has to draw
 * exactly the same line: a legacy theme is shown as whichever mode its own
 * background already belongs to, and a second threshold would let the segment
 * disagree with the chrome the same background produced.
 */
export const DARK_LUMINANCE_THRESHOLD = 0.45;
// Step size when raising a text color toward the tone (2% per step)
const RAISE_STEP = 0.02;
// WCAG contrast floors for the three chrome text tones, checked against
// every surface a tone can land on (see `surfaces` in `deriveChromeColors`).
// Exported so a review surface can LABEL the floor it is measuring against
// without restating the number — DL-3.5 is the rule, this is the one place it
// is implemented, and a second copy could only ever drift away from it.
export const TEXT_PRIMARY_FLOOR = 8;
export const TEXT_MUTED_FLOOR = 6;
export const TEXT_FAINT_FLOOR = 4.5;
/** Imported terminal text is normal-size content, so WCAG AA starts at 4.5. */
export const TERMINAL_TEXT_FLOOR = 4.5;
/** A cursor is a non-text visual indicator and must clear the 3:1 floor. */
export const TERMINAL_CURSOR_FLOOR = 3;

/**
 * How far the side columns stand off the stage.
 *
 * The dark direction REVERSED on 2026-08-19 at the owner's request: the
 * sidebar used to be the darkest plane in the window (`bg` mixed 24% toward
 * black) and is now the first plane ABOVE it, so the terminal is the deepest
 * surface and every piece of chrome stands on top of it. Light themes keep
 * receding — darkening is still the only direction with headroom there.
 */
const DARK_SIDEBAR_LIFT = 0.08;
const LIGHT_SIDEBAR_RECESS = 0.05;

/**
 * Steps of the chrome ladder above whichever surface it is measured from.
 *
 * The dark steps are deliberately NARROWER than the light ones. They are
 * measured from the sidebar, which already spent 8% of the headroom, and a
 * lighter surface is what `TEXT_PRIMARY_FLOOR` runs out of room on: at 4/8/14
 * One Dark's active row falls to 7.13:1 against white, under the 8:1 floor,
 * which would push every chrome tone to flat white and make
 * `checkChromeTextContrast` reject imports it accepts today. At 3/6/10 the
 * tightest preset still measures 8.07:1.
 */
const DARK_CHROME_1_STEP = 0.03;
const DARK_CHROME_2_STEP = 0.06;
const DARK_TAB_ACTIVE_STEP = 0.1;
const LIGHT_CHROME_1_STEP = 0.05;
const LIGHT_CHROME_2_STEP = 0.09;
const LIGHT_TAB_ACTIVE_STEP = 0.15;

/** How far a dark theme's input surface sinks from the sidebar toward the stage. */
const DARK_INPUT_SINK = 0.5;
/** Kept soft on light themes — readability comes from the textPrimary floor. */
const LIGHT_INPUT_STEP = 0.06;

/**
 * The two seams that are surfaces rather than washes (DL-2.3).
 *
 * `seamRaised` keeps the place in the ladder it always held — just under the
 * active row, just over the panel body it frames — so the dark step is sized
 * against the dark ladder (0.09 under the active row's 0.10) exactly as the
 * light one is sized against the light ladder (0.14 under 0.15).
 */
const SEAM_RECESSED_STEP = 0.02;
const DARK_SEAM_RAISED_STEP = 0.09;
const LIGHT_SEAM_RAISED_STEP = 0.14;

/**
 * A hand-picked sidebar for a background somebody chose one for, keyed by the
 * background itself rather than by preset id.
 *
 * `deriveChromeColors` is a function of `(bg, fg)` and nothing else (DL-2.2),
 * and its four callers — the app, the editor host, the gallery matrix and the
 * theme card preview — only ever hold those two. Keying the pin on the
 * background keeps all four in agreement without threading a preset through
 * any of them, and it scopes the pin correctly for free: override deck-dark's
 * background and the pin stops applying, because it was picked FOR that
 * background.
 *
 * `#272d31` is not reachable by mixing `#17181c` toward white — it is a bluer,
 * flatter gray than any lift produces (hue 228° → 204°, saturation up) — so it
 * is a literal, and DL-2.2 carries the exception.
 *
 * The key is `deck-dark`'s own `background` in `themes.ts`. Editing that value
 * without editing this one silently retires the pin.
 */
const PINNED_SIDEBAR_BG: Readonly<Record<string, string>> = Object.freeze({
  "#17181c": "#272d31",
});

type ChromeTextToken = "textPrimary" | "textMuted" | "textFaint";
type ChromeTextSurface =
  "inputBg" | "sidebarBg" | "chrome1" | "chrome2" | "tabActiveBg";

export interface ChromeContrastFailure {
  readonly token: ChromeTextToken;
  readonly surface: ChromeTextSurface;
  readonly actual: number;
  readonly required: number;
}

export type ChromeContrastCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly failures: readonly ChromeContrastFailure[];
    };

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

/**
 * A light theme's side columns, one quiet step down from the stage.
 *
 * There is no "cannot darken" fallback any more, and there must not be one: a
 * background light enough to reach this branch always darkens by 5% after
 * 8-bit rounding, and the fallback this replaced mixed toward `tone` — which
 * is BLACK here, so it recomputed the same value and would have returned `bg`
 * itself if it ever fired, breaking the DL-18.7 invariant it existed to keep.
 * It was written when near-black dark backgrounds landed here with a white
 * tone; the dark branch cannot collide at all, since lifting always moves.
 */
function recessedSidebar(bg: string): string {
  return mixHex(bg, "#000000", LIGHT_SIDEBAR_RECESS);
}

/** Derive every chrome token from the theme's background and foreground. */
export function deriveChromeColors(bg: string, fg: string): ChromeColors {
  const dark = luminance(bg) < DARK_LUMINANCE_THRESHOLD;
  const tone = dark ? "#ffffff" : "#000000";
  // The stage keeps the terminal theme's background. On a dark theme the side
  // columns RISE off it by one step; on a light theme they still recede onto a
  // darker surface (DL-18.7). Neither direction can land back on `bg`: see
  // `recessedSidebar` for why the old rounding guard is gone.
  const sidebarBg = dark
    ? (PINNED_SIDEBAR_BG[bg.toLowerCase()] ??
      mixHex(bg, tone, DARK_SIDEBAR_LIFT))
    : recessedSidebar(bg);
  const sidebarSeam = mixHex(sidebarBg, bg, 0.5);
  // The chrome ladder stacks ON the sidebar on a dark theme, not on the stage.
  // Once the sidebar rose to +8%, a ladder measured from `bg` put `chrome1`
  // BELOW it and `chrome2` level with it, so a popover read as a smudge of the
  // column behind it rather than as an object above it. Measuring from the
  // sidebar makes the separation structural: every chrome surface is above the
  // sidebar by construction, for every theme, including imports.
  const chromeBase = dark ? sidebarBg : bg;
  const chrome1 = mixHex(
    chromeBase,
    tone,
    dark ? DARK_CHROME_1_STEP : LIGHT_CHROME_1_STEP,
  );
  const chrome2 = mixHex(
    chromeBase,
    tone,
    dark ? DARK_CHROME_2_STEP : LIGHT_CHROME_2_STEP,
  );
  const tabActiveBg = mixHex(
    chromeBase,
    tone,
    dark ? DARK_TAB_ACTIVE_STEP : LIGHT_TAB_ACTIVE_STEP,
  );
  // 6% against the active row's own step: far enough apart that hover cannot be
  // read as "already selected" (DL-21.2), close enough that the two belong to
  // one ladder. The percentage is the reviewed direction's; only its source
  // moved.
  const stateHoverBg = alpha(tone, 0.06);
  // An input is a RECESSED surface, so on a dark theme it sinks from the
  // sidebar back toward the stage — below every chrome plane rather than
  // mid-ladder, which is where the old `bg + 12%` lands now that the sidebar
  // has passed it.
  const inputBg = dark
    ? mixHex(sidebarBg, bg, DARK_INPUT_SINK)
    : mixHex(bg, tone, LIGHT_INPUT_STEP);
  // Every chrome surface text can sit on, not just the darkest one. The
  // settings panel body is `chrome2` and the active tab / workspace row is
  // `tabActiveBg`, both lighter than `chrome1` — measuring the floors on
  // `chrome1` alone left the two surfaces users read most sitting below the
  // ratio the floor promised (2.1:1 for `textFaint` on `tabActiveBg`).
  const surfaces = [sidebarBg, chrome1, chrome2, tabActiveBg];
  // The three text tones are one ladder, built DOWNWARD from `textPrimary` by
  // mixing back toward the background. Deriving each independently from `bg`
  // and raising it to its own floor can inverse the ladder: on a theme whose
  // foreground is itself dim (One Dark, fg #b2b2b2), the muted step gets
  // raised past a primary that never needed raising, and the quiet tone ends
  // up louder than the loud one. Mixing toward `bg` can only ever lower
  // contrast, so ordering holds by construction; the `ensureContrast` pass
  // after each mix only pulls a step back up if it undershot its floor.
  const textPrimary = ensureContrast(
    fg,
    [inputBg, ...surfaces],
    TEXT_PRIMARY_FLOOR,
    tone,
  );
  return {
    tone,
    sidebarBg,
    sidebarSeam,
    chrome1,
    chrome2,
    tabActiveBg,
    stateHoverBg,
    inputBg,
    hair: alpha(tone, 0.12),
    hairStrong: alpha(tone, 0.2),
    // Opaque, so a boundary paints one colour instead of two: an alpha border
    // composites over whichever surface owns it, and the two sides of a shell
    // seam are different surfaces by definition.
    // The gutter between the stage and the plane beside it stays measured from
    // `bg`: it is the one seam whose job is to sit BETWEEN the two surfaces,
    // and `bg` is still the lower of them on both modes.
    seamRecessed: mixHex(bg, tone, SEAM_RECESSED_STEP),
    // The floating frame follows the chrome ladder, not the stage. Measured
    // from `bg` it fell BELOW `chrome2` the moment the ladder moved onto the
    // sidebar (deck-dark: 0.0397 against 0.0409), which is a popover framed in
    // a line darker than its own body.
    seamRaised: mixHex(
      chromeBase,
      tone,
      dark ? DARK_SEAM_RAISED_STEP : LIGHT_SEAM_RAISED_STEP,
    ),
    // Alpha, because this one runs INSIDE a single surface and has to adapt to
    // whichever one that is — the stage on one pane, `chrome1` on another.
    //
    // 12%, raised from 3% on 2026-08-17 at the owner's request: unlike a shell
    // seam, this line has no background STEP beside it to help — both sides of
    // a pane split are the same surface — so the line is the only thing marking
    // the boundary and 3% left a terminal grid reading as one undivided sheet.
    // 12% is the same weight `hair` carries, one ladder step below `hairStrong`.
    seamDivider: alpha(tone, 0.12),
    textPrimary,
    textMuted: ensureContrast(
      mixHex(textPrimary, bg, 0.28),
      surfaces,
      TEXT_MUTED_FLOOR,
      tone,
    ),
    // 4.5, not 3: this token styles 10.5–11px text — config row descriptions,
    // workspace paths, the "off" value of every toggle — which WCAG AA rates
    // as normal text, where 3:1 is the non-text floor, not the text one.
    textFaint: ensureContrast(
      mixHex(textPrimary, bg, 0.5),
      surfaces,
      TEXT_FAINT_FLOOR,
      tone,
    ),
  };
}

/**
 * Report when the best colours Deck can derive still miss DL-3.5.
 *
 * `ensureContrast` deliberately returns the best available tone when a floor
 * is impossible. Built-in themes and live overrides keep that graceful
 * fallback, while imported files call this boundary check and are rejected
 * before an unreadable theme can become selectable.
 */
export function checkChromeTextContrast(
  bg: string,
  fg: string,
): ChromeContrastCheck {
  const chrome = deriveChromeColors(bg, fg);
  const surfaces: Readonly<Record<ChromeTextSurface, string>> = {
    inputBg: chrome.inputBg,
    sidebarBg: chrome.sidebarBg,
    chrome1: chrome.chrome1,
    chrome2: chrome.chrome2,
    tabActiveBg: chrome.tabActiveBg,
  };
  const checks: readonly [ChromeTextToken, number, ChromeTextSurface[]][] = [
    [
      "textPrimary",
      TEXT_PRIMARY_FLOOR,
      Object.keys(surfaces) as ChromeTextSurface[],
    ],
    [
      "textMuted",
      TEXT_MUTED_FLOOR,
      ["sidebarBg", "chrome1", "chrome2", "tabActiveBg"],
    ],
    [
      "textFaint",
      TEXT_FAINT_FLOOR,
      ["sidebarBg", "chrome1", "chrome2", "tabActiveBg"],
    ],
  ];
  const failures = checks.flatMap(([token, required, names]) =>
    names.flatMap((surface) => {
      const actual = contrastRatio(chrome[token], surfaces[surface]);
      return actual < required ? [{ token, surface, actual, required }] : [];
    }),
  );
  if (failures.length === 0) {
    return { ok: true };
  }
  const first = failures[0];
  return {
    ok: false,
    reason: `Deck chrome cannot meet DL-3.5 (${first.token} on ${first.surface}: ${first.actual.toFixed(2)}:1, needs ${first.required}:1)`,
    failures,
  };
}
