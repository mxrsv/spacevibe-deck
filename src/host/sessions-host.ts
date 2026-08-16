/**
 * Session history list, over the host bridge.
 *
 * Fail-soft by contract: a host with no `sessions_list` handler (Tauri,
 * browser `npm run dev`) answers `null` rather than throwing, and the caller
 * treats that as "this host does not have session history" — the toolbar
 * control is then not rendered at all, so the screen is unreachable by
 * construction rather than reachable and empty.
 *
 * Flat `{ limit }` per R6; `scripts/electron-ipc-contract.test.ts` pins it.
 */
import { invoke } from "./bridge";
import {
  asSessionsSnapshot,
  type SessionsSnapshot,
} from "../lib/session-history";

export async function listSessions(
  limit: number,
): Promise<SessionsSnapshot | null> {
  try {
    const raw = await invoke<unknown>("sessions_list", { limit });
    return asSessionsSnapshot(raw);
  } catch {
    return null;
  }
}
