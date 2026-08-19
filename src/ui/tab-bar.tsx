import type { ComponentChildren } from "preact";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { TabStrip } from "./tab-strip";

interface TabBarProps {
  onSelectTab(index: number): void;
  onCloseTab(index: number): void;
  onNewTab(): void;
  /**
   * The feature toolbar, built once by `App` so this mount and the sidebar
   * frame's mount can never drift apart (one element, both layouts). TabBar
   * places it; it does not know what is in it.
   */
  toolbar: ComponentChildren;
  /**
   * Sits between the chips and the toolbar. Top-tab mode has no
   * `.stage__strip`, so the dock's toggle rides here instead — same trailing
   * position on the frame row, same control (DL-18.9's other edge).
   */
  trailing?: ComponentChildren;
  /** Passed straight through to `TabStrip`; TabBar never reads it. */
  fileController: FileSurfaceController;
  /** Passed straight through to `TabStrip`, like `fileController`. */
  onSelectBrowser(): void;
  onCloseBrowser(): void;
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
        fileController={props.fileController}
        onSelectBrowser={props.onSelectBrowser}
        onCloseBrowser={props.onCloseBrowser}
        scopeToActiveRepository={false}
      />
      <div class="tabbar__spacer" data-tauri-drag-region />
      {props.trailing}
      {props.toolbar}
    </header>
  );
}
