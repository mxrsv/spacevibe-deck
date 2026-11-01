import { effect } from "@preact/signals";
import { render } from "preact";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { tabViews, type PaneView } from "./tabs-store";
import { paneTails } from "./session-tail-store";
import { displayAgent, stateWord } from "../ui/agent-rail-card-model";
import { paneSignal } from "../ui/agent-rail-model";
import { AgentStateMark } from "../ui/blocks/agent-state-mark";
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
  // The flush stage prints the name on its own, so a silent agent shows its state word beside
  // it (as the rail's second line does) rather than the name twice.
  const signal = paneSignal(pane);
  const label =
    message.trim() ||
    (flush
      ? stateWord({ ...signal, detail: pane.detail ?? null, exitCode: pane.exitCode ?? null })
      : name);
  return (
    <div class="pane-agent-header">
      <span class="pane-agent-header__identity" title={pane.agent}>
        <AgentGlyph agent={pane.agent} className="pane-agent-header__logo" />
      </span>
      {flush && (
        <>
          <span class="pane-agent-header__name">{name}</span>
          <AgentStateMark
            status={railStatus({ state: signal.state, attention: pane.attention })}
            confidence={signal.confidence}
          />
        </>
      )}
      <span class="pane-agent-header__message" title={label}>
        {label}
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
