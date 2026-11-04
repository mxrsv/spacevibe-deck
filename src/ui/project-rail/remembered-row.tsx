import { Cancel01Icon, GitBranchIcon, Rotate01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import type { RememberedPane } from "../../lib/session-schema";
import { formatShortAge } from "../agent-rail-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { DeckIcon, GLYPH_INLINE, GLYPH_ROW } from "../controls/deck-icon";
import { REVEAL, Tip } from "./project-rail-menu-parts";
import { ROW_LAYOUT } from "./project-rail-row";
import { railNow } from "./project-rail-state";
import type { RememberedRowModel } from "./remembered-rows";

/** Time since the pane was last seen. Its own component so a clock tick wakes this text only. */
function SavedAge({ savedAt }: { readonly savedAt: number }) {
  return <>{formatShortAge(savedAt, railNow.value)}</>;
}

export interface RememberedRailRowProps {
  readonly row: RememberedRowModel;
  readonly onResume: (pane: RememberedPane) => void;
  readonly onForget: (pane: RememberedPane) => void;
}

/**
 * A remembered agent pane (launcher spec LCH-2): the live row's box with the agent mark muted,
 * the title quieter, and nothing running. Hover or focus gives the age up to a resume mark and
 * lays the forget ✕ over the trailing edge, where a live row's actions sit. Not in the Tab order
 * (the arrow keys walk the list); a press resumes.
 */
export function RememberedRailRow({ row, onResume, onForget }: RememberedRailRowProps) {
  const { pane, title, branch } = row;
  const id = `remembered:${pane.id}`;
  return (
    <div data-rail-item={id} data-remembered className="group/item relative mx-1.5">
      {/* raw-control: a whole-row click target; no Button variant spans a two-line row */}
      <button
        type="button"
        data-rail-row={id}
        tabIndex={-1}
        onClick={() => onResume(pane)}
        className={cn(ROW_LAYOUT, "hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/50")}
      >
        <span className="flex h-5 w-2.5 items-center justify-center">
          <AgentGlyph
            agent={pane.agent}
            className="size-3 shrink-0 opacity-50 grayscale transition-[filter,opacity] group-hover/item:opacity-100 group-hover/item:grayscale-0 group-focus-within/item:opacity-100 group-focus-within/item:grayscale-0"
          />
        </span>
        <span className="truncate text-sm leading-5 text-muted-foreground group-hover/item:text-foreground group-focus-within/item:text-foreground">
          {title}
        </span>
        <span className="col-start-2 flex min-h-5 min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
          {branch === null ? null : (
            <span className="flex min-w-0 shrink items-center gap-1">
              <DeckIcon icon={GitBranchIcon} size={GLYPH_INLINE} class="shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center tabular-nums">
            <span className="group-hover/item:hidden group-focus-within/item:hidden">
              <SavedAge savedAt={pane.savedAt} />
            </span>
            <span
              data-resume-mark
              className="hidden text-foreground group-hover/item:block group-focus-within/item:block"
            >
              <DeckIcon icon={Rotate01Icon} size={GLYPH_ROW} />
            </span>
          </span>
        </span>
        <span className="sr-only">Resume this conversation</span>
      </button>
      <div
        className={cn(
          "absolute top-1 right-1.5 flex items-center gap-0.5 rounded-md bg-sidebar-accent p-0.5",
          REVEAL,
        )}
      >
        <Tip
          label="Forget"
          button={
            <Button
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-label={`Forget ${title}`}
              onClick={() => onForget(pane)}
            />
          }
        >
          <DeckIcon icon={Cancel01Icon} />
        </Tip>
      </div>
    </div>
  );
}
