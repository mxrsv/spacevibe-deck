import {
  type ActionId,
  type CharKeyBinding,
  type KeyBinding,
  type PhysicalKeyBinding,
} from '../terminal/action-registry';
import { keymapForOverrides } from '../terminal/active-keymap';
import { getDesktopEnvironment, type DesktopPlatform } from './platform';

const MACOS_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  enter: '↩',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  tab: 'Tab',
});

const WINDOWS_KEY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  enter: 'Enter',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  tab: 'Tab',
});

const CODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  BracketLeft: '[',
  BracketRight: ']',
});

/**
 * A binding with the action taken off — the modifiers and the key, which is
 * all display formatting ever reads.
 *
 * It exists so a chord that is not (yet) a registered action can still be
 * formatted by this file rather than written out as a literal `⌘⇧E`: the
 * gallery previews toolbar entries whose actions are still specified, not
 * built, and a hardcoded chord there would be a macOS label that silently
 * survives onto Windows.
 */
export type KeyChord = Omit<CharKeyBinding, 'action'> | Omit<PhysicalKeyBinding, 'action'>;

function bindingKey(binding: KeyChord, platform: DesktopPlatform): string {
  if ('code' in binding) {
    if (CODE_LABELS[binding.code]) {
      return CODE_LABELS[binding.code];
    }
    return binding.code.replace(/^(?:Digit|Key)/, '');
  }
  const labels = platform === 'windows' ? WINDOWS_KEY_LABELS : MACOS_KEY_LABELS;
  return labels[binding.key] ?? binding.key.toUpperCase();
}

export function formatShortcutBinding(binding: KeyBinding, platform: DesktopPlatform): string {
  return formatKeyChord(binding, platform);
}

export function formatKeyChord(binding: KeyChord, platform: DesktopPlatform): string {
  const key = bindingKey(binding, platform);
  if (platform === 'windows') {
    const modifiers = [
      binding.ctrl ? 'Ctrl' : null,
      binding.alt ? 'Alt' : null,
      binding.shift ? 'Shift' : null,
      binding.meta ? 'Meta' : null,
    ].filter((modifier): modifier is string => modifier !== null);
    return [...modifiers, key].join('+');
  }

  const modifiers = [
    binding.meta ? '⌘' : '',
    binding.alt ? '⌥' : '',
    binding.shift ? '⇧' : '',
    binding.ctrl ? '⌃' : '',
  ].join('');
  return `${modifiers}${key}`;
}

/**
 * The chord to SHOW for an action, or null when it has none.
 *
 * Resolves through the user's overrides rather than the shipped keymap: every
 * caller is a tooltip or a status-bar hint, and a hint naming a chord the user
 * has rebound away is worse than no hint at all. Reading the settings signal
 * also means the callers re-render on a rebind, since all of them read this
 * during render (R5).
 */
export function shortcutLabel(
  action: ActionId,
  platform: DesktopPlatform = getDesktopEnvironment().platform,
  keymap: readonly KeyBinding[] = keymapForOverrides(platform),
): string | null {
  const binding = keymap.find((candidate) => candidate.action === action);
  return binding ? formatShortcutBinding(binding, platform) : null;
}

export function primaryModifierName(
  platform: DesktopPlatform = getDesktopEnvironment().platform,
): 'Cmd' | 'Ctrl' {
  return platform === 'windows' ? 'Ctrl' : 'Cmd';
}

/**
 * `"Split vertically (⌘D)"`, or just `"Split vertically"` when the action has
 * no chord.
 *
 * Exists because `shortcutLabel` can now return null for real: before rebinding
 * existed, every action a tooltip named was bound by definition, so six call
 * sites interpolated the result straight into a template and rendered
 * `"New tab (null)"` the moment a user unbound something.
 */
export function titleWithShortcut(
  title: string,
  action: ActionId,
  platform: DesktopPlatform = getDesktopEnvironment().platform,
): string {
  const chord = shortcutLabel(action, platform);
  return chord === null ? title : `${title} (${chord})`;
}
