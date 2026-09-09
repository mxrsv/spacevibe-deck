import { PlusSquare } from "@phosphor-icons/react";
import { useRef, useState } from "preact/hooks";
import { AgentBoardCard, type BoardCardActions } from "./agent-board-card";
import {
  cardForDigit,
  type AgentBoardView,
  type BoardCard,
  type BoardStatusFilter,
} from "./agent-board-model";
import { AgentBoardNav } from "./agent-board-nav";
import { AgentBoardPanel, type BoardPanelState } from "./agent-board-panel";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";

/**
 * The Agent Board (spec §4–§7, DL §34): nav · grid · panel. Presentational —
 * every fact arrives in `view` and every effect leaves through `actions`, so
 * the gallery mounts the real thing over a fixture and the wiring plan binds
 * it to the stores without touching this file.
 */
export interface AgentBoardActions extends BoardCardActions {
  onReply(card: BoardCard, text: string): void;
  onStatusFilter(filter: BoardStatusFilter): void;
  onProjectFilter(key: string | null): void;
  onNewAgent(): void;
  onEscape(): void;
}

export interface AgentBoardProps {
  readonly view: AgentBoardView;
  readonly actions: AgentBoardActions;
  readonly panel: BoardPanelState;
}

// jsdom lays out no grid at all, so `getComputedStyle` never reports real
// tracks under the test environment: this is the ↑/↓ step count ONLY for
// that fallback path, not a design constant.
const COLUMNS_FALLBACK = 3;

/** The real column count off the grid's own computed style (spec §5.5). */
function columnCount(grid: HTMLDivElement | null): number {
  if (grid === null) return COLUMNS_FALLBACK;
  const tracks = getComputedStyle(grid).gridTemplateColumns;
  if (tracks === "" || tracks === "none") return COLUMNS_FALLBACK;
  return tracks.split(" ").length;
}

export function AgentBoard({ view, actions, panel }: AgentBoardProps) {
  const [focusedPaneId, setFocusedPaneId] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusIndex = Math.max(
    0,
    view.cards.findIndex((card) => card.paneId === focusedPaneId),
  );

  const focusCard = (index: number): void => {
    const hits = grid.current?.querySelectorAll<HTMLButtonElement>(".board-card__hit");
    const target = hits?.[Math.min(Math.max(index, 0), (hits?.length ?? 1) - 1)];
    target?.focus();
  };

  const onGridKey = (event: KeyboardEvent): void => {
    // Spec §5.5: ⌘Enter (Ctrl+Enter on Windows) is tier 3 for the focused card.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const focused = view.cards[focusIndex];
      if (focused !== undefined) {
        event.preventDefault();
        actions.onOpenInStage(focused);
      }
      return;
    }
    const digit = cardForDigit(view, event.key);
    if (digit !== null) {
      event.preventDefault();
      actions.onSelect(digit);
      return;
    }
    const last = view.cards.length - 1;
    const columns = columnCount(grid.current);
    const moves: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowDown: focusIndex + columns,
      ArrowUp: focusIndex - columns,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusCard(next);
    }
  };

  const onRootKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (view.selected !== null) {
      // The panel holds focus; unmounting it would drop focus to <body>, and
      // the SECOND Escape (DL-34.9) would never reach this handler. Hand
      // focus back to the selected card first (a hidden card clamps to 0).
      focusCard(view.cards.findIndex((card) => card.paneId === view.selected?.paneId));
      actions.onSelect(null);
    } else {
      actions.onEscape();
    }
  };

  const panelOpen = view.selected !== null;
  return (
    <section
      class="agent-board"
      data-panel={panelOpen ? "open" : "closed"}
      aria-label="Agent Board"
      onKeyDown={onRootKey}
    >
      <AgentBoardNav
        status={view.status}
        projects={view.projects}
        onStatusFilter={actions.onStatusFilter}
        onProjectFilter={actions.onProjectFilter}
      />
      <div class="agent-board__main">
        <div class="agent-board__heading" role="status">{`${view.shown} of ${view.total}`}</div>
        {view.total === 0 ? (
          <div class="agent-board__empty">
            <span>No agents running</span>
            <button
              type="button"
              class="iconbtn"
              aria-label="New agent"
              onClick={() => actions.onNewAgent()}
            >
              <DeckIcon icon={PlusSquare} size={ROW_ICON} />
            </button>
          </div>
        ) : (
          <div class="agent-board__grid" ref={grid} onKeyDown={onGridKey}>
            {view.cards.map((card, index) => (
              // Each card owns local menu state (Task 8); a stable key per
              // pane id keeps that state from leaking onto a different card
              // when the grid re-sorts or re-filters.
              <AgentBoardCard
                key={card.paneId}
                card={card}
                actions={actions}
                tabIndex={index === focusIndex ? 0 : -1}
                onFocusRequest={(focused) => setFocusedPaneId(focused.paneId)}
              />
            ))}
          </div>
        )}
      </div>
      {view.selected !== null && (
        <AgentBoardPanel
          key={view.selected.paneId} // a new card is a new panel: its mount effect places focus once
          card={view.selected}
          state={panel}
          actions={actions}
          onReply={actions.onReply}
          autoFocusReply={view.selected.state === "asked"}
        />
      )}
    </section>
  );
}
