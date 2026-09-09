import { WorkspaceSpinner } from "../workspace-spinner";
import type { RailState } from "../agent-rail-model";

/**
 * Lives in `controls/`, not beside `agent-rail.tsx` (which re-exports it for
 * its five existing importers): the Agent Board imports this mark directly,
 * and `agent-rail.tsx` pulls in the rail's host modules that the Board must
 * not depend on.
 *
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
 */
export function RailStatusMark({ state }: { readonly state: RailState }) {
  if (state === "working") {
    return (
      <span class="asr-row__mark asr-row__mark--spinner" data-state="working" aria-hidden="true">
        <WorkspaceSpinner />
      </span>
    );
  }

  return <span class="asr-row__mark" data-state={state} aria-hidden="true" />;
}
