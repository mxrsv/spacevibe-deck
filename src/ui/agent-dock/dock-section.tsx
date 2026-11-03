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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible";
import { DeckIcon, GLYPH_INLINE, GLYPH_ROW, type DeckGlyph } from "../controls/deck-icon";
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
 * One fold of the dock's single scroll (LAY-6): the fold caret, a glyph, the name and a count. Its
 * header stays at the top of the scroll while its body is in view; folding unmounts the body, so a
 * folded Usage polls nothing. The trigger is a whole-row target, as a Changes folder row is: the
 * `Button` this used to render fills itself while `aria-expanded`, and every open section is.
 */
export function DockSection({ id, title, count, children }: DockSectionProps) {
  const open = dockSectionsOpen.value[id];
  return (
    <section aria-label={title} className="border-b">
      <Collapsible open={open} onOpenChange={(next) => setDockSectionOpen(id, next)}>
        <h3 className="sticky top-0 z-10 bg-sidebar">
          <CollapsibleTrigger className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <DeckIcon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={GLYPH_INLINE} />
            <DeckIcon icon={SECTION_ICON[id]} size={GLYPH_ROW} />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {count === undefined ? null : (
              <span className="tabular-nums text-foreground">{count}</span>
            )}
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
