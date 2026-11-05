import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Alert02Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import { tildify } from "../lib/process-info";
import type { AgentLaunchTarget, LaunchCommandOverride } from "../terminal/agent-launch-target";
import { AgentLaunchCards, type CardPreview, type CardPreviewSource } from "./agent-launch-cards";
import { eventInOpenLaunchPopover } from "./agent-launch-page-store";
import { AgentLaunchContext, type AgentLaunchContextProps } from "./agent-launch-context";
import { LaunchCommandPreview } from "./launch-command-preview";
import { DeckIcon, GLYPH_ROW } from "../ui/controls/deck-icon";
import "./agent-launch-page.css";

export interface AgentLaunchPageProps {
  readonly target: AgentLaunchTarget;
  /** The context row: workspace, checkout and placement chip (DL-32.6). */
  readonly contextRow: AgentLaunchContextProps;
  readonly agents: readonly AgentOption[];
  /**
   * Each installed agent's launch commands, from the app's settings: the page
   * never reads settings itself. Keyed by agent id; the Terminal card has none.
   */
  readonly commands: Readonly<Record<string, LaunchCommandChoices>>;
  readonly resolved: boolean;
  readonly pending: boolean;
  /** Why the last launch failed before its pane existed; null when it did not. */
  readonly error: string | null;
  /** Repeats the failed launch: the same agent, placement and profile pick. */
  readonly onRetry: () => void;
  readonly active?: boolean;
  /** The override is set only while the agent's profile pick differs from its default. */
  readonly onRun: (agentId: string, override?: LaunchCommandOverride) => void;
  /**
   * Run in a space of its own. Offered only when the target is a split — a
   * folder with no tab starts one anyway, so there is nothing to choose.
   */
  readonly onRunInNewSpace?: (agentId: string, override?: LaunchCommandOverride) => void;
  readonly onBack: () => void;
  readonly onSettings: () => void;
}

const PREVIEW_ID = "agent-launch-preview";

/** DL-32.6: a transient stage page; no dialog, tab slot or PTY ownership. */
export function AgentLaunchPage(props: AgentLaunchPageProps) {
  const root = useRef<HTMLElement>(null);
  const active = props.active !== false;
  // A pointer and keyboard focus can each rest on a card; the pointer is the
  // more recent intent, so it wins while it is over one.
  const [pointer, setPointer] = useState<CardPreview | null>(null);
  const [focus, setFocus] = useState<CardPreview | null>(null);
  const preview = pointer ?? focus;
  const onPreview = (source: CardPreviewSource, next: CardPreview | null): void =>
    source === "pointer" ? setPointer(next) : setFocus(next);
  const { context, homeDir } = props.contextRow;
  const activeCommand = (agentId: string): string | null =>
    props.commands[agentId]?.default ?? null;
  const newSpace = props.target.kind === "split" ? props.onRunInNewSpace : undefined;
  useLayoutEffect(() => {
    if (!active) return;
    const control = root.current?.querySelector<HTMLElement>(
      "[data-launch-primary]:not(:disabled)",
    );
    (control ?? root.current)?.focus();
  }, [active, props.resolved]);
  return (
    <section
      class="agent-launch-page"
      ref={root}
      tabIndex={-1}
      aria-label="Quick agent launcher"
      onKeyDownCapture={(event) => {
        // An open popover answers its own Escape before the page does.
        if (
          active &&
          event.key === "Escape" &&
          !event.isComposing &&
          !eventInOpenLaunchPopover(event.target)
        ) {
          event.preventDefault();
          event.stopPropagation();
          props.onBack();
        }
      }}
    >
      <div class="agent-launch-page__inner">
        <button class="sbtn sbtn--lead agent-launch-page__back" onClick={props.onBack}>
          <DeckIcon icon={ArrowLeft01Icon} size={GLYPH_ROW} /> Back <kbd>Esc</kbd>
        </button>
        <AgentLaunchContext {...props.contextRow} />
        {props.error ? (
          <div class="agent-launch-page__notice" role="alert">
            <DeckIcon icon={Alert02Icon} size={GLYPH_ROW} />
            <span class="agent-launch-page__notice-text">{props.error}</span>
            <button type="button" disabled={props.pending} onClick={props.onRetry}>
              Retry
            </button>
          </div>
        ) : null}
        {!props.resolved ? <p role="status">Looking for installed agents…</p> : null}
        {props.resolved && props.agents.every((agent) => agent.missing) ? (
          <div class="agent-launch-page__empty">
            <p>No quick agents available.</p>
            <button data-launch-primary onClick={props.onSettings}>
              Choose agents
            </button>
          </div>
        ) : null}
        <AgentLaunchCards
          agents={props.agents}
          pending={props.pending}
          onRun={(agentId) => props.onRun(agentId)}
          onRunInNewSpace={newSpace && ((agentId) => newSpace(agentId))}
          preview={{ describedBy: PREVIEW_ID, shown: preview, onPreview }}
          terminal
        />
        {/* The preview line pins to the page's bottom edge, so it stays the last child. */}
        {props.pending ? <p role="status">Opening agent…</p> : null}
        <LaunchCommandPreview
          id={PREVIEW_ID}
          subject={preview}
          commandFor={activeCommand}
          folder={tildify(context.checkoutPath, homeDir)}
          folderPath={context.checkoutPath}
          placement={context.chip}
        ></LaunchCommandPreview>
      </div>
    </section>
  );
}
