import { signal } from "@preact/signals";
import { getVersion } from "../host/shell-host";

/**
 * The version Deck is running, read from the bundle itself.
 *
 * Not taken from the updater's view: that only learns a version once a check
 * finds an update, and reports the empty string until then — so a surface that
 * wants to state which build this is cannot ask the updater.
 *
 * Empty until `loadAppVersion` resolves, and empty forever in a context with
 * no Tauri host (tests, the web-only dev preview).
 */
export const appVersion = signal("");

/** Fills `appVersion` once, at startup. Safe to call again; it will not refetch. */
export async function loadAppVersion(): Promise<void> {
  if (appVersion.value !== "") {
    return;
  }
  try {
    appVersion.value = await getVersion();
  } catch {
    // A blank version costs one description line. Nothing else reads this, so
    // there is nothing to fail loudly for.
  }
}
