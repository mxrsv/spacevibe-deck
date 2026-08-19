// MUST stay the first import: this module installs both host hooks as a side
// effect, and ES imports evaluate in order, so anything below it already sees
// them. See the comment at the foot of `host-stub.ts`.
import "./host-stub";
import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "../styles.css";
import "./gallery.css";
import "./chatgpt-direction.css";
import "./agent-status-rail.css";
import "./agent-rail-variants.css";
import "./rail-structure-variants.css";
import "./sections/settings-direction.css";
import "./sections/launch-profiles-section.css";
import { initializeDesktopEnvironmentFromBackend } from "../lib/platform";
import {
  configureSettingsSync,
  settingsLoadState,
} from "../settings/settings-store";
import { createMemorySettingsSync } from "../settings/settings-sync";
import { LOAD_READY } from "../lib/load-state";
import { activeTabIndex, statusInfo, tabViews } from "../terminal/tabs-store";
import {
  activateTerminalSurface,
  openFileTab,
} from "../files/file-surface-store";
import { nextOpenSequence } from "../lib/open-sequence";
import { presetsData } from "../presets/presets-store";
import { sessionArchive } from "../terminal/session-journal";
import { paneTails } from "../terminal/session-tail-store";
import {
  SEED_PANE_TAILS,
  SEED_PRESETS,
  SEED_SESSION_ARCHIVE,
  SEED_STATUS,
  SEED_TABS,
  SEED_WORKSPACE_HISTORY,
} from "./seed-data";
import { Gallery } from "./gallery";
import { workspacesData } from "../open-board/workspaces-store";
import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import {
  DEFAULT_SIDEBAR_BANNER,
  sidebarBanner,
} from "../settings/sidebar-banner-store";

/**
 * Gallery entry. It deliberately does NOT run the app's boot sequence:
 * `initSettings` and `initWorkspaces` exist to read the user's real store
 * files, and a design harness has no business touching those. Signals are
 * seeded in memory instead — same signals the app renders from, different
 * source.
 */
function main(): void {
  // A stubbed environment rather than the IPC command, because the seam is
  // already injectable and using it keeps one fewer thing behind the stub.
  void initializeDesktopEnvironmentFromBackend(async () => ({
    platform: "macos",
    homeDir: SEED_STATUS.home,
  }));

  // In-memory sync so a settings change in a specimen stays local. Without it
  // `updateSettings` would try to broadcast a patch through Rust.
  configureSettingsSync(createMemorySettingsSync());
  settingsLoadState.value = LOAD_READY;

  // The strip is one row of mixed chips in open order since 2026-08-16
  // (DL-18.6), so the gallery seeds it that way: a document opened before the
  // terminal tabs and one opened after them, which is the only arrangement
  // that shows the interleave rather than implying the retired segments.
  const seedWorkspace = `${SEED_STATUS.home}/spacevibe-deck`;
  openFileTab(seedWorkspace, `${seedWorkspace}/README.md`, { keep: true });
  tabViews.value = SEED_TABS.map((tab) => ({
    ...tab,
    openedAt: nextOpenSequence(),
  }));
  openFileTab(seedWorkspace, `${seedWorkspace}/src/styles.css`, {
    keep: false,
  });
  // `openFileTab` hands the stage to the file it opened; the gallery's resting
  // state is a terminal tab holding it — the strip still lists both files, and
  // the agent rail can show its selection wash, which a covering file surface
  // rightly suppresses.
  activateTerminalSurface();
  activeTabIndex.value = 0;
  statusInfo.value = SEED_STATUS;
  presetsData.value = { version: 1, presets: SEED_PRESETS };
  sessionArchive.value = SEED_SESSION_ARCHIVE;
  // The rail reads `session_tail` in the app; in a browser there is no session
  // log to read, so the store is seeded directly — without it every rail
  // specimen shows the never-spoken fallback and none of DL-27.15.
  paneTails.value = SEED_PANE_TAILS;
  sidebarBanner.value = { ...DEFAULT_SIDEBAR_BANNER, enabled: true };
  const seededAt = Date.now();
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: SEED_WORKSPACE_HISTORY.map((path, index) => ({
      path,
      lastOpenedAt: seededAt - index,
    })),
  };

  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("#root element not found");
  }
  render(<Gallery />, root);
}

main();
