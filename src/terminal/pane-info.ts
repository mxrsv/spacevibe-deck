import type { PaneProcessInfo } from '../lib/process-info';
import type { AgentProcessMatcher } from '../lib/agent-catalog';
import { defaultPtyClient, type PtyClient } from './pty-client';

function unknownPaneInfo(id: number): PaneProcessInfo {
  return {
    id,
    cwd: null,
    process: null,
    kind: 'unknown',
    agent: null,
  };
}

/**
 * Fresh (non-polled) pty_info for the given panes. The 2s poll cache can be
 * stale at decision points (spawn cwd, close guard) — this is the cheap
 * single-shot alternative. Every requested pane gets a result; omitted panes
 * and IPC failures become explicit unknown snapshots so destructive callers
 * cannot mistake missing metadata for an idle shell.
 */
export async function freshPaneInfo(
  ids: readonly number[],
  pty: PtyClient = defaultPtyClient,
  agentMatchers: readonly AgentProcessMatcher[] = [],
): Promise<PaneProcessInfo[]> {
  if (ids.length === 0) {
    return [];
  }
  try {
    const infos = await pty.ptyInfo(ids, agentMatchers);
    return ids.map((id) => infos.find((info) => info.id === id) ?? unknownPaneInfo(id));
  } catch (err) {
    console.warn('pty_info failed:', err);
    return ids.map(unknownPaneInfo);
  }
}

/** Fresh cwd of one pane; null on failure (spawn then falls back to $HOME). */
export async function freshCwd(
  id: number | null,
  pty: PtyClient = defaultPtyClient,
): Promise<string | null> {
  if (id === null) {
    return null;
  }
  const infos = await freshPaneInfo([id], pty);
  return infos.find((info) => info.id === id)?.cwd ?? null;
}
