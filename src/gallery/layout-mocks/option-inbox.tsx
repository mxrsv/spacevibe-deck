import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  MoreHorizontalIcon,
  Settings02Icon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { cn } from "@/lib/cn";
import { useEffect } from "preact/hooks";
import { Button } from "../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../ui/controls/dropdown-menu";
import { Chord } from "../../ui/blocks/chord";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/controls/tooltip";
import { AgentDock } from "./agent-dock";
import { AgentLogo, AgentStateMark, TrafficLights } from "./agent-parts";
import {
  AGENT_NAME,
  PROJECTS,
  STATE_LABEL,
  agentById,
  placeOf,
  spaceLabel,
  type MockAgent,
} from "./layout-fixture";
import { MockTerminal } from "./mock-terminal";
import {
  SECTION_LABEL,
  SECTION_ORDER,
  agentsInSection,
  placeLine,
  sectionOf,
  type InboxSectionId,
} from "./option-inbox-model";
import { InboxSwitcher, switcherEntries } from "./option-inbox-switcher";
import type { OptionProps } from "./option-props";

const DRAG = "[-webkit-app-region:drag]";

function IconButton({
  label,
  keys,
  pressed,
  onClick,
  children,
}: {
  readonly label: string;
  readonly keys?: readonly string[];
  readonly pressed?: boolean;
  readonly onClick?: () => void;
  readonly children: preact.ComponentChildren;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(pressed && "bg-muted text-foreground")}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys ? <Chord keys={keys} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function InboxRow({
  agent,
  selected,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly selected: boolean;
  readonly onFocus: () => void;
}) {
  const { project, checkout } = placeOf(agent);
  const idle = agent.state === "idle";
  const asking = agent.state === "needs-you" && agent.ask !== null;
  const title = agent.sentence ?? AGENT_NAME[agent.kind];
  const detail = asking
    ? agent.ask
    : idle
      ? `${STATE_LABEL.idle} · ${project.name}`
      : placeLine(agent);
  return (
    <button
      type="button"
      onClick={onFocus}
      aria-current={selected ? "true" : undefined}
      aria-label={`${AGENT_NAME[agent.kind]}, ${STATE_LABEL[agent.state]}${agent.sentence ? `: ${agent.sentence}` : ""}, ${agent.since}`}
      title={checkout.branch ?? undefined}
      className={cn(
        "relative mx-1.5 grid w-[calc(100%-0.75rem)] cursor-default grid-cols-[10px_16px_minmax(0,1fr)_2rem] gap-x-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-accent ring-1 ring-ring/40 ring-inset" : "hover:bg-accent/50",
      )}
    >
      <span className="flex h-[18px] items-center">
        <AgentStateMark state={agent.state} confidence={agent.confidence} />
      </span>
      <span className="flex h-[18px] items-center">
        <AgentLogo kind={agent.kind} />
      </span>
      <span
        className={cn(
          "line-clamp-2 min-w-0 text-sm leading-[18px] text-foreground",
          selected && "font-medium",
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "text-right text-2xs leading-[18px] tabular-nums",
          selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {agent.since}
      </span>
      <span
        className={cn(
          "col-span-2 col-start-3 mt-0.5 truncate text-2xs leading-4",
          asking || selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {detail}
      </span>
    </button>
  );
}

function SectionHeader({
  section,
  count,
  collapsible,
  open,
  onToggle,
}: {
  readonly section: InboxSectionId;
  readonly count: number;
  readonly collapsible?: boolean;
  readonly open?: boolean;
  readonly onToggle?: () => void;
}) {
  const body = (
    <>
      {collapsible ? (
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          size={12}
          strokeWidth={2}
          aria-hidden="true"
        />
      ) : null}
      <span>{SECTION_LABEL[section]}</span>
      <span className="tabular-nums">{count}</span>
    </>
  );
  const cls = "flex h-6 items-center gap-1.5 text-2xs font-medium text-muted-foreground";
  return collapsible ? (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        cls,
        "mx-1.5 w-[calc(100%-0.75rem)] cursor-default rounded-md px-2.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={cn(cls, "px-4")}>{body}</div>
  );
}

function Pane({
  agent,
  focused,
  onFocus,
}: {
  readonly agent: MockAgent;
  readonly focused: boolean;
  readonly onFocus: () => void;
}) {
  return (
    <section
      aria-label={`${AGENT_NAME[agent.kind]}, ${STATE_LABEL[agent.state]}`}
      tabIndex={0}
      onPointerDown={onFocus}
      onFocus={onFocus}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-3 text-xs">
        <AgentLogo kind={agent.kind} className="size-3.5" />
        <span
          className={cn(
            "shrink-0 font-medium",
            focused ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {AGENT_NAME[agent.kind]}
        </span>
        <AgentStateMark state={agent.state} confidence={agent.confidence} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {agent.sentence ?? STATE_LABEL.idle}
        </span>
      </header>
      <MockTerminal lines={agent.terminal} className="flex-1" />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 transition-colors",
          focused ? "ring-1 ring-ring ring-inset" : "",
        )}
      />
      {focused ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-foreground"
        />
      ) : null}
    </section>
  );
}

export function OptionInbox({
  initialFocus,
  overlay,
  slots,
  dockOpen: dockDefault,
  dock,
}: OptionProps) {
  const focusId = useSignal(initialFocus);
  const projectId = useSignal<string | null>(null);
  const quietOpen = useSignal(sectionOf(agentById(initialFocus)) === "quiet");
  const switcherOpen = useSignal(overlay === "switcher");
  const highlight = useSignal(switcherEntries()[0]?.id ?? initialFocus);
  // The hybrid: the inbox rail plus the agent-scoped dock. `?dock=0` opens without it.
  const ownDock = useSignal(
    dockDefault ?? new URLSearchParams(window.location.search).get("dock") !== "0",
  );
  const dockOpen = dock ?? ownDock;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const entries = switcherEntries();
      const index = entries.findIndex((agent) => agent.id === highlight.value);
      const move = (step: number) => {
        highlight.value = entries[(index + step + entries.length) % entries.length].id;
      };
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (switcherOpen.value) move(1);
        else {
          highlight.value = entries[0].id;
          switcherOpen.value = true;
        }
        return;
      }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        dockOpen.value = !dockOpen.value;
        return;
      }
      if (!switcherOpen.value) return;
      if (event.key === "ArrowDown") move(1);
      else if (event.key === "ArrowUp") move(-1);
      else if (event.key === "Enter") {
        focusId.value = highlight.value;
        switcherOpen.value = false;
      } else if (event.key === "Escape") switcherOpen.value = false;
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // Signals are stable refs; the handler reads their current values.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusAgent = (id: string) => {
    focusId.value = id;
  };
  const focused = agentById(focusId.value);
  const { space, checkout, project } = placeOf(focused);
  const panes = space.paneIds.map(agentById);
  const stage = slots?.stage?.(focused, focusAgent);
  const filterLabel = PROJECTS.find((item) => item.id === projectId.value)?.name ?? "All projects";

  return (
    <div className="relative flex h-full overflow-hidden bg-sidebar text-foreground">
      {slots?.rail ? (
        <div className="flex w-[300px] shrink-0 flex-col bg-sidebar">
          {slots.rail(agentById(focusId.value), focusAgent)}
        </div>
      ) : (
        <aside
          aria-label="Agents"
          className="flex w-[300px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        >
          <div className={cn("flex h-10 shrink-0 items-center px-3", DRAG)}>
            <TrafficLights />
          </div>
          <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className="min-w-0 flex-1 justify-between"
                    aria-label={`Project filter: ${filterLabel}`}
                  />
                }
              >
                <span className="truncate">{filterLabel}</span>
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56">
                <DropdownMenuRadioGroup
                  value={projectId.value ?? "all"}
                  onValueChange={(value: string) => {
                    projectId.value = value === "all" ? null : value;
                  }}
                >
                  <DropdownMenuRadioItem value="all">All projects</DropdownMenuRadioItem>
                  {PROJECTS.map((item) => (
                    <DropdownMenuRadioItem key={item.id} value={item.id}>
                      {item.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton label="New agent" keys={["⌘", "T"]}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
          <nav aria-label="Agent inbox" className="min-h-0 flex-1 overflow-y-auto pb-2">
            {SECTION_ORDER.map((section) => {
              const items = agentsInSection(section, projectId.value);
              if (items.length === 0) return null;
              const quiet = section === "quiet";
              const showRows = !quiet || quietOpen.value;
              return (
                <div key={section} className="pt-2">
                  <SectionHeader
                    section={section}
                    count={items.length}
                    collapsible={quiet}
                    open={quietOpen.value}
                    onToggle={() => {
                      quietOpen.value = !quietOpen.value;
                    }}
                  />
                  {showRows
                    ? items.map((agent) => (
                        <InboxRow
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === focusId.value}
                          onFocus={() => {
                            focusId.value = agent.id;
                          }}
                        />
                      ))
                    : null}
                </div>
              );
            })}
          </nav>
          <div className="flex h-10 shrink-0 items-center border-t border-sidebar-border px-2">
            <IconButton label="Settings" keys={["⌘", ","]}>
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} aria-hidden="true" />
            </IconButton>
            {slots?.footer?.(focused, focusAgent)}
          </div>
        </aside>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs", DRAG)}>
          <nav aria-label="Focused space" className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground">{project.name}</span>
            {checkout.branch ? (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
                <span className="truncate text-muted-foreground">{checkout.branch}</span>
              </>
            ) : null}
            {spaceLabel(space) === project.name ? null : (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
                <span className="shrink-0 font-medium text-foreground">{spaceLabel(space)}</span>
              </>
            )}
          </nav>
          <IconButton
            label={`Dock, ${checkout.changes.length} changed files`}
            keys={["⌘", "⇧", "J"]}
            pressed={dockOpen.value}
            onClick={() => {
              dockOpen.value = !dockOpen.value;
            }}
          >
            <HugeiconsIcon icon={SidebarRightIcon} strokeWidth={2} aria-hidden="true" />
          </IconButton>
          <IconButton label="More">
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </header>
        {stage != null ? (
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden border-l bg-background">
            {stage}
          </div>
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1",
              space.split === "column" ? "flex-col" : "flex-row",
            )}
          >
            {panes.map((agent, index) => (
              <div
                key={agent.id}
                className={cn(
                  "flex min-h-0 min-w-0 flex-1 overflow-hidden bg-(--term-bg)",
                  index > 0 && space.split === "column" ? "border-t" : "border-l",
                )}
              >
                <Pane
                  agent={agent}
                  focused={agent.id === focusId.value}
                  onFocus={() => {
                    focusId.value = agent.id;
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {dockOpen.value ? (
        slots?.dock ? (
          slots.dock(focused, focusAgent)
        ) : (
          <AgentDock agent={focused} onFocus={focusAgent} />
        )
      ) : null}

      {slots?.overlay?.(focused, focusAgent)}

      {switcherOpen.value ? (
        <InboxSwitcher
          highlighted={highlight.value}
          onHighlight={(id) => {
            highlight.value = id;
          }}
          onOpen={(id) => {
            focusId.value = id;
            switcherOpen.value = false;
          }}
          onClose={() => {
            switcherOpen.value = false;
          }}
        />
      ) : null}
    </div>
  );
}
