import { effect } from "@preact/signals";
import { getCurrentWindow } from "../host/window-host";
import { effectiveGuiZoom, GUI_ZOOM_PROPERTY } from "./gui-zoom";
import { settings } from "./settings-store";

/**
 * Applies the setting to this window now and on every change: the CSS property
 * the frame geometry divides by, and the host's page zoom. Every window runs
 * it, so a change in one reaches the others through the settings broadcast.
 * Returns the stop function.
 */
export function bindGuiZoom(root: HTMLElement = document.documentElement): () => void {
  return effect(() => {
    const zoom = effectiveGuiZoom(settings.value);
    root.style.setProperty(GUI_ZOOM_PROPERTY, String(zoom));
    void getCurrentWindow().setGuiZoom(zoom);
  });
}
