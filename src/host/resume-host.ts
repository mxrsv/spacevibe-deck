/**
 * Renderer facade for the main process's `resume_lookup` channel. Electron-
 * only, like `worktreeAdd` — no Tauri counterpart exists.
 */
import { invoke } from "./bridge";
import type { ResumeRef, ResumeRequest } from "../lib/agent-resume";

function validateResumeRef(raw: unknown): ResumeRef {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "object") {
    return null;
  }
  const kind = (raw as { readonly kind?: unknown }).kind;
  if (kind === "latest") {
    return { kind: "latest" };
  }
  if (kind === "id") {
    const id = (raw as { readonly id?: unknown }).id;
    return typeof id === "string" ? { kind: "id", id } : null;
  }
  return null;
}

/**
 * One answer per request, in order. Defensive against a malformed response:
 * a non-array reply degrades to all-null, and any single bad entry degrades
 * to null rather than rejecting the whole batch.
 */
export async function resumeLookup(
  requests: readonly ResumeRequest[],
): Promise<readonly ResumeRef[]> {
  const raw = await invoke<unknown>("resume_lookup", { requests });
  if (!Array.isArray(raw)) {
    return requests.map(() => null);
  }
  return raw.map((entry) => validateResumeRef(entry));
}
