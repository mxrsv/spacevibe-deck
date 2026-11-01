import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";
import { useEffect, useState } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../ui/controls/tooltip";
import { AgentStateMark } from "../../agent-parts";
import { AGENT_NAME, STATE_LABEL, type MockAgent } from "../../layout-fixture";
import {
  AgentIdentity,
  AskBlock,
  DockIcon,
  NARROW_BELOW,
  SpaceList,
  ToolBody,
  changeTotals,
  useWindowWidth,
} from "./dock-parts";

const WIDTH = 320;
const EDGE_WIDTH = 32;

type SectionId = "changes" | "space" | "usage" | "files" | "history";

/** Module-level so folding survives focus moving between agents. */
const folded = signal<Readonly<Record<SectionId, boolean>>>({
  changes: false,
  space: false,
  usage: false,
  files: true,
  history: true,
});

function Section({
  id,
  title,
  count,
  children,
}: {
  readonly id: SectionId;
  readonly title: string;
  readonly count?: string;
  readonly children: preact.ComponentChildren;
}) {
  const closed = folded.value[id];
  return (
    <section aria-label={title} className="border-b">
      <h3 className="m-0 sticky top-0 z-10 bg-sidebar">
        <button
          type="button"
          aria-expanded={!closed}
          onClick={() => {
            folded.value = { ...folded.value, [id]: !closed };
          }}
          className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-2xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <DockIcon name={closed ? "right" : "down"} size={11} />
          <span className="flex-1">{title}</span>
          {count ? <span className="tabular-nums text-foreground">{count}</span> : null}
        </button>
      </h3>
      {closed ? null : children}
    </section>
  );
}

/** `changes` replaces the Changes section's body, for the hybrid that composes the picks. */
interface DockProps {
  readonly agent: MockAgent;
  readonly onFocus: (id: string) => void;
  readonly changes?: ComponentChildren;
}

function Sections({ agent, onFocus, changes }: DockProps) {
  const sum = changeTotals(agent);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {agent.state === "needs-you" ? (
        <div className="border-b">
          <AskBlock agent={agent} onFocus={onFocus} />
        </div>
      ) : null}
      <Section id="changes" title="Changes" count={sum.files ? String(sum.files) : undefined}>
        {changes ?? <ToolBody tool="changes" agent={agent} onFocus={onFocus} />}
      </Section>
      <Section id="space" title="In this space">
        <SpaceList agent={agent} onFocus={onFocus} />
      </Section>
      <Section id="usage" title="Usage">
        <ToolBody tool="usage" agent={agent} onFocus={onFocus} />
      </Section>
      <Section id="files" title="Files">
        <ToolBody tool="files" agent={agent} onFocus={onFocus} />
      </Section>
      <Section id="history" title="History">
        <ToolBody tool="history" agent={agent} onFocus={onFocus} />
      </Section>
    </div>
  );
}

function Column({
  agent,
  onFocus,
  changes,
  className,
  onClose,
}: DockProps & {
  readonly className?: string;
  readonly onClose?: () => void;
}) {
  return (
    <aside
      aria-label={`${AGENT_NAME[agent.kind]} dock`}
      style={{ width: WIDTH }}
      className={cn("flex shrink-0 flex-col border-l bg-sidebar", className)}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <AgentIdentity agent={agent} />
        {onClose ? (
          <Button variant="ghost" size="icon-sm" aria-label="Close dock" onClick={onClose}>
            <DockIcon name="right" size={14} />
          </Button>
        ) : null}
      </header>
      <Sections agent={agent} onFocus={onFocus} changes={changes} />
    </aside>
  );
}

/** Narrow rule: a slim edge handle; opening draws the column as a sheet over the stage. */
function Sheet({ agent, onFocus, changes }: DockProps) {
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get("sheet") === "1",
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const sum = changeTotals(agent);
  return (
    <>
      <nav
        aria-label="Dock"
        style={{ width: EDGE_WIDTH }}
        className="flex shrink-0 flex-col items-center gap-2 border-l bg-sidebar py-2"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Open dock, ${AGENT_NAME[agent.kind]}, ${STATE_LABEL[agent.state]}`}
                aria-expanded={open}
                onClick={() => setOpen(true)}
              />
            }
          >
            <DockIcon name="down" size={14} />
          </TooltipTrigger>
          <TooltipContent side="left">Open dock</TooltipContent>
        </Tooltip>
        <AgentStateMark state={agent.state} confidence={agent.confidence} />
        {sum.files ? (
          <span className="text-2xs tabular-nums text-foreground">{sum.files}</span>
        ) : null}
      </nav>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close dock"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/40"
          />
          <Column
            agent={agent}
            onFocus={onFocus}
            changes={changes}
            onClose={() => setOpen(false)}
            className="fixed inset-y-0 right-0 z-40 shadow-lg"
          />
        </>
      ) : null}
    </>
  );
}

export function DockStacked({ agent, onFocus, changes }: DockProps) {
  const narrow = useWindowWidth() < NARROW_BELOW;
  return narrow ? (
    <Sheet agent={agent} onFocus={onFocus} changes={changes} />
  ) : (
    <Column agent={agent} onFocus={onFocus} changes={changes} />
  );
}

export const stackedSlots = {
  dock: (agent: MockAgent, focus: (id: string) => void) => (
    <DockStacked agent={agent} onFocus={focus} />
  ),
};
