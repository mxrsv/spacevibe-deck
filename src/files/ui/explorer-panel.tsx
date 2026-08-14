/**
 * The docked file-explorer column (plan Task 2, spec §3).
 *
 * Styling follows DL §19 (docked side panels) — the browser panel's own
 * section, never DL-15 (D4 renumbered docked panels to §19 on 2026-08-14).
 * Structurally this mirrors `BrowserPanel`: an `<aside>` absolutely
 * positioned inside `.stage`, with `.stage--explorer` shrinking
 * `.stage__tabs`'s inset by `--explorer-w` so terminal panes resize around
 * it (DL-19.1) instead of being covered. Width is a fixed 260px for this
 * slice (spec §3's default) — dragging and the persisted setting arrive with
 * the chord that shows/hides this column.
 *
 * The editor lives INSIDE the panel for now. Spec §4.2 puts file tabs in the
 * terminal strip and the document on the stage; wiring that through
 * `TabManager` is a later task (`fileTabViews` in `file-tab-views.ts` is its
 * input). This is the minimum slice that proves the whole path end to end:
 * click a row, get a document, edit it.
 */
import { activeFileTab } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";
import { FileTreeView } from "./file-tree-view";
import { FileEditor } from "./file-editor";

export interface ExplorerPanelProps {
  readonly controller: FileSurfaceController;
  /** Root of the tree, or null when the active tab has no workspace (spec §2.1). */
  readonly workspacePath: string | null;
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const activePath = activeFileTab.value;

  return (
    <aside class="explorer-panel" aria-label="File explorer">
      {/* DL-19.3: one hairline header row, the same iconbtn vocabulary as
          the rest of the app. No actions yet — show-hidden and the toggle
          chord land with a later task. */}
      <div class="explorer-panel__header">
        <span class="explorer-panel__title">Explorer</span>
      </div>
      <div class="explorer-panel__body">
        {props.workspacePath === null ? (
          <p class="explorer-panel__empty" role="status">
            This tab has no workspace to show.
          </p>
        ) : (
          <FileTreeView
            controller={props.controller}
            workspacePath={props.workspacePath}
          />
        )}
      </div>
      {activePath !== null && (
        <div class="explorer-panel__preview">
          <FileEditor path={activePath} controller={props.controller} />
        </div>
      )}
    </aside>
  );
}
