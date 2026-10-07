import { useEffect, useRef, useState } from "preact/hooks";
import { AgentGlyph } from "./controls/agent-glyph";
import { SpaceRenameField } from "./spaces/space-rename-field";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { X } from "@phosphor-icons/react";
import { subjectOf, subjectWhere } from "./agent-rail-card-model";
import type { RailCardPane, RailState, RailWorktreeGroup } from "./agent-rail-model";
import type { SignalConfidence } from "../terminal/agent-attention";

/**
 * The parts a worktree card and its popovers BOTH draw.
 *
 * Split out of `worktree-card.tsx` on 2026-08-27 (spec
 * `docs/internals/agent-rail.md`): the segment
 * menu lists the panes behind a segment as the production `.asr-card__row`,
 * "reused rather than restated, so the glyph, the state dot, the model pill,
 * the hover wash and DL-27.21's ✕ all arrive for free". Reuse across two
 * components needs one owner — importing the row back out of `worktree-card`
 * would be a cycle, since the card imports the menus.
 *
 * Nothing here changed in behaviour when it moved; the card's own header
 * comment still owns the class vocabulary and the host-parity decision.
 */

/**
 * DL-27.2: the mark is the fast read and never the only read — every state
 * says its name in the accessible name.
 */
export const STATE_LABEL: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "needs you",
  ended: "ended",
  working: "working",
  done: "done",
  idle: "idle",
};

/**
 * `STATE_LABEL` plus the confidence, where the confidence changes the meaning
 * (DL-27.3, amended 2026-09-03): an inferred `asked`/`done` is Deck's reading
 * of output timing, not the CLI's word, and the accessible name says so. A
 * contract-layer `detail` (`permission prompt`, `input needed`) rides on an
 * `asked` the same way: the word says what is waited on, not just that
 * something is.
 */
export function signalLabelOf(
  state: RailState,
  confidence?: SignalConfidence,
  detail?: string | null,
): string {
  const word = STATE_LABEL[state];
  if (state === "asked" && typeof detail === "string" && detail !== "") {
    return `${word} — ${detail}`;
  }
  return confidence === "inferred" && (state === "asked" || state === "done")
    ? `${word} (inferred)`
    : word;
}

/** The one state that means "the machine is busy" (spec §11.3: `thinking` was dropped). */
export const BUSY_STATE: RailState = "working";

/**
 * The states that need the user. Only these rows keep their logo's full ink;
 * every other row's logo goes quiet (DL-27.21, amended 2026-10-06), so the rows
 * asking for the user are the only full-colour logos in the column.
 */
export function needsUser(state: RailState): boolean {
  return state === "asked" || state === "failed";
}

/**
 * `project · checkout · branch` — the accessible-name prefix every control on
 * a card carries, matching what the shipped rail's `whereOf` produced before
 * the tab tier's removal took the project name out of this component's reach.
 *
 * **A segment it has already said is dropped.** A repository's primary
 * checkout sits at the repository root, so its folder basename IS the project
 * name, and the composed string said `spacevibe-board · spacevibe-board ·
 * main` — the same repetition the card head carries, reaching every accessible
 * name, tooltip and menu label at once. Deduplicating here rather than at each
 * caller is what makes one fix cover all of them; `checkoutLabel` is asked for
 * the checkout's word so the string and the head can never disagree.
 */
export function whereOf(project: string, group: RailWorktreeGroup): string {
  // One rule, stated once: `subjectWhere` is what the free-standing actions
  // menu prints as its heading, so the row's name and that heading cannot drift.
  return subjectWhere(subjectOf(project, group));
}

/**
 * The per-pane state badge, drawn on the corner of the agent logo in both
 * places a logo appears — the row's (larger, row-scoped size) and the closed
 * strip's glyph (DL-27.21, amended 2026-10-06).
 * Diverges from the rail's shared `RailStatusMark` on purpose: `idle` paints
 * NOTHING here rather than a gray dot, and `working` never draws the spinner —
 * busy motion is `CardLoad`'s trailing track, not this dot. A row therefore
 * does not call this for a working pane: one state signal per row.
 */
export function CardMark({
  state,
  confidence = "explicit",
}: {
  readonly state: RailState;
  readonly confidence?: SignalConfidence;
}) {
  if (state === "idle") {
    return null;
  }
  // Keep confidence available to callers; card dots use solid state colors.
  // The row/segment label carries the inferred qualifier (DL-27.3).
  return (
    <span
      class="asr-card__dot"
      data-state={state}
      data-confidence={confidence}
      aria-hidden="true"
    />
  );
}

/**
 * The trailing loading track: three staggered bars while the pane is working,
 * nothing otherwise — but the ELEMENT always renders, so an idle
 * row's model pill lands on the same right edge a busy row's does.
 */
export function CardLoad({ state }: { readonly state: RailState }) {
  const busy = state === BUSY_STATE;
  return (
    <span class="asr-card__load" data-busy={busy} aria-hidden="true">
      {busy && (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}

export interface CardAgentRowProps {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly pane: RailCardPane;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  /**
   * Name (or, with `null`, unname) this pane's tab. A double-click on the row
   * opens the field; omitted where nothing can wire it, like the segment
   * menu's copy of the row, which then has no rename gesture.
   */
  readonly onRenameTab?: (tabIndex: number, name: string | null) => void;
}

/**
 * The row's text (DL-27.15). An unnamed tab's pane is one line, its sentence.
 * A named tab's pane is two: the name in semibold, then that pane's sentence —
 * the name says which space, the sentence what this agent is doing. While the
 * field is open it takes the name's line and the sentence stays beneath, so
 * the row does not change height.
 */
function CardRowText({
  pane,
  editing,
  onCommit,
  onCancel,
}: {
  readonly pane: RailCardPane;
  readonly editing: boolean;
  readonly onCommit: (name: string | null) => void;
  readonly onCancel: () => void;
}) {
  const named = pane.tabName !== null && pane.tabName !== undefined;
  const sentence = pane.sentence ?? pane.label;
  if (!editing && !named) {
    return <span class="asr-card__name">{pane.label}</span>;
  }
  return (
    <span class="asr-card__text" data-editing={editing ? "true" : undefined}>
      {editing ? (
        <SpaceRenameField
          class="asr-card__rename"
          initial={pane.tabName ?? ""}
          placeholder={sentence}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      ) : (
        <span class="asr-card__name">{pane.tabName}</span>
      )}
      {named && <span class="asr-card__sentence">{sentence}</span>}
    </span>
  );
}

/**
 * One agent, as a list row (DL-27.21): `glyph + state badge · name · model pill · bars/close`.
 * The whole row is the button — DL-27.21 still requires its own
 * close, so the row is a container with a full-bleed hit layer (DL-27.1's
 * shape) rather than a literal `<button>`, which could not also hold a real
 * closable ✕.
 */
export function CardAgentRow({
  project,
  group,
  pane,
  onFocusPane,
  onClosePane,
  onRenameTab,
}: CardAgentRowProps) {
  const label = signalLabelOf(pane.state, pane.confidence, pane.detail);
  const where = whereOf(project, group);
  const hit = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const wasEditing = useRef(false);

  // Unmounting the field drops focus to <body>; hand it back to the row. A
  // press elsewhere that ended the edit has already moved focus, so it stays.
  useEffect(() => {
    if (wasEditing.current && !editing && document.activeElement === document.body) {
      hit.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div
      class="asr-card__row"
      data-kind="agent"
      data-state={pane.state}
      data-confidence={pane.confidence}
      data-focused={pane.focused}
      data-named={pane.tabName ? "true" : undefined}
      data-quiet={needsUser(pane.state) ? undefined : "true"}
      data-pane-id={pane.paneId}
    >
      <button
        ref={hit}
        type="button"
        class="asr-card__hit"
        aria-current={pane.focused ? "true" : undefined}
        aria-label={`Focus ${pane.label} in ${where}, ${label}`}
        title={`${pane.label} — ${label}`}
        onClick={() => {
          onFocusPane(pane.tabIndex, pane.paneId);
        }}
        onDblClick={onRenameTab === undefined ? undefined : () => setEditing(true)}
      />
      <span class="asr-card__glyph">
        <AgentGlyph agent={pane.agent} className="asr-card__logo" />
        {/* DL-27.21, amended 2026-10-06: the state is the strip's corner badge on the
            row's own logo. A working row draws its bars in the trailing cell instead,
            so it carries no dot — one state signal per row. */}
        {pane.state !== BUSY_STATE && <CardMark state={pane.state} confidence={pane.confidence} />}
      </span>
      <CardRowText
        pane={pane}
        editing={editing}
        onCommit={(name) => {
          setEditing(false);
          onRenameTab?.(pane.tabIndex, name);
        }}
        onCancel={() => setEditing(false)}
      />
      {/* Conditional, and it stays conditional inside the segment menu too
          (spec §5): production withholds the model wherever the pane/session
          pairing is heuristic, and a menu that invented one would be the guess
          the row refuses. */}
      {pane.model !== "" && <span class="asr-card__pill">{pane.model}</span>}
      {/* DL-27.21: the working bars and close share one trailing cell without moving the label. */}
      <span class="asr-card__status" aria-hidden="true">
        <CardLoad state={pane.state} />
      </span>
      {/* DL-27.21, kept: every agent row closes its own pane — the same
          `asr-row__actions` / `asr-row__action--close` vocabulary the old tab
          row and its leaves both used, not a card-local reinvention of it. */}
      <div class="asr-row__actions">
        <button
          type="button"
          class="asr-row__action asr-row__action--close"
          aria-label={`Close ${pane.label} in ${where}`}
          onClick={() => {
            onClosePane(pane.tabIndex, pane.paneId);
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    </div>
  );
}
