import { getDesktopEnvironment } from "../lib/platform";
import { FONT_FALLBACK } from "./settings-schema";

// Gated by platform, not appended to FONT_FALLBACK: fonts fall back per glyph,
// so a face installed on a Mac (Cascadia Mono ships with Windows Terminal and
// Office) would still draw the glyphs Menlo and Monaco lack, and change how the
// Mac renders them. Windows has neither macOS face, so the chain reaches these
// two real monospaces before the generic family.
const WINDOWS_FONT_FALLBACK = 'Menlo, Monaco, "Cascadia Mono", Consolas, monospace';

/** The mono fallback list after the user's chosen face, for the current
    platform. Read at call time: the platform is only known once the desktop
    environment has loaded, which is after the settings schema is imported.
    macOS and unsupported hosts get FONT_FALLBACK unchanged. */
export function monoFontFallback(): string {
  return getDesktopEnvironment().platform === "windows" ? WINDOWS_FONT_FALLBACK : FONT_FALLBACK;
}
