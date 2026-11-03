import { useEffect } from "preact/hooks";
import { DEFAULT_SETTINGS, type DockTab } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { setDockView, VIEW_OF_TAB } from "./agent-dock-state";

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
      setDockView(VIEW_OF_TAB[tab]);
    }
    settledTab = tab;
  }, [tab]);
}

export function resetRevealDockTabForTests(): void {
  settledTab = DEFAULT_SETTINGS.dockTab;
}
