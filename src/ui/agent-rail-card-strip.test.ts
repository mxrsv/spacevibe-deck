import { describe, expect, it } from "vitest";
import {
  fitSegments,
  groupSegments,
  panesBehind,
  SEGMENT_ADD_WIDTH,
  SEGMENT_COUNT_WIDTH,
  SEGMENT_OVERFLOW_WIDTH,
  SEGMENT_WIDTH_FALLBACK,
  STRIP_OVERFLOW_KEY,
  displayAgent,
  type StripGroup,
} from "./agent-rail-card-model";
import type { RailCardPane, RailState } from "./agent-rail-model";

/**
 * The closed strip's grouped fold (spec
 * `docs/internals/agent-rail.md`).
 *
 * Pure only: the measuring half lives in `worktree-card-strip.tsx`'s
 * `useStripMetrics`, which hands `fitSegments` real boxes — the rule below is
 * what it hands them TO, so the fold stays assertable without a layout.
 */

function pane(fields: {
  readonly paneId: number;
  readonly agent: string;
  readonly state: RailState;
  readonly model?: string;
}): RailCardPane {
  return {
    kind: "agent",
    paneId: fields.paneId,
    agent: fields.agent,
    state: fields.state,
    message: "",
    age: "",
    // `outranks` breaks a state tie by recency, so a fixture whose ties all sat
    // at 0 would order by nothing in particular.
    changedAt: fields.paneId,
    focused: false,
    tabIndex: 0,
    model: fields.model ?? "",
    label: `${fields.agent} ${fields.paneId}`,
  };
}

const TWO_CLAUDES: readonly RailCardPane[] = [
  pane({ paneId: 1, agent: "codex", state: "asked" }),
  pane({ paneId: 2, agent: "claude", state: "failed" }),
  pane({ paneId: 3, agent: "claude", state: "working" }),
  pane({ paneId: 4, agent: "gemini", state: "working" }),
];

const plainWidth = (group: StripGroup): number =>
  SEGMENT_WIDTH_FALLBACK + (group.panes.length > 1 ? SEGMENT_COUNT_WIDTH : 0);

describe("groupSegments", () => {
  it("folds panes by agent kind, loudest group first", () => {
    const groups = groupSegments(TWO_CLAUDES);
    expect(groups.map((group) => group.agent)).toEqual(["claude", "codex", "gemini"]);
    expect(groups[0]?.panes).toHaveLength(2);
  });

  it("gives a merged segment its loudest pane's state, and nothing about the other", () => {
    const claude = groupSegments(TWO_CLAUDES)[0];
    expect(claude?.state).toBe("failed");
    // The stated cost of the owner's grouping: the working Claude is only
    // reachable through the segment menu.
    expect(claude?.panes.map((item) => item.state)).toEqual(["failed", "working"]);
  });

  it("ranks by DL-27.3's fold, not by pane order", () => {
    const groups = groupSegments([
      pane({ paneId: 1, agent: "gemini", state: "idle" }),
      pane({ paneId: 2, agent: "claude", state: "asked" }),
    ]);
    expect(groups.map((group) => group.agent)).toEqual(["claude", "gemini"]);
  });
});

describe("fitSegments", () => {
  it("shows every kind and no tail when they fit beside the `+`", () => {
    const groups = groupSegments(TWO_CLAUDES);
    const fit = fitSegments(groups, TWO_CLAUDES, plainWidth, 220);
    expect(fit.shown).toHaveLength(3);
    expect(fit.overflow).toBe(0);
  });

  it("never folds the `+` — agents go into `+N` instead", () => {
    const panes = ["claude", "codex", "gemini", "opencode", "agy", "cursor-agent"].map(
      (agent, index) => pane({ paneId: index + 1, agent, state: "idle" }),
    );
    const groups = groupSegments(panes);
    const budget = 4 * SEGMENT_WIDTH_FALLBACK;
    const fit = fitSegments(groups, panes, plainWidth, budget);
    expect(fit.shown.length).toBeLessThan(groups.length);
    // Every shown segment, the tail AND the `+` fit inside the budget.
    const used =
      fit.shown.length * SEGMENT_WIDTH_FALLBACK + SEGMENT_OVERFLOW_WIDTH + SEGMENT_ADD_WIDTH;
    expect(used).toBeLessThanOrEqual(budget);
  });

  it("counts hidden PANES, not hidden groups", () => {
    const groups = groupSegments(TWO_CLAUDES);
    // Room for the loudest group only.
    const fit = fitSegments(groups, TWO_CLAUDES, plainWidth, 130);
    expect(fit.shown.map((group) => group.agent)).toEqual(["claude"]);
    // codex + gemini — the two panes no segment on screen stands for.
    expect(fit.overflow).toBe(2);
  });
});

describe("panesBehind", () => {
  it("raises exactly one segment's panes", () => {
    const shown = groupSegments(TWO_CLAUDES);
    expect(panesBehind("claude", TWO_CLAUDES, shown).map((item) => item.paneId)).toEqual([2, 3]);
  });

  it("raises exactly the panes the `+N` tail hides", () => {
    const groups = groupSegments(TWO_CLAUDES);
    const fit = fitSegments(groups, TWO_CLAUDES, plainWidth, 130);
    expect(
      panesBehind(STRIP_OVERFLOW_KEY, TWO_CLAUDES, fit.shown).map((item) => item.paneId),
    ).toEqual([1, 4]);
  });

  it("answers empty for a key that is no longer shown, which is what closes the menu", () => {
    expect(panesBehind("claude", TWO_CLAUDES, [])).toEqual([]);
  });
});

describe("displayAgent", () => {
  it("names an agent KIND, which is what a merged segment needed", () => {
    expect(displayAgent("claude")).toBe("Claude");
  });

  it("leaves an id it does not know alone", () => {
    expect(displayAgent("custom:wrapper")).toBe("custom:wrapper");
  });
});
