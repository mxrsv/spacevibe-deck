import { signal } from "@preact/signals";
import { defaultUsageClient, type UsageClient } from "./usage-client";
import type { UsageSnapshot } from "../lib/usage-snapshot";

/**
 * The usage screen's data: a snapshot signal and a poll bound to the screen
 * being open. Window-scoped module store, per R5.
 *
 * The shell this drives never unmounts — `UsageScreen` follows
 * `SettingsScreen`, which stays mounted and is switched by an `open` prop.
 * So start and stop are called repeatedly over a session's life, in any
 * order, and everything below is written to survive that: a second start is a
 * no-op, stop is idempotent, and a reply from a superseded generation is
 * dropped rather than written.
 */

/**
 * Spec §Surface: a snapshot on open, then a 5 s poll while open. Not tuned
 * for cost — the Rust scanner is incremental, so a cycle over unchanged files
 * re-reads nothing and rewrites no cache.
 */
const USAGE_POLL_MS = 5000;

/** Last successful scan; null until the first one lands. */
export const usageSnapshot = signal<UsageSnapshot | null>(null);

/**
 * The last poll failed and what is on screen may be out of date.
 *
 * This means one thing only: the command rejected, which happens only when
 * the Rust worker panicked. "No transcripts found" is NOT this — it arrives
 * in-band as `sources[].state === "missing"`, and conflating the two is the
 * mistake spec major M7 exists to prevent.
 */
export const usageStale = signal(false);

/** A cold scan is running and there is nothing yet to show. */
export const usageLoading = signal(false);

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Bumped by every start and every stop. A poll captures the value at launch
 * and compares on reply, so a scan whose screen closed mid-flight cannot
 * write into the signals.
 */
let generation = 0;

/**
 * Generation of the scan currently running, or null. Keyed to the generation
 * rather than a bare boolean on purpose: a close-then-reopen must fetch at
 * once instead of waiting out the scan it just abandoned.
 */
let inFlightGeneration: number | null = null;

async function poll(client: UsageClient, forGeneration: number): Promise<void> {
  if (inFlightGeneration === forGeneration) {
    return; // a cold scan can outlast the tick; never stack a second one
  }
  inFlightGeneration = forGeneration;
  if (usageSnapshot.value === null) {
    usageLoading.value = true;
  }
  try {
    const next = await client.snapshot();
    if (forGeneration === generation) {
      usageSnapshot.value = next;
      usageStale.value = false;
    }
  } catch (error: unknown) {
    if (forGeneration === generation) {
      // Keep the last good snapshot on screen. Blanking it would turn a
      // transient worker failure into "you have no usage", which is a lie.
      console.warn("usage_snapshot failed:", error);
      usageStale.value = true;
    }
  } finally {
    if (inFlightGeneration === forGeneration) {
      inFlightGeneration = null;
    }
    if (forGeneration === generation) {
      usageLoading.value = false;
    }
  }
}

/** Fetch now, then every 5 s. Calling it while already polling does nothing. */
export function startUsagePolling(client: UsageClient = defaultUsageClient): void {
  if (timer !== null) {
    return;
  }
  generation += 1;
  const forGeneration = generation;
  timer = setInterval(() => {
    void poll(client, forGeneration);
  }, USAGE_POLL_MS);
  void poll(client, forGeneration);
}

/**
 * Stop polling. Idempotent: the generation bump is unconditional, so a scan
 * still in flight can never land afterwards and a second call has nothing
 * left to do. `usageSnapshot` and `usageStale` are deliberately left alone —
 * reopening the screen should show the data it had, not a blank.
 */
export function stopUsagePolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  generation += 1;
  usageLoading.value = false;
}
