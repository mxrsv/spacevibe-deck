import { computed, type ReadonlySignal } from "@preact/signals";
import { readGithubStarState, starGithubRepository } from "../host/github-host";
import { openUrl } from "../host/shell-host";
import { reportPersistError } from "../chrome/events";
import { settings, settingsLoadState, updateSettings } from "./settings-store";

/**
 * Deck's own repository. The star itself is made through `gh`; this URL is
 * what the ask degrades to when `gh` cannot answer — GitHub offers no URL
 * that stars on arrival, so the page is where the user presses the button.
 */
export const GITHUB_REPO_URL = "https://github.com/mxrsv/spacevibe-deck";

/**
 * Whether the "Star on GitHub" control is shown at all. One computed for both
 * mounts (the open board and the Settings header) so they can never disagree
 * about whether the ask is still live.
 */
export const githubStarAskOpen: ReadonlySignal<boolean> = computed(
  () => !settings.value.githubStarred,
);

/** Once per window: a board reopened ten times must not re-run `gh` ten times. */
let checkStarted = false;

/**
 * Reconcile the remembered answer with the account's actual state.
 *
 * Runs at most once per window and writes NOTHING unless the two disagree —
 * an `unavailable` reply (no `gh`, signed out, offline, or the Tauri host,
 * which implements neither channel) leaves the remembered answer exactly as
 * it was. This is what makes an unstar reappear as an ask, and it is also why
 * the flag alone is never trusted to mean "starred".
 */
export async function ensureGithubStarChecked(): Promise<void> {
  if (checkStarted || settingsLoadState.value.status !== "ready") {
    return;
  }
  checkStarted = true;
  const state = await readGithubStarState();
  if (state === "unavailable") {
    return;
  }
  const starred = state === "starred";
  if (starred !== settings.value.githubStarred) {
    updateSettings({ githubStarred: starred });
  }
}

export type GithubStarOutcome = "starred" | "opened";

/**
 * The click. `gh` stars in place when it can; otherwise the repository page
 * opens and the ask is spent either way (owner's decision 2026-08-19) — a
 * control that stays after it has done everything it can reads as broken.
 *
 * The remembered answer is set on both paths, and the recheck above is what
 * corrects the optimistic one on a machine where `gh` can actually tell.
 */
export async function requestGithubStar(): Promise<GithubStarOutcome> {
  const result = await starGithubRepository();
  if (result.ok) {
    updateSettings({ githubStarred: true });
    return "starred";
  }
  try {
    await openUrl(GITHUB_REPO_URL);
  } catch {
    reportPersistError("Couldn't open GitHub in your browser.");
  }
  updateSettings({ githubStarred: true });
  return "opened";
}
