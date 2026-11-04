import { Refresh01Icon, SidebarLeft01Icon } from "@hugeicons/core-free-icons";
import { useRef, useState } from "preact/hooks";
import {
  changesController,
  type ChangesController,
  type ChangesState,
} from "../../files/changes/changes-controller";
import { absolutePath, failureLine, omittedLabel } from "../../files/changes/changes-model";
import type { ChangeEntry } from "../../host/git-changes-host";
import type { DiffSidesPorts } from "../../files/changes/diff-sides";
import type { FileSurfaceController } from "../../files/file-surface-controller";
import { repositoryScans } from "../../repositories/repositories-store";
import { ChangeCounts } from "../blocks/change-counts";
import { Button } from "../controls/button";
import { DeckIcon } from "../controls/deck-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import { dockChangesList, selectDockFile } from "./agent-dock-state";
import { DockChangesStack } from "./dock-changes-stack";
import { DockChangesTree } from "./dock-changes-tree";
import { watchedRoot } from "./dock-changes-watch";

const NOT_A_REPOSITORY = "Not a git repository";

export interface DockChangesProps {
  /** The folder the section shows (`dock-root.ts`), or null when the window has none. */
  readonly root: string | null;
  /** Opens a card's file as a dock tab. */
  readonly controller: FileSurfaceController;
  /** Test seams; the window's own controller and channels otherwise. */
  readonly changes?: ChangesController;
  readonly ports?: DiffSidesPorts;
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
 * The Changes view of the tabbed dock: the checkout's uncommitted changes as a stack of per-file
 * diff cards (DOCK-10), with the folder tree as an optional pane that scrolls to a card. What it
 * reads is held by `DockChangesWatch`.
 */
export function DockChanges({ root, controller, changes: injected, ports }: DockChangesProps) {
  const changes = injected ?? changesController();
  const plain = root !== null && repositoryScans.value.get(root)?.kind === "plain";
  const watched = watchedRoot(root);
  const state = changes.state.value;
  const live = watched !== null && state.root === watched ? state : null;
  return (
    <>
      {root === null ? (
        <Note>This tab has no workspace to show.</Note>
      ) : plain ? (
        <Note>{NOT_A_REPOSITORY}</Note>
      ) : (
        <DockChangesBody
          key={root}
          root={root}
          live={live}
          changes={changes}
          controller={controller}
          ports={ports}
        />
      )}
    </>
  );
}

function DockChangesBody({
  root,
  live,
  changes,
  controller,
  ports,
}: {
  readonly root: string;
  readonly live: ChangesState | null;
  readonly changes: ChangesController;
  readonly controller: FileSurfaceController;
  readonly ports: DiffSidesPorts | undefined;
}) {
  const snapshot = live?.snapshot ?? null;
  const entries = snapshot?.entries ?? [];
  const list = dockChangesList.value;
  const [markedPath, setMarkedPath] = useState<string | null>(null);
  const stack = useRef<HTMLDivElement>(null);
  // A press in the list pane brings that file's card up and marks it; nothing opens.
  const scrollToCard = (path: string): void => {
    setMarkedPath(path);
    [...(stack.current?.querySelectorAll<HTMLElement>("[data-card-path]") ?? [])]
      .find((card) => card.dataset.cardPath === path)
      ?.scrollIntoView({ block: "start" });
  };
  // The file as a dock tab: what pressing a card's name does, and what a row's menu offers.
  const openFile = (entry: ChangeEntry): void => {
    void controller.openFile(root, absolutePath(root, entry.path), true).then(selectDockFile);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {live?.failure ? <Note failure>{failureLine(live.failure)}</Note> : null}
      <div className="flex h-8 items-center gap-2 pr-2 pl-3">
        <span className="text-xs font-medium text-foreground">Uncommitted</span>
        {snapshot !== null && entries.length > 0 ? (
          <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
            {entries.length} {entries.length === 1 ? "file" : "files"}{" "}
            <ChangeCounts added={snapshot.totals.added} removed={snapshot.totals.removed} sans />
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Changed files list"
                aria-pressed={list}
                onClick={() => (dockChangesList.value = !list)}
              />
            }
          >
            <DeckIcon icon={SidebarLeft01Icon} />
          </TooltipTrigger>
          <TooltipContent side="left">Changed files list</TooltipContent>
        </Tooltip>
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
            <DeckIcon icon={Refresh01Icon} />
          </TooltipTrigger>
          <TooltipContent side="left">Refresh changes</TooltipContent>
        </Tooltip>
      </div>
      {snapshot === null && (live === null || live.reading) ? <Note>Reading changes…</Note> : null}
      {snapshot !== null && entries.length === 0 ? (
        <Note>{snapshot.initial ? "No files yet." : "No changes against HEAD."}</Note>
      ) : null}
      {entries.length > 0 ? (
        <div className="flex min-h-0 flex-1">
          {list ? (
            <div className="w-2/5 shrink-0 overflow-y-auto border-r">
              <DockChangesTree
                root={root}
                entries={entries}
                selectedPath={markedPath}
                onOpen={(entry) => scrollToCard(entry.path)}
                onOpenFile={openFile}
              />
            </div>
          ) : null}
          <div ref={stack} className="min-w-0 flex-1 overflow-y-auto">
            <DockChangesStack
              root={root}
              entries={entries}
              initial={snapshot?.initial ?? false}
              controller={controller}
              reads={changes.readCount.value}
              markedPath={markedPath}
              ports={ports}
            />
          </div>
        </div>
      ) : null}
      {snapshot !== null && snapshot.omitted > 0 ? (
        <Note>{omittedLabel(snapshot.omitted)}</Note>
      ) : null}
    </div>
  );
}
