import { ArrowClockwise } from "@phosphor-icons/react";
import { requestDiffFocus } from "../../files/changes/diff-column-focus";
import {
  changesController,
  type ChangesController,
  type ChangesState,
} from "../../files/changes/changes-controller";
import { failureLine, omittedLabel } from "../../files/changes/changes-model";
import { diffSelection, type DiffSelectionStore } from "../../files/changes/diff-selection";
import { repositoryScans } from "../../repositories/repositories-store";
import { ChangeCounts } from "../blocks/change-counts";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { dockNarrow } from "./agent-dock-layout";
import { closeDockSheetThen } from "./agent-dock-state";
import { DockChangesTree } from "./dock-changes-tree";
import { changedFileCount, watchedRoot } from "./dock-changes-watch";
import { DockSection } from "./dock-section";

const NOT_A_REPOSITORY = "Not a git repository";

export interface DockChangesProps {
  /** The folder the section shows (`dock-root.ts`), or null when the window has none. */
  readonly root: string | null;
  /** Test seams; the window's own controller and selection otherwise. */
  readonly changes?: ChangesController;
  readonly diff?: DiffSelectionStore;
}

const Note = ({ children, failure = false }: { children: string; failure?: boolean }) => (
  <p
    role="status"
    className={
      failure ? "px-3 py-2 text-xs text-(--term-err)" : "px-3 py-2 text-xs text-muted-foreground"
    }
  >
    {children}
  </p>
);

/**
 * The Changes section of the stacked dock: the checkout's uncommitted changes as a folder tree,
 * the count of changed files in its header, and the same one press the legacy list has, which
 * opens that file's diff in the diff column. What it reads is held by `DockChangesWatch`.
 */
export function DockChanges({ root, changes: injected, diff: injectedDiff }: DockChangesProps) {
  const changes = injected ?? changesController();
  const diff = injectedDiff ?? diffSelection();
  const plain = root !== null && repositoryScans.value.get(root)?.kind === "plain";
  const watched = watchedRoot(root);
  const state = changes.state.value;
  const live = watched !== null && state.root === watched ? state : null;
  const count = changedFileCount(root, changes);
  return (
    <DockSection id="changes" title="Changes" count={count === null ? undefined : String(count)}>
      {root === null ? (
        <Note>This tab has no workspace to show.</Note>
      ) : plain ? (
        <Note>{NOT_A_REPOSITORY}</Note>
      ) : (
        <DockChangesBody key={root} root={root} live={live} changes={changes} diff={diff} />
      )}
    </DockSection>
  );
}

function DockChangesBody({
  root,
  live,
  changes,
  diff,
}: {
  readonly root: string;
  readonly live: ChangesState | null;
  readonly changes: ChangesController;
  readonly diff: DiffSelectionStore;
}) {
  const snapshot = live?.snapshot ?? null;
  const open = diff.selection.value;
  const selectedPath = open !== null && open.root === root ? open.path : null;
  const entries = snapshot?.entries ?? [];
  return (
    <div className="flex min-h-0 flex-col pb-1">
      {live?.failure ? <Note failure>{failureLine(live.failure)}</Note> : null}
      <div className="flex h-8 items-center justify-end gap-1.5 pr-2 pl-3">
        {snapshot !== null && entries.length > 0 ? (
          <ChangeCounts added={snapshot.totals.added} removed={snapshot.totals.removed} />
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh changes"
                onClick={() => changes.trigger("refresh")}
              />
            }
          >
            <DeckIcon icon={ArrowClockwise} size={ROW_ICON} />
          </TooltipTrigger>
          <TooltipContent side="left">Refresh changes</TooltipContent>
        </Tooltip>
      </div>
      {snapshot === null && (live === null || live.reading) ? <Note>Reading changes…</Note> : null}
      {snapshot !== null && entries.length === 0 ? (
        <Note>{snapshot.initial ? "No files yet." : "No changes against HEAD."}</Note>
      ) : null}
      {entries.length > 0 ? (
        <DockChangesTree
          entries={entries}
          selectedPath={selectedPath}
          onOpen={(entry) => {
            diff.open(root, entry.path);
            // In a narrow window the diff column sits beside the handle, under the sheet's scrim:
            // the press closes the sheet to show it, and the column takes focus once the sheet has
            // let go of it. The diff outlives the sheet (`DockChangesWatch`).
            if (dockNarrow.value) {
              closeDockSheetThen(requestDiffFocus);
            } else {
              requestDiffFocus();
            }
          }}
        />
      ) : null}
      {snapshot !== null && snapshot.omitted > 0 ? (
        <Note>{omittedLabel(snapshot.omitted)}</Note>
      ) : null}
    </div>
  );
}
