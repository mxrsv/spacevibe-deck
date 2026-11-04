import { dockWidthLive } from "../../files/file-surface-store";
import { shortcutLabel } from "../../lib/shortcut-label";
import { settings, updateSettings } from "../../settings/settings-store";
import { DockResizeGrip } from "../dock/dock-resize-grip";
import type { RailSelection } from "../project-rail/project-rail-model";
import { dockStageWidth, dockWideRequested } from "./agent-dock-layout";
import { DockColumn, type DockBodies } from "./dock-column";
import { dockRoot, focusedCwd } from "./dock-root";
import { useDockAgents } from "./use-dock-agents";
import { useRevealDockTab } from "./use-reveal-dock-tab";

export interface AgentDockProps {
  /** Whether the column is at rest on screen; `useDockPresence` owns it, as for the legacy dock. */
  readonly entered: boolean;
  /** Hides the dock. `App` routes it into the `toggle-dock` action and its focus guard. */
  readonly onClose: () => void;
  readonly bodies: DockBodies;
  /** The rail's own focus path, for the rows that name another agent's pane. */
  readonly selection: RailSelection;
}

/**
 * The stacked-section dock (spec LAY-6, LAY-9): a 320px column of collapsible sections that the
 * grip resizes or drags shut, at every window width. It rides the legacy
 * `.dock-panel` box, so the stage inset, the slide-over and the usage page's `inert` cover keep
 * working, and `27-dock-stacked.css` repaints it on the rail's surface.
 */
export function AgentDock({ entered, onClose, bodies, selection }: AgentDockProps) {
  const { focused: item, space } = useDockAgents();
  const root = dockRoot.value;
  const cwd = focusedCwd.value;
  useRevealDockTab();
  return (
    <aside
      className={`dock-panel agent-dock ui-preset${entered ? " is-open" : ""}${dockWidthLive.value === null ? "" : " is-dragging"}`}
      aria-label="Agent dock"
    >
      <DockResizeGrip
        width={dockStageWidth(settings.value.dockWidth, dockWidthLive.value)}
        onWidthChange={(width) => {
          // The dragged width is the user's own now, so the strip's maximize lets go.
          dockWideRequested.value = false;
          updateSettings({ dockWidth: width });
        }}
        onClose={onClose}
      />
      {bodies.changes === null ? null : bodies.changes.watch(root)}
      <DockColumn
        item={item}
        space={space}
        selection={selection}
        root={root}
        cwd={cwd}
        bodies={bodies}
        closeLabel="Hide the side panel"
        closeChord={shortcutLabel("toggle-dock")}
        onClose={onClose}
      />
    </aside>
  );
}
