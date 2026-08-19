import { usageSnapshot } from "../host/usage-host";
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from "../lib/usage-snapshot";

/** Scanner seam — real IPC in production, fakes in tests. */
export interface UsageClient {
  /**
   * Rejects **only** when the host's scan worker itself failed (plan §0.3
   * decision 5). Missing directories, unreadable files and malformed lines
   * all arrive in-band through `sources[].state` and `skippedLines`, so the
   * store's failure path has exactly one trigger.
   */
  snapshot(): Promise<UsageSnapshot>;
}

/**
 * The production client, on the host bridge facade rather than a direct
 * Tauri import (plan §6.1.6) — the renderer stays host-agnostic and the
 * Electron main process serves the same channel name the Tauri command had.
 */
export function createHostUsageClient(): UsageClient {
  return {
    snapshot() {
      return usageSnapshot();
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
export const defaultUsageClient: UsageClient = createHostUsageClient();
