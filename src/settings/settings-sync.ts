import { invoke, listen, type UnlistenFn } from "../host/bridge";
import { DEFAULT_SETTINGS, type Settings } from "./settings-schema";

const MERGED_EVENT = "settings:merged";

/**
 * Cross-window settings sync (spec §9.5).
 *
 * `onKeyChange` was considered and rejected: it announces that a write
 * happened but does not stop two windows' read-modify-write cycles from
 * clobbering each other. A patch merged under a Rust lock does.
 *
 * Command and event names are FROZEN (merge reconciliation 2026-08-10):
 * `apply_settings_patch` and `settings:merged`, both owned by the
 * window-lifecycle section.
 */
export interface SettingsSyncClient {
  /**
   * Resolves with the MERGED settings Rust produced.
   *
   * Typed faithfully because the Rust command really returns it, but callers
   * in this repo deliberately do NOT apply it: `settings:merged` is the one
   * authoritative path to state (see `updateSettings`). The resolved value is
   * here so a future caller that genuinely needs a causally-ordered read has
   * it, and so the type does not lie about the command.
   */
  sendPatch(patch: Partial<Settings>): Promise<unknown>;
  listenMerged(handler: (merged: unknown) => void): Promise<UnlistenFn>;
}

export function createTauriSettingsSync(): SettingsSyncClient {
  return {
    sendPatch(patch) {
      return invoke<unknown>("apply_settings_patch", { patch });
    },
    listenMerged(handler) {
      return listen<unknown>(MERGED_EVENT, (event) => handler(event.payload));
    },
  };
}

export function createMemorySettingsSync(): SettingsSyncClient & {
  readonly patches: Partial<Settings>[];
  broadcast(merged: unknown): void;
} {
  const patches: Partial<Settings>[] = [];
  const handlers = new Set<(merged: unknown) => void>();
  // Stands in for Rust's authoritative copy; seeded from the defaults so a
  // reply always validates.
  let merged: Settings = DEFAULT_SETTINGS;
  return {
    patches,
    broadcast(next) {
      for (const handler of handlers) {
        handler(next);
      }
    },
    async sendPatch(patch) {
      patches.push(patch);
      // Mirrors the real command: the merge happens in Rust and the merged
      // object comes back. Production ignores this value — `settings:merged`
      // is authoritative — but the fake must still return it, or a future
      // caller that DOES read it would be written against a fake that never
      // produced one.
      merged = { ...merged, ...patch };
      return merged;
    },
    async listenMerged(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
