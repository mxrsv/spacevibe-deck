/**
 * How the dock chords (⌘⇧B, ⌘⇧U, the sessions chord) and the rail's Tools rows reach a surface
 * of the tabbed dock. The legacy dock showed one tab and the setting `dockTab` said which; here
 * the signal `dockView` does, so "is it on screen" is the selected view, the dock's presence and,
 * in a narrow window, the sheet.
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
import { dockSheetOpen, dockView, setDockView, VIEW_OF_TAB } from "./agent-dock-state";

/** Open the dock on a surface and never close it; its view is selected even when the tab is unchanged. */
export function openDockTab(tab: DockTab): void {
  openTab(tab);
  if (agentDockEnabled()) {
    setDockView(VIEW_OF_TAB[tab]);
  }
}

/**
 * Reveal a surface; true when the press closed the dock. A chord for a view that is not on screen
 * selects it rather than hiding the dock (the setting alone cannot tell the tab is already current
 * while another view shows), and a closed dock opens on the view; a chord for the view on screen
 * puts the dock away, as the tabbed dock does.
 */
export function revealDockTab(tab: DockTab): boolean {
  if (!agentDockEnabled()) {
    return revealTab(tab);
  }
  const view = VIEW_OF_TAB[tab];
  if (settings.value.dockOpen && dockView.value === view) {
    // `dockTab` can lag the icon press, so close directly rather than through the tab compare.
    updateSettings({ dockOpen: false, dockTab: tab });
    return true;
  }
  // Not on screen: open on it. `revealTab` would hide a dock whose stored tab already matches.
  updateSettings({ dockOpen: true, dockTab: tab });
  setDockView(view);
  return false;
}

/**
 * Whether the dock shows the surface of `tab` right now, given that it is open and `activeTab`
 * is the tabbed dock's current one. Tabbed: its view is selected and, under 1360px, the sheet
 * holding it is open. Telemetry's visibility counters and the file surface's focus guard ask it.
 */
export function dockShows(tab: DockTab, activeTab: DockTab): boolean {
  if (!agentDockEnabled()) {
    return activeTab === tab;
  }
  return dockView.value === VIEW_OF_TAB[tab] && (!dockNarrow.value || dockSheetOpen.value);
}
