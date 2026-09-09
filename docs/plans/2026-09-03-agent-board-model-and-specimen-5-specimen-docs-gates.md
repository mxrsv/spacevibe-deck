# Agent Board — model, treatment and specimen — plan, part 5 of 5: the specimen, the living docs and the end gates (Tasks 12–13)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read [part 1](2026-09-03-agent-board-model-and-specimen.md) first — goal, architecture, the spec link and the Global Constraints every task below inherits. Tasks are numbered across the five parts.

---

### Task 12: Gallery specimen of the REAL component

**Files:**
- Create: `src/gallery/sections/agent-board-section.tsx`
- Modify: `src/gallery/section-registry.ts` (register `{ id: "agent-board", label: "agent board", Section: AgentBoardSection }` after `board`)
- Test: `scripts/gallery-entry.test.ts` (existing registry test stays green); `scripts/design-language.test.ts`

**Interfaces:**
- Consumes: `buildAgentBoard`, `AgentBoardInput` (model); `AgentBoard`; `SectionHead`, `Specimen` from `../specimen`; `SEED_HOME` from `../seed-data`; `RepositoryScan`, `TabView`, `PaneView` types.

Invoke `frontend-design-bar` for this task (CLAUDE.md frontend_design): the specimen is judged on a screenshot, not on a passing test.

- [ ] **Step 1: Write the section** — a fixture of two projects, three checkouts, eight cards (asked ×2, working ×3, done ×1, idle ×1, departed ×1), driven through the REAL model and component; selection is a local signal so the panel opens on click:

```tsx
import { useSignal } from "@preact/signals";
import type { RepositoryScan } from "../../repositories/repository-client";
import type { PaneView, TabView } from "../../terminal/tabs-store";
import { AgentBoard, type AgentBoardActions } from "../../ui/agent-board";
import { buildAgentBoard, type AgentBoardInput, type BoardStatusFilter } from "../../ui/agent-board-model";
import type { BoardPanelState } from "../../ui/agent-board-panel";
import { SEED_HOME } from "../seed-data";
import { SectionHead, Specimen } from "../specimen";

const DECK = `${SEED_HOME}/spacevibe-deck`;
const DECK_FIX = `${SEED_HOME}/deck-worktrees/fix-rail`;
const API = `${SEED_HOME}/spacevibe-api`;
const NOW = Date.now();
const minutesAgo = (minutes: number): number => NOW - minutes * 60_000;

function repo(key: string, worktrees: readonly { path: string; branch: string }[]): RepositoryScan {
  return {
    kind: "repository",
    key,
    root: worktrees[0].path,
    worktrees: worktrees.map((entry) => ({
      path: entry.path, head: "0".repeat(40), branch: entry.branch,
      bare: false, detached: false, locked: null, prunable: null,
    })),
  };
}
const SCANS = new Map<string, RepositoryScan>([
  [DECK, repo("spacevibe-deck", [{ path: DECK, branch: "main" }, { path: DECK_FIX, branch: "fix/rail" }])],
  [DECK_FIX, repo("spacevibe-deck", [{ path: DECK, branch: "main" }, { path: DECK_FIX, branch: "fix/rail" }])],
  [API, repo("spacevibe-api", [{ path: API, branch: "main" }])],
]);

function pane(paneId: number, agent: string | null, attention: PaneView["attention"], phase: PaneView["phase"], changedAt: number, hasRun = true): PaneView {
  return { paneId, agent, attention, phase, hasRun, changedAt, focused: false };
}
function tab(key: number, workspacePath: string, panes: readonly PaneView[], name: string | null = null): TabView {
  return {
    key, process: panes[0]?.agent ?? "zsh", name, dotColor: null, workspacePath,
    agents: panes.flatMap((p) => (p.agent ? [p.agent] : [])), agentBusy: panes.some((p) => p.phase === "working"),
    unread: false, panes, openedAt: key,
  };
}

const TABS: readonly TabView[] = [
  tab(1, DECK, [pane(101, "claude", "none", "working", minutesAgo(1))]),
  tab(2, DECK, [pane(102, "codex", "completed", "idle", minutesAgo(6))], "architecture review"),
  tab(3, DECK, [pane(103, "claude", "requested", "idle", minutesAgo(2)), pane(104, "opencode", "none", "working", minutesAgo(1))], "api"),
  tab(4, DECK_FIX, [pane(105, "gemini", "none", "idle", minutesAgo(40))]),
  tab(5, API, [pane(106, "codex", "none", "working", minutesAgo(3))]),
  tab(6, API, [pane(107, "claude", "none", "idle", minutesAgo(15), false)]),
  tab(7, API, [pane(108, null, "completed", "idle", minutesAgo(4))]),
];

const BASE: Omit<AgentBoardInput, "selectedPaneId" | "statusFilter" | "projectFilter" | "heldOrder"> = {
  tabs: TABS,
  activeIndex: 0,
  scans: SCANS,
  workspaceHistoryPaths: [DECK, DECK_FIX, API],
  tails: new Map([
    [101, "Reading agent-rail-model.ts to find where the tab tier is projected"],
    [102, "Both approaches are viable; I recommend the pure projection"],
    [103, "Should I overwrite the existing migration or create a new one?"],
    [104, "Running the rail suite"],
    [105, "Nothing to report"],
    [106, "Adding the contract test for pty_kill_foreground"],
  ]),
  ordinals: new Map([[101, 1], [102, 2], [103, 3], [104, 4], [105, 5], [106, 6], [107, 7], [108, 8]]),
  startedAt: new Map([[101, minutesAgo(12)], [102, minutesAgo(48)], [103, minutesAgo(9)], [104, minutesAgo(9)], [106, minutesAgo(31)], [108, minutesAgo(70)]]),
  tasks: new Map([[101, "Refactor the rail model so the board can reuse its projection"], [106, "Add the kill-foreground channel and its contract test"]]),
  lastAgents: new Map([[108, "claude"]]),
  confidence: new Map([[101, "explicit"], [102, "inferred"], [104, "inferred"], [106, "inferred"]]),
  home: SEED_HOME,
  now: NOW,
};

const NOOP: AgentBoardActions = {
  onSelect: () => {}, onOpenInStage: () => {}, onStop: () => {}, onRestart: () => {}, onClose: () => {},
  onReply: () => {}, onStatusFilter: () => {}, onProjectFilter: () => {}, onNewAgent: () => {}, onEscape: () => {},
};
const PANEL_CLOSED: BoardPanelState = { snapshot: null, replyEnabled: false, replyNotice: null, sending: false, paneExited: false };
const SNAPSHOT = [
  "$ claude --dangerously-skip-permissions",
  "",
  "> Refactor the rail model so the board can reuse its projection",
  "",
  "⏺ Reading agent-rail-model.ts…",
  "⏺ The tab tier is projected in paneRows(); the board can join by paneId.",
  "",
  "Should I overwrite the existing migration or create a new one?",
  "❯ 1. Overwrite",
  "  2. Create a new one",
].join("\n");

function LiveBoard() {
  const selected = useSignal<number | null>(103);
  const status = useSignal<BoardStatusFilter>("all");
  const project = useSignal<string | null>(null);
  const held = useSignal<readonly number[] | null>(null);
  const view = buildAgentBoard({ ...BASE, selectedPaneId: selected.value, statusFilter: status.value, projectFilter: project.value, heldOrder: held.value });
  const actions: AgentBoardActions = {
    ...NOOP,
    onSelect: (card) => {
      selected.value = card?.paneId ?? null;
      held.value = card === null ? null : view.cards.map((c) => c.paneId);
    },
    onStatusFilter: (filter) => { status.value = filter; },
    onProjectFilter: (key) => { project.value = key; },
  };
  const panel: BoardPanelState = view.selected === null
    ? PANEL_CLOSED
    : { snapshot: SNAPSHOT, replyEnabled: !view.selected.departed, replyNotice: view.selected.state === "asked" ? "placed — confirm in the terminal" : null, sending: false, paneExited: false };
  return <AgentBoard view={view} actions={actions} panel={panel} />;
}

export function AgentBoardSection() {
  const emptyView = buildAgentBoard({ ...BASE, tabs: [tab(9, DECK, [pane(901, null, "none", "idle", NOW, false)])], ordinals: new Map(), selectedPaneId: null, statusFilter: "all", projectFilter: null, heldOrder: null });
  const filteredView = buildAgentBoard({ ...BASE, selectedPaneId: null, statusFilter: "failed", projectFilter: null, heldOrder: null });
  return (
    <>
      <SectionHead
        title="Agent Board"
        blurb="The real AgentBoard over a fixture: two projects, three checkouts, eight cards through buildAgentBoard. Click a card to open its panel; the nav filters. Spec docs/specs/2026-09-03-agent-board-design.md, DL §34."
      />
      <Specimen name="board — live, one asked card selected" surface="bg" tall framed>
        <div style="height: 640px; position: relative;">
          <LiveBoard />
        </div>
      </Specimen>
      <Specimen name="board — tabs but no agents (§4.4)" surface="bg" framed>
        <div style="height: 320px; position: relative;">
          <AgentBoard view={emptyView} actions={NOOP} panel={PANEL_CLOSED} />
        </div>
      </Specimen>
      <Specimen name="board — a filter that yields nothing (§4.4)" surface="bg" framed>
        <div style="height: 320px; position: relative;">
          <AgentBoard view={filteredView} actions={NOOP} panel={PANEL_CLOSED} />
        </div>
      </Specimen>
    </>
  );
}
```

- [ ] **Step 2: Register it** in `src/gallery/section-registry.ts`: import `AgentBoardSection` and add `{ id: "agent-board", label: "agent board", Section: AgentBoardSection },` right after the `board` entry.

- [ ] **Step 3: Type-check and run the gallery gates** — `npx tsc --noEmit` clean; `npx vitest run scripts/gallery-entry.test.ts scripts/design-language.test.ts` → every test green except the baseline invariant (part 1, Task 1 step 8: `resolves every cited rule` lists exactly the nine pre-existing citations, no more).

- [ ] **Step 4: Look at it** — `npm run prototype:gallery` (or reuse a running one on `127.0.0.1:5175`; verify the process's cwd is THIS worktree, other sessions squat the port). With Playwright MCP: open `http://127.0.0.1:5175/gallery.html`, click the rail button whose text is `agent board` (the gallery selects sections by an in-memory signal, not the hash; do NOT click `navigation`, which crashes the headless renderer), take a full-page screenshot in `deck-dark`, switch the gallery's theme control to `deck-light`, screenshot again. Then measure in the page:

```js
() => {
  const card = document.querySelector('.board-card[aria-current="true"]');
  const s = getComputedStyle(card);
  const label = getComputedStyle(document.querySelector('.board-label'));
  return {
    cardFont: getComputedStyle(document.querySelector('.agent-board')).fontFamily,
    washed: document.querySelectorAll('.board-card[aria-current="true"]').length,
    radius: s.borderRadius, shadow: s.boxShadow,
    labelTransform: label.textTransform, labelTracking: label.letterSpacing,
    uppercaseOutsideLabel: [...document.querySelectorAll('.agent-board *')].filter(e => !e.classList.contains('board-label') && getComputedStyle(e).textTransform === 'uppercase').length,
    minCardWidth: Math.min(...[...document.querySelectorAll('.board-card')].map(e => e.getBoundingClientRect().width)),
    wrapped: [...document.querySelectorAll('.board-card__name, .board-card__what, .board-card__where')].filter(e => e.scrollHeight > e.clientHeight + 1).length,
    ripple: getComputedStyle(document.querySelector('.agent-board .asr-row__mark[data-state="asked"]'), '::after').animationName,
    actionsPosition: getComputedStyle(document.querySelector('.board-card__actions')).position,
    actionsPointer: getComputedStyle(document.querySelector('.board-card__actions')).pointerEvents,
  };
}
```

Expected: `washed` 1, `uppercaseOutsideLabel` 0, `wrapped` 0, `ripple` `none`, radius `10px`, shadow an inset 1px in the yellow token on the selected `asked` card, `actionsPosition` `absolute` and `actionsPointer` `auto` (the hover column must stay clickable — a specificity slip would put it in the grid flow). Known and intended for the eye pass: the hover column sits at the card's top-right and covers the rank number while the pointer is over the card; whether the number should step aside is the owner's call, not a defect. Then hover a card and screenshot it with the column revealed; click its `More` and confirm `.board-card__menu` reports `position: absolute` and lies inside the card's box. Record the two screenshots' paths and the measurement object in the task report; they are the evidence the owner's eye pass reads.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/gallery/sections/agent-board-section.tsx src/gallery/section-registry.ts && npx prettier --check src/gallery/sections/agent-board-section.tsx src/gallery/section-registry.ts
git commit -m "feat(gallery): mount the real AgentBoard over a fixture for the owner's eye pass

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/gallery/sections/agent-board-section.tsx src/gallery/section-registry.ts
```

---

### Task 13: Living docs — `AGENTS.md`, `docs/CONTEXT.md`

**Files:**
- Modify: `AGENTS.md` (one "Current direction" bullet; one open-queue fork entry; one drift-table row)
- Modify: `docs/CONTEXT.md` (one dated entry under the docs-layout section, newest first)
- Test: `npx vitest run scripts/design-language.test.ts` (citations in the new prose must resolve; markdown has no prettier gate)

- [ ] **Step 1: `AGENTS.md` Current direction** — add this bullet directly before the `**Chrome gallery is current:**` bullet:

```
- **The Agent Board is decided, and its model, treatment and specimen are built (2026-09-03).**
  A grid of live agent panes with a STATUS/PROJECTS nav and a right detail panel, toggled
  against the rail, never replacing it — the owner's answer to "every agent app is a
  sidebar". [Spec](docs/specs/2026-09-03-agent-board-design.md) `decided` (three forks
  answered, 24 grilling decisions, two reviews folded in); DL §34 is new and DL-4.1/4.3
  are amended: **chrome is monospace inside `.agent-board` and nowhere else**, and
  `.board-label` is uppercase copy — the first since the ban. What exists on
  `mxrsv/add-board-agent`: [`agent-board-model.ts`](src/ui/agent-board-model.ts) `building`
  (a second pure projection over `buildAgentRail`, joined to `PaneView` by pane id),
  [`agent-board-store.ts`](src/ui/agent-board-store.ts) `building`,
  [`agent-board.tsx`](src/ui/agent-board.tsx) `building` and its card/nav/panel, the
  `19-agent-board.css` treatment, and a gallery specimen of the real component. **Not
  built: every seam** — the surface/strip/keymap/journal wiring, `pty_kill_foreground`,
  `serializePane`, `acknowledgePane`, `restartPane` and the `PaneView` fields (`ordinal`,
  `startedAt`, `lastAgent`) the model takes as input maps today. Facts Deck cannot know are
  drawn as absent, not invented (spec §8). Verified by the suites named in the
  [plan](docs/plans/2026-09-03-agent-board-model-and-specimen.md) `building` and a gallery
  screenshot in both themes — **no wiring, no host pass, no owner eye review yet**; the
  eye pass on the specimen is the gate the second plan waits for. Merging still waits for
  the daily-surfaces release (2026-09-02).
```

- [ ] **Step 2: `AGENTS.md` open queue** — add this entry at the TOP of the "Open queue" list:

```
- **The Agent Board: two typography rules reopened, §34 added, four more DL rules
  amended, and four seams named (2026-09-03, owner-decided in a 24-question grilling,
  then "execute the spec").** Fork-listed categories: **a rule in `docs/DESIGN-LANGUAGE.md`**
  — DL-4.1 (mono belongs to the terminal AND the Board), DL-4.3 (a third exception, the
  first that is copy), DL-4.4/DL-3.4 (the Board's group label at `--type-meta`/faint),
  DL-1.2 (the spinner as a fourth loop exception), DL-21.7 (the card's resting wash), §34
  new; **PTY ownership and an R6 channel** — `pty_kill_foreground` for Stop, decided, not
  built; **tab-layer seams** — `acknowledgePane`, `restartPane`, `serializePane`, decided,
  not built; **session schema** — `agentBoardOpen` on `WindowRecord`, `taskPrompt` on
  `SessionPane`, decided, not built. Chosen over an Inbox-only rail redesign (the two
  toggle), over an automatic count-based flip (a surprise the 2026-09-02 pass exists to
  remove), over reparenting the live xterm (a snapshot instead; the loan is an upgrade),
  and over relaunching fresh on Restart (it resumes). NOT touched: process classification,
  the window coordinator, layout/pane mounting, the settings schema, any sibling repo.
```

- [ ] **Step 3: `AGENTS.md` drift table** — append one row:

`| The Agent Board is a shipping surface | \`building\` | model + specimen only | Built 2026-09-03 from the [spec](docs/specs/2026-09-03-agent-board-design.md) \`decided\`: projection, store, DL §34 and its gate, the treatment, four components and a gallery specimen — suites green per task, \`npx tsc --noEmit\` clean, gallery screenshots in both themes. **Nothing is wired**: no chip, no chord, no journal field, no IPC, no host seam; the owner's eye pass on the specimen is owed and gates the wiring plan — [plan](docs/plans/2026-09-03-agent-board-model-and-specimen.md) \`building\` |`

- [ ] **Step 4: `docs/CONTEXT.md`** — insert, directly after the `## Docs layout` section and before the newest dated entry, this entry:

```
## The Agent Board — model, treatment and specimen — 2026-09-03

`building`. The owner chose the direction in the morning (a card grid of live agent
panes, a STATUS/PROJECTS nav, a right panel — style and layout from a fleet-dashboard
reference, none of its features), answered three forks, grilled the spec in 24
questions, and said "execute" in the afternoon. The spec is
[2026-09-03-agent-board-design.md](specs/2026-09-03-agent-board-design.md) `decided`;
the plan is [2026-09-03-agent-board-model-and-specimen.md](plans/2026-09-03-agent-board-model-and-specimen.md)
`building`.

- **Built:** `agent-board-model.ts` (a pure projection over `buildAgentRail`, joined to
  `PaneView` by pane id; `boardWhere` formats `project · label · branch` itself because
  main's `subjectWhere` is not on this branch), `agent-board-store.ts` (the browser
  store's three-signal shape plus selection, filters, held order and the pane-ordinal
  allocator), `19-agent-board.css`, `agent-board.tsx` + card/nav/panel, `RailStatusMark`
  moved to `controls/`, `strip-ansi-sequences.ts`, DL §34 with the gate's
  `LABEL_TREATMENT_SELECTORS`, and a gallery section mounting the real component.
- **Decided in the build, for veto:** the card's row 2 is the agent brand glyph plus the
  agent's short name; a single-agent tab's custom name replaces the name, a multi-agent
  tab's closes the where-line (spec §5.3). The rail's `asked` ripple is off on the Board;
  the yellow frame is the whole signal (DL-34.3).
- **Not built:** every seam the spec's §11–§12 name. The model takes `ordinals`,
  `startedAt`, `tasks`, `lastAgents` and `confidence` as input maps until the wiring plan
  puts them on `PaneView`.
- **Evidence:** per-task suites, `npx tsc --noEmit`, the design-language gate, prettier,
  and two gallery screenshots (`deck-dark`, `deck-light`) with the measurement the plan's
  Task 12 records. **Owed:** the owner's eye pass on the specimen (gate 1), then the
  wiring plan, then a native `electron:dev` pass.
```

- [ ] **Step 5: Verify and commit**

```bash
# `.prettierignore` lists `*.md`: there is NO prettier gate for docs — never cite one.
npx vitest run scripts/design-language.test.ts
git commit -m "docs(context): record the agent board's model, treatment and specimen

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- AGENTS.md docs/CONTEXT.md
```

---

## End-of-plan gates (run in this order, quote each output)

1. `npx tsc --noEmit` — clean (it is clean at baseline on this branch, measured 2026-09-03).
   The design-language gate's `resolves every cited rule` test is red at baseline with
   exactly nine pre-existing unresolved citations (part 1, Task 1 step 8); it must list
   exactly those nine and no more at the end.
2. `npx vitest run scripts/design-language.test.ts src/ui/agent-board-model.test.ts src/ui/agent-board-store.test.ts src/ui/agent-board-card.test.tsx src/ui/agent-board-nav.test.tsx src/ui/agent-board-panel.test.tsx src/ui/agent-board.test.tsx src/ui/controls/rail-status-mark.test.tsx src/ui/agent-rail.test.tsx src/lib/strip-ansi-sequences.test.ts scripts/gallery-entry.test.ts` — green.
3. `npm test` — read every failure; attribute any that reproduce on a pristine `HEAD` worktree to other sessions, name them, fix the rest.
4. `npm run build` — clean (the shipping bundle must not import `src/gallery/`; R7).
5. `npx prettier --check src/ui/agent-board*.ts src/ui/agent-board*.tsx src/ui/controls/rail-status-mark.tsx src/ui/controls/rail-status-mark.test.tsx src/lib/strip-ansi-sequences.ts src/lib/strip-ansi-sequences.test.ts src/styles/19-agent-board.css src/gallery/sections/agent-board-section.tsx scripts/design-language.test.ts` — clean (markdown is in `.prettierignore`; a `.md` in this list would be skipped silently and prove nothing).
6. Gallery screenshots in both themes plus the Task 12 measurement, saved outside the repo and named in the final report.

**Then stop.** The owner's eye pass on the specimen is spec §14's gate 1. The wiring plan (`2026-09-03-agent-board-wiring.md`) is written after it, against whatever the eye pass changes.
