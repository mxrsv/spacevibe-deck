export const WORKSPACES_VERSION = 2;
export const MAX_RECENTS = 8;

/** The agent CLI a workspace last opened with; `null` = Shell only. */
export type AgentChoice = string | null;

export interface RecentWorkspace {
  readonly path: string;
  readonly lastOpenedAt: number;
  /** Layout preset last used for this folder (preselects the board). */
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
  if (typeof raw !== "object" || raw === null) {
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
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.path === "string" &&
      record.path !== "" &&
      typeof record.lastOpenedAt === "number" &&
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
): Pick<RecentWorkspace, "lastPresetId" | "lastAgent"> {
  const combo: { lastPresetId?: string; lastAgent?: AgentChoice } = {};
  if (typeof record.lastPresetId === "string" && record.lastPresetId !== "") {
    combo.lastPresetId = record.lastPresetId;
  }
  if (
    record.lastAgent === null ||
    (typeof record.lastAgent === "string" && record.lastAgent !== "")
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

/**
 * Resolve a remembered/selected agent against what is actually on `$PATH`.
 * Shell is opt-in: only an explicit `null` (the user clicked Shell only this
 * session) yields Shell. No pick (`undefined`), a remembered choice, or a
 * stale memory all fall back to the first detected agent — an empty detect
 * result still degrades to Shell only.
 */
export function resolveAgentChoice(
  choice: AgentChoice | undefined,
  agents: readonly { readonly name: string }[],
): AgentChoice {
  if (choice === null) {
    return null;
  }
  if (choice !== undefined && agents.some((agent) => agent.name === choice)) {
    return choice;
  }
  return agents[0]?.name ?? null;
}

export function folderName(path: string): string {
  const trimmed = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return segment === "" ? trimmed : segment;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function formatRelativeTime(then: number, now: number): string {
  const age = Math.max(0, now - then);
  if (age < MINUTE) {
    return "just now";
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m ago`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h ago`;
  }
  if (age < WEEK) {
    return `${Math.floor(age / DAY)}d ago`;
  }
  return `${Math.floor(age / WEEK)}w ago`;
}
