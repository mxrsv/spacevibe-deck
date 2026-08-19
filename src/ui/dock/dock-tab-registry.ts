import { ClockCounterClockwise, Gauge, TreeView } from "@phosphor-icons/react";
import type { DeckIconComponent } from "../controls/deck-icon";
import type { ActionId } from "../../terminal/action-registry";
import type { DockTab } from "../../settings/settings-schema";

/**
 * The three surfaces the docked side panel can host. Order of `DOCK_TABS`
 * below is display order everywhere a caller iterates it.
 *
 * An alias, not a second declaration: the union is owned by
 * `settings-schema.ts` because it is a PERSISTED value, and two independent
 * spellings of one storage contract is how they drift apart.
 */
export type DockTabId = DockTab;

export interface DockTabDescriptor {
  readonly id: DockTabId;
  readonly label: string;
  readonly icon: DeckIconComponent;
  /**
   * The action whose chord the chip's tooltip prints (DL-23.1). It is the
   * REGISTRY id, not a literal chord, so a rebind reaches the tooltip and a
   * platform never sees the other one's notation — `shortcutLabel` resolves
   * both. All three tabs have one since 2026-08-19, when `toggle-sessions`
   * was added for exactly this: a tab whose tooltip could print no chord was
   * the odd one out of three otherwise identical chips.
   */
  readonly action: ActionId;
}

/**
 * The panel's fixed tab list, explorer / usage / sessions. Labels are
 * sentence case (DL-4.4, §8); icons are the same ones `deck-toolbar.tsx`
 * already draws for these three features (`TreeView`, `Gauge`,
 * `ClockCounterClockwise`),
 * so a user does not have to learn a second icon for a surface they already
 * recognise from the toolbar.
 *
 * Frozen because this is a fixed set, not app state — nothing ever appends,
 * removes or reorders it at runtime. `availableDockTabs` is how a caller
 * narrows it; this constant itself never changes shape.
 */
export const DOCK_TABS: readonly DockTabDescriptor[] = Object.freeze([
  {
    id: "explorer",
    label: "File explorer",
    icon: TreeView,
    action: "toggle-explorer",
  },
  { id: "usage", label: "Token usage", icon: Gauge, action: "toggle-usage" },
  {
    id: "sessions",
    label: "Session history",
    icon: ClockCounterClockwise,
    action: "toggle-sessions",
  },
]);

/**
 * Drops the sessions tab entirely when the host cannot answer
 * `sessions_list`. `deck-toolbar.tsx`'s own `toggle-sessions` control follows
 * the same precedent: a control that opens an empty surface is worse than no
 * control, so the tab is omitted rather than shown disabled.
 */
export function availableDockTabs(sessionsAvailable: boolean): readonly DockTabDescriptor[] {
  if (sessionsAvailable) {
    return DOCK_TABS;
  }
  return DOCK_TABS.filter((tab) => tab.id !== "sessions");
}

/**
 * Falls back to `"explorer"` when `requested` is not in the available set —
 * most often a persisted `"sessions"` selection on a host with no
 * `sessions_list`. Explorer is the panel's original, always-available
 * surface, so it is the one safe default to resolve to.
 */
export function resolveDockTab(requested: DockTabId, sessionsAvailable: boolean): DockTabId {
  const available = availableDockTabs(sessionsAvailable);
  return available.some((tab) => tab.id === requested) ? requested : "explorer";
}
