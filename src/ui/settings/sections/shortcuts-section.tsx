/**
 * The Shortcuts category: every action Deck can run, the chord it answers to
 * on each platform, and a way to change it.
 *
 * Both keymaps are shown, not just the running one (decided 2026-08-11). The
 * running platform's chord is the editable pill; the other platform's is a
 * readout, because a chord can only be RECORDED on the keyboard that produces
 * it — capturing a Windows Ctrl+Alt chord on a Mac keyboard is not something a
 * capture control can honestly offer, and a text field for it would invite
 * exactly the malformed input `validateKeybindings` exists to drop.
 *
 * Layout rules are DL §17; the row is still a `cfg-row`, with the two chords
 * and the reset button sharing the value slot.
 */
import { RotateCcw } from "lucide-preact";
import { ConfigGroup } from "../../controls/config-row";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ShortcutCapture, formatChords } from "../../controls/shortcut-capture";
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
  type KeymapPlatform,
} from "../../../lib/keybindings";
import { getDesktopEnvironment } from "../../../lib/platform";
import { shortcutGroups } from "../shortcut-groups";
import type { ActionId } from "../../../terminal/action-registry";

/** Column tag beside each chord (DL-17.2) — lowercase chrome, like everything else. */
const PLATFORM_TAG: Readonly<Record<KeymapPlatform, string>> = {
  macos: "mac",
  windows: "win",
};

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

  // Resolved once per render for both platforms, then read per row: doing it
  // inside the row would re-resolve ~50 times for a list that cannot change
  // between rows of the same render.
  const keymaps: Record<KeymapPlatform, ReturnType<typeof resolveKeymap>> = {
    macos: resolveKeymap("macos", overrides),
    windows: resolveKeymap("windows", overrides),
  };
  const conflicts = chordConflicts(keymaps[running]);
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
    for (const chord of chordsForAction(keymaps[running], action)) {
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
                  <span class="cfg-chords">
                    {(["macos", "windows"] as const).map((side) => {
                      const chords = chordsForAction(keymaps[side], row.action);
                      return (
                        <span key={side} class="cfg-chord-slot">
                          <span class="cfg-chord-tag">
                            {PLATFORM_TAG[side]}
                          </span>
                          {side === running ? (
                            <ShortcutCapture
                              action={row.action}
                              label={row.label}
                              chords={chords}
                              platform={platform}
                              onCommit={(next) => commit(row.action, next)}
                            />
                          ) : (
                            <span class="cfg-readout">
                              {formatChords(chords, row.action, side)}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </span>
                  {overridden && (
                    <button
                      type="button"
                      class="cfg-clear"
                      aria-label={`Reset ${row.label} shortcut to default`}
                      title="Reset to default shortcut"
                      onClick={() => reset(row.action)}
                    >
                      <DeckIcon icon={RotateCcw} size={ROW_ICON} />
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
