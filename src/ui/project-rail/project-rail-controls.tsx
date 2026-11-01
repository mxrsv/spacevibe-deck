import { MagnifyingGlass } from "@phosphor-icons/react";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { Input } from "../controls/input";
import { Popover, PopoverContent, PopoverTrigger } from "../controls/popover";
import { railRepositories, focusedCheckout } from "../rail-create";
import { ProjectRailCreate, type ProjectRailCreateProps } from "./project-rail-create";
import { RailPopupGuard } from "./project-rail-menu-parts";
import { ProjectRailOrganize } from "./project-rail-organize";
import { railViewState, setRailQuery } from "./project-rail-state";
import { ProjectRailWorktreeForm } from "./project-rail-worktree-form";

const SEARCH = "input[data-rail-search]";

/** Hand the keyboard to the list: the row Tab reaches, else the first project header. */
function focusList(from: Element): void {
  const rail = from.closest("nav");
  const target =
    rail?.querySelector<HTMLElement>('[data-rail-row][tabindex="0"]') ??
    rail?.querySelector<HTMLElement>("[data-rail-project]");
  target?.focus();
}

/**
 * `/` focuses the search field from anywhere in the rail (LAY-3). Mounted on the rail's own
 * root, never on the window: a bare key belongs to the terminal everywhere else, and a key
 * typed into a field belongs to that field.
 */
export function onProjectRailKeyDown(event: KeyboardEvent): void {
  const { target, currentTarget } = event;
  if (
    event.key !== "/" ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    !(currentTarget instanceof HTMLElement)
  ) {
    return;
  }
  const field = currentTarget.querySelector<HTMLInputElement>(SEARCH);
  if (field !== null) {
    event.preventDefault();
    field.focus();
  }
}

export interface ProjectRailControlsProps extends Omit<
  ProjectRailCreateProps,
  "onNotice" | "onNewWorktree" | "plusRef"
> {
  /** The "N need you" pill: it takes room beside the search field, never a row of its own. */
  readonly attention?: ComponentChildren;
}

/** The strip above the list (LAY-3): search, the pill, Organize and "+". It replaces the create row. */
export function ProjectRailControls({ attention, ...props }: ProjectRailControlsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const branchRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  // The same targets the shipped form takes: the focused checkout's repository, else the first.
  const repositories = railRepositories(props.stream);
  const focused = focusedCheckout(props.stream);
  const initialRepo =
    focused?.group.labelled === true
      ? focused.group.repositoryPath
      : (repositories[0]?.path ?? null);
  return (
    <div className="ui-preset relative shrink-0 bg-transparent pb-1">
      {/* The form hangs under the whole strip, so a trigger that is only the strip's outline stands in. */}
      <Popover open={formOpen} onOpenChange={setFormOpen}>
        <PopoverTrigger
          nativeButton={false}
          tabIndex={-1}
          render={<span aria-hidden="true" className="pointer-events-none absolute inset-0" />}
        />
        <PopoverContent
          align="start"
          className="w-(--anchor-width)"
          initialFocus={branchRef}
          finalFocus={plusRef}
        >
          <RailPopupGuard />
          <ProjectRailWorktreeForm
            repositories={repositories}
            initialRepo={initialRepo}
            branchRef={branchRef}
            onClose={() => setFormOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <DeckIcon
            icon={MagnifyingGlass}
            size={CHROME_ICON}
            class="pointer-events-none absolute top-2 left-2 size-3 text-muted-foreground"
          />
          <Input
            data-rail-search=""
            aria-label="Search sessions"
            placeholder="Search"
            className="pl-6"
            value={railViewState.value.query}
            onInput={(event: Event) => setRailQuery((event.target as HTMLInputElement).value)}
            onKeyDown={(event: KeyboardEvent) => {
              const field = event.currentTarget as HTMLElement;
              if (event.key === "Escape") {
                // The field's own: it must not reach the terminal or a global handler.
                event.stopPropagation();
                setRailQuery("");
                // After the list has redrawn: a cleared search can bring folded projects back.
                queueMicrotask(() => focusList(field));
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                focusList(field);
              }
            }}
          />
        </div>
        {attention}
        <ProjectRailOrganize />
        <ProjectRailCreate
          {...props}
          onNotice={setNotice}
          onNewWorktree={() => setFormOpen(true)}
          plusRef={plusRef}
        />
      </div>
      {notice === null ? null : (
        <p role="alert" className="px-2 pt-1 text-xs text-destructive">
          {notice}
        </p>
      )}
    </div>
  );
}
