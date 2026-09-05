/**
 * Which external apps this machine actually has, cached per window (R5).
 *
 * The scan is a handful of `stat` calls plus one AppKit icon read per hit, so
 * it is cheap — but it is asked for by three surfaces (the split-button, its
 * menu, and Settings -> Links & editor) and by the ⌘+click path itself, which
 * has to know whether the SELECTED app is still installed before handing it
 * a file. One store, one answer.
 *
 * Empty is the honest answer on Tauri and in a browser `npm run dev` preview:
 * `external_apps` is Electron-only, the facade fails soft, and every consumer
 * reads an empty list as "this host cannot reach other apps" — the button is
 * not rendered, and Settings falls back to printing the catalog.
 */
import { signal } from "@preact/signals";
import { listExternalApps, type InstalledExternalApp } from "../host/external-apps-host";
import type { ExternalAppId } from "../lib/external-app-catalog";

export const installedExternalApps = signal<readonly InstalledExternalApp[]>([]);

/** True once a scan has answered — an empty list before and after look the
 * same, and the menu must not say "nothing installed" before it has asked. */
export const externalAppsScanned = signal(false);

let inFlight: Promise<void> | null = null;

async function scan(): Promise<void> {
  const found = await listExternalApps();
  installedExternalApps.value = found;
  externalAppsScanned.value = true;
}

/**
 * Scan once per window. Concurrent callers share the one request — the
 * toolbar, its menu and Settings can all mount in the same frame.
 */
export function ensureExternalAppsScanned(): Promise<void> {
  if (externalAppsScanned.value) {
    return Promise.resolve();
  }
  inFlight ??= scan().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Re-scan now. Installing an app while Deck is running is the ordinary case —
 * the menu is where the user finds out it is missing, so opening the menu is
 * where the second look belongs.
 */
export function refreshExternalApps(): Promise<void> {
  inFlight ??= scan().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Installed ids in catalog order — what `resolveExternalApp` walks. */
export function installedExternalAppIds(): readonly ExternalAppId[] {
  return installedExternalApps.value.map((app) => app.id);
}
