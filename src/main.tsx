import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./ui/preset-entry.css";
import { initSettings, listenStoreWriteFailures } from "./settings/settings-store";
import { loadCustomThemes } from "./settings/custom-themes-store";
import { initLogo } from "./settings/logo-store";
import { initPresets } from "./presets/presets-store";
import { initWorkspaces } from "./open-board/workspaces-store";
import { initRepositories } from "./repositories/repositories-store";
import { initializeDesktopEnvironmentFromBackend } from "./lib/platform";
import { App } from "./ui/app";
import { defaultTransferClient } from "./terminal/transfer-client";
import { initRendererCrashReporting } from "./telemetry/crash-reporting";

async function main(): Promise<void> {
  // First, so a failure anywhere in the boot below is reported. Losing the
  // SDK must never cost the user a window, so a load failure only warns.
  await initRendererCrashReporting().catch((error: unknown) => {
    console.warn("Deck: crash reporting is unavailable", error);
  });
  await initializeDesktopEnvironmentFromBackend();
  // Read before anything renders (spec §9.2): deciding inside App's mount
  // effect would paint the Open board for one frame in a window whose whole
  // job is to show an adopted pane.
  const boot = await defaultTransferClient.windowBootMode();
  await initSettings();
  // A failed background write is otherwise completely silent.
  await listenStoreWriteFailures();
  await Promise.all([
    initPresets(),
    initWorkspaces(),
    initRepositories(),
    initLogo(),
    // The themes folder has to be scanned at boot, not when Settings first
    // opens: `themeId` persists a `file:` id across launches, and until the
    // scan lands `getTheme` can only answer with the built-in fallback.
    //
    // Awaited here with the rest of boot, BEFORE `render()`, on purpose:
    // letting it finish after first paint would flash the fallback theme on
    // every launch for anyone running an imported one. `listThemes` reads the
    // folder's files concurrently so this stays one round trip's worth of
    // latency rather than one per file.
    loadCustomThemes(),
  ]);
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("#root element not found");
  }
  render(<App boot={boot} />, root);
}

void main();
