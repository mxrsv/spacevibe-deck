/**
 * What a picker of external apps offers, and in what order — shared by the
 * toolbar's caret menu and Settings -> Links & editor, because both write the
 * SAME field (design §5): a chrome menu that disagreed with Settings would be
 * two answers to one question.
 *
 * Pure: the store hands it what the host reported, and it decides what to
 * print. That split is what lets Settings stay usable on Tauri, where nothing
 * ever reports anything.
 */
import {
  EXTERNAL_APPS,
  EXTERNAL_APP_GROUP_ORDER,
  type ExternalAppGroup,
  type ExternalAppId,
} from "../lib/external-app-catalog";
import type { InstalledExternalApp } from "../host/external-apps-host";

export interface ExternalAppChoice {
  readonly id: ExternalAppId;
  readonly label: string;
  readonly group: ExternalAppGroup;
  /** The installed version's own icon, or null — an authored asset never
   * stands in for one, so a missing icon means the label carries the row. */
  readonly iconDataUrl: string | null;
}

export interface ExternalAppGroupView {
  readonly group: ExternalAppGroup;
  readonly items: readonly ExternalAppChoice[];
}

/**
 * The rows a picker shows.
 *
 * An installed list is the answer wherever the host can give one: an app that
 * is not installed is ABSENT, not disabled, so "can Deck reach X" is answered
 * by looking. Where no host answered at all — Tauri, a browser preview — the
 * catalog stands in, because a Settings screen offering nothing would leave a
 * migrated `custom` editor with no way back to a working selection.
 */
export function externalAppChoices(
  installed: readonly InstalledExternalApp[],
  hostAnswered: boolean,
): readonly ExternalAppChoice[] {
  if (hostAnswered && installed.length > 0) {
    return installed.map((app) => ({
      id: app.id,
      label: app.label,
      group: app.group,
      iconDataUrl: app.iconDataUrl,
    }));
  }
  return EXTERNAL_APPS.map((app) => ({
    id: app.id,
    label: app.label,
    group: app.group,
    iconDataUrl: null,
  }));
}

/** The same rows, in groups, hairline-separated in menu order (DL-23.5). */
export function groupExternalApps(
  choices: readonly ExternalAppChoice[],
): readonly ExternalAppGroupView[] {
  return EXTERNAL_APP_GROUP_ORDER.map((group) => ({
    group,
    items: choices.filter((choice) => choice.group === group),
  })).filter((view) => view.items.length > 0);
}
