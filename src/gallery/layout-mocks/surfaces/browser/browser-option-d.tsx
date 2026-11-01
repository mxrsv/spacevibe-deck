import {
  ArrowExpand01Icon,
  ArrowLeft01Icon,
  ArrowLeftRightIcon,
  ArrowRight01Icon,
  ArrowShrink01Icon,
  Cancel01Icon,
  CursorPointer01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import { cn } from "@/lib/cn";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import { Input } from "../../../../ui/controls/input";
import { Chord } from "../../../../ui/blocks/chord";
import { Separator } from "../../../../ui/controls/separator";
import { AgentLogo, AgentStateMark } from "../../agent-parts";
import { AGENT_NAME, STATE_LABEL, type MockAgent, type TermLine } from "../../layout-fixture";
import { DevServerSelect, Glyph, InspectBar, NativeView, ToolButton } from "./browser-chrome";
import { AgentTerminal, sentLine } from "./browser-option-b";
import { useBrowser } from "./browser-state";

type Placement = "beside" | "stage" | "closed";

/** Deck's zoom-pane chord: the preview expands the way any pane zooms over its tab. */
/** Below this stage width (px) the preview stops sitting beside the terminal. */
const NARROW_STAGE = 900;
const EXPAND_KEYS = ["⌘", "⇧", "↵"];
const OPEN_KEYS = ["⌘", "⇧", "I"];

/** `&expanded=1` opens on the stage placement, so captures can reach it without a click. */
function initialPlacement(): Placement {
  return new URLSearchParams(window.location.search).get("expanded") === "1" ? "stage" : "beside";
}

/**
 * Option d, b and a mixed: the preview opens beside the agent's terminal and expands to take
 * the stage. One browser state serves every placement, so the port and a picked element
 * survive the switch, and sending from the stage puts the terminal back to show the line land.
 */
export function BrowserPaired({
  agent,
  onClose,
}: {
  readonly agent: MockAgent;
  /** Set by a shell that owns the way back; Close and ⌘⇧I then leave through it. */
  readonly onClose?: () => void;
}) {
  const browser = useBrowser("picked");
  const placement = useSignal<Placement>(initialPlacement());
  const flipped = useSignal(false);
  const sent = useSignal<readonly TermLine[]>([]);
  const name = AGENT_NAME[agent.kind];
  // The wrapper element swaps with the placement, so the effect re-observes on a change.
  // Under NARROW_STAGE the terminal and the preview cannot share the stage: the preview takes
  // it, and the agent chip in the toolbar is the way back to the terminal.
  const frame = useRef<HTMLDivElement>(null);
  const narrow = useSignal(false);
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      narrow.value = element.getBoundingClientRect().width < NARROW_STAGE;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [narrow, placement.value]);
  const stage = placement.value === "stage" || narrow.value;
  const close = () => {
    if (onClose) onClose();
    else placement.value = "closed";
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey) return;
      if (event.key === "Enter" && placement.value !== "closed") {
        event.preventDefault();
        placement.value = placement.value === "stage" ? "beside" : "stage";
      } else if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        if (placement.value === "closed") placement.value = "beside";
        else if (onClose) onClose();
        else placement.value = "closed";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placement, onClose]);

  const reopen = (
    <Button variant="outline" size="sm" onClick={() => (placement.value = "beside")}>
      Browser
      <Chord keys={OPEN_KEYS} />
    </Button>
  );
  const terminal = (
    <AgentTerminal
      agent={agent}
      sent={sent.value}
      action={placement.value === "closed" ? reopen : null}
    />
  );
  if (placement.value === "closed") {
    return <div className="flex min-w-0 flex-1 flex-col">{terminal}</div>;
  }

  const toolbar = (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
      {stage ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Put the preview beside ${name}, ${STATE_LABEL[agent.state]}`}
            onClick={() => (narrow.value ? close() : (placement.value = "beside"))}
          >
            <AgentLogo kind={agent.kind} className="size-3.5" />
            {name}
            <AgentStateMark state={agent.state} confidence={agent.confidence} />
            <span className="text-muted-foreground">{STATE_LABEL[agent.state]}</span>
          </Button>
          <Separator orientation="vertical" className="mx-0.5 h-4" />
          <ToolButton label="Back" disabled>
            <Glyph icon={ArrowLeft01Icon} />
          </ToolButton>
          <ToolButton label="Forward" disabled>
            <Glyph icon={ArrowRight01Icon} />
          </ToolButton>
        </>
      ) : null}
      <DevServerSelect browser={browser} pair={!stage} />
      <Input
        aria-label="Address"
        className="flex-1 font-mono"
        value={browser.server.path}
        onChange={() => undefined}
      />
      <ToolButton label="Reload" keys={["⌘", "R"]}>
        <Glyph icon={RefreshIcon} />
      </ToolButton>
      <ToolButton
        label="Inspect"
        pressed={browser.inspect.value === "pick"}
        onClick={browser.toggleInspect}
      >
        <Glyph icon={CursorPointer01Icon} />
      </ToolButton>
      {stage ? null : (
        <ToolButton label="Swap sides" onClick={() => (flipped.value = !flipped.value)}>
          <Glyph icon={ArrowLeftRightIcon} />
        </ToolButton>
      )}
      {narrow.value ? null : (
        <ToolButton
          label={stage ? `Beside ${name}` : "Expand to the stage"}
          keys={EXPAND_KEYS}
          onClick={() => (placement.value = stage ? "beside" : "stage")}
        >
          <Glyph icon={stage ? ArrowShrink01Icon : ArrowExpand01Icon} />
        </ToolButton>
      )}
      <ToolButton label="Close preview" keys={OPEN_KEYS} onClick={close}>
        <Glyph icon={Cancel01Icon} />
      </ToolButton>
    </div>
  );
  const preview = (
    <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col">
      {toolbar}
      <InspectBar
        browser={browser}
        agentId={agent.id}
        onSend={(summary) => {
          sent.value = [...sent.value, sentLine(summary)];
          placement.value = "beside";
        }}
      />
      <NativeView browser={browser} />
    </section>
  );
  if (stage) {
    return (
      <div ref={frame} className="flex min-w-0 flex-1 flex-col">
        {preview}
      </div>
    );
  }

  return (
    <div
      ref={frame}
      className={cn("flex min-w-0 flex-1", flipped.value ? "flex-row-reverse" : "flex-row")}
    >
      {terminal}
      <div className="w-px shrink-0 bg-border" />
      {preview}
    </div>
  );
}
