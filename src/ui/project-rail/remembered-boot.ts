import {
  loadRememberedPanes,
  mergeFromRecord,
  rememberedStoreWritable,
} from "../../terminal/remembered-panes";
import type { WindowRecord } from "../../lib/session-schema";

export interface RememberedBootDeps {
  /** `stageLauncherEnabled()`: with it off the remembered store is neither read nor written. */
  readonly enabled: boolean;
  /** This (main) window's label: its record is the previous session's. */
  readonly mainLabel: string;
  /** `readWindowRecords`, not `readLastSession`: the latter is empty after a crash-loop marker. */
  readonly readRecords: () => Promise<ReadonlyMap<string, WindowRecord>>;
}

/**
 * Normal boot, with the stage launcher on: load the remembered panes and fold the previous main
 * record in. Call it BEFORE the journal's first write, which replaces that record.
 *
 * Resolves true once the rows are safely held by the store, so the caller may let the journal
 * replace the record. False means the record may be the only copy (the switch is off, the
 * records could not be read, or the store is write-locked), and the caller keeps holding it.
 */
export async function seedRememberedPanes(deps: RememberedBootDeps): Promise<boolean> {
  if (!deps.enabled) {
    return false;
  }
  await loadRememberedPanes();
  let records: ReadonlyMap<string, WindowRecord>;
  try {
    records = await deps.readRecords();
  } catch (err: unknown) {
    console.error("reading the previous session for remembered agents failed:", err);
    return false;
  }
  await mergeFromRecord(records.get(deps.mainLabel));
  return rememberedStoreWritable();
}

/**
 * Whether boot keeps the previous main record in place instead of letting the journal replace it:
 * while a last session exists and its panes have not reached the remembered store. Once they have
 * (`rememberedSeeded`), holding the record would merge the same panes again next boot and bring
 * back a row the user forgot.
 */
export function shouldHoldRecord(hasLastSession: boolean, rememberedSeeded: boolean): boolean {
  return hasLastSession && !rememberedSeeded;
}
