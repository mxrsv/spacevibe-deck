import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewOffIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/cn";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentStateMark } from "../../agent-parts";
import { STATE_LABEL } from "../../layout-fixture";
import {
  initials,
  rollup,
  threadsOf,
  type RailProject,
  type RailState,
} from "./rail-option-c-model";
import { ArchivedRow, REVEAL, ThreadRow } from "./rail-option-c-row";

function ProjectHeader({
  project,
  state,
  open,
  count,
}: {
  readonly project: RailProject;
  readonly state: RailState;
  readonly open: boolean;
  readonly count: number;
}) {
  const menuKey = `project:${project.id}`;
  const list = state.projects.value;
  const at = list.findIndex((item) => item.id === project.id);
  const loud = open
    ? null
    : rollup(state.threads.value.filter((t) => t.projectId === project.id && !t.archived));
  return (
    <div
      className="group/item relative mx-1.5 mt-1"
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        state.menuFor.value = menuKey;
      }}
    >
      <button
        type="button"
        data-project={project.id}
        aria-expanded={open}
        aria-label={`${project.name}, ${count} sessions${loud ? `, ${STATE_LABEL[loud.state]}` : ""}`}
        onClick={() => state.toggleCollapsed(project.id)}
        className="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-3xs font-semibold text-muted-foreground"
        >
          {initials(project.name)}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{project.name}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={10}
          strokeWidth={2.5}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        {open ? null : (
          <span
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground tabular-nums",
              "group-hover/item:invisible group-focus-within/item:invisible group-has-[[data-popup-open]]/item:invisible",
            )}
          >
            {loud ? <AgentStateMark state={loud.state} confidence={loud.confidence} /> : null}
            {count}
          </span>
        )}
      </button>
      <div className={cn("absolute top-1 right-1 flex items-center gap-0.5", REVEAL)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`New agent in ${project.name}`}
                onClick={() => state.addAgent(project.id)}
              />
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>New agent</TooltipContent>
        </Tooltip>
        <DropdownMenu
          open={state.menuFor.value === menuKey}
          onOpenChange={(next: boolean) => {
            if (next) state.menuFor.value = menuKey;
            else if (state.menuFor.value === menuKey) state.menuFor.value = null;
          }}
        >
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={`${project.name} menu`} />}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem disabled={at <= 0} onClick={() => state.move(project.id, -1)}>
              <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} aria-hidden="true" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={at === list.length - 1}
              onClick={() => state.move(project.id, 1)}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} aria-hidden="true" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => state.setHidden(project.id, true)}>
              <HugeiconsIcon icon={ViewOffIcon} strokeWidth={2} aria-hidden="true" />
              Hide
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => state.removeProject(project.id)}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden="true" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** One project: header, then its threads unless it is folded (a search unfolds it). */
export function ProjectSection({
  project,
  state,
  firstTab,
}: {
  readonly project: RailProject;
  readonly state: RailState;
  readonly firstTab: string | null;
}) {
  const searching = state.query.value.trim() !== "";
  const rows = threadsOf(state, project.id);
  if (searching && rows.length === 0) return null;
  const open = searching || !project.collapsed;
  const total = state.threads.value.filter((t) => t.projectId === project.id && !t.archived).length;
  return (
    <section aria-label={project.name}>
      <ProjectHeader project={project} state={state} open={open} count={total} />
      {open ? (
        rows.length === 0 ? (
          <p className="m-0 px-5 py-2 text-xs text-muted-foreground">No sessions</p>
        ) : (
          rows.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              state={state}
              tabStop={firstTab === thread.id}
            />
          ))
        )
      ) : null}
    </section>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: preact.ComponentChildren;
}) {
  return (
    <section className="mt-2 border-t border-sidebar-border pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="mx-1.5 flex h-7 w-[calc(100%-0.75rem)] cursor-default items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={10}
          strokeWidth={2.5}
          aria-hidden="true"
          className={cn("transition-transform", !open && "-rotate-90")}
        />
        {label}
      </button>
      {open ? children : null}
    </section>
  );
}

export function ArchivedSection({ state }: { readonly state: RailState }) {
  const items = state.threads.value.filter((item) => item.archived);
  if (items.length === 0) return null;
  return (
    <Disclosure
      label={`Archived ${items.length}`}
      open={state.archivedOpen.value}
      onToggle={() => (state.archivedOpen.value = !state.archivedOpen.value)}
    >
      {items.map((thread) => (
        <ArchivedRow key={thread.id} thread={thread} state={state} />
      ))}
    </Disclosure>
  );
}

export function HiddenSection({ state }: { readonly state: RailState }) {
  const items = state.projects.value.filter((item) => item.hidden);
  if (items.length === 0) return null;
  return (
    <Disclosure
      label={`Hidden ${items.length}`}
      open={state.hiddenOpen.value}
      onToggle={() => (state.hiddenOpen.value = !state.hiddenOpen.value)}
    >
      {items.map((project) => (
        <div
          key={project.id}
          className="mx-1.5 flex h-7 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent/50"
        >
          <span className="min-w-0 flex-1 truncate">{project.name}</span>
          <Button size="xs" variant="ghost" onClick={() => state.setHidden(project.id, false)}>
            Show
          </Button>
        </div>
      ))}
    </Disclosure>
  );
}
