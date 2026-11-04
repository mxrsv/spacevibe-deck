import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { surfaceFor } from "../../files/file-surface-store";
import type { RailSelection } from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";
import { DockAsk } from "./dock-ask";
import {
  DOCK_VIEWS,
  dockSurface,
  dockView,
  type DockSurface,
  type DockViewId,
} from "./agent-dock-state";
import { DOCK_ROW_HEIGHT } from "./dock-row-height";
import { DockTabStrip } from "./dock-tab-strip";

/**
 * What the views show. `App` picks the bodies, as it does for the legacy column, so the host
 * (`dock-column`, `dock-edge`) imports no body: not the Explorer, Usage, History or the Changes
 * view. `dock-changes` sits in this directory only because Tailwind scans it.
 */
/**
 * The Changes view is three parts because the window width splits them: the view lives in the
 * column or the sheet, the watch and the open diff outlive the sheet, and the handle shows a count.
 */
export interface DockChangesBodies {
  /** Holds the checkout's watch and the open diff for as long as the dock is mounted. */
  readonly watch: (root: string | null) => ComponentChildren;
  /** The view itself, without a header: the strip names it. */
  readonly section: (root: string | null) => ComponentChildren;
  /** The changed-file count the handle shows, or null when there is none to show. */
  readonly count: (root: string | null) => number | null;
}

/** The documents: file tabs in the strip, the Explorer tab behind `+`, and the open file's body. */
export interface DockFileBodies {
  /** Opens, activates and closes the file tabs; the strip drives it, the bodies read the store. */
  readonly controller: FileSurfaceController;
  /** The Explorer tab: the project tree at full width, rooted at `root`. */
  readonly explorer: (root: string | null) => ComponentChildren;
  /** The active file: breadcrumb row, editor and tree pane. Only called with a root that has one. */
  readonly document: (root: string) => ComponentChildren;
}

export interface DockBodies {
  /** Null where the host cannot read git changes, so Changes is left out. */
  readonly changes: DockChangesBodies | null;
  readonly files: DockFileBodies;
  /** Usage and History are about the focused agent, so they take who it is and where it stands. */
  readonly usage: (context: DockContext) => ComponentChildren;
  /** Null where the host cannot list sessions, so the view is left out. */
  readonly history: ((context: DockContext) => ComponentChildren) | null;
}

export interface DockContext {
  readonly item: RailItem | null;
  readonly space: readonly RailItem[];
  /** The focused pane's working directory, exactly; null when unknown. */
  readonly cwd: string | null;
}

export interface DockColumnProps {
  readonly item: RailItem | null;
  /** The focused agent's space-mates, for the Usage and History bodies. */
  readonly space: readonly RailItem[];
  /** How the Ask banner takes the keyboard to an agent's pane: the rail's own focus path. */
  readonly selection: RailSelection;
  /** The folder the views show (`dock-root.ts`). */
  readonly root: string | null;
  readonly cwd: string | null;
  readonly bodies: DockBodies;
  readonly closeLabel: string;
  readonly closeChord: string | null;
  readonly onClose: () => void;
}

/**
 * The selected view, or the first available one when the choice has no body here (no git, no
 * sessions). Derived on every render; the stored choice is left alone so it returns with its host.
 */
export function effectiveDockView(selected: DockViewId, bodies: DockBodies): DockViewId {
  const available = DOCK_VIEWS.filter(
    (view) =>
      (view !== "changes" || bodies.changes !== null) &&
      (view !== "history" || bodies.history !== null),
  );
  return available.includes(selected) ? selected : available[0];
}

/**
 * What holds the body: the stored surface, except a file surface with no file to show (the last
 * tab closed, or another folder's agent took focus) gives it back to the fixed view.
 */
export function effectiveDockSurface(root: string | null): DockSurface {
  const surface = dockSurface.value;
  return surface === "file" && surfaceFor(root).activePath === null ? "view" : surface;
}

/**
 * The legacy bodies assume a column that owns the height: the file tree windows its rows against
 * its own scroller. The body is that height (DOCK-2): it scrolls, the column never does, and only
 * the selected view is mounted, so an unselected Usage polls nothing.
 */
export function DockColumn({
  item,
  space,
  selection,
  root,
  cwd,
  bodies,
  closeLabel,
  closeChord,
  onClose,
}: DockColumnProps) {
  const view = effectiveDockView(dockView.value, bodies);
  const views = DOCK_VIEWS.filter((id) => effectiveDockView(id, bodies) === id);
  const surface = effectiveDockSurface(root);
  // Write the settled surface back so the reveal chords and telemetry read what is on screen.
  useEffect(() => {
    if (dockSurface.value !== surface) {
      dockSurface.value = surface;
    }
  }, [surface]);
  return (
    <div
      className="agent-dock__column flex h-full min-h-0 flex-col"
      style={{ "--dock-row-h": `${DOCK_ROW_HEIGHT}px` }}
    >
      <DockTabStrip
        views={views}
        view={view}
        surface={surface}
        root={root}
        controller={bodies.files.controller}
        closeLabel={closeLabel}
        closeChord={closeChord}
        onClose={onClose}
      />
      <DockAsk item={item} selection={selection} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {surface === "file" && root !== null ? (
          <div className="h-full min-h-0">{bodies.files.document(root)}</div>
        ) : null}
        {surface === "explorer" ? (
          <div className="h-full min-h-0">{bodies.files.explorer(root)}</div>
        ) : null}
        {surface === "view" && view === "changes" && bodies.changes !== null
          ? bodies.changes.section(root)
          : null}
        {surface === "view" && view === "usage" ? bodies.usage({ item, space, cwd }) : null}
        {surface === "view" && view === "history" && bodies.history !== null
          ? bodies.history({ item, space, cwd })
          : null}
      </div>
    </div>
  );
}
