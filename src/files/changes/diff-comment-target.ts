/**
 * Which agent pane a diff comment can go to (spec 2026-10-21-diff-line-comments,
 * DLC6–8).
 *
 * Candidates are the panes the rail already files under the diff's checkout, so a
 * worktree nested inside another checkout keeps its agents to itself. The last
 * pick per checkout is remembered for this window only.
 */
import type { PaneProcessInfo } from "../../lib/process-info";
import type { RailStreamGroup } from "../../ui/agent-rail-model";
import type { CommentTarget } from "./diff-comment-sender";

export interface CommentCandidate {
  readonly paneId: number;
  readonly agent: string;
  /** The rail's own name for the pane, unique within its checkout. */
  readonly label: string;
}

const normalizeRoot = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** The live agent panes of the checkout whose root is `root`. */
export function commentCandidates(
  stream: readonly RailStreamGroup[],
  root: string,
): readonly CommentCandidate[] {
  const wanted = normalizeRoot(root);
  return stream
    .flatMap((cluster) => cluster.worktrees)
    .filter((group) => normalizeRoot(group.path) === wanted)
    .flatMap((group) => group.panes)
    .filter((pane) => pane.state !== "ended")
    .map((pane) => ({ paneId: pane.paneId, agent: pane.agent, label: pane.label }));
}

/** The pane to preselect, or null when the user has to pick. */
export function preselectedPane(
  candidates: readonly CommentCandidate[],
  remembered: number | null,
): number | null {
  if (candidates.length === 1) {
    return candidates[0].paneId;
  }
  return candidates.find((candidate) => candidate.paneId === remembered)?.paneId ?? null;
}

export interface CommentPicks {
  recall(root: string): number | null;
  remember(root: string, paneId: number): void;
}

export function createCommentPicks(): CommentPicks {
  const picks = new Map<string, number>();
  return {
    recall: (root) => picks.get(normalizeRoot(root)) ?? null,
    remember: (root, paneId) => {
      picks.set(normalizeRoot(root), paneId);
    },
  };
}

let shared: CommentPicks | null = null;

/** The window's remembered picks. Window-scoped (R5). */
export function commentPicks(): CommentPicks {
  shared ??= createCommentPicks();
  return shared;
}

/**
 * Pins the candidate to the agent process it runs right now, read fresh: the
 * rail's snapshot may be seconds old. Null when the pane no longer runs an agent
 * or the host cannot name its process.
 */
export async function captureCommentTarget(
  candidate: CommentCandidate,
  freshInfo: (paneId: number) => Promise<PaneProcessInfo | undefined>,
): Promise<CommentTarget | null> {
  const info = await freshInfo(candidate.paneId);
  const processId = info?.processId;
  if (info?.kind !== "agent" || info.agent === null || !Number.isSafeInteger(processId)) {
    return null;
  }
  return { paneId: candidate.paneId, agent: info.agent, processId: processId as number };
}
