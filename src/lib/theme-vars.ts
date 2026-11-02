import { UI_TOKEN_KEYS, type Theme } from "../settings/theme-schema";
import { DECK_DARK_THEME, DECK_LIGHT_THEME } from "../settings/built-in-themes";
import { contrastRatio, deriveChromeColors, type ChromeColors } from "./derive-colors";

/**
 * Deck's two default themes wear the preset's own values, which `preset.css` declares and which
 * carry alpha a theme's opaque hex cannot hold. Every other theme publishes `presetTokens`.
 */
const PRESET_NATIVE_THEME_IDS: ReadonlySet<string> = new Set([
  DECK_DARK_THEME.id,
  DECK_LIGHT_THEME.id,
]);

/**
 * The preset's token names, without their `--`, read from a theme's own roles so the shadcn chrome
 * and the terminal beside it are one palette (UI-2). The keys are the whole list: the `--chart-*`
 * ramp is left out because no shipped surface draws a chart.
 */
function presetTokens({ ui }: Theme, chrome: ChromeColors): Readonly<Record<string, string>> {
  const text = ui["text-primary"];
  const raised = ui["chrome-1"];
  const muted = ui["chrome-2"];
  // A file theme's accent has no contrast floor, and it may sit close to its own background.
  const onAccent = contrastRatio(ui.bg, ui.accent) >= contrastRatio(text, ui.accent) ? ui.bg : text;
  return {
    background: ui.bg,
    foreground: text,
    card: raised,
    "card-foreground": text,
    popover: raised,
    "popover-foreground": text,
    primary: ui.accent,
    "primary-foreground": onAccent,
    secondary: muted,
    "secondary-foreground": text,
    muted,
    "muted-foreground": ui["text-muted"],
    "ui-accent": muted,
    "accent-foreground": text,
    destructive: ui.red,
    border: chrome.hair,
    input: chrome.hairStrong,
    ring: ui["text-muted"],
    sidebar: ui["sidebar-bg"],
    "sidebar-foreground": text,
    "sidebar-primary": ui.accent,
    "sidebar-primary-foreground": onAccent,
    "sidebar-accent": muted,
    "sidebar-accent-foreground": text,
    "sidebar-border": chrome.hair,
    "sidebar-ring": ui["text-muted"],
  };
}

/**
 * Publishes a theme as the chrome CSS custom properties `:root` in
 * `styles.css` declares (DL-2.2: switching theme must restyle all chrome with
 * zero component changes). The theme's `ui` keys are the property names
 * without their `--`; the washes and seams are derived on top of them.
 *
 * It lives apart from its one caller because it has two: the app pushes vars
 * whenever settings change, and the chrome gallery pushes them when its theme
 * picker moves. A second copy of this list in the gallery would make the
 * gallery a second visual truth — the exact drift the gallery exists to expose.
 */
export function applyThemeVars(rootStyle: CSSStyleDeclaration, theme: Theme): void {
  for (const key of UI_TOKEN_KEYS) {
    rootStyle.setProperty(`--${key}`, theme.ui[key]);
  }
  // `:root` declares `--status-unread: var(--yellow)`, and a custom property
  // holding `var()` is substituted where it is DECLARED — so the badge keeps
  // whatever yellow `:root` resolved and cannot follow a theme published
  // further down the tree. Publishing it here, like every other derived
  // token, is a no-op on `:root` and is what lets the gallery's matrix show
  // several themes at once without one of them lying about this colour.
  rootStyle.setProperty("--status-unread", theme.ui.yellow);
  const chrome = deriveChromeColors(theme);
  rootStyle.setProperty("--tone", chrome.tone);
  rootStyle.setProperty("--sidebar-seam", chrome.sidebarSeam);
  rootStyle.setProperty("--tab-active-bg", chrome.tabActiveBg);
  rootStyle.setProperty("--state-hover-bg", chrome.stateHoverBg);
  rootStyle.setProperty("--hair", chrome.hair);
  rootStyle.setProperty("--hair-strong", chrome.hairStrong);
  rootStyle.setProperty("--seam-recessed", chrome.seamRecessed);
  rootStyle.setProperty("--seam-divider", chrome.seamDivider);
  rootStyle.setProperty("--seam-split", chrome.seamSplit);
  rootStyle.setProperty("--seam-raised", chrome.seamRaised);
  // Inline beats `.dark` in preset.css, so going back to a default theme has to clear these.
  const preset = presetTokens(theme, chrome);
  const native = PRESET_NATIVE_THEME_IDS.has(theme.id);
  for (const [key, value] of Object.entries(preset)) {
    if (native) rootStyle.removeProperty(`--${key}`);
    else rootStyle.setProperty(`--${key}`, value);
  }
}
