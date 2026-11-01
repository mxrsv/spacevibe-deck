import {
  bindingOf,
  chordConflicts,
  chordId,
  chordsForAction,
  defaultKeymap,
  keymapPlatform,
  resolveKeymap,
  withOverride,
  type Chord,
  type KeybindingOverrides,
  type KeymapPlatform,
} from "../../lib/keybindings";
import type { DesktopPlatform } from "../../lib/platform";
import { formatShortcutBinding } from "../../lib/shortcut-label";
import { shortcutPlatform, type CommandSources } from "../../settings/command-search";
import type { ActionId } from "../../terminal/action-registry";

/*
 * What a shortcut row reads and writes, from one snapshot. The rules are the old
 * Shortcuts section's: only the running platform's keymap is shown and edited, and
 * the user's newest choice sits first in it, so it is the one that fires.
 */

export interface ShortcutContext {
  readonly platform: DesktopPlatform;
  readonly running: KeymapPlatform;
  readonly overrides: KeybindingOverrides;
  readonly keymap: ReturnType<typeof resolveKeymap>;
  readonly conflicts: ReadonlyMap<string, readonly ActionId[]>;
  readonly labels: ReadonlyMap<ActionId, string>;
}

export function shortcutContext(sources: CommandSources): ShortcutContext {
  const running = keymapPlatform(sources.platform);
  const keymap = resolveKeymap(running, sources.settings.keybindings);
  return {
    platform: shortcutPlatform(sources.platform),
    running,
    overrides: sources.settings.keybindings,
    keymap,
    conflicts: chordConflicts(keymap),
    labels: new Map(
      sources.shortcuts.flatMap((group) => group.rows.map((r) => [r.action, r.label])),
    ),
  };
}

/** The chord as key caps: `⌘⇧D` is three, `Ctrl+Shift+D` is three. */
export function chordCaps(chord: Chord, action: ActionId, platform: DesktopPlatform): string[] {
  const text = formatShortcutBinding(bindingOf(chord, action), platform);
  if (platform === "windows") {
    return text.endsWith("+")
      ? [...text.slice(0, -1).split("+").filter(Boolean), "+"]
      : text.split("+");
  }
  const [, modifiers, key] = /^([⌘⌥⇧⌃]*)(.*)$/u.exec(text) ?? [];
  return [...Array.from(modifiers ?? ""), key ?? ""].filter(Boolean);
}

/** What the default chords print as, for the reset's name. */
export function defaultChordText(context: ShortcutContext, action: ActionId): string {
  const chords = chordsForAction(defaultKeymap(context.running), action);
  return chords.length === 0
    ? "unbound"
    : chords
        .map((chord) => formatShortcutBinding(bindingOf(chord, action), context.platform))
        .join(" · ");
}

/** The other actions that share a chord with this one, in keymap order. */
export function rivalsOf(context: ShortcutContext, action: ActionId): readonly ActionId[] {
  const rivals = new Set<ActionId>();
  for (const chord of chordsForAction(context.keymap, action)) {
    for (const other of context.conflicts.get(chordId(chord)) ?? []) {
      if (other !== action) rivals.add(other);
    }
  }
  return [...rivals];
}

/**
 * The overrides after this action keeps the chords it shares: every rival drops them and keeps
 * any other chord it has. An override that ends up empty unbinds the rival, which is how a
 * chord that was only ever a shipped default is taken away.
 */
export function reassignChords(context: ShortcutContext, action: ActionId): KeybindingOverrides {
  const mine = new Set(chordsForAction(context.keymap, action).map(chordId));
  return rivalsOf(context, action).reduce(
    (overrides, rival) =>
      withOverride(
        overrides,
        context.running,
        rival,
        chordsForAction(context.keymap, rival).filter((chord) => !mine.has(chordId(chord))),
      ),
    context.overrides,
  );
}
