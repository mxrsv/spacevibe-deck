/**
 * iTerm2 colour presets (`.itermcolors`).
 *
 * The largest collection of terminal palettes in existence (iterm2colorschemes
 * ships hundreds), so it is worth the only awkward parse of the four: the file
 * is an Apple plist and every colour is a dict of 0–1 floats per channel rather
 * than a hex string.
 *
 * Parsed with regular expressions rather than `DOMParser` on purpose. The
 * grammar consumed here is one level deep and fully known — a flat dict of
 * named dicts of `<real>` values — so an XML engine buys nothing, and avoiding
 * it keeps this module runnable outside a DOM (its tests, and the main process
 * if scanning ever moves there).
 *
 * The file carries no name of its own, so the label comes from the filename.
 */
import { hexFromUnitRgb } from './normalize-hex';
import { ANSI_SLOTS, emptyDraft, type ThemeDraft } from './theme-draft';

/** Colour dicts keyed by name: `<key>NAME</key>` then the dict that follows. */
const ENTRY = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;

/** Named plist slot → `ITheme` key. `Ansi N Color` is handled separately. */
const NAMED_SLOTS: Readonly<Record<string, string>> = {
  'Background Color': 'background',
  'Foreground Color': 'foreground',
  'Cursor Color': 'cursor',
  'Selection Color': 'selectionBackground',
};

const ANSI_KEY = /^Ansi (\d{1,2}) Color$/;

export function looksLikeItermColors(source: string): boolean {
  return source.includes('<plist') && source.includes('Component');
}

export function parseItermColors(source: string): ThemeDraft | null {
  if (!looksLikeItermColors(source)) {
    return null;
  }
  const draft = emptyDraft();
  for (const match of source.matchAll(ENTRY)) {
    const slot = themeKeyFor(match[1]);
    if (slot === null) {
      continue;
    }
    const hex = readColorDict(match[2]);
    if (hex !== null) {
      Object.assign(draft.colors, { [slot]: hex });
    }
  }
  return draft;
}

/**
 * Map a plist key onto an `ITheme` key, or null for the many slots Deck has no
 * place for (`Bold Color`, `Cursor Guide Color`, `Badge Color`, …). Ignoring
 * them is deliberate: a preset carries more slots than a terminal theme does.
 */
function themeKeyFor(plistKey: string): string | null {
  const named = NAMED_SLOTS[plistKey];
  if (named !== undefined) {
    return named;
  }
  const ansi = ANSI_KEY.exec(plistKey);
  if (ansi === null) {
    return null;
  }
  return ANSI_SLOTS[Number(ansi[1])] ?? null;
}

/**
 * Read one colour dict's three channels.
 *
 * Alpha is present in every file and deliberately dropped — see
 * `normalize-hex.ts` for why the app only carries opaque colours. A dict
 * missing any of the three channels returns null rather than defaulting the
 * absentee to zero, because a silently black channel is a wrong colour that
 * looks deliberate.
 */
function readColorDict(body: string): string | null {
  const red = readComponent(body, 'Red');
  const green = readComponent(body, 'Green');
  const blue = readComponent(body, 'Blue');
  if (red === null || green === null || blue === null) {
    return null;
  }
  return hexFromUnitRgb(red, green, blue);
}

function readComponent(body: string, channel: string): number | null {
  const match = new RegExp(`<key>${channel} Component</key>\\s*<real>([^<]+)</real>`).exec(body);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
