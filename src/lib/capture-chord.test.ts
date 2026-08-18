import { describe, expect, it } from 'vitest';
import { captureChord } from './capture-chord';
import { chordId } from './keybindings';
import { MACOS_KEYMAP, WINDOWS_KEYMAP } from '../terminal/action-registry';

function keyEvent(
  key: string,
  mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>> = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...mods,
  } as KeyboardEvent;
}

describe('captureChord', () => {
  it('records the character, lowercased, with all four modifiers', () => {
    // Lowercased because `matchBinding` lowercases `event.key` before
    // comparing; storing "D" would produce a chord that never matches.
    const result = captureChord(keyEvent('D', { metaKey: true, shiftKey: true }));
    expect(result).toEqual({
      ok: true,
      chord: { key: 'd', meta: true, shift: true, alt: false, ctrl: false },
    });
  });

  it('stays quiet while only modifiers are held', () => {
    for (const key of ['Shift', 'Meta', 'Control', 'Alt']) {
      expect(captureChord(keyEvent(key, { metaKey: true }))).toEqual({
        ok: false,
        reason: 'modifier-only',
      });
    }
  });

  it('reserves Escape and bare Tab, which the capture control needs for itself', () => {
    expect(captureChord(keyEvent('Escape'))).toEqual({
      ok: false,
      reason: 'reserved',
    });
    expect(captureChord(keyEvent('Escape', { metaKey: true }))).toEqual({
      ok: false,
      reason: 'reserved',
    });
    expect(captureChord(keyEvent('Tab'))).toEqual({
      ok: false,
      reason: 'reserved',
    });
  });

  it('records a MODIFIED Tab — two shipped Windows defaults use one', () => {
    // Reserving every Tab chord would leave Ctrl+Tab (`next-tab`) and
    // Ctrl+Shift+Tab (`prev-tab`) resettable but never re-choosable.
    const result = captureChord(keyEvent('Tab', { ctrlKey: true }));
    expect(result.ok && chordId(result.chord)).toBe(chordId({ key: 'tab', ctrl: true }));
  });

  it('refuses a bare printable key', () => {
    // Binding one would make that character untypeable in every pane.
    expect(captureChord(keyEvent('a'))).toEqual({
      ok: false,
      reason: 'needs-modifier',
    });
    expect(captureChord(keyEvent('1'))).toEqual({
      ok: false,
      reason: 'needs-modifier',
    });
  });

  it('allows a BARE function key — Windows ships find-next on F3', () => {
    // The only bare-key exemption. Refusing it would make a shipped default
    // impossible to re-record.
    expect(captureChord(keyEvent('F3'))).toMatchObject({ ok: true });
    expect(captureChord(keyEvent('F12'))).toMatchObject({ ok: true });
  });

  it("refuses a BARE navigation key — those escape sequences are the shell's", () => {
    // ArrowUp is history recall, Home/End are line motion. An earlier rule
    // called these "keys that never produce a character the PTY would
    // otherwise receive", which is wrong: binding bare ↑ cost every pane its
    // history, silently, because handleShortcut preventDefaults first.
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'Delete']) {
      expect(captureChord(keyEvent(key)), key).toEqual({
        ok: false,
        reason: 'needs-modifier',
      });
    }
  });

  it('takes Shift alone for a navigation key — the shipped scrollback chords', () => {
    expect(captureChord(keyEvent('PageUp', { shiftKey: true }))).toMatchObject({
      ok: true,
    });
    expect(captureChord(keyEvent('Home', { shiftKey: true }))).toMatchObject({
      ok: true,
    });
  });

  it('refuses Shift as the only modifier on a PRINTABLE key', () => {
    // Shift+A is a bare letter wearing a modifier. Accepting it took capital A
    // away from every pane, and made Shift+Enter — the agent-CLI newline in
    // shift-enter.ts, which is not in the registry and so cannot even be
    // reported as a conflict — silently stealable.
    expect(captureChord(keyEvent('A', { shiftKey: true }))).toEqual({
      ok: false,
      reason: 'needs-modifier',
    });
    expect(captureChord(keyEvent('Enter', { shiftKey: true }))).toEqual({
      ok: false,
      reason: 'needs-modifier',
    });
  });

  it('names the chords macOS will never deliver instead of sitting silent', () => {
    for (const [key, mods] of [
      ['Tab', { metaKey: true }],
      [' ', { metaKey: true }],
      ['q', { metaKey: true }],
      ['h', { metaKey: true }],
      ['h', { metaKey: true, altKey: true }],
    ] as const) {
      expect(captureChord(keyEvent(key, mods)), key).toEqual({
        ok: false,
        reason: 'system-reserved',
      });
    }
  });

  it('captures Shift alone as a modifier for a named key', () => {
    const result = captureChord(keyEvent('PageUp', { shiftKey: true }));
    expect(result.ok && chordId(result.chord)).toBe(chordId({ key: 'pageup', shift: true }));
  });

  it('never produces a code chord, even for a key that ships as one', () => {
    // The RULE in action-registry.ts: an action with a macOS menu item must
    // bind by character, and this UI can rebind those. A capture also records
    // what the user actually pressed, which a physical position does not.
    const result = captureChord(keyEvent(']', { metaKey: true }));
    expect(result.ok && 'code' in result.chord).toBe(false);
    expect(result.ok && result.chord.key).toBe(']');
  });

  it('reproduces every shipped character binding it is shown', () => {
    // A chord the user re-presses to "set it to what it already is" must come
    // back identical, or the row would show an override where none exists.
    for (const binding of [...MACOS_KEYMAP, ...WINDOWS_KEYMAP]) {
      if ('code' in binding) {
        continue;
      }
      const result = captureChord(
        keyEvent(binding.key, {
          metaKey: binding.meta === true,
          shiftKey: binding.shift === true,
          altKey: binding.alt === true,
          ctrlKey: binding.ctrl === true,
        }),
      );
      expect(result.ok, `${binding.action} (${binding.key})`).toBe(true);
      if (result.ok) {
        expect(chordId(result.chord), binding.action).toBe(chordId(binding));
      }
    }
  });
});
