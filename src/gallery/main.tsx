// MUST stay the first import: this module installs both host hooks as a side
// effect, and ES imports evaluate in order, so anything below it already sees
// them. See the comment at the foot of `host-stub.ts`.
import "./host-stub";
import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "../styles.css";
import "./gallery.css";
import { initializeDesktopEnvironmentFromBackend } from "../lib/platform";
import { configureSettingsSync } from "../settings/settings-store";
import { createMemorySettingsSync } from "../settings/settings-sync";
import { activeTabIndex, statusInfo, tabViews } from "../terminal/tabs-store";
import { presetsData } from "../presets/presets-store";
import { SEED_PRESETS, SEED_STATUS, SEED_TABS } from "./seed-data";
import { Gallery } from "./gallery";

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

  tabViews.value = SEED_TABS;
  activeTabIndex.value = 0;
  statusInfo.value = SEED_STATUS;
  presetsData.value = { version: 1, presets: SEED_PRESETS };

  const root = document.getElementById("root");
  if (root === null) {
    throw new Error("#root element not found");
  }
  render(<Gallery />, root);
}

main();
