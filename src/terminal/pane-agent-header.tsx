import { effect } from "@preact/signals";
import { render } from "preact";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { tabViews, type PaneView } from "./tabs-store";
import { paneTails } from "./session-tail-store";
import { displayAgent, stateWord } from "../ui/agent-rail-card-model";
import { paneSignal } from "../ui/agent-rail-model";
import { AgentStateMark } from "../ui/blocks/agent-state-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/controls/tooltip";
import { railStatus } from "../ui/rail-view-model";
import { shellStageEnabled } from "../ui/shell-stage";
import { PaneQuickAgents } from "./pane-quick-agents";
import "./pane-agent-header.css";

interface PaneHeaderInput {
  send(data: string): Promise<boolean>;
  focus(): void;
}

export function PaneAgentHeader({
  pane,
  message,
  input,
  shell = false,
}: {
  pane: PaneView;
  message: string;
  input: PaneHeaderInput;
  /** A shell pane in a split tab: the header offers the quick agents instead of a message. */
  shell?: boolean;
}) {
  if (!pane.agent) {
    if (!shell) return null;
    return (
      <div class="pane-agent-header">
        <PaneQuickAgents paneId={pane.paneId} input={input} />
        <span class="pane-agent-header__message" />
      </div>
    );
  }
  const name = displayAgent(pane.agent);
  const flush = shellStageEnabled();
  if (flush) {
    return <FlushIdentity pane={pane} agent={pane.agent} name={name} message={message} />;
  }
  return (
    <div class="pane-agent-header">
      <span class="pane-agent-header__identity" title={pane.agent}>
        <AgentGlyph agent={pane.agent} className="pane-agent-header__logo" />
      </span>
      <span class="pane-agent-header__message" title={message.trim() || name}>
        {message.trim() || name}
      </span>
    </div>
  );
}

/**
 * The flush stage's header (LAY-5): logo, name and state mark, nothing else on the line. The
 * latest sentence rides a tooltip on the name; an agent that has said nothing shows its state
 * word there instead of the name twice. A tooltip reaches no screen reader and no keyboard, so
 * the state and the sentence also sit in the header as visually hidden text.
 */
function FlushIdentity({
  pane,
  agent,
  name,
  message,
}: {
  pane: PaneView;
  agent: NonNullable<PaneView["agent"]>;
  name: string;
  message: string;
}) {
  const signal = paneSignal(pane);
  const state = stateWord({
    ...signal,
    detail: pane.detail ?? null,
    exitCode: pane.exitCode ?? null,
  });
  const sentence = message.trim();
  const tip = sentence || state;
  return (
    <div class="pane-agent-header">
      <span class="pane-agent-header__identity">
        <AgentGlyph agent={agent} className="pane-agent-header__logo" />
      </span>
      <Tooltip>
        <TooltipTrigger render={<span class="pane-agent-header__name" />}>{name}</TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          {tip}
        </TooltipContent>
      </Tooltip>
      {/* Always solid: beside the name a hollow ring (the inferred look) reads as the letter "O".
          The tooltip and the rail still carry how sure Deck is. */}
      <AgentStateMark status={railStatus({ state: signal.state, attention: pane.attention })} />
      <span class="pane-agent-header__message pane-agent-header__message--hidden">
        {sentence ? `${state}. ${sentence}` : state}
      </span>
    </div>
  );
}

/** Reuse the pane bar; legacy cwd nodes remain available to the drag ghost. */
export function mountPaneAgentHeader(
  id: number,
  element: HTMLElement,
  bar: HTMLElement,
  input: PaneHeaderInput,
): () => void {
  if ((globalThis as { __deckHost?: unknown }).__deckHost === undefined) return () => {};
  const host = document.createElement("div");
  host.className = "pane-agent-header-host";
  bar.append(host);
  const stop = effect(() => {
    const tab = tabViews.value.find((candidate) =>
      candidate.panes?.some((pane) => pane.paneId === id),
    );
    const pane = tab?.panes?.find((candidate) => candidate.paneId === id);
    // A lone shell keeps the bare terminal; the header arrives with the first split.
    const shell = !pane?.agent && (tab?.panes?.length ?? 0) >= 2;
    const message = paneTails.value.get(id) ?? "";
    element.classList.toggle("pane--agent-header", Boolean(pane?.agent) || shell);
    render(
      pane && (pane.agent || shell) ? (
        <PaneAgentHeader pane={pane} message={message} input={input} shell={shell} />
      ) : null,
      host,
    );
  });
  return () => {
    stop();
    render(null, host);
    host.remove();
    element.classList.remove("pane--agent-header");
  };
}
