/**
 * Rail icons for the usage screen — Phosphor through `DeckIcon` at 16px
 * (`DL-11.3`, `DL-14.1`, `DL-14.2`). Named semantic components so
 * `usage-views.ts` keeps describing views rather than icon libraries:
 * changing which pictogram means "daily" is one edit here.
 *
 * Meaning over decoration (DL-14.5): a dial for a reading, a calendar for
 * days, a grid for the model-by-model table.
 */
import { CalendarDots, Gauge, Table } from "@phosphor-icons/react";

import { DeckIcon, RAIL_ICON } from "../controls/deck-icon";

export function OverviewIcon() {
  return <DeckIcon icon={Gauge} size={RAIL_ICON} />;
}

export function DailyIcon() {
  return <DeckIcon icon={CalendarDots} size={RAIL_ICON} />;
}

export function BreakdownIcon() {
  return <DeckIcon icon={Table} size={RAIL_ICON} />;
}
