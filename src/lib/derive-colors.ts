/**
 * The chrome tones that stay formulas, and the colour arithmetic and contrast
 * floors the themes are measured with.
 *
 * A theme declares its surfaces, inks and text tones itself (DL-2.2). What
 * stays derived is what must not drift between themes: the hover and selection
 * washes (DL-21) and every seam and hairline (DL-2.3). They are functions of
 * the theme's `type`, `bg` and `sidebar-bg` and nothing else.
 */
import type { ThemeType, UiTokens } from "../settings/theme-schema";

export interface ChromeColors {
  readonly tone: string;
  readonly sidebarSeam: string;
  readonly tabActiveBg: string;
  /**
   * DL-21.2's hover wash — the quieter half of the selection pair, and the
   * reason it is derived here rather than written at each use site.
   *
   * It mixes from `tone`, not from `fg`: a neutral wash belongs to the
   * background ladder, and mixing it from the foreground lets the terminal's
   * text hue into chrome that is meant to be colourless.
   *
   * Alpha, like `seamDivider` and for the same reason: hover lands on whichever
   * surface owns the row — `bg` on the rail, `chrome-1` on the frame, `chrome-2`
   * inside a popover — so it has to adapt rather than name one ground.
   */
  readonly stateHoverBg: string;
  /** Lines INSIDE a surface — config rows, the board, input borders. Alpha over the tone. */
  readonly hair: string;
  readonly hairStrong: string;
  /**
   * The seam ladder (DL-2.3). These mix from `tone`, so a seam belongs to the
   * background ladder rather than to the terminal's text hue, and
   * `seamRecessed` lands between the stage and the surface it edges.
   */
  readonly seamRecessed: string;
  readonly seamDivider: string;
  /** The pane split alone — louder than `seamDivider` (DL-2.3). */
  readonly seamSplit: string;
  readonly seamRaised: string;
}

/** What the formulas read from a theme. */
export interface ChromeSource {
  readonly type: ThemeType;
  readonly ui: Pick<UiTokens, "bg" | "sidebar-bg">;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Background luminance below this is a dark surface. A legacy terminal theme
 * file is typed by it (`themeFromTerminalColors`), so its chrome is the
 * built-in of the matching type.
 */
export const DARK_LUMINANCE_THRESHOLD = 0.45;

// DL-3.5's WCAG contrast floors for the three chrome text tones, on every
// surface a tone can land on. Exported so a review surface can LABEL the floor
// it is measuring against without restating the number. Nothing raises a
// colour to meet them at runtime: `built-in-themes.test.ts` holds every
// built-in theme to them.
export const TEXT_PRIMARY_FLOOR = 8;
export const TEXT_MUTED_FLOOR = 6;
export const TEXT_FAINT_FLOOR = 4.5;
/** Terminal text and the normal ANSI colours are normal-size content: WCAG AA starts at 4.5. */
export const TERMINAL_TEXT_FLOOR = 4.5;
/** A cursor is a non-text visual indicator and must clear the 3:1 floor. */
export const TERMINAL_CURSOR_FLOOR = 3;
/** The bright ANSI colours and the dim gray carry emphasis and secondary text, held at 3:1. */
export const ANSI_BRIGHT_FLOOR = 3;

/**
 * The selection wash's step above the surface it is measured from: the
 * sidebar on a dark theme (the chrome ladder stacks on it), the stage on a
 * light one.
 */
const DARK_TAB_ACTIVE_STEP = 0.1;
const LIGHT_TAB_ACTIVE_STEP = 0.15;

/**
 * The two seams that are surfaces rather than washes (DL-2.3).
 *
 * `seamRaised` sits just under the active row and just over the panel body it
 * frames, on both ladders (0.09 under 0.10 dark, 0.14 under 0.15 light).
 */
const SEAM_RECESSED_STEP = 0.02;
const DARK_SEAM_RAISED_STEP = 0.09;
const LIGHT_SEAM_RAISED_STEP = 0.14;

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

function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Derive the washes and seams from a theme's type and its two lowest surfaces. */
export function deriveChromeColors({ type, ui }: ChromeSource): ChromeColors {
  const dark = type === "dark";
  const tone = dark ? "#ffffff" : "#000000";
  const bg = ui.bg;
  const sidebarBg = ui["sidebar-bg"];
  // The chrome ladder stacks ON the sidebar on a dark theme, where the side
  // columns rise off the stage, and on the stage on a light one, where they
  // recede below it (DL-18.7).
  const chromeBase = dark ? sidebarBg : bg;
  return {
    tone,
    sidebarSeam: mixHex(sidebarBg, bg, 0.5),
    tabActiveBg: mixHex(chromeBase, tone, dark ? DARK_TAB_ACTIVE_STEP : LIGHT_TAB_ACTIVE_STEP),
    // 6% against the active row's own step: far enough apart that hover cannot
    // be read as "already selected" (DL-21.2), close enough that the two
    // belong to one ladder.
    stateHoverBg: alpha(tone, 0.06),
    hair: alpha(tone, 0.12),
    hairStrong: alpha(tone, 0.2),
    // Opaque, so a boundary paints one colour instead of two: an alpha border
    // composites over whichever surface owns it, and the two sides of a shell
    // seam are different surfaces by definition. Measured from `bg`, the lower
    // of the two surfaces it sits between on both types.
    seamRecessed: mixHex(bg, tone, SEAM_RECESSED_STEP),
    // The floating frame follows the chrome ladder, not the stage, so a
    // popover is never framed in a line darker than its own body.
    seamRaised: mixHex(chromeBase, tone, dark ? DARK_SEAM_RAISED_STEP : LIGHT_SEAM_RAISED_STEP),
    // Alpha, because this one runs INSIDE a single surface and has to adapt to
    // whichever one that is — the stage on one pane, `chrome-1` on another.
    seamDivider: alpha(tone, 0.12),
    // The pane split, one ladder step louder than the strip's edge: at 12% and
    // 1px a grid of panes read too faint.
    seamSplit: alpha(tone, 0.2),
  };
}
