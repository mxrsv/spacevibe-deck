/**
 * Renderer facade for the main process's `session_tail` channel. Electron-
 * only, like `resumeLookup` — no Tauri counterpart exists.
 */
import { invoke } from "./bridge";
import type { ResumeRequest } from "../lib/agent-resume";

/** One tail (or null) per request, positional. Defensive like resumeLookup. */
export async function sessionTails(
  requests: readonly ResumeRequest[],
): Promise<readonly (string | null)[]> {
  const raw = await invoke<unknown>("session_tail", { requests });
  if (!Array.isArray(raw)) {
    return requests.map(() => null);
  }
  return raw.map((entry) => (typeof entry === "string" ? entry : null));
}
