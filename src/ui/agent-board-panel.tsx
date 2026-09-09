import { useEffect, useRef } from "preact/hooks";
import type { BoardCardActions } from "./agent-board-card";
import { stateWordFor, type BoardCard } from "./agent-board-model";

/**
 * Tier 2 (spec §7, DL-34.6, DL-34.7): title, key-value rows, the scrollback
 * snapshot, the reply box, the actions. Every fact here is handed in; the
 * panel never reads a store, so the gallery can mount it over a fixture.
 */
export interface BoardPanelState {
  readonly snapshot: string | null;
  readonly replyEnabled: boolean;
  readonly replyNotice: string | null;
  readonly sending: boolean;
  readonly paneExited: boolean;
}

export interface AgentBoardPanelProps {
  readonly card: BoardCard;
  readonly state: BoardPanelState;
  readonly actions: BoardCardActions;
  readonly onReply: (card: BoardCard, text: string) => void;
  readonly autoFocusReply: boolean;
}

interface Row {
  readonly key: string;
  readonly value: string | null;
  readonly faintSuffix?: string;
}

function rows(card: BoardCard): readonly Row[] {
  const placed = card.task !== null && card.what.kind !== "task";
  return [
    {
      key: "State",
      value: stateWordFor(card),
      faintSuffix: card.confidence === "inferred" ? " · inferred" : undefined,
    },
    { key: "Checkout", value: card.checkout },
    { key: "Branch", value: card.branch },
    { key: "Directory", value: card.directory },
    { key: "Up", value: card.up === "" ? null : card.up },
    { key: "Changed", value: card.changed === "" ? null : card.changed },
    { key: "Task", value: card.task, faintSuffix: placed ? " — placed, not sent" : undefined },
    { key: "Last turn", value: card.tail },
  ];
}

const REPLY_MAX_ROWS = 4;

/**
 * Rows of scrollback the snapshot carries (spec §7.3, DL-34.6). Forty reads as
 * activity without becoming a second terminal, and `.board-panel__snapshot`'s
 * own `max-height: 40vh` scrolls whatever does not fit. It lives here rather
 * than beside the seam because it is a fact about this treatment: the number
 * and the CSS that bounds it have to move together.
 */
export const BOARD_SNAPSHOT_LINES = 40;

export function AgentBoardPanel({
  card,
  state,
  actions,
  onReply,
  autoFocusReply,
}: AgentBoardPanelProps) {
  const reply = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  // Spec §7.4: an `asked` card opens with the reply box focused; otherwise
  // focus lands on the panel itself, so Escape and Tab start from here. Runs
  // ONCE per mount — the composition keys the panel by pane id, so a new card
  // is a new mount, and a later `replyEnabled` flip cannot steal focus from
  // the grid.
  useEffect(() => {
    if (autoFocusReply && state.replyEnabled) {
      reply.current?.focus();
    } else {
      root.current?.focus();
    }
    // Mount only, by design — see the comment above.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "One line growing to four" (spec §7.4): the row count follows the text.
  const grow = (): void => {
    const box = reply.current;
    if (!box) return;
    const lines = box.value.split("\n").length;
    box.rows = Math.min(REPLY_MAX_ROWS, Math.max(1, lines));
  };

  const submit = (): void => {
    const box = reply.current;
    if (!box || !state.replyEnabled || state.sending) return;
    const text = box.value.trim();
    if (text === "") return;
    onReply(card, text);
    box.value = "";
    grow(); // back to one row
  };
  const busy = state.sending;

  return (
    <aside ref={root} class="agent-board__panel" aria-label={`${card.name} details`} tabIndex={-1}>
      <h2 class="board-panel__title">{card.name}</h2>
      <dl class="board-panel__kv">
        {rows(card).flatMap((row) =>
          row.value === null
            ? []
            : [
                <dt key={`${row.key}-k`} class="board-panel__key">
                  {row.key}
                </dt>,
                <dd key={`${row.key}-v`} class="board-panel__value">
                  {row.key === "State" ? <span class="board-label">{row.value}</span> : row.value}
                  {row.faintSuffix !== undefined && (
                    <span class="board-panel__confidence">{row.faintSuffix}</span>
                  )}
                </dd>,
              ],
        )}
      </dl>
      {state.snapshot !== null && <pre class="board-panel__snapshot">{state.snapshot}</pre>}
      <textarea
        ref={reply}
        class="board-panel__reply"
        rows={1}
        placeholder={state.replyEnabled ? "Reply — Enter sends" : "No agent to answer"}
        disabled={!state.replyEnabled || busy}
        aria-label={`Reply to ${card.name}`}
        onInput={grow}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {state.replyNotice !== null && (
        <p class="board-panel__notice" role="status">
          {state.replyNotice}
        </p>
      )}
      <div class="board-panel__actions">
        <button
          type="button"
          class="board-panel__action"
          data-action="open"
          disabled={busy}
          onClick={() => actions.onOpenInStage(card)}
        >
          Open in stage
        </button>
        {card.departed ? (
          <button
            type="button"
            class="board-panel__action"
            data-action="restart"
            disabled={busy || state.paneExited}
            onClick={() => actions.onRestart(card)}
          >
            Restart
          </button>
        ) : (
          <button
            type="button"
            class="board-panel__action"
            data-action="stop"
            disabled={busy || state.paneExited}
            onClick={() => actions.onStop(card)}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          class="board-panel__action"
          data-action="close"
          disabled={busy}
          onClick={() => actions.onClose(card)}
        >
          Close
        </button>
      </div>
    </aside>
  );
}
