import type { Settings } from "../settings/settings-schema";

export type TerminalPaneKind = "xterm" | "alacritty";

export function paneUsesBackgroundImage(
  settings: Settings,
  kind: TerminalPaneKind,
): boolean {
  const background = settings.terminalBackground;
  return (
    background.imageDataUrl !== "" &&
    (background.target === "all" || background.target === kind)
  );
}
export function applyPaneBackground(
  element: HTMLElement,
  settings: Settings,
  kind: TerminalPaneKind,
): void {
  const background = settings.terminalBackground;
  const enabled = paneUsesBackgroundImage(settings, kind);
  element.classList.toggle("pane--has-background", enabled);
  if (!enabled) {
    element.style.removeProperty("--pane-background-image");
    element.style.removeProperty("--pane-background-size");
    element.style.removeProperty("--pane-background-dim");
    return;
  }
  element.style.setProperty(
    "--pane-background-image",
    `url(${JSON.stringify(background.imageDataUrl)})`,
  );
  element.style.setProperty(
    "--pane-background-size",
    background.fit === "stretch" ? "100% 100%" : background.fit,
  );
  element.style.setProperty("--pane-background-dim", String(background.dim));
}
