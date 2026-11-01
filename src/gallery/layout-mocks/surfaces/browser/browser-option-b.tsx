import {
  ArrowLeftRightIcon,
  Cancel01Icon,
  CursorPointer01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useSignal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { cn } from "@/lib/cn";
import { Input } from "../../../../ui/controls/input";
import { AgentLogo, AgentStateMark } from "../../agent-parts";
import { AGENT_NAME, STATE_LABEL, type MockAgent, type TermLine } from "../../layout-fixture";
import { MockTerminal } from "../../mock-terminal";
import { DevServerSelect, Glyph, InspectBar, NativeView, ToolButton } from "./browser-chrome";
import { useBrowser } from "./browser-state";

export function sentLine(summary: string): TermLine {
  return [
    ["accent", "> "],
    ["fg", `Look at this element in the preview: ${summary}`],
  ];
}

/** The paired agent's terminal; `sent` are the lines Inspect has typed into it. */
export function AgentTerminal({
  agent,
  sent,
  action,
}: {
  readonly agent: MockAgent;
  readonly sent: readonly TermLine[];
  readonly action?: ComponentChildren;
}) {
  const name = AGENT_NAME[agent.kind];
  return (
    <section aria-label={`${name} terminal`} className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <AgentLogo kind={agent.kind} className="size-3.5" />
        <span className="font-medium text-foreground">{name}</span>
        <AgentStateMark state={agent.state} confidence={agent.confidence} />
        <span className="text-muted-foreground">{STATE_LABEL[agent.state]}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden bg-(--term-bg)">
        <MockTerminal lines={[...agent.terminal, ...sent]} className="shrink-0" />
      </div>
    </section>
  );
}

/**
 * Option b: the stage splits into the agent's terminal and its preview. The pairing is the
 * point, so the compact toolbar leads with the agent and port, and Inspect sends to that agent.
 */
export function BrowserBeside({ agent }: { readonly agent: MockAgent }) {
  const browser = useBrowser("picked");
  const flipped = useSignal(false);
  const closed = useSignal(false);
  const sent = useSignal<readonly TermLine[]>([]);

  const terminal = <AgentTerminal agent={agent} sent={sent.value} />;

  if (closed.value) {
    return <div className="flex min-w-0 flex-1 flex-col">{terminal}</div>;
  }

  const browserColumn = (
    <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5">
        <DevServerSelect browser={browser} pair />
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
        <ToolButton
          label="Swap sides"
          onClick={() => {
            flipped.value = !flipped.value;
          }}
        >
          <Glyph icon={ArrowLeftRightIcon} />
        </ToolButton>
        <ToolButton label="Close preview" onClick={() => (closed.value = true)}>
          <Glyph icon={Cancel01Icon} />
        </ToolButton>
      </div>
      <InspectBar
        browser={browser}
        agentId={agent.id}
        onSend={(summary) => {
          sent.value = [...sent.value, sentLine(summary)];
        }}
      />
      <NativeView browser={browser} />
    </section>
  );

  return (
    <div className={cn("flex min-w-0 flex-1", flipped.value ? "flex-row-reverse" : "flex-row")}>
      {terminal}
      <div className="w-px shrink-0 bg-border" />
      {browserColumn}
    </div>
  );
}
