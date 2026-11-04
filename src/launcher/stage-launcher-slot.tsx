import type { ComponentChildren } from "preact";
import "./stage-launcher-slot.css";

interface StageLauncherSlotProps {
  /** The launcher itself: the command bar. */
  readonly children?: ComponentChildren;
  /** Raised over a live space: the panes stay visible, dimmed, behind the bar (LCH-4). */
  readonly floating?: boolean;
}

/** The stage's launcher, shown while the window has no live tab (LCH-1) or raised over one. */
export function StageLauncherSlot({ children, floating = false }: StageLauncherSlotProps) {
  return (
    <section
      class={`stage-launcher${floating ? " stage-launcher--floating" : ""}`}
      data-stage-launcher=""
    >
      {children}
    </section>
  );
}
