import { Store } from "@tauri-apps/plugin-store";
import { getVersion } from "@tauri-apps/api/app";
import {
  resolveAttemptOutcome,
  type AttemptOutcome,
  type UpdateAttempt,
} from "./update-attempt";

/**
 * Persistence for the install breadcrumb. Its own file, not `settings.json`:
 * this is transient machine state, and a settings reset must not erase the
 * evidence that an update failed.
 */
const STORE_FILE = "update-attempt.json";
const STORE_KEY = "attempt";

async function open(): Promise<Store> {
  return Store.load(STORE_FILE, { defaults: {}, autoSave: false });
}

/**
 * Record what we are about to attempt. Written and flushed synchronously
 * before control leaves the app — an autosave timer would lose the race with
 * an installer that exits the process.
 */
export async function recordUpdateAttempt(
  targetVersion: string,
  startedAt: number,
): Promise<void> {
  try {
    const store = await open();
    const attempt: UpdateAttempt = {
      targetVersion,
      fromVersion: await getVersion(),
      startedAt,
    };
    await store.set(STORE_KEY, attempt);
    await store.save();
  } catch (error: unknown) {
    // Never block an install because the breadcrumb could not be written —
    // it is diagnostics, not a precondition.
    console.warn("Could not record the update attempt:", error);
  }
}

/**
 * Read the breadcrumb against the version now running, then clear it. Clearing
 * on read is deliberate: the outcome is reported once, and a stale record must
 * not warn again on every later launch.
 */
export async function takeUpdateOutcome(): Promise<AttemptOutcome> {
  try {
    const store = await open();
    const raw = await store.get<unknown>(STORE_KEY);
    if (raw === undefined || raw === null) {
      return { kind: "none" };
    }
    const outcome = resolveAttemptOutcome(raw, await getVersion());
    await store.delete(STORE_KEY);
    await store.save();
    return outcome;
  } catch (error: unknown) {
    console.warn("Could not read the update attempt:", error);
    return { kind: "none" };
  }
}
