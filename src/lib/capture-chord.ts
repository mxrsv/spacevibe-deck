/**
 * Turning a keydown into a storable chord.
 *
 * Split out of `lib/keybindings.ts` so THAT file stays free of DOM types: the
 * Electron main process imports it to build the native menu, and
 * `tsconfig.electron.json` ships no DOM lib, so a `KeyboardEvent` in the
 * resolver would break the main-process typecheck. Nothing in the main process
 * ever captures a chord — only the renderer does.
 */
import type { CharChord } from "./keybindings";

/**
 * Keys that carry meaning without a modifier, because they never produce a
 * character the PTY would otherwise receive. Everything else must be modified:
 * binding a bare letter would make that letter untypeable in every pane, which
 * no confirmation dialog makes acceptable.
 *
 * `f3` (Windows `find-next`) and `pageup`/`home` (scrollback, Shift-only) are
 * shipped bindings that live in exactly this exemption, so it is not a
 * hypothetical allowance.
 */
const NON_TYPING_KEYS: ReadonlySet<string> = new Set([
  "pageup",
  "pagedown",
  "home",
  "end",
  "insert",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "shift",
  "control",
  "alt",
  "meta",
  "altgraph",
  "capslock",
  "os",
]);

export type CaptureRejection =
  | "modifier-only"
  | "reserved"
  | "needs-modifier";

export type CaptureResult =
  | { readonly ok: true; readonly chord: CharChord }
  | { readonly ok: false; readonly reason: CaptureRejection };

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
  const modified =
    event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
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
  const chord: CharChord = {
    key,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
  };
  const nonTyping = NON_TYPING_KEYS.has(key) || FUNCTION_KEY.test(key);
  if (!modified && !nonTyping) {
    return { ok: false, reason: "needs-modifier" };
  }
  return { ok: true, chord };
}
