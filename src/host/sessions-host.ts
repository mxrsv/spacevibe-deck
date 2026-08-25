/**
 * Session history list, over the host bridge.
 *
 * A missing Electron bridge confirms that this host cannot list sessions.
 * Invocation and validation failures stay distinct so one transient failure
 * cannot hide the feature or erase the renderer's last-good snapshot.
 *
 * Flat `{ limit }` per R6; `scripts/electron-ipc-contract.test.ts` pins it.
 */
import { invoke } from "./bridge";
import { asSessionsSnapshot, type SessionsSnapshot } from "../lib/session-history";

export type SessionsListResult =
  | { readonly status: "supported"; readonly snapshot: SessionsSnapshot }
  | { readonly status: "unsupported" }
  | { readonly status: "error"; readonly error: unknown };

export function sessionsHostAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
  );
}

export async function listSessions(limit: number): Promise<SessionsListResult> {
  if (!sessionsHostAvailable()) {
    return { status: "unsupported" };
  }
  try {
    const raw = await invoke<unknown>("sessions_list", { limit });
    const snapshot = asSessionsSnapshot(raw);
    return snapshot === null
      ? { status: "error", error: new Error("Invalid sessions_list response") }
      : { status: "supported", snapshot };
  } catch (error: unknown) {
    return { status: "error", error };
  }
}
