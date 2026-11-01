import type {
  AttentionIssue,
  CommandAreaId,
  CommandHit,
  CommandItem,
} from "../../settings/command-hits";
import { settingsTarget } from "../settings/settings-focus-store";
import { isLiveHit } from "./command-settings-live";
import { commandActiveKey, commandScope, revealInCommand } from "./command-settings-state";

/*
 * What a press on a stand-in row or a chip does. The legacy sections and pieces
 * mounted inside an area paint a deep-linked row from `settingsTarget`
 * (`ConfigRow` scrolls to it and marks it), so the target is written here and
 * cleared whenever the user moves: a stale target would repaint when the area
 * is entered again.
 */

/** A stand-in row of the home list or of results: open its area. */
export function openHit(hit: CommandHit): void {
  revealInCommand(hit.area);
  settingsTarget.value = hit.kind === "setting" ? hit.key : null;
}

/**
 * An attention row: open its area, on the row that resolves it. A shortcut conflict names the
 * first action in it (the user's newest choice, which fires); a reported issue names its row.
 * A row the list does not show leaves the first row.
 */
export function openIssue(issue: AttentionIssue): void {
  revealInCommand(
    issue.area,
    issue.kind === "shortcut-conflict" ? `shortcut:${issue.actions[0]}` : (issue.row ?? null),
  );
  settingsTarget.value = null;
}

/**
 * Enter on the highlighted row. A live row has nothing to open: its control is
 * right there, and Enter only moves focus into it (`command-settings-keys.ts`).
 * Heads, pieces, sections and the empty line have nothing to open either.
 */
export function openItem(item: CommandItem): void {
  if (item.type === "hit" && !isLiveHit(item.hit)) {
    openHit(item.hit);
  } else if (item.type === "attention") {
    openIssue(item.issue);
  }
}

/** An area chip: the typed text stays, so the field filters inside the area. */
export function chooseArea(area: CommandAreaId | null): void {
  settingsTarget.value = null;
  commandScope.value = area;
  commandActiveKey.value = null;
}
