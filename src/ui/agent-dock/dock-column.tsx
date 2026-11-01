import type { ComponentChildren } from "preact";
import type { RailSelection } from "../project-rail/project-rail-model";
import type { RailItem } from "../rail-view-model";
import { DockAsk } from "./dock-ask";
import { DockHeader } from "./dock-header";
import { DockSection } from "./dock-section";
import { DockSpace } from "./dock-space";

/**
 * What the sections show. `App` picks the bodies, as it does for the legacy column, so the host
 * (`dock-column`, `dock-section`, `dock-edge`) imports no body: not the Explorer, Usage, History
 * or the Changes section. `dock-changes` sits in this directory only because Tailwind scans it.
 */
/**
 * The Changes section is three parts because the window width splits them: the section lives in the
 * column or the sheet, the watch and the open diff outlive the sheet, and the handle shows a count.
 */
export interface DockChangesBodies {
  /** Holds the checkout's watch and the open diff for as long as the dock is mounted. */
  readonly watch: (root: string | null) => ComponentChildren;
  /** The section itself, header included: its count is its own state. */
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
  /** Null where the host cannot list sessions, so the section is left out. */
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
  /** The focused agent's space-mates, for "In this space". */
  readonly space: readonly RailItem[];
  /** How an Ask or space row takes the keyboard to an agent's pane: the rail's own focus path. */
  readonly selection: RailSelection;
  /** The folder the sections show (`dock-root.ts`). */
  readonly root: string | null;
  readonly cwd: string | null;
  readonly bodies: DockBodies;
  readonly closeLabel: string;
  readonly closeChord: string | null;
  readonly onClose: () => void;
}

/**
 * The legacy bodies assume a column that owns the height: the file tree windows its rows against
 * its own scroller. Under one stacked scroll that height is undefined, so each body gets a box.
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
  return (
    <div className="agent-dock__column flex h-full min-h-0 flex-col">
      <DockHeader item={item} closeLabel={closeLabel} closeChord={closeChord} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DockAsk item={item} selection={selection} />
        {bodies.changes === null ? null : bodies.changes.section(root)}
        <DockSpace agents={space} selection={selection} />
        <DockSection id="usage" title="Usage">
          <div className="max-h-96 overflow-y-auto">{bodies.usage({ item, space, cwd })}</div>
        </DockSection>
        <DockSection id="files" title="Files">
          <div className="h-96 min-h-0">{bodies.files(root)}</div>
        </DockSection>
        {bodies.history === null ? null : (
          <DockSection id="history" title="History">
            <div className="max-h-96 overflow-y-auto">{bodies.history({ item, space, cwd })}</div>
          </DockSection>
        )}
      </div>
    </div>
  );
}
