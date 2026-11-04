import { Refresh01Icon, SidebarLeft01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "preact/hooks";
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
import {
  cardKey,
  dockChangesList,
  pruneDockFoldedCards,
  selectDockFile,
  unfoldDockCard,
} from "./agent-dock-state";
import { DockChangesStack } from "./dock-changes-stack";
import { DockChangesTree } from "./dock-changes-tree";
import { useRoomyBody } from "./dock-file-body";
import { watchedRoot } from "./dock-changes-watch";

const NOT_A_REPOSITORY = "Not a git repository";
/** How long a list press lights the card it brought up (the mock's flash). */
const FLASH_MS = 1400;

interface Flash {
  readonly card: HTMLElement;
  readonly timer: number;
}

/** Clear the lit card: its time is up, another press took over, or the view went away. */
function endFlash(flash: { current: Flash | null }): void {
  if (flash.current !== null) {
    clearTimeout(flash.current.timer);
    flash.current.card.removeAttribute("data-flash");
    flash.current = null;
  }
}

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
  const body = useRef<HTMLDivElement>(null);
  // The list pane needs the room the file tree needs. Below it the toggle is gone, and the user's
  // choice waits for the dock to widen again.
  const roomy = useRoomyBody(body, true);
  const list = roomy && dockChangesList.value;
  const listLabel = list ? "Hide file navigation" : "Show file navigation";
  const stack = useRef<HTMLDivElement>(null);
  const flash = useRef<Flash | null>(null);
  useEffect(() => () => endFlash(flash), []);
  useEffect(() => {
    if (snapshot !== null) {
      pruneDockFoldedCards(
        root,
        snapshot.entries.map((entry) => entry.path),
      );
    }
  }, [root, snapshot]);
  // A press in the list pane unfolds that file's card, brings it to the top and flashes it once;
  // nothing opens and nothing stays marked. The flash is an attribute written here, not state, so
  // the stack does not render again and keeps its scroll.
  const showCard = (path: string): void => {
    const card = [...(stack.current?.querySelectorAll<HTMLElement>("[data-card-path]") ?? [])].find(
      (element) => element.dataset.cardPath === path,
    );
    if (card === undefined) {
      return;
    }
    unfoldDockCard(cardKey(root, path));
    endFlash(flash);
    card.setAttribute("data-flash", "");
    flash.current = { card, timer: window.setTimeout(() => endFlash(flash), FLASH_MS) };
    // After the unfold has rendered, or a folded card near the end could not reach the top.
    requestAnimationFrame(() => card.scrollIntoView({ block: "start" }));
  };
  // The file as a kept dock tab: what a row's menu offers.
  const openFile = (entry: ChangeEntry): void => {
    void controller.openFile(root, absolutePath(root, entry.path), true).then(selectDockFile);
  };
  return (
    <div ref={body} className="flex h-full min-h-0 flex-col">
      {live?.failure ? <Note failure>{failureLine(live.failure)}</Note> : null}
      <div className="flex h-10 items-center gap-2 pr-2 pl-3">
        <span className="text-xs font-medium text-foreground">Uncommitted</span>
        {snapshot !== null && entries.length > 0 ? (
          <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
            {entries.length} {entries.length === 1 ? "file" : "files"}{" "}
            <ChangeCounts added={snapshot.totals.added} removed={snapshot.totals.removed} sans />
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {roomy ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={listLabel}
                  aria-pressed={list}
                  onClick={() => (dockChangesList.value = !list)}
                />
              }
            >
              <DeckIcon icon={SidebarLeft01Icon} />
            </TooltipTrigger>
            <TooltipContent side="left">{listLabel}</TooltipContent>
          </Tooltip>
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
                onOpen={(entry) => showCard(entry.path)}
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
