/**
 * Turning a keydown into a storable chord.
 *
 * Split out of `lib/keybindings.ts` so THAT file stays free of DOM types: the
 * Electron main process imports it to build the native menu, and
 * `tsconfig.electron.json` ships no DOM lib, so a `KeyboardEvent` in the
 * resolver would break the main-process typecheck. Nothing in the main process
 * ever captures a chord — only the renderer does.
 *
 * What a chord is ALLOWED to be lives in `keybindings.ts` (`isAdmissibleChord`),
 * not here, because the same rule has to run when a stored chord is read back.
 * This file only decides what a keydown MEANS.
 */
import { isAdmissibleChord, type CharChord } from "./keybindings";

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "altgraph",
  "capslock",
  "os",
]);

export type CaptureRejection = "modifier-only" | "reserved" | "system-reserved" | "needs-modifier";

export type CaptureResult =
  | { readonly ok: true; readonly chord: CharChord }
  | { readonly ok: false; readonly reason: CaptureRejection };

/**
 * Chords macOS never delivers to the app, whatever the menu is doing.
 *
 * ⌘Tab and ⌘Space are taken by the WindowServer before Chromium sees them, so
 * a capture would simply sit there looking broken. ⌘Q and ⌘H are NOT in that
 * class — they are ordinary menu key equivalents and could be claimed — but
 * claiming Quit or Hide is against the macOS HIG and is not a choice to let a
 * user make by accident.
 *
 * Reported with a reason rather than silently ignored: the field convention
 * (VS Code, Ghostty) is to let the OS win and SAY so, never to fail quietly.
 */
const SYSTEM_RESERVED: ReadonlySet<string> = new Set(["M+tab", "M+ ", "M+q", "M+h", "MA+h"]);

function reservationId(event: KeyboardEvent, key: string): string {
  const modifiers = [
    event.metaKey ? "M" : "",
    event.ctrlKey ? "C" : "",
    event.altKey ? "A" : "",
    event.shiftKey ? "S" : "",
  ].join("");
  return `${modifiers}+${key}`;
}

/**
 * Turn a keydown into a storable chord, or say why it cannot be one.
 *
 * Always a `CharChord`, never a `CodeChord`, and that is a rule rather than a
 * shortcut. Two reasons, either one sufficient. First, an action carrying a
 * macOS menu item MUST bind by character — a Cocoa accelerator is declared by
 * character and never by physical position (`action-registry.ts`'s RULE), and
 * this UI can rebind those actions. Second, a capture records what the user
 * actually pressed on the layout in front of them; storing the physical
 * position instead would silently bind a key they never chose the moment they
 * switch layouts. The shipped keymaps keep their `code` bindings — those were
 * chosen deliberately for actions with no menu item — and this only governs
 * what a capture writes.
 */
export function captureChord(event: KeyboardEvent): CaptureResult {
  const key = event.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) {
    return { ok: false, reason: "modifier-only" };
  }
  const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  // Escape always cancels, and BARE Tab has to keep moving focus, or the
  // capture control is a keyboard trap with no way out of it.
  //
  // Only bare Tab, though: Windows ships `next-tab` on Ctrl+Tab and
  // `prev-tab` on Ctrl+Shift+Tab, so reserving every Tab chord would leave two
  // shipped defaults impossible to re-record — the user could reset to them
  // but never choose them.
  if (key === "escape" || (key === "tab" && !modified)) {
    return { ok: false, reason: "reserved" };
  }
  if (SYSTEM_RESERVED.has(reservationId(event, key))) {
    return { ok: false, reason: "system-reserved" };
  }
  const chord: CharChord = {
    key,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
  };
  if (!isAdmissibleChord(chord)) {
    return { ok: false, reason: "needs-modifier" };
  }
  return { ok: true, chord };
}
