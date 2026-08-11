/**
 * What the strip needs to render one file tab.
 *
 * ONE function, read by BOTH chrome layouts (`TabBar` and `WorkspaceSidebar`).
 * Only one of them mounts at a time, driven by `tabBarPosition`, so anything
 * written twice is something that can half-land — spec §7's last row exists
 * because that is the likeliest way this feature ships broken in one layout.
 */
import {
  activeFileTab,
  documentFor,
  stripFileTabs,
} from "../file-surface-store";

export interface FileTabView {
  /** Absolute path — also the tab's identity in the strip. */
  readonly path: string;
  /** Leaf name, in its real casing (DL-16.4). */
  readonly name: string;
  /** Rendered italic: the replaceable preview slot (spec §4.1). */
  readonly preview: boolean;
  /** Rendered with a dot: unsaved edits. */
  readonly dirty: boolean;
  /** Deleted on disk — the content on screen is the last Deck read. */
  readonly gone: boolean;
  readonly active: boolean;
}

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The strip's file segment: the file tabs of the ACTIVE surface's workspace.
 *
 * The named cost of spec §2.1, and it is real: switching to a terminal tab in a
 * different workspace swaps which file tabs are visible. That is what "one
 * explorer per workspace" means once file tabs are peers in a shared strip.
 */
export function fileTabViews(): FileTabView[] {
  const active = activeFileTab.value;
  return stripFileTabs().map((tab) => {
    const document = documentFor(tab.path);
    return {
      path: tab.path,
      name: baseName(tab.path),
      preview: tab.preview,
      dirty: document?.dirty === true,
      gone: document?.gone === true,
      active: tab.path === active,
    };
  });
}
