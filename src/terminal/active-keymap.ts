/**
 * The keymap in force in THIS window: the shipped platform keymap with the
 * user's rebinds applied.
 *
 * Separate from `keymap.ts` because that module is pure matching logic and
 * this one reads the settings signal — and separate from `lib/keybindings.ts`
 * because the Electron main process imports that file to build the native menu
 * and must not pull a Preact signal into the main bundle.
 *
 * Reading `settings.value` here means a component that calls this during
 * render re-renders when a chord changes (R5), which is what keeps chrome
 * tooltips and the status bar honest after a rebind.
 */
import { settings } from '../settings/settings-store';
import {
  resolveKeymap,
  keymapPlatform,
  type KeybindingOverrides,
  type KeymapPlatform,
} from '../lib/keybindings';
import { getDesktopEnvironment, type DesktopPlatform } from '../lib/platform';
import type { KeyBinding } from './action-registry';

interface Cached {
  readonly platform: KeymapPlatform;
  readonly overrides: KeybindingOverrides | undefined;
  readonly keymap: readonly KeyBinding[];
}

/**
 * `matchBinding` runs on every keydown from a capture-phase window listener,
 * and `resolveKeymap` allocates. Both inputs are stable object identities
 * between settings merges, so an identity check is enough to keep the hot path
 * allocation-free without inventing a cache-invalidation rule.
 */
let cached: Cached | null = null;

export function activeKeymapPlatform(): KeymapPlatform {
  return keymapPlatform(getDesktopEnvironment().platform);
}

export function activeKeymap(): readonly KeyBinding[] {
  const platform = activeKeymapPlatform();
  const overrides = settings.value.keybindings;
  if (cached !== null && cached.platform === platform && cached.overrides === overrides) {
    return cached.keymap;
  }
  const keymap = resolveKeymap(platform, overrides);
  cached = { platform, overrides, keymap };
  return keymap;
}

/**
 * The effective keymap for a NAMED platform — the other platform's column in
 * the Shortcuts section reads through this, so a chord the user rebound on
 * their Windows machine still shows there while they are on macOS.
 *
 * Uncached on purpose: only the running platform's keymap is on the keydown
 * path, and caching a second entry would buy nothing but an invalidation rule
 * to get wrong.
 */
export function keymapForOverrides(platform: DesktopPlatform): readonly KeyBinding[] {
  return resolveKeymap(platform, settings.value.keybindings);
}

/** Test seam — the module cache outlives a test's settings signal writes. */
export function resetActiveKeymapCache(): void {
  cached = null;
}
