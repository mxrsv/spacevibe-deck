/**
 * Renderer facade for the main process's `session_tail` channel. Electron-
 * only, like `resumeLookup` — no Tauri counterpart exists.
 */
import { invoke } from "./bridge";
import type { ResumeRequest, SessionTailAnswer } from "../lib/agent-resume";

/**
 * One answer (or null) per request, positional. Defensive like resumeLookup:
 * anything that is not a `{ id, tail, model }` object becomes `null` AT ITS
 * OWN POSITION, so one malformed entry cannot shift every later sentence onto
 * the wrong pane. Only the `id` guard nulls the whole answer; `tail` and
 * `model` each degrade to `null` independently when malformed or absent.
 */
export async function sessionTails(
  requests: readonly ResumeRequest[],
): Promise<readonly (SessionTailAnswer | null)[]> {
  const raw = await invoke<unknown>("session_tail", { requests });
  if (!Array.isArray(raw)) {
    return requests.map(() => null);
  }
  // Walk the REQUESTS, not the reply: the contract is one slot per request, and
  // a host that answers with a different length must not be able to change how
  // many panes get an answer. A short reply fills the tail with nulls; a long
  // one has its surplus dropped.
  return requests.map((_request, index) => parseAnswer(raw[index]));
}

function parseAnswer(entry: unknown): SessionTailAnswer | null {
  if (entry === null || typeof entry !== "object") {
    return null;
  }
  const node = entry as Record<string, unknown>;
  if (typeof node.id !== "string" || node.id === "") {
    return null;
  }
  return {
    id: node.id,
    // Empty string means "absent" for every field here, `id` included above —
    // the main process never sends `tail: ""` (`oneLine` answers `null` for
    // blank text), so this is a defensive normalization, not a live case.
    tail: typeof node.tail === "string" && node.tail !== "" ? node.tail : null,
    model: typeof node.model === "string" && node.model !== "" ? node.model : null,
  };
}
