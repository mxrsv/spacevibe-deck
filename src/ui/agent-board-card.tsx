import { ArrowCounterClockwise, DotsThreeOutline, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";
import { stateWordFor, type BoardCard } from "./agent-board-model";
import { AgentGlyph } from "./controls/agent-glyph";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";
import { RailStatusMark } from "./controls/rail-status-mark";

/**
 * One Agent Board card (spec §5.3–§5.6, DL-34.2–DL-34.4). A DL-27.1
 * container with a full-bleed hit layer, a DL-27.5 hover column and a `More`
 * menu that holds every action for the keyboard.
 *
 * It was five rows on one even rhythm until 2026-09-09, which read as a list
 * rather than a card. The same facts are now four GROUPS — status, identity,
 * what the agent said, footer — placed by `grid-template-areas` and separated
 * by unequal gaps, so the eye gets a hierarchy instead of a stack. The hover
 * column moved to the foot with them: it sat top-right and forced a permanent
 * 74px void beside the rank, on every card, hovered or not.
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

/**
 * The footer's two figures. `up 12m · 2m` printed two bare durations and only
 * named one of them, so the second read as noise — it is the age of the last
 * output, and `ago` is the word that says so. An unknown figure is still `--`
 * rather than `-- ago`, which would claim a measurement Deck does not have.
 */
export function metaLine(card: BoardCard): string {
  const up = card.up === "" ? "--" : card.up;
  const changed = card.changed === "" ? "--" : `${card.changed} ago`;
  return `up ${up} · ${changed}`;
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
      <div class="board-card__status">
        <RailStatusMark
          state={card.departed ? "ended" : card.state}
          confidence={card.confidence ?? "unknown"}
        />
        <span class="board-label board-card__state">{word}</span>
      </div>
      <span class="board-card__num">{formatRank(card.rank)}</span>
      <div class="board-card__id">
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
        {card.what.text === "" ? (
          // The footer already spells an unknown figure `--`; a pane with
          // nothing to quote gets the same mark rather than a blank band, which
          // read as a card that had failed to load. It states absence, it does
          // not invent a fact (spec §8).
          <span class="board-card__what-empty">—</span>
        ) : (
          card.what.text
        )}
      </div>
      <div class="board-card__meta">{metaLine(card)}</div>
      <div class="board-card__actions">
        {stopOrRestart}
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
