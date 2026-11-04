import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";
import { Chip } from "../blocks/chip";
import { stateClasses } from "../blocks/recipe-classes";
import { DeckIcon, GLYPH_INLINE } from "../controls/deck-icon";
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
    <section aria-label={label} className="mb-(--space-group-sm) flex flex-col gap-(--space-list)">
      {/* raw-control: a whole-row disclosure target, like a project header; no Button variant spans it */}
      <button
        type="button"
        data-rail-section={label}
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex h-(--row-24) w-full items-center gap-(--space-icon-label) rounded-(--radius-control) px-(--space-pad-row) text-xs leading-(--leading-meta) text-(--text-faint)",
          stateClasses(false),
        )}
      >
        <DeckIcon
          icon={ArrowDown01Icon}
          size={GLYPH_INLINE}
          class={cn("shrink-0 transition-transform", !open && "-rotate-90")}
        />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
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
          className="flex h-(--row-24) items-center gap-2 rounded-(--radius-control) px-(--space-pad-row) text-xs text-(--text-faint)"
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          <Chip
            quiet
            aria-label={`Show ${project.name}`}
            onClick={() => setRailProjectHidden(project.key, false)}
          >
            Show
          </Chip>
        </div>
      ))}
    </Disclosure>
  );
}
