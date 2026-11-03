import { useEffect } from "preact/hooks";
import { dockWidthLive } from "../../files/file-surface-store";
import { shortcutLabel } from "../../lib/shortcut-label";
import { settings, updateSettings } from "../../settings/settings-store";
import { DockResizeGrip } from "../dock/dock-resize-grip";
import { dockNarrow, dockStageWidth, dockWideRequested } from "./agent-dock-layout";
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
}

/**
 * The agent dock (spec LAY-9, DOCK-1, DOCK-11): a 320px column of one strip and one body that the
 * grip resizes or drags shut, or under 1360px a 32px edge handle that opens the same column as a
 * 320px sheet. It rides the legacy `.dock-panel` box, so the stage inset, the slide-over and the
 * usage page's `inert` cover keep working, and `27-agent-dock.css` repaints it on the rail's
 * surface.
 */
export function AgentDock({ entered, onClose, bodies }: AgentDockProps) {
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
      className={`dock-panel agent-dock ui-preset${entered ? " is-open" : ""}${dockWidthLive.value === null ? "" : " is-dragging"}`}
      aria-label="Agent dock"
    >
      {narrow ? null : (
        <DockResizeGrip
          width={dockStageWidth(settings.value.dockWidth, dockWidthLive.value)}
          onWidthChange={(width) => {
            // The dragged width is the user's own now, so the strip's maximize lets go.
            dockWideRequested.value = false;
            updateSettings({ dockWidth: width });
          }}
          onClose={onClose}
        />
      )}
      {bodies.changes === null ? null : bodies.changes.watch(root)}
      {narrow ? (
        <DockEdge
          item={item}
          space={space}
          root={root}
          cwd={cwd}
          bodies={bodies}
          onHide={onClose}
        />
      ) : (
        <DockColumn
          item={item}
          space={space}
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
