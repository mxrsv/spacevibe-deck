import {
  ChartHistogramIcon,
  Clock01Icon,
  FileEditIcon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import type { ComponentChildren } from "preact";
import { Button } from "../controls/button";
import { DeckIcon, type DeckGlyph } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import type { RailSelection } from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";
import { DockAsk } from "./dock-ask";
import { DockHeader } from "./dock-header";
import { DOCK_VIEWS, dockView, setDockView, type DockViewId } from "./agent-dock-state";

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

export interface DockBodies {
  /** Null where the host cannot read git changes, so Changes is left out. */
  readonly changes: DockChangesBodies | null;
  /** The file tree and the open document, rooted at `root`, the folder the focused agent stands in. */
  readonly files: (root: string | null) => ComponentChildren;
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

const VIEW_ICON: Readonly<Record<DockViewId, DeckGlyph>> = {
  changes: FileEditIcon,
  usage: ChartHistogramIcon,
  files: Folder01Icon,
  history: Clock01Icon,
};

const VIEW_LABEL: Readonly<Record<DockViewId, string>> = {
  changes: "Changes",
  usage: "Usage",
  files: "Files",
  history: "History",
};

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
  return (
    <div className="agent-dock__column flex h-full min-h-0 flex-col">
      <DockHeader item={item} closeLabel={closeLabel} closeChord={closeChord} onClose={onClose} />
      <DockAsk item={item} selection={selection} />
      <div
        role="toolbar"
        aria-label="Dock views"
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
      >
        {views.map((id) => (
          <Tooltip key={id}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={VIEW_LABEL[id]}
                  aria-pressed={id === view}
                  className={id === view ? "bg-muted text-foreground" : "text-muted-foreground"}
                  onClick={() => setDockView(id)}
                />
              }
            >
              <DeckIcon icon={VIEW_ICON[id]} />
            </TooltipTrigger>
            <TooltipContent side="bottom">{VIEW_LABEL[id]}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "changes" && bodies.changes !== null ? bodies.changes.section(root) : null}
        {view === "usage" ? bodies.usage({ item, space, cwd }) : null}
        {view === "files" ? <div className="h-full min-h-0">{bodies.files(root)}</div> : null}
        {view === "history" && bodies.history !== null
          ? bodies.history({ item, space, cwd })
          : null}
      </div>
    </div>
  );
}
