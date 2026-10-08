import { describe, expect, it, vi } from "vitest";
import { actionGroups, type CardActions } from "./worktree-card-menus";
import type { MenuSubject } from "./agent-rail-card-model";

/**
 * The actions menu's row set (spec
 * `docs/internals/agent-rail.md`;
 * `openspec/changes/rail-create-consolidation` for the subject, the
 * free-standing placement and the board row).
 *
 * DL-19.7 is the rule under test: a row whose host cannot answer is OMITTED,
 * never shown inert — which is exactly what leaves Tauri with the agent rows
 * and the split row, and nothing else.
 */

const CHECKOUT: MenuSubject = {
  project: "repo",
  // A LINKED worktree, so its repository is a different path from the checkout.
  path: "/repo/wt",
  repositoryPath: "/repo",
  branch: "feat/strip-actions",
  label: "wt",
  labelled: true,
};

function actions(extra: Partial<CardActions> = {}): CardActions {
  return {
    agents: [{ id: "claude", label: "Claude", detail: "Sonnet 4.5" }],
    // A non-empty list can only have come from a settled probe, so the default
    // fixture states the pair that actually occurs together.
    agentsResolved: true,
    onRunAgent: () => {},
    onSplitHere: () => {},
    ...extra,
  };
}

const ids = (groups: readonly (readonly { readonly id: string }[])[]): string[] =>
  groups.flat().map((row) => row.id);

describe("actionGroups", () => {
  it("offers one row per runnable agent, plus the split row, on any host", () => {
    expect(ids(actionGroups(actions(), CHECKOUT))).toEqual(["run:claude", "split"]);
  });

  it("adds the OS rows only where the host can answer them", () => {
    const full = actions({
      onOpenFolder: () => {},
      onOpenShell: () => {},
    });
    expect(actionGroups(full, CHECKOUT).map((group) => group.map((row) => row.id))).toEqual([
      ["run:claude"],
      ["shell", "split", "finder"],
    ]);
  });

  /**
   * **Inverted, not deleted (owner, 2026-08-30).** This used to assert that an
   * empty agent group is DROPPED. That is the defect: `agentOptions` emits a
   * built-in only when the probe returned a path for it, so a probe that has
   * not landed and a machine with nothing installed both arrive as `[]`, and
   * dropping the group left the menu built to launch agents offering none.
   */
  it("states a pending probe instead of dropping the group", () => {
    const groups = actionGroups(actions({ agents: [], agentsResolved: false }), CHECKOUT);
    expect(ids(groups)).toEqual(["agents-pending", "split"]);
    const pending = groups.flat()[0];
    expect(pending?.kind).toBe("note");
    if (pending?.kind === "note") {
      expect(pending.text).toContain("Looking for");
    }
  });

  it("offers a way out when the probe answered and found nothing", () => {
    const manage = vi.fn();
    const groups = actionGroups(
      actions({ agents: [], agentsResolved: true, onManageAgents: manage }),
      CHECKOUT,
    );
    expect(ids(groups)).toEqual(["agents-settings", "split"]);
    const row = groups.flat()[0];
    // Pressable, so it joins the roving focus — the missing-row precedent
    // (2026-08-19): route to Settings rather than spawn `command not found`.
    expect(row?.kind).toBe("action");
    if (row?.kind === "action") {
      row.run();
    }
    expect(manage).toHaveBeenCalledTimes(1);
  });

  it("still states the absence when nothing can open Settings (DL-19.7)", () => {
    const groups = actionGroups(actions({ agents: [], agentsResolved: true }), CHECKOUT);
    expect(ids(groups)).toEqual(["agents-none", "split"]);
    expect(groups.flat()[0]?.kind).toBe("note");
  });

  it("routes every row at THIS checkout's path", () => {
    const seen: string[] = [];
    const groups = actionGroups(
      actions({
        onRunAgent: (_agent, path) => seen.push(`run:${path}`),
        onSplitHere: (path) => seen.push(`split:${path}`),
      }),
      CHECKOUT,
    );
    for (const row of groups.flat()) {
      if (row.kind === "action") {
        row.run();
      }
    }
    expect(seen).toEqual(["run:/repo/wt", "split:/repo/wt"]);
  });

  it("carries the board row ONLY in the free-standing placement", () => {
    // Design D1/D6: the chord's list is complete on its own because top-tab
    // mode and a hidden sidebar have no other route to the Open board; a card's
    // anchored menu never repeats the `+ New` that stands beside it.
    const open = vi.fn();
    const wired = actions({ onOpenBoard: open });
    expect(ids(actionGroups(wired, CHECKOUT))).toEqual(["run:claude", "split"]);
    const free = actionGroups(wired, CHECKOUT, "free-standing");
    expect(ids(free)).toEqual(["run:claude", "split", "board"]);
    const board = free.flat().at(-1);
    expect(board?.kind === "action" ? board.title : null).toBe("Open another project…");
    if (board?.kind === "action") {
      board.run();
    }
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("omits the board row when nothing can raise the board (DL-19.7)", () => {
    expect(ids(actionGroups(actions(), CHECKOUT, "free-standing"))).toEqual([
      "run:claude",
      "split",
    ]);
  });
});
