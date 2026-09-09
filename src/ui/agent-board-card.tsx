import {
  ArrowCounterClockwise,
  ArrowsOutSimple,
  DotsThreeOutline,
  Stop,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import { stateWordFor, type BoardCard } from "./agent-board-model";
import { AgentGlyph } from "./controls/agent-glyph";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";
import { RailStatusMark } from "./controls/rail-status-mark";

/**
 * One Agent Board card (spec §5.3–§5.6, DL-34.2–DL-34.4). A DL-27.1
 * container with a full-bleed hit layer, five rows, a DL-27.5 hover column
 * and a `More` menu that holds every action for the keyboard.
 */
export interface BoardCardActions {
  /** `null` closes the panel — the composition's Escape sends it. */
  onSelect(card: BoardCard | null): void;
  onOpenInStage(card: BoardCard): void;
  onStop(card: BoardCard): void;
  onRestart(card: BoardCard): void;
  onClose(card: BoardCard): void;
}

export interface AgentBoardCardProps {
  readonly card: BoardCard;
  readonly actions: BoardCardActions;
  readonly tabIndex: 0 | -1;
  readonly onFocusRequest: (card: BoardCard) => void;
}

export function formatRank(rank: number): string {
  return rank < 10 ? `0${rank}` : String(rank);
}

function accessibleName(card: BoardCard): string {
  const tier = card.confidence === "inferred" ? ", inferred" : "";
  return `${card.name}, ${stateWordFor(card)}${tier}, ${card.where}`;
}

export function AgentBoardCard({ card, actions, tabIndex, onFocusRequest }: AgentBoardCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const hitRef = useRef<HTMLButtonElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);

  // The keyboard reaches the actions through `More` alone (spec §5.6): the
  // hover column left the Tab order after the eye pass counted 27 stops
  // between the grid and the panel, three per card. `More` is therefore
  // opened the way a context menu is — Shift+F10 or the ContextMenu key, on
  // the card itself — and closing it hands focus back to the card, never to
  // <body> as it did before.
  const closeMenu = (): void => {
    setMenuOpen(false);
    hitRef.current?.focus();
  };
  const onCardKey = (event: KeyboardEvent): void => {
    const contextMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
    if (!contextMenu || menuOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(true);
  };

  // Reachable only after tabbing in otherwise (review finding #6): focus the
  // menu's first row on open, and let a press outside the card dismiss it —
  // the Board's own Escape stays the keyboard's way out either way.
  useEffect(() => {
    if (!menuOpen) return;
    firstMenuItemRef.current?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      if (articleRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const word = stateWordFor(card);
  const stopOrRestart = card.departed ? (
    <button
      type="button"
      class="iconbtn"
      tabIndex={-1}
      data-action="restart"
      aria-label={`Restart ${card.name}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.onRestart(card);
      }}
    >
      <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
    </button>
  ) : (
    <button
      type="button"
      class="iconbtn"
      tabIndex={-1}
      data-action="stop"
      aria-label={`Stop ${card.name}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.onStop(card);
      }}
    >
      <DeckIcon icon={Stop} size={ROW_ICON} />
    </button>
  );

  return (
    <article
      ref={articleRef}
      class="board-card"
      data-state={card.state}
      data-pane-id={card.paneId}
      data-departed={card.departed ? "" : undefined}
      data-menu={menuOpen ? "open" : undefined}
      aria-current={card.selected ? "true" : undefined}
      onKeyDown={onCardKey}
    >
      <button
        ref={hitRef}
        type="button"
        class="board-card__hit"
        tabIndex={tabIndex}
        aria-label={accessibleName(card)}
        // DECK-43: a press opens that agent's pane on the stage. It SELECTED
        // until 2026-09-09, when the detail panel a selection raised was
        // removed — the pane itself is what the panel's snapshot approximated,
        // so the press goes straight to it and the double-click that used to
        // be the shortcut for it is gone with the distinction.
        onClick={() => actions.onOpenInStage(card)}
        onFocus={() => onFocusRequest(card)}
      />
      <div class="board-card__row board-card__row--head">
        <RailStatusMark
          state={card.departed ? "ended" : card.state}
          confidence={card.confidence ?? "unknown"}
        />
        <span class="board-label board-card__state">{word}</span>
        <span class="board-card__num">{formatRank(card.rank)}</span>
      </div>
      <div class="board-card__row">
        <AgentGlyph agent={card.agent} className="board-card__glyph" />
        <span class="board-card__name">{card.name}</span>
      </div>
      <div class="board-card__where">{card.where}</div>
      <div class="board-card__what" data-kind={card.what.kind}>
        {card.what.kind === "task" && (
          <>
            <span class="board-card__what-prefix">Task</span>{" "}
          </>
        )}
        {card.what.text}
      </div>
      <div class="board-card__meta">{`up ${card.up === "" ? "--" : card.up} · ${card.changed === "" ? "--" : card.changed}`}</div>
      <div class="board-card__actions">
        {stopOrRestart}
        <button
          type="button"
          class="iconbtn"
          tabIndex={-1}
          data-action="open"
          aria-label={`Open ${card.name} in stage`}
          onClick={(event) => {
            event.stopPropagation();
            actions.onOpenInStage(card);
          }}
        >
          <DeckIcon icon={ArrowsOutSimple} size={ROW_ICON} />
        </button>
        <button
          type="button"
          class="iconbtn"
          tabIndex={-1}
          data-action="more"
          aria-label={`More actions for ${card.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <DeckIcon icon={DotsThreeOutline} size={ROW_ICON} />
        </button>
      </div>
      {menuOpen && (
        <div
          class="board-card__menu"
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // The Board's own Escape (panel, then step back) must not fire too.
              event.stopPropagation();
              closeMenu();
            }
          }}
        >
          <button
            ref={firstMenuItemRef}
            type="button"
            role="menuitem"
            class="board-card__menu-row"
            data-action="open"
            onClick={() => {
              setMenuOpen(false);
              actions.onOpenInStage(card);
            }}
          >
            Open in stage
          </button>
          {card.departed ? (
            <button
              type="button"
              role="menuitem"
              class="board-card__menu-row"
              data-action="restart"
              onClick={() => {
                setMenuOpen(false);
                actions.onRestart(card);
              }}
            >
              Restart
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              class="board-card__menu-row"
              data-action="stop"
              onClick={() => {
                setMenuOpen(false);
                actions.onStop(card);
              }}
            >
              Stop
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            class="board-card__menu-row"
            data-action="close"
            onClick={() => {
              setMenuOpen(false);
              actions.onClose(card);
            }}
          >
            Close
          </button>
        </div>
      )}
    </article>
  );
}
