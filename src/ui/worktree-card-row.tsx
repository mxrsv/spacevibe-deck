import { AgentGlyph } from "./controls/agent-glyph";
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
 * The per-pane state indicator: trailing on rows, badged on strip glyphs (DL-27.21).
 * Diverges from the rail's shared `RailStatusMark` on purpose: `idle` paints
 * NOTHING here rather than a gray dot, and `working` never draws the spinner —
 * busy motion is `CardLoad`'s trailing track, not this dot.
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
}

/**
 * One agent, as a list row (DL-27.21): `glyph · name · model pill · state/close`.
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
}: CardAgentRowProps) {
  const label = signalLabelOf(pane.state, pane.confidence, pane.detail);
  const where = whereOf(project, group);

  return (
    <div
      class="asr-card__row"
      data-kind="agent"
      data-state={pane.state}
      data-confidence={pane.confidence}
      data-focused={pane.focused}
      data-pane-id={pane.paneId}
    >
      <button
        type="button"
        class="asr-card__hit"
        aria-current={pane.focused ? "true" : undefined}
        aria-label={`Focus ${pane.label} in ${where}, ${label}`}
        title={`${pane.label} — ${label}`}
        onClick={() => {
          onFocusPane(pane.tabIndex, pane.paneId);
        }}
      />
      <span class="asr-card__glyph">
        <AgentGlyph agent={pane.agent} className="asr-card__logo" />
      </span>
      <span class="asr-card__name">{pane.label}</span>
      {/* Conditional, and it stays conditional inside the segment menu too
          (spec §5): production withholds the model wherever the pane/session
          pairing is heuristic, and a menu that invented one would be the guess
          the row refuses. */}
      {pane.model !== "" && <span class="asr-card__pill">{pane.model}</span>}
      {/* DL-27.21: state and close share one trailing cell without moving the label. */}
      <span class="asr-card__status" aria-hidden="true">
        <CardLoad state={pane.state} />
        {pane.state !== BUSY_STATE && <CardMark state={pane.state} confidence={pane.confidence} />}
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
