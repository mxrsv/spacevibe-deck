import { PlusSquare } from "@phosphor-icons/react";
import { useRef, useState } from "preact/hooks";
import { AgentBoardCard, type BoardCardActions } from "./agent-board-card";
import {
  cardForDigit,
  type AgentBoardView,
  type BoardCard,
  type BoardStatusFilter,
} from "./agent-board-model";
import type { BoardPanelState } from "./agent-board-panel";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";

/**
 * The Agent Board (spec §4–§7, DL §34): a grid of cards on the stage, inside
 * the SAME frame the Inbox uses — the rail on the left, the dock on the right,
 * both exactly as the user left them (DECK-43, 2026-09-09, owner-asked).
 *
 * It had three columns of its own until then: a STATUS/PROJECTS nav, the grid,
 * and a detail panel that quoted the selected pane's last 40 lines. Both side
 * columns are GONE from the render, and a card press no longer selects — it
 * opens that agent's pane on the stage, which is what the panel's snapshot was
 * an approximation of. `AgentBoardNav` and `AgentBoardPanel` still build and
 * still have their own suites (the §24 theme-gallery precedent); nothing
 * mounts them, so `view.selected` stays null and the panel's snapshot timer
 * never has a selection to refresh.
 *
 * Presentational — every fact arrives in `view` and every effect leaves through
 * `actions`, so the gallery mounts the real thing over a fixture and the wiring
 * binds it to the stores without touching this file.
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
  /**
   * Unread since DECK-43 removed the panel, and kept rather than dropped: it
   * is what a revert re-mounts, and `App` computes it either way.
   */
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

export function AgentBoard({ view, actions }: AgentBoardProps) {
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
    // Spec §5.5's tier 3, and since DECK-43 the same thing plain Enter on the
    // focused card does — the chord is kept because it is the one a user who
    // learned it already presses.
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
      // The keyboard twin of a press: a digit opens that agent's pane. It
      // SELECTED until DECK-43, which is a word with no surface left.
      actions.onOpenInStage(digit);
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
    // One Escape, not two (DL-34.9): the panel that owned the first press is
    // no longer rendered, so a first-press branch here would be a branch
    // nothing can reach.
    actions.onEscape();
  };

  return (
    <section class="agent-board" aria-label="Agent Board" onKeyDown={onRootKey}>
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
    </section>
  );
}
