/**
 * Renderer facade for the two `gh`-backed GitHub channels. Electron-only,
 * like `worktreeAdd` and `resumeLookup` — no Tauri counterpart exists, so on
 * that host both calls answer "unavailable" and the button keeps its
 * open-the-page behaviour.
 */
import { invoke } from "./bridge";

export type GithubStarState = "starred" | "not-starred" | "unavailable";

export type GithubStarResult =
  { readonly ok: true } | { readonly ok: false; readonly error: "unavailable" };

/**
 * A reply from a host that does not implement these channels is not a
 * failure — it is "unavailable", the same word the Electron host uses for a
 * missing `gh`. Validated rather than trusted: a wrong string here would
 * hide the button on a machine that never starred anything.
 */
export async function readGithubStarState(): Promise<GithubStarState> {
  try {
    const raw = await invoke<unknown>("github_star_state", {});
    return raw === "starred" || raw === "not-starred" ? raw : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function starGithubRepository(): Promise<GithubStarResult> {
  try {
    const raw = await invoke<unknown>("github_star", {});
    const ok = (raw as { readonly ok?: unknown } | null)?.ok;
    return ok === true ? { ok: true } : { ok: false, error: "unavailable" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}
