import { TAB_DOT_COLORS, type TabDotColor } from "./tab-colors";

export interface LetterAvatar {
  /** Single uppercase glyph shown when a workspace has no image logo. */
  readonly letter: string;
  /** Deterministic theme color token for the avatar tint. */
  readonly color: TabDotColor;
}

/** First alphanumeric character of a label, uppercased; `?` when none. */
function firstLetter(label: string): string {
  for (const char of label.trim()) {
    if (/[a-z0-9]/i.test(char)) {
      return char.toUpperCase();
    }
  }
  return "?";
}

/** Stable non-negative hash (djb2) — same seed always maps to the same color. */
function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * A deterministic letter avatar for a workspace that has no image logo: the
 * first letter of its label on a theme color picked by hashing `seed` (the
 * workspace path), so the same folder always gets the same color.
 */
export function letterAvatar(label: string, seed: string): LetterAvatar {
  return {
    letter: firstLetter(label),
    color: TAB_DOT_COLORS[hash(seed) % TAB_DOT_COLORS.length],
  };
}
