import { WorkspaceSpinner } from "../workspace-spinner";
import type { RailState } from "../agent-rail-model";
import type { SignalConfidence } from "../../terminal/agent-attention";

/**
 * DL-27.3, amended 2026-08-19 (owner, second pass): the slot draws THREE
 * shapes, not one static dot.
 *
 * `working` is the workspace rail's dot-ring, its ink running around a still
 * circle (`WorkspaceSpinner`) rather than a neutral dot — a run in progress is the
 * one state that changes on its own, and a still dot said the opposite. The
 * attention states keep the dot: red `failed`, and `asked` in
 * `--status-unread`, which is what "unread" meant in `AgentAttentionMark`
 * before the rail collapsed the vocabulary. `asked` covers BOTH a question
 * and a finished run nobody has read yet — `agent-rail-model` folds
 * `completed` into it, which is the owner's rule that a finished run you have
 * not checked is unread.
 *
 * `done` and `idle` stop painting nothing: both wear one quiet gray dot, so a
 * row that is simply quiet still says "an agent is here" instead of leaving
 * the column empty. Every state's word stays in `title` and the accessible
 * name either way.
 *
 * Amended 2026-09-03 (agent-signal contract layer, stage 0): the mark also
 * carries its CONFIDENCE. `data-confidence="inferred"` draws an `asked` or
 * `done` dot HOLLOW — Deck read the state off output timing or the process
 * table rather than hearing it from the CLI — and `explicit` draws it filled;
 * `unknown` is the resting dot, which is what an `idle` pane that has seen
 * nothing has always worn. `ended` is the sixth word: a small square in the
 * quiet gray, the stop glyph, for an agent whose process left the pane.
 * `failed` and `working` keep one drawing each: a failure is only ever said
 * by the CLI, and the ring already says "changing on its own".
 */
export function RailStatusMark({
  state,
  confidence = "explicit",
}: {
  readonly state: RailState;
  readonly confidence?: SignalConfidence;
}) {
  if (state === "working") {
    return (
      <span
        class="asr-row__mark asr-row__mark--spinner"
        data-state="working"
        data-confidence={confidence}
        aria-hidden="true"
      >
        <WorkspaceSpinner />
      </span>
    );
  }

  return (
    <span
      class="asr-row__mark"
      data-state={state}
      data-confidence={confidence}
      aria-hidden="true"
    />
  );
}
