/**
 * User overrides on top of the two platform keymaps.
 *
 * `action-registry.ts` stays the SSOT for what actions EXIST and what their
 * shipped chords are; this module is the one place that answers "what chord
 * does this action have RIGHT NOW", given what the user changed. It is pure —
 * no Preact, no host, no DOM — because the Electron main process resolves the
 * same keymap to build the native menu (`electron/menu.ts`), and a renderer
 * import there would drag the whole UI into the main bundle.
 *
 * Same file, same answer, both processes: a rebind that moved the webview
 * shortcut but not the Cocoa accelerator would leave the OS eating the old
 * chord before the webview ever sees it — the failure that makes a rebind UI
 * worth building carefully rather than quickly.
 */
import {
  MACOS_KEYMAP,
  WINDOWS_KEYMAP,
  isActionId,
  type ActionId,
  type KeyBinding,
} from '../terminal/action-registry';

/** The two keymaps that exist. `unsupported` resolves to the macOS one. */
export type KeymapPlatform = 'macos' | 'windows';

interface ChordModifiers {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
}

/** Matches the character the active layout produces (`event.key`, lowercased). */
export interface CharChord extends ChordModifiers {
  readonly key: string;
}

/** Matches physical key position (`event.code`) — independent of layout/IME. */
export interface CodeChord extends ChordModifiers {
  readonly code: string;
}

/**
 * A `KeyBinding` with its `action` removed: what the user's settings store
 * holds, keyed by the action it belongs to. Splitting it this way means an
 * override can never name an action that does not exist — the key is validated
 * by `isActionId`, and the value cannot contradict it.
 */
export type Chord = CharChord | CodeChord;

/** Chords per action, keyed by `ActionId`. An empty array means "unbound". */
export type KeymapOverride = Readonly<Record<string, readonly Chord[]>>;

export interface KeybindingOverrides {
  readonly macos: KeymapOverride;
  readonly windows: KeymapOverride;
}

export const NO_KEYBINDING_OVERRIDES: KeybindingOverrides = Object.freeze({
  macos: Object.freeze({}),
  windows: Object.freeze({}),
});

/**
 * Ceiling on chords stored for one action. The shipped keymaps never exceed
 * three (Windows `paste`), and the capture UI only ever writes one — this
 * exists so a hand-edited or corrupted `settings.json` cannot make the keymap
 * scan unbounded on every keystroke.
 */
export const MAX_CHORDS_PER_ACTION = 4;

export function defaultKeymap(platform: string): readonly KeyBinding[] {
  return platform === 'windows' ? WINDOWS_KEYMAP : MACOS_KEYMAP;
}

/**
 * Which override bucket a platform name reads from.
 *
 * Takes a bare string rather than `DesktopPlatform` so this module imports
 * nothing from `lib/platform.ts`. That is not tidiness: `platform.ts` is typed
 * against the DOM (`KeyboardEvent`), the Electron main process imports THIS
 * file to build the native menu, and `tsconfig.electron.json` ships no DOM lib
 * — so the import would break the main-process typecheck. `unsupported`, the
 * browser-only dev preview, resolves to the macOS keymap exactly as
 * `keymapForPlatform` has always done.
 */
export function keymapPlatform(platform: string): KeymapPlatform {
  return platform === 'windows' ? 'windows' : 'macos';
}

export function isChord(value: unknown): value is Chord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const chord = value as Record<string, unknown>;
  const hasKey = typeof chord.key === 'string' && chord.key !== '';
  const hasCode = typeof chord.code === 'string' && chord.code !== '';
  // Exactly one of the two: a chord carrying both would match under
  // `matchBinding`'s `"code" in binding` branch while reading as a character
  // binding everywhere else, which is precisely the drift this type prevents.
  if (hasKey === hasCode) {
    return false;
  }
  for (const modifier of ['meta', 'shift', 'alt', 'ctrl'] as const) {
    const present = chord[modifier];
    if (present !== undefined && typeof present !== 'boolean') {
      return false;
    }
  }
  return true;
}

export function chordOf(binding: KeyBinding): Chord {
  const { meta, shift, alt, ctrl } = binding;
  const modifiers = { meta, shift, alt, ctrl };
  return 'code' in binding
    ? { ...modifiers, code: binding.code }
    : { ...modifiers, key: binding.key };
}

export function bindingOf(chord: Chord, action: ActionId): KeyBinding {
  const { meta, shift, alt, ctrl } = chord;
  const modifiers = { meta, shift, alt, ctrl, action };
  return 'code' in chord ? { ...modifiers, code: chord.code } : { ...modifiers, key: chord.key };
}

/**
 * `event.code` → the character a US layout produces for it, unshifted.
 *
 * Only used to compare a `code` chord against a `key` chord for CONFLICT
 * reporting. It is a US-layout assumption and cannot be anything else: a
 * character binding matches whatever the active OS layout reports, and the
 * code-to-character table for a specific layout lives in the keyboard driver,
 * not in this repo (`action-registry.ts` states the same limitation for its
 * own bracket bindings, and `action-registry.test.ts` carries the matching
 * same-kind-only disclaimer). So two chords this table cannot relate are
 * reported as distinct even when one physical key produces both.
 */
const CODE_TO_US_CHAR: Readonly<Record<string, string>> = Object.freeze({
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  Insert: 'insert',
  Enter: 'enter',
  Tab: 'tab',
  Space: ' ',
});

function chordChar(chord: Chord): string {
  if (!('code' in chord)) {
    return chord.key.toLowerCase();
  }
  const mapped = CODE_TO_US_CHAR[chord.code];
  if (mapped !== undefined) {
    return mapped;
  }
  if (chord.code.startsWith('Digit') || chord.code.startsWith('Key')) {
    return chord.code.replace(/^(?:Digit|Key)/, '').toLowerCase();
  }
  return chord.code.toLowerCase();
}

/**
 * Canonical identity of a chord — two chords collide exactly when their ids
 * are equal. Normalizing through `chordChar` is what lets the shipped
 * `{ code: "BracketRight" }` bindings be compared against a user's captured
 * `{ key: "]" }`, which is the collision a naive structural compare misses.
 */
export function chordId(chord: Chord): string {
  const modifiers = [
    chord.meta === true ? 'M' : '',
    chord.ctrl === true ? 'C' : '',
    chord.alt === true ? 'A' : '',
    chord.shift === true ? 'S' : '',
  ].join('');
  return `${modifiers}+${chordChar(chord)}`;
}

export function sameChord(a: Chord, b: Chord): boolean {
  return chordId(a) === chordId(b);
}

function overrideFor(
  overrides: KeybindingOverrides | undefined,
  platform: KeymapPlatform,
): KeymapOverride {
  return overrides?.[platform] ?? {};
}

/**
 * The keymap actually in force: the user's chords for every action they
 * changed, then the shipped chords for every action they did not.
 *
 * Overrides come FIRST on purpose. `matchBinding` returns the first match, so
 * ordering decides who wins a collision — and when a user's explicit choice
 * collides with a default that still holds the same chord, the choice they
 * just made has to be the one that fires. Putting defaults first would make a
 * rebind look accepted in Settings and do nothing at the keyboard, which is
 * the worst of the available failures. The collision is still reported: see
 * `chordConflicts`.
 *
 * An action present in the override map contributes NO default chords, even
 * when its override is empty — that empty array is how "unbind this" is
 * spelled, and it has to be distinguishable from "never touched".
 */
export function resolveKeymap(
  platform: string,
  overrides?: KeybindingOverrides,
): readonly KeyBinding[] {
  const bucket = keymapPlatform(platform);
  const map = overrideFor(overrides, bucket);
  const overridden = Object.keys(map);
  if (overridden.length === 0) {
    return defaultKeymap(platform);
  }
  const custom: KeyBinding[] = [];
  for (const action of overridden) {
    if (!isActionId(action)) {
      continue;
    }
    for (const chord of map[action]) {
      custom.push(bindingOf(chord, action));
    }
  }
  const kept = defaultKeymap(platform).filter(
    (binding) => !Object.prototype.hasOwnProperty.call(map, binding.action),
  );
  return [...custom, ...kept];
}

/**
 * Every chord claimed by more than one action, mapped to the actions claiming
 * it in keymap order. Empty when the keymap is clean.
 *
 * A duplicate is not rejected at write time — a user mid-way through swapping
 * two actions' chords necessarily passes through a colliding state, and
 * refusing the first half of that swap makes it impossible to finish. It is
 * reported instead, on both rows.
 */
export function chordConflicts(
  keymap: readonly KeyBinding[],
): ReadonlyMap<string, readonly ActionId[]> {
  const byChord = new Map<string, ActionId[]>();
  for (const binding of keymap) {
    const id = chordId(chordOf(binding));
    const actions = byChord.get(id);
    if (actions === undefined) {
      byChord.set(id, [binding.action]);
    } else if (!actions.includes(binding.action)) {
      // Same action bound twice to one chord is redundant, not a conflict.
      actions.push(binding.action);
    }
  }
  const conflicts = new Map<string, readonly ActionId[]>();
  for (const [id, actions] of byChord) {
    if (actions.length > 1) {
      conflicts.set(id, actions);
    }
  }
  return conflicts;
}

/** Chords bound to `action` in `keymap`, in keymap order. */
export function chordsForAction(keymap: readonly KeyBinding[], action: ActionId): readonly Chord[] {
  return keymap.filter((binding) => binding.action === action).map((binding) => chordOf(binding));
}

/**
 * Keys that mean something unmodified because they produce no character —
 * function keys only.
 *
 * Navigation keys are deliberately NOT here. An earlier version listed
 * arrows/Home/End/PageUp as "never produce a character the PTY would otherwise
 * receive", which is wrong: they send escape sequences, and those escape
 * sequences ARE shell history, readline and vim navigation. Binding a bare ↑
 * cost every pane its history recall, silently, because `handleShortcut`
 * preventDefaults before xterm sees the key.
 */
const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;

/**
 * Keys that may take Shift ALONE as their modifier — they still need one, but
 * Shift is enough because the unmodified key is already a navigation escape
 * sequence rather than a character. The shipped `Shift+PageUp` / `Shift+Home`
 * scrollback bindings are exactly this case.
 */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'pageup',
  'pagedown',
  'home',
  'end',
  'insert',
  'delete',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);

/**
 * Whether a chord may be bound at all — the ONE rule, applied both when the
 * user records a chord and when a stored one is read back.
 *
 * Shift is not a sufficient modifier for a printable key. It reads like one,
 * and treating it as one made `Shift+A` bindable, which takes capital A away
 * from every pane — the very outcome this rule exists to prevent — and made
 * Shift+Enter stealable from the agent-CLI newline (`shift-enter.ts`), which
 * is not in the registry and so cannot even be reported as a conflict.
 *
 * Applied at load as well as at capture on purpose: a hand-edited, synced or
 * half-written `settings.json` could otherwise bind bare `a` to `close-pane`,
 * something the UI refuses, and the app would treat the file as valid.
 */
export function isAdmissibleChord(chord: Chord): boolean {
  if ('code' in chord) {
    // Only the shipped keymaps carry code chords, and a capture never writes
    // one. Nothing user-supplied reaches this branch.
    return true;
  }
  const key = chord.key.toLowerCase();
  if (FUNCTION_KEY.test(key)) {
    return true;
  }
  const primary = chord.meta === true || chord.ctrl === true || chord.alt === true;
  if (NAVIGATION_KEYS.has(key)) {
    return primary || chord.shift === true;
  }
  return primary;
}

function validateChordList(raw: unknown): readonly Chord[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  if (raw.length > MAX_CHORDS_PER_ACTION) {
    return null;
  }
  const chords: Chord[] = [];
  for (const entry of raw) {
    if (!isChord(entry) || !isAdmissibleChord(entry)) {
      // Drop-not-repair, the discipline `validateCustomAgents` already uses:
      // a half-understood chord is not guessed at, because guessing wrong
      // binds a key the user never asked for. `isAdmissibleChord` is what
      // stops a hand-edited file binding something the capture UI refuses.
      return null;
    }
    chords.push(entry);
  }
  return chords;
}

function validateKeymapOverride(raw: unknown): KeymapOverride {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const result: Record<string, readonly Chord[]> = {};
  for (const action of Object.keys(source)) {
    if (!isActionId(action)) {
      continue;
    }
    const chords = validateChordList(source[action]);
    if (chords !== null) {
      result[action] = chords;
    }
  }
  return result;
}

/**
 * Validate the stored override map. An unreadable entry is dropped, never
 * repaired — the whole map falling back to defaults would silently discard
 * every rebind the user made because one entry went bad.
 */
export function validateKeybindings(raw: unknown): KeybindingOverrides {
  if (typeof raw !== 'object' || raw === null) {
    return NO_KEYBINDING_OVERRIDES;
  }
  const source = raw as Record<string, unknown>;
  return {
    macos: validateKeymapOverride(source.macos),
    windows: validateKeymapOverride(source.windows),
  };
}

/** Whether the user has changed this action's chords on this platform. */
export function isOverridden(
  overrides: KeybindingOverrides | undefined,
  platform: KeymapPlatform,
  action: ActionId,
): boolean {
  return Object.prototype.hasOwnProperty.call(overrideFor(overrides, platform), action);
}

/**
 * Set (or, with `chords === null`, clear) one action's override and return the
 * whole map — the shape `updateSettings` takes. Clearing removes the key
 * rather than storing an empty array: those two states mean different things
 * (`resolveKeymap`), and confusing them turns "reset to default" into
 * "unbind".
 */
export function withOverride(
  overrides: KeybindingOverrides,
  platform: KeymapPlatform,
  action: ActionId,
  chords: readonly Chord[] | null,
): KeybindingOverrides {
  const current = overrideFor(overrides, platform);
  const { [action]: _cleared, ...rest } = current;
  // PREPENDED, not appended, and the order is load-bearing. `resolveKeymap`
  // walks these keys in insertion order and `matchBinding` takes the first
  // match, so key order decides who wins a collision between two overrides.
  // Appending made the MOST RECENT edit lose: binding find→⌘⌥K then
  // split-row→⌘⌥K fired `find`, and then re-recording ⌘⌥K onto `find` — a
  // no-op from the user's side — flipped it to `split-row`. Resolving a
  // conflict by re-confirming the chord you want handed you the one you did
  // not.
  const next = chords === null ? rest : { [action]: chords, ...rest };
  return { ...overrides, [platform]: next };
}
