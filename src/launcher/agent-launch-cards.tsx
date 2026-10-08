import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowRight, Plus, PlusCircle, Terminal } from "@phosphor-icons/react";
import type { AgentOption } from "../lib/agent-catalog";
import { TERMINAL_LAUNCH_ID } from "../terminal/agent-launch-target";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../ui/controls/deck-icon";
import { useStageOverlayFlag, useSurfacePlacement } from "../ui/worktree-card-menus";
import "./agent-launch-page.css";

/** A pointer resting on the icon raises the tip; keyboard focus raises it at once. */
const TIP_OPEN_MS = 400;
const NEW_SPACE_TIP = "New space";

/** The `Terminal` card: a plain shell, offered beside the agents and never missing. */
const TERMINAL_OPTION: AgentOption = {
  id: TERMINAL_LAUNCH_ID,
  label: "Terminal",
  detail: "",
  missing: false,
};

interface AgentLaunchCardsProps {
  readonly agents: readonly AgentOption[];
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly onRun: (agentId: string) => void;
  /**
   * When set, each installed agent's card gains a quiet `New space` button
   * beside the card's own press (which then means Split). Only the compact
   * launcher passes it, and only while the folder already has a tab to split;
   * the Open board's cards always start a tab of their own.
   */
  readonly onRunInNewSpace?: (agentId: string) => void;
  /**
   * When set, the grid ends with an `Add agent` card that edits which agents
   * the grid shows. `editing` is its disclosure state; the editor itself is
   * the caller's, so the card stays a plain button.
   */
  readonly onEditAgents?: () => void;
  readonly editing?: boolean;
  /**
   * When set, the grid gains a `Terminal` card after the agents: the same
   * press and `New space` button, but it starts a bare shell. `onRun` and
   * `onRunInNewSpace` receive `TERMINAL_LAUNCH_ID` for it.
   */
  readonly terminal?: boolean;
}

function NewSpaceTip({ rect, id }: { rect: DOMRect; id: string }) {
  const { ref, style } = useSurfacePlacement(rect, "below");
  useStageOverlayFlag();
  return createPortal(
    <div ref={ref} id={id} class="space-card" role="tooltip" style={style}>
      <span class="space-card__meta">{NEW_SPACE_TIP}</span>
    </div>,
    document.body,
  );
}

/** DL-32.6: the alternate to a card's press, an icon with a DL-13.7 hover tip. */
function NewSpaceButton(props: { agent: AgentOption; disabled: boolean; onPress: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const show = (button: HTMLElement, delay: number): void => {
    cancel();
    const raise = (): void => setRect(button.getBoundingClientRect());
    if (delay === 0) raise();
    else timer.current = setTimeout(raise, delay);
  };
  const hide = (): void => {
    cancel();
    setRect(null);
  };
  const tipId = `launch-tip-${props.agent.id}`;
  return (
    <>
      <button
        type="button"
        class="agent-launch-page__alt"
        disabled={props.disabled}
        aria-label={`Run ${props.agent.label} in a new space`}
        aria-describedby={rect === null ? undefined : tipId}
        onMouseEnter={(event) => show(event.currentTarget, TIP_OPEN_MS)}
        onMouseLeave={hide}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) show(event.currentTarget, 0);
        }}
        onBlur={hide}
        onClick={() => {
          hide();
          props.onPress();
        }}
      >
        <DeckIcon icon={PlusCircle} size={CHROME_ICON} />
      </button>
      {rect !== null && <NewSpaceTip rect={rect} id={tipId} />}
    </>
  );
}

/** DL-32.1 / DL-32.6: one card treatment on both launch surfaces. */
export function AgentLaunchCards(props: AgentLaunchCardsProps) {
  const cards = props.terminal === true ? [...props.agents, TERMINAL_OPTION] : props.agents;
  return (
    <div class="agent-launch-page__grid" aria-busy={props.pending}>
      {cards.map((agent) => {
        const blocked = props.pending || props.disabled || agent.missing;
        const withSpace = props.onRunInNewSpace !== undefined && !agent.missing;
        return (
          <article
            class="agent-launch-page__card"
            key={agent.id}
            data-launch-terminal={agent.id === TERMINAL_LAUNCH_ID ? "" : undefined}
          >
            <button
              type="button"
              class="agent-launch-page__main"
              data-launch-primary
              disabled={blocked}
              aria-label={
                withSpace ? `Split ${agent.label} into the current tab` : `Run ${agent.label}`
              }
              onClick={() => props.onRun(agent.id)}
            >
              {agent.id === TERMINAL_LAUNCH_ID ? (
                <DeckIcon icon={Terminal} class="agent-launch-page__logo" />
              ) : (
                <AgentGlyph
                  agent={agent.id.startsWith("custom:") ? agent.label : agent.id}
                  className="agent-launch-page__logo"
                />
              )}
              <strong>{agent.label}</strong>
              {agent.missing ? (
                <span class="agent-launch-page__missing">Not installed</span>
              ) : (
                <DeckIcon icon={ArrowRight} size={CHROME_ICON} />
              )}
            </button>
            {withSpace && (
              <NewSpaceButton
                agent={agent}
                disabled={blocked}
                onPress={() => props.onRunInNewSpace?.(agent.id)}
              />
            )}
          </article>
        );
      })}
      {props.onEditAgents !== undefined && (
        <button
          type="button"
          class="agent-launch-page__add"
          data-launch-add
          aria-expanded={props.editing === true}
          onClick={props.onEditAgents}
        >
          <DeckIcon icon={Plus} size={CHROME_ICON} />
          Add agent
        </button>
      )}
    </div>
  );
}
