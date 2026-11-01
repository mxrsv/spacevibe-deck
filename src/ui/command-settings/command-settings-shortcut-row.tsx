import { chordsForAction, isOverridden, withOverride, type Chord } from "../../lib/keybindings";
import { settings, updateSettings } from "../../settings/settings-store";
import type { ActionId } from "../../terminal/action-registry";
import { Chord as ChordCaps } from "../blocks/chord";
import { Button } from "../controls/button";
import { useChordRecording } from "../controls/shortcut-capture";
import { RowReset, RowShell } from "./command-settings-live-row";
import {
  chordCaps,
  defaultChordText,
  reassignChords,
  rivalsOf,
  type ShortcutContext,
} from "./command-settings-shortcuts";

interface ShortcutRowProps {
  readonly itemKey: string;
  readonly action: ActionId;
  readonly label: string;
  readonly context: ShortcutContext;
  readonly crumb: string | null;
  readonly active: boolean;
  /** The settings snapshot is still loading. */
  readonly locked: boolean;
}

/** Write one action's chords (none unbinds; null puts the shipped ones back). */
function writeChords(context: ShortcutContext, action: ActionId, chords: readonly Chord[] | null) {
  updateSettings({
    keybindings: withOverride(settings.value.keybindings, context.running, action, chords),
  });
}

/**
 * One rebindable action as a row: its chords as key caps, a button that records a new one, a
 * reset once it differs from the shipped chord, and, while another action holds the same chord,
 * a line naming it with Reassign. The recorder is the one the Shortcuts section uses.
 */
export function ShortcutRow({
  itemKey,
  action,
  label,
  context,
  crumb,
  active,
  locked,
}: ShortcutRowProps) {
  const chords = chordsForAction(context.keymap, action);
  const changed = isOverridden(context.overrides, context.running, action);
  const recording = useChordRecording({
    action,
    platform: context.platform,
    onCommit: (next) => writeChords(context, action, next),
  });
  const rivals = rivalsOf(context, action).map((other) => context.labels.get(other) ?? other);
  const listening = recording.listening.value;
  return (
    <RowShell
      itemKey={itemKey}
      active={active}
      changed={changed}
      label={label}
      crumb={crumb}
      control={
        <>
          {listening ? (
            <span role="status" className="text-foreground">
              {recording.hint.value}
            </span>
          ) : chords.length === 0 ? (
            <span className="text-muted-foreground">Unbound</span>
          ) : (
            chords.map((chord) => (
              <ChordCaps
                key={chordCaps(chord, action, context.platform).join("")}
                keys={chordCaps(chord, action, context.platform)}
                label={`${label} shortcut`}
              />
            ))
          )}
          <Button
            variant={listening ? "outline" : "ghost"}
            size="sm"
            disabled={locked}
            aria-label={`${listening ? "Cancel recording" : chords.length === 0 ? "Record" : "Change"} ${label} shortcut`}
            onClick={recording.toggle}
            onBlur={recording.cancel}
          >
            {listening ? "Cancel" : chords.length === 0 ? "Record" : "Change"}
          </Button>
        </>
      }
      reset={
        changed ? (
          <RowReset
            label={`${label} shortcut`}
            to={defaultChordText(context, action)}
            locked={locked}
            onReset={() => writeChords(context, action, null)}
          />
        ) : null
      }
      below={
        rivals.length === 0 ? null : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="flex-1">Also bound to {rivals.join(", ")}</span>
            <Button
              variant="outline"
              size="xs"
              disabled={locked}
              aria-label={`Reassign ${label} shortcut`}
              onClick={() => updateSettings({ keybindings: reassignChords(context, action) })}
            >
              Reassign
            </Button>
          </div>
        )
      }
    />
  );
}
