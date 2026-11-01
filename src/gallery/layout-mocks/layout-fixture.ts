/**
 * One scenario shared by every layout mock, so the options differ in layout only.
 * Three projects, six spaces, ten agents covering every state word. Sample data.
 */

/** `asked` is split here: a question or permission wait vs a finished run nobody has read. */
export type MockState =
  "failed" | "needs-you" | "unchecked" | "ended" | "working" | "done" | "idle";
export type Confidence = "explicit" | "inferred";
export type AgentKind = "claude" | "codex" | "opencode" | "gemini" | "droid" | "amp";

export type Tone = "fg" | "dim" | "accent" | "ok" | "err" | "warn" | "info" | "cursor";
export type Span = readonly [Tone, string];
export type TermLine = readonly Span[];

export interface MockProject {
  readonly id: string;
  readonly name: string;
  readonly kind: "repository" | "folder";
}

export interface MockDiffLine {
  readonly kind: "ctx" | "add" | "del";
  readonly old: number | null;
  readonly new: number | null;
  readonly text: string;
}

export interface MockHunk {
  readonly header: string;
  readonly lines: readonly MockDiffLine[];
}

export interface MockFileChange {
  readonly path: string;
  readonly status: "M" | "A" | "D";
  readonly added: number;
  readonly removed: number;
  /** The agent whose turn made the change, and that turn's number (1-based). */
  readonly by: string;
  readonly turn: number;
  /** Present for the files the diff mocks open; their +/− counts are derived from these. */
  readonly hunks?: readonly MockHunk[];
}

/** Rows prefixed " ", "-" or "+"; line numbers and the @@ header are derived from the starts. */
function hunk(
  context: string,
  oldStart: number,
  newStart: number,
  rows: readonly string[],
): MockHunk {
  const lines: MockDiffLine[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  for (const row of rows) {
    const text = row.slice(1);
    if (row.startsWith("+")) lines.push({ kind: "add", old: null, new: newNo++, text });
    else if (row.startsWith("-")) lines.push({ kind: "del", old: oldNo++, new: null, text });
    else lines.push({ kind: "ctx", old: oldNo++, new: newNo++, text });
  }
  const oldCount = lines.filter((line) => line.kind !== "add").length;
  const newCount = lines.filter((line) => line.kind !== "del").length;
  const range = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return { header: context ? `${range} ${context}` : range, lines };
}

/** A change whose +/− counts are read off its hunks. */
function diffed(
  path: string,
  status: MockFileChange["status"],
  by: string,
  turn: number,
  hunks: readonly MockHunk[],
): MockFileChange {
  const all = hunks.flatMap((item) => item.lines);
  return {
    path,
    status,
    by,
    turn,
    hunks,
    added: all.filter((line) => line.kind === "add").length,
    removed: all.filter((line) => line.kind === "del").length,
  };
}

const SESSION_STORE_HUNKS = [
  hunk("", 12, 12, [
    ' import { store } from "./store";',
    ' import { signOut } from "./sign-out";',
    '+import { RefreshError } from "./errors";',
    " ",
    ' const REFRESH_URL = "/api/session/refresh";',
    " const RETRY_DELAY_MS = 250;",
  ]),
  hunk("export async function refreshToken", 84, 85, [
    " export async function refreshToken({ retried = false } = {}) {",
    '   const response = await fetch(REFRESH_URL, { method: "POST", credentials: "include" });',
    "-  if (!response.ok) {",
    "-    return signOut();",
    "-  }",
    "+  if (response.status === 401) {",
    "+    if (!retried) return refreshToken({ retried: true });",
    "+    return signOut();",
    "+  }",
    "+  if (!response.ok) throw new RefreshError(response.status);",
    "   const session = await response.json();",
    "   store.set(session);",
    "   return session;",
    " }",
  ]),
];

const ERRORS_HUNKS = [
  hunk("", 0, 1, [
    "+export class RefreshError extends Error {",
    "+  constructor(readonly status: number) {",
    "+    super(`Session refresh failed with ${status}`);",
    '+    this.name = "RefreshError";',
    "+  }",
    "+}",
  ]),
];

const REFRESH_TEST_HUNKS = [
  hunk("", 0, 1, [
    '+import { describe, expect, it, vi } from "vitest";',
    '+import { refreshToken } from "./session-store";',
    '+import { signOut } from "./sign-out";',
    "+",
    '+vi.mock("./sign-out");',
    "+",
    '+describe("refreshToken", () => {',
    '+  it("retries once on a 401 before signing out", async () => {',
    "+    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));",
    '+    vi.stubGlobal("fetch", fetch);',
    "+    await refreshToken();",
    "+    expect(fetch).toHaveBeenCalledTimes(2);",
    "+    expect(signOut).toHaveBeenCalledOnce();",
    "+  });",
    "+",
    '+  it("does not sign out when the retry succeeds", async () => {',
    "+    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }));",
    '+    fetch.mockResolvedValueOnce(Response.json({ user: "kyan" }));',
    '+    vi.stubGlobal("fetch", fetch);',
    '+    await expect(refreshToken()).resolves.toEqual({ user: "kyan" });',
    "+  });",
    "+});",
  ]),
];

const LEADERBOARD_HUNKS = [
  hunk("export function rankModels", 38, 38, [
    " export function rankModels(rows: readonly ModelRow[]): RankedRow[] {",
    "-  return [...rows]",
    "-    .sort((a, b) => b.score - a.score)",
    "-    .map((row, index) => ({ ...row, rank: index + 1 }));",
    "+  // Curated rows stay pinned; the rest rank by score, then by name.",
    "+  const curated = rows.filter((row) => row.curated);",
    "+  const rest = rows.filter((row) => !row.curated);",
    "+  const byScore = (a: ModelRow, b: ModelRow) =>",
    "+    b.score - a.score || a.name.localeCompare(b.name);",
    "+",
    "+  return [...curated, ...rest.sort(byScore)].map((row, index) => ({",
    "+    ...row,",
    "+    rank: index + 1,",
    "+  }));",
    " }",
  ]),
];

export interface MockCheckout {
  readonly id: string;
  readonly projectId: string;
  /** Null for a plain folder git does not know. */
  readonly branch: string | null;
  readonly worktree: boolean;
  readonly path: string;
  readonly changes: readonly MockFileChange[];
  readonly pr: { readonly number: number; readonly state: "draft" | "open" } | null;
}

export interface MockAgent {
  readonly id: string;
  readonly kind: AgentKind;
  readonly spaceId: string;
  readonly state: MockState;
  readonly confidence: Confidence;
  /** The agent's latest sentence, read from its own session log; null before its first turn. */
  readonly sentence: string | null;
  /** What it waits on, for `needs-you` only. */
  readonly ask: string | null;
  /** Time in the current state. */
  readonly since: string;
  readonly tokens: string;
  readonly cost: string;
  readonly terminal: readonly TermLine[];
}

export interface MockSpace {
  readonly id: string;
  /** The user's name for the space, else null (the UI falls back to the folder). */
  readonly name: string | null;
  readonly checkoutId: string;
  readonly paneIds: readonly string[];
  /** How the panes of this space split the stage. */
  readonly split: "single" | "row" | "column";
}

export const AGENT_NAME: Readonly<Record<AgentKind, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  droid: "Droid",
  amp: "Amp",
};

export const STATE_LABEL: Readonly<Record<MockState, string>> = {
  failed: "Failed",
  "needs-you": "Needs you",
  unchecked: "Unread",
  ended: "Ended",
  working: "Working",
  done: "Done",
  idle: "Ready",
};

/** Loudest first; a folded group speaks with its highest rank. */
export const STATE_RANK: Readonly<Record<MockState, number>> = {
  failed: 6,
  "needs-you": 5,
  unchecked: 4,
  ended: 3,
  working: 2,
  done: 1,
  idle: 0,
};

export function loudest(states: readonly MockState[]): MockState {
  return states.reduce<MockState>(
    (best, state) => (STATE_RANK[state] > STATE_RANK[best] ? state : best),
    "idle",
  );
}

/** True for the states that ask the user to act or look. */
export function wantsUser(state: MockState): boolean {
  return state === "failed" || state === "needs-you" || state === "unchecked";
}

const p = (text: string, tone: Tone = "fg"): TermLine => [[tone, text]];
const blank: TermLine = [];

function box(rows: readonly Span[], width: number): TermLine[] {
  const rule = "─".repeat(width - 2);
  return [
    [["dim", `╭${rule}╮`]],
    ...rows.map(([tone, text]): TermLine => [
      ["dim", "│ "],
      [tone, text.padEnd(width - 4)],
      ["dim", " │"],
    ]),
    [["dim", `╰${rule}╯`]],
  ];
}

export const PROJECTS: readonly MockProject[] = [
  { id: "deck", name: "spacevibe-deck", kind: "repository" },
  { id: "bench", name: "spacevibe-bench", kind: "repository" },
  { id: "tiny", name: "tiny-cli", kind: "folder" },
];

const R = "a-rail-opencode";
const G = "a-filters-gemini";

export const CHECKOUTS: readonly MockCheckout[] = [
  {
    id: "deck-auth",
    projectId: "deck",
    branch: "fix/token-refresh",
    worktree: true,
    path: "~/dev/spacevibe-deck/.claude/worktrees/token-refresh",
    changes: [
      diffed("src/auth/session-store.ts", "M", "a-auth-claude", 2, SESSION_STORE_HUNKS),
      diffed("src/auth/errors.ts", "A", "a-auth-claude", 1, ERRORS_HUNKS),
      diffed("src/auth/refresh.test.ts", "A", "a-auth-codex", 1, REFRESH_TEST_HUNKS),
    ],
    pr: null,
  },
  {
    id: "deck-main",
    projectId: "deck",
    branch: "main",
    worktree: false,
    path: "~/dev/spacevibe-deck",
    changes: [],
    pr: null,
  },
  {
    id: "deck-rail",
    projectId: "deck",
    branch: "feat/rail-sections",
    worktree: true,
    path: "~/dev/spacevibe-deck/.claude/worktrees/rail-sections",
    changes: [
      { path: "src/ui/agent-rail-model.ts", status: "M", added: 64, removed: 12, by: R, turn: 1 },
      { path: "src/ui/agent-rail.tsx", status: "M", added: 142, removed: 87, by: R, turn: 1 },
      { path: "src/styles/rail-sections.css", status: "A", added: 48, removed: 0, by: R, turn: 1 },
      { path: "src/ui/agent-rail.test.tsx", status: "M", added: 36, removed: 4, by: R, turn: 2 },
      {
        path: "src/ui/agent-rail-card-model.ts",
        status: "M",
        added: 8,
        removed: 3,
        by: R,
        turn: 2,
      },
      { path: "docs/DESIGN-LANGUAGE.md", status: "M", added: 12, removed: 9, by: R, turn: 2 },
    ],
    pr: { number: 241, state: "draft" },
  },
  {
    id: "bench-main",
    projectId: "bench",
    branch: "main",
    worktree: false,
    path: "~/dev/spacevibe-bench",
    changes: [diffed("lib/leaderboard.ts", "M", "a-bench-codex", 1, LEADERBOARD_HUNKS)],
    pr: null,
  },
  {
    id: "bench-filters",
    projectId: "bench",
    branch: "feat/provider-filter",
    worktree: true,
    path: "~/dev/spacevibe-bench/.claude/worktrees/provider-filter",
    changes: [
      { path: "components/model-table.tsx", status: "M", added: 40, removed: 8, by: G, turn: 1 },
      { path: "lib/filters.ts", status: "A", added: 22, removed: 0, by: G, turn: 1 },
    ],
    pr: { number: 88, state: "open" },
  },
  {
    id: "tiny-main",
    projectId: "tiny",
    branch: null,
    worktree: false,
    path: "~/dev/tiny-cli",
    changes: [
      { path: "CHANGELOG.md", status: "M", added: 6, removed: 0, by: "a-tiny-claude", turn: 1 },
      { path: "package.json", status: "M", added: 1, removed: 1, by: "a-tiny-claude", turn: 1 },
    ],
    pr: null,
  },
];

export const SPACES: readonly MockSpace[] = [
  {
    id: "s-auth",
    name: "token refresh",
    checkoutId: "deck-auth",
    paneIds: ["a-auth-claude", "a-auth-codex"],
    split: "row",
  },
  {
    id: "s-main",
    name: null,
    checkoutId: "deck-main",
    paneIds: ["a-main-claude"],
    split: "single",
  },
  {
    id: "s-rail",
    name: "rail sections",
    checkoutId: "deck-rail",
    paneIds: ["a-rail-opencode"],
    split: "single",
  },
  {
    id: "s-bench",
    name: null,
    checkoutId: "bench-main",
    paneIds: ["a-bench-codex", "a-bench-droid"],
    split: "column",
  },
  {
    id: "s-filters",
    name: "provider filter",
    checkoutId: "bench-filters",
    paneIds: ["a-filters-gemini"],
    split: "single",
  },
  {
    id: "s-tiny",
    name: null,
    checkoutId: "tiny-main",
    paneIds: ["a-tiny-claude", "a-tiny-amp"],
    split: "row",
  },
];

const CLAUDE_FOOTER: TermLine = [["dim", "  ? for shortcuts"]];
/** Codex's own prompt; terminal text, exempted in icon-system.test.ts. */
const CODEX_PROMPT = "› ";

export const AGENTS: readonly MockAgent[] = [
  {
    id: "a-auth-claude",
    kind: "claude",
    spaceId: "s-auth",
    state: "needs-you",
    confidence: "explicit",
    sentence: "I'll make refreshToken retry once before signing the user out.",
    ask: "Allow edit to src/auth/session-store.ts",
    since: "2m",
    tokens: "48.2k",
    cost: "$0.41",
    terminal: [
      [
        ["accent", "> "],
        ["fg", "A 401 during refresh signs people out. Retry once first."],
      ],
      blank,
      [
        ["fg", "⏺ "],
        ["fg", "I'll look at how the session store handles a 401."],
      ],
      blank,
      [
        ["ok", "⏺ "],
        ["fg", "Read"],
        ["dim", "(src/auth/session-store.ts)"],
      ],
      p("  ⎿  Read 182 lines", "dim"),
      blank,
      [
        ["fg", "⏺ "],
        ["fg", "I'll make refreshToken retry once before signing the user out."],
      ],
      blank,
      [
        ["warn", "⏺ "],
        ["fg", "Update"],
        ["dim", "(src/auth/session-store.ts)"],
      ],
      ...box(
        [
          ["fg", "Edit file"],
          ["dim", "src/auth/session-store.ts"],
          ["dim", ""],
          ["dim", "  88    if (response.status === 401) {"],
          ["err", "  89 -    return signOut();"],
          ["ok", "  89 +    if (!retried) return refreshToken({ retried: true });"],
          ["ok", "  90 +    return signOut();"],
          ["dim", "  91    }"],
          ["dim", ""],
          ["fg", "Do you want to make this edit to session-store.ts?"],
          ["accent", "❯ 1. Yes"],
          ["fg", "  2. Yes, allow all edits during this session (shift+tab)"],
          ["fg", "  3. No, and tell Claude what to do differently (esc)"],
        ],
        68,
      ),
    ],
  },
  {
    id: "a-auth-codex",
    kind: "codex",
    spaceId: "s-auth",
    state: "working",
    confidence: "explicit",
    sentence: "Running the auth integration suite against the new refresh path.",
    ask: null,
    since: "1m",
    tokens: "21.7k",
    cost: "$0.18",
    terminal: [
      [
        ["accent", CODEX_PROMPT],
        ["fg", "Write integration tests for the refresh retry"],
      ],
      blank,
      [
        ["fg", "• "],
        ["fg", "Explored"],
      ],
      p("  └ Read session-store.ts, refresh.test.ts", "dim"),
      blank,
      [
        ["fg", "• "],
        ["fg", "Added src/auth/refresh.test.ts "],
        ["ok", "(+22 -0)"],
      ],
      blank,
      [
        ["fg", "• "],
        ["fg", "Running npm run test:integration -- auth"],
      ],
      [
        ["dim", "  └ "],
        ["ok", "PASS"],
        ["dim", "  auth/refresh.integration.test.ts (12 tests)"],
      ],
      [
        ["dim", "    "],
        ["warn", "RUNS"],
        ["dim", "  auth/session.integration.test.ts"],
      ],
      blank,
      [
        ["info", "◦ "],
        ["fg", "Working "],
        ["dim", "(1m 12s • esc to interrupt)"],
      ],
      blank,
      [
        ["accent", CODEX_PROMPT],
        ["cursor", " "],
      ],
      p("  ⏎ send   ⌃J newline   ⌃T transcript               71% context left", "dim"),
    ],
  },
  {
    id: "a-main-claude",
    kind: "claude",
    spaceId: "s-main",
    state: "working",
    confidence: "explicit",
    sentence: "Tracing why closing the last tab leaves an orphaned PTY.",
    ask: null,
    since: "38s",
    tokens: "93.4k",
    cost: "$0.77",
    terminal: [
      [
        ["accent", "> "],
        ["fg", "Closing the last tab sometimes leaves a shell running. Find out why."],
      ],
      blank,
      [
        ["ok", "⏺ "],
        ["fg", "Search"],
        ["dim", '(pattern: "closeTab", path: "src/terminal")'],
      ],
      p("  ⎿  Found 7 files", "dim"),
      blank,
      [
        ["ok", "⏺ "],
        ["fg", "Read"],
        ["dim", "(src/terminal/tab-manager.ts)"],
      ],
      p("  ⎿  Read 2840 lines", "dim"),
      blank,
      [
        ["fg", "⏺ "],
        ["fg", "Tracing why closing the last tab leaves an orphaned PTY."],
      ],
      blank,
      [
        ["accent", "✻ "],
        ["accent", "Tracing the close flow… "],
        ["dim", "(38s · ↓ 1.2k tokens · esc to interrupt)"],
      ],
      blank,
      CLAUDE_FOOTER,
    ],
  },
  {
    id: "a-rail-opencode",
    kind: "opencode",
    spaceId: "s-rail",
    state: "unchecked",
    confidence: "explicit",
    sentence: "Done. The rail now groups agents by what they need; 6 files changed.",
    ask: null,
    since: "6m",
    tokens: "112k",
    cost: "$1.06",
    terminal: [
      [
        ["info", "┃ "],
        ["fg", "Split the rail into sections by what each agent needs from me"],
      ],
      blank,
      [
        ["dim", "  ✓ "],
        ["fg", "edit "],
        ["dim", "src/ui/agent-rail-model.ts"],
      ],
      [
        ["dim", "  ✓ "],
        ["fg", "edit "],
        ["dim", "src/ui/agent-rail.tsx"],
      ],
      [
        ["dim", "  ✓ "],
        ["fg", "write "],
        ["dim", "src/styles/rail-sections.css"],
      ],
      [
        ["dim", "  ✓ "],
        ["fg", "bash "],
        ["dim", "npx vitest run src/ui/agent-rail.test.tsx"],
      ],
      p("      Tests  36 passed (36)", "ok"),
      blank,
      p("  Done. The rail now groups agents by what they need; 6 files changed."),
      p("  Sections: Needs you, Unread, Working, Quiet. Rows keep their place"),
      p("  inside a section; only a state change moves them."),
      blank,
      [
        ["info", "┃ "],
        ["cursor", " "],
      ],
      p("  ctrl+p commands                                   tab  BUILD", "dim"),
    ],
  },
  {
    id: "a-bench-codex",
    kind: "codex",
    spaceId: "s-bench",
    state: "failed",
    confidence: "explicit",
    sentence: "3 tests failed in leaderboard.test.ts: the sort ignores ties.",
    ask: null,
    since: "4m",
    tokens: "36.9k",
    cost: "$0.29",
    terminal: [
      [
        ["accent", CODEX_PROMPT],
        ["fg", "Fix the leaderboard sort so ties keep model order"],
      ],
      blank,
      [
        ["fg", "• "],
        ["fg", "Edited lib/leaderboard.ts "],
        ["ok", "(+10 -3)"],
      ],
      blank,
      [
        ["fg", "• "],
        ["fg", "Ran npm test -- leaderboard"],
      ],
      [
        ["dim", "  └ "],
        ["err", "FAIL"],
        ["dim", "  lib/leaderboard.test.ts"],
      ],
      p("      ✕ keeps input order for tied scores (4 ms)", "err"),
      p("      ✕ ranks by score, then by name (2 ms)", "err"),
      p("      ✕ pins curated rows first (3 ms)", "err"),
      [
        ["dim", "    Tests: "],
        ["err", "3 failed"],
        ["dim", ", 125 passed, 128 total"],
      ],
      blank,
      [
        ["err", "■ "],
        ["fg", "3 tests failed in leaderboard.test.ts: the sort ignores ties."],
      ],
      blank,
      [
        ["accent", CODEX_PROMPT],
        ["cursor", " "],
      ],
    ],
  },
  {
    id: "a-bench-droid",
    kind: "droid",
    spaceId: "s-bench",
    state: "ended",
    confidence: "explicit",
    sentence: "Migration dry-run finished; no schema drift.",
    ask: null,
    since: "12m",
    tokens: "8.1k",
    cost: "$0.06",
    terminal: [
      p("  ⛬ Migration dry-run finished; no schema drift.", "fg"),
      p("    0 pending · 14 applied · last 20261019_scores_index", "dim"),
      blank,
      p("  Session ended. Resume with droid --resume 7f3a", "dim"),
      blank,
      [
        ["ok", "kyan@mbp "],
        ["info", "spacevibe-bench "],
        ["fg", "% "],
        ["cursor", " "],
      ],
    ],
  },
  {
    id: "a-filters-gemini",
    kind: "gemini",
    spaceId: "s-filters",
    state: "working",
    confidence: "inferred",
    sentence: "Adding the provider filter to the model table.",
    ask: null,
    since: "3m",
    tokens: "57.0k",
    cost: "$0.22",
    terminal: [
      [
        ["accent", "> "],
        ["fg", "Add a provider filter above the model table"],
      ],
      blank,
      [
        ["info", "✦ "],
        ["fg", "Adding the provider filter to the model table."],
      ],
      blank,
      ...box(
        [
          ["ok", "✓  ReadFile components/model-table.tsx"],
          ["ok", "✓  WriteFile lib/filters.ts"],
          ["warn", "⊷  Edit components/model-table.tsx"],
        ],
        50,
      ),
      blank,
      [
        ["info", "⠼ "],
        ["fg", "Wiring the filter chips "],
        ["dim", "(esc to cancel, 41s)"],
      ],
      blank,
      [
        ["accent", "> "],
        ["dim", "Type your message or @path/to/file"],
      ],
      p("~/dev/spacevibe-bench (feat/provider-filter*)      gemini-2.5-pro (91%)", "dim"),
    ],
  },
  {
    id: "a-tiny-claude",
    kind: "claude",
    spaceId: "s-tiny",
    state: "done",
    confidence: "inferred",
    sentence: "Published 0.4.2 and pushed the tag.",
    ask: null,
    since: "25m",
    tokens: "14.3k",
    cost: "$0.11",
    terminal: [
      [
        ["accent", "> "],
        ["fg", "Cut 0.4.2 with the changelog entry"],
      ],
      blank,
      [
        ["ok", "⏺ "],
        ["fg", "Bash"],
        ["dim", "(npm version patch && npm publish)"],
      ],
      p("  ⎿  + tiny-cli@0.4.2", "dim"),
      blank,
      [
        ["fg", "⏺ "],
        ["fg", "Published 0.4.2 and pushed the tag."],
      ],
      blank,
      [
        ["accent", "> "],
        ["cursor", " "],
      ],
      CLAUDE_FOOTER,
    ],
  },
  {
    id: "a-tiny-amp",
    kind: "amp",
    spaceId: "s-tiny",
    state: "idle",
    confidence: "explicit",
    sentence: null,
    ask: null,
    since: "25m",
    tokens: "0",
    cost: "$0.00",
    terminal: [
      p("  Welcome to Amp", "fg"),
      p("  ~/dev/tiny-cli", "dim"),
      blank,
      [
        ["accent", "> "],
        ["cursor", " "],
      ],
      p("  ctrl+o mode · ? help", "dim"),
    ],
  },
];

export function agentById(id: string): MockAgent {
  const agent = AGENTS.find((item) => item.id === id);
  if (!agent) throw new Error(`Unknown mock agent ${id}`);
  return agent;
}

export function spaceById(id: string): MockSpace {
  const space = SPACES.find((item) => item.id === id);
  if (!space) throw new Error(`Unknown mock space ${id}`);
  return space;
}

export function checkoutById(id: string): MockCheckout {
  const checkout = CHECKOUTS.find((item) => item.id === id);
  if (!checkout) throw new Error(`Unknown mock checkout ${id}`);
  return checkout;
}

export function projectById(id: string): MockProject {
  const project = PROJECTS.find((item) => item.id === id);
  if (!project) throw new Error(`Unknown mock project ${id}`);
  return project;
}

/** Where an agent lives: its space, checkout and project in one lookup. */
export function placeOf(agent: MockAgent) {
  const space = spaceById(agent.spaceId);
  const checkout = checkoutById(space.checkoutId);
  return { space, checkout, project: projectById(checkout.projectId) };
}

/** A space's display name: the user's name, else the checkout's folder. */
export function spaceLabel(space: MockSpace): string {
  if (space.name !== null) return space.name;
  const checkout = checkoutById(space.checkoutId);
  return checkout.path.split("/").pop() ?? checkout.path;
}

/** The space the mocks open on: two agents side by side, one of them asking. */
export const DEFAULT_FOCUS = "a-auth-claude";
