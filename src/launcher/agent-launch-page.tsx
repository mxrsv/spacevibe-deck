import { useLayoutEffect, useRef } from "preact/hooks";
import { ArrowLeft, Columns, Gear } from "@phosphor-icons/react";
import type { AgentOption } from "../lib/agent-catalog";
import type { AgentLaunchTarget } from "../terminal/agent-launch-target";
import { AgentLaunchCards } from "./agent-launch-cards";
import { DeckIcon } from "../ui/controls/deck-icon";
import "./agent-launch-page.css";

export interface AgentLaunchPageProps {
  readonly target: AgentLaunchTarget;
  readonly agents: readonly AgentOption[];
  readonly resolved: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly active?: boolean;
  readonly onRun: (agentId: string) => void;
  readonly onBack: () => void;
  readonly onSettings: () => void;
}

/** DL-32.6: a transient stage page; no dialog, tab slot or PTY ownership. */
export function AgentLaunchPage(props: AgentLaunchPageProps) {
  const root = useRef<HTMLElement>(null);
  const active = props.active !== false;
  useLayoutEffect(() => {
    if (!active) return;
    const control = root.current?.querySelector<HTMLElement>(
      "[data-launch-primary]:not(:disabled)",
    );
    (control ?? root.current)?.focus();
  }, [active, props.resolved]);
  const folder =
    props.target.workspacePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || props.target.workspacePath;
  return (
    <section
      class="agent-launch-page"
      ref={root}
      tabIndex={-1}
      aria-label="Quick agent launcher"
      onKeyDownCapture={(event) => {
        if (active && event.key === "Escape" && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          props.onBack();
        }
      }}
    >
      <div class="agent-launch-page__inner">
        <button class="agent-launch-page__back" onClick={props.onBack}>
          <DeckIcon icon={ArrowLeft} size={15} /> Back <kbd>Esc</kbd>
        </button>
        <header class="agent-launch-page__heading">
          <span class="agent-launch-page__eyebrow">QUICK LAUNCH</span>
          <h1>A little more horsepower.</h1>
          <p>Pick an agent. Keep building, side by side.</p>
        </header>
        <div class="agent-launch-page__destination">
          <span title={props.target.workspacePath}>{folder}</span>
          <span
            title={
              props.target.kind === "split"
                ? `Splits the roomiest pane in the tab holding pane ${props.target.paneId}`
                : props.target.workspacePath
            }
          >
            <DeckIcon icon={Columns} size={14} />
            {props.target.kind === "split" ? "Split · same tab" : "New tab"}
          </span>
        </div>
        {!props.resolved ? <p role="status">Looking for installed agents…</p> : null}
        {props.resolved && props.agents.length === 0 ? (
          <div class="agent-launch-page__empty">
            <p>No quick agents available.</p>
            <button data-launch-primary onClick={props.onSettings}>
              Choose agents
            </button>
          </div>
        ) : null}
        <AgentLaunchCards agents={props.agents} pending={props.pending} onRun={props.onRun} />
        {props.pending ? <p role="status">Opening agent…</p> : null}
        {props.error ? (
          <p class="agent-launch-page__error" role="alert">
            {props.error}
          </p>
        ) : null}
        <footer class="agent-launch-page__footer">
          <span>Your terminal is still running.</span>
          <button
            onClick={props.onSettings}
            aria-label="Choose quick agents"
            title="Choose quick agents"
          >
            <DeckIcon icon={Gear} size={15} />
          </button>
        </footer>
      </div>
    </section>
  );
}
