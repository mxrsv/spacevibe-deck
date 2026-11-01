import { CaretDown } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";
import { Button } from "../controls/button";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import type { RailItem, RailProject } from "../rail-view-model";
import { RailRows, type RailRowEnv } from "./project-rail-sections";
import { hiddenOpen, setRailProjectHidden, showArchived } from "./project-rail-state";

/** A collapsed section at the bottom of the list: a head with its count, and what it holds. */
function Disclosure({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ComponentChildren;
}) {
  return (
    <section aria-label={label} className="mt-2 border-t border-sidebar-border pt-1">
      {/* raw-control: a whole-row disclosure target, like a project header; no Button variant spans it */}
      <button
        type="button"
        data-rail-section={label}
        aria-expanded={open}
        onClick={onToggle}
        className="mx-1.5 flex h-7 w-[calc(100%-0.75rem)] cursor-default items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DeckIcon
          icon={CaretDown}
          size={CHROME_ICON}
          class={cn("size-2.5 shrink-0 transition-transform", !open && "-rotate-90")}
        />
        {label}
        <span className="tabular-nums">{count}</span>
      </button>
      {open ? children : null}
    </section>
  );
}

/**
 * Every archived row, whatever the search says. Organize's "Show archived" is this section's
 * open state, so the head and the menu entry are one switch.
 */
export function ArchivedSection({
  items,
  env,
}: {
  readonly items: readonly RailItem[];
  readonly env: RailRowEnv;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <Disclosure
      label="Archived"
      count={items.length}
      open={showArchived.value}
      onToggle={() => (showArchived.value = !showArchived.value)}
    >
      <RailRows items={items} env={env} named archived />
    </Disclosure>
  );
}

/** Hidden projects, each with a way back. */
export function HiddenSection({ projects }: { readonly projects: readonly RailProject[] }) {
  if (projects.length === 0) {
    return null;
  }
  return (
    <Disclosure
      label="Hidden"
      count={projects.length}
      open={hiddenOpen.value}
      onToggle={() => (hiddenOpen.value = !hiddenOpen.value)}
    >
      {projects.map((project) => (
        <div
          key={project.key}
          data-rail-item={`hidden:${project.key}`}
          className="mx-1.5 flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent/50"
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Show ${project.name}`}
            onClick={() => setRailProjectHidden(project.key, false)}
          >
            Show
          </Button>
        </div>
      ))}
    </Disclosure>
  );
}
