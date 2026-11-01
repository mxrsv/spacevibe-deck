import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { SettingScope } from "../../../settings/settings-registry";
import { changedKeys, keysFor } from "../../../settings/settings-changes";
import { settings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow } from "../../controls/config-row";
import { confirmReset, resetPromptOpen } from "../confirm-reset";
import { Button } from "../../controls/button";

export interface ResetRowSpec {
  readonly scope: SettingScope;
  readonly label: string;
  readonly desc: string;
  readonly keeps: string;
}

/** Three independent resets, so none of them wipes more than its row says (FBK-3). */
export const RESET_ROWS: readonly ResetRowSpec[] = [
  {
    scope: "preference",
    label: "Reset preferences",
    desc: "Theme, font, behavior, shortcuts, agent choices",
    keeps: "layout, declared agents and prompt templates",
  },
  {
    scope: "layout",
    label: "Reset layout",
    desc: "Sidebar, dock and rail order",
    keeps: "preferences, declared agents and prompt templates",
  },
  {
    scope: "data",
    label: "Reset agents and templates",
    desc: "Declared agents, launch profiles, models, prompts",
    keeps: "preferences and layout",
  },
];

/**
 * The reset category's rows, each guarded by the native prompt every
 * destructive path uses (red styling is a signifier, not a guard). A row is
 * disabled while nothing in its scope differs from the defaults, and the
 * prompt lists exactly the settings that differ. The custom logo is a
 * separate store and always stays.
 */
export function ResetSection() {
  return (
    <>
      {RESET_ROWS.map((spec) => {
        const keys = changedKeys(settings.value, keysFor(spec.scope));
        return (
          <ConfigRow key={spec.scope} label={spec.label} desc={spec.desc} danger>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              title={
                keys.length === 0 ? "Nothing to reset" : `${spec.label} — asks for confirmation`
              }
              disabled={resetPromptOpen.value || keys.length === 0}
              onClick={() => void confirmReset(keys, spec.label, spec.keeps)}
            >
              <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
              reset
            </Button>
          </ConfigRow>
        );
      })}
    </>
  );
}
