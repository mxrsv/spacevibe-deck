import { describe, expect, it } from "vitest";
import type { PaneProcessInfo } from "../../lib/process-info";
import type { RailStreamGroup, RailWorktreeGroup } from "../../ui/agent-rail-model";
import {
  captureCommentTarget,
  commentCandidates,
  createCommentPicks,
  preselectedPane,
} from "./diff-comment-target";

interface FakePane {
  readonly paneId: number;
  readonly state?: string;
}

function worktree(path: string, panes: readonly FakePane[]): RailWorktreeGroup {
  return {
    path,
    panes: panes.map(({ paneId, state }) => ({
      paneId,
      agent: "claude",
      state: state ?? "idle",
      label: `pane ${paneId}`,
    })),
  } as unknown as RailWorktreeGroup;
}

const stream = (...worktrees: RailWorktreeGroup[]): readonly RailStreamGroup[] =>
  [{ worktrees }] as unknown as readonly RailStreamGroup[];

const PRIMARY = "/repo";
const NESTED = "/repo/.claude/worktrees/feature";

describe("commentCandidates", () => {
  it("lists the live agent panes of the checkout", () => {
    const rail = stream(worktree(PRIMARY, [{ paneId: 1 }, { paneId: 2, state: "working" }]));
    expect(commentCandidates(rail, PRIMARY)).toEqual([
      { paneId: 1, agent: "claude", label: "pane 1" },
      { paneId: 2, agent: "claude", label: "pane 2" },
    ]);
  });

  it("leaves a nested worktree's agent out of the primary's candidates", () => {
    const rail = stream(worktree(PRIMARY, [{ paneId: 1 }]), worktree(NESTED, [{ paneId: 7 }]));
    expect(commentCandidates(rail, PRIMARY).map((c) => c.paneId)).toEqual([1]);
    expect(commentCandidates(rail, NESTED).map((c) => c.paneId)).toEqual([7]);
  });

  it("skips ended panes and matches a root written with a trailing slash", () => {
    const rail = stream(worktree(PRIMARY, [{ paneId: 1, state: "ended" }, { paneId: 2 }]));
    expect(commentCandidates(rail, `${PRIMARY}/`).map((c) => c.paneId)).toEqual([2]);
  });

  it("is empty for a checkout with no agent", () => {
    expect(commentCandidates(stream(worktree(PRIMARY, [])), PRIMARY)).toEqual([]);
    expect(commentCandidates(stream(), PRIMARY)).toEqual([]);
  });
});

describe("preselectedPane", () => {
  const one = [{ paneId: 3, agent: "claude", label: "a" }];
  const two = [...one, { paneId: 4, agent: "codex", label: "b" }];

  it("preselects the only candidate", () => {
    expect(preselectedPane(one, null)).toBe(3);
    expect(preselectedPane(one, 99)).toBe(3);
  });

  it("preselects the remembered pane of several while it is alive", () => {
    expect(preselectedPane(two, 4)).toBe(4);
  });

  it("leaves the pick to the user with several and no live remembered pane", () => {
    expect(preselectedPane(two, null)).toBeNull();
    expect(preselectedPane(two, 99)).toBeNull();
    expect(preselectedPane([], null)).toBeNull();
  });
});

describe("createCommentPicks", () => {
  it("remembers per checkout", () => {
    const picks = createCommentPicks();
    expect(picks.recall(PRIMARY)).toBeNull();
    picks.remember(PRIMARY, 4);
    picks.remember(NESTED, 7);
    expect(picks.recall(`${PRIMARY}/`)).toBe(4);
    expect(picks.recall(NESTED)).toBe(7);
  });
});

describe("captureCommentTarget", () => {
  const candidate = { paneId: 5, agent: "claude", label: "a" };
  const info = (patch: Partial<PaneProcessInfo>): PaneProcessInfo => ({
    id: 5,
    processId: 900,
    cwd: PRIMARY,
    process: "claude",
    kind: "agent",
    agent: "claude",
    ...patch,
  });

  it("pins the pane to the agent and process it runs now", async () => {
    await expect(captureCommentTarget(candidate, async () => info({}))).resolves.toEqual({
      paneId: 5,
      agent: "claude",
      processId: 900,
    });
  });

  it("refuses a pane that no longer runs an agent or has no readable process", async () => {
    for (const reply of [
      undefined,
      info({ kind: "idle-shell", agent: null }),
      info({ processId: null }),
    ]) {
      await expect(captureCommentTarget(candidate, async () => reply)).resolves.toBeNull();
    }
  });
});
