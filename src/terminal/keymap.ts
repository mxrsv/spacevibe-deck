import {
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  isActionId,
  type ActionId,
  type CharKeyBinding,
  type PhysicalKeyBinding,
  type KeyBinding,
} from "./action-registry";
import {
  getDesktopEnvironment,
  type DesktopPlatform,
} from "../lib/platform";

// Data lives in action-registry.ts (the SSOT for shortcuts + macOS menu);
// this module is just "match a KeyboardEvent to an action" + the type/name
// aliases every existing caller (tab-manager.ts, app.tsx) already imports
// from here, so nothing outside this file needs to change import paths.
export {
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  type CharKeyBinding,
  type PhysicalKeyBinding,
  type KeyBinding,
};
export type ShortcutAction = ActionId;

export function keymapForPlatform(
  platform: DesktopPlatform,
): readonly KeyBinding[] {
  return platform === "windows" ? WINDOWS_KEYMAP : MACOS_KEYMAP;
}

/**
 * Whether `value` names an action the registry declares — having a
 * platform-keymap binding or not is irrelevant.
 *
 * Guards the one place an action arrives as untrusted data rather than as a
 * matched key event: the macOS menu sends its item id across the Tauri IPC
 * boundary as a plain string.
 */
export function isShortcutAction(value: unknown): value is ShortcutAction {
  return isActionId(value);
}

/**
 * Whether this keydown carries the third-level shift (AltGr).
 *
 * Windows delivers AltGr as left-Ctrl + right-Alt, which Chromium surfaces as
 * `ctrlKey && altKey` — indistinguishable from a deliberate Ctrl+Alt chord by
 * the modifier flags alone. `getModifierState("AltGraph")` is the only signal
 * that separates them; xterm carries its own workaround for the same collision
 * (`_isThirdLevelShift`).
 *
 * Feature-detected because synthetic events (tests, some IME paths) carry the
 * modifier flags without the method.
 */
function hasAltGraph(event: KeyboardEvent): boolean {
  return (
    typeof event.getModifierState === "function" &&
    event.getModifierState("AltGraph")
  );
}

/**
 * Exact match on the key/code and all four modifiers; null when nothing
 * matches. A `PhysicalKeyBinding` (has `code`) matches on `event.code`; a
 * `CharKeyBinding` (has `key`) matches on `event.key`, lowercased — so a
 * non-US layout or an IME rewriting `event.key` still resolves the physical
 * bindings correctly regardless of what character `event.key` carries.
 *
 * Ctrl+Alt bindings are skipped entirely while AltGr is down: on German,
 * Spanish, Italian and Nordic layouts AltGr is how `[`, `]` and `~` are typed,
 * and matching there would `preventDefault()` the character out of the pane.
 */
export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = keymapForPlatform(
    getDesktopEnvironment().platform,
  ),
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  const altGraph = hasAltGraph(event);
  for (const binding of keymap) {
    if (altGraph && binding.ctrl && binding.alt) {
      continue;
    }
    const keyMatches =
      "code" in binding ? binding.code === event.code : binding.key === key;
    if (
      keyMatches &&
      !!binding.meta === event.metaKey &&
      !!binding.shift === event.shiftKey &&
      !!binding.alt === event.altKey &&
      !!binding.ctrl === event.ctrlKey
    ) {
      return binding.action;
    }
  }
  return null;
}

/**
 * 0-based tab index for a `select-tab-N` action, null for any other action —
 * including `select-last-tab` (⌘9), which has no fixed index of its own: its
 * concrete index is resolved against the live tab count in tab-manager.ts.
 */
export function selectTabIndex(action: ShortcutAction): number | null {
  const match = /^select-tab-(\d+)$/.exec(action);
  return match ? Number(match[1]) - 1 : null;
}
