import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ChartHistogramIcon,
  Clock01Icon,
  FileEditIcon,
  Folder01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { ComponentChildren } from "preact";
import { Button } from "../controls/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible";
import { DeckIcon, type DeckGlyph } from "../controls/deck-icon";
import { dockSectionsOpen, setDockSectionOpen, type DockSectionId } from "./agent-dock-state";

/** The glyph that leads each header, so a folded section is told apart at a glance. */
const SECTION_ICON: Readonly<Record<DockSectionId, DeckGlyph>> = {
  changes: FileEditIcon,
  space: UserGroupIcon,
  usage: ChartHistogramIcon,
  files: Folder01Icon,
  history: Clock01Icon,
};

export interface DockSectionProps {
  readonly id: DockSectionId;
  readonly title: string;
  /** Shown at the right of the header when the section has one. */
  readonly count?: string;
  readonly children: ComponentChildren;
}

/**
 * One fold of the dock's single scroll (LAY-6): a glyph, the name, a count and the fold caret. Its
 * header stays at the top of the scroll while its body is in view; folding unmounts the body, so a folded Usage polls nothing.
 */
export function DockSection({ id, title, count, children }: DockSectionProps) {
  const open = dockSectionsOpen.value[id];
  return (
    <section aria-label={title} className="border-b">
      <Collapsible open={open} onOpenChange={(next) => setDockSectionOpen(id, next)}>
        <h3 className="sticky top-0 z-10 bg-(--sidebar-bg)">
          <CollapsibleTrigger
            render={
              <Button variant="ghost" size="lg" className="w-full justify-start gap-1.5 px-3" />
            }
          >
            <DeckIcon icon={SECTION_ICON[id]} class="text-muted-foreground" />
            <span className="flex-1 text-left text-2xs font-medium text-muted-foreground">
              {title}
            </span>
            {count === undefined ? null : (
              <span className="text-2xs tabular-nums text-foreground">{count}</span>
            )}
            {/* `size-3` opts the caret out of the button's 16px rule: a fold mark, not an action. */}
            <DeckIcon
              icon={open ? ArrowDown01Icon : ArrowRight01Icon}
              class="size-3 text-muted-foreground"
            />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
