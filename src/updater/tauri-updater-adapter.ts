import { relaunch as relaunchElectron } from '../host/shell-host';
import type { PendingUpdate } from './update-controller';

function isTauriHost(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
  );
}

export async function checkForUpdate(): Promise<PendingUpdate | null> {
  // Reached only through `electron-updater-adapter.ts`, and only under Tauri.
  // Tauri is still the shipping host and owes one more release — the migration
  // notice — so its signed Minisign updater path stays live until cutover. The
  // guard is kept anyway: this file is the one place that must never run a
  // Tauri import on a host without Tauri.
  if (!isTauriHost()) {
    return null;
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (update === null) {
    return null;
  }
  return Object.freeze({
    currentVersion: update.currentVersion,
    version: update.version,
    notes: update.body ?? null,
    download: () => update.download(),
    install: () => update.install(),
  });
}

export async function relaunchDeck(): Promise<void> {
  if (isTauriHost()) {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    return relaunch();
  }
  return relaunchElectron();
}
