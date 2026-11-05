import { Cancel01Icon, GitBranchIcon, Rotate01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import type { RememberedPane } from "../../lib/session-schema";
import { formatShortAge } from "../agent-rail-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { rowActionsGround, stateClasses } from "../blocks/recipe-classes";
import { DeckIcon, GLYPH_FEATURE, GLYPH_INLINE } from "../controls/deck-icon";
import { REVEAL, Tip } from "./project-rail-menu-parts";
import { ROW_LAYOUT, ROW_LOGO, ROW_MAIN, ROW_META, ROW_TITLE } from "./project-rail-row";
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
 * A remembered agent pane (launcher spec LCH-2, RCP-18): the live row's box, quiet, so it follows
 * the live row's layout (SR-1). The logo at half opacity, the title muted, no needs-you tint and
 * no status ink. Hover or focus swaps the age for a resume mark inside the fixed end cell and lays
 * the forget ✕ before it. Not in the Tab order (the arrow keys walk the list); a press resumes.
 */
export function RememberedRailRow({ row, onResume, onForget }: RememberedRailRowProps) {
  const { pane, title, branch } = row;
  const id = `remembered:${pane.id}`;
  return (
    <div data-rail-item={id} data-remembered className="group/item relative">
      {/* raw-control: a whole-row click target; no Button variant spans a two-line row */}
      <button
        type="button"
        data-rail-row={id}
        tabIndex={-1}
        onClick={() => onResume(pane)}
        className={cn(ROW_LAYOUT, stateClasses(false))}
      >
        <span className={ROW_LOGO}>
          {/* Opacity alone dims it: DL-1.3 bans `filter`. */}
          <AgentGlyph
            agent={pane.agent}
            className="size-(--icon-12) shrink-0 opacity-(--state-disabled-opacity)"
          />
        </span>
        <span className={ROW_MAIN}>
          <span className={cn(ROW_TITLE, "text-(--text-muted)")}>{title}</span>
          <span className={ROW_META}>
            {branch === null ? null : (
              <>
                <DeckIcon icon={GitBranchIcon} size={GLYPH_INLINE} class="shrink-0" />
                <span className="min-w-0 truncate">{branch}</span>
              </>
            )}
          </span>
        </span>
        {/* The fixed end cell: the age and the resume mark swap in one grid cell, so nothing
            moves (RCP-18). */}
        <span className="grid w-(--row-end-w) shrink-0 items-center justify-items-end text-(length:--type-rail-meta) leading-(--leading-rail-line) text-(--text-faint)">
          <span className="[grid-area:1/1] group-hover/item:invisible group-focus-within/item:invisible">
            <SavedAge savedAt={pane.savedAt} />
          </span>
          <span
            data-resume-mark
            className="invisible flex text-(--text-primary) [grid-area:1/1] group-hover/item:visible group-focus-within/item:visible"
          >
            {/* Rotate01 turns clockwise; resume reads as going back, so mirror it. */}
            <DeckIcon icon={Rotate01Icon} size={GLYPH_FEATURE} class="-scale-x-100" />
          </span>
        </span>
        <span className="sr-only">Resume this conversation</span>
      </button>
      {/* RCP-19: on a remembered row the actions sit before the age cell. */}
      <div className={cn(rowActionsGround(false), "right-(--row-end-w) rounded-none", REVEAL)}>
        <Tip
          label="Forget"
          button={
            <Button
              variant="ghost"
              size="icon-sm"
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
