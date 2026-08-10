import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_USAGE_SNAPSHOT,
  type UsageSnapshot,
} from "../lib/usage-snapshot";

/** Scanner seam — real IPC in production, fakes in tests. */
export interface UsageClient {
  /**
   * Rejects **only** when the Rust blocking worker panicked (plan §0.3
   * decision 5). Missing directories, unreadable files and malformed lines
   * all arrive in-band through `sources[].state` and `skippedLines`, so the
   * store's failure path has exactly one trigger.
   */
  snapshot(): Promise<UsageSnapshot>;
}

export function createTauriUsageClient(): UsageClient {
  return {
    snapshot() {
      // No argument object: the command's only parameter is `app:
      // tauri::AppHandle`, which Tauri injects on the Rust side.
      return invoke<UsageSnapshot>("usage_snapshot");
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryUsageClient(
  snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT,
  options: { readonly fail?: boolean } = {},
): UsageClient {
  return {
    async snapshot() {
      if (options.fail === true) {
        throw new Error("usage_snapshot failed");
      }
      return snapshot;
    },
  };
}

/** Shared production client — callers accept an override for tests. */
export const defaultUsageClient: UsageClient = createTauriUsageClient();
