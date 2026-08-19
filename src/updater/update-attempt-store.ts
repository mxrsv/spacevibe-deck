import { Store } from "../host/store-host";
import { getVersion } from "../host/shell-host";
import { resolveAttemptOutcome, type AttemptOutcome, type UpdateAttempt } from "./update-attempt";

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
 * Record what we are about to attempt, and **throw if it cannot be written**.
 *
 * Swallowing this was the same mistake the settings store had just been fixed
 * for. The breadcrumb is the only evidence that survives an installer which
 * exits the process; installing without it means a failure can go unnoticed
 * forever, which is precisely the state this whole mechanism exists to end.
 * The caller stops the install rather than proceeding blind.
 *
 * Written and flushed synchronously — an autosave timer would lose the race
 * with an installer that exits the process.
 */
export async function recordUpdateAttempt(targetVersion: string, startedAt: number): Promise<void> {
  const store = await open();
  const attempt: UpdateAttempt = {
    targetVersion,
    fromVersion: await getVersion(),
    startedAt,
  };
  await store.set(STORE_KEY, attempt);
  await store.save();
}

/**
 * Read the breadcrumb against the version now running, then clear it.
 *
 * Clearing on read is deliberate: the outcome is reported once, and a stale
 * record must not warn again on every later launch. But cleanup failing must
 * not swallow the outcome — the warning matters more than the housekeeping, so
 * a failed delete leaves the record in place (it will be reported again next
 * launch, which is the safe direction) and still returns what was read.
 */
export async function takeUpdateOutcome(): Promise<AttemptOutcome> {
  let outcome: AttemptOutcome = { kind: "none" };
  let store: Store;
  try {
    store = await open();
    const raw = await store.get<unknown>(STORE_KEY);
    if (raw === undefined || raw === null) {
      return { kind: "none" };
    }
    outcome = resolveAttemptOutcome(raw, await getVersion());
  } catch (error: unknown) {
    // Reading is best-effort: a missing or unreadable file means we have no
    // evidence, which is the same as no attempt.
    console.warn("Could not read the update attempt:", error);
    return { kind: "none" };
  }
  try {
    await store.delete(STORE_KEY);
    await store.save();
  } catch (error: unknown) {
    console.warn("Could not clear the update attempt:", error);
  }
  return outcome;
}
