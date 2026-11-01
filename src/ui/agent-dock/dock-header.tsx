import { SidebarSimple } from "@phosphor-icons/react";
import { displayAgent } from "../agent-rail-card-model";
import { AgentGlyph } from "../controls/agent-glyph";
import { Button } from "../controls/button";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
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

/**
 * The dock's top row (LAY-6): which agent the sections are about, and the way out. The row is the
 * legacy header's box (`--frame-h` tall, so its hairline meets the stage strip's, and padded clear
 * of the Windows caption buttons), laid out here.
 */
export function DockHeader({ item, closeLabel, closeChord, onClose }: DockHeaderProps) {
  const entry = item?.entry;
  return (
    <header className="dock-panel__header min-w-0 justify-between">
      {item !== null && entry?.kind === "agent" ? (
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentGlyph agent={entry.agent} className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-xs font-medium text-foreground">
              {displayAgent(entry.agent)}
            </span>
            <span className="truncate text-2xs text-muted-foreground">{item.title}</span>
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
          <DeckIcon icon={SidebarSimple} size={ROW_ICON} mirrored />
        </TooltipTrigger>
        <TooltipContent side="left">
          {closeLabel}
          {closeChord === null ? null : <Kbd>{closeChord}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </header>
  );
}
