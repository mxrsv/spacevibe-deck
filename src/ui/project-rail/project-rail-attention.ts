/**
 * Which rows ask for the user, for the rail's "N need you" pill (LAY-3). Pure, over the
 * unpartitioned list: a row in a hidden project, an archived row and a row in a folded project
 * all count, because the pill exists to say where to look when the list does not.
 */
import type { AgentRailView } from "../agent-rail-model";
import { railItems, type RailItem, type RailStatus } from "../rail-view-model";
import { isRailItemFocused } from "./project-rail-model";

/**
 * The statuses of the "Needs you" bucket (By status grouping): a question, a permission wait
 * or a warning, and a failure. `unread` is a finished run nobody has looked at: it waits, it
 * does not ask.
 */
const WANTS_USER: ReadonlySet<RailStatus> = new Set(["needs-input", "failed"]);

export function wantsUser(item: Pick<RailItem, "status">): boolean {
  return WANTS_USER.has(item.status);
}

/** Every row that asks for the user, in the rail's order: project, checkout, then entry. */
export function needsYouItems(view: AgentRailView): readonly RailItem[] {
  return railItems(view).filter(wantsUser);
}

/**
 * The row the pill sends the user to: the first asking row after the one holding the keyboard,
 * wrapping at the end. With the keyboard on no row it starts from the top. The same predicate
 * as the count, so a press never lands on a row the pill did not count.
 */
export function nextNeedsYou(view: AgentRailView): RailItem | null {
  const items = railItems(view);
  const at = items.findIndex(isRailItemFocused);
  for (let step = 1; step <= items.length; step += 1) {
    const item = items[(at + step) % items.length];
    if (item !== undefined && wantsUser(item)) {
      return item;
    }
  }
  return null;
}
