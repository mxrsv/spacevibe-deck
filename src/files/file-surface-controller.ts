/**
 * The orchestrator App owns: the file store on one side, the host on the other.
 *
 * It is also the `SurfaceStrip` `TabManager` talks to (spec §2.3) — which is
 * why `TabManager` never learns what a file is. Everything stateful lives in
 * `file-surface-store.ts`; everything decided lives in the pure modules beside
 * it. This file is the wiring, and it is deliberately the only place that knows
 * about both halves.
 */
import { signal } from "@preact/signals";
import type { UnlistenFn } from "../host/bridge";
import type { SurfaceStrip } from "../terminal/tab-manager";
import { FILE_CLOSE_COPY, confirmClose } from "../terminal/close-guard";
import type { Settings } from "../settings/settings-schema";
import {
  decideExternalChange,
  resolutionApplies,
  type ChangeEvent,
  type ChangeResolution,
} from "./external-change";
import {
  activateFileTab,
  activateTerminalSurface,
  activeFileTab,
  activeStripIndex,
  activeWorkspace,
  closeFileSurface,
  documentFor,
  fileDocuments,
  fileSurfaces,
  fileTabsFor,
  openFileTab,
  promoteFileTab,
  setListing,
  stripFileTabs,
  toggleDirectory,
  totalFileTabs,
  updateDocument,
  visibleDirectories,
} from "./file-surface-store";
import { createPushingDirtyRegistry } from "./dirty-registry";
import { defaultFileClient, type FileClient } from "./file-client";

/**
 * Settings the mounted editors should apply.
 *
 * A signal rather than a direct call into Monaco: `TabManager.applySettings`
 * fans out to every terminal manager and then to this, so the editor follows a
 * theme change through the SAME call the terminals do (spec §7). Reading the
 * settings store directly from the editor would work too, and would make that
 * invariant unobservable.
 */
export const editorSettings = signal<Settings | null>(null);

export interface FileSurfaceController extends SurfaceStrip {
  /** Install the change listener and the focus reconcile. */
  init(): Promise<void>;
  /** Open a file from the tree. `keep` is the double-click path. */
  openFile(workspacePath: string, path: string, keep: boolean): Promise<void>;
  /** Bring an already-open file tab to the stage. */
  activateFile(workspacePath: string, path: string): void;
  /** Expand or collapse a directory, loading its listing on demand. */
  toggleDirectory(workspacePath: string, directory: string): void;
  /** Load a directory's listing if it is not cached yet. */
  ensureListing(workspacePath: string, directory: string): Promise<void>;
  /** Editor text changed. Promotes a preview tab on the FIRST edit. */
  setText(path: string, text: string): void;
  setCursor(path: string, line: number, column: number): void;
  /** Save one file. A no-op for a read-only or refused document. */
  savePath(path: string): Promise<void>;
  /** Close one file tab, asking first when it has unsaved changes. */
  closePath(workspacePath: string, path: string): Promise<void>;
  /** Answer the external-change bar. */
  resolve(path: string, resolution: ChangeResolution): Promise<void>;
  /** Re-`stat` open files and reconcile — window focus and tab activation. */
  reconcile(): Promise<void>;
  /** Register the mounted editor's focus function. */
  setEditorFocus(focus: (() => void) | null): void;
  dispose(): void;
}

export interface FileSurfaceDeps {
  readonly client?: FileClient;
  /** Ask before discarding unsaved work. Defaults to the shared close guard. */
  readonly confirmDiscard?: (dirtyFiles: readonly string[]) => Promise<boolean>;
  /** Tell `TabManager` to re-derive its views — the status bar reads them. */
  readonly onSurfacesChanged?: () => void;
}

export function createFileSurfaceController(
  deps: FileSurfaceDeps = {},
): FileSurfaceController {
  const client = deps.client ?? defaultFileClient;
  const confirmDiscard =
    deps.confirmDiscard ??
    ((dirtyFiles) => confirmClose([], undefined, FILE_CLOSE_COPY, dirtyFiles));
  const notify = deps.onSurfacesChanged ?? (() => {});
  // The payload is the COMPLETE set even though the trigger is a delta — a
  // replace is idempotent, so a dropped or duplicated message cannot leave main
  // believing a saved file is still unsaved.
  const dirty = createPushingDirtyRegistry((paths) => {
    void client.setDirtyFiles(paths).catch((error: unknown) => {
      // Losing this push means the quit guard under-reports. It cannot be
      // retried usefully (the next transition sends the whole set again), but
      // it must not be silent.
      console.error("Deck: could not report unsaved files to the host", error);
    });
  });
  let disposed = false;
  let unlistenChange: UnlistenFn | null = null;
  let focusEditor: (() => void) | null = null;
  let onWindowFocus: (() => void) | null = null;

  /** Paths of every open document, across every workspace. */
  function openPaths(): string[] {
    return [...fileDocuments.value.keys()];
  }

  /**
   * Re-arm the watcher for the ACTIVE workspace.
   *
   * One workspace, not all of them: `watch_paths` carries a single root, and a
   * file open in a workspace that is not on screen is reconciled by the
   * focus/activation re-`stat` instead. That is the same fallback `fs.watch`'s
   * missed events already need, so it costs no new machinery.
   */
  function refreshWatch(): void {
    const root = activeWorkspace.value;
    if (root === null) {
      return;
    }
    const files = openPaths().filter(
      (path) => documentFor(path)?.workspacePath === root,
    );
    void client
      .watchPaths(root, visibleDirectories(root), files)
      .catch((error: unknown) => {
        // Losing the watcher degrades to the re-stat reconcile, which is the
        // designed fallback — worth a line, not worth failing the open.
        console.warn("Deck: could not watch the workspace", error);
      });
  }

  async function loadListing(
    workspacePath: string,
    directory: string,
  ): Promise<void> {
    try {
      const entries = await client.listDir(workspacePath, directory);
      if (disposed) {
        return;
      }
      setListing(workspacePath, directory, entries);
      refreshWatch();
    } catch (error: unknown) {
      console.warn(`Deck: could not read ${directory}`, error);
      // An empty listing, not a missing one: the row stays expanded and shows
      // nothing, which reads as "empty" rather than as a frozen spinner.
      setListing(workspacePath, directory, []);
    }
  }

  async function readDocument(
    workspacePath: string,
    path: string,
  ): Promise<void> {
    // What the buffer held when the read was decided on. `decideExternalChange`
    // refuses to auto-reload a DIRTY buffer, but it decides before this await —
    // and the editor stays writable throughout. Without this, typing during a
    // silent reload had the disk content dropped on top of it, with no bar and
    // no dialog: spec §5's "dirty + changed → never auto-decide" bypassed by
    // timing rather than by logic.
    const before = documentFor(path)?.text;
    try {
      const result = await client.readFile(workspacePath, path);
      const live = documentFor(path);
      if (disposed || live === undefined) {
        return;
      }
      if (before !== undefined && live.text !== before && live.dirty) {
        // The user typed while we were reading. Raise the bar this reload was
        // supposed to be a shortcut around, and keep their text.
        updateDocument(path, {
          prompt: result.kind === "refused" ? "prompt-deleted" : "prompt-changed",
          ...(result.kind === "refused" ? { gone: true } : {}),
        });
        notify();
        return;
      }
      if (result.kind === "refused") {
        updateDocument(path, {
          file: null,
          text: "",
          refusal: result.reason,
          dirty: false,
          prompt: null,
        });
        dirty.set(path, false);
        return;
      }
      updateDocument(path, {
        file: {
          content: result.content,
          eol: result.eol,
          encoding: result.encoding,
          bytes: result.bytes,
          mixedEol: result.mixedEol,
          readOnly: result.readOnly,
          reason: result.reason,
        },
        text: result.content,
        dirty: false,
        gone: false,
        refusal: null,
        prompt: null,
        mtimeMs: result.mtimeMs,
        size: result.size,
      });
      dirty.set(path, false);
    } catch (error: unknown) {
      if (disposed || documentFor(path) === undefined) {
        return;
      }
      updateDocument(path, {
        file: null,
        refusal:
          error instanceof Error ? error.message : "Deck could not read this file.",
      });
    } finally {
      notify();
    }
  }

  function applyChange(event: ChangeEvent): void {
    const document = documentFor(event.path);
    if (document === undefined) {
      return;
    }
    const action = decideExternalChange(event, {
      dirty: document.dirty,
      gone: document.gone,
      mtimeMs: document.mtimeMs,
      size: document.size,
      prompting: document.prompt !== null,
    });
    switch (action.kind) {
      case "none":
        return;
      case "reload":
        void readDocument(document.workspacePath, event.path);
        return;
      case "mark-gone":
        updateDocument(event.path, { gone: true });
        notify();
        return;
      case "prompt-changed":
      case "prompt-deleted":
        updateDocument(event.path, {
          prompt: action.kind,
          gone: action.kind === "prompt-deleted",
        });
        notify();
    }
  }

  /** Activate a file surface by index within the strip's file segment. */
  function activateIndex(index: number): void {
    const strip = stripFileTabs();
    const target = strip[index];
    if (target !== undefined) {
      activateFileTab(activeWorkspace.value as string, target.path);
      notify();
      refreshWatch();
      focusEditor?.();
      return;
    }
    // The strip's segment is empty but the window still holds file tabs in
    // another workspace — the case "last tab closes the window" turns into
    // "last surface". Point the panel at a workspace that has something.
    for (const [workspacePath, surface] of fileSurfaces.value) {
      const first = surface.tabs[0];
      if (first !== undefined) {
        activateFileTab(workspacePath, first.path);
        notify();
        refreshWatch();
        focusEditor?.();
        return;
      }
    }
  }

  async function closePath(
    workspacePath: string,
    path: string,
  ): Promise<void> {
    const document = documentFor(path);
    if (document?.dirty === true && !(await confirmDiscard([path]))) {
      return;
    }
    closeFileSurface(workspacePath, path);
    dirty.forget(path);
    notify();
    refreshWatch();
  }

  return {
    async init() {
      unlistenChange = await client.listenFileChanged((event) => {
        applyChange({
          path: event.path,
          kind: event.kind,
          mtimeMs: event.mtimeMs,
          size: event.size,
        });
      });
      // `fs.watch` misses events on every platform for different reasons; the
      // re-`stat` on focus is the designed mitigation (spec §5), not a belt
      // over a working braces.
      onWindowFocus = () => {
        void this.reconcile();
      };
      window.addEventListener("focus", onWindowFocus);
    },

    async openFile(workspacePath, path, keep) {
      const isNew = openFileTab(workspacePath, path, { keep });
      notify();
      refreshWatch();
      if (isNew) {
        await readDocument(workspacePath, path);
      }
      focusEditor?.();
    },

    activateFile(workspacePath, path) {
      activateFileTab(workspacePath, path);
      notify();
      refreshWatch();
      focusEditor?.();
      void this.reconcile();
    },

    toggleDirectory(workspacePath, directory) {
      const wasExpanded = visibleDirectories(workspacePath).includes(directory);
      toggleDirectory(workspacePath, directory);
      if (!wasExpanded) {
        void this.ensureListing(workspacePath, directory);
      }
      refreshWatch();
    },

    async ensureListing(workspacePath, directory) {
      const surface = fileSurfaces.value.get(workspacePath);
      if (surface?.listings.has(directory) === true) {
        return;
      }
      await loadListing(workspacePath, directory);
    },

    setText(path, text) {
      const document = documentFor(path);
      if (document === undefined) {
        return;
      }
      const isDirty = document.file !== null && text !== document.file.content;
      updateDocument(path, { text, dirty: isDirty });
      if (isDirty) {
        // The FIRST edit promotes (spec §4.1) — which is what makes "replacing
        // a preview never discards work" true rather than hopeful.
        promoteFileTab(document.workspacePath, path);
      }
      dirty.set(path, isDirty);
      notify();
    },

    setCursor(path, line, column) {
      updateDocument(path, { line, column });
    },

    async savePath(path) {
      const document = documentFor(path);
      if (
        document === undefined ||
        document.file === null ||
        document.file.readOnly
      ) {
        return;
      }
      const file = document.file;
      // The text that is about to reach disk, captured before the await so the
      // baseline below is what was actually WRITTEN.
      const written = document.text;
      try {
        const result = await client.writeFile(
          document.workspacePath,
          path,
          written,
          file.eol,
        );
        const live = documentFor(path);
        if (disposed || live === undefined) {
          return;
        }
        // Recomputed against the LIVE text, never asserted `false`. A write is
        // a round trip through IPC, `mkdir`, `open`, `rename` and `stat`; the
        // characters typed during it are still unsaved. Asserting clean here
        // cleared the tab's dot AND pushed an empty set to main, so ⌘Q right
        // afterwards quit with no prompt and those characters were gone.
        const stillDirty = live.text !== written;
        updateDocument(path, {
          // The saved text becomes the new baseline, so a later external-change
          // comparison is against what is actually on disk.
          file: { ...file, content: written },
          dirty: stillDirty,
          gone: false,
          prompt: null,
          mtimeMs: result.mtimeMs,
          size: result.size,
        });
        dirty.set(path, stillDirty);
      } catch (error: unknown) {
        console.error("Deck: could not save the file", error);
        // Stays dirty, deliberately: a failed save must keep the guard asking.
        dirty.set(path, "unknown");
      } finally {
        notify();
      }
    },

    closePath,

    async resolve(path, resolution) {
      const document = documentFor(path);
      if (document === undefined || document.prompt === null) {
        return;
      }
      if (!resolutionApplies(document.prompt, resolution)) {
        // The bar changed kind between render and click. Applying the old
        // answer to the new row is how "Keep mine" ends up discarding.
        return;
      }
      switch (resolution) {
        case "reload":
          updateDocument(path, { prompt: null });
          await readDocument(document.workspacePath, path);
          return;
        case "keep-mine": {
          // Adopt the CURRENT on-disk stamp so the same change does not raise
          // the bar again the moment the next event arrives.
          const [stat] = await client.statFiles(document.workspacePath, [path]);
          updateDocument(path, {
            prompt: null,
            mtimeMs: stat?.mtimeMs ?? null,
            size: stat?.size ?? null,
          });
          notify();
          return;
        }
        case "save-again":
          updateDocument(path, { prompt: null });
          await this.savePath(path);
          return;
        case "close":
          updateDocument(path, { prompt: null, dirty: false });
          dirty.forget(path);
          closeFileSurface(document.workspacePath, path);
          notify();
          refreshWatch();
      }
    },

    async reconcile() {
      const byWorkspace = new Map<string, string[]>();
      for (const document of fileDocuments.value.values()) {
        const paths = byWorkspace.get(document.workspacePath) ?? [];
        paths.push(document.path);
        byWorkspace.set(document.workspacePath, paths);
      }
      for (const [workspacePath, paths] of byWorkspace) {
        let stats;
        try {
          stats = await client.statFiles(workspacePath, paths);
        } catch (error: unknown) {
          console.warn("Deck: could not reconcile open files", error);
          continue;
        }
        for (const stat of stats) {
          applyChange({
            path: stat.path,
            kind: stat.exists ? "changed" : "deleted",
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        }
      }
    },

    setEditorFocus(focus) {
      focusEditor = focus;
    },

    // ---- SurfaceStrip: everything `TabManager` is allowed to know ----
    count: () => stripFileTabs().length,
    total: () => totalFileTabs(),
    activeIndex: () => activeStripIndex(),
    activate: activateIndex,
    deactivate() {
      if (activeFileTab.value === null) {
        return;
      }
      activateTerminalSurface();
      notify();
    },
    focus() {
      focusEditor?.();
    },
    async close() {
      const path = activeFileTab.value;
      const workspacePath = activeWorkspace.value;
      if (path === null || workspacePath === null) {
        return;
      }
      // Resolve the owning workspace from the DOCUMENT, not from the active
      // one: closing the last tab of a workspace can move the active workspace
      // out from under this call.
      await closePath(documentFor(path)?.workspacePath ?? workspacePath, path);
    },
    async save() {
      const path = activeFileTab.value;
      if (path === null) {
        return;
      }
      await this.savePath(path);
    },
    applySettings(next) {
      editorSettings.value = next;
    },

    dispose() {
      disposed = true;
      unlistenChange?.();
      unlistenChange = null;
      if (onWindowFocus !== null) {
        window.removeEventListener("focus", onWindowFocus);
        onWindowFocus = null;
      }
      focusEditor = null;
    },
  };
}

/** Whether the strip should show `workspacePath`'s file tabs — used by both
 * chrome layouts so a single-layout change cannot half-land (spec §7). */
export function stripFileTabsFor(
  workspacePath: string | null,
): ReturnType<typeof fileTabsFor> {
  return fileTabsFor(workspacePath);
}
