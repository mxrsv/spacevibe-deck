import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { AgentGlyph } from "../controls/agent-glyph";
import {
  attentionEntryName,
  attentionFooterText,
  type AttentionEntry,
  type AttentionList,
} from "../attention-list-model";

/**
 * The needs-you list itself: the failed and asked panes as DL-13.8 two-line
 * rows, then one line counting everything that is not listed.
 *
 * Positioning, dismissal and the stage overlay flag belong to
 * [`AttentionPopover`](./attention-popover.tsx); this is only the surface, so
 * the gallery can draw it in flow beside its neighbours and the popover can
 * hang it from the strip.
 *
 * A row is a plain `<button>`: its whole job is one choice, and the choice is a
 * pane (DL-27.26). Nothing here answers an agent — no approve, no deny, no
 * reply — because the popover only sends the user to where the agent is.
 */

export interface AttentionPanelProps {
  readonly list: AttentionList;
  /** The user chose this entry: focus its exact pane and no other. */
  onChoose(entry: AttentionEntry): void;
  /** `AttentionPopover` fixes it under the chip; a specimen leaves it in flow. */
  readonly floating?: boolean;
  readonly style?: JSX.CSSProperties;
}

/** The row to land on for an arrow key; wraps at both ends. */
export function nextRow(current: number, count: number, key: string): number {
  if (count === 0) {
    return -1;
  }
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    default:
      return current <= 0 ? count - 1 : current - 1;
  }
}

const MOVES: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function AttentionRow({
  entry,
  onChoose,
}: {
  readonly entry: AttentionEntry;
  onChoose(entry: AttentionEntry): void;
}) {
  return (
    <button
      type="button"
      class="attn-row"
      data-state={entry.state}
      data-confidence={entry.confidence}
      // DL-27.2: the state word lives in the accessible name, and so does the
      // doubt where it changes the meaning (DL-27.3). The visible text below
      // is for the eye; the name is what a screen reader speaks.
      aria-label={attentionEntryName(entry)}
      onClick={() => onChoose(entry)}
    >
      <span class="attn-row__glyph" aria-hidden="true">
        <AgentGlyph agent={entry.agent} className="attn-row__logo" />
        <span class="attn-row__dot" data-state={entry.state} />
      </span>
      <span class="attn-row__title">
        {entry.reason}
        {/* DL-27.3's word for a state Deck read off output timing. */}
        {entry.inferred && <span class="attn-row__doubt"> · inferred</span>}
      </span>
      {entry.age !== "" && <span class="attn-row__age">{entry.age}</span>}
      <span class="attn-row__detail">{entry.place}</span>
    </button>
  );
}

export function AttentionPanel({ list, onChoose, floating = false, style }: AttentionPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const footer = attentionFooterText(list.footer);

  const rows = (): HTMLButtonElement[] =>
    Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".attn-row") ?? []);

  const onKeyDown = (event: KeyboardEvent): void => {
    const all = rows();
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    if (MOVES.has(event.key)) {
      event.preventDefault();
      all[nextRow(current, all.length, event.key)]?.focus();
      return;
    }
    // Enter is claimed here, not left to the button's own activation, so a row
    // is chosen exactly once whichever way the browser synthesizes the click.
    // Space still activates natively, on key-up.
    if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      const entry = list.entries[current];
      if (entry !== undefined) {
        onChoose(entry);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      class={`attn-pop ${floating ? "attn-pop--floating" : ""}`}
      // DL-13.2: the surface is a dialog with a label.
      role="dialog"
      aria-label="Needs you"
      style={style}
      onKeyDown={onKeyDown}
    >
      <ul class="attn-pop__list">
        {list.entries.map((entry) => (
          <li key={entry.key}>
            <AttentionRow entry={entry} onChoose={onChoose} />
          </li>
        ))}
      </ul>
      {footer !== "" && <p class="attn-pop__foot">{footer}</p>}
    </div>
  );
}
