import type { ComponentChildren } from "preact";
import type { TabDotColor } from "../lib/tab-colors";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { TabStrip } from "./tab-strip";

interface TabBarProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  onRenameTab(index: number, name: string | null): void;
  onSetTabColor(index: number, color: TabDotColor | null): void;
  /**
   * The feature toolbar, built once by `App` so this mount and the sidebar
   * frame's mount can never drift apart (one element, both layouts). TabBar
   * places it; it does not know what is in it.
   */
  toolbar: ComponentChildren;
  /** Invoked when a tab's actionable attention mark is clicked. */
  onFocusAttention?(index: number): void;
  /** Passed straight through to `TabStrip`; TabBar never reads it. */
  fileController: FileSurfaceController;
}

/**
 * Top-tab mode's frame (DL-18.3): the traffic-light inset, the tab strip, the
 * spacer and the toolbar on ONE row.
 *
 * The chips themselves live in `TabStrip`, which sidebar mode mounts inside
 * the stage instead (DL-18.6) — this component is only the frame around them.
 */
export function TabBar(props: TabBarProps) {
  return (
    <header class="tabbar" data-tauri-drag-region>
      {/* DL-18: in top-tab mode this row IS the window frame, so it reserves
          the traffic-light inset itself rather than sitting under an empty
          titlebar. Always in the tree; `--frame-lights-w` defaults to the
          macOS footprint and only `.window--windows` zeroes it and hides the
          element outright, so the `"unsupported"` platform fallback (see
          platform.ts) also reserves that width, not just macOS
          (DL-18.5 — nothing is reserved where no OS paints). */}
      <div class="deck-frame__lights" aria-hidden="true" />
      <TabStrip
        onSelectTab={props.onSelectTab}
        onCloseTab={props.onCloseTab}
        onNewTab={props.onNewTab}
        onRenameTab={props.onRenameTab}
        onSetTabColor={props.onSetTabColor}
        onFocusAttention={props.onFocusAttention}
        fileController={props.fileController}
        // Top-tab mode has no rail, so this strip is the only surface that
        // can answer the open-tab-options chord.
        ownsTabOptionsChord
      />
      <div class="tabbar__spacer" data-tauri-drag-region />
      {props.toolbar}
    </header>
  );
}
