import { useEffect } from "preact/hooks";
import { DEFAULT_SETTINGS, type DockTab } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { dockSurface } from "./agent-dock-state";
import { selectDockSurfaceOf } from "./dock-reveal";

/** The tab the last dock mount or change settled on; module-level so a closed dock remembers it. */
let settledTab: DockTab = DEFAULT_SETTINGS.dockTab;

/**
 * The old dock chords (⌘⇧B, ⌘⇧U, the sessions chord, the rail's Tools rows) still write
 * `dockTab`. A change of that setting selects the view it names. Merely reopening the dock leaves
 * the view as the user left it.
 */
export function useRevealDockTab(): void {
  const tab = settings.value.dockTab;
  useEffect(() => {
    if (tab !== settledTab) {
      // Opening a file writes `dockTab: "explorer"` too (the file controller's hook), after it
      // has already put the file tab on the body; the Explorer tab must not take it back.
      if (tab !== "explorer" || dockSurface.value === "view") {
        selectDockSurfaceOf(tab);
      }
    }
    settledTab = tab;
  }, [tab]);
}

export function resetRevealDockTabForTests(): void {
  settledTab = DEFAULT_SETTINGS.dockTab;
}
