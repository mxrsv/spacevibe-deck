import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowRight01Icon, CommandLineIcon, PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import type { AgentOption } from "../lib/agent-catalog";
import { TERMINAL_LAUNCH_ID } from "../terminal/agent-launch-target";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import { AgentInstallControl } from "./agent-install-control";
import { noteAgentListShown } from "./agent-install-store";
import { GLYPH_ROW, DeckIcon } from "../ui/controls/deck-icon";
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

/** What the launch page's preview line shows: a card's press, or its `New space` button. */
export interface CardPreview {
  readonly agentId: string;
  readonly newSpace: boolean;
}

/** A pointer and keyboard focus can each rest on a card; the page decides which one wins. */
export type CardPreviewSource = "pointer" | "focus";

/** The hooks the launch page lends the cards to drive its command preview (DL-32.6). */
export interface CardPreviewHooks {
  /** Element id of the preview line: the shown card's controls are described by it. */
  readonly describedBy: string;
  readonly shown: CardPreview | null;
  readonly onPreview: (source: CardPreviewSource, preview: CardPreview | null) => void;
}

interface AgentLaunchCardsProps {
  readonly agents: readonly AgentOption[];
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly onRun: (agentId: string) => void;
  /** Only the launch page passes it; the Open board's cards have no preview line. */
  readonly preview?: CardPreviewHooks;
  /**
   * When set, each installed agent's card gains a quiet `New space` button
   * beside the card's own press (which then means Split). Only the compact
   * launcher passes it, and only while the folder already has a tab to split;
   * the Open board's cards always start a tab of their own.
   */
  readonly onRunInNewSpace?: (agentId: string) => void;
  /**
   * When set, the grid gains a `Terminal` card after the installed agents and
   * before the missing ones: the same press and `New space` button, but it
   * starts a bare shell. `onRun` and `onRunInNewSpace` receive
   * `TERMINAL_LAUNCH_ID` for it.
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
function NewSpaceButton(props: {
  agent: AgentOption;
  disabled: boolean;
  onPress: () => void;
  /** The preview line that describes this button while it is the one shown. */
  describedBy?: string;
  onPreview?: (source: CardPreviewSource, on: boolean) => void;
}) {
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
  // Two descriptions can apply at once, so the ids are joined, never one replacing the other.
  const describedBy = [rect === null ? undefined : tipId, props.describedBy].filter(Boolean);
  return (
    <>
      <button
        type="button"
        class="agent-launch-page__alt"
        disabled={props.disabled}
        aria-label={`Run ${props.agent.label} in a new space`}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
        onMouseEnter={(event) => {
          show(event.currentTarget, TIP_OPEN_MS);
          props.onPreview?.("pointer", true);
        }}
        onMouseLeave={() => {
          hide();
          props.onPreview?.("pointer", false);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            show(event.currentTarget, 0);
            props.onPreview?.("focus", true);
          }
        }}
        onBlur={() => {
          hide();
          props.onPreview?.("focus", false);
        }}
        onClick={() => {
          hide();
          props.onPress();
        }}
      >
        <DeckIcon icon={PlusSignCircleIcon} size={GLYPH_ROW} />
      </button>
      {rect !== null && <NewSpaceTip rect={rect} id={tipId} />}
    </>
  );
}

/** Installed agents, the `Terminal` card, then the missing ones whatever order they arrived in. */
function withTerminal(agents: readonly AgentOption[]): readonly AgentOption[] {
  return [
    ...agents.filter((agent) => !agent.missing),
    TERMINAL_OPTION,
    ...agents.filter((agent) => agent.missing),
  ];
}

/** DL-32.1 / DL-32.6: one card treatment on both launch surfaces. */
export function AgentLaunchCards(props: AgentLaunchCardsProps) {
  useEffect(() => noteAgentListShown(), []);
  const cards = props.terminal === true ? withTerminal(props.agents) : props.agents;
  return (
    <div class="agent-launch-page__grid" aria-busy={props.pending}>
      {cards.map((agent) => {
        const blocked = props.pending || props.disabled || agent.missing;
        const withSpace = props.onRunInNewSpace !== undefined && !agent.missing;
        // A missing tile has nothing to run, so it has nothing to preview either.
        const hooks = agent.missing ? undefined : props.preview;
        const shown = hooks?.shown?.agentId === agent.id ? hooks.shown : null;
        return (
          <article
            class={`agent-launch-page__card${agent.missing ? " agent-launch-page__card--missing" : ""}`}
            key={agent.id}
            data-launch-terminal={agent.id === TERMINAL_LAUNCH_ID ? "" : undefined}
            onMouseEnter={() => hooks?.onPreview("pointer", { agentId: agent.id, newSpace: false })}
            onMouseLeave={() => hooks?.onPreview("pointer", null)}
          >
            <button
              type="button"
              class="agent-launch-page__main"
              data-launch-primary
              disabled={blocked}
              aria-label={
                agent.missing
                  ? `${agent.label} is not installed`
                  : withSpace
                    ? `Split ${agent.label} into the current tab`
                    : `Run ${agent.label}`
              }
              aria-describedby={shown?.newSpace === false ? hooks?.describedBy : undefined}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible"))
                  hooks?.onPreview("focus", { agentId: agent.id, newSpace: false });
              }}
              onBlur={() => hooks?.onPreview("focus", null)}
              onClick={() => props.onRun(agent.id)}
            >
              <span class="agent-launch-page__name">
                {agent.id === TERMINAL_LAUNCH_ID ? (
                  <DeckIcon icon={CommandLineIcon} class="agent-launch-page__logo" />
                ) : (
                  <AgentGlyph
                    agent={agent.id.startsWith("custom:") ? agent.label : agent.id}
                    className="agent-launch-page__logo"
                  />
                )}
                <strong>{agent.label}</strong>
              </span>
              {agent.missing ? (
                <span class="agent-launch-page__missing">Not installed</span>
              ) : (
                <DeckIcon icon={ArrowRight01Icon} size={GLYPH_ROW} />
              )}
            </button>
            {withSpace && (
              <NewSpaceButton
                agent={agent}
                disabled={blocked}
                onPress={() => props.onRunInNewSpace?.(agent.id)}
                describedBy={shown?.newSpace === true ? hooks?.describedBy : undefined}
                onPreview={(source, on) =>
                  hooks?.onPreview(
                    source,
                    on
                      ? { agentId: agent.id, newSpace: true }
                      : source === "pointer"
                        ? { agentId: agent.id, newSpace: false }
                        : null,
                  )
                }
              />
            )}
            {/* A sibling of the press, never inside it: the missing tile's press is disabled. */}
            {agent.missing && <AgentInstallControl agentId={agent.id} label={agent.label} />}
          </article>
        );
      })}
    </div>
  );
}
