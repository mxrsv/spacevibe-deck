import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  BrowserIcon,
  ChartHistogramIcon,
  Clock01Icon,
  Folder01Icon,
  Message01Icon,
  Search01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "preact/hooks";
import { cn } from "@/lib/cn";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Input } from "../../../../ui/controls/input";
import { Chord } from "../../../../ui/blocks/chord";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentStateMark, TrafficLights } from "../../agent-parts";
import { AGENTS } from "../../layout-fixture";
import type { PanelOption } from "../surface-types";
import { CreateMenu } from "./rail-option-c-create";
import { FlatGroups, OrganizeMenu, flatGroups } from "./rail-option-c-organize";
import {
  attentionCount,
  nextAttention,
  threadsOf,
  useRailState,
  type RailState,
} from "./rail-option-c-model";
import { ArchivedSection, HiddenSection, ProjectSection } from "./rail-option-c-views";

const DRAG = "[-webkit-app-region:drag]";
const NO_DRAG = "[-webkit-app-region:no-drag]";

const TOOLS = [
  { label: "Session history", keys: "⌘⇧Y", icon: Clock01Icon },
  { label: "Token usage", keys: "⌘⇧U", icon: ChartHistogramIcon },
  { label: "Explorer", keys: "⌘⇧B", icon: Folder01Icon },
  { label: "Prompts", keys: "⌘⇧P", icon: Message01Icon },
  { label: "Browser", keys: "⌘⇧I", icon: BrowserIcon },
] as const;

/** Jumps to the next session that wants the user, unfolding its project; wraps around. */
function jumpToAttention(state: RailState) {
  const next = nextAttention(state);
  if (!next) return;
  state.expand(next.projectId);
  state.query.value = "";
  state.select(next.id);
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(`[data-thread="${next.id}"]`);
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  });
}

function AttentionPill({ state, chord }: { readonly state: RailState; readonly chord: boolean }) {
  const count = attentionCount(state);
  if (count === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            className={NO_DRAG}
            onClick={() => jumpToAttention(state)}
          />
        }
      >
        <AgentStateMark state="needs-you" />
        {count} need you
      </TooltipTrigger>
      <TooltipContent>
        Next
        {chord ? <Chord keys={["⌘", "⇧", "A"]} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function Footer({
  onTool,
  onSettings,
}: {
  readonly onTool: (label: string) => void;
  readonly onSettings: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-t border-sidebar-border px-2 py-1.5">
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon" aria-label="Settings" onClick={onSettings} />}
        >
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>
          Settings
          <Chord keys={["⌘", ","]} />
        </TooltipContent>
      </Tooltip>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Session history"
                onClick={() => onTool("Session history")}
              />
            }
          >
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>
            Session history
            <Chord keys={["⌘", "⇧", "Y"]} />
          </TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
            Tools
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-52">
            {TOOLS.map((tool) => (
              <DropdownMenuItem key={tool.label} onClick={() => onTool(tool.label)}>
                <HugeiconsIcon icon={tool.icon} strokeWidth={2} aria-hidden="true" />
                {tool.label}
                <DropdownMenuShortcut>{tool.keys}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function rowsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-thread],[data-project]"));
}

export interface RailCProps {
  /** The shell's focused agent: the rail selects it, unfolding its project. */
  readonly focusId?: string;
  /** Called when the user selects a session that exists in the fixture. */
  readonly onFocus?: (id: string) => void;
  /** Footer tools (history, usage, explorer, prompts, browser); the board shows a note. */
  readonly onTool?: (label: string) => void;
  /** Opens Settings; the board shows a note. */
  readonly onSettings?: () => void;
  /** Whether ⌘⇧A cycles attention here; a shell that owns the chord turns it off. */
  readonly ownChord?: boolean;
}

export function RailC({ focusId, onFocus, onTool, onSettings, ownChord = true }: RailCProps) {
  const state = useRailState((id) => {
    if (AGENTS.some((agent) => agent.id === id)) onFocus?.(id);
  });
  const tool = onTool ?? ((label: string) => state.say(`${label} opens`));
  useEffect(() => {
    if (focusId === undefined || state.selectedId.value === focusId) return;
    const thread = state.threads.value.find((item) => item.id === focusId);
    if (thread) state.expand(thread.projectId);
    state.selectedId.value = focusId;
    // Only a change of the shell's focus syncs the rail.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
  const root = useRef<HTMLElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const visible = state.projects.value.filter((item) => !item.hidden);
  const searching = state.query.value.trim() !== "";
  const open = visible.filter((item) => searching || !item.collapsed);
  const byProject = state.grouping.value === "project";
  const flat = byProject ? [] : flatGroups(state);
  const stops = byProject
    ? open.flatMap((item) => threadsOf(state, item.id))
    : flat.flatMap((group) => group.threads);
  const firstTab = (stops.find((t) => t.id === state.selectedId.value) ?? stops[0])?.id ?? null;
  const empty = visible.length === 0 || ((searching || !byProject) && stops.length === 0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!ownChord) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "a") {
        return;
      }
      const active = document.activeElement;
      if (active !== document.body && !root.current?.contains(active)) return;
      event.preventDefault();
      jumpToAttention(state);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toList = () => {
    requestAnimationFrame(focusList);
  };
  const focusList = () => {
    const rows = root.current ? rowsIn(root.current) : [];
    (rows.find((r) => r.dataset.thread === state.selectedId.value) ?? rows[0])?.focus();
  };

  const onListKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-thread],[data-project]")) return;
    const rows = rowsIn(event.currentTarget as HTMLElement);
    const at = rows.indexOf(target);
    const next =
      event.key === "ArrowDown" ? rows[at + 1] : event.key === "ArrowUp" ? rows[at - 1] : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
    if (event.key === "Enter" && target.dataset.thread) state.select(target.dataset.thread);
  };

  return (
    <aside
      ref={root}
      aria-label="Agents"
      onKeyDown={(event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        const typing = target.matches("input,textarea");
        if (event.key === "/" && !typing) {
          event.preventDefault();
          searchBox.current?.querySelector("input")?.focus();
        }
      }}
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground"
    >
      <div className={cn("flex h-10 shrink-0 items-center justify-between px-3", DRAG)}>
        <TrafficLights />
        <AttentionPill state={state} chord={ownChord} />
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1">
        <div ref={searchBox} className="relative min-w-0 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-2 text-muted-foreground"
          />
          <Input
            aria-label="Search sessions"
            placeholder="Search"
            className="pl-6"
            value={state.query.value}
            onInput={(event: Event) =>
              (state.query.value = (event.target as HTMLInputElement).value)
            }
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                state.query.value = "";
                toList();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                toList();
              }
            }}
          />
        </div>
        <OrganizeMenu state={state} />
        <CreateMenu state={state} />
      </div>
      <div className="relative min-h-0 flex-1">
        <nav aria-label="Projects" onKeyDown={onListKey} className="h-full overflow-y-auto pb-3">
          {byProject ? (
            visible.map((project) => (
              <ProjectSection
                key={project.id}
                project={project}
                state={state}
                firstTab={firstTab}
              />
            ))
          ) : (
            <FlatGroups groups={flat} state={state} firstTab={firstTab} />
          )}
          {empty ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
              <p className="m-0">{searching ? "No sessions match" : "Nothing here"}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (searching ? (state.query.value = "") : state.openFolder())}
              >
                {searching ? "Clear search" : "Open folder"}
              </Button>
            </div>
          ) : null}
          <ArchivedSection state={state} />
          <HiddenSection state={state} />
        </nav>
        {state.note.value ? (
          <p
            role="status"
            className="pointer-events-none absolute inset-x-3 bottom-2 m-0 truncate rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {state.note.value}
          </p>
        ) : null}
      </div>
      <Footer onTool={tool} onSettings={onSettings ?? (() => state.say("Settings opens"))} />
    </aside>
  );
}

export const RAIL_C: PanelOption = {
  id: "c",
  label: "Project-first, quiet",
  concept:
    "Projects own the rail and attention never rearranges it: a folded project speaks with its loudest agent, one pill cycles to whoever needs you, and Organize regroups by status or time.",
  area: ["chrome-only"],
  frame: "panel",
  width: 300,
  render: () => <RailC />,
};
