import { AgentLaunchPage } from "../../launcher/agent-launch-page";
import type { AgentLimitsSnapshot } from "../../lib/agent-limits";
import { AgentUsageSummary } from "../../ui/usage/agent-usage-summary";
import { NOOP } from "../chrome-fixtures";
import { Specimen } from "../specimen";
import { Column, Pair } from "./before-after-2026-09-23-frame";
import {
  type CandidateAgent,
  LauncherCandidate,
  StageBox,
} from "./before-after-2026-09-23-launch-candidate";
import "./before-after-2026-09-23-launch.css";

/**
 * Launch pairs of the 2026-09-23 review: handing an agent its work. Every
 * `before` is the shipped `AgentLaunchPage` over the same four agents; every
 * `after` is `LauncherCandidate`, one drawing with a switch per proposal.
 */

const WORKSPACE = "/Users/deck/spacevibe-deck";

/** What the real page is fed: Antigravity is declared but its binary is gone. */
const SHIPPED_AGENTS = [
  { id: "claude", label: "Claude Code", detail: "/usr/local/bin/claude", missing: false },
  { id: "codex", label: "Codex", detail: "/usr/local/bin/codex", missing: false },
  { id: "opencode", label: "OpenCode", detail: "/usr/local/bin/opencode", missing: false },
  { id: "agy", label: "Antigravity", detail: "agy", missing: true },
] as const;

/** The same agents with the facts the candidate prints; commands are the shipping defaults. */
const AGENTS: readonly CandidateAgent[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude --dangerously-skip-permissions",
    bypass: true,
    installed: true,
    limit: { left: 62, window: "5h", resets: "14:20" },
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex --dangerously-bypass-approvals-and-sandbox",
    bypass: true,
    installed: true,
    limit: { left: 8, window: "5h", resets: "tomorrow 09:00" },
  },
  { id: "opencode", label: "OpenCode", command: "opencode", bypass: false, installed: true },
  {
    id: "agy",
    label: "Antigravity",
    command: "agy --dangerously-skip-permissions",
    bypass: true,
    installed: false,
  },
];

const TASK = "Fix the login redirect loop after the OAuth callback";

function ShippedLauncher() {
  return (
    <StageBox>
      <AgentLaunchPage
        target={{ kind: "split", tabKey: 1, paneId: 1, workspacePath: WORKSPACE }}
        agents={SHIPPED_AGENTS}
        resolved
        pending={false}
        error={null}
        active={false}
        onRun={NOOP}
        onBack={NOOP}
        onSettings={NOOP}
      />
    </StageBox>
  );
}

function Candidate(props: Omit<Parameters<typeof LauncherCandidate>[0], "agents">) {
  return (
    <StageBox>
      <LauncherCandidate agents={AGENTS} {...props} />
    </StageBox>
  );
}

/* ---------------------------------------------------- 1 · first-run launcher */

function firstRunPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="ships · AgentLaunchPage"
        note="The slogan is the largest type; where the pane lands (spacevibe-deck, Split · same tab) is 11px at the far edges. Antigravity is declared but not installed and still offers Run. Claude and Codex launch with --dangerously-* by default, shown only as muted command text in Settings › Agents. The gear has no label."
      >
        <ShippedLauncher />
      </Column>
      <Column
        side="after"
        title="candidate · destination first"
        note="Project + branch is the headline; placement is a glyph with a tooltip. A yellow ringed dot marks agents that skip approvals (DL-3.2), command in the tooltip. A missing agent is a dimmed outline, no Run (DL-32.5). Digits show on hover. Signals is a dotted icon top right. Changes agent-launch-page.tsx/.css, amends DL-32.6 (fork)."
      >
        <Candidate signalsHint />
      </Column>
    </Pair>
  );
}

/* ------------------------------------------------------- 2 · prompt at launch */

function promptPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="ships · no task at launch"
        note="The page only opens an agent; the task is typed into the pane afterwards. Staging and auto-send exist but are switched off (TASK_PROMPT_STAGING_ENABLED / TASK_PROMPT_AUTOSEND = false, src/terminal/task-prompt-send.ts:76,108) because of the DECK-37 readiness race."
      >
        <ShippedLauncher />
      </Column>
      <Column
        side="after"
        title="candidate · task field + compare"
        note="A task field; with a task the cards fold into a checklist and one Run starts every ticked agent, tiled side by side. Task goes in as a CLI argument, not keystrokes: PTY-ownership fork, plus DL-32.6's separate Run buttons."
      >
        <Candidate task={TASK} selected={["claude", "codex"]} />
      </Column>
    </Pair>
  );
}

/* --------------------------------------------------- 3 · agent in a worktree */

function worktreePair() {
  return (
    <Pair>
      <Column
        side="before"
        title="ships · always the current checkout"
        note="The launch page targets the checkout it was opened from. A worktree is a separate step: right-click the checkout card, Create branch from here, confirm, then open an agent in the new card. On Electron that menu has no keyboard path (worktree-card.tsx:299,521)."
      >
        <div class="ba23l-before-stack">
          <ShippedLauncher />
          <CheckoutMenuDrawing />
        </div>
      </Column>
      <Column
        side="after"
        title="candidate · New worktree in the launcher"
        note="A This checkout / New worktree switch; branch (suggested from the task) and base inline, path in the tooltip. The dashed pill marks a branch that does not exist yet. Run calls the existing worktree_add, then starts the agent there. Electron-only."
      >
        <Candidate task={TASK} selected={["claude"]} destination="worktree" />
      </Column>
    </Pair>
  );
}

/** A drawing of the shipped right-click menu, labels verbatim from worktree-card-menus.tsx. */
function CheckoutMenuDrawing() {
  return (
    <div class="ba23l-menu" aria-label="Checkout menu (drawing)">
      <span class="ba23l-menu__cap">right-click on a checkout card · drawing</span>
      <span>Open shell</span>
      <span>New split here</span>
      <span data-hot="">Create branch from here</span>
      <span>Open another project…</span>
    </div>
  );
}

/* ------------------------------------------------------ 4 · limit-aware launch */

const NOW_MS = Date.UTC(2026, 8, 23, 5, 0, 0);
const HOUR_MS = 3_600_000;
const SNAPSHOT: AgentLimitsSnapshot = [
  {
    agent: "claude",
    state: "ready",
    observedAtMs: NOW_MS - 60_000,
    windows: [{ durationMinutes: 300, usedPercent: 38, resetsAtMs: NOW_MS + 2 * HOUR_MS }],
  },
  {
    agent: "codex",
    state: "ready",
    observedAtMs: NOW_MS - 60_000,
    windows: [{ durationMinutes: 300, usedPercent: 92, resetsAtMs: NOW_MS + 4 * HOUR_MS }],
  },
];

function limitsPair() {
  return (
    <Pair>
      <Column
        side="before"
        title="ships · allowance lives in the sidebar"
        note="The launcher shows no allowance. The only reading is the sidebar badge row (the real AgentUsageSummary below, same fixture), with no low state and reset times only in the tooltip (DL-33.1). Nothing stops you from starting Codex on its last 8%."
      >
        <div class="ba23l-before-stack">
          <ShippedLauncher />
          <div class="ba23l-sidebar">
            <span class="ba23l-menu__cap">sidebar foot · shipped component</span>
            <AgentUsageSummary snapshot={SNAPSHOT} nowMs={NOW_MS} onOpenUsage={NOOP} />
          </div>
        </div>
      </Column>
      <Column
        side="after"
        title="candidate · allowance on every card"
        note="A thin bar + percentage left per card; reset time in the tooltip. Under 15% the card dims and the bar turns yellow; nothing is blocked. No limit source = no bar. Reuses useAgentLimits; remaining allowance only, never inferred (DL-33.1)."
      >
        <Candidate limits />
      </Column>
    </Pair>
  );
}

export function LaunchPairs() {
  return (
    <>
      <Specimen
        name="4 · First-run launcher"
        note="Handing the task · what a new user sees on ⌘T. Before is the real page; after is a drawing."
        surface="none"
      >
        {firstRunPair()}
      </Specimen>
      <Specimen
        name="5 · Task at launch"
        note="Handing the task · give the agent its job in the same step, optionally to two agents at once."
        surface="none"
      >
        {promptPair()}
      </Specimen>
      <Specimen
        name="6 · Agent in a new worktree"
        note="Handing the task · one step from the launcher instead of a right-click detour."
        surface="none"
      >
        {worktreePair()}
      </Specimen>
      <Specimen
        name="7 · Limit-aware launch"
        note="Handing the task · pick the agent that still has room. Deck's differentiator: Claude and Codex limits side by side."
        surface="none"
      >
        {limitsPair()}
      </Specimen>
    </>
  );
}
