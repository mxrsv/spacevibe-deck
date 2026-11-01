import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { Button } from "../controls/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../controls/collapsible";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { dockSectionsOpen, setDockSectionOpen, type DockSectionId } from "./agent-dock-state";

export interface DockSectionProps {
  readonly id: DockSectionId;
  readonly title: string;
  /** Shown at the right of the header when the section has one. */
  readonly count?: string;
  readonly children: ComponentChildren;
}

/**
 * One fold of the dock's single scroll (LAY-6). Its header stays at the top of the scroll while
 * its body is in view; folding unmounts the body, so a folded Usage polls nothing.
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
            <DeckIcon icon={open ? CaretDown : CaretRight} size={CHROME_ICON} />
            <span className="flex-1 text-left text-2xs font-medium text-muted-foreground">
              {title}
            </span>
            {count === undefined ? null : (
              <span className="text-2xs tabular-nums text-foreground">{count}</span>
            )}
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
