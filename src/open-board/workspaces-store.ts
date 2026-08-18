import { signal } from '@preact/signals';
import { Store } from '../host/store-host';
import {
  forgetAgent,
  pushRecent,
  removeRecents,
  validateWorkspaces,
  WORKSPACES_VERSION,
  type AgentChoice,
  type WorkspacesData,
} from '../lib/workspace-recents';
import { reportPersistError } from '../chrome/events';

const STORE_FILE = 'workspaces.json';
const STORE_KEY = 'workspaces';

export const workspacesData = signal<WorkspacesData>({
  version: WORKSPACES_VERSION,
  recents: [],
});

let store: Store | null = null;

/** Load recents at startup — on failure fall back to empty, app keeps running. */
export async function initWorkspaces(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    workspacesData.value = validateWorkspaces(raw);
  } catch (err) {
    console.warn('Failed to load workspace recents, starting empty:', err);
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
    recents: pushRecent(workspacesData.value.recents, path, Date.now(), presetId, agent),
  };
  workspacesData.value = next;
  persist(next, "Recent folder wasn't saved");
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
  if (!store) {
    reportPersistError(`${failure} (storage unavailable)`);
    return;
  }
  store
    .set(STORE_KEY, next)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn('Failed to save workspace recents:', err);
      reportPersistError(`${failure} to disk`);
    });
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
