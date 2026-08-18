import { normalizeWorkspacePath } from './workspace-label';

export const WORKSPACES_VERSION = 2;
export const MAX_RECENTS = 8;

/** The agent CLI a workspace last opened with; `null` = Shell only. */
export type AgentChoice = string | null;

export interface RecentWorkspace {
  readonly path: string;
  readonly lastOpenedAt: number;
  /** Layout preset last used for this folder; the board reopens with it. */
  readonly lastPresetId?: string;
  /** Agent last launched for this folder; `null` = Shell only, absent = never recorded. */
  readonly lastAgent?: AgentChoice;
}

export interface WorkspacesData {
  readonly version: number;
  readonly recents: readonly RecentWorkspace[];
}

/**
 * Invalid envelope → empty list; invalid entries are dropped one by one.
 * Accepts both v1 (no combo fields) and v2 files — a v1 entry just comes back
 * with `lastPresetId`/`lastAgent` undefined, never dropped for lacking them.
 */
export function validateWorkspaces(raw: unknown): WorkspacesData {
  const empty: WorkspacesData = { version: WORKSPACES_VERSION, recents: [] };
  if (typeof raw !== 'object' || raw === null) {
    return empty;
  }
  const source = raw as Record<string, unknown>;
  if (
    (source.version !== 1 && source.version !== WORKSPACES_VERSION) ||
    !Array.isArray(source.recents)
  ) {
    return empty;
  }
  const recents: RecentWorkspace[] = [];
  for (const entry of source.recents.slice(0, MAX_RECENTS)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.path === 'string' &&
      record.path !== '' &&
      typeof record.lastOpenedAt === 'number' &&
      Number.isFinite(record.lastOpenedAt) &&
      !recents.some((r) => r.path === record.path)
    ) {
      recents.push({
        path: record.path,
        lastOpenedAt: record.lastOpenedAt,
        ...validateCombo(record),
      });
    }
  }
  return { version: WORKSPACES_VERSION, recents };
}

/** Keep only well-formed combo fields; a bad field is dropped, not the entry. */
function validateCombo(
  record: Record<string, unknown>,
): Pick<RecentWorkspace, 'lastPresetId' | 'lastAgent'> {
  const combo: { lastPresetId?: string; lastAgent?: AgentChoice } = {};
  if (typeof record.lastPresetId === 'string' && record.lastPresetId !== '') {
    combo.lastPresetId = record.lastPresetId;
  }
  if (
    record.lastAgent === null ||
    (typeof record.lastAgent === 'string' && record.lastAgent !== '')
  ) {
    combo.lastAgent = record.lastAgent;
  }
  return combo;
}

/**
 * Newest first; same path moves to the front (no duplicate rows).
 *
 * A `presetId`/`agent` argument of `undefined` **inherits** the existing
 * entry's combo (a plain "focus this folder again" must not wipe the memory),
 * while `agent: null` is an explicit Shell-only choice that overwrites it.
 */
export function pushRecent(
  recents: readonly RecentWorkspace[],
  path: string,
  now: number,
  presetId?: string,
  agent?: AgentChoice,
): readonly RecentWorkspace[] {
  const previous = recents.find((entry) => entry.path === path);
  const rest = recents.filter((entry) => entry.path !== path);
  const nextPresetId = presetId ?? previous?.lastPresetId;
  const nextAgent = agent !== undefined ? agent : previous?.lastAgent;
  const head: RecentWorkspace = {
    path,
    lastOpenedAt: now,
    ...(nextPresetId !== undefined ? { lastPresetId: nextPresetId } : {}),
    ...(nextAgent !== undefined ? { lastAgent: nextAgent } : {}),
  };
  return [head, ...rest].slice(0, MAX_RECENTS);
}

/** Split rows into live and missing folders, keeping each side's order. */
export function partitionRecents(
  recents: readonly RecentWorkspace[],
  missing: ReadonlySet<string>,
): {
  readonly alive: readonly RecentWorkspace[];
  readonly missing: readonly RecentWorkspace[];
} {
  return {
    alive: recents.filter((entry) => !missing.has(entry.path)),
    missing: recents.filter((entry) => missing.has(entry.path)),
  };
}

/**
 * Drop every entry whose path is in `paths` — exact string match, the same
 * comparison rule `pushRecent` dedupes by (no normalization).
 */
export function removeRecents(
  recents: readonly RecentWorkspace[],
  paths: readonly string[],
): readonly RecentWorkspace[] {
  const drop = new Set(paths);
  return recents.filter((entry) => !drop.has(entry.path));
}

/**
 * Forget every memory of `agentId`, keeping the folders themselves.
 *
 * Called when a declared agent is deleted. Ids are derived from the label and
 * checked only against agents that currently exist, so re-adding the same
 * label regenerates the same id — and a workspace still remembering the old
 * one would then launch the NEW agent's command without any stale-choice
 * warning. Dropping the memory at deletion is what keeps that from happening:
 * the folder falls back to the first available agent, visibly.
 */
export function forgetAgent(
  recents: readonly RecentWorkspace[],
  agentId: string,
): readonly RecentWorkspace[] {
  return recents.map((entry) => {
    if (entry.lastAgent !== agentId) {
      return entry;
    }
    const { lastAgent: _dropped, ...rest } = entry;
    return rest;
  });
}

/**
 * Resolve a remembered/selected agent against what is actually on `$PATH`.
 * Shell is opt-in: only an explicit `null` (the user clicked Shell only this
 * session) yields Shell. No pick (`undefined`), a remembered choice, or a
 * stale memory all fall back to the first detected agent — an empty detect
 * result still degrades to Shell only.
 */
export function resolveAgentChoice(
  choice: AgentChoice | undefined,
  agents: readonly { readonly id: string }[],
): AgentChoice {
  if (choice === null) {
    return null;
  }
  if (choice !== undefined && agents.some((agent) => agent.id === choice)) {
    return choice;
  }
  return agents[0]?.id ?? null;
}

/**
 * The agent a workspace should open with when nobody is there to pick one —
 * the `New` row dropped onto a pane spawns without a picker step, so the
 * answer has to come from memory alone.
 *
 * Paths are normalized on both sides: a tab's `workspacePath` is normalized at
 * materialize time while a recents entry carries whatever spelling the picker
 * handed in, and a trailing slash must not read as a different folder.
 * A tab with no workspace, or a folder never opened, falls through to
 * `resolveAgentChoice`'s first-detected rule.
 */
export function agentForWorkspace(
  recents: readonly RecentWorkspace[],
  workspacePath: string | null,
  agents: readonly { readonly id: string }[],
): AgentChoice {
  const wanted = workspacePath === null ? null : normalizeWorkspacePath(workspacePath);
  const entry =
    wanted === null
      ? undefined
      : recents.find((recent) => normalizeWorkspacePath(recent.path) === wanted);
  return resolveAgentChoice(entry?.lastAgent, agents);
}

export function folderName(path: string): string {
  const trimmed = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  const segment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return segment === '' ? trimmed : segment;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeTime(then: number, now: number): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE) {
    return 'just now';
  }
  if (age < HOUR) {
    return ago(Math.floor(age / MINUTE), 'minute');
  }
  if (age < DAY) {
    return ago(Math.floor(age / HOUR), 'hour');
  }
  if (age < 2 * DAY) {
    return 'Yesterday';
  }
  if (age < WEEK) {
    return ago(Math.floor(age / DAY), 'day');
  }
  if (age < MONTH) {
    return ago(Math.floor(age / WEEK), 'week');
  }
  if (age < YEAR) {
    return ago(Math.floor(age / MONTH), 'month');
  }
  return ago(Math.floor(age / YEAR), 'year');
}

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
