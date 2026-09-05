import { CaretDown } from "@phosphor-icons/react";
import { useEffect } from "preact/hooks";
import { settings, updateSettings } from "../../../settings/settings-store";
import { ConfigRow } from "../../controls/config-row";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { primaryModifierName } from "../../../lib/shortcut-label";
import { externalApp, isExternalAppId } from "../../../lib/external-app-catalog";
import { externalAppChoices, groupExternalApps } from "../../../links/external-app-choices";
import {
  ensureExternalAppsScanned,
  externalAppsScanned,
  installedExternalApps,
} from "../../../links/external-apps-store";

/** The four group headings, as the picker prints them. */
const GROUP_LABELS: Record<string, string> = {
  editor: "Editors",
  git: "Git clients",
  files: "File browser",
  terminal: "Terminals",
};

/**
 * Where a path goes when no open workspace holds it.
 *
 * This is the same choice the toolbar's caret menu makes and it writes the
 * same one field (design §5), so the chrome and Settings can never disagree —
 * and it is the ONLY picker on Tauri, where the split-button does not exist.
 *
 * A DL-6 `menu` value kind, grouped with `<optgroup>` so the four kinds of app
 * keep the separation the caret menu draws with hairlines. The row deliberately
 * says nothing about files INSIDE an open workspace: those always open in
 * Deck's own editor, with no switch, so offering one here would describe a
 * setting that does not exist.
 */
export function LinksEditorSection() {
  const selected = settings.value.externalAppId;
  const choices = externalAppChoices(installedExternalApps.value, externalAppsScanned.value);
  const groups = groupExternalApps(choices);
  // A stored selection whose app has left the machine still has to be visible,
  // or the row would silently read as the first installed app while the click
  // path falls back to it for a different reason. Named, not hidden.
  const missing =
    choices.some((choice) => choice.id === selected) === false ? externalApp(selected) : null;

  useEffect(() => {
    void ensureExternalAppsScanned();
  }, []);

  return (
    <ConfigRow
      label="Open with"
      desc={`${primaryModifierName()}+click a path outside your open workspaces`}
    >
      <span class="cfg-btn cfg-btn--overlay">
        <span class="cfg-btn__text">
          {choices.find((choice) => choice.id === selected)?.label ?? missing?.label ?? selected}
        </span>
        <span class="cfg-btn__hint">
          <DeckIcon icon={CaretDown} size={ROW_ICON} />
        </span>
        <select
          value={selected}
          aria-label="Open with"
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (isExternalAppId(next)) {
              updateSettings({ externalAppId: next });
            }
          }}
        >
          {groups.map((view) => (
            <optgroup key={view.group} label={GROUP_LABELS[view.group]}>
              {view.items.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ))}
          {missing !== null && (
            <optgroup label="Not installed">
              <option value={missing.id}>{missing.label}</option>
            </optgroup>
          )}
        </select>
      </span>
    </ConfigRow>
  );
}
