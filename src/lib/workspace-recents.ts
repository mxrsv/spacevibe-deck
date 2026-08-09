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
 * Record an open without disturbing the list's order.
 *
 * Order belongs to the user (rows are draggable — see `reorderRecents`), so a
 * folder already in the list is updated **in place**: only its timestamp and
 * remembered combo change, and a row hand-placed at the bottom stays there
 * however often it is opened. A folder not in the list yet has no place of its
 * own, so it enters at the front and the cap drops the last row — which is now
 * the row the user put last, not the least recently used one.
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
  const index = recents.findIndex((entry) => entry.path === path);
  const previous = index === -1 ? undefined : recents[index];
  const nextPresetId = presetId ?? previous?.lastPresetId;
  const nextAgent = agent !== undefined ? agent : previous?.lastAgent;
  const entry: RecentWorkspace = {
    path,
    lastOpenedAt: now,
    ...(nextPresetId !== undefined ? { lastPresetId: nextPresetId } : {}),
    ...(nextAgent !== undefined ? { lastAgent: nextAgent } : {}),
  };
  if (index === -1) {
    return [entry, ...recents].slice(0, MAX_RECENTS);
  }
  return recents.map((current, at) => (at === index ? entry : current));
}

/**
 * Move `movedPath` to sit before or after `targetPath`.
 *
 * Addressed by path, never by index: the rail renders `[...alive, ...missing]`
 * and may prepend a fabricated just-picked row, so a visual index does not
 * address the stored array. Remove-then-insert-beside-the-target sidesteps the
 * whole mapping.
 *
 * Returns the input array **by reference** when the move changes nothing or
 * either path is unknown, so a caller can skip the disk write on identity.
 */
export function reorderRecents(
  recents: readonly RecentWorkspace[],
  movedPath: string,
  targetPath: string,
  placeAfter: boolean,
): readonly RecentWorkspace[] {
  const moved = recents.find((entry) => entry.path === movedPath);
  const rest = recents.filter((entry) => entry.path !== movedPath);
  const target = rest.findIndex((entry) => entry.path === targetPath);
  if (moved === undefined || target === -1) {
    return recents;
  }
  const at = placeAfter ? target + 1 : target;
  const next = [...rest.slice(0, at), moved, ...rest.slice(at)];
  // Dropping a row back into the gap it already occupies is a no-op, not a
  // write — the rows either side of it are the same ones as before.
  return next.every((entry, index) => entry === recents[index])
    ? recents
    : next;
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

export function folderName(path: string): string {
  const trimmed = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return segment === "" ? trimmed : segment;
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
    return "just now";
  }
  if (age < HOUR) {
    return ago(Math.floor(age / MINUTE), "minute");
  }
  if (age < DAY) {
    return ago(Math.floor(age / HOUR), "hour");
  }
  if (age < 2 * DAY) {
    return "Yesterday";
  }
  if (age < WEEK) {
    return ago(Math.floor(age / DAY), "day");
  }
  if (age < MONTH) {
    return ago(Math.floor(age / WEEK), "week");
  }
  if (age < YEAR) {
    return ago(Math.floor(age / MONTH), "month");
  }
  return ago(Math.floor(age / YEAR), "year");
}

function ago(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
