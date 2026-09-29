/**
 * Shared fixture for the agent overview study (local plan
 * `docs/plans/2026-09-27-agent-overview-gallery.md`). Every candidate reads the
 * same 24 agents and slices the first N, so an agent keeps its identity, task,
 * group and excerpt across the reference, A, B and C.
 *
 * States use the Board's vocabulary (`agent-board-model.ts`): `asked`, not the
 * plan's draft word "requested". Nothing here touches a store, a PTY or a
 * session log; the helpers are pure and return new values.
 */

export type MockState = "working" | "asked" | "failed" | "done" | "idle";
export type MockCli = "claude" | "codex" | "gemini" | "opencode";
export type FrameSize = "wide" | "compact";

export interface MockCheckout {
  readonly id: string;
  readonly repo: string;
  readonly branch: string;
  readonly path: string;
}

export interface MockGroup {
  readonly id: string;
  readonly label: string;
  readonly checkoutId: string;
}

export interface MockAgent {
  readonly key: string;
  readonly cli: MockCli;
  /** Per-CLI ordinal across the whole fixture, so two Claudes stay apart. */
  readonly ordinal: number;
  readonly task: string;
  readonly groupId: string;
  readonly state: MockState;
  readonly excerpt: readonly string[];
}

/** Illustrative panes per group, not a production threshold. */
export const DEMO_CAPACITY: Readonly<Record<FrameSize, number>> = { wide: 4, compact: 2 };
export const AGENT_COUNTS = [0, 4, 12, 24] as const;
export type AgentCount = (typeof AGENT_COUNTS)[number];

export const CLI_NAMES: Readonly<Record<MockCli, string>> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
};

export const NEEDS_YOU: ReadonlySet<MockState> = new Set<MockState>(["asked", "failed"]);

export const CHECKOUTS: readonly MockCheckout[] = [
  { id: "deck-main", repo: "spacevibe-deck", branch: "main", path: "~/spacevibe-deck" },
  {
    id: "deck-fix",
    repo: "spacevibe-deck",
    branch: "fix/rail",
    path: "~/deck-worktrees/fix-rail",
  },
  { id: "api-main", repo: "spacevibe-api", branch: "main", path: "~/spacevibe-api" },
];

export const FIXTURE_GROUPS: readonly MockGroup[] = [
  { id: "g-rail", label: "Rail polish", checkoutId: "deck-main" },
  { id: "g-launch", label: "Launcher", checkoutId: "deck-main" },
  { id: "g-fix", label: "Fix rail", checkoutId: "deck-fix" },
  { id: "g-billing", label: "Billing", checkoutId: "api-main" },
  { id: "g-board", label: "Board filters", checkoutId: "deck-main" },
  { id: "g-notes", label: "Release notes", checkoutId: "deck-fix" },
  { id: "g-auth", label: "Auth tokens", checkoutId: "api-main" },
  { id: "g-migrate", label: "Migrations", checkoutId: "api-main" },
];

type Row = readonly [MockCli, string, string, MockState, readonly string[]];

const ROWS: readonly Row[] = [
  [
    "claude",
    "Card spacing",
    "g-rail",
    "working",
    [
      "Read src/ui/worktree-card.tsx",
      "Edit 04c-rail-worktree-card.css",
      "✻ Measuring the row gap…",
    ],
  ],
  [
    "codex",
    "Tail overflow",
    "g-rail",
    "asked",
    ["Patch ready: rail-tail.tsx", "Apply this change?", "❯ 1. Yes   2. No"],
  ],
  [
    "claude",
    "Hover states",
    "g-rail",
    "done",
    ["Updated 3 files", "npm test -- rail  ✓ 41 passed", "Done in 4m 12s"],
  ],
  [
    "gemini",
    "Icon audit",
    "g-rail",
    "working",
    ["Scanning 53 icon imports", "DeckIcon size 13 → 14 in 6 files", "Checking DL-14.1…"],
  ],
  ["opencode", "Launch copy", "g-launch", "idle", ["opencode 1.18", "~/spacevibe-deck", "> "]],
  [
    "claude",
    "Split target",
    "g-launch",
    "working",
    ["Read src/lib/pane-tiling.ts", "largest leaf: pane 3 (412x380)", "✻ Tracing the split…"],
  ],
  [
    "codex",
    "Profile picker",
    "g-launch",
    "failed",
    ["npm run lint", "✖ 2 problems (2 errors)", "exit code 1"],
  ],
  [
    "claude",
    "Rail regression",
    "g-fix",
    "working",
    ["git bisect run npm test", "bisecting: 6 revisions left", "✻ Running step 3…"],
  ],
  [
    "gemini",
    "Repro script",
    "g-fix",
    "done",
    ["Wrote scripts/repro-rail.mjs", "Reproduced in 3/3 runs", "Ready for review"],
  ],
  [
    "codex",
    "Invoice export",
    "g-billing",
    "working",
    ["Edit src/services/invoice.ts", "Zod schema: InvoiceExport", "Running vitest…"],
  ],
  [
    "claude",
    "Webhook retries",
    "g-billing",
    "asked",
    ["Allow Bash(npx prisma migrate dev)?", "  Yes / Yes, always / No", "❯ "],
  ],
  ["opencode", "Rate limits", "g-billing", "idle", ["opencode 1.18", "~/spacevibe-api", "> "]],
  [
    "claude",
    "Filter chips",
    "g-board",
    "working",
    ["Read src/ui/agent-board-model.ts", "Adding needs-you filter", "✻ Thinking…"],
  ],
  [
    "codex",
    "Group toggle",
    "g-board",
    "done",
    ["2 files changed", "✓ agent-board.test.ts", "Summary written"],
  ],
  [
    "gemini",
    "Empty state",
    "g-board",
    "asked",
    ["Two wordings drafted", "Which one should ship?", "❯ "],
  ],
  [
    "claude",
    "List density",
    "g-board",
    "working",
    ["Measuring card heights", "46 → 44px at compact", "✻ Checking DL-34…"],
  ],
  [
    "opencode",
    "Changelog",
    "g-notes",
    "working",
    ["Reading 18 commits since v2.1.0", "Grouping by scope", "Drafting…"],
  ],
  [
    "claude",
    "Upgrade notes",
    "g-notes",
    "idle",
    ["Claude Code", "~/deck-worktrees/fix-rail", "> "],
  ],
  [
    "codex",
    "Screenshots",
    "g-notes",
    "failed",
    ["playwright: page.goto timeout", "30000ms exceeded", "exit code 1"],
  ],
  [
    "claude",
    "Token scopes",
    "g-auth",
    "working",
    ["Read src/routes/tokens.ts", "scope: repo:read | repo:write", "✻ Designing…"],
  ],
  ["gemini", "Session TTL", "g-auth", "done", ["TTL 12h → 8h", "✓ 12 tests", "Done"]],
  [
    "codex",
    "Key rotation",
    "g-auth",
    "asked",
    ["Rotate staging key now?", "This invalidates 3 sessions", "❯ y/N"],
  ],
  [
    "claude",
    "Audit log",
    "g-auth",
    "working",
    ["Edit prisma/schema.prisma", "model AuditEntry", "✻ Writing migration…"],
  ],
  ["opencode", "Index review", "g-migrate", "idle", ["opencode 1.18", "~/spacevibe-api", "> "]],
];

function withOrdinals(rows: readonly Row[]): readonly MockAgent[] {
  const seen = new Map<MockCli, number>();
  return rows.map(([cli, task, groupId, state, excerpt], index) => {
    const ordinal = (seen.get(cli) ?? 0) + 1;
    seen.set(cli, ordinal);
    return {
      key: `a${String(index + 1).padStart(2, "0")}`,
      cli,
      ordinal,
      task,
      groupId,
      state,
      excerpt,
    };
  });
}

export const FIXTURE_AGENTS: readonly MockAgent[] = withOrdinals(ROWS);

export function agentsFor(count: AgentCount): readonly MockAgent[] {
  return FIXTURE_AGENTS.slice(0, count);
}

/** Fixture groups that hold at least one of the given agents, in fixture order. */
export function groupsFor(agents: readonly MockAgent[]): readonly MockGroup[] {
  const used = new Set(agents.map((agent) => agent.groupId));
  return FIXTURE_GROUPS.filter((group) => used.has(group.id));
}

/** Spaces left to right: checkouts in fixture order, groups in creation order within each. */
export function spaceOrder(groups: readonly MockGroup[]): readonly MockGroup[] {
  return CHECKOUTS.flatMap((checkout) =>
    groups.filter((group) => group.checkoutId === checkout.id),
  );
}

export function membersOf(agents: readonly MockAgent[], groupId: string): readonly MockAgent[] {
  return agents.filter((agent) => agent.groupId === groupId);
}

export function checkoutOf(checkoutId: string): MockCheckout {
  return CHECKOUTS.find((checkout) => checkout.id === checkoutId) ?? CHECKOUTS[0];
}

/**
 * What a space is called on screen: its cwd. Owner decision 2026-09-27 —
 * users tell spaces apart by checkout, not by a group name, so a group's
 * fixture `label` is never drawn. Several spaces on one cwd (a full space
 * overflowed) are told apart by their position among that cwd's spaces.
 */
export interface SpaceName {
  readonly checkout: MockCheckout;
  /** 1-based among the cwd's spaces; null while the cwd has only one. */
  readonly index: number | null;
}

export function spaceName(group: MockGroup, groups: readonly MockGroup[]): SpaceName {
  const siblings = groups.filter((other) => other.checkoutId === group.checkoutId);
  const at = siblings.findIndex((other) => other.id === group.id);
  const position = at === -1 ? siblings.length + 1 : at + 1;
  const count = at === -1 ? siblings.length + 1 : siblings.length;
  return { checkout: checkoutOf(group.checkoutId), index: count > 1 ? position : null };
}

/**
 * The cwd's folder name — what the owner reads, and unique where the repo name
 * is not: a worktree of `spacevibe-deck` is `fix-rail`. Branch is left out
 * on screen (owner, 2026-09-27) and kept only in the tooltip.
 */
export function cwdName(checkout: MockCheckout): string {
  return checkout.path.slice(checkout.path.lastIndexOf("/") + 1);
}

export function spaceText({ checkout, index }: SpaceName): string {
  return `${cwdName(checkout)}${index === null ? "" : ` · ${index}`}`;
}

export function agentName(agent: MockAgent): string {
  return `${CLI_NAMES[agent.cli]} ${agent.ordinal}`;
}

export function needsYouCount(agents: readonly MockAgent[]): number {
  return agents.filter((agent) => NEEDS_YOU.has(agent.state)).length;
}

// ── Mock launch ────────────────────────────────────────────────────────────

export type LaunchPlan =
  | { readonly kind: "join"; readonly group: MockGroup; readonly count: number }
  | { readonly kind: "new"; readonly group: MockGroup };

const SPARE_CLIS: readonly MockCli[] = ["claude", "codex", "gemini", "opencode"];
const DEFAULT_CHECKOUT_ID = CHECKOUTS[0].id;

/** Where mock New agent would land, shown before anything is added. */
export function planLaunch(
  groups: readonly MockGroup[],
  agents: readonly MockAgent[],
  currentGroupId: string | null,
  capacity: number,
): LaunchPlan {
  const current = groups.find((group) => group.id === currentGroupId);
  const count = current === undefined ? 0 : membersOf(agents, current.id).length;
  if (current !== undefined && count < capacity) return { kind: "join", group: current, count };
  const checkoutId = current?.checkoutId ?? DEFAULT_CHECKOUT_ID;
  const serial = groups.length + 1;
  return {
    kind: "new",
    group: { id: `g-new-${serial}`, label: `Group ${serial}`, checkoutId },
  };
}

/** A deterministic idle agent for mock launches; never starts a process. */
export function spareAgent(agents: readonly MockAgent[], groupId: string): MockAgent {
  const serial = agents.filter((agent) => agent.key.startsWith("n")).length + 1;
  const cli = SPARE_CLIS[(serial - 1) % SPARE_CLIS.length];
  const ordinal = agents.filter((agent) => agent.cli === cli).length + 1;
  return {
    key: `n${serial}`,
    cli,
    ordinal,
    task: "New task",
    groupId,
    state: "idle",
    excerpt: [`❯ ${cli}`, "Ready.", "> "],
  };
}

export interface GroupState {
  readonly groups: readonly MockGroup[];
  readonly agents: readonly MockAgent[];
}

export function applyLaunch(
  state: GroupState,
  plan: LaunchPlan,
): GroupState & { readonly added: MockAgent } {
  const groups = plan.kind === "new" ? [...state.groups, plan.group] : state.groups;
  const added = spareAgent(state.agents, plan.group.id);
  return { groups, agents: [...state.agents, added], added };
}
