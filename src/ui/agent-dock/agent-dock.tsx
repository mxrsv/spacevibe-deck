import { useEffect } from "preact/hooks";
import { shortcutLabel } from "../../lib/shortcut-label";
import type { RailSelection } from "../project-rail/project-rail-model";
import { dockNarrow } from "./agent-dock-layout";
import { dockSheetOpen } from "./agent-dock-state";
import { DockColumn, type DockBodies } from "./dock-column";
import { DockEdge } from "./dock-edge";
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
 * The stacked-section dock (spec LAY-6, LAY-9): a fixed 320px column of collapsible sections, or
 * under 1360px a 32px edge handle that opens the same column as a sheet. It rides the legacy
 * `.dock-panel` box, so the stage inset, the slide-over and the usage page's `inert` cover keep
 * working, and `27-dock-stacked.css` repaints it on the rail's surface.
 */
export function AgentDock({ entered, onClose, bodies, selection }: AgentDockProps) {
  const narrow = dockNarrow.value;
  const { focused: item, space } = useDockAgents();
  const root = dockRoot.value;
  const cwd = focusedCwd.value;
  useRevealDockTab();
  // The browser yields while the sheet is open, so a stale flag would hide it for good.
  useEffect(() => {
    if (!narrow) {
      dockSheetOpen.value = false;
    }
  }, [narrow]);
  useEffect(
    () => () => {
      dockSheetOpen.value = false;
    },
    [],
  );
  return (
    <aside
      className={`dock-panel agent-dock ui-preset${entered ? " is-open" : ""}`}
      aria-label="Agent dock"
    >
      {bodies.changes === null ? null : bodies.changes.watch(root)}
      {narrow ? (
        <DockEdge
          item={item}
          space={space}
          selection={selection}
          root={root}
          cwd={cwd}
          bodies={bodies}
        />
      ) : (
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
      )}
    </aside>
  );
}
