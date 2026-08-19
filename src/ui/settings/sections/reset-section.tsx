import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { ask } from "../../../host/dialog-host";
import { resetSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow } from "../../controls/config-row";
import { reportPersistError } from "../../../chrome/events";

/**
 * The "Restore defaults" row, with the async confirm guard it was written
 * with (moved verbatim out of the settings drawer this screen replaced).
 *
 * It is the `reset` category's whole section since 2026-08-19 (owner,
 * DL-11.5 amended), reached from the rail like every other stop. It rendered
 * in `settings-nav.tsx`'s pinned foot before that — kept out of the navigable
 * list because it is destructive — and the row is unchanged by the move: what
 * makes it safe was always the native prompt below, never the slot it sat in.
 */
export function ResetSection() {
  // Same guard for the Restore-defaults confirm — one prompt per click.
  const resetting = useSignal(false);

  /**
   * Restore defaults drops theme, font family and size, every color override,
   * the editor, tab bar position, pane bar and scrollback in one click, with
   * no undo. Red styling is a signifier, not a guard — so this goes through
   * the same native prompt every other destructive path uses (close tab,
   * quit). Dialog failure is fail-safe: reset nothing, say so.
   *
   * Templates and declared agents live in the same settings object, so this
   * wipes them too — it always did for agents; the sentence now says so.
   * Preserving data through a reset is a separate task (spec §4).
   */
  const handleReset = async (): Promise<void> => {
    if (resetting.value) {
      return;
    }
    resetting.value = true;
    try {
      const confirmed = await ask(
        "Theme, font, colors, behavior, declared agents and prompt templates all go back to their defaults. This can't be undone.",
        {
          title: "Restore Defaults",
          kind: "warning",
          okLabel: "Restore",
          cancelLabel: "Cancel",
        },
      );
      if (confirmed) {
        resetSettings();
      }
    } catch {
      reportPersistError("Couldn't confirm the reset — nothing was changed.");
    } finally {
      resetting.value = false;
    }
  };

  return (
    <ConfigRow
      label="Restore defaults"
      desc="Theme, font, colors, behavior, agents, prompts"
      danger
    >
      <button
        type="button"
        class="cfg-btn cfg-btn--danger"
        title="Restore defaults — asks for confirmation"
        disabled={resetting.value}
        onClick={() => void handleReset()}
      >
        <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
        reset
      </button>
    </ConfigRow>
  );
}
