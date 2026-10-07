import { describe, expect, it } from "vitest";
import {
  buildCardEntries,
  checkoutBadge,
  checkoutLabel,
  sessionTitlesFor,
  untitledSessionIds,
} from "./agent-rail-card-model";
import type { PaneView, TabView } from "../terminal/tabs-store";
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

  it("calls a folder git does not know a Folder, not Primary (DL-27.23, amended)", () => {
    // The synthetic checkout of a plain folder: primary, basename as branch.
    const folder = {
      ...group({ name: "scratch", branch: "scratch", primary: true }),
      labelled: false,
    };
    expect(checkoutLabel(folder)).toBe("scratch");
    expect(checkoutBadge(folder)).toEqual({ kind: "role", text: "Folder" });
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

  it("gives a named tab's pane the name on top and its own sentence beneath (DL-27.15)", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "My task",
      named: true,
      panes: [{ ...paneRow("claude", 1), message: "Reading the source" }],
    });
    const [entry] = buildCardEntries([row], undefined);
    expect(entry).toMatchObject({
      tabName: "My task",
      sentence: "Reading the source",
      label: "My task · Reading the source",
    });
  });

  it("never numbers a name: two panes of one named tab differ by their sentence", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "auth",
      named: true,
      panes: [paneRow("claude", 1), paneRow("claude", 2), paneRow("codex", 3)],
    });
    const entries = buildCardEntries([row], undefined);
    expect(entries.map((entry) => entry.kind === "agent" && entry.tabName)).toEqual([
      "auth",
      "auth",
      "auth",
    ]);
    expect(entries.map((entry) => entry.kind === "agent" && entry.sentence)).toEqual([
      "Claude",
      "Claude 2",
      "Codex",
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      "auth · Claude",
      "auth · Claude 2",
      "auth · Codex",
    ]);
  });

  it("leaves an unnamed pane's name null and its sentence its whole label", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [{ ...paneRow("claude", 1), message: "Running the tests" }],
    });
    const [entry] = buildCardEntries([row], undefined);
    expect(entry).toMatchObject({
      tabName: null,
      sentence: "Running the tests",
      label: "Running the tests",
    });
  });

  it("keeps a named shell tab on one line, its label the name", () => {
    const row = tabRow({ key: 1, index: 0, title: "scratch", named: true, panes: [] });
    expect(buildCardEntries([row], undefined)[0]).toMatchObject({
      kind: "shell",
      label: "scratch",
    });
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
    expect(labels).toEqual(["Claude", "Claude 2", "Claude 2 · Claude"]);
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

/* ───────────────────────── two-line rows (DL-27.28) ───────────────────────── */

describe("buildCardEntries task label and second line", () => {
  const lines = (entries: readonly ReturnType<typeof buildCardEntries>[number][]) =>
    entries.map((entry) =>
      entry.kind === "agent" ? [entry.taskLabel, entry.secondLine] : [entry.label],
    );

  it("leads a named tab with its name, then the agent label and the turn", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "auth",
      named: true,
      panes: [{ ...paneRow("claude", 1), message: "Fixing login" }, paneRow("codex", 2)],
    });
    expect(lines(buildCardEntries([row], undefined))).toEqual([
      ["auth", "Claude · Fixing login"],
      ["auth", "Codex"],
    ]);
  });

  it("leads an unnamed pane with its session's first prompt", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [{ ...paneRow("claude", 1), message: "Reading the source" }, paneRow("claude", 2)],
    });
    const titles = new Map([
      [1, "Make the rail a tree"],
      [2, "Make the rail a tree"],
    ]);
    const entries = buildCardEntries([row], undefined, titles);
    expect(lines(entries)).toEqual([
      ["Make the rail a tree", "Claude · Reading the source"],
      ["Make the rail a tree", "Claude"],
    ]);
    expect(entries.map((entry) => entry.label)).toEqual([
      "Make the rail a tree · Reading the source",
      "Make the rail a tree · Claude",
    ]);
  });

  it("prefers the tab name over a first prompt", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "auth",
      named: true,
      panes: [paneRow("claude", 1)],
    });
    const [entry] = buildCardEntries([row], undefined, new Map([[1, "A prompt"]]));
    expect(entry).toMatchObject({ taskLabel: "auth", secondLine: "Claude" });
  });

  it("falls back to the agent label, with the turn alone beneath it", () => {
    const row = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [{ ...paneRow("claude", 1), message: "Running the tests" }, paneRow("codex", 2)],
    });
    expect(lines(buildCardEntries([row], undefined))).toEqual([
      ["Claude", "Running the tests"],
      ["Codex", ""],
    ]);
  });

  it("keeps two Claude panes of one checkout apart on their visible lines", () => {
    const silent = tabRow({
      key: 1,
      index: 0,
      title: "",
      named: false,
      panes: [paneRow("claude", 1), paneRow("claude", 2)],
    });
    const echo = tabRow({
      key: 2,
      index: 1,
      title: "",
      named: false,
      panes: [
        { ...paneRow("claude", 3), message: "Done" },
        { ...paneRow("claude", 4), message: "Done" },
      ],
    });
    const named = tabRow({
      key: 3,
      index: 2,
      title: "auth",
      named: true,
      panes: [paneRow("claude", 5), paneRow("claude", 6)],
    });
    const visible = lines(buildCardEntries([silent, echo, named], undefined)).map((pair) =>
      pair.join("\n"),
    );
    expect(new Set(visible).size).toBe(visible.length);
    expect(visible.slice(0, 2)).toEqual(["Claude\n", "Claude 2\n"]);
  });
});

describe("sessionTitlesFor", () => {
  const entry = (sessionId: string, title: string | null, agent: "claude" | "codex" = "claude") => ({
    agent,
    sessionId,
    cwd: "/repos/spacevibe-board",
    lastActivityMs: 1,
    title,
    sourcePath: `/sessions/${sessionId}.jsonl`,
  });
  const tab = (name: string | null, panes: readonly Partial<PaneView>[]) =>
    ({
      name,
      panes: panes.map((pane, index) => ({
        paneId: index + 1,
        agent: "claude",
        attention: "none",
        phase: "idle",
        hasRun: false,
        changedAt: 0,
        ...pane,
      })),
    }) as unknown as TabView;

  it("joins a pane's session id to its first prompt, one line", () => {
    const titles = sessionTitlesFor(
      [tab(null, [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: null }])],
      [entry("a", "  Fix the\n  login page "), entry("b", null)],
    );
    expect([...titles]).toEqual([[1, "Fix the login page"]]);
  });

  it("never joins across agents", () => {
    const titles = sessionTitlesFor(
      [tab(null, [{ sessionId: "a", agent: "codex" }])],
      [entry("a", "Claude's prompt", "claude")],
    );
    expect(titles.size).toBe(0);
  });

  it("asks only for the sessions of unnamed Claude Code and Codex panes", () => {
    expect(
      untitledSessionIds([
        tab(null, [
          { sessionId: "a" },
          { sessionId: "b", agent: "codex" },
          { sessionId: "c", agent: "opencode" },
          { sessionId: null },
          { sessionId: "d", agent: null },
        ]),
        tab("auth", [{ sessionId: "e" }]),
      ]),
    ).toEqual(["a", "b"]);
  });
});
