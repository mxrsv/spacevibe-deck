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
import { surfaceFor } from "../../files/file-surface-store";
import {
  dockSheetOpen,
  dockSurface,
  dockView,
  selectDockExplorer,
  selectDockFile,
  setDockView,
  VIEW_OF_TAB,
} from "./agent-dock-state";
import { dockRoot } from "./dock-root";

/** Select what a legacy tab names: the Explorer tab for the explorer, a fixed view otherwise. */
export function selectDockSurfaceOf(tab: DockTab): void {
  if (tab === "explorer") {
    selectDockExplorer();
  } else {
    setDockView(VIEW_OF_TAB[tab]);
  }
}

/** Whether the surface of `tab` is the one on the body (the explorer owns files and the + tab). */
function onSurfaceOf(tab: DockTab): boolean {
  return tab === "explorer"
    ? dockSurface.value === "explorer"
    : dockSurface.value === "view" && dockView.value === VIEW_OF_TAB[tab];
}

/** Open the dock on a surface and never close it; its view is selected even when the tab is unchanged. */
export function openDockTab(tab: DockTab): void {
  openTab(tab);
  if (agentDockEnabled()) {
    selectDockSurfaceOf(tab);
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
  if (settings.value.dockOpen && onSurfaceOf(tab)) {
    // A second explorer press leaves the Explorer tab for the document beside it, if one is open;
    // only without one does it put the dock away.
    if (tab === "explorer" && surfaceFor(dockRoot.value).activePath !== null) {
      selectDockFile();
      return false;
    }
    // `dockTab` can lag the icon press, so close directly rather than through the tab compare.
    updateSettings({ dockOpen: false, dockTab: tab });
    return true;
  }
  // Not on screen: open on it. `revealTab` would hide a dock whose stored tab already matches.
  updateSettings({ dockOpen: true, dockTab: tab });
  selectDockSurfaceOf(tab);
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
  // Files and the Explorer tab are both the explorer: it is on screen while either holds the body.
  const shown =
    tab === "explorer"
      ? dockSurface.value !== "view"
      : dockSurface.value === "view" && dockView.value === VIEW_OF_TAB[tab];
  return shown && (!dockNarrow.value || dockSheetOpen.value);
}
