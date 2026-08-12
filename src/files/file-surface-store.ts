/**
 * The file surface store — BESIDE `TabManager`, never inside it (spec §2.3).
 *
 * `syncViews()` rebuilds `tabViews` from the 2 s process poll, so a PTY-less
 * tab put inside `TabManager` would have to survive a rebuild whose entire
 * input is process information — inside an R4 seam freshly ported to Electron
 * and not yet through its manual pass. A bug there would be indistinguishable
 * from a port bug.
 *
 * The seam is narrow on purpose: this module imports nothing from
 * `tab-manager.ts`, and `tab-manager.ts` imports nothing from here. `TabBar`,
 * `WorkspaceSidebar` and `App` are the only modules that see both.
 *
 * Everything here is **per window, in memory, and gone on restart** (spec §2.2).
 * Deck has no session restore; persisting file tabs would make them the only
 * restored UI state in the app. Only the panel's width and default-open state
 * persist, and those are ordinary settings.
 */
import { signal } from "@preact/signals";
import type { ChangeAction } from "./external-change";
import type { DirEntry, Listings } from "./file-tree";
import { flattenTree, openDirectories, toggleExpanded, type TreeRow } from "./file-tree";
import type { FileContent } from "./file-content";
import {
  activeAfterFileClose,
  closeFileTab,
  openKept,
  openPreview,
  promoteTab,
  type FileTabEntry,
} from "./preview-slot";

/** Everything one workspace's explorer remembers. */
export interface FileSurfaceState {
  readonly expanded: ReadonlySet<string>;
  readonly showHidden: boolean;
  /** Restored when the user comes back to this workspace's tree. */
  readonly scrollTop: number;
  readonly listings: Listings;
  readonly tabs: readonly FileTabEntry[];
  /** Which file tab this workspace shows when its file surface is active. */
  readonly activePath: string | null;
}

export const EMPTY_SURFACE: FileSurfaceState = Object.freeze({
  expanded: new Set<string>(),
  showHidden: false,
  scrollTop: 0,
  listings: new Map<string, readonly DirEntry[]>(),
  tabs: [],
  activePath: null,
});

/** One open file's live state. Keyed by absolute path, window-wide. */
export interface FileDocument {
  readonly workspacePath: string;
  readonly path: string;
  /** What was read from disk; null while the read is in flight. */
  readonly file: FileContent | null;
  /** Live editor text. Equals `file.content` exactly while clean. */
  readonly text: string;
  readonly dirty: boolean;
  /** Deleted on disk — content stays on screen, read-only (spec §5). */
  readonly gone: boolean;
  /** Set when the file could not be opened at all (binary, unreadable). */
  readonly refusal: string | null;
  /** Which external-change bar is up, if any. */
  readonly prompt: ChangeAction["kind"] | null;
  readonly mtimeMs: number | null;
  readonly size: number | null;
  /** 1-based caret position for the status bar. */
  readonly line: number;
  readonly column: number;
}

export function emptyDocument(
  workspacePath: string,
  path: string,
): FileDocument {
  return {
    workspacePath,
    path,
    file: null,
    text: "",
    dirty: false,
    gone: false,
    refusal: null,
    prompt: null,
    mtimeMs: null,
    size: null,
    line: 1,
    column: 1,
  };
}

/** Explorer state per workspace. A workspace with no entry has never been shown. */
export const fileSurfaces = signal<ReadonlyMap<string, FileSurfaceState>>(
  new Map(),
);

/** Open documents, keyed by absolute path. */
export const fileDocuments = signal<ReadonlyMap<string, FileDocument>>(new Map());

/**
 * The workspace the panel and the strip's file segment belong to.
 *
 * Written by `App` on every surface change: a terminal tab's `workspacePath`
 * when one is selected, a file tab's when one is activated. It deliberately
 * SURVIVES the last terminal tab of that workspace closing, which is what keeps
 * that workspace's file tabs reachable — the "last surface, not last tab" rule
 * (plan T21) has nothing to point at otherwise.
 *
 * Null yields the empty-panel state and NEVER a `$HOME` fallback: a tree rooted
 * at the home directory is not a mistake the user would notice before scrolling
 * it (spec §2.1).
 */
export const activeWorkspace = signal<string | null>(null);

/**
 * The file tab currently on top of the stage, or null when a terminal tab is.
 *
 * Held as a path rather than an index because file tabs open and close
 * constantly and an index would go stale between a render and a click — the
 * same reason `TabPopover` anchors by tab key.
 */
export const activeFileTab = signal<string | null>(null);

export function surfaceFor(workspacePath: string | null): FileSurfaceState {
  if (workspacePath === null) {
    return EMPTY_SURFACE;
  }
  return fileSurfaces.value.get(workspacePath) ?? EMPTY_SURFACE;
}

function writeSurface(
  workspacePath: string,
  patch: Partial<FileSurfaceState>,
): void {
  const next = new Map(fileSurfaces.value);
  next.set(workspacePath, { ...surfaceFor(workspacePath), ...patch });
  fileSurfaces.value = next;
}

export function setShowHidden(workspacePath: string, showHidden: boolean): void {
  writeSurface(workspacePath, { showHidden });
}

export function setScrollTop(workspacePath: string, scrollTop: number): void {
  writeSurface(workspacePath, { scrollTop });
}

export function setListing(
  workspacePath: string,
  directory: string,
  entries: readonly DirEntry[],
): void {
  const listings = new Map(surfaceFor(workspacePath).listings);
  listings.set(directory, entries);
  writeSurface(workspacePath, { listings });
}

/** Expand or collapse one directory. Collapsing keeps its listing cached —
 * re-expanding is then instant, and the watch scope is recomputed from the
 * visible rows, so a collapsed directory still cannot leak a watcher. */
export function toggleDirectory(workspacePath: string, directory: string): void {
  writeSurface(workspacePath, {
    expanded: toggleExpanded(surfaceFor(workspacePath).expanded, directory),
  });
}

export function expandDirectory(workspacePath: string, directory: string): void {
  const surface = surfaceFor(workspacePath);
  if (surface.expanded.has(directory)) {
    return;
  }
  writeSurface(workspacePath, {
    expanded: new Set([...surface.expanded, directory]),
  });
}

export function collapseDirectory(
  workspacePath: string,
  directory: string,
): void {
  const surface = surfaceFor(workspacePath);
  if (!surface.expanded.has(directory)) {
    return;
  }
  const expanded = new Set(surface.expanded);
  expanded.delete(directory);
  writeSurface(workspacePath, { expanded });
}

/** Rows the tree renders right now, for `workspacePath`'s root. */
export function treeRows(workspacePath: string | null): TreeRow[] {
  if (workspacePath === null) {
    return [];
  }
  const surface = surfaceFor(workspacePath);
  return flattenTree(
    workspacePath,
    surface.listings,
    surface.expanded,
    surface.showHidden,
  );
}

/** Directories whose contents are on screen — the listing and watch scope. */
export function visibleDirectories(workspacePath: string | null): string[] {
  if (workspacePath === null) {
    return [];
  }
  return openDirectories(treeRows(workspacePath), workspacePath);
}

export function fileTabsFor(
  workspacePath: string | null,
): readonly FileTabEntry[] {
  return surfaceFor(workspacePath).tabs;
}

export function documentFor(path: string | null): FileDocument | undefined {
  return path === null ? undefined : fileDocuments.value.get(path);
}

export function updateDocument(
  path: string,
  patch: Partial<FileDocument>,
): void {
  const current = fileDocuments.value.get(path);
  if (current === undefined) {
    return;
  }
  const next = new Map(fileDocuments.value);
  next.set(path, { ...current, ...patch });
  fileDocuments.value = next;
}

/** Absolute paths of every unsaved document in this window. */
export function dirtyPaths(): string[] {
  return [...fileDocuments.value.values()]
    .filter((document) => document.dirty)
    .map((document) => document.path);
}

function dirtySet(): ReadonlySet<string> {
  return new Set(dirtyPaths());
}

/**
 * Open a file as the workspace's preview tab (single click) or as a kept tab
 * (double click), activate it, and make its workspace the active one.
 *
 * Returns true when the document is new and its content still has to be read.
 */
export function openFileTab(
  workspacePath: string,
  path: string,
  options: { readonly keep: boolean },
): boolean {
  const surface = surfaceFor(workspacePath);
  const tabs = options.keep
    ? openKept(surface.tabs, path, dirtySet())
    : openPreview(surface.tabs, path, dirtySet());
  writeSurface(workspacePath, { tabs, activePath: path });
  activeWorkspace.value = workspacePath;
  activeFileTab.value = path;
  if (fileDocuments.value.has(path)) {
    return false;
  }
  const documents = new Map(fileDocuments.value);
  documents.set(path, emptyDocument(workspacePath, path));
  fileDocuments.value = documents;
  return true;
}

/** The first edit promotes a preview tab (spec §4.1) — so replacing a preview
 * can never discard unsaved work. */
export function promoteFileTab(workspacePath: string, path: string): void {
  const surface = surfaceFor(workspacePath);
  const tabs = promoteTab(surface.tabs, path);
  if (tabs.every((tab, index) => tab === surface.tabs[index])) {
    return;
  }
  writeSurface(workspacePath, { tabs });
}

export function activateFileTab(workspacePath: string, path: string): void {
  writeSurface(workspacePath, { activePath: path });
  activeWorkspace.value = workspacePath;
  activeFileTab.value = path;
}

/** A terminal tab took the stage — the file surface steps back but keeps its
 * tabs, so returning to it lands on the same file. */
export function activateTerminalSurface(): void {
  activeFileTab.value = null;
}

/**
 * Point the panel and the strip's file segment at a workspace.
 *
 * Called by `App` when a terminal tab takes the stage, INCLUDING with `null`
 * for a tab that has no workspace — that tab gets the empty panel that says
 * why, never a `$HOME` fallback (spec §2.1).
 *
 * Deliberately NOT called when the window runs out of terminal tabs: the last
 * workspace has to survive, or the file tabs the "last surface" rule protects
 * would have nowhere to be listed.
 */
export function setActiveWorkspace(workspacePath: string | null): void {
  activeWorkspace.value = workspacePath;
}

/**
 * Close one file tab. The dirty guard is the caller's — this is the unguarded
 * dispose, matching `disposeTab`'s split on the terminal side.
 */
export function closeFileSurface(workspacePath: string, path: string): void {
  const surface = surfaceFor(workspacePath);
  const nextActive = activeAfterFileClose(surface.tabs, path, surface.activePath);
  writeSurface(workspacePath, {
    tabs: closeFileTab(surface.tabs, path),
    activePath: nextActive,
  });
  const documents = new Map(fileDocuments.value);
  documents.delete(path);
  fileDocuments.value = documents;
  if (activeFileTab.value === path) {
    activeFileTab.value = nextActive;
  }
}

/** File tabs in the strip right now: the active workspace's, in order. */
export function stripFileTabs(): readonly FileTabEntry[] {
  return fileTabsFor(activeWorkspace.value);
}

/** Index of the active file tab within the strip's file segment; -1 when a
 * terminal tab holds the stage. */
export function activeStripIndex(): number {
  const path = activeFileTab.value;
  if (path === null) {
    return -1;
  }
  return stripFileTabs().findIndex((tab) => tab.path === path);
}

/** Every file tab in this window, across every workspace — the count the
 * "last surface" rule (plan T21) asks about. */
export function totalFileTabs(): number {
  let total = 0;
  for (const surface of fileSurfaces.value.values()) {
    total += surface.tabs.length;
  }
  return total;
}

/** What the status bar shows instead of a pane's CWD and pane count. */
export interface FileStatus {
  /** Path relative to the workspace root (spec §7). */
  readonly relativePath: string;
  /** `line:column`, 1-based. */
  readonly position: string;
  readonly encoding: string;
  readonly eol: string;
}

/** Relative form of `path` under `root`, falling back to the absolute path. */
export function relativeToWorkspace(root: string | null, path: string): string {
  if (root === null) {
    return path;
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Status for the active file surface, or null when a terminal tab holds the
 * stage.
 *
 * A function rather than a signal so it stays derived: two sources of truth for
 * "which file is showing" is exactly how a status bar starts lying. Reading it
 * inside a component subscribes to the signals it touches, as usual.
 */
export function currentFileStatus(): FileStatus | null {
  const path = activeFileTab.value;
  if (path === null) {
    return null;
  }
  const document = fileDocuments.value.get(path);
  if (document === undefined) {
    return null;
  }
  return {
    relativePath: relativeToWorkspace(document.workspacePath, path),
    position: `${document.line}:${document.column}`,
    encoding:
      document.file === null
        ? "—"
        : document.file.encoding === "utf-8"
          ? "UTF-8"
          : "UTF-8 (invalid)",
    eol:
      document.file === null ? "—" : document.file.eol === "crlf" ? "CRLF" : "LF",
  };
}

/** Reset everything. Tests only — the store is window-scoped (R5) and a real
 * window discards it by dying. */
export function resetFileSurfaces(): void {
  fileSurfaces.value = new Map();
  fileDocuments.value = new Map();
  activeWorkspace.value = null;
  activeFileTab.value = null;
}
