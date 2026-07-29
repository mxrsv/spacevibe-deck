import { render } from "preact";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { initSettings } from "./settings/settings-store";
import { initLogo } from "./settings/logo-store";
import { initWorkspaceLogos } from "./settings/workspace-logo-store";
import { initPresets } from "./presets/presets-store";
import { initWorkspaces } from "./open-board/workspaces-store";
import { initializeDesktopEnvironmentFromBackend } from "./lib/platform";
import { App } from "./ui/app";

async function main(): Promise<void> {
  await initializeDesktopEnvironmentFromBackend();
  await initSettings();
  await Promise.all([
    initPresets(),
    initWorkspaces(),
    initLogo(),
    initWorkspaceLogos(),
  ]);
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("#root element not found");
  }
  render(<App />, root);
}

void main();
