/** Preset dot colors a user can pick for a tab — theme accent tokens. */
export const TAB_DOT_COLORS = ["accent", "red", "green", "yellow", "magenta", "cyan"] as const;

export type TabDotColor = (typeof TAB_DOT_COLORS)[number];

export function isTabDotColor(value: unknown): value is TabDotColor {
  return typeof value === "string" && (TAB_DOT_COLORS as readonly string[]).includes(value);
}

/** CSS value for a dot color token — follows the active theme. */
export function tabDotCssColor(color: TabDotColor): string {
  return `var(--${color})`;
}
