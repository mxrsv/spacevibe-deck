import { cn } from "@/lib/cn";
import { useEffect, useRef } from "preact/hooks";
import { Chord } from "../../ui/blocks/chord";
import { Kbd } from "../../ui/controls/kbd";
import { AgentLogo, AgentStateMark } from "./agent-parts";
import { AGENT_NAME, STATE_LABEL, type MockAgent } from "./layout-fixture";
import {
  agentsInSection,
  placeLine,
  SECTION_LABEL,
  type InboxSectionId,
} from "./option-inbox-model";
import { MockTerminal } from "./mock-terminal";

const SWITCHER_SECTIONS: readonly InboxSectionId[] = ["needs", "unread", "working"];

/** Only agents that want something, grouped the way the rail groups them. */
export function switcherEntries(): MockAgent[] {
  return SWITCHER_SECTIONS.flatMap((section) => agentsInSection(section, null));
}

const PREVIEW_ROWS = 14;

export function InboxSwitcher({
  highlighted,
  onHighlight,
  onOpen,
  onClose,
}: {
  readonly highlighted: string;
  readonly onHighlight: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onClose: () => void;
}) {
  const entries = switcherEntries();
  const current = entries.find((agent) => agent.id === highlighted) ?? entries[0];
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/55">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close switcher"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Attention switcher"
        className="relative flex w-[min(920px,calc(100vw-96px))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground ring-1 ring-foreground/10"
      >
        <div className="flex h-[340px]">
          <div
            ref={listRef}
            role="listbox"
            aria-label="Agents that need you"
            className="w-[320px] shrink-0 overflow-y-auto border-r bg-sidebar p-2"
          >
            {SWITCHER_SECTIONS.map((section) => {
              const items = entries.filter((agent) =>
                agentsInSection(section, null).includes(agent),
              );
              if (items.length === 0) return null;
              return (
                <div key={section} role="group" aria-label={SECTION_LABEL[section]}>
                  <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-2xs font-medium text-muted-foreground">
                    {SECTION_LABEL[section]}
                    <span className="tabular-nums">{items.length}</span>
                  </div>
                  {items.map((agent) => {
                    const selected = agent.id === current.id;
                    return (
                      <div
                        key={agent.id}
                        role="option"
                        aria-selected={selected}
                        aria-label={`${AGENT_NAME[agent.kind]}, ${STATE_LABEL[agent.state]}`}
                        onPointerMove={() => !selected && onHighlight(agent.id)}
                        onClick={() => onOpen(agent.id)}
                        className={cn(
                          "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-xs",
                          selected ? "bg-accent text-foreground" : "text-foreground",
                        )}
                      >
                        <AgentStateMark state={agent.state} confidence={agent.confidence} />
                        <AgentLogo kind={agent.kind} />
                        <span className="min-w-0 flex-1 truncate">{agent.sentence}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
              <AgentLogo kind={current.kind} />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {placeLine(current)}
              </span>
              <AgentStateMark state={current.state} confidence={current.confidence} />
              <span className="text-muted-foreground">{STATE_LABEL[current.state]}</span>
            </div>
            <MockTerminal
              lines={current.terminal}
              lastRows={PREVIEW_ROWS}
              className="min-h-0 flex-1 px-4 py-3 text-sm"
            />
          </div>
        </div>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t px-3 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Chord keys={["⌘", "⇧", "A"]} />
            next
          </span>
          <span className="flex items-center gap-1.5">
            <Chord keys={["↑", "↓"]} />
            move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
