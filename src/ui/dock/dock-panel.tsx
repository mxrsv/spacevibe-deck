/**
 * The docked right column (DL §19).
 *
 * It used to be the file explorer's column and nothing else. Since 2026-08-16
 * it is a host: the tab row across its top picks which surface fills the body,
 * and the file tree is one of three tabs rather than the panel itself.
 *
 * Structurally unchanged from what `ExplorerPanel` was — an `<aside>`
 * absolutely positioned inside `.stage`, with `.stage--dock` shrinking the
 * terminal grid's inset by `--dock-w` so panes resize around it (DL-19.1)
 * instead of being covered. The grip and the drag-past-the-floor close moved
 * up here with the column they always belonged to.
 *
 * It knows nothing about what its tabs contain: `App` picks the body and
 * passes it as children, so this module never imports a feature. That is what
 * keeps `src/ui/dock/` free of `src/files`, `src/ui/usage` and
 * `src/ui/sessions` — three imports that would make the host depend on
 * everything it hosts.
 */
import { dockCollapseArmed, dockWidthLive } from "../../files/file-surface-store";
import type { DockTab } from "../../settings/settings-schema";
import { DOCK_DRAG_BOUNDS, resolvePanelDrag } from "../panel-resize";
import { FEATURE_ICON } from "../controls/deck-icon";
import { DockTabs } from "./dock-tabs";
import { DockToggle } from "./dock-toggle";
import type { DockTabDescriptor } from "./dock-tab-registry";
import type { ComponentChildren } from "preact";

export interface DockPanelProps {
  /**
   * Whether the column is at rest on screen (DL §7's slide-over).
   *
   * It stays mounted for one painted frame BEFORE this turns on and for the
   * length of the slide AFTER it turns off — `useDockPresence` owns both — so
   * the panel can animate in and out instead of blinking. Optional, and
   * treated as open when absent: the gallery specimens and this panel's own
   * tests mount it directly to photograph a column, not to watch it arrive.
   */
  readonly entered?: boolean;
  /** Tabs this host can show — already filtered for host support. */
  readonly tabs: readonly DockTabDescriptor[];
  readonly activeTab: DockTab;
  onSelectTab(tab: DockTab): void;
  /** Live width — the drag value while resizing, the setting otherwise. */
  readonly width: number;
  /** Committed at the end of a drag, not during it — one settings write. */
  readonly onWidthChange: (width: number) => void;
  /**
   * Hides the column. The drag pulled past the floor ends here rather than
   * writing `dockOpen`, so `App` can keep routing it through the `toggle-dock`
   * action and its focus guard.
   */
  readonly onClose: () => void;
  /** The active tab's body, chosen by `App`. */
  readonly children: ComponentChildren;
}

export function DockPanel(props: DockPanelProps) {
  // DL-19.4: drag the seam to resize, clamped, one settings write on release.
  // The grip sits on the column's LEFT/inner edge; the width rides a live
  // signal during the drag and settles into settings on release.
  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.width;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // The handle is on the column's LEFT edge, so dragging left widens it.
      // The RAW width goes to `resolvePanelDrag`, not a clamped one: clamping
      // maps every overdrag onto the floor, and "past the floor" is exactly
      // what the collapse gesture is made of (DL-19.4).
      const outcome = resolvePanelDrag(startWidth + (startX - moveEvent.clientX), DOCK_DRAG_BOUNDS);
      dockWidthLive.value = outcome.width;
      dockCollapseArmed.value = outcome.collapsed;
    };
    const end = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      const dragged = dockWidthLive.value;
      const collapse = dockCollapseArmed.value;
      if (collapse) {
        // Closed BEFORE the live signals are cleared, and the order is
        // load-bearing since the drag began painting the column itself
        // (2026-08-19): clearing first would leave one frame where no drag is
        // in flight and `dockOpen` is still true, and the column the user just
        // dragged away would flash back in before the setting landed.
        // `updateSettings` is synchronous, so closing first closes that gap
        // rather than narrowing it.
        // No width write on this path either: the user asked for the column to
        // go away, and persisting the floor as their preferred width would
        // greet them with a 360px column the next time they open it.
        props.onClose();
        dockWidthLive.value = null;
        dockCollapseArmed.value = false;
        return;
      }
      // Cleared BEFORE the commit on the resize path: the settings write is
      // async, and leaving the live value up until it lands makes the column
      // jump back to the old width for a frame if the write is slow.
      dockWidthLive.value = null;
      dockCollapseArmed.value = false;
      if (dragged !== null) {
        props.onWidthChange(dragged);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  return (
    <aside
      // `is-dragging` turns the slide-over OFF for the duration of a resize
      // gesture (2026-08-19). The animation belongs to the toggle and the
      // chord, where the column appears out of nowhere; inside a drag the
      // pointer IS the clock, and an eased 280ms exit reads as the app lagging
      // behind the hand. The navigation sidebar hides instantly mid-drag, and
      // this is how the two match.
      class={`dock-panel ${(props.entered ?? true) ? "is-open" : ""} ${
        dockWidthLive.value === null ? "" : "is-dragging"
      }`}
      aria-label="Side panel"
    >
      <div
        // Lit for the whole gesture, the sidebar seam's reason exactly: the
        // pointer leaves this 9px target almost immediately once the drag is
        // captured (DL-19.4, amended 2026-08-19).
        class={`dock-panel__grip ${dockWidthLive.value === null ? "" : "is-dragging"}`}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
      />
      {/* DL-19.3, amended: the header row is the tab row now. It is still one
          hairline-separated row of the app's own controls — what changed is
          that the controls name the column's occupants instead of titling a
          single one.

          The icon-only tab group and hide control end that row (2026-08-19).
          DL-18.9's arrangement,
          mirrored: while a column is SHOWN its hide control rides the column
          it hides, at that column's outer edge — the sidebar's beside the
          traffic lights, this one against the window's right edge. Only the
          CLOSED half stays on the stage, because a closed column cannot hold
          its own way back out; `App` mounts that one and gates it on the
          panel being gone, so the two never appear together.

          Through `onClose` rather than a settings write, for the reason the
          drag-past-the-floor gesture goes there: `App` routes it into the
          `toggle-dock` action, which owns the focus guard. */}
      <div class="dock-panel__header">
        <DockTabs items={props.tabs} active={props.activeTab} onSelect={props.onSelectTab} />
        {/* DL-14.2, 2026-08-19: the header's controls draw at
            `FEATURE_ICON`, one rung up from chrome. The stage-strip mount of
            this same component keeps `CHROME_ICON`, where it stands beside
            the toolbar's own 13px glyphs. */}
        <DockToggle open size={FEATURE_ICON} onToggle={props.onClose} />
      </div>
      <div class="dock-panel__body">{props.children}</div>
    </aside>
  );
}
