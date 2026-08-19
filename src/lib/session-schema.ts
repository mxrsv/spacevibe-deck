import { countLeaves, type SerializedNode } from "./split-tree";
import { validateLayout } from "./layout-validation";
import { isTabDotColor, type TabDotColor } from "./tab-colors";

export const SESSION_VERSION = 1;
// Sanity bounds so a corrupt file cannot flood the rail or a boot restore.
export const MAX_ARCHIVE_WORKSPACES = 24;
export const MAX_JOURNAL_TABS = 32;

export interface SessionPane {
  /** Polled cwd at capture time; null = unknown (spawn falls back to $HOME). */
  readonly cwd: string | null;
  /** PaneAgent string as classified (built-in id, or custom agent label); null = plain shell. */
  readonly agent: string | null;
}

export interface SessionTab {
  readonly workspacePath: string | null;
  readonly layout: SerializedNode;
  /** Zipped to leafIds() left-to-right — same ordering contract as Preset.cwds. */
  readonly panes: readonly SessionPane[];
  readonly name: string | null;
  readonly dotColor: TabDotColor | null;
}

export interface SessionFileTab {
  readonly path: string;
  readonly preview: boolean;
}

export interface SessionFileSurface {
  readonly workspacePath: string;
  readonly tabs: readonly SessionFileTab[];
  readonly activePath: string | null;
}

/** One window's live state; key `window:<label>` in session.json. */
export interface WindowRecord {
  readonly savedAt: number;
  readonly activeTabIndex: number;
  readonly tabs: readonly SessionTab[];
  /** Main window only; secondary windows write []. */
  readonly files: readonly SessionFileSurface[];
  readonly activeFileTab: string | null;
}

/** Last known session per workspace; key `archive`. Survives restore. */
export interface ArchiveEntry {
  readonly savedAt: number;
  readonly tabs: readonly SessionTab[];
}

/** Malformed field → default null; never rejects the pane (drop is by the caller's array). */
function validateSessionPane(raw: unknown): SessionPane {
  if (typeof raw !== "object" || raw === null) {
    return { cwd: null, agent: null };
  }
  const source = raw as Record<string, unknown>;
  return {
    cwd: typeof source.cwd === "string" ? source.cwd : null,
    agent: typeof source.agent === "string" ? source.agent : null,
  };
}

function validateSessionTab(raw: unknown): SessionTab | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const layout = validateLayout(source.layout);
  if (layout === null) {
    return null;
  }
  if (!Array.isArray(source.panes) || source.panes.length !== countLeaves(layout)) {
    return null;
  }
  return {
    workspacePath: typeof source.workspacePath === "string" ? source.workspacePath : null,
    layout,
    panes: source.panes.map(validateSessionPane),
    name: typeof source.name === "string" ? source.name : null,
    dotColor: isTabDotColor(source.dotColor) ? source.dotColor : null,
  };
}

function validateSessionFileTab(raw: unknown): SessionFileTab | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.path !== "string" || source.path === "") {
    return null;
  }
  if (typeof source.preview !== "boolean") {
    return null;
  }
  return { path: source.path, preview: source.preview };
}

function validateSessionFileSurface(raw: unknown): SessionFileSurface | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.workspacePath !== "string" || source.workspacePath === "") {
    return null;
  }
  if (!Array.isArray(source.tabs)) {
    return null;
  }
  const tabs = source.tabs
    .map(validateSessionFileTab)
    .filter((tab): tab is SessionFileTab => tab !== null);
  return {
    workspacePath: source.workspacePath,
    tabs,
    activePath: typeof source.activePath === "string" ? source.activePath : null,
  };
}

function clampActiveTabIndex(raw: unknown, tabCount: number): number {
  if (tabCount === 0) {
    return 0;
  }
  const requested = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
  return Math.min(Math.max(requested, 0), tabCount - 1);
}

/** Invalid envelope → null; invalid tabs/files are dropped one by one. */
export function validateWindowRecord(raw: unknown): WindowRecord | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.savedAt !== "number" || !Number.isFinite(source.savedAt)) {
    return null;
  }
  if (!Array.isArray(source.tabs)) {
    return null;
  }
  const tabs = source.tabs
    .slice(0, MAX_JOURNAL_TABS)
    .map(validateSessionTab)
    .filter((tab): tab is SessionTab => tab !== null);
  const filesRaw = Array.isArray(source.files) ? source.files : [];
  const files = filesRaw
    .map(validateSessionFileSurface)
    .filter((surface): surface is SessionFileSurface => surface !== null);
  return {
    savedAt: source.savedAt,
    activeTabIndex: clampActiveTabIndex(source.activeTabIndex, tabs.length),
    tabs,
    files,
    activeFileTab: typeof source.activeFileTab === "string" ? source.activeFileTab : null,
  };
}

function validateArchiveEntry(raw: unknown): ArchiveEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (typeof source.savedAt !== "number" || !Number.isFinite(source.savedAt)) {
    return null;
  }
  if (!Array.isArray(source.tabs)) {
    return null;
  }
  const tabs = source.tabs
    .slice(0, MAX_JOURNAL_TABS)
    .map(validateSessionTab)
    .filter((tab): tab is SessionTab => tab !== null);
  return { savedAt: source.savedAt, tabs };
}

/** Invalid envelope → empty archive; invalid entries are dropped one by one.
 *  Over the cap, keeps the newest entries by validated `savedAt` — consistent
 *  with `pushArchiveEntry`'s drop-oldest-savedAt, rather than a first-N slice
 *  in raw key order (which would discard the newest entries, since writes
 *  append last). */
export function validateArchive(raw: unknown): Readonly<Record<string, ArchiveEntry>> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const source = raw as Record<string, unknown>;
  const validated: [string, ArchiveEntry][] = [];
  for (const [key, value] of Object.entries(source)) {
    const entry = validateArchiveEntry(value);
    if (entry !== null) {
      validated.push([key, entry]);
    }
  }
  const newest = validated
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ARCHIVE_WORKSPACES);
  return Object.fromEntries(newest);
}

/** New archive with `entry` set and the oldest entries dropped past the cap. */
export function pushArchiveEntry(
  archive: Readonly<Record<string, ArchiveEntry>>,
  workspacePath: string,
  entry: ArchiveEntry,
): Readonly<Record<string, ArchiveEntry>> {
  const next: Readonly<Record<string, ArchiveEntry>> = {
    ...archive,
    [workspacePath]: entry,
  };
  const overflow = Object.keys(next).length - MAX_ARCHIVE_WORKSPACES;
  if (overflow <= 0) {
    return next;
  }
  const oldestFirst = Object.entries(next).sort(([, a], [, b]) => a.savedAt - b.savedAt);
  const drop = new Set(oldestFirst.slice(0, overflow).map(([key]) => key));
  return Object.fromEntries(Object.entries(next).filter(([key]) => !drop.has(key)));
}
