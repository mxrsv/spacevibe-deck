/**
 * Projects open file tabs into tab-strip view models (plan Task 2, spec §4.2).
 *
 * `TabBar` and `WorkspaceSidebar` render terminal tabs from `TabView`
 * (`tabs-store.ts`); this is the file-tab equivalent, kept in its own module
 * rather than folded into that one — the file store stays BESIDE
 * `TabManager`, never inside it (spec §2.3), and this projection is the file
 * side's half of the same seam.
 */
import type { FileSurfaceController } from "./file-surface-controller";
import { documentFor, stripFileTabs } from "./file-surface-store";

/** One file tab, as the strip renders it. */
export interface TabViewModel {
  /** Absolute path — the tab's identity within the strip's file segment. */
  readonly path: string;
  /** Leaf name shown in the tab. */
  readonly name: string;
  /** Unsaved changes — the tab's dot. */
  readonly dirty: boolean;
  /** The one replaceable preview slot, rendered in italic (spec §4.1). */
  readonly preview: boolean;
  /** This tab holds the stage right now. */
  readonly active: boolean;
}

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/** File tabs of the active workspace, in strip order. */
export function fileTabViews(
  controller: FileSurfaceController,
): readonly TabViewModel[] {
  const activeIndex = controller.activeIndex();
  return stripFileTabs().map((tab, index) => ({
    path: tab.path,
    name: baseName(tab.path),
    dirty: documentFor(tab.path)?.dirty ?? false,
    preview: tab.preview,
    active: index === activeIndex,
  }));
}
