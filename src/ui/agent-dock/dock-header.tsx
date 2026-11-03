import { ArrowRight01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import type { PaneAgent } from "../../lib/process-info";
import { checkoutLine } from "../agent-rail-card-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
import { Kbd } from "../controls/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../controls/tooltip";
import type { RailItem } from "../rail-view-model";

export interface DockHeaderProps {
  /** The focused agent's row, or null when no agent holds the keyboard. */
  readonly item: RailItem | null;
  /** The close control's name: it hides the column, or only the sheet. */
  readonly closeLabel: string;
  /** The chord the close control's tooltip prints, when it has one. */
  readonly closeChord: string | null;
  readonly onClose: () => void;
}

/** The agent's whole product name: the header has the room `displayAgent`'s one word saves. */
const fullAgentName = (agent: PaneAgent): string =>
  BUILTIN_AGENTS.find((candidate) => candidate.id === agent)?.label ?? agent;

/**
 * The dock's top row (LAY-6): which agent the sections are about, where it stands, and the way out.
 * The row is the legacy header's box (`--frame-h` tall, so its hairline meets the stage strip's, and padded clear
 * of the Windows caption buttons), laid out here.
 */
export function DockHeader({ item, closeLabel, closeChord, onClose }: DockHeaderProps) {
  const entry = item?.entry;
  const tag = item === null ? null : checkoutLine(item.checkout).tag;
  return (
    <header className="dock-panel__header min-w-0 justify-between">
      {item !== null && entry?.kind === "agent" ? (
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentGlyph agent={entry.agent} className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">
              {fullAgentName(entry.agent)}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              {/* A folder git does not know has no branch: its line would repeat the project. */}
              <span className="truncate">
                {tag === "folder" ? item.project : `${item.project} / ${item.branch}`}
              </span>
              {tag === "worktree" ? (
                <>
                  <DeckIcon icon={GitBranchIcon} size={GLYPH_INLINE} class="shrink-0" />
                  <span className="sr-only">worktree</span>
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : (
        <span className="truncate text-xs text-muted-foreground">No agent focused</span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={onClose} />
          }
        >
          <DeckIcon icon={ArrowRight01Icon} />
        </TooltipTrigger>
        <TooltipContent side="left">
          {closeLabel}
          {closeChord === null ? null : <Kbd>{closeChord}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </header>
  );
}
