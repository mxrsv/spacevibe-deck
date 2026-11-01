/**
 * How the dock chords (⌘⇧B, ⌘⇧U, the sessions chord) and the rail's Tools rows reach a surface
 * of the stacked dock. The tabbed dock showed one tab at a time and the setting `dockTab` said
 * which; the stacked dock shows every unfolded section, so "is it on screen" is the section's
 * fold, the dock's presence and, in a narrow window, the sheet.
 *
 * Same names and signatures as the settings-store functions they wrap, which they call first, so
 * `App` swaps an import and nothing else. With the switch off they are those functions.
 */
import {
  openDockTab as openTab,
  revealDockTab as revealTab,
  settings,
  updateSettings,
} from "../../settings/settings-store";
import type { DockTab } from "../../settings/settings-schema";
import { agentDockEnabled, dockNarrow } from "./agent-dock-layout";
import {
  dockSectionsOpen,
  dockSheetOpen,
  SECTION_OF_TAB,
  setDockSectionOpen,
} from "./agent-dock-state";

/** Open the dock on a surface and never close it; its section unfolds even when the tab is unchanged. */
export function openDockTab(tab: DockTab): void {
  openTab(tab);
  if (agentDockEnabled()) {
    setDockSectionOpen(SECTION_OF_TAB[tab], true);
  }
}

/**
 * Reveal a surface; true when the press closed the dock. A chord for a folded section unfolds it
 * rather than hiding the whole dock (the setting alone cannot tell the tab is already current but
 * folded), and a closed dock opens with the section unfolded; a chord for a section on screen puts
 * the dock away, as the tabbed dock does.
 */
export function revealDockTab(tab: DockTab): boolean {
  if (!agentDockEnabled()) {
    return revealTab(tab);
  }
  const section = SECTION_OF_TAB[tab];
  if (settings.value.dockOpen && !dockSectionsOpen.value[section]) {
    updateSettings({ dockTab: tab });
    setDockSectionOpen(section, true);
    return false;
  }
  const closing = revealTab(tab);
  if (!closing) {
    // A dock the chord just opened shows the surface, whatever the folds were.
    setDockSectionOpen(section, true);
  }
  return closing;
}

/**
 * Whether the dock shows the surface of `tab` right now, given that it is open and `activeTab`
 * is the tabbed dock's current one. Stacked: its section is unfolded and, under 1360px, the sheet
 * holding it is open. Telemetry's visibility counters and the file surface's focus guard ask it.
 */
export function dockShows(tab: DockTab, activeTab: DockTab): boolean {
  if (!agentDockEnabled()) {
    return activeTab === tab;
  }
  return dockSectionsOpen.value[SECTION_OF_TAB[tab]] && (!dockNarrow.value || dockSheetOpen.value);
}
