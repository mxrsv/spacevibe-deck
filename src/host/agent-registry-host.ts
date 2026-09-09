/**
 * Renderer facade for the main process's `agent_registry` channel —
 * `claude agents --json`, polled by main on its own clock (agent-signal
 * contract layer, stage 1). Electron-only, like `sessionTails`: no Tauri
 * counterpart exists, and `available` is the same host-presence check
 * `worktree-host.ts` makes, so the sync that reads this stays inert on Tauri
 * and in the browser preview.
 *
 * No payload: main answers its latest snapshot and treats the ask itself as
 * the demand signal that keeps it polling.
 */
import { invoke } from "./bridge";
import {
  parseRegistrySnapshot,
  UNAVAILABLE_REGISTRY,
  type RegistrySnapshot,
} from "../lib/agent-registry";

export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

/** Never rejects: a failed invoke is an unavailable snapshot, and the rail keeps today's behaviour. */
export async function agentRegistry(): Promise<RegistrySnapshot> {
  if (!available) {
    return UNAVAILABLE_REGISTRY;
  }
  try {
    return parseRegistrySnapshot(await invoke<unknown>("agent_registry"));
  } catch (error) {
    console.warn("agent_registry failed:", error);
    return UNAVAILABLE_REGISTRY;
  }
}
