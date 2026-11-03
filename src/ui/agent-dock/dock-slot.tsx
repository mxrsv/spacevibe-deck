import type { ComponentChildren } from "preact";
import { agentDockEnabled } from "./agent-dock-layout";

interface DockSlotProps {
  /** The legacy column every packaged build ships. */
  readonly legacy: ComponentChildren;
  /** The agent dock (one strip, one body), shown in development builds behind `agentDock`. */
  readonly agent: ComponentChildren;
}

/**
 * The one mount `app.tsx` has for the dock column. The switch is read when this renders, never
 * into a constant, so a packaged build keeps the column it shipped with. The settings, chords and
 * toggle controls that open and close the dock are the same for both: only the column differs.
 */
export function DockSlot({ legacy, agent }: DockSlotProps) {
  return <>{agentDockEnabled() ? agent : legacy}</>;
}
