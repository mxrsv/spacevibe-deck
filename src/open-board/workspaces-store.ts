import { computed, signal } from "@preact/signals";
import { Store } from "../host/store-host";
import {
  forgetAgent,
  MAX_RECENTS,
  MAX_STORED_RECENTS,
  pushRecent,
  removeRecents,
  shownRecents,
  validateWorkspaces,
  WORKSPACES_VERSION,
  type AgentChoice,
  type WorkspacesData,
} from "../lib/workspace-recents";
import { reportPersistError } from "../chrome/events";
import { stageLauncherEnabled } from "../launcher/stage-launcher-enabled";

const STORE_FILE = "workspaces.json";
const STORE_KEY = "workspaces";
const CLONE_PARENT_KEY = "cloneParent";

/** The whole history, up to `MAX_STORED_RECENTS` with the stage launcher on: only its project menu reads this. */
export const workspacesData = signal<WorkspacesData>({
  version: WORKSPACES_VERSION,
  recents: [],
});

/** The newest `MAX_RECENTS` of the history: what the Open board, the rail and every other list show. */
export const shownWorkspaces = computed(() => shownRecents(workspacesData.value.recents));

/** The long history belongs to the stage launcher; with it off the file behaves as it always did. */
function recentsCap(): number {
  return stageLauncherEnabled() ? MAX_STORED_RECENTS : MAX_RECENTS;
}

let store: Store | null = null;
let cloneParent: string | null = null;

/** Load recents at startup — on failure fall back to empty, app keeps running. */
export async function initWorkspaces(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    workspacesData.value = validateWorkspaces(raw, recentsCap());
    const parent = await store.get<unknown>(CLONE_PARENT_KEY);
    cloneParent = typeof parent === "string" && parent !== "" ? parent : null;
  } catch (err) {
    console.warn("Failed to load workspace recents, starting empty:", err);
  }
}

/**
 * Record a folder opened from the board, remembering the layout + agent combo.
 * A `presetId`/`agent` of `undefined` keeps the folder's existing memory (see
 * `pushRecent`) — no caller needs that today (every Open picks both), but the
 * store must not invent a combo for one that does.
 */
export function recordWorkspaceOpen(path: string, presetId?: string, agent?: AgentChoice): void {
  const next: WorkspacesData = {
    version: WORKSPACES_VERSION,
    recents: pushRecent(
      workspacesData.value.recents,
      path,
      Date.now(),
      presetId,
      agent,
      recentsCap(),
    ),
  };
  workspacesData.value = next;
  persist(next, "Recent folder wasn't saved");
}

/**
 * `recordWorkspaceOpen` for a folder Deck just created (a clone): resolves only
 * after the write reached disk and rejects when it did not, because the clone
 * form must keep the finished checkout and offer a retry rather than guess.
 * The signal is updated first like every writer here, so a retry is idempotent:
 * the path is already the head of Recents and only the write repeats.
 */
export function addWorkspaceDurably(path: string): Promise<void> {
  const next: WorkspacesData = {
    version: WORKSPACES_VERSION,
    recents: pushRecent(
      workspacesData.value.recents,
      path,
      Date.now(),
      undefined,
      undefined,
      recentsCap(),
    ),
  };
  workspacesData.value = next;
  return persistDurably(next);
}

/** The parent folder of the last successful clone, from the previous run or this one. */
export function lastCloneParent(): string | null {
  return cloneParent;
}

export function rememberCloneParent(parent: string): void {
  cloneParent = parent;
  if (!store) {
    return; // a convenience, not data: no persist-error bar for it
  }
  store
    .set(CLONE_PARENT_KEY, parent)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save the clone parent folder:", err);
    });
}

/**
 * Drop folders from Recents (the row ×, ⌫ and "Remove N" paths) and persist —
 * a removed entry must not come back after a restart. A call that removes
 * nothing is a no-op: no signal churn, no disk write, and no spurious
 * "wasn't saved" report for a change that never happened.
 */
export function removeWorkspaceRecents(paths: readonly string[]): void {
  const current = workspacesData.value.recents;
  const recents = removeRecents(current, paths);
  if (recents.length === current.length) {
    return;
  }
  const next: WorkspacesData = { version: WORKSPACES_VERSION, recents };
  workspacesData.value = next;
  persist(next, "Recents change wasn't saved");
}

/** Write-behind only — callers update the signal first, and it stays the
 * source of truth for the session even when the write below fails. */
function persist(next: WorkspacesData, failure: string): void {
  persistDurably(next).catch((err: unknown) => {
    console.warn("Failed to save workspace recents:", err);
    reportPersistError(
      err instanceof StorageUnavailableError
        ? `${failure} (storage unavailable)`
        : `${failure} to disk`,
    );
  });
}

class StorageUnavailableError extends Error {}

/** The write `persist` fires and forgets, with its outcome left to the caller. */
function persistDurably(next: WorkspacesData): Promise<void> {
  if (!store) {
    return Promise.reject(new StorageUnavailableError("workspace storage is unavailable"));
  }
  return store.set(STORE_KEY, next).then(() => store?.save());
}

/**
 * Drop every folder's memory of a declared agent that no longer exists.
 *
 * Deleting an agent frees its id, and re-adding the same label regenerates
 * it — so a folder still pointing at the old id would quietly open with the
 * new agent's command. Forgetting here is cheaper than a tombstone list that
 * would grow forever, and it degrades the way the board already handles an
 * agent it cannot resolve.
 */
export function forgetWorkspaceAgent(agentId: string): void {
  const current = workspacesData.value.recents;
  const recents = forgetAgent(current, agentId);
  if (recents.every((entry, index) => entry === current[index])) {
    return; // nothing remembered it — no signal churn, no disk write
  }
  const next: WorkspacesData = { version: WORKSPACES_VERSION, recents };
  workspacesData.value = next;
  persist(next, "Agent removal wasn't saved");
}
