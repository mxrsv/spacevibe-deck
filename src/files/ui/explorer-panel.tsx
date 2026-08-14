/**
 * The docked file-explorer column (plan Task 2, spec §3).
 *
 * Styling follows DL §19 (docked side panels) — the browser panel's own
 * section, never DL-15 (D4 renumbered docked panels to §19 on 2026-08-14).
 * Structurally this mirrors `BrowserPanel`: an `<aside>` absolutely
 * positioned inside `.stage`, with `.stage--explorer` shrinking
 * `.stage__tabs`'s inset by `--explorer-w` so terminal panes resize around
 * it (DL-19.1) instead of being covered). `App` gates mounting this
 * component on `settings.explorerOpen` and the `toggle-explorer` chord
 * (⌘⇧B / Ctrl+Shift+B) flips it — see `tab-manager.ts`'s `commands` table.
 *
 * Width is DL-19.4: user-set by dragging the seam (the grip below), clamped,
 * and persisted as an ordinary setting. `width`/`onWidthChange` are props
 * rather than reading settings directly, same reasoning as `BrowserPanel`:
 * the live-or-settled computation (`explorerWidthLive.value ?? ...`) stays
 * in one place, `App`, so this component and its tests don't need to know
 * about the settings module at all.
 *
 * The editor lives INSIDE the panel for now. Spec §4.2 puts file tabs in the
 * terminal strip and the document on the stage; wiring that through
 * `TabManager` is a later task (`fileTabViews` in `file-tab-views.ts` is its
 * input). This is the minimum slice that proves the whole path end to end:
 * click a row, get a document, edit it.
 */
import { activeFileTab, explorerWidthLive } from "../file-surface-store";
import type { FileSurfaceController } from "../file-surface-controller";
import { clampExplorerWidth } from "../../settings/settings-schema";
import { FileTreeView } from "./file-tree-view";
import { FileEditor } from "./file-editor";

export interface ExplorerPanelProps {
  readonly controller: FileSurfaceController;
  /** Root of the tree, or null when the active tab has no workspace (spec §2.1). */
  readonly workspacePath: string | null;
  /** Live width — the drag value while resizing, the setting otherwise. */
  readonly width: number;
  /** Committed at the end of a drag, not during it — one settings write. */
  readonly onWidthChange: (width: number) => void;
}

export function ExplorerPanel(props: ExplorerPanelProps) {
  const activePath = activeFileTab.value;

  // DL-19.4: drag the seam to resize, clamped, one settings write on
  // release. Mirrors `BrowserPanel.startResize` exactly — same grip
  // placement (the panel's LEFT/inner edge), same live-signal-during-drag,
  // settle-on-release shape.
  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.width;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // The handle is on the panel's LEFT edge, so dragging left widens it.
      explorerWidthLive.value = clampExplorerWidth(
        startWidth + (startX - moveEvent.clientX),
      );
    };
    const end = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      const dragged = explorerWidthLive.value;
      // Cleared BEFORE the commit: the settings write is async, and leaving
      // the live value up until it lands makes the column jump back to the
      // old width for a frame if the write is slow.
      explorerWidthLive.value = null;
      if (dragged !== null) {
        props.onWidthChange(dragged);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  return (
    <aside class="explorer-panel" aria-label="File explorer">
      <div
        class="explorer-panel__grip"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the file explorer"
      />
      {/* DL-19.3: one hairline header row, the same iconbtn vocabulary as
          the rest of the app. No actions yet — show-hidden lands with a
          later task. */}
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
