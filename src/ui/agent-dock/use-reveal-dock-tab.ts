import { useEffect } from "preact/hooks";
import { DEFAULT_SETTINGS, type DockTab } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { SECTION_OF_TAB, setDockSectionOpen } from "./agent-dock-state";

/** The tab the last dock mount or change settled on; module-level so a closed dock remembers it. */
let settledTab: DockTab = DEFAULT_SETTINGS.dockTab;

/**
 * The old dock chords (⌘⇧B, ⌘⇧U, the sessions chord, the rail's Tools rows) still write
 * `dockTab`. With every section on one scroll there is no tab to switch, so a change of that
 * setting unfolds the section it names. Merely reopening the dock leaves the folds as the user
 * left them.
 */
export function useRevealDockTab(): void {
  const tab = settings.value.dockTab;
  useEffect(() => {
    if (tab !== settledTab) {
      setDockSectionOpen(SECTION_OF_TAB[tab], true);
    }
    settledTab = tab;
  }, [tab]);
}

export function resetRevealDockTabForTests(): void {
  settledTab = DEFAULT_SETTINGS.dockTab;
}
