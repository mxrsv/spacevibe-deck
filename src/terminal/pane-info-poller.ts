import type { PaneProcessInfo } from '../lib/process-info';
import type { AgentProcessMatcher, PtyClient } from './pty-client';

const DEFAULT_INTERVAL_MS = 2000;

/** What the poller needs from its owner (TabManager). */
export interface PaneInfoPollerDeps {
  pty: Pick<PtyClient, 'ptyInfo' | 'gitBranch'>;
  /** Pane ids worth polling right now (tab dots + active tab headers). */
  targets(): readonly number[];
  /** Focused pane of the active tab — its CWD drives the git branch. */
  activePaneId(): number | null;
  /** Live, validated custom agents; built-ins are recognized by the host. */
  agentMatchers?(): readonly AgentProcessMatcher[];
  /** Fired after every successful poll with the fresh infos. */
  onUpdate(infos: readonly PaneProcessInfo[]): void;
  intervalMs?: number;
}

export interface PaneInfoPoller {
  /** Begin the recurring poll; idempotent while running. */
  start(): void;
  stop(): void;
  /** One immediate poll (materialize / init). Never throws. */
  poll(): Promise<void>;
  /** Last polled info for a pane; undefined before its first poll. */
  infoFor(id: number): PaneProcessInfo | undefined;
  /** Forget every cached pane outside `live` — call after a pane/tab closes. */
  prune(live: readonly number[]): void;
  /** Git branch of the focused pane's CWD; null when unknown. */
  branch(): string | null;
}

/**
 * Deep Pane info polling: the pty_info cache, the warn-once degrade contract
 * (keep last-known values, never break the loop) and the git-branch lookup
 * that skips unchanged CWDs.
 */
export function createPaneInfoPoller(deps: PaneInfoPollerDeps): PaneInfoPoller {
  const infoByPane = new Map<number, PaneProcessInfo>();
  let branch: string | null = null;
  let lastBranchCwd: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let warned = false;
  let requestedPolls = 0;
  let completedPolls = 0;
  let drainPromise: Promise<void> | null = null;

  async function updateBranch(): Promise<void> {
    const paneId = deps.activePaneId();
    const cwd = paneId === null ? null : (infoByPane.get(paneId)?.cwd ?? null);
    if (cwd === lastBranchCwd) {
      return; // unchanged since the last poll — skip the git call
    }
    if (cwd === null) {
      lastBranchCwd = null;
      branch = null;
      return;
    }
    try {
      branch = await deps.pty.gitBranch(cwd);
      lastBranchCwd = cwd;
    } catch (err) {
      if (!warned) {
        console.warn('git_branch failed:', err);
        warned = true;
      }
    }
  }

  async function pollOnce(): Promise<void> {
    const ids = deps.targets();
    if (ids.length === 0) {
      return;
    }
    let infos: PaneProcessInfo[];
    try {
      infos = await deps.pty.ptyInfo(ids, deps.agentMatchers?.() ?? [], false);
      warned = false;
    } catch (err) {
      // Keep the last known values; warn once, never break the loop
      if (!warned) {
        console.warn('pty_info failed:', err);
        warned = true;
      }
      return;
    }
    for (const info of infos) {
      infoByPane.set(info.id, info);
    }
    await updateBranch();
    deps.onUpdate(infos);
  }

  /**
   * Serialize process snapshots. A slow host process-table reading can outlive
   * the interval, and applying two readings concurrently lets the older response
   * overwrite the newer one. Calls made while a reading is active coalesce
   * into one trailing refresh so newly materialized panes are still observed.
   */
  function poll(): Promise<void> {
    requestedPolls += 1;
    if (drainPromise !== null) {
      return drainPromise;
    }
    const drain = async (): Promise<void> => {
      while (completedPolls < requestedPolls) {
        const target = requestedPolls;
        await pollOnce();
        completedPolls = target;
      }
    };
    const current = drain().finally(() => {
      if (drainPromise === current) {
        drainPromise = null;
      }
    });
    drainPromise = current;
    return current;
  }

  return {
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(() => void poll(), deps.intervalMs ?? DEFAULT_INTERVAL_MS);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    poll,
    infoFor(id) {
      return infoByPane.get(id);
    },
    prune(live) {
      const keep = new Set(live);
      for (const id of infoByPane.keys()) {
        if (!keep.has(id)) {
          infoByPane.delete(id);
        }
      }
    },
    branch() {
      return branch;
    },
  };
}
