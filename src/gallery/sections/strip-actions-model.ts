/**
 * The candidate MODEL behind `strip-actions-variants.tsx`: the fixture, the
 * agent grouping the owner asked for, and the fold the settled `+` segment
 * forces. Split out of that file when it passed 750 lines — the drawing and
 * the rules it draws are two responsibilities, and this half is the one that
 * would ship (beside `stripSegments` in `agent-rail-card-model.ts`).
 *
 * Nothing here is loaded by the renderer.
 */
import { BUILTIN_AGENTS } from "../../lib/agent-catalog";
import { outranks, STRIP_VISIBLE } from "../../ui/agent-rail-card-model";
import type { RailCardPane, RailState } from "../../ui/agent-rail-model";

/** DL-27.2: the mark is the fast read and never the only read. */
export const STATE_LABEL: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "needs you",
  working: "working",
  done: "done",
  idle: "idle",
};

function pane(fields: {
  readonly paneId: number;
  readonly agent: string;
  readonly label: string;
  readonly state: RailState;
  readonly model: string;
}): RailCardPane {
  return {
    kind: "agent",
    paneId: fields.paneId,
    agent: fields.agent,
    state: fields.state,
    message: "",
    age: "",
    // `outranks` breaks a state tie by recency, so a fixture whose ties all
    // sat at 0 would order by nothing in particular.
    changedAt: fields.paneId,
    focused: false,
    tabIndex: 0,
    model: fields.model,
    label: fields.label,
  };
}

/**
 * Six panes in one checkout — the owner's own screenshot (three segments and
 * a `+3`), with TWO Claudes so grouping has something to merge and one of
 * them louder than the other so the merge's cost is visible rather than
 * hypothetical. Every DL-27.3 state is present.
 */
export const PANES: readonly RailCardPane[] = [
  pane({ paneId: 1, agent: "codex", label: "Codex", state: "asked", model: "GPT-5" }),
  pane({ paneId: 2, agent: "claude", label: "Claude", state: "failed", model: "Sonnet 4.5" }),
  pane({ paneId: 3, agent: "claude", label: "Claude 2", state: "working", model: "Opus 4.1" }),
  pane({ paneId: 4, agent: "gemini", label: "Gemini", state: "working", model: "" }),
  pane({ paneId: 5, agent: "opencode", label: "opencode", state: "done", model: "" }),
  pane({ paneId: 6, agent: "cursor-agent", label: "Cursor", state: "idle", model: "" }),
];

/**
 * Six agent KINDS in one checkout — every built-in Deck ships. Only the cap
 * row uses it: with the `+` now occupying a segment of its own, six kinds is
 * where an uncapped strip stops fitting, and a fixture that never reaches
 * that point would let the uncapped column look correct.
 */
export const CROWDED: readonly RailCardPane[] = [
  ...PANES,
  pane({ paneId: 7, agent: "agy", label: "Agy", state: "idle", model: "" }),
];

/**
 * Six agent kinds, one pane each — no merge anywhere. The fold columns need
 * it because a merged segment is 60px against a plain 39px: on `CROWDED` a
 * width-aware fold and a fixed cap of 3 land on the SAME three segments, and a
 * column that draws identically to its neighbour proves nothing. Here the
 * difference is visible.
 */
export const SPREAD: readonly RailCardPane[] = [
  pane({ paneId: 11, agent: "claude", label: "Claude", state: "failed", model: "Sonnet 4.5" }),
  pane({ paneId: 12, agent: "codex", label: "Codex", state: "asked", model: "GPT-5" }),
  pane({ paneId: 13, agent: "gemini", label: "Gemini", state: "working", model: "" }),
  pane({ paneId: 14, agent: "opencode", label: "opencode", state: "done", model: "" }),
  pane({ paneId: 15, agent: "agy", label: "Agy", state: "idle", model: "" }),
  pane({ paneId: 16, agent: "cursor-agent", label: "Cursor", state: "idle", model: "" }),
];

/**
 * An agent id as a word a person reads — `claude` → `Claude`. Mirrors
 * `agentDisplayName`, which is module-private in `agent-rail-card-model.ts`;
 * shipping the grouped strip is what would make it worth exporting, since a
 * merged segment is the first thing that ever needed to NAME an agent kind
 * rather than a pane.
 */
export function displayAgent(agent: string): string {
  const builtin = BUILTIN_AGENTS.find((candidate) => candidate.id === agent);
  return builtin === undefined ? agent : (builtin.label.split(" ")[0] ?? builtin.label);
}

/** One strip segment once segments are agent kinds rather than panes. */
export interface StripGroup {
  /** The agent id; also the segment's identity for hover and for keys. */
  readonly agent: string;
  /** That agent's panes in the checkout, loudest first. */
  readonly panes: readonly RailCardPane[];
  /** The loudest pane's state — the one mark a merged segment can wear. */
  readonly state: RailState;
}

/**
 * The owner's grouping, as the model would express it. Would ship beside
 * `stripSegments` in `agent-rail-card-model.ts`; it lives here while it is
 * still a candidate.
 *
 * `outranks` is imported rather than restated — the grouped strip has to rank
 * by exactly DL-27.3's fold (`failed > asked > working > done > idle`, ties by
 * recency), or a merged segment's state and the popover's row order would
 * disagree about which agent is loudest.
 *
 * `overflow` counts hidden PANES, not hidden groups: `+2` has to mean "two
 * more agents are running here", which is what the number meant before
 * grouping and what a reader will assume it still means.
 */
export function groupSegments(
  panes: readonly RailCardPane[],
  cap: number = STRIP_VISIBLE,
): {
  readonly shown: readonly StripGroup[];
  readonly overflow: number;
} {
  const byAgent = new Map<string, RailCardPane[]>();
  for (const item of panes) {
    byAgent.set(item.agent, [...(byAgent.get(item.agent) ?? []), item]);
  }
  const groups = [...byAgent.entries()]
    .map(([agent, members]) => {
      const sorted = [...members].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));
      // A group with no members cannot exist — every key came from a pane —
      // so the first entry is the loudest and the non-null assertion the type
      // would need is avoided by falling back to the member we already have.
      const loudest = sorted[0] ?? members[0];
      return { agent, panes: sorted, state: loudest?.state ?? "idle" } satisfies StripGroup;
    })
    .sort((a, b) => {
      const left = a.panes[0];
      const right = b.panes[0];
      if (left === undefined || right === undefined) {
        return 0;
      }
      return outranks(left, right) ? -1 : outranks(right, left) ? 1 : 0;
    });
  const shown = groups.slice(0, cap);
  const seen = shown.reduce((total, group) => total + group.panes.length, 0);
  return { shown, overflow: Math.max(0, panes.length - seen) };
}

/*
 * Segment widths, MEASURED off the rendered strip on 2026-08-27 (the browser
 * numbers, not a derivation): a plain segment is 36-39px depending on whether
 * its loading track is busy, a merged one adds its count suffix, the `+` is 30px and
 * the `+N` tail is 31px. A shipped `fitSegments` should measure rather than
 * estimate — this is a drawing, and the gallery pass under it is what checks
 * the estimate against the real layout.
 */
const SEG_W = 39;
const COUNT_W = 21;
const ADD_W = 30;
const OVERFLOW_W = 31;
/**
 * What the strip actually has, MEASURED: `.asr-card` is 260px wide, its 9px
 * side padding leaves a 242px content box, and `.asr-card__strip` is indented
 * `margin-left: 22px` to align under the checkout name — so the budget is
 * **220px**, not 242px.
 *
 * That 22px is easy to miss and expensive to miss, because the production rule
 * pairs the margin with `max-width: 100%`, which resolves against the 242px
 * content box rather than the 220px the margin leaves. A strip wider than
 * 220px therefore clamps at 242px and hangs 22px past the card — and
 * `.asr-rail__list` has `overflow-x: hidden` (AGENTS.md, Known traps), so it
 * is CUT rather than reported. Today's cap of 3 keeps every strip under 162px,
 * so the latent bug is unreachable; the `+` segment and any lifted cap are
 * what reach it. A shipped version should also change that rule to
 * `max-width: calc(100% - 22px)`.
 */
const STRIP_BUDGET = 220;

/**
 * The cap the `+` forces: fold agents until the strip, its `+N` tail AND the
 * `+` all fit. The `+` is never what folds — a launcher that disappears when a
 * checkout gets busy is a launcher that is missing exactly when it is wanted.
 */
export function fitSegments(
  groups: readonly StripGroup[],
  panes: readonly RailCardPane[],
): { readonly shown: readonly StripGroup[]; readonly overflow: number } {
  const width = (group: StripGroup): number => SEG_W + (group.panes.length > 1 ? COUNT_W : 0);
  const total = groups.reduce((sum, group) => sum + width(group), 0);
  if (total + ADD_W <= STRIP_BUDGET) {
    return { shown: groups, overflow: 0 };
  }
  const shown: StripGroup[] = [];
  let used = 0;
  for (const group of groups) {
    if (used + width(group) + OVERFLOW_W + ADD_W > STRIP_BUDGET) {
      break;
    }
    shown.push(group);
    used += width(group);
  }
  const seen = shown.reduce((sum, group) => sum + group.panes.length, 0);
  return { shown, overflow: Math.max(0, panes.length - seen) };
}

/**
 * The actions menu the `+` (and a right-click on the card) raises — the
 * owner's reference, 2026-08-27, mapped onto seams that already exist.
 *
 * The point of this table is that almost none of it is new plumbing. Every
 * row below names the seam it would call, and only two rows are unresolved:
 *
 *  - `Run <agent>` → `openQuickAgent(agent, destination)`. The destination
 *    argument already overrides BOTH cwd and workspace tag (2026-08-16), so
 *    "run it in THIS checkout" is what that seam was built for.
 *  - `New split here` → **the one fork**. `split-row`/`split-column` act on
 *    the ACTIVE pane, and this card's checkout may not own it; doing it
 *    properly is materialize-then-split, which is `TabManager`'s business
 *    (the `launchTask` precedent), not the rail's.
 *  - `Create branch from here` → `worktree_add`, Electron-only.
 *  - `Open in Finder` / `Open terminal here` → `open_in_app` with the
 *    catalog's own `finder` / `terminal` entries, both of which already
 *    declare `opensFolder: "as-is"`. **No new IPC**, which is the finding
 *    that makes this menu cheap.
 *
 * Electron-only rows are marked so the drawing can omit them on Tauri rather
 * than show them inert (DL-19.7).
 */
export interface ActionRow {
  readonly id: string;
  readonly title: string;
  /** The second line. Says what will happen, never what the row is called. */
  readonly detail: string;
  /** An agent id when the row launches one; otherwise a Phosphor glyph key. */
  readonly agent?: string;
  readonly glyph?: "split" | "branch" | "finder" | "terminal";
  /** False where the row needs a host only Electron provides. */
  readonly bothHosts: boolean;
}

/**
 * The detail lines drop the words "this worktree" that the reference repeats
 * on nearly every row: the footer states the scope once, and at 232px those
 * words were what pushed two details into an ellipsis (measured 2026-08-27).
 *
 * Agent rows. The detail line is the agent's DEFAULT MODEL where the settings
 * carry one and the command it will actually run where they do not — the
 * reference's own subtitles mix a model, a vendor and a restatement of the
 * scope, and only the first of those is a fact the row can promise.
 */
export const ACTION_AGENTS: readonly ActionRow[] = [
  { id: "claude", title: "Run Claude", detail: "Sonnet 4.5", agent: "claude", bothHosts: true },
  { id: "codex", title: "Run Codex", detail: "GPT-5", agent: "codex", bothHosts: true },
  {
    id: "cursor",
    title: "Run Cursor CLI",
    detail: "cursor-agent",
    agent: "cursor-agent",
    bothHosts: true,
  },
  {
    id: "qa",
    title: "Run QA Agent",
    detail: "npm test && npm run lint",
    agent: "qa",
    bothHosts: true,
  },
];

/** Rows that act on the checkout itself. */
export const ACTION_WORK: readonly ActionRow[] = [
  {
    id: "split",
    title: "New split here",
    detail: "Open a pane beside this tab",
    glyph: "split",
    bothHosts: true,
  },
  {
    id: "branch",
    title: "Create branch from here",
    detail: "Branch off feat/worktree-actions",
    glyph: "branch",
    bothHosts: false,
  },
];

/** Rows that hand the checkout to another application. */
export const ACTION_OS: readonly ActionRow[] = [
  {
    id: "finder",
    title: "Open in Finder",
    detail: "Reveal this folder",
    glyph: "finder",
    bothHosts: false,
  },
  {
    id: "terminal",
    title: "Open terminal here",
    detail: "Launch your terminal app",
    glyph: "terminal",
    bothHosts: false,
  },
];
