import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { initSettings, listenStoreWriteFailures } from "./settings/settings-store";
import { initLogo } from "./settings/logo-store";
import { initWorkspaceLogos } from "./settings/workspace-logo-store";
import { initPresets } from "./presets/presets-store";
import { initWorkspaces } from "./open-board/workspaces-store";
import { initRepositories } from "./repositories/repositories-store";
import { initializeDesktopEnvironmentFromBackend } from "./lib/platform";
import { App } from "./ui/app";
import { defaultTransferClient } from "./terminal/transfer-client";

async function main(): Promise<void> {
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
    initWorkspaceLogos(),
  ]);
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("#root element not found");
  }
  render(<App boot={boot} />, root);
}

void main();
