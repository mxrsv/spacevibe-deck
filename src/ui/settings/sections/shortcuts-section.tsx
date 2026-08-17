/**
 * The Shortcuts category: every action Deck can run, the chord it answers to
 * on the platform the app is running on, and a way to change it.
 *
 * Only the running keymap is shown (decided 2026-08-15, reversing the
 * 2026-08-11 both-keymaps decision): a desktop app knows which machine it is
 * on, and the other platform's chords are a docs-page concern, not a settings
 * one. The other keymap's overrides remain stored in settings untouched — they
 * are simply not rendered here.
 *
 * Layout rules are DL §17; the row is still a `cfg-row`, with the chord pill
 * and the reset button sharing the value slot.
 */
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { ConfigGroup } from "../../controls/config-row";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ShortcutCapture } from "../../controls/shortcut-capture";
import { settings, updateSettings } from "../../../settings/settings-store";
import {
  chordConflicts,
  chordId,
  chordsForAction,
  isOverridden,
  keymapPlatform,
  resolveKeymap,
  withOverride,
  type Chord,
} from "../../../lib/keybindings";
import { getDesktopEnvironment } from "../../../lib/platform";
import { shortcutGroups } from "../shortcut-groups";
import type { ActionId } from "../../../terminal/action-registry";

/** Action id → display name, for naming the other side of a conflict. */
function labelIndex(): ReadonlyMap<ActionId, string> {
  const index = new Map<ActionId, string>();
  for (const group of shortcutGroups()) {
    for (const row of group.rows) {
      index.set(row.action, row.label);
    }
  }
  return index;
}

export function ShortcutsSection() {
  const platform = getDesktopEnvironment().platform;
  const running = keymapPlatform(platform);
  const overrides = settings.value.keybindings;

  // Resolved once per render, then read per row: doing it inside the row
  // would re-resolve ~50 times for a list that cannot change between rows of
  // the same render.
  const keymap = resolveKeymap(running, overrides);
  const conflicts = chordConflicts(keymap);
  const labels = labelIndex();

  const commit = (action: ActionId, chords: readonly Chord[]): void => {
    updateSettings({
      keybindings: withOverride(overrides, running, action, chords),
    });
  };

  const reset = (action: ActionId): void => {
    updateSettings({
      keybindings: withOverride(overrides, running, action, null),
    });
  };

  /**
   * "also bound to X" for the running platform, or undefined when clean.
   *
   * Reported on BOTH rows involved rather than only the one just changed: the
   * user who arrives later has no way to know which of the two was the newer
   * edit, and silently telling only one of them makes the other look correct.
   */
  const conflictDesc = (action: ActionId): string | undefined => {
    const others = new Set<string>();
    for (const chord of chordsForAction(keymap, action)) {
      for (const other of conflicts.get(chordId(chord)) ?? []) {
        if (other !== action) {
          others.add(labels.get(other) ?? other);
        }
      }
    }
    return others.size === 0
      ? undefined
      : `also bound to ${[...others].join(", ")}`;
  };

  return (
    <>
      {shortcutGroups().map((group) => (
        <div key={group.id}>
          <ConfigGroup label={group.label} />
          {group.rows.map((row) => {
            const conflict = conflictDesc(row.action);
            const overridden = isOverridden(overrides, running, row.action);
            return (
              <div key={row.action} class="cfg-row cfg-row--shortcut">
                <div class="cfg-row__key">
                  <span class="cfg-row__label">{row.label}</span>
                  {conflict !== undefined && (
                    <span class="cfg-row__desc cfg-row__desc--warn">
                      {conflict}
                    </span>
                  )}
                </div>
                <div class="cfg-row__value">
                  <ShortcutCapture
                    action={row.action}
                    label={row.label}
                    chords={chordsForAction(keymap, row.action)}
                    platform={platform}
                    onCommit={(next) => commit(row.action, next)}
                  />
                  {overridden && (
                    <button
                      type="button"
                      class="cfg-clear"
                      aria-label={`Reset ${row.label} shortcut to default`}
                      title="Reset to default shortcut"
                      onClick={() => reset(row.action)}
                    >
                      <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
