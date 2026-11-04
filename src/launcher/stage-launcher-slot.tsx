import type { ComponentChildren } from "preact";
import "./stage-launcher-slot.css";

interface StageLauncherSlotProps {
  /** The launcher itself; a later stage mounts the command bar here. */
  readonly children?: ComponentChildren;
}

/** The stage's launcher, shown while the window has no live tab (LCH-1). */
export function StageLauncherSlot({ children }: StageLauncherSlotProps) {
  return (
    <section class="stage-launcher" data-stage-launcher="">
      {children}
    </section>
  );
}
