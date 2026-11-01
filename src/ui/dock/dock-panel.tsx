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
import { dockWidthLive } from "../../files/file-surface-store";
import type { DockTab } from "../../settings/settings-schema";
import { FEATURE_ICON } from "../controls/deck-icon";
import { DockResizeGrip } from "./dock-resize-grip";
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
      <DockResizeGrip
        width={props.width}
        onWidthChange={props.onWidthChange}
        onClose={props.onClose}
      />
      {/* DL-19.3, amended: the header row is the tab row now. It is still one
          hairline-separated row of the app's own controls — what changed is
          that the controls name the column's occupants instead of titling a
          single one.

          The icon-only tab group and hide control end that row (2026-08-19).
          DL-18.9's arrangement,
          mirrored: while a column is SHOWN its hide control rides the column
          it hides, at that column's outer edge — the sidebar's beside the
          traffic lights, this one at the window's right edge (short of the
          Windows caption buttons' footprint, which `22-caption-overlay.css`
          reserves in this header). Only the
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
