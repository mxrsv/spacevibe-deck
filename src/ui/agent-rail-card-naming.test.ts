import { describe, expect, it } from "vitest";
import { buildCardEntries, checkoutBadge, checkoutLabel } from "./agent-rail-card-model";
import { whereOf } from "./worktree-card-row";
import type { RailPaneRow, RailTabRow, RailWorktreeGroup } from "./agent-rail-model";

/**
 * How a checkout names itself, and how that name reaches an accessible name.
 *
 * Pure only, and deliberately in its own file rather than in
 * `agent-rail-card-strip.test.ts`: that file owns the closed strip's fold, and
 * naming is a different concern of the same model (F9). `whereOf` is asserted
 * here beside the two functions it composes, since the rule they share — no
 * segment says a word an earlier segment already said — is only observable
 * across both.
 */

const PROJECT = "spacevibe-board";

function group(fields: {
  readonly name: string;
  readonly branch: string;
  readonly primary: boolean;
}): RailWorktreeGroup {
  return {
    key: `/repos/${fields.name}`,
    branch: fields.branch,
    name: fields.name,
    path: `/repos/${fields.name}`,
    repositoryPath: "/repos/spacevibe-board",
    primary: fields.primary,
    labelled: true,
    entries: [],
    panes: [],
    live: false,
    age: "",
    active: false,
    rows: [],
  };
}

const PRIMARY = group({ name: "spacevibe-board", branch: "main", primary: true });
const WORKTREE = group({ name: "rail-worktree-card", branch: "feat/rail-card", primary: false });
/** `git worktree add ../fix-login fix-login` — folder and branch are one word. */
const SELF_NAMED = group({ name: "fix-login", branch: "fix-login", primary: false });

describe("checkoutLabel", () => {
  it("names the primary checkout by its branch, not by the project's own folder", () => {
    expect(checkoutLabel(PRIMARY)).toBe("main");
    expect(checkoutLabel(PRIMARY)).not.toBe(PROJECT);
  });

  it("names every other checkout by its own folder", () => {
    expect(checkoutLabel(WORKTREE)).toBe("rail-worktree-card");
    expect(checkoutLabel(SELF_NAMED)).toBe("fix-login");
  });
});

describe("checkoutBadge", () => {
  it("gives the primary checkout its role, since the branch is already the label", () => {
    expect(checkoutBadge(PRIMARY)).toEqual({ kind: "role", text: "Primary" });
  });

  it("gives an ordinary worktree its branch", () => {
    expect(checkoutBadge(WORKTREE)).toEqual({ kind: "branch", text: "feat/rail-card" });
  });

  it("gives a worktree named after its branch the role instead of repeating it", () => {
    expect(checkoutBadge(SELF_NAMED)).toEqual({ kind: "worktree", text: "Worktree" });
  });

  it("never restates the label it sits beside", () => {
    for (const item of [PRIMARY, WORKTREE, SELF_NAMED]) {
      expect(checkoutBadge(item).text).not.toBe(checkoutLabel(item));
    }
  });
});

describe("whereOf", () => {
  it("says the project once for the primary checkout", () => {
    expect(whereOf(PROJECT, PRIMARY)).toBe("spacevibe-board · main");
  });

  it("keeps all three segments when all three are different facts", () => {
    expect(whereOf(PROJECT, WORKTREE)).toBe(
      "spacevibe-board · rail-worktree-card · feat/rail-card",
    );
  });

  it("says a self-named worktree's word once", () => {
    expect(whereOf(PROJECT, SELF_NAMED)).toBe("spacevibe-board · fix-login");
  });

  it("never repeats a segment, whatever the checkout", () => {
    for (const item of [PRIMARY, WORKTREE, SELF_NAMED]) {
      const parts = whereOf(PROJECT, item).split(" · ");
      expect(new Set(parts).size).toBe(parts.length);
    }
  });
});

/* ─────────────────────────── checkout-wide entry labels ───────────────────── */

function paneRow(agent: string, paneId: number): RailPaneRow {
  return {
    paneId,
    agent,
    state: "idle",
    message: "",
    age: "",
    changedAt: paneId,
    focused: false,
  };
}

function tabRow(fields: {
  readonly key: number;
  readonly index: number;
  readonly title: string;
  readonly named: boolean;
  readonly panes: readonly RailPaneRow[];
}): RailTabRow {
  return {
    key: fields.key,
    index: fields.index,
    project: PROJECT,
    identity: fields.title,
    title: fields.title,
    named: fields.named,
    message: "",
    age: "",
    changedAt: 0,
    openedAt: fields.key,
    state: "idle",
    panes: fields.panes,
    voice: fields.panes[0] ?? null,
    active: false,
    workspacePath: "/repos/spacevibe-board",
  };
}

describe("buildCardEntries labels", () => {
  it("replaces default names with each pane's message and restores them when cleared", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [paneRow("claude", 1), paneRow("claude", 2)],
    });
    const labels = (item: RailTabRow) =>
      buildCardEntries([item], undefined).map((entry) => entry.label);
    expect(labels(row)).toEqual(["Claude", "Claude 2"]);
    expect(
      labels({
        ...row,
        panes: row.panes.map((pane, index) => ({
          ...pane,
          message: ["Reading the source", "Running the tests"][index]!,
        })),
      }),
    ).toEqual(["Reading the source", "Running the tests"]);
    expect(labels(row)).toEqual(["Claude", "Claude 2"]);
  });

  it("keeps a user-authored name ahead of a message", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "My task",
      named: true,
      panes: [{ ...paneRow("claude", 1), message: "Reading the source" }],
    });
    expect(buildCardEntries([row], undefined)[0]?.label).toBe("My task");
  });

  it("uses the agent name for a whitespace-only message", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [{ ...paneRow("claude", 1), message: "  \n " }],
    });
    expect(buildCardEntries([row], undefined)[0]?.label).toBe("Claude");
  });

  it("numbers repeats of one base label", () => {
    const entries = buildCardEntries(
      [
        tabRow({
          key: 1,
          index: 0,
          title: "",
          named: false,
          panes: [paneRow("claude", 1), paneRow("claude", 2), paneRow("codex", 3)],
        }),
      ],
      undefined,
    );
    expect(entries.map((entry) => entry.label)).toEqual(["Claude", "Claude 2", "Codex"]);
  });

  it("does not hand a generated ordinal a name the user already typed", () => {
    // The collision: counting occurrences of `baseLabel` gave the SECOND
    // unnamed Claude the ordinal 2 while the user's own `Claude 2` kept its
    // text, so two rows carried one name, one aria-label and one close label.
    const entries = buildCardEntries(
      [
        tabRow({
          key: 1,
          index: 0,
          title: "",
          named: false,
          panes: [paneRow("claude", 1), paneRow("claude", 2)],
        }),
        tabRow({ key: 2, index: 1, title: "Claude 2", named: true, panes: [paneRow("claude", 3)] }),
      ],
      undefined,
    );
    const labels = entries.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(["Claude", "Claude 2", "Claude 2 2"]);
  });

  it("keeps first-come ordering — an earlier row never renumbers for a later one", () => {
    const entries = buildCardEntries(
      [
        tabRow({ key: 1, index: 0, title: "Shell", named: true, panes: [] }),
        tabRow({ key: 2, index: 1, title: "", named: false, panes: [] }),
      ],
      undefined,
    );
    expect(entries.map((entry) => entry.label)).toEqual(["Shell", "Shell 2"]);
  });
});
