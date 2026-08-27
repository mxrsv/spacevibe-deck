/**
 * Creating one entry, as the renderer sees it (design §6.4).
 *
 * `workspace-create-host.ts`'s shape exactly: an `available` boolean read off
 * `__deckHost`, and one `invoke`. The two create controls are OMITTED where
 * `available` is false — a control that cannot answer is worse than no control
 * (DL-19.7's own reasoning for an unserviceable tab). Refresh and Collapse All
 * are renderer-only and always present, so the cluster never disappears
 * entirely.
 */
import { invoke } from "./bridge";

/** Electron-only; Tauri and browser previews do not install this bridge. */
export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export type EntryKind = "file" | "directory";

export interface CreateEntryResult {
  readonly path: string;
}

/** Flat payload per the renderer/main IPC contract (R6). The key ORDER is
 * asserted by `scripts/electron-ipc-contract.test.ts`. */
export function createEntry(
  root: string,
  parent: string,
  name: string,
  kind: EntryKind,
): Promise<CreateEntryResult> {
  return invoke<CreateEntryResult>("create_entry", { root, parent, name, kind });
}
