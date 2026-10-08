import { effect } from "@preact/signals";
import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  ArrowsOut,
  CaretDown,
  SquareSplitHorizontal,
  SquareSplitVertical,
  XSquare,
} from "@phosphor-icons/react";
import { AgentGlyph } from "../ui/controls/agent-glyph";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../ui/controls/action-tooltip";
import { DeckIcon, type DeckIconComponent } from "../ui/controls/deck-icon";
import { toolbarLabel } from "../ui/toolbar/toolbar-label";
import { shortcutLabel } from "../lib/shortcut-label";
import { settings } from "../settings/settings-store";
import { tabViews, type PaneView } from "./tabs-store";
import { paneHeaderActions } from "./pane-header-actions";
import type { ActionId } from "./action-registry";
import { paneTails } from "./session-tail-store";
import { CLAUDE_EFFORT_PICKER_KEY, CLAUDE_EFFORT_PICKER_HINT } from "../lib/agent-effort";
import { reportChromeMessage } from "../chrome/events";
import { displayAgent } from "../ui/agent-rail-card-model";
import { PaneQuickAgents } from "./pane-quick-agents";
import "./pane-agent-header.css";

interface PaneHeaderInput {
  send(data: string): Promise<boolean>;
  focus(): void;
}
const OPEN_FAILED = "Could not open Claude Code's effort picker. Try again.";
/**
 * Below this header width the splits drop. The logo, a readable stretch of
 * message, Claude's Effort control and all four actions need about this much;
 * at the 24-column pane floor the message would otherwise be squeezed to nothing.
 */
const NARROW_HEADER_PX = 280;

function currentPane(id: number): PaneView | undefined {
  return tabViews
    .peek()
    .flatMap((tab) => tab.panes ?? [])
    .find((pane) => pane.paneId === id);
}

interface HeaderActionProps {
  readonly paneId: number;
  readonly id: ActionId;
  readonly icon: DeckIconComponent;
  /** Present only for a toggle: reaches ARIA, never the paint (DL-21.8). */
  readonly pressed?: boolean;
  onPress(): void;
}

/** One header button and its DL-23 tooltip — a component because the tooltip is a hook per control. */
function HeaderAction({ paneId, id, icon, pressed, onPress }: HeaderActionProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltipVisibility();
  const label = toolbarLabel(id);
  const tooltipId = `pane-act-tip-${paneId}-${id}`;
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="pane-agent-header__act"
        aria-label={label}
        aria-pressed={pressed}
        aria-describedby={tooltip.anchor !== null ? tooltipId : undefined}
        {...tooltipTriggerProps(tooltip, ref)}
        onClick={onPress}
      >
        <DeckIcon icon={icon} size={14} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip
          id={tooltipId}
          label={label}
          shortcut={shortcutLabel(id)}
          reason={null}
          anchor={tooltip.anchor}
        />
      )}
    </>
  );
}

/**
 * The pane's own actions (DL-32.8): they act on the pane whose header holds
 * them, through the handlers `App` registered (`pane-header-actions.ts`). The
 * container stops `pointerdown` and `mousedown` like the Effort control, since
 * the bar is the pane's drag handle (`pane-drag.ts`). Never `disabled`: a closed
 * pane's header is gone, and an exited agent's pane can still be split or closed.
 *
 * When the pane is too narrow for the message the two splits are not drawn, and
 * Focus expand and Close pane stay (DL-32.8).
 */
function HeaderActions({
  paneId,
  expandActive,
  narrow,
}: {
  paneId: number;
  expandActive: boolean;
  narrow: boolean;
}) {
  return (
    <div
      class="pane-agent-header__actions"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {!narrow && (
        <>
          <HeaderAction
            paneId={paneId}
            id="split-row"
            icon={SquareSplitHorizontal}
            onPress={() => paneHeaderActions().split(paneId, "row")}
          />
          <HeaderAction
            paneId={paneId}
            id="split-column"
            icon={SquareSplitVertical}
            onPress={() => paneHeaderActions().split(paneId, "column")}
          />
        </>
      )}
      <HeaderAction
        paneId={paneId}
        id="toggle-expand"
        icon={ArrowsOut}
        pressed={expandActive}
        onPress={() => paneHeaderActions().toggleExpand(paneId)}
      />
      <HeaderAction
        paneId={paneId}
        id="close-pane"
        icon={XSquare}
        onPress={() => paneHeaderActions().close(paneId)}
      />
    </div>
  );
}

export function PaneAgentHeader({
  pane,
  message,
  input,
  expandActive = false,
  shell = false,
}: {
  pane: PaneView;
  message: string;
  input: PaneHeaderInput;
  /** `settings.focusExpand`, read by the mount's effect like `pane` and `message`. */
  expandActive?: boolean;
  /** A shell pane in a split tab: the header offers the quick agents instead of a message. */
  shell?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  // A JS measure, not a container query: `container-type` is layout containment,
  // which would make the bar the containing block for the actions' `fixed`
  // tooltips and move them.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setNarrow((entry?.contentRect.width ?? Number.POSITIVE_INFINITY) < NARROW_HEADER_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setPending(false);
    return () => {
      generation.current += 1;
    };
  }, [pane.paneId, pane.sessionId, pane.agent, pane.startedAt]);
  async function openEffortPicker() {
    const ownGeneration = generation.current;
    const valid = () => {
      const live = currentPane(pane.paneId);
      return (
        generation.current === ownGeneration &&
        live?.agent === "claude" &&
        live.sessionId === pane.sessionId &&
        live.startedAt === pane.startedAt &&
        live.phase !== "exited"
      );
    };
    if (inFlight.current || !valid()) return;
    inFlight.current = true;
    setPending(true);
    try {
      // Focus belongs to this click, never to a later queued-write completion.
      input.focus();
      // Open the native model/effort picker. Never submit text or clear the user's draft.
      const sent = await input.send(CLAUDE_EFFORT_PICKER_KEY);
      if (!valid()) return;
      if (!sent) reportChromeMessage(OPEN_FAILED);
    } catch (error) {
      if (valid()) {
        console.warn("Claude effort picker input failed", error);
        reportChromeMessage(OPEN_FAILED);
      }
    } finally {
      if (generation.current === ownGeneration) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  if (!pane.agent) {
    if (!shell) return null;
    return (
      <div ref={root} class="pane-agent-header">
        <PaneQuickAgents paneId={pane.paneId} input={input} />
        <span class="pane-agent-header__message" />
        <HeaderActions paneId={pane.paneId} expandActive={expandActive} narrow={narrow} />
      </div>
    );
  }
  const label = message.trim() || displayAgent(pane.agent);
  return (
    <div ref={root} class="pane-agent-header">
      <span class="pane-agent-header__identity" title={pane.agent}>
        <AgentGlyph agent={pane.agent} className="pane-agent-header__logo" />
      </span>
      <span class="pane-agent-header__message" title={label}>
        {label}
      </span>
      {pane.agent === "claude" && (
        <div
          class="pane-agent-header__control"
          title={CLAUDE_EFFORT_PICKER_HINT}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={pane.phase === "exited" || pending}
            aria-label="Change Claude Code effort"
            title={CLAUDE_EFFORT_PICKER_HINT}
            onClick={() => void openEffortPicker()}
          >
            Effort
            <DeckIcon icon={CaretDown} size={14} />
          </button>
        </div>
      )}
      <HeaderActions paneId={pane.paneId} expandActive={expandActive} narrow={narrow} />
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
    const expandActive = settings.value.focusExpand;
    element.classList.toggle("pane--agent-header", Boolean(pane?.agent) || shell);
    render(
      pane && (pane.agent || shell) ? (
        <PaneAgentHeader
          pane={pane}
          message={message}
          input={input}
          expandActive={expandActive}
          shell={shell}
        />
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
