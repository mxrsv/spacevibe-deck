import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store is host-backed; this module only reads the settings signal.
vi.mock('../host/store-host', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));

import { activeKeymap, resetActiveKeymapCache } from './active-keymap';
import { matchBinding } from './keymap';
import { settings } from '../settings/settings-store';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';
import { MACOS_KEYMAP } from './action-registry';
import { NO_KEYBINDING_OVERRIDES, withOverride } from '../lib/keybindings';

function keyEvent(
  key: string,
  mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>> = {},
): KeyboardEvent {
  return {
    key,
    code: '',
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  } as KeyboardEvent;
}

/**
 * The keydown hot path, end to end.
 *
 * `matchBinding` is called with NO keymap argument on purpose — that default is
 * the only thing standing between a stored rebind and the running app, and it
 * had no coverage at all: the section test resolved a keymap by hand and passed
 * it in, so an `activeKeymap()` cache that never invalidated would have left
 * every test green while no rebind reached the keyboard.
 */
describe('activeKeymap — the default keymap matchBinding uses', () => {
  beforeEach(() => {
    settings.value = DEFAULT_SETTINGS;
    resetActiveKeymapCache();
  });

  it('is the shipped keymap when nothing is overridden', () => {
    expect(activeKeymap()).toBe(MACOS_KEYMAP);
    expect(matchBinding(keyEvent('d', { metaKey: true }))).toBe('split-row');
  });

  it('picks up a rebind written to the settings signal, with no cache reset', () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, 'macos', 'find', [
        { key: 'j', meta: true, alt: true },
      ]),
    };
    // Deliberately NOT calling resetActiveKeymapCache() here: production has no
    // such call, so a stale cache has to be observable from this alone.
    expect(matchBinding(keyEvent('j', { metaKey: true, altKey: true }))).toBe('find');
    expect(matchBinding(keyEvent('f', { metaKey: true }))).toBeNull();
  });

  it('follows a second rebind, and a reset back to the default', () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, 'macos', 'find', [
        { key: 'j', meta: true, alt: true },
      ]),
    };
    expect(matchBinding(keyEvent('j', { metaKey: true, altKey: true }))).toBe('find');

    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, 'macos', 'find', [
        { key: 'l', meta: true, alt: true },
      ]),
    };
    expect(matchBinding(keyEvent('j', { metaKey: true, altKey: true }))).toBeNull();
    expect(matchBinding(keyEvent('l', { metaKey: true, altKey: true }))).toBe('find');

    settings.value = { ...DEFAULT_SETTINGS };
    expect(matchBinding(keyEvent('f', { metaKey: true }))).toBe('find');
  });

  it('reuses the same array while the overrides object is unchanged', () => {
    // The cache is what keeps `resolveKeymap` off every keystroke; if the
    // identity check stopped working it would allocate a keymap per keydown.
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, 'macos', 'find', [
        { key: 'j', meta: true, alt: true },
      ]),
    };
    expect(activeKeymap()).toBe(activeKeymap());
  });

  it('stops firing an action the user unbound', () => {
    settings.value = {
      ...DEFAULT_SETTINGS,
      keybindings: withOverride(NO_KEYBINDING_OVERRIDES, 'macos', 'clear-buffer', []),
    };
    expect(matchBinding(keyEvent('k', { metaKey: true }))).toBeNull();
  });
});
