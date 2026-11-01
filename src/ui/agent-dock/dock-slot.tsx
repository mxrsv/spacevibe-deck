import type { ComponentChildren } from "preact";
import { agentDockEnabled } from "./agent-dock-layout";

interface DockSlotProps {
  /** The tabbed column every packaged build ships. */
  readonly legacy: ComponentChildren;
  /** The stacked-section dock, shown in development builds behind the `agentDock` switch. */
  readonly stacked: ComponentChildren;
}

/**
 * The one mount `app.tsx` has for the dock column. The switch is read when this renders, never
 * into a constant, so a packaged build keeps the column it shipped with. The settings, chords and
 * toggle controls that open and close the dock are the same for both: only the column differs.
 */
export function DockSlot({ legacy, stacked }: DockSlotProps) {
  return <>{agentDockEnabled() ? stacked : legacy}</>;
}
